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

test("one row per kind: equipment, jewels, skills", () => {
  assert.deepEqual(["1", "2", "3", "4", "5", "6"].map((k) => KEY_TO[k]), [["slot", "Hat"], ["slot", "Top"], ["slot", "Bottom"], ["slot", "Cape"], ["slot", "Gloves"], ["slot", "Shoes"]]);
  assert.deepEqual(["q", "w", "e", "r", "t", "y"].map((k) => KEY_TO[k][1]), ["blue", "green", "purple", "red", "grey", "prismatic"]);
  assert.deepEqual(["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"].map((k) => KEY_TO[k][1]), ["leap", "wh", "reg", "atk", "crit", "warrior", "mage", "archer", "thief", "pirate"]);
  assert.deepEqual(["z", "x", "c", "v"].map((k) => KEY_TO[k][1]), ["boss", "ied", "dmg", "other"]);
});
