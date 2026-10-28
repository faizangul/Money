// Tests for reminderPlan(): which phone notifications the reminder settings produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const reminderPlan = loadApp()("reminderPlan");
const T = "2026-10-28"; // a Wednesday

const rent = (over = {}) => ({ id: "r2", desc: "Rent", type: "Expense", amount: 520, cadence: "week", anchor: "2026-09-07", skipped: [], remind: { on: true, before: 1, time: "08:00" }, ...over });
// Plain copies: lists made inside the app script fail strict comparisons with lists made here.
const plan = (cfg, hm = "12:00", hide = false) => JSON.parse(JSON.stringify(reminderPlan(cfg, T, hm, hide)));

test("a weekly bill reminds the day before at the chosen time, for the next 60 days", () => {
  const { items, daily } = plan({ recurring: [rent()] });
  assert.equal(daily, null);
  // Rent is due Mondays; reminders go out on Sundays at 8am.
  assert.equal(items[0].at, "2026-11-01T08:00");
  assert.equal(items[0].id, "r2@2026-11-02");
  assert.match(items[0].title, /^Rent \(.*520\.00\) is due tomorrow$/);
  assert.ok(items.every((x) => x.at.endsWith("T08:00")));
  assert.ok(items.every((x) => x.at.slice(0, 10) <= "2026-12-27"));
  assert.equal(items.length, 9);
});

test("past dates and skipped bills get no reminder", () => {
  const { items } = plan({ recurring: [rent({ skipped: ["2026-11-09"] })] });
  assert.ok(items.every((x) => x.at > "2026-10-28T12:00"));
  assert.ok(!items.some((x) => x.id === "r2@2026-11-09"));
});

test("a reminder for later today is kept, one earlier today is not", () => {
  const due = rent({ cadence: "month", anchor: "2026-10-28", remind: { on: true, before: 0, time: "18:00" } });
  assert.equal(plan({ recurring: [due] }, "09:00").items[0].at, "2026-10-28T18:00");
  assert.equal(plan({ recurring: [due] }, "19:00").items[0].at, "2026-11-28T18:00");
});

test("bills with reminders off are left out", () => {
  assert.deepEqual(plan({ recurring: [rent({ remind: { on: false } })] }).items, []);
  assert.deepEqual(plan({}).items, []);
});

test("amounts are left off when hidden (PIN lock on)", () => {
  const { items } = plan({ recurring: [rent()] }, "12:00", true);
  assert.equal(items[0].title, "Rent is due tomorrow");
});

test("income says it lands, and 2+ days before says so", () => {
  const pay = rent({ desc: "Salary", type: "Income", amount: 0, cadence: "fortnight", anchor: "2026-10-22", remind: { on: true, before: 2, time: "09:00" } });
  const first = plan({ recurring: [pay] }).items[0];
  assert.equal(first.title, "Salary lands in 2 days");
  assert.equal(first.at, "2026-11-03T09:00");
});

test("credit card due dates remind 2 days before, even in short months", () => {
  const card = { name: "AMEX", kind: "credit", dueDay: 31, remindDue: true };
  const ats = plan({ accounts: [card] }).items.map((x) => x.at);
  // Due on the 31st, or the last day of shorter months (30 Nov). 31 Dec's reminder is past the 60 days.
  assert.deepEqual(ats, ["2026-10-29T09:00", "2026-11-28T09:00"]);
});

test("payday check goes out on each payday", () => {
  const pay = { id: "r1", desc: "Salary", type: "Income", amount: 2760, cadence: "fortnight", anchor: "2026-10-22", pay: true };
  const { items } = plan({ recurring: [pay], nudges: { payCal: true, payTime: "18:00" } });
  assert.deepEqual(items.slice(0, 2).map((x) => x.at), ["2026-11-05T18:00", "2026-11-19T18:00"]);
});

test("the daily check-in repeats by itself and leaves room under iOS's limit", () => {
  const daily = rent({ cadence: "week", anchor: "2026-10-26", remind: { on: true, before: 0, time: "07:00" } });
  const many = Array.from({ length: 10 }, (_, i) => ({ ...daily, id: "b" + i }));
  const { items, daily: d } = plan({ recurring: many, nudges: { cal: true, calTime: "20:00" } });
  assert.deepEqual(d, { id: "daily-checkin", title: "Add today's spending", body: "Open Money Tracker and log anything you bought today.", time: "20:00" });
  assert.equal(items.length, 59);
  assert.deepEqual(items.map((x) => x.at), [...items.map((x) => x.at)].sort());
});
