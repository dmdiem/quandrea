import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTooltip, skillLines, lineKey } from "../src/parse.js";

// Real OCR output from tooltip screenshots (the same pipeline the site uses), with the lines,
// slot and class a person reads off each one.
const B = "Boss/IED/DMG";
const CASES = {
  3: ["Hat", "crit pirate other"], 4: ["Hat", "crit pirate other"], 5: ["Hat", "pirate crit"], 6: ["Hat", "other other atk"],
  7: ["Hat", "archer atk"], 8: ["Hat", "reg other"], 9: ["Hat", "reg atk"],
  10: ["Top", "archer warrior leap"], 11: ["Top", "atk archer"], 12: ["Top", "atk thief"], 13: ["Top", "other thief other"],
  14: ["Top", "warrior reg other"], 15: ["Top", "archer leap pirate"], 16: ["Top", "other crit mage"], 17: ["Top", "leap crit"],
  18: ["Top", "atk reg pirate"], 19: ["Top", "other"], 20: ["Top", "pirate other thief"],
  21: ["Bottom", "other", "Warrior"], 22: ["Bottom", "pirate crit"], 23: ["Bottom", "mage other"], 24: ["Bottom", "crit"],
  25: ["Bottom", "mage"], 26: ["Bottom", "wh leap other"], 27: ["Bottom", "reg wh mage"],
  28: ["Shoes", "archer"], 29: ["Shoes", "wh other"], 30: ["Shoes", "crit atk"], 31: ["Shoes", "leap"],
  32: ["Gloves", "archer crit"], 33: ["Gloves", "thief atk other"],
  34: ["Cape", "other"], 35: ["Cape", "atk other"], 36: ["Cape", "reg"], 37: ["Cape", "pirate other other"], 38: ["Cape", "other"],
  "39-0": ["Cape", "leap wh"], "39-1": ["Cape", "mage", "Magician", true],
};
void B;

test("reads slot, class, equipped and skill lines from real OCR text", () => {
  for (const [n, [slot, lines, cls = "Magician", equipped = false]] of Object.entries(CASES)) {
    const item = parseTooltip(fs.readFileSync(new URL(`./fixtures/ocr/${n}.txt`, import.meta.url), "utf8"));
    assert.equal(item.slot, slot, `slot ${n}`);
    assert.equal(item.cls, cls, `class ${n}`);
    assert.equal(item.lines.join(" "), lines, `lines ${n}`);
    assert.equal(item.equipped, equipped, `equipped ${n}`);
  }
});

test("wrapped lines are joined; OCR misreads still match", () => {
  const text = "Enemy DEF Ignored +5%\n[Hologram] Attack Power & Magic ATT Enhancement\nSkill Ly. +1\nWhite Hole Lv. +1\n[Hologram] Critical Darnage Enhancement Skill Ly, +1\nScroll Enhancement Mone";
  assert.deepEqual(skillLines(text).map(lineKey), ["atk", "wh", "crit"]);
  assert.equal(lineKey("[Hologram] Bowman Attack Skill Level Lv. +1"), "archer");
  assert.equal(lineKey("[Hologram] Boss Damage Enhancement Skill Lv. +1"), "other");
  assert.equal(lineKey("[Hologram] Damage Enhancement Skill Lv. +1"), "other");
  assert.equal(lineKey("[Hologram] Ignore Defense Enhancement Skill Lv. +1"), "other");
});

test("stat lines and the potential don't count as skill lines", () => {
  const text = "Required Level Lv. 160\nMagic ATT +10\nAttack Power +9\nMagic ATT +9\nPotential : Unique\nCritical Damage +8%";
  assert.deepEqual(skillLines(text), []);
  assert.equal(parseTooltip("nothing here").slot, null);
});

test("shoulders and weapons are skipped, not misreads", () => {
  const read = (n) => parseTooltip(fs.readFileSync(new URL(`./fixtures/ocr/${n}.txt`, import.meta.url), "utf8"));
  for (const [n, skip] of [["42-0", "Shoulder"], ["42-1", "Shoulder"], ["43-0", "Weapon"], ["43-1", "Weapon"]]) {
    const item = read(n);
    assert.equal(item.slot, null, n);
    assert.equal(item.skip, skip, n);
    assert.deepEqual(item.lines, [], n);
  }
  assert.equal(read("39-0").skip, null);
  assert.equal(parseTooltip("garbled").skip, null);
});
