import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, missing, verdicts, socketSet, socketValue, classOption, TOTAL } from "../src/solver.js";

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
  assert.equal(classOption("Pirate (STR)").cls, "Pirate");
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
  // A slot with nothing useful is left empty.
  assert.equal(socketSet([item("Hat", "", { sockets: ["red"] })], "Magician").picks.Top, null);
});

test("verdicts: keep, backup, donor, trash, and other classes' gear", () => {
  const set = PERFECT.map((it) => ({ ...it }));
  const spare = item("Top", "leap wh reg"); // also perfect lines, but the set already has a top
  const prism = item("Top", "other", { sockets: ["prismatic", "blue", "blue"] });
  const junk = item("Top", "mage other");
  const warrior = item("Bottom", "leap wh reg", { cls: "Warrior" });
  const { res, verdicts: v } = verdicts([...set, spare, prism, junk, warrior]);
  assert.equal(res.score, 18);
  assert.equal(v[set[0].id].verdict, "keep");
  assert.equal(v[spare.id].verdict, "backup");
  assert.equal(v[prism.id].verdict, "donor");
  assert.equal(v[junk.id].verdict, "trash");
  assert.deepEqual(v[warrior.id], { verdict: "trash", why: "Warrior gear" });
});
