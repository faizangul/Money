// Tests for Afterpay purchases: payments due, logging, skipping, safe to spend and what's still owed. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const S = get("S"), today = get("today")(), addDays = get("addDays");
const upcomingIn = get("upcomingIn"), dueByKey = get("dueByKey"), setSkip = get("setSkip"), bnplLeft = get("bnplLeft");
const safeCalc = get("safeCalc"), netWorth = get("netWorthAt") ;

// Shoes on Afterpay: $50 a fortnight, 3 left, next one in 2 days. Pay lands every fortnight, next in 10 days.
const shoes = (over = {}) => ({ id: "b1", name: "Shoes", amount: 50, count: 3, next: addDays(today, 2), cad: "fortnight", category: "Shopping", from: "", skipped: [], ...over });
function setup(plan = shoes(), tx = []) {
  S.cfg = { currency: "AUD", features: { bnpl: true }, accounts: [{ name: "Everyday", kind: "everyday", opening: 2000 }], categories: [{ name: "Shopping", kind: "Expense" }],
    recurring: [{ id: "p1", desc: "Pay", type: "Income", category: "Salary", account: "Everyday", amount: 2000, cadence: "fortnight", anchor: addDays(today, -4), skipped: [], pay: true }],
    bnpl: [plan] };
  S.tx = [{ id: "t0", date: addDays(today, -30), type: "Expense", amount: 1, account: "Everyday", category: "Food", desc: "x" }, ...tx];
  S.props = [];
  S.db = { doc: () => ({ set: async (c) => { S.cfg = c; } }) };
}
const pays = () => upcomingIn(addDays(today, -60), addDays(today, 120)).filter((u) => u.r.bnplId).map((u) => ({ d: u.d, key: u.key, amt: u.r.amount, desc: u.r.desc, acct: u.r.account, cat: u.r.category }));

test("only the payments left show, a fortnight apart, as Shopping from the main account", () => {
  setup();
  const p = pays();
  assert.deepEqual(JSON.parse(JSON.stringify(p.map((x) => x.d))), [addDays(today, 2), addDays(today, 16), addDays(today, 30)]);
  assert.ok(p.every((x) => x.amt === 50 && x.desc === "Afterpay · Shoes" && x.acct === "Everyday" && x.cat === "Shopping"));
  assert.equal(p[0].key, "bnpl:b1@" + addDays(today, 2));
});

test("nothing shows when Afterpay is turned off, or a plan has no payments left", () => {
  setup();
  S.cfg.features.bnpl = false;
  assert.equal(pays().length, 0);
  setup(shoes({ count: 0 }));
  assert.equal(pays().length, 0);
});

test("a logged payment drops off and comes off what's owed", () => {
  const d = addDays(today, 2);
  setup(shoes(), [{ id: "p", date: today, type: "Expense", amount: 50, account: "Everyday", category: "Shopping", desc: "Afterpay · Shoes", rec: "bnpl:b1@" + d }]);
  assert.equal(pays().length, 2);
  const left = bnplLeft(S.cfg.bnpl[0]);
  assert.equal(left.n, 2);
  assert.equal(left.owing, 100);
  assert.equal(left.next, addDays(today, 16));
  // as of yesterday, before it was logged, all three were still owed
  assert.equal(bnplLeft(S.cfg.bnpl[0], addDays(today, -1)).owing, 150);
});

test("skipping a payment saves it on the purchase", async () => {
  setup();
  const u = dueByKey("bnpl:b1@" + addDays(today, 2));
  await setSkip(u, true);
  assert.deepEqual([...S.cfg.bnpl[0].skipped], [addDays(today, 2)]);
  assert.equal(pays().length, 2);
  await setSkip(u, false);
  assert.equal(pays().length, 3);
});

test("safe to spend counts the payment due before payday, not the ones after", () => {
  setup();
  const bills = JSON.parse(JSON.stringify(safeCalc().bills));
  const ap = bills.filter((b) => b.name === "Afterpay · Shoes");
  assert.equal(ap.length, 1);
  assert.equal(ap[0].d, addDays(today, 2));
  assert.equal(ap[0].v, 50);
});

test("what's still owed shows in net worth as a debt", () => {
  setup();
  const nw = JSON.parse(JSON.stringify(netWorth(today)));
  assert.ok(nw.g.loans.some((x) => x.name === "Afterpay · Shoes" && x.v === 150));
});

test("a backup keeps Afterpay purchases", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const window = { addEventListener() {}, scrollTo() {} };
  const ctx = vm.createContext({ window, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {}, location: {}, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, Object, String, URL });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  setup();
  const back = window.__backup.read(JSON.parse(JSON.stringify(window.__backup.make({ "app/config": S.cfg }, "web"))));
  assert.equal(back.store["app/config"].bnpl[0].name, "Shoes");
});

test("Afterpay stays off for people who haven't added any", () => {
  setup();
  delete S.cfg.features.bnpl;
  S.cfg.bnpl = [];
  assert.equal(get("feat")("bnpl"), false);
  S.cfg.bnpl = [shoes()];
  assert.equal(get("feat")("bnpl"), true);
});
