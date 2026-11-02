// Tests for adding a category while logging a transaction, and for double-tap protection. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const check = (name, kind, list = []) => JSON.parse(JSON.stringify(get("newCatCheck")(name, kind, list)));
const list = [{ name: "Groceries", kind: "Expense" }, { name: "Salary", kind: "Income" }];

test("a new name is accepted, tidied of extra spaces", () => {
  assert.deepEqual(check("  Pet   food ", "Expense", list), { name: "Pet food" });
});

test("an empty name asks for one", () => {
  assert.ok(check("   ", "Expense", list).err);
  assert.ok(check(null, "Expense", list).err);
});

test("the same name in any capitals picks the existing category of that kind", () => {
  assert.deepEqual(check("groceries", "Expense", list), { existing: "Groceries" });
});

test("a name used by the other kind is refused, as Settings needs names to be unique", () => {
  assert.match(check("SALARY", "Expense", list).err, /already an income category/);
  assert.match(check("groceries", "Income", list).err, /already a spending category/);
});

test("names the app keeps for transfers and IOUs are refused", () => {
  assert.ok(check("Transfer", "Expense", list).err);
  assert.ok(check("lending & ious", "Income", list).err);
});

function picker(F, cats) {
  get("S").cfg = { categories: cats };
  return get("(F=" + JSON.stringify(F) + ",catPicker(cats().filter(c=>c.kind===F.type).map(c=>c.name)))");
}

test("the category step always offers + New category", () => {
  const h = picker({ type: "Expense", category: "" }, list);
  assert.match(h, /Groceries/);
  assert.match(h, /data-act="catnew"/);
  assert.doesNotMatch(h, /id="fnewcat"/);
});

test("with no categories of that kind, the name box is shown straight away", () => {
  const h = picker({ type: "Income", category: "" }, [{ name: "Groceries", kind: "Expense" }]);
  assert.match(h, /id="fnewcat"/);
  assert.match(h, /New income category/);
  assert.doesNotMatch(h, /Cancel/);
});

test("a name with odd characters can't break out of the box", () => {
  const h = picker({ type: "Expense", category: "", newCat: '"><img src=x>' }, list);
  assert.doesNotMatch(h, /<img/);
});

test("a second save while the first is running is ignored; after it ends, saving works again", async () => {
  const once = get("once");
  let runs = 0, finish;
  const save = () => { runs++; return new Promise((r) => { finish = r; }); };
  const first = once("t", save);
  assert.equal(once("t", save), undefined);
  assert.equal(runs, 1);
  finish();
  await first;
  const again = once("t", save);
  assert.equal(runs, 2);
  finish();
  await again;
});

test("a failed save doesn't block the next try", async () => {
  const once = get("once");
  await assert.rejects(once("f", async () => { throw new Error("full"); }));
  let ran = false;
  await once("f", async () => { ran = true; });
  assert.equal(ran, true);
});
