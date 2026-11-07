// Tests for Work and pay: shift pay by rate tier, unpaid breaks, the tax estimate, the yearly projection and the
// student visa fortnight check. All rates, shifts and payslips here are made up. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), addDays = get("addDays");
const plain = (x) => JSON.parse(JSON.stringify(x));
const work = get("work"), shiftPay = (s, w) => plain(get("shiftPay")(s, w)), taxParts = (...a) => plain(get("taxParts")(...a));
const wkYear = (w, t) => plain(get("wkYear")(w, t)), visaFor = (d, w) => plain(get("visaFor")(d, w)), lito = get("lito");
const shiftErr = get("shiftErr"), slipErr = get("slipErr");

// Made-up rates: $30 ordinary, $40 before 7 am, $35 from 6 pm, $45 Sunday with 2 hours at $55, $65 public holiday.
const rates = { ord: 30, early: 40, earlyBefore: "07:00", eve: 35, eveAfter: "18:00", sat: "", sun: 45, sunx: 55, sunxH: 2, ph: 65 };
const W = (more = {}) => work({ rates, brk: { paid: 30, unpaid: 30, minH: 5 }, ...more });
// 2030-03-04 is a Monday; 2030-03-10 a Sunday.
const MON = "2030-03-04", SUN = "2030-03-10";

test("a weekday shift splits at 6 pm and the unpaid break comes out of ordinary time", () => {
  const p = shiftPay({ date: MON, start: "14:00", end: "20:30" }, W()); // 6.5 h span, 0.5 h unpaid
  assert.deepEqual(p.lines.map((l) => [l.k, l.h, l.amt]), [["ord", 3.5, 105], ["eve", 2.5, 87.5]]);
  assert.equal(p.h, 6);
  assert.equal(p.pay, 192.5);
});

test("short shifts have no unpaid break", () => {
  const p = shiftPay({ date: MON, start: "10:00", end: "14:00" }, W());
  assert.equal(p.h, 4);
  assert.equal(p.pay, 120);
});

test("an early start is paid at the early rate until 7 am", () => {
  const p = shiftPay({ date: MON, start: "06:00", end: "12:00" }, W());
  assert.deepEqual(p.lines.map((l) => [l.k, l.h]), [["ord", 4.5], ["early", 1]]);
  assert.equal(p.pay, 175);
});

test("odd minutes round to 2 places of an hour, then each line to the cent", () => {
  const p = shiftPay({ date: MON, start: "06:08", end: "12:00" }, W());
  assert.deepEqual(p.lines.map((l) => [l.k, l.h, l.amt]), [["ord", 4.5, 135], ["early", 0.87, 34.8]]);
});

test("a break with a start time is taken from those exact minutes, even across 6 pm", () => {
  const p = shiftPay({ date: MON, start: "14:00", end: "21:00", brkAt: "17:45" }, W());
  // 15 min before 6 pm (ordinary) and 15 min after (evening) come out
  assert.deepEqual(p.lines.map((l) => [l.k, l.h]), [["ord", 3.75], ["eve", 2.75]]);
  assert.equal(p.pay, r(3.75 * 30 + 2.75 * 35));
});

test("a shift's own break overrides the default, and 0 means no break", () => {
  assert.equal(shiftPay({ date: MON, start: "09:00", end: "17:00", brk: 0 }, W()).h, 8);
  assert.equal(shiftPay({ date: MON, start: "09:00", end: "17:00", brk: 60 }, W()).h, 7);
});

test("Sunday pays the Sunday rate with the extra hours at the higher rate, and ignores time-of-day rates", () => {
  const p = shiftPay({ date: SUN, start: "06:00", end: "19:00", brk: 0 }, W());
  assert.deepEqual(p.lines.map((l) => [l.k, l.h]), [["sun", 11], ["sunx", 2]]);
  assert.equal(p.pay, 11 * 45 + 2 * 55);
});

test("a public holiday beats the day and the time", () => {
  const p = shiftPay({ date: SUN, start: "16:00", end: "20:00", ph: true }, W());
  assert.deepEqual(p.lines.map((l) => [l.k, l.h]), [["ph", 4]]);
});

test("a shift not worked pays nothing", () => {
  assert.equal(shiftPay({ date: MON, start: "09:00", end: "17:00", off: true }, W()).pay, 0);
});

test("a shift past midnight keeps counting", () => {
  assert.equal(shiftPay({ date: MON, start: "22:00", end: "02:00" }, W()).h, 4);
});

test("tax: 2026-27 resident rates, offset and Medicare levy at the edges", () => {
  assert.equal(taxParts(18200, 2026, true).total, 0);
  // 18,201–45,000 at 15%, low income tax offset $700 up to $37,500
  assert.deepEqual(taxParts(30000, 2026, true), { base: 1770, offset: 700, tax: 1070, levy: 198.9, total: 1268.9 });
  assert.deepEqual(taxParts(37500, 2026, false), { base: 2895, offset: 700, tax: 2195, levy: 0, total: 2195 });
  assert.equal(taxParts(45000, 2026, false).offset, 325);
  assert.equal(lito(66667), 0);
  assert.equal(r(lito(55000)), 175);
  // the offset can't take tax below zero
  assert.deepEqual(taxParts(20000, 2026, false), { base: 270, offset: 270, tax: 0, levy: 0, total: 0 });
  // 2025-26 still had 16%
  assert.equal(taxParts(30000, 2025, false).base, 1888);
});

