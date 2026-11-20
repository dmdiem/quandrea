import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, missing, onePieceAway, verdicts, findSame, socketSet, socketValue, socketNote, classOption, TOTAL } from "../src/solver.js";
import { TARGETS } from "../src/parse.js";

let n = 0;
const item = (slot, lines, extra = {}) => ({ id: String(++n), slot, cls: "Magician", lines: lines.split(" ").filter(Boolean), sockets: [], ...extra });

const PERFECT = [
  item("Hat", "leap wh atk"),
  item("Top", "leap wh reg"),
  item("Bottom", "leap reg atk"),
  item("Cape", "wh reg crit"),
  item("Gloves", "atk mage warrior"),
  item("Shoes", "archer thief pirate"),
];

test("a perfect set scores 18/18 with nothing missing", () => {
  const r = solve(PERFECT);
  assert.equal(TOTAL, 18);
  assert.equal(r.score, 18);
  assert.deepEqual(missing(r), []);
  assert.ok(Object.values(r.counted).every((c) => c.every(Boolean)));
});

test("one more piece finishes it: per slot, the exact lines a single drop needs", () => {
  // Perfect except the cape: the other five slots leave exactly White Hole, Registry and Crit missing.
  const five = PERFECT.filter((it) => it.slot !== "Cape");
  const opts = onePieceAway([...five, item("Cape", "other other other")]);
  assert.deepEqual(opts.find((o) => o.slot === "Cape"), { slot: "Cape", need: ["wh", "reg", "crit"] });
  // Already 18/18: nothing to hunt (no slot's gap is empty after removing it... except the redundant ones)
  assert.ok(onePieceAway(PERFECT).every((o) => o.need.length > 0));
  // A gap that needs the same line twice can't be one piece.
  const noLeap = PERFECT.map((it) => ({ ...it, lines: it.lines.filter((k) => k !== "leap") }));
  assert.ok(!onePieceAway(noLeap).some((o) => o.slot === "Hat" && o.need.filter((k) => k === "leap").length > 1));
  // Too far away: nothing.
  assert.deepEqual(onePieceAway([item("Hat", "mage")]), []);
});

test("extra copies don't count: a 4th Leap is wasted, so the solver picks around it", () => {
  const hat2 = item("Hat", "leap mage pirate"); // worse on its own than the perfect hat? no: it duplicates mage/pirate
  const r = solve([...PERFECT, hat2]);
  assert.equal(r.score, 18);
  assert.equal(r.picks.Hat, PERFECT[0]);
  const r2 = solve([item("Hat", "leap leap2"), item("Top", "leap"), item("Bottom", "leap"), item("Cape", "leap")]);
  assert.equal(r2.score, 3);
  assert.deepEqual(r2.counted.Cape, [false]);
});

test("the best combination beats picking each slot's best item on its own", () => {
  // Greedy would take the top with 2 list lines (crit, mage), but the hat already has both.
  const hat = item("Hat", "crit mage pirate");
  const topA = item("Top", "crit mage other");
  const topB = item("Top", "leap");
  const r = solve([hat, topA, topB]);
  assert.equal(r.picks.Top, topB);
  assert.equal(r.score, 4);
  assert.deepEqual(missing(r).slice(0, 3), ["leap", "leap", "wh"]);
});

test("early mode wants 3 lines anywhere; endgame wants the right lines", () => {
  const junk3 = item("Hat", "other other other");
  const good1 = item("Hat", "mage");
  assert.equal(solve([junk3, good1], "early").picks.Hat, junk3);
  assert.equal(solve([junk3, good1], "endgame").picks.Hat, good1);
  // ties in early mode go to the item with more target lines
  const better3 = item("Hat", "mage other other");
  assert.equal(solve([junk3, better3], "early").picks.Hat, better3);
  assert.equal(solve([junk3, better3], "early").lines, 3);
});

