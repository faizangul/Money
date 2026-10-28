// Tests for the on-device store at the top of index.html, run with `npm test`.
// The script is loaded into a fresh sandbox per "app launch"; a fake MoneyStore plugin keeps rows
// between launches the way the SQLite file does on the phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const storeScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const tick = () => new Promise((r) => setTimeout(r, 5));

function fakeLocalStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get map() { return m; },
  };
}

// Same contract as ios/App/App/MoneyStorePlugin.swift.
function fakeSqlite() {
  const docs = new Map(), kv = new Map();
  const keychain = new Map();
  const disk = { docs, kv, keychain, failNext: false, failKeychain: false, calls: [] };
  disk.call = async (plugin, method, o) => {
    if (plugin === "SecureStore") return fakeKeychain(disk, method, o);
    assert.equal(plugin, "MoneyStore");
    disk.calls.push(method);
    if (disk.failNext && method !== "load") { disk.failNext = false; throw { code: "write_failed" }; }
    if (method === "load") return { docs: [...docs].map(([p, d]) => ({ p, d })), values: Object.fromEntries(kv) };
    if (method === "write") { (o.dels || []).forEach((p) => docs.delete(p)); (o.puts || []).forEach((x) => docs.set(x.p, x.d)); return; }
    if (method === "replaceAll") { docs.clear(); if (o.clearValues) kv.clear(); o.docs.forEach((x) => docs.set(x.p, x.d)); return; }
    if (method === "setValue") { o.v == null ? kv.delete(o.k) : kv.set(o.k, o.v); return; }
    throw new Error("unknown method " + method);
  };
  return disk;
}

// Same contract as ios/App/App/SecureStorePlugin.swift.
async function fakeKeychain(disk, method, o) {
  if (disk.failKeychain && method !== "get") throw { code: "unavailable" };
  if (method === "get") return { value: disk.keychain.has(o.key) ? disk.keychain.get(o.key) : null };
  if (method === "set") { disk.keychain.set(o.key, o.value); return; }
  if (method === "remove") { disk.keychain.delete(o.key); return; }
  throw new Error("unknown method " + method);
}

function launch({ disk = null, localStorage = fakeLocalStorage() } = {}) {
  const document = { addEventListener() {}, createElement() { return {}; }, body: {} };
  const window = { addEventListener() {}, scrollTo() {} };
  if (disk) window.Capacitor = { isNativePlatform: () => true, nativePromise: disk.call };
  const ctx = { window, document, localStorage, navigator: {}, location: { protocol: "capacitor:" }, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, Object, String, Blob: class {}, File: class {}, URL };
  vm.createContext(ctx);
  vm.runInContext(storeScript, ctx);
  return { window, localStorage, use: (n) => window.claude.use(n) };
}

test("iOS: documents survive an app restart", async () => {
  const disk = fakeSqlite();
  let db = await launch({ disk }).use("db");
  await db.doc("app/config").set({ currency: "AUD", accounts: [{ id: "a1", name: "Everyday", bal: 1234.56 }] });
  const ref = await db.collection("tx").add({ amt: -42.5, desc: "Woolworths", date: "2026-10-28" });
  await db.collection("props").doc("p1").set({ firm: "Test", size: 100000 });

  db = await launch({ disk }).use("db");
  const cfg = await db.doc("app/config").get();
  assert.equal(cfg.exists, true);
  assert.deepEqual(cfg.data(), { currency: "AUD", accounts: [{ id: "a1", name: "Everyday", bal: 1234.56 }] });
  const tx = await db.collection("tx").get();
  assert.equal(tx.size, 1);
  assert.equal(tx.docs[0].id, ref.id);
  assert.deepEqual(tx.docs[0].data(), { amt: -42.5, desc: "Woolworths", date: "2026-10-28" });
  assert.equal((await db.collection("props").get()).size, 1);
});

test("iOS: update and delete are saved", async () => {
  const disk = fakeSqlite();
  let db = await launch({ disk }).use("db");
  await db.doc("tx/t1").set({ amt: 10 });
  await db.doc("tx/t2").set({ amt: 20 });
  await db.doc("tx/t1").update({ note: "lunch" });
  await db.doc("tx/t2").delete();
  await assert.rejects(db.doc("tx/missing").update({ amt: 1 }), { code: "invalid_argument" });

  db = await launch({ disk }).use("db");
  const docs = (await db.collection("tx").get()).docs;
  assert.deepEqual(docs.map((d) => [d.id, d.data()]), [["t1", { amt: 10, note: "lunch" }]]);
});

