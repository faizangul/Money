// Tests for moving one bill or pay to another day without changing the rest. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), today = get("today")(), addDays = get("addDays");
const upcomingIn = get("upcomingIn"), dueByKey = get("dueByKey"), setMove = get("setMove"), setSkip = get("setSkip");
const moveRange = get("moveRange"), nextPayDate = get("nextPayDate"), payDates = get("payDates"), safeCalc = get("safeCalc");
const reminderPlan = get("reminderPlan"), backup = get("window.__backup");

// Rent weekly from a week ago (so it's due today, +7, +14...), pay fortnightly from 3 days ago (due +11, +25...).
const rentDay = addDays(today, 7), payDay = addDays(today, 11);
function setup(moved = {}, payMoved) {
  S.cfg = { currency: "AUD", accounts: [{ name: "Everyday", kind: "everyday", opening: 3000 }], categories: [],
    recurring: [
      { id: "r1", desc: "Rent", type: "Expense", category: "Rent", account: "Everyday", amount: 500, cadence: "week", anchor: addDays(today, -7), skipped: [], moved, remind: { on: true, before: 1, time: "08:00" } },
      { id: "p1", desc: "Pay", type: "Income", category: "Salary", account: "Everyday", amount: 2000, cadence: "fortnight", anchor: addDays(today, -3), skipped: [], pay: true, ...(payMoved ? { moved: payMoved } : {}) },
    ] };
  S.tx = [{ id: "t0", date: addDays(today, -30), type: "Expense", amount: 1, account: "Everyday", category: "Food", desc: "x" }];
  S.props = [];
  S.db = { doc: () => ({ set: async (c) => { S.cfg = c; } }) };
}
const rents = (from, to) => upcomingIn(from, to).filter((u) => u.r.id === "r1").map((u) => ({ d: u.d, key: u.key }));

test("a moved bill shows on its new day only, keeping its usual key", () => {
  setup({ [rentDay]: addDays(rentDay, 3) });
  const list = rents(today, addDays(today, 20));
  assert.ok(!list.some((u) => u.d === rentDay));
  const m = list.find((u) => u.d === addDays(rentDay, 3));
  assert.equal(m.key, "r1@" + rentDay);
  assert.equal(list.length, 3); // today, moved one, +14
});

test("a bill moved into or out of a date window follows its new day", () => {
  setup({ [rentDay]: addDays(rentDay, -3) });
  assert.equal(rents(addDays(rentDay, -3), addDays(rentDay, -3)).length, 1);
  assert.equal(rents(rentDay, rentDay).length, 0);
  assert.equal(dueByKey("r1@" + rentDay).d, addDays(rentDay, -3));
});

test("logging with the usual key clears a moved bill", () => {
  setup({ [rentDay]: addDays(rentDay, 2) });
  S.tx = [...S.tx, { id: "paid", date: addDays(rentDay, 2), type: "Expense", amount: 500, account: "Everyday", category: "Rent", rec: "r1@" + rentDay }];
  assert.ok(!rents(today, addDays(today, 20)).some((u) => u.key === "r1@" + rentDay));
});

test("skipping a moved bill saves its usual date, and undo brings it back", async () => {
  setup({ [rentDay]: addDays(rentDay, 2) });
  const u = dueByKey("r1@" + rentDay);
  await setSkip(u, true);
  assert.deepEqual([...S.cfg.recurring[0].skipped], [rentDay]);
  assert.equal(dueByKey("r1@" + rentDay), undefined);
  await setSkip(u, false);
  assert.equal(dueByKey("r1@" + rentDay).d, addDays(rentDay, 2));
});

test("setMove sets, changes back, and tidies up", async () => {
  setup();
  delete S.cfg.recurring[0].moved;
  await setMove(dueByKey("r1@" + rentDay), addDays(rentDay, 1));
  assert.equal(S.cfg.recurring[0].moved[rentDay], addDays(rentDay, 1));
  await setMove(dueByKey("r1@" + rentDay), rentDay); // picking the usual day again
  assert.equal(S.cfg.recurring[0].moved, undefined);
  assert.equal(S.cfg.recurring[1].moved, undefined); // other items untouched
});

test("a move stays between the one before and the one after", () => {
  setup();
  const r = moveRange(S.cfg.recurring[0], rentDay);
  assert.equal(r.min, addDays(today, 1)); // also never before today
  assert.equal(r.max, addDays(rentDay, 6));
});

test("a bill moved past payday drops out of safe to spend", () => {
  setup();
  const before = safeCalc();
  setup({ [rentDay]: addDays(payDay, 2) });
  const after = safeCalc();
  const names = (x) => JSON.stringify(x.bills.map((b) => b.d));
  assert.ok(names(before).includes(rentDay));
  assert.ok(!names(after).includes(rentDay) && !names(after).includes(addDays(payDay, 2)));
  assert.equal(before.bills.length - 1, after.bills.length);
});

test("a moved pay changes the next pay day and the safe-to-spend end", () => {
  setup({}, { [payDay]: addDays(payDay, -2) });
  assert.equal(nextPayDate(), addDays(payDay, -2));
  assert.equal(payDates(today, addDays(today, 30))[0], addDays(payDay, -2));
});

test("the reminder goes out before the new day", () => {
  setup({ [rentDay]: addDays(rentDay, 3) });
  const items = JSON.parse(JSON.stringify(reminderPlan(S.cfg, today, "00:00", false))).items;
  const it = items.find((x) => x.id === "r1@" + rentDay);
  assert.equal(it.at, addDays(rentDay, 2) + "T08:00");
});

// The backup format lives in the first script on the page; load it on its own, as backup.test.mjs does.
function backupApi() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const window = { addEventListener() {}, scrollTo() {} };
  const ctx = vm.createContext({ window, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {}, location: {}, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, Object, String, URL });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return window.__backup;
}

test("a backup keeps moved dates", () => {
  const backup = backupApi();
  setup({ [rentDay]: addDays(rentDay, 3) });
  const made = backup.make({ "app/config": S.cfg }, "web");
  const back = backup.read(JSON.parse(JSON.stringify(made)));
  assert.equal(back.store["app/config"].recurring[0].moved[rentDay], addDays(rentDay, 3));
});
