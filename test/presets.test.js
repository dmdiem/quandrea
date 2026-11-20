import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPresets, cleanName, makePreset, cleanCustom, PRESET_COUNT } from "../src/presets.js";

const hat = { id: "a", slot: "Hat", cls: "Magician", lines: ["leap", "wh"], sockets: ["blue"], equipped: true };

test("presets are always 5 slots, empty ones null", () => {
  assert.equal(cleanPresets(undefined).length, PRESET_COUNT);
  assert.deepEqual(cleanPresets([null, "junk", 5]), [null, null, null, null, null]);
});

test("names are short plain text, with a default", () => {
  assert.equal(cleanName("  Bossing   set ", 0), "Bossing set");
  assert.equal(cleanName("<img src=x onerror=alert(1)>", 1), "img src=x onerror=alert(1)");
  assert.equal(cleanName("", 2), "Preset 3");
  assert.equal(cleanName(42, 3), "Preset 4");
  assert.equal(cleanName("x".repeat(50), 0).length, 30);
});

test("a saved preset round-trips and its pieces are checked", () => {
  const p = makePreset({ items: [hat], classId: "Magician" }, 0, "Main");
  const [back] = cleanPresets([JSON.parse(JSON.stringify(p))]);
  assert.equal(back.name, "Main");
  assert.equal(back.items.length, 1);
  assert.deepEqual(back.items[0].lines, ["leap", "wh"]);
  const [evil] = cleanPresets([{ name: "x", items: [{ slot: "<b>", lines: [] }, { slot: "Top", lines: ["<i>", "reg"], sockets: ["javascript:"] }], classId: "<x>" }]);
  assert.equal(evil.items.length, 1);
  assert.deepEqual(evil.items[0].lines, ["reg"]);
  assert.deepEqual(evil.items[0].sockets, []);
  assert.equal(evil.classId, "Magician");
});

test("a snapshot is a copy, not the live list", () => {
  const state = { items: [{ ...hat, lines: [...hat.lines] }], classId: "Magician" };
  const p = makePreset(state, 0, "");
  state.items[0].lines.push("reg");
  assert.deepEqual(p.items[0].lines, ["leap", "wh"]);
  assert.equal(p.name, "Preset 1");
});

test("Custom picks are kept in a preset, and only as slot -> plain id", () => {
  const p = cleanPresets([makePreset({ items: [hat], classId: "Magician", custom: { Hat: "a", Top: "<b>x</b>", Ring: "a" } }, 0, "Mine")])[0];
  assert.deepEqual(p.custom, { Hat: "a" });
  assert.deepEqual(cleanCustom(null), {});
});
