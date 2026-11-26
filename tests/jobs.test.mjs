// Tests for jobs: pay rises from a date, finishing one job and starting another, two jobs at once (tax-free threshold
// at one only), salaried jobs, monthly pay, and older saved data. All rates, salaries and shifts are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), addDays = get("addDays"), work = get("work"), withhold = get("withhold");
const plain = (x) => JSON.parse(JSON.stringify(x));
const shiftPay = (s, w) => plain(get("shiftPay")(s, w)), wkYear = (w, t) => plain(get("wkYear")(w, t)), visaFor = (d, w) => plain(get("visaFor")(d, w));
const r = (n) => Math.round(n * 100) / 100;
const hourly = (id, ord, more = {}) => ({ id, kind: "hourly", rates: [{ from: "", ord }], brk: { paid: 0, unpaid: 0, minH: 99 }, pay: { len: 14, lag: 3, anchor: "2030-03-04" }, ...more });
const sh = (id, date, job) => ({ id, date, start: "09:00", end: "13:00", job }); // 4 hours

test("data saved before jobs existed loads as one job, with its shifts and pay days", () => {
  const w = work({ rates: { ord: 30 }, brk: { paid: 0, unpaid: 0, minH: 9 }, pay: { len: 7, lag: 2, anchor: "2030-03-04" }, shifts: [sh("a", "2030-03-05")] });
  assert.equal(w.jobs.length, 1);
  assert.equal(w.jobs[0].tft, true);
  assert.equal(shiftPay(w.shifts[0], w).pay, 120);
  assert.equal(plain(get("wkSched")(w)).len, 7);
});

test("a pay rise from a date: shifts before it keep the old rate", () => {
  const w = work({ jobs: [hourly("j1", 30, { rates: [{ from: "", ord: 30 }, { from: "2030-03-10", ord: 33 }] })] });
  assert.equal(shiftPay(sh("a", "2030-03-09"), w).pay, 120);
  assert.equal(shiftPay(sh("b", "2030-03-10"), w).pay, 132);
  assert.equal(shiftPay(sh("c", "2031-01-01"), w).pay, 132);
});

test("a job that has finished adds no estimate after its last day; the new job brings its own", () => {
  const t = "2030-03-20";
  const old = hourly("j1", 30, { end: "2030-03-15" }), neu = hourly("j2", 40, { start: "2030-03-16", tft: false });
  const shifts = [];
  for (let i = 0; i < 6; i++) shifts.push(sh("o" + i, addDays("2030-02-04", i * 7), "j1"));
  const onlyOld = wkYear(work({ jobs: [old], shifts }), t);
  // the old job ended: nothing is projected after 15 March
  assert.equal(onlyOld.trend, 0);
  assert.equal(onlyOld.annual, onlyOld.earned);
  // with a new job and one shift at $160, the rest of the year comes from the new job's own pace
  const both = wkYear(work({ jobs: [old, neu], shifts: shifts.concat([sh("n", "2030-03-17", "j2")]) }), t);
  assert.ok(both.trend > 0);
  assert.equal(both.jobs.length, 2);
  assert.equal(r(both.jobs[0].annual), onlyOld.annual);
});

test("two jobs: shifts pay at their own job's rate, and the second job withholds without the tax-free threshold", () => {
  const w = work({ jobs: [hourly("j1", 30), hourly("j2", 50, { tft: false })], shifts: [sh("a", "2030-03-05", "j1"), sh("b", "2030-03-06", "j2")] });
  assert.equal(shiftPay(w.shifts[0], w).pay, 120);
  assert.equal(shiftPay(w.shifts[1], w).pay, 200);
  // ATO example: $563.60 a week is $108 with no tax-free threshold and $33 with it
  assert.equal(withhold(563.6, 7, false), 108);
  assert.equal(withhold(563.6, 7), 33);
  assert.equal(withhold(1000, 7, false), 249);
  const Y = wkYear(w, "2030-03-06"), row = Y.rows.find((x) => x.job === "j2" && x.done > 0);
  assert.equal(row.doneTax, withhold(200, 14, false));
});

test("a shift with no job, or a job that's gone, counts towards the first job", () => {
  const w = work({ jobs: [hourly("j1", 30), hourly("j2", 50)] });
  assert.equal(shiftPay(sh("a", "2030-03-05"), w).pay, 120);
  assert.equal(shiftPay(sh("b", "2030-03-05", "gone"), w).pay, 120);
});

test("a salary pays its share each period, prorated for the first part-period, and a raise applies from its date", () => {
  const job = { id: "s1", kind: "salary", start: "2030-03-11", salary: [{ from: "", annual: 72800, hrs: 38 }, { from: "2030-04-01", annual: 78000 }], pay: { len: 14, lag: 3, anchor: "2030-03-04" } };
  const Y = wkYear(work({ jobs: [job] }), "2030-03-01");
  const rows = Y.rows.filter((x) => x.gross > 0);
  // 4–17 March: 7 of 14 days at $2,800 a fortnight
  assert.equal(rows[0].gross, 1400);
  // 18–31 March: a full fortnight
  assert.equal(rows[1].gross, 2800);
  // from 1 April, $78,000 a year is $3,000 a fortnight
  assert.equal(rows[2].gross, 3000);
  assert.ok(Y.sal > 0);
});

test("monthly pay: periods follow the calendar month from the anchor day", () => {
  const sc = { len: "m", anchor: "2030-01-01", lag: 0 };
  const ps = plain(get("wkPeriods")(sc, "2030-03-01", "2030-05-31"));
  assert.deepEqual(ps.map((p) => [p.from, p.to]), [["2030-03-01", "2030-03-31"], ["2030-04-01", "2030-04-30"], ["2030-05-01", "2030-05-31"]]);
  const job = { id: "s1", kind: "salary", salary: [{ annual: 60000 }], pay: { len: "m", lag: 0, anchor: "2030-01-01" } };
  const Y = wkYear(work({ jobs: [job] }), "2030-03-01");
  assert.ok(Y.rows.every((x) => x.gross === 5000));
});

