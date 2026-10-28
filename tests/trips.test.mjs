// Tests for trip mode: which expenses go to a trip, and its totals. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), today = get("today")(), addDays = get("addDays");
const plain = (x) => JSON.parse(JSON.stringify(x));
const txTrip = get("txTrip"), tripStats = (tr) => plain(get("tripStats")(tr)), tripErr = get("tripErr");

// A 10-day trip that started 2 days ago (so today is day 3), and a new copy of the data each time.
const trip = { id: "trip1", name: "Japan trip", start: addDays(today, -2), end: addDays(today, 7), budget: 4000 };
function setup(tx = [], trips = [trip]) {
  S.cfg = { currency: "AUD", accounts: [{ name: "Everyday", kind: "everyday" }], categories: [], recurring: [], trips };
  S.tx = tx.map((t, i) => ({ id: "t" + i, account: "Everyday", category: "Food", desc: "x", type: "Expense", ...t }));
  S.props = [];
}

test("a new expense dated in a trip goes to it unless unticked", () => {
  setup();
  assert.equal(txTrip({ type: "Expense", date: today }), "trip1");
  assert.equal(txTrip({ type: "Expense", date: today, trip: false }), null);
  assert.equal(txTrip({ type: "Expense", date: addDays(today, 30) }), null);
  assert.equal(txTrip({ type: "Income", date: today }), null);
  assert.equal(txTrip({ type: "Transfer", date: today }), null);
});

test("editing an older expense only adds it to a trip when ticked", () => {
  setup();
  assert.equal(txTrip({ id: "t9", type: "Expense", date: today }), null);
  assert.equal(txTrip({ id: "t9", type: "Expense", date: today, trip: "trip1" }), "trip1");
});

test("moving a tagged expense outside the trip's dates takes it off the trip", () => {
  setup();
  assert.equal(txTrip({ id: "t9", type: "Expense", date: addDays(today, 30), trip: "trip1" }), null);
});

test("trip totals: spent, by category, per day and what's left a day", () => {
  setup([
    { date: trip.start, amount: 300, category: "Hotel", trip: "trip1" },
    { date: addDays(trip.start, 1), amount: 120, category: "Food", trip: "trip1" },
    { date: today, amount: 30, category: "Food", trip: "trip1" },
    { date: today, amount: -10, category: "Food", trip: "trip1" }, // refund
    { date: today, amount: 999, category: "Rent" }, // not on the trip
    { date: today, type: "Income", amount: 50, category: "Pay", trip: "trip1" }, // only expenses count
  ]);
  const st = tripStats(trip);
  assert.equal(st.state, "on");
  assert.equal(st.spent, 440);
  assert.deepEqual(st.byCat, { Hotel: 300, Food: 140 });
  assert.equal(st.days, 10);
  assert.equal(st.gone, 3);
  assert.equal(st.left, 8); // today plus the 7 days after it
  assert.equal(st.perDay, 146.67);
  assert.equal(st.remain, 3560);
  assert.equal(st.perDayLeft, 445);
  assert.equal(st.tx.length, 4);
});

test("an upcoming trip and a finished one", () => {
  const soon = { id: "s", name: "Soon", start: addDays(today, 10), end: addDays(today, 12), budget: 900 };
  const done = { id: "d", name: "Done", start: addDays(today, -20), end: addDays(today, -16), budget: 0 };
  setup([{ date: done.start, amount: 50, trip: "d" }], [soon, done]);
  assert.deepEqual([tripStats(soon).state, tripStats(soon).gone, tripStats(soon).left, tripStats(soon).perDayLeft], ["soon", 0, 3, 300]);
  const d = tripStats(done);
  assert.deepEqual([d.state, d.gone, d.left, d.perDay, d.remain, d.perDayLeft], ["done", 5, 0, 10, null, null]);
});

test("a going-over budget has nothing left a day", () => {
  setup([{ date: today, amount: 4500, trip: "trip1" }]);
  const st = tripStats(trip);
  assert.equal(st.remain, -500);
  assert.equal(st.perDayLeft, 0);
});

test("a new trip needs a name, real dates in order, a sensible budget and no overlap", () => {
  setup();
  const list = [trip];
  const later = addDays(today, 20), after = addDays(today, 25);
  assert.equal(tripErr("Bali", later, after, 0, list), "");
  assert.match(tripErr("", later, after, 0, list), /name/);
  assert.match(tripErr("Bali", "", after, 0, list), /both dates/);
  assert.match(tripErr("Bali", after, later, 0, list), /end on or after/);
  assert.match(tripErr("Bali", later, after, NaN, list), /amount/);
  assert.match(tripErr("Bali", later, after, -5, list), /amount/);
  assert.match(tripErr("Bali", today, after, 0, list), /overlap/);
  assert.match(tripErr("Bali", trip.end, after, 0, list), /overlap/);
});
