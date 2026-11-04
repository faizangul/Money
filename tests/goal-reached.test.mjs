// The goal celebration should fire only on the amount that takes a goal to its target.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const reached = loadApp()("goalJustReached");

test("an amount that lands exactly on the target counts", () => {
  assert.equal(reached(900, 1000, 100), true);
});

test("an amount that goes past the target counts", () => {
  assert.equal(reached(900, 1000, 250), true);
});

test("an amount that falls short doesn't count", () => {
  assert.equal(reached(900, 1000, 99.99), false);
});

test("a goal already reached doesn't celebrate again", () => {
  assert.equal(reached(1000, 1000, 50), false);
  assert.equal(reached(1200, 1000, 50), false);
});

test("a goal with no target, or no amount, doesn't count", () => {
  assert.equal(reached(0, 0, 50), false);
  assert.equal(reached(900, 1000, 0), false);
});

test("cents from rounding don't block the moment", () => {
  assert.equal(reached(899.999, 1000, 100), true);
});
