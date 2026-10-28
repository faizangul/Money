// Tests for bank badges (name and colour, no logos), run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const get = loadApp();
const bankOf = (a) => JSON.parse(JSON.stringify(get("bankOf")(a)));
const badge = get("bankBadge");

test("a bank typed on the account is matched however it's written", () => {
  for (const t of ["CommBank", "cba", "Commonwealth Bank", "COMMBANK "]) assert.equal(bankOf({ name: "Spending", bank: t }).n, "CommBank");
  assert.equal(bankOf({ name: "x", bank: "St George" }).n, "St.George");
  assert.equal(bankOf({ name: "x", bank: "National Australia Bank" }).n, "NAB");
  assert.equal(bankOf({ name: "x", bank: "Up" }).n, "Up");
});

test("with no bank typed, the account name is used, but never for common words", () => {
  assert.equal(bankOf({ name: "CBA Everyday", bank: "" }).n, "CommBank");
  assert.equal(bankOf({ name: "ING Savings Maximiser" }).n, "ING");
  for (const name of ["Up", "Top up", "Wise spending", "Savings", "Everyday", "Saving for trip"]) assert.equal(bankOf({ name }), null, name);
});

test("an unknown bank still gets a plain badge with its name", () => {
  assert.deepEqual(bankOf({ name: "x", bank: "Hume Bank" }), { n: "Hume Bank" });
  assert.equal(badge({ name: "x", bank: "Hume Bank" }), '<span class="bbadge">Hume Bank</span>');
});

test("badges are text on a colour, with the name made safe", () => {
  assert.equal(badge({ name: "x", bank: "ANZ" }), '<span class="bbadge" style="--bb:#007DBA;--bf:#FFFFFF">ANZ</span>');
  assert.equal(badge({ name: "x", bank: '<img src=x onerror=alert(1)>' }), '<span class="bbadge">&lt;img src=x onerror=alert(1)&gt;</span>');
  assert.equal(badge({ name: "Everyday" }), "");
});

// WCAG AA for small bold text needs 4.5:1 between the name and its colour.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
test("every bank's name is readable on its colour", () => {
  for (const b of get("BANKS")) {
    const [hi, lo] = [lum(b.bg), lum(b.fg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    assert.ok(ratio >= 4.5, `${b.n}: ${ratio.toFixed(2)}`);
  }
});
