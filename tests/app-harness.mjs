// Loads the main app script from index.html into a stand-in browser, so its functions can be tested
// directly: const get = loadApp(); const reminderPlan = get("reminderPlan");
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("async function boot()"));

class Observer { observe() {} unobserve() {} disconnect() {} }
// Every DOM access returns this, so drawing code runs without a page. The storage bridge (window.__mt) is
// left undefined, as in a plain browser tab with no on-device store.
const any = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" || k === "__mt" ? undefined : any),
  apply: () => any, construct: () => any, set: () => true,
});

export function loadApp() {
  const ctx = vm.createContext({
    console, Math, JSON, Date, Intl, Object, Array, String, Number, Promise, Set, Map, URL,
    setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
    window: any, document: any, navigator: any, location: any, matchMedia: any, getComputedStyle: any,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
  });
  // Replace the start-up call with a way to read any function or value from inside the script.
  const code = main.replace(/\nboot\(\);\s*\}\)\(\);\s*$/, "\nglobalThis.__get=n=>eval(n);})();");
  if (code === main) throw new Error("Couldn't find boot() at the end of the app script");
  vm.runInContext(code, ctx);
  return (name) => ctx.__get(name);
}