test("same score: more lines in total wins, since extras still level the skill", () => {
  const set = [item("Hat", "leap wh reg"), item("Top", "mage")];
  const capeA = item("Cape", "crit");
  const capeB = item("Cape", "crit mage"); // the 2nd Mage is an extra, but still +1 Mage skill
  const r = solve([...set, capeA, capeB]);
  assert.equal(r.picks.Cape, capeB);
  assert.deepEqual(r.counted.Cape, [true, false]);
  // ...but an extra never beats a line that's missing
  const capeC = item("Cape", "crit wh");
  assert.equal(solve([...set, capeB, capeC]).picks.Cape, capeC);
});

test("ties go to what you already wear", () => {
  const a = item("Cape", "reg");
  const b = item("Cape", "reg", { equipped: true });
  assert.equal(solve([a, b]).picks.Cape, b);
});

test("socket colours per class, with prismatic counted as good", () => {
  const it = item("Hat", "", { sockets: ["prismatic", "blue", "grey"] });
  assert.deepEqual(socketValue(it, "Magician"), { prismatic: 1, mine: 1, dead: 1, good: 2 });
  assert.equal(socketValue(it, "Thief").good, 2); // grey is a thief colour
  assert.equal(socketValue(item("Hat", "", { sockets: ["purple", "purple", "purple"] }), "Pirate (DEX)").good, 3);
  assert.equal(socketValue(item("Hat", "", { sockets: ["purple", "purple", "purple"] }), "Pirate (STR)").good, 0);
  assert.deepEqual(classOption("Pirate (STR)").classes, ["Pirate"]);
  assert.equal(classOption("Pirate (DEX)").stat, "DEX");
  assert.equal(classOption("Pirate").stat, "STR");
  assert.equal(classOption("Lethe").id, "Magician"); // a job name from an older save
  assert.equal(classOption("nonsense").id, "Magician");
});

test("socket set: aims for 4 prismatic pieces, the rest all your colour", () => {
  const S = ["Hat", "Top", "Bottom", "Cape", "Gloves", "Shoes"];
  const prism = S.map((s) => item(s, "", { sockets: ["prismatic", "blue", "blue"] }));
  const stat = S.map((s) => item(s, "", { sockets: ["blue", "blue", "blue"] }));
  const plan = socketSet([...prism, ...stat], "Magician");
  assert.equal(plan.good, 18);
  assert.ok(plan.prismatic >= 4); // mages can run prismatic + blue + blue on all six
  // With only 3 prismatic pieces around, it takes them all.
  const few = socketSet([...prism.slice(0, 3), ...stat], "Magician");
  assert.equal(few.prismatic, 3);
  assert.equal(few.good, 18);
  // Orbs are rare: only perfect sockets count (3, all usable). Near misses don't.
  assert.equal(socketSet([item("Shoes", "", { sockets: ["red", "blue"] })], "Magician").picks.Shoes, null);
  assert.equal(socketSet([item("Shoes", "", { sockets: ["prismatic", "red"] })], "Magician").picks.Shoes, null);
  assert.equal(socketSet([item("Shoes", "", { sockets: ["blue", "blue"] })], "Magician").picks.Shoes, null);
  assert.equal(socketSet([item("Shoes", "", { sockets: ["prismatic", "blue", "red"] })], "Magician").picks.Shoes, null);
  assert.ok(socketSet([item("Shoes", "", { sockets: ["prismatic", "blue", "blue"] })], "Magician").picks.Shoes);
  assert.ok(socketSet([item("Shoes", "", { sockets: ["blue", "blue", "blue"] })], "Magician").picks.Shoes);
  assert.equal(socketNote(item("Shoes", "", { sockets: ["prismatic", "blue", "red"] }), "Magician"), "2 of 3 usable (prismatic, blue); red is no use to you");
  assert.equal(socketNote(item("Shoes", "", { sockets: ["blue", "blue", "blue"] }), "Magician"), "3 of 3 usable (blue, blue, blue)");
  // A slot with nothing useful is left empty.
  assert.equal(socketSet([item("Hat", "", { sockets: ["red"] })], "Magician").picks.Top, null);
});