test("iOS: a collection lists only its direct documents", async () => {
  const db = await launch({ disk: fakeSqlite() }).use("db");
  await db.doc("tx/a").set({ n: 1 });
  await db.doc("tx/a/parts/x").set({ n: 2 });
  await db.doc("txx/b").set({ n: 3 });
  assert.deepEqual((await db.collection("tx").get()).docs.map((d) => d.id), ["a"]);
});

test("iOS: saved values come back exactly, including cents and text", async () => {
  const disk = fakeSqlite();
  let db = await launch({ disk }).use("db");
  const doc = { amt: 0.1 + 0.2, big: 123456789.01, neg: -0.05, desc: "Café \"Bondi\" – 50% off 🍕", tags: [], nested: { a: null } };
  await db.doc("tx/t").set(doc);
  db = await launch({ disk }).use("db");
  assert.deepEqual((await db.doc("tx/t").get()).data(), doc);
});

test("iOS: saves are written in the order they were made", async () => {
  const disk = fakeSqlite();
  const db = await launch({ disk }).use("db");
  const ref = db.doc("app/config");
  await Promise.all([ref.set({ v: 1 }), ref.set({ v: 2 }), ref.set({ v: 3 })]);
  assert.equal(JSON.parse(disk.docs.get("app/config")).v, 3);
});

test("iOS: a failed save is undone in memory and reported", async () => {
  const disk = fakeSqlite();
  const db = await launch({ disk }).use("db");
  await db.doc("tx/t").set({ amt: 1 });
  disk.failNext = true;
  await assert.rejects(db.doc("tx/t").set({ amt: 2 }), { code: "unavailable" });
  assert.deepEqual((await db.doc("tx/t").get()).data(), { amt: 1 });
  assert.equal(JSON.parse(disk.docs.get("tx/t")).amt, 1);
});

test("iOS: snapshots fire after a save", async () => {
  const db = await launch({ disk: fakeSqlite() }).use("db");
  const seen = [];
  const stop = db.collection("tx").onSnapshot((s) => seen.push(s.size));
  await tick();
  await db.collection("tx").add({ amt: 5 });
  await tick();
  stop();
  assert.deepEqual(seen, [0, 1]);
});

test("iOS: data from an earlier localStorage build moves into SQLite once", async () => {
  const disk = fakeSqlite();
  const old = { "app/config": { currency: "AUD" }, "tx/t1": { amt: -9.95 } };
  const ls = fakeLocalStorage({ "mt.store.v1": JSON.stringify(old), "mt.meta.v1": JSON.stringify({ changes: 4 }), "mt.view": "home" });
  let db = await launch({ disk, localStorage: ls }).use("db");
  assert.deepEqual((await db.doc("tx/t1").get()).data(), { amt: -9.95 });
  assert.equal(disk.docs.size, 2);
  assert.deepEqual(JSON.parse(disk.kv.get("meta")), { changes: 4 });
  assert.equal(ls.getItem("mt.store.v1"), null);
  assert.equal(ls.getItem("mt.view"), "home"); // small UI settings stay put

  db = await launch({ disk, localStorage: ls }).use("db");
  assert.equal((await db.collection("tx").get()).size, 1);
});

test("iOS: existing SQLite data is never overwritten by old localStorage", async () => {
  const disk = fakeSqlite();
  disk.docs.set("tx/new", JSON.stringify({ amt: 1 }));
  const ls = fakeLocalStorage({ "mt.store.v1": JSON.stringify({ "tx/old": { amt: 2 } }) });
  const db = await launch({ disk, localStorage: ls }).use("db");
  assert.deepEqual((await db.collection("tx").get()).docs.map((d) => d.id), ["new"]);
});

test("iOS: erase all removes everything from SQLite", async () => {
  const disk = fakeSqlite();
  const app = launch({ disk });
  const db = await app.use("db");
  await db.doc("app/config").set({ currency: "AUD" });
  await db.doc("tx/t").set({ amt: 1 });
  assert.equal(await app.window.__mt.eraseAll(), true);
  assert.equal(disk.docs.size, 0);
  assert.deepEqual(JSON.parse(disk.kv.get("meta")), {});
  const db2 = await launch({ disk }).use("db");
  assert.equal((await db2.doc("app/config").get()).exists, false);
});

