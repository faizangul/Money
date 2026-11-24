// Tests for the calendar's daily and monthly net, and pay worked out from rostered shifts.
// All rates, shifts and pay amounts here are made up. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), today = get("today")(), ym = get("ym"), shiftMonth = get("shiftMonth"), addDays = get("addDays");
const plain = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "r" ? { desc: v.desc, type: v.type, pay: !!v.pay } : v)));
const calMonth = (m) => plain(get("calMonth")(m)), rosterFor = (d) => plain(get("rosterFor")(d)), wkSched = () => plain(get("wkSched")());
const withhold = get("withhold");
const thisMonth = ym(today), nextMonth = shiftMonth(thisMonth, 1), lastMonth = shiftMonth(thisMonth, -1);
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();

// Made-up: $30 an hour ordinary, nothing else; a usual fortnightly pay of $1,500 on the 15th of next month.
const PAY = nextMonth + "-15";
function setup({ pay = true, shifts = [], tx = [] } = {}) {
  S.cfg = { currency: "AUD", region: "au", accounts: [{ name: "Everyday", kind: "everyday", opening: 1000 }], categories: [],
    recurring: [{ id: "r1", desc: "Rent", type: "Expense", category: "Rent", account: "Everyday", amount: 500, cadence: "week", anchor: "2026-01-05", skipped: [] }]
      .concat(pay ? [{ id: "p1", desc: "Pay", type: "Income", category: "Salary", account: "Everyday", amount: 1500, cadence: "fortnight", anchor: PAY, skipped: [], pay: true }] : []),
    work: { rates: { ord: 30 }, brk: { paid: 30, unpaid: 30, minH: 5 }, shifts: shifts.map((s, i) => ({ id: "s" + i, ...s })), slips: [] } };
  S.tx = [{ id: "seed", date: addDays(today, -60), type: "Expense", amount: 1, account: "Everyday", category: "Food", desc: "x" }]
    .concat(tx.map((t, i) => ({ id: "t" + i, account: "Everyday", category: "Food", desc: "x", ...t })));
  S.props = [];
}
// Five 9-to-5 weekday shifts (7.5 h paid each, $225) in the fortnight paid on PAY, which ends 3 days before it.
const weekdays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (dow(d) % 6) out.push(d); return out };
const fiveShifts = () => weekdays(addDays(PAY, -16), addDays(PAY, -3)).slice(0, 5).map((date) => ({ date, start: "09:00", end: "17:00" }));

test("each day and the month show net: money in minus money out, transfers left out", () => {
  const d = lastMonth + "-10";
  setup({ tx: [
    { date: d, type: "Income", amount: 900 }, { date: d, type: "Expense", amount: 120.5 },
    { date: d, type: "Transfer", amount: 300, to: "Savings" }, { date: lastMonth + "-11", type: "Expense", amount: 80 },
  ] });
  const c = calMonth(lastMonth);
  assert.equal(c.days[d].net, 779.5);
  assert.equal(c.days[lastMonth + "-11"].net, -80);
  assert.equal(c.net, 699.5);
});

test("a month ahead adds up what's expected: usual pay in, bills out, and the net", () => {
  setup();
  const c = calMonth(nextMonth), D = Object.values(c.days);
  const rent = D.filter((x) => x.due.some((u) => u.r.desc === "Rent")).length, pays = D.filter((x) => x.due.some((u) => u.r.pay)).length;
  assert.equal(c.eOut, 500 * rent);
  assert.equal(c.eIn, 1500 * pays);
  assert.equal(c.eNet, 1500 * pays - 500 * rent);
  assert.equal(c.rost, 0);
});

test("with no pay settings or payslip, pay periods line up with the usual pay day", () => {
  setup();
  const sc = wkSched();
  assert.equal(sc.src, "payitem");
  assert.equal(sc.len, 14);
  assert.equal(addDays(sc.anchor, 14 + 14 - 1 + sc.lag), addDays(PAY, 14));
});

test("on pay day, the roster's take-home replaces the usual amount", () => {
  setup({ shifts: fiveShifts() });
  const ro = rosterFor(PAY), gross = 5 * 225, tax = withhold(gross, 14);
  assert.equal(ro.pay, PAY);
  assert.equal(ro.hrs, 37.5);
  assert.equal(ro.gross, gross);
  assert.equal(ro.tax, tax);
  assert.ok(tax > 0);
  assert.equal(ro.take, gross - tax);
  const c = calMonth(nextMonth);
  assert.equal(c.days[PAY].eIn, gross - tax);
  assert.equal(c.rost, gross - tax);
  assert.equal(c.usual, 1500);
});

test("the roster says how far it reaches, so a half-logged fortnight isn't mistaken for the full pay", () => {
  const sh = fiveShifts();
  setup({ shifts: sh });
  assert.equal(rosterFor(PAY).partial, sh[4].date);
  setup({ shifts: sh.concat({ date: addDays(PAY, -3), start: "09:00", end: "12:00" }) });
  assert.equal(rosterFor(PAY).partial, "");
});

test("shifts off and pay days with nothing rostered fall back to the usual amount", () => {
  setup({ shifts: fiveShifts().map((s) => ({ ...s, off: true })) });
  assert.equal(rosterFor(PAY), null);
  assert.equal(calMonth(nextMonth).days[PAY].eIn, 1500);
});

test("without a usual pay set up, roster pay shows on its own pay days, each period once", () => {
  setup({ pay: false, shifts: fiveShifts() });
  const sc = wkSched(), c = calMonth(nextMonth);
  assert.equal(sc.src, "assumed");
  const days = Object.entries(c.days).filter(([, D]) => D.rp);
  assert.ok(days.length >= 1 && days.length <= 2, String(days.length));
  for (const [d, D] of days) { assert.equal(D.rp.pay, d); assert.equal(D.eIn, D.rp.take) }
  assert.equal(days.reduce((a, [, D]) => a + D.rp.gross, 0), 5 * 225);
  assert.equal(c.rost, Math.round(days.reduce((a, [, D]) => a + D.rp.take, 0) * 100) / 100);
});

test("each shift appears on its day", () => {
  const sh = fiveShifts();
  setup({ shifts: sh });
  const inMonth = sh.filter((s) => ym(s.date) === nextMonth);
  for (const s of inMonth) assert.equal(calMonth(nextMonth).days[s.date].shifts.length, 1);
});
