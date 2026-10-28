// Tests for the shared backup format (window.__backup at the top of index.html), run with `npm test`.
// Every version (Claude, web, iOS) makes format 2 and reads format 2 plus both older files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadApp } from "./app-harness.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const storeScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function backupApi() {
  const window = { addEventListener() {}, scrollTo() {} };
  const ctx = { window, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {}, location: {}, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, Object, String, URL };
  vm.createContext(ctx);
  vm.runInContext(storeScript, ctx);
  // Results cross the sandbox boundary as JSON, so comparisons see plain objects.
  const api = window.__backup;
  return { make: (s, f) => JSON.parse(JSON.stringify(api.make(s, f))), read: (d) => JSON.parse(JSON.stringify(api.read(JSON.parse(JSON.stringify(d))))) };
}

const config = { version: 1, currency: "AUD", accounts: [{ name: "Everyday", kind: "bank", opening: 1520.05 }], categories: [{ name: "Groceries" }] };
const store = {
  "app/config": config,
  "tx/k1": { date: "2026-10-01", type: "Expense", amt: 64.9, desc: "Coles", acct: "Everyday" },
  "tx/k2": { date: "2026-10-15", type: "Income", amt: 2400, desc: "Pay", acct: "Everyday" },
  "props/p1": { firm: "Test", size: 100000 },
};

test("a format 2 backup reads back exactly, whichever version made it", () => {
  const bk = backupApi();
  for (const from of ["web", "ios", "claude"]) {
    const file = bk.make(store, from);
    assert.equal(file.app, "money-tracker");
    assert.equal(file.format, 2);
    assert.equal(file.from, from);
    assert.match(file.exported, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(bk.read(file), { store, exported: file.exported, n: 2 });
  }
});

test("an older phone or web backup (format 1) still restores", () => {
  const file = { app: "money-tracker", format: 1, exported: "2026-09-01T10:00:00.000Z", store };
  assert.deepEqual(backupApi().read(file), { store, exported: "2026-09-01T10:00:00.000Z", n: 2 });
});

test("an older backup made inside Claude still restores, keeping its ids", () => {
  const file = { app: "money-tracker", v: 1, at: "2026-08-01T09:00:00.000Z", day: "2026-08-01", currency: "AUD", config,
    tx: [{ id: "k1", ...store["tx/k1"] }, { id: "k2", ...store["tx/k2"] }], props: [{ id: "p1", ...store["props/p1"] }] };
  assert.deepEqual(backupApi().read(file), { store, exported: "2026-08-01T09:00:00.000Z", n: 2 });
});

test("a Claude backup with a missing or bad id gets a fresh one instead of being lost", () => {
  const file = { app: "money-tracker", v: 1, config, tx: [{ ...store["tx/k1"] }, { id: "../x", ...store["tx/k2"] }] };
  const r = backupApi().read(file);
  assert.equal(r.n, 2);
  const tx = Object.keys(r.store).filter((k) => k.startsWith("tx/"));
  assert.equal(tx.length, 2);
  tx.forEach((k) => assert.match(k, /^tx\/r[a-z0-9]+$/));
  assert.deepEqual(tx.map((k) => r.store[k].desc).sort(), ["Coles", "Pay"]);
});

test("a backup from a newer version asks for an update", () => {
  assert.match(backupApi().read({ app: "money-tracker", format: 3, store }).err, /newer version/);
});

test("files that aren't backups are refused", () => {
  const bk = backupApi();
  for (const f of [null, "text", [], {}, { app: "other", format: 2, store }, { app: "money-tracker", format: 2, store: { "tx/k1": store["tx/k1"] } }])
    assert.equal(bk.read(f).err, "That file isn't a Money Tracker backup.");
});

test("a backup with damaged transactions isn't used", () => {
  const bad = { ...store, "tx/k3": { date: "yesterday", type: "Expense", amt: 1 }, "tx/k4": { date: "2026-10-02", type: "Gift", amt: 1 } };
  assert.equal(backupApi().read({ app: "money-tracker", format: 2, store: bad }).err, "The backup has 2 damaged transactions, so it wasn't used.");
});

test("other paths in a backup file are ignored", () => {
  const extra = { ...store, "app/other": { x: 1 }, "tx/a/b": {}, "evil/../x": {} };
  assert.deepEqual(backupApi().read({ app: "money-tracker", format: 2, store: extra }).store, store);
});

test("the backup check knows the same transaction types as the app", () => {
  const types = JSON.parse(JSON.stringify(loadApp()("TYPES")));
  const listed = JSON.parse(storeScript.match(/const BK_TYPES=(\[[^\]]+\])/)[1]);
  assert.deepEqual(listed, types);
});
