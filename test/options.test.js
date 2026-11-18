import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, OPTIONS } from "../src/options.js";
import { SLOTS, TARGETS } from "../src/parse.js";

test("Add manually offers equipment, then jewels, then skills", () => {
  assert.deepEqual(STEPS, ["slot", "sock", "line"]);
  assert.deepEqual(OPTIONS.slot, SLOTS);
  assert.deepEqual(OPTIONS.sock.sort(), ["blue", "green", "grey", "prismatic", "purple", "red"]);
  assert.deepEqual(OPTIONS.line, TARGETS.map((t) => t.k));
});
