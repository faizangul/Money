// Tests for renaming a category: every saved reference follows, and money totals don't change. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const plain = (x) => JSON.parse(JSON.stringify(x));
const S = get("S"), today = get("today")(), ym = get("ym");
const check = (raw, from, list) => plain(get("renameCatCheck")(raw, from, list));
const list = [{ name: "Pets", kind: "Expense" }, { name: "Salary", kind: "Income" }, { name: "Loan repayment", kind: "Expense", role: "loan" }];

function cfg() {
  return {
    currency: "AUD", accounts: [{ name: "Everyday", kind: "everyday", opening: 100 }, { name: "Super", kind: "super", sgCat: "Pets" }],
    categories: [{ name: "Pets", kind: "Expense", budget: 50, essential: true }, { name: "Food", kind: "Expense", budget: 200 }, { name: "Bank fees", kind: "Expense", budget: 0 }, { name: "Interest", kind: "Income", budget: 0 }],
    recurring: [{ id: "r1", desc: "Vet plan", type: "Expense", category: "Pets", account: "Everyday", amount: 10 }, { id: "r2", desc: "Woolies", type: "Expense", category: "Food", account: "Everyday", amount: 5 }],
    goals: [{ id: "g1", name: "Dog", cat: "Pets" }], doneGoals: [{ id: "g0", name: "Cat", cat: "Pets" }], taxCats: ["Pets", "Food"],
    impRules: { "vet|o": "E|Pets", "woolies|o": "E|Food", "x|i": "I|Pets" }, loans: [], trips: [],
  };
}
function setup() {
  S.cfg = cfg(); S.draft = null; S.draftDirty = false; S.props = [];
  S.tx = [
    { id: "a", date: today, account: "Everyday", type: "Expense", category: "Pets", desc: "Vet", amount: 40, created: 1 },
    { id: "b", date: today, account: "Everyday", type: "Expense", category: "Food", desc: "Coles", amount: 25, created: 2 },
    { id: "c", date: today, account: "Everyday", type: "Transfer", category: "Transfer", desc: "", amount: 5, to: "Super", created: 3 },
  ];
}
// A stand-in store that applies writes to S the way the real snapshots do.
function fakeDb(batch) {
  const apply = (p, d) => {
    if (p === "app/config") S.cfg = plain(d);
    else { const id = p.split("/")[1]; S.tx = S.tx.map((t) => (t.id === id ? { id, ...plain(d) } : t)); }
  };
  const calls = [];
  const db = { doc: (p) => ({ set: async (d) => { calls.push(p); apply(p, d); } }), calls };
  db.batch = batch ? async (l) => { calls.push("batch:" + l.length); l.forEach(([p, d]) => apply(p, d)); } : null;
  return db;
}

test("the name is tidied, and an unchanged name does nothing", () => {
  assert.deepEqual(check("  Pet   care ", "Pets", list), { name: "Pet care" });
  assert.deepEqual(check("Pets", "Pets", list), { same: true });
  assert.deepEqual(check("pets", "Pets", list), { name: "pets" }); // fixing capitals is allowed
});

test("empty, taken and reserved names are refused", () => {
  assert.ok(check("  ", "Pets", list).err);
  assert.match(check("salary", "Pets", list).err, /already an income/);
  assert.match(check("LOAN repayment", "Pets", list).err, /already have/);
  assert.ok(check("Transfer", "Pets", list).err);
  assert.ok(check("Lending & IOUs", "Pets", list).err);
});

test("categories the app relies on can't be renamed", () => {
  assert.match(check("Debt", "Loan repayment", list).err, /can't be renamed/);
});

test("every saved setting follows the new name, and nothing else moves", () => {
  const c = plain(get("renameCatIn")(cfg(), "Pets", "Pet care"));
  assert.deepEqual(c.categories[0], { name: "Pet care", kind: "Expense", budget: 50, essential: true });
  assert.equal(c.recurring[0].category, "Pet care");
  assert.equal(c.recurring[1].category, "Food");
  assert.equal(c.goals[0].cat, "Pet care");
  assert.equal(c.doneGoals[0].cat, "Pet care");
  assert.equal(c.accounts[1].sgCat, "Pet care");
  assert.deepEqual(c.taxCats, ["Pet care", "Food"]);
  assert.deepEqual(c.impRules, { "vet|o": "E|Pet care", "woolies|o": "E|Food", "x|i": "I|Pet care" });
});

for (const batch of [true, false]) {
  test(`renaming keeps every total (${batch ? "saved together" : "saved one at a time"})`, async () => {
    setup();
    const before = plain(get("monthStats")(ym(today))), bal = plain(get("balances")());
    S.db = fakeDb(batch);
    await get("renameCategory")("Pets", "Pet care");
    assert.equal(S.tx.find((t) => t.id === "a").category, "Pet care");
    assert.equal(S.tx.find((t) => t.id === "b").category, "Food");
    assert.equal(S.tx.find((t) => t.id === "c").category, "Transfer");
    assert.equal(S.tx.some((t) => t.category === "Pets"), false);
    assert.equal(S.cfg.catRen, undefined);
    const after = plain(get("monthStats")(ym(today)));
    assert.equal(after.byCat["Pet care"], before.byCat.Pets);
    assert.equal(after.bud["Pet care"], before.bud.Pets);
    for (const k of Object.keys(before)) if (typeof before[k] === "number") assert.equal(after[k], before[k], k);
    assert.deepEqual(plain(get("balances")()), bal);
    if (batch) assert.deepEqual(S.db.calls, ["batch:2"]); // settings and the one transaction, in one save
  });
}

test("a rename interrupted part-way finishes on the next start", async () => {
  setup();
  S.db = fakeDb(false);
  S.cfg = plain(get("renameCatIn")(cfg(), "Pets", "Pet care"));
  S.cfg.catRen = { from: "Pets", to: "Pet care" }; // settings saved, transactions not yet
  await get("resumeCatRename")();
  assert.equal(S.tx.find((t) => t.id === "a").category, "Pet care");
  assert.equal(S.cfg.catRen, undefined);
});

test("an unsaved Settings draft follows the rename, so saving it can't undo it", async () => {
  setup();
  S.db = fakeDb(true);
  S.draft = plain(cfg());
  S.draft.categories[0]._orig = "Pets";
  await get("renameCategory")("Pets", "Pet care");
  assert.equal(S.draft.categories[0].name, "Pet care");
  assert.equal(S.draft.categories[0]._orig, "Pet care");
  assert.equal(S.draft.recurring[0].category, "Pet care");
  S.draft = null;
});

test("features that find a category by its wording still find it after a rename", async () => {
  setup();
  S.db = fakeDb(true);
  await get("renameCategory")("Bank fees", "Charges");
  assert.equal(get("feeCat")(), "Charges");
  await get("renameCategory")("Charges", "Costs");
  assert.equal(get("feeCat")(), "Costs");
  await get("renameCategory")("Interest", "Earnings");
  assert.equal(get("intCat")(), "Earnings");
  assert.deepEqual(plain(S.cfg.categories.find((c) => c.name === "Earnings")).aka, "Interest");
});

test("the wording memory is only kept when it matters", () => {
  const c = plain(get("renameCatIn")(cfg(), "Pets", "Pet care"));
  assert.equal(c.categories[0].aka, undefined);
});