test("five classes; the main stat decides the socket colours", () => {
  assert.deepEqual(classOption("Magician").colours, ["blue"]);
  assert.deepEqual(classOption("Warrior").colours, ["red", "green", "grey"]);
  assert.deepEqual(classOption("Bowman").colours, ["red", "green", "grey", "purple"]);
  assert.deepEqual(classOption("Thief").colours, ["purple", "grey"]);
  assert.deepEqual(classOption("Pirate (STR)").colours, ["red", "green", "grey"]);
  assert.deepEqual(classOption("Pirate (DEX)").colours, ["red", "green", "grey", "purple"]);
});

test("verdicts: keep (best, spare, sockets) or trash, and other classes' gear", () => {
  const set = PERFECT.map((it) => ({ ...it }));
  const spare = item("Top", "leap wh reg"); // also perfect lines, but the set already has a top
  const prism = item("Top", "other", { sockets: ["prismatic", "blue", "blue"] });
  const junk = item("Top", "mage other", { sockets: ["red", "blue"] }); // one blue isn't enough
  const warrior = item("Bottom", "leap wh reg", { cls: "Warrior" });
  const { res, verdicts: v } = verdicts([...set, spare, prism, junk, warrior]);
  assert.equal(res.score, 18);
  assert.equal(v[set[0].id].verdict, "keep");
  assert.deepEqual([v[spare.id].verdict, v[spare.id].reason], ["keep", "spare"]);
  assert.deepEqual([v[prism.id].verdict, v[prism.id].reason], ["keep", "sockets"]);
  assert.match(v[prism.id].why, /^For its sockets: 3 of 3 usable/);
  assert.equal(v[set[0].id].reason, "best");
  assert.equal(v[junk.id].verdict, "trash");
  assert.deepEqual(v[warrior.id], { verdict: "trash", why: "Warrior gear" });
});

test("on a tie, the four big skills beat a spare class or Crit line", () => {
  // Either hat gives 1 toward the 18 (the Thief spot, or a third White Hole), and both have 2 lines.
  // The White Hole one should win, even though the Thief hat comes first.
  const items = [
    item("Hat", "thief crit", { id: "thief-hat" }),
    item("Hat", "wh crit", { id: "wh-hat" }),
    item("Top", "wh reg"),
    item("Bottom", "wh crit"),
  ];
  const res = solve(items);
  assert.equal(res.picks.Hat.id, "wh-hat");
  assert.equal(res.counts[1], 3); // White Hole 3/3
});

test("Leap, White Hole and Registry come before the rest of the 18", () => {
  // A White Hole hat (2nd WH) vs a hat with two class lines: the class hat makes 1 more of the 18,
  // but White Hole wins.
  const items = [
    item("Hat", "wh", { id: "wh-hat" }),
    item("Hat", "warrior thief", { id: "class-hat" }),
    item("Top", "wh reg"),
  ];
  const res = solve(items);
  assert.equal(res.picks.Hat.id, "wh-hat");
});

test("Original build aims for 4 prismatic pieces", () => {
  const S = ["Hat", "Top", "Bottom", "Shoes", "Gloves", "Cape"];
  const prism = S.map((s) => item(s, "", { sockets: ["prismatic", "blue", "blue"] }));
  const stat = S.map((s) => item(s, "", { sockets: ["blue", "blue", "blue"] }));
  assert.equal(socketSet([...prism, ...stat], "Magician").goal, 4);
});

test("EU build: 3 Crit DMG and 3 Damage, no class lines", () => {
  const set = [
    item("Hat", "leap wh crit"),
    item("Top", "leap reg dmg"),
    item("Bottom", "leap atk crit"),
    item("Shoes", "wh reg dmg"),
    item("Gloves", "wh atk crit"),
    item("Cape", "reg atk dmg"),
  ];
  const eu = solve(set, "endgame", "eu");
  assert.equal(eu.score, 18);
  assert.deepEqual(missing(eu), []);
  // Damage never counts in the original build, and class lines never count in EU.
  assert.equal(solve(set).score, 13);
  const withClass = solve([item("Hat", "leap mage pirate")], "endgame", "eu");
  assert.equal(withClass.score, 1);
  assert.deepEqual(missing(withClass).filter((k) => ["mage", "pirate", "archer"].includes(k)), []);
  assert.equal(socketSet(set, "Magician", "eu").goal, 6);
});