test("visa hours add up across jobs, including a salaried job's weekly hours", () => {
  const study = [{ name: "Term", start: "2030-03-01", end: "2030-06-30" }];
  const sal = { id: "s1", kind: "salary", salary: [{ annual: 30000, hrs: 10 }] };
  const w = work({ jobs: [hourly("j1", 30), sal], shifts: [sh("a", "2030-03-05", "j1")], study, visa: { on: true, cap: 48 } });
  assert.equal(visaFor("2030-03-05", w).h, 24); // 4 h of shifts + 10 h a week for 2 weeks
});

test("calendar: a second job's roster pay shows on its own day and doesn't take the usual pay's place", () => {
  const today = get("today")(), ym = get("ym"), shiftMonth = get("shiftMonth"), nextMonth = shiftMonth(ym(today), 1), PAY = nextMonth + "-15";
  const anchor = addDays(PAY, -2 - 14 - 28);
  S.cfg = { currency: "AUD", region: "au", accounts: [{ name: "Everyday", kind: "everyday", opening: 1000 }], categories: [],
    recurring: [{ id: "p1", desc: "Pay", type: "Income", category: "Salary", account: "Everyday", amount: 1500, cadence: "fortnight", anchor: PAY, skipped: [], pay: true }],
    work: { jobs: [hourly("j1", 30, { pay: undefined }), hourly("j2", 50, { tft: false, pay: { len: 14, lag: 4, anchor } })],
      shifts: [sh("a", addDays(PAY, -10), "j2")], slips: [] } };
  S.tx = [{ id: "seed", date: addDays(today, -60), type: "Expense", amount: 1, account: "Everyday", category: "Food", desc: "x" }];
  S.props = [];
  const c = plain(get("calMonth")(nextMonth)), days = Object.values(c.days);
  const rp = days.flatMap((D) => D.rps);
  assert.equal(rp.length, 1);
  assert.equal(rp[0].job, "j2");
  assert.equal(rp[0].gross, 200);
  // the usual pay still counts in full: the first job has no shifts, so nothing replaces it
  assert.ok(days.some((D) => D.due.some((u) => u.r && u.r.pay) && D.eIn >= 1500));
  assert.equal(plain(get("rosterFor")(PAY)), null);
});

// The Work screen draws for each kind of setup without errors, and shows what's needed to handle job changes.
test("the Work screen and job form draw for one job, two jobs, a finished job and a salary", () => {
  const vWork = get("vWork"), setWork = (w) => { S.cfg = Object.assign({}, S.cfg || {}, { currency: "AUD", region: "au", recurring: [], work: w }) };
  get("WK=null");
  setWork({ rates: { ord: 30 }, shifts: [sh("a", get("today")())] });
  let h = vWork();
  assert.ok(h.includes("Jobs and pay rates") && h.includes("Pay rise, new job or full-time?"));
  assert.ok(!h.includes('id="wkj"'), "no job picker with one job");
  setWork({ jobs: [hourly("j1", 30, { name: "Café", end: "2026-01-01" }), hourly("j2", 35, { name: "Shop", tft: false }), { id: "s1", kind: "salary", name: "Office", salary: [{ annual: 70000, hrs: 38 }] }], shifts: [sh("a", get("today")(), "j2")] });
  h = vWork();
  assert.ok(h.includes("Café") && h.includes("Finished") && h.includes("Office") && h.includes("a year salary"));
  assert.ok(h.includes("Shop · "), "shift rows name their job");
  get("wkOpenShift")("");
  h = vWork();
  const pick = h.slice(h.indexOf('id="wkj"'), h.indexOf("</select>", h.indexOf('id="wkj"')));
  assert.ok(pick.includes(">Shop<") && !pick.includes(">Office<"), "the job picker lists hourly jobs only");
  assert.ok(pick.includes('value="j2" selected'), "a new shift starts on the job of the last shift logged");
  get("wkOpenJob")("j2");
  h = vWork();
  assert.ok(h.includes("Pay rise? Add new rates from a date") && h.includes("I claimed the tax-free threshold"));
  get("wkOpenJob")("s1");
  h = vWork();
  assert.ok(h.includes("Yearly salary") && h.includes("Add a new salary from a date") && !h.includes("Breaks"));
  get("wkOpenSetup")();
  h = vWork();
  assert.ok(h.includes("Tax and visa") && !h.includes("Ordinary hours"));
  get("WK=null");
});

test("a job's pay rise and a finish date are checked before saving", () => {
  const jobErr = get("jobErr"), base = { kind: "hourly", start: "2030-01-01", left: false, end: "", pay: { len: 14, lag: 3, anchor: "" }, salary: [{}] };
  assert.equal(jobErr({ ...base, rates: [{ ord: 30 }] }), "");
  assert.match(jobErr({ ...base, rates: [{ ord: 30 }, { from: "", ord: 33 }] }), /date the new rates start/);
  assert.match(jobErr({ ...base, rates: [{ ord: 30 }, { from: "2030-05-01", ord: "" }] }), /ordinary hourly rate \(from/);
  assert.match(jobErr({ ...base, left: true, end: "2029-12-01", rates: [{ ord: 30 }] }), /after you started/);
  assert.match(jobErr({ ...base, kind: "salary", rates: [{}], salary: [{ annual: "" }] }), /yearly salary/);
});
