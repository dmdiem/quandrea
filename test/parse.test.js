import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTooltip, skillLines, lineKey, noRepeats } from "../src/parse.js";

// Real OCR output from tooltip screenshots (the same pipeline the site uses), with the lines,
// slot and class a person reads off each one.
const B = "Boss/IED/DMG";
const CASES = {
  3: ["Hat", "crit pirate boss"], 4: ["Hat", "crit pirate boss"], 5: ["Hat", "pirate crit"], 6: ["Hat", "ied dmg atk"],
  7: ["Hat", "archer atk"], 8: ["Hat", "reg ied"], 9: ["Hat", "reg atk"],
  10: ["Top", "archer warrior leap"], 11: ["Top", "atk archer"], 12: ["Top", "atk thief"], 13: ["Top", "dmg thief boss"],
  14: ["Top", "warrior reg boss"], 15: ["Top", "archer leap pirate"], 16: ["Top", "ied crit mage"], 17: ["Top", "leap crit"],
  18: ["Top", "atk reg pirate"], 19: ["Top", "dmg"], 20: ["Top", "pirate boss thief"],
  21: ["Bottom", "ied", "Warrior"], 22: ["Bottom", "pirate crit"], 23: ["Bottom", "mage ied"], 24: ["Bottom", "crit"],
  25: ["Bottom", "mage"], 26: ["Bottom", "wh leap ied"], 27: ["Bottom", "reg wh mage"],
  28: ["Shoes", "archer"], 29: ["Shoes", "wh dmg"], 30: ["Shoes", "crit atk"], 31: ["Shoes", "leap"],
  32: ["Gloves", "archer crit"], 33: ["Gloves", "thief atk ied"],
  34: ["Cape", "boss"], 35: ["Cape", "atk dmg"], 36: ["Cape", "reg"], 37: ["Cape", "pirate dmg boss"], 38: ["Cape", "ied"],
  "39-0": ["Cape", "leap wh"], "39-1": ["Cape", "mage", "Magician", true],
  "48-0": ["Cape", "atk dmg"], "48-1": ["Cape", "mage", "Magician", true],
  // the equipped gloves' potential has "Critical Damage +8%", which isn't a skill line
  "49-0": ["Gloves", "crit thief reg"], "49-1": ["Gloves", "wh crit mage", "Magician", true],
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
  assert.equal(lineKey("[Hologram] Boss Damage Enhancement Skill Lv. +1"), "boss");
  assert.equal(lineKey("[Hologram] Damage Enhancement Skill Lv. +1"), "dmg");
  assert.equal(lineKey("[Hologram] Ignore Defense Enhancement Skill Lv. +1"), "ied");
  assert.equal(lineKey("[Hologram] lgnare Defense Enhancement Skill Ly. +1"), "ied");
  assert.equal(lineKey("[Hologram] Critical Darnage Enhancement Skill Lv. +1"), "crit");
  assert.equal(lineKey("[Hologram] Something New Skill Lv. +1"), "other");
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

test("a piece can't have the same line twice: a repeat is a misread", () => {
  assert.deepEqual(noRepeats(["leap", "leap", "wh"]), ["leap", "wh"]);
  assert.deepEqual(noRepeats(["other", "mage", "other"]), ["other", "mage", "other"]); // Boss + IED are both Other
  const text = "[Hologram] Magician Attack Skill Lv. +1\n[Hologram] Magician Attack Skill Lv. +1\nRegistry Lv. +1\nScroll Enhancement None";
  assert.deepEqual(parseTooltip(text).lines, ["mage", "reg"]);
});

test("small or blurry text: a named skill counts even when its Lv. +1 is mangled", () => {
  const text = "Speed +4 (0 +4)\nChmensional Leap Lr od\nWhite Hole Jv +1\nScroll Enhancement Mone";
  assert.deepEqual(parseTooltip("Libae's Supercharged Cape (Magician)\n" + text).lines, ["leap", "wh"]);
  assert.equal(lineKey("Cimensional Leap Ly +"), "leap");
  assert.equal(lineKey("wine Hole Jv +1"), "wh");
  assert.deepEqual(skillLines("Required Job Magician\nMagic ATT +9\nAttack Power +9"), []);
});
