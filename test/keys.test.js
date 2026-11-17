import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, KEY_TO } from "../src/keys.js";
import { SLOTS, TARGETS, FILLERS, OTHER } from "../src/parse.js";

test("every slot, line and socket has its own key", () => {
  const all = Object.values(KEYS).flatMap((m) => Object.values(m));
  assert.equal(new Set(all.map((k) => k.toLowerCase())).size, all.length, "a key is used twice");
  assert.deepEqual(Object.keys(KEYS.slot), SLOTS);
  assert.deepEqual(Object.keys(KEYS.line).sort(), [...TARGETS.map((t) => t.k), ...FILLERS.map((f) => f.k), OTHER].sort());
  assert.deepEqual(Object.keys(KEYS.sock).sort(), ["blue", "green", "grey", "prismatic", "purple", "red"]);
});

test("the keys you asked for", () => {
  assert.deepEqual(["q", "w", "e", "r", "t"].map((k) => KEY_TO[k][1]), ["blue", "green", "purple", "red", "grey"]);
  assert.deepEqual(["a", "s", "d", "f"].map((k) => KEY_TO[k][1]), ["leap", "wh", "reg", "atk"]);
  assert.deepEqual(["y", "u", "i", "o", "p"].map((k) => KEY_TO[k][1]), ["Hat", "Top", "Bottom", "Cape", "Shoes"]);
  assert.deepEqual(KEY_TO.h, ["slot", "Gloves"]);
  assert.deepEqual(KEY_TO["1"], ["sock", "prismatic"]);
});
