// People with low vision rely on pinch-to-zoom, so nothing should switch it off by accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the viewport doesn't disable zoom", () => {
  const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)[1];
  assert.doesNotMatch(viewport, /user-scalable|maximum-scale/);
});

test("the main scrolling areas keep pinch-zoom", () => {
  for (const sel of [".wrap", ".chips,.slides,.scrollx", ".swipe-fg"]) {
    // A selector can have several rules, so look only at the ones that set touch-action.
    const rules = html.split("\n").filter((line) => line.startsWith(`${sel}{`) && line.includes("touch-action"));
    assert.ok(rules.length > 0, `${sel} touch-action rule not found`);
    for (const rule of rules) assert.match(rule, /touch-action:[^;}]*pinch-zoom/, `${sel} should allow pinch-zoom`);
  }
});

test("hover styles don't get stuck on touch screens", () => {
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n").replace(/@font-face\{[^}]*\}/g, "");
  for (const line of css.split("\n")) {
    if (line.includes(":hover")) assert.match(line, /@media \(hover:hover\)/, `ungated hover: ${line.slice(0, 80)}`);
  }
});
