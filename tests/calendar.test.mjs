// Tests for the calendar: daily money in and out, and expected bills on future days. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), today = get("today")(), ym = get("ym"), shiftMonth = get("shiftMonth"), addDays = get("addDays");
const calMonth = (m) => JSON.parse(JSON.stringify(get("calMonth")(m), (k, v) => (k === "r" ? { desc: v.desc, type: v.type, card: !!v.card } : v)));
const thisMonth = ym(today), nextMonth = shiftMonth(thisMonth, 1), lastMonth = shiftMonth(thisMonth, -1);

// A weekly bill due every Monday, and a fresh copy of the data each time so cached results don't carry over.
function setup(tx) {
  S.cfg = { currency: "AUD", accounts: [{ name: "Everyday", kind: "everyday", opening: 1000 }], categories: [],
    recurring: [{ id: "r1", desc: "Rent", type: "Expense", category: "Rent", account: "Everyday", amount: 500, cadence: "week", anchor: "2026-01-05", skipped: [] }] };
  S.tx = tx.map((t, i) => ({ id: "t" + i, account: "Everyday", category: "Food", desc: "x", ...t }));
  S.props = [];
}

test("each day adds up money out and in; transfers and IOUs don't count as spending", () => {
  const d = lastMonth + "-10";
  setup([
    { date: d, type: "Expense", amount: 40 },
    { date: d, type: "Expense", amount: 14.5 },
    { date: d, type: "Expense", amount: -4.5 }, // refund
    { date: d, type: "Income", amount: 2400 },
    { date: d, type: "Transfer", amount: 300, to: "Savings" },
    { date: d, type: "IOU out", amount: 20, person: "Sam" },
    { date: lastMonth + "-11", type: "Expense", amount: 9.99 },
  ]);
  const c = calMonth(lastMonth);
  assert.equal(c.days[d].out, 50);
  assert.equal(c.days[d].in, 2400);
  assert.equal(c.days[d].tx.length, 6);
  assert.equal(c.out, 59.99);
  assert.equal(c.in, 2400);
});

test("a past month shows what happened, with nothing expected", () => {
  setup([{ date: lastMonth + "-03", type: "Expense", amount: 10 }]);
  const c = calMonth(lastMonth);
  assert.equal(c.due, 0);
  assert.ok(Object.values(c.days).every((D) => D.due.length === 0));
});

test("next month shows each Monday's rent as expected, even past the 3 weeks Home shows", () => {
  setup([{ date: addDays(today, -60), type: "Expense", amount: 1 }]);
  const c = calMonth(nextMonth);
  const due = Object.entries(c.days).filter(([, D]) => D.due.length).map(([d]) => d);
  assert.ok(due.length >= 4 && due.length <= 5, String(due.length));
  for (const d of due) assert.equal(new Date(d + "T00:00:00Z").getUTCDay(), 1);
  assert.equal(c.due, 500 * due.length);
});

test("a logged or skipped bill isn't expected again", () => {
  setup([{ date: addDays(today, -60), type: "Expense", amount: 1 }]);
  const mondays = Object.entries(calMonth(nextMonth).days).filter(([, D]) => D.due.length).map(([d]) => d);
  S.cfg.recurring[0].skipped = [mondays[0]];
  S.tx = [...S.tx, { id: "paid", date: mondays[1], type: "Expense", amount: 500, account: "Everyday", category: "Rent", rec: "r1@" + mondays[1] }];
  const c = calMonth(nextMonth);
  assert.equal(c.days[mondays[0]]?.due.length || 0, 0);
  assert.equal(c.days[mondays[1]].due.length, 0);
  assert.equal(c.days[mondays[1]].tx.length, 1);
});

test("Log and Skip can find a bill more than 3 weeks away", () => {
  setup([{ date: addDays(today, -60), type: "Expense", amount: 1 }]);
  const far = Object.entries(calMonth(shiftMonth(thisMonth, 2)).days).find(([, D]) => D.due.length)[0];
  const u = get("dueByKey")("r1@" + far);
  assert.equal(u.d, far);
  assert.equal(u.r.desc, "Rent");
  assert.equal(get("dueByKey")("r1@not-a-date"), null);
});

test("amounts in a day are short enough to fit", () => {
  const f = get("calAmt");
  assert.equal(f(54.2), "$54");
  assert.equal(f(2400), "$2.4K");
  assert.equal(f(12000), "$12K");
});