test("iOS: if SQLite can't be opened the app gets no database", async () => {
  const disk = fakeSqlite();
  disk.call = async () => { throw { code: "load_failed" }; };
  assert.equal(await launch({ disk }).use("db"), null);
});

test("browser: still uses localStorage and survives a reload", async () => {
  const ls = fakeLocalStorage();
  let db = await launch({ localStorage: ls }).use("db");
  await db.doc("tx/t").set({ amt: 3.3 });
  assert.deepEqual(JSON.parse(ls.getItem("mt.store.v1")), { "tx/t": { amt: 3.3 } });
  db = await launch({ localStorage: ls }).use("db");
  assert.deepEqual((await db.doc("tx/t").get()).data(), { amt: 3.3 });
});

const PIN = JSON.stringify({ h: "abc123", salt: "s1", after: 60 });

test("iOS: the PIN is kept in the Keychain and survives a restart", async () => {
  const disk = fakeSqlite();
  const ls = fakeLocalStorage();
  let app = launch({ disk, localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pin"), null);
  await app.window.__mt.secret.set("mt.pin", PIN);
  assert.equal(disk.keychain.get("mt.pin"), PIN);
  assert.equal(ls.getItem("mt.pin"), null);

  app = launch({ disk, localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pin"), PIN);
  await app.window.__mt.secret.set("mt.pin", null);
  assert.equal(disk.keychain.has("mt.pin"), false);
});

test("iOS: a PIN from an earlier localStorage build moves into the Keychain", async () => {
  const disk = fakeSqlite();
  const tries = JSON.stringify({ tries: 2, until: 0, level: 0 });
  const ls = fakeLocalStorage({ "mt.pin": PIN, "mt.pintries": tries, "mt.look": "{}" });
  const app = launch({ disk, localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pin"), PIN);
  assert.equal(disk.keychain.get("mt.pin"), PIN);
  assert.equal(disk.keychain.get("mt.pintries"), tries);
  assert.equal(ls.getItem("mt.pin"), null);
  assert.equal(ls.getItem("mt.pintries"), null);
  assert.equal(ls.getItem("mt.look"), "{}");
});

test("iOS: the Keychain PIN wins over a stale localStorage copy", async () => {
  const disk = fakeSqlite();
  disk.keychain.set("mt.pin", PIN);
  const ls = fakeLocalStorage({ "mt.pin": JSON.stringify({ h: "old", salt: "x", after: 0 }) });
  const app = launch({ disk, localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pin"), PIN);
  assert.equal(ls.getItem("mt.pin"), null);
});

test("iOS: if the Keychain can't save, the PIN isn't changed", async () => {
  const disk = fakeSqlite();
  disk.keychain.set("mt.pin", PIN);
  const app = launch({ disk });
  await app.window.__mt.ready;
  disk.failKeychain = true;
  await assert.rejects(app.window.__mt.secret.set("mt.pin", null));
  assert.equal(app.window.__mt.secret.get("mt.pin"), PIN);
  assert.equal(disk.keychain.get("mt.pin"), PIN);
});

test("iOS: the database isn't handed out before the PIN settings are loaded", async () => {
  const disk = fakeSqlite();
  disk.keychain.set("mt.pin", PIN);
  const app = launch({ disk });
  let pinLoaded = false;
  app.window.__mt.ready.then(() => { pinLoaded = app.window.__mt.secret.get("mt.pin") === PIN; });
  await app.use("db");
  assert.equal(pinLoaded, true);
});

test("iOS: erasing all data keeps the PIN (only Forgot PIN removes it)", async () => {
  const disk = fakeSqlite();
  disk.keychain.set("mt.pin", PIN);
  const app = launch({ disk });
  await app.use("db");
  await app.window.__mt.eraseAll();
  assert.equal(disk.keychain.get("mt.pin"), PIN);
});

test("browser: the PIN stays in localStorage", async () => {
  const ls = fakeLocalStorage({ "mt.pin": PIN });
  let app = launch({ localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pin"), PIN);
  await app.window.__mt.secret.set("mt.pintries", "{}");
  assert.equal(ls.getItem("mt.pintries"), "{}");
  app = launch({ localStorage: ls });
  await app.window.__mt.ready;
  assert.equal(app.window.__mt.secret.get("mt.pintries"), "{}");
});