test("tax: Medicare levy is nil to the threshold, phased in, then 2%", () => {
  assert.equal(taxParts(28011, 2026, true).levy, 0);
  assert.equal(taxParts(30000, 2026, true).levy, 198.9); // 10% of the amount over the threshold
  assert.equal(taxParts(40000, 2026, true).levy, 800);
});

test("tax taken out of a pay: ATO scale 2 formula, weekly and fortnightly", () => {
  const withhold = get("withhold");
  assert.equal(withhold(700, 14), 0); // $350 a week is under the threshold
  assert.equal(withhold(1000, 14), 42); // $500 a week: 0.15 x 500.99 - 54.3462 = 20.80, rounds to 21, doubled
  assert.equal(withhold(1600, 14), 166); // $800 a week: 0.179 x 800.99 - 60.8377 = 82.54 -> 83
  assert.equal(withhold(3700, 7), 1084); // top band
  assert.equal(withhold(0, 14), 0);
});

test("pay days come from the latest payslip's period and pay date", () => {
  const w = W({ slips: [{ id: "p1", payDate: "2030-03-06", from: "2030-02-17", to: "2030-03-02", gross: 1000, tax: 42 }] });
  const sc = plain(get("wkSched")(w));
  assert.deepEqual(sc, { len: 14, anchor: "2030-02-17", lag: 4, src: "slip" });
  const ps = plain(get("wkPeriods")(sc, "2030-03-01", "2030-04-30"));
  assert.deepEqual(ps.map((p) => p.pay), ["2030-03-06", "2030-03-20", "2030-04-03", "2030-04-17"]);
  assert.equal(ps[1].from, "2030-03-03");
  assert.equal(ps[1].to, "2030-03-16");
});

test("the year by pay day: payslips, pay days without one, shifts not paid yet, rostered and the average", () => {
  const t = "2030-03-13"; // a Wednesday
  const shifts = [];
  // one 4-hour ordinary shift ($120) each Monday from 14 Jan to 11 Mar, and one rostered on 20 Mar
  for (let i = 0; i < 9; i++) shifts.push({ id: "s" + i, date: addDays("2030-01-14", i * 7), start: "10:00", end: "14:00" });
  shifts.push({ id: "f", date: "2030-03-20", start: "10:00", end: "14:00" });
  const slips = [{ id: "p1", payDate: "2030-03-06", from: "2030-02-17", to: "2030-03-02", gross: 1000, tax: 42 }];
  const Y = wkYear(W({ shifts, slips }), t);
  assert.equal(Y.y, 2029);
  assert.equal(Y.paidG, 1000);
  assert.equal(Y.paidT, 42);
  assert.equal(Y.nos, 600); // 14 Jan – 11 Feb: paid on earlier pay days with no payslip added
  assert.equal(Y.owed, 240); // 4 and 11 March, paid on 20 March
  assert.equal(Y.rost, 120);
  // 8 weeks from 17 Jan: the payslip's $1,000 for its fortnight, plus the 6 shifts on days no payslip covers ($720)
  assert.equal(Y.avg, r((1000 + 720) / 56 * 7));
  assert.equal(Y.earned, 1840);
  assert.equal(Y.annual, r(1840 + 120 + Y.trend));
  const next = Y.next;
  assert.equal(next.pay, "2030-03-20");
  // the roster already reaches past this period, so its unrostered days count as days off, not as average pay
  assert.equal(next.gross, 240);
  assert.equal(next.tax, 0);
  // stopping now: income is under the tax-free threshold, so the $42 taken out comes back
  assert.equal(Y.quit.withheld, 42);
  assert.equal(Y.quit.refund, 42);
  assert.equal(Y.keep.withheld, 42); // about $215 a week is under the weekly threshold, so no more tax comes out
});

test("the year: without payslips, tax taken out is estimated with the formula", () => {
  const Y = wkYear(W({ shifts: [{ id: "a", date: "2030-03-11", start: "08:00", end: "16:30" }] }), "2030-03-13");
  assert.equal(Y.earned, 240);
  assert.equal(Y.paidT, 0);
  assert.equal(Y.quit.refund, 0);
});

test("visa: the busier of the two Monday fortnights, only in a study period", () => {
  const study = [{ name: "Term", start: "2030-03-11", end: "2030-06-30" }];
  const shifts = [];
  // 30 h in the week of 4 March (before the term) and 30 h the week of 11 March
  for (const wk of ["2030-03-04", "2030-03-11"]) for (let d = 0; d < 5; d++) shifts.push({ id: wk + d, date: addDays(wk, d), start: "09:00", end: "15:00", brk: 0 });
  const w = W({ shifts, study, visa: { on: true, cap: 48 } });
  const v = visaFor("2030-03-12", w);
  // the fortnight from 4 March touches the term on 11 March, so it counts: 60 h
  assert.equal(v.from, "2030-03-04");
  assert.equal(v.h, 60);
  // a date well before the term isn't limited
  assert.equal(visaFor("2030-02-18", w), null);
});

test("form checks", () => {
  assert.equal(shiftErr({ date: MON, start: "09:00", end: "17:00" }), "");
  assert.match(shiftErr({ date: MON, start: "09:00", end: "" }), /start and finish/);
  assert.match(shiftErr({ date: MON, start: "09:00", end: "17:00", changed: true, pStart: "" }), /rostered/);
  assert.equal(slipErr({ payDate: MON, from: "2030-02-17", to: "2030-03-02", gross: "1000", tax: "100" }), "");
  assert.match(slipErr({ payDate: MON, from: "2030-02-17", to: "2030-03-02", gross: "100", tax: "200" }), /more than/);
});

function r(n) { return Math.round(n * 100) / 100; }