test("each piece says which builds' best combos it's in", () => {
  const classHat = item("Hat", "leap wh mage", { id: "class-hat" });
  const dmgHat = item("Hat", "leap wh dmg", { id: "dmg-hat" });
  const top = item("Top", "leap reg atk", { id: "top" });
  const { inBuilds, all } = verdicts([classHat, dmgHat, top]);
  assert.deepEqual(Object.keys(all).sort(), ["eu", "flex", "original"]);
  assert.deepEqual(inBuilds["class-hat"].filter((id) => id !== "flex"), ["original"]);
  assert.deepEqual(inBuilds["dmg-hat"].filter((id) => id !== "flex"), ["eu"]);
  assert.deepEqual(inBuilds.top.sort(), ["eu", "flex", "original"]);
});

test("the same piece added twice is spotted (lines and jewels in any order)", () => {
  const a = item("Hat", "leap wh atk", { sockets: ["prismatic", "blue", "red"] });
  assert.equal(findSame([a], item("Hat", "atk leap wh", { sockets: ["red", "prismatic", "blue"] })), a);
  assert.equal(findSame([a], item("Hat", "leap wh atk", { sockets: ["prismatic", "blue", "blue"] })), null); // other jewels
  assert.equal(findSame([a], item("Top", "leap wh atk", { sockets: ["prismatic", "blue", "red"] })), null); // other slot
  assert.equal(findSame([a], item("Hat", "leap wh atk", { cls: "Thief", sockets: ["prismatic", "blue", "red"] })), null); // other class
  assert.equal(findSame([a], a), null); // not itself
});

test("Flex: the 13 shared lines plus any 5 class, Crit DMG or Damage lines", () => {
  // 13 core lines, then a mix of 2 class lines, a 2nd Crit DMG and 2 Damage: 18/18 in Flex only.
  const set = [
    item("Hat", "leap wh crit"),
    item("Top", "leap reg mage"),
    item("Bottom", "leap atk dmg"),
    item("Shoes", "wh reg crit"),
    item("Gloves", "wh atk thief"),
    item("Cape", "reg atk dmg"),
  ];
  const flex = solve(set, "endgame", "flex");
  assert.equal(flex.score, 18);
  assert.equal(flex.core, 13);
  assert.equal(flex.flex, 5);
  assert.deepEqual(missing(flex), []);
  assert.ok(solve(set).score < 18 && solve(set, "endgame", "eu").score < 18);
  // A 6th flex line doesn't count, and neither does a repeated class or Boss DMG.
  const capped = solve([item("Hat", "mage thief pirate"), item("Top", "archer warrior dmg"), item("Bottom", "mage boss crit")], "endgame", "flex");
  assert.equal(capped.flex, 5);
  // Missing in Flex: only the shared lines (the "any 5" spots show as a count in the page).
  assert.deepEqual(missing(solve([item("Hat", "mage thief pirate")], "endgame", "flex")), ["leap", "leap", "leap", "wh", "wh", "wh", "reg", "reg", "reg", "atk", "atk", "atk", "crit"]);
});

test("Flex: when the 5 any spots overflow, a class line is left over, not Crit DMG", () => {
  // 1 core Crit + 2 more Crit and 4 classes: 6 lines for 5 spots.
  const set = [item("Hat", "crit mage"), item("Top", "thief crit"), item("Bottom", "pirate archer"), item("Shoes", "crit")];
  const res = solve(set, "endgame", "flex");
  assert.equal(res.flex, 5);
  assert.equal(res.counts[TARGETS.findIndex((t) => t.k === "crit")], 3);
  const left = Object.entries(res.counted).flatMap(([s, c]) => c.map((ok, j) => (!ok ? res.picks[s].lines[j] : null)).filter(Boolean));
  assert.deepEqual(left, ["pirate"]); // the weakest class line is the one left over
});
