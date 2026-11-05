// Every theme has to work in light and dark, and stay readable: this app shows people their money.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const list = /const PALETTES=(\[\[.*?\]\]);/.exec(html);
const palettes = JSON.parse(list[1]);

// Palette rules can be split over several lines, so gather all of a theme's values.
function vars(pal, scheme) {
  const out = {};
  const re = new RegExp(`:root\\[data-pal="${pal}"\\]\\[data-scheme="${scheme}"\\]\\{([^}]*)\\}`, "g");
  for (const m of html.matchAll(re)) for (const d of m[1].split(";")) {
    const [k, v] = d.split(":");
    if (k && k.startsWith("--")) out[k] = v.trim();
  }
  return out;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const REQUIRED = ["--bg", "--surface", "--sunk", "--ink", "--muted", "--line", "--accent", "--accent-ink", "--accent-soft", "--pos", "--neg", "--neg-soft", "--warn", "--warn-soft", "--c2", "--c3", "--c4"];
// Text on its background needs 4.5:1, the usual accessibility standard.
const TEXT = [["--ink", "--bg"], ["--ink", "--surface"], ["--muted", "--surface"], ["--accent-ink", "--accent"], ["--accent", "--surface"], ["--pos", "--surface"], ["--neg", "--surface"], ["--warn", "--surface"], ["--ink", "--accent-soft"], ["--ink", "--neg-soft"], ["--ink", "--warn-soft"]];

test("there are 10 themes with different names and colours", () => {
  assert.equal(palettes.length, 10);
  assert.equal(new Set(palettes.map((p) => p[0])).size, 10);
  assert.equal(new Set(palettes.map((p) => p[1])).size, 10);
  assert.equal(new Set(palettes.map((p) => p[2])).size, 10);
});

for (const [key, name] of palettes) for (const scheme of ["light", "dark"]) {
  test(`${name} ${scheme} is complete and readable`, () => {
    const v = vars(key, scheme);
    for (const r of REQUIRED) assert.ok(v[r], `${r} is missing`);
    for (const [fg, bg] of TEXT) {
      const c = contrast(v[fg], v[bg]);
      assert.ok(c >= 4.5, `${fg} on ${bg} is only ${c.toFixed(2)}:1`);
    }
  });

  test(`${name} ${scheme}: warnings don't look like the theme colour`, () => {
    const v = vars(key, scheme);
    assert.notEqual(v["--neg"].toUpperCase(), v["--accent"].toUpperCase());
    assert.notEqual(v["--warn"].toUpperCase(), v["--accent"].toUpperCase());
  });
}

test("an unknown theme falls back instead of breaking", () => {
  assert.match(html, /PALETTES\.some\(p=>p\[0\]===look\.palette\)\?look\.palette:"eucalyptus"/);
});
