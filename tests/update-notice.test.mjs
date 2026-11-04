// The "Update ready" message compares a number in index.html with the one in sw.js.
// If a release raises one and not the other, people get a false message or none at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("index.html BUILD matches the cache number in sw.js", () => {
  const build = /const BUILD=(\d+);/.exec(read("index.html"));
  const cache = /const CACHE="money-tracker-v(\d+)";/.exec(read("sw.js"));
  assert.ok(build, "BUILD not found in index.html");
  assert.ok(cache, "CACHE not found in sw.js");
  assert.equal(build[1], cache[1]);
});

test("the page never reloads without a tap", () => {
  const html = read("index.html");
  const start = html.indexOf("const offerUpdate=");
  const block = html.slice(start, html.indexOf("</script>", start));
  const reloads = block.split("\n").filter((line) => line.includes("location.reload()"));
  assert.equal(reloads.length, 1, "expected one reload, on the Refresh button");
  assert.ok(reloads[0].includes('.querySelector(".go").onclick'), "the reload should only be on the Refresh button");
});
