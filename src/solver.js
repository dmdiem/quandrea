// Picking the best set: one item per slot. The counting idea is the same as the community's
// "3L Set Solver": walk the slots one at a time, keeping every reachable tally of target lines
// (each count capped at what the set needs), so the best tally is exact without trying every combo.
//
// Two goals:
//   endgame: the most of the 18 target lines (3 Leap, 3 White Hole, 3 Registry, 3 ATT & M.ATT, 1 of each other)
//   early:   the most skill lines of any kind (18 = a 3-line item in every slot), target lines as tiebreak

import { SLOTS, TARGETS } from "./parse.js?v=78";

const IDX = Object.fromEntries(TARGETS.map((t, i) => [t.k, i]));
const CLASS_KEYS = new Set(["archer", "warrior", "thief", "mage", "pirate"]); // strongest first (v.272)

// Three builds, all 18 lines (buttons in this order: General, Flex, Bossing):
//   original ("General", the default): 3 Leap, 3 White Hole, 3 Registry, 3 ATT, 1 Crit DMG, 1 of each
//         of the 5 classes; 4 prismatics. The class procs hit many enemies: mobbing, dungeons, quests.
//   eu ("Bossing", the EU build, courtesy of Shapaz, via the 3L Set Solver): 3 each of Leap, White Hole,
//         Registry, ATT, Crit DMG and Damage, no class lines; a prismatic on every piece. An optional
//         min-max for heavy bossing past the 22 badge: about +7% Final Damage, give or take.
//   flex: in between: the 13 shared lines plus any 5 class, Crit DMG or Damage lines.
// (The ids stay "original" and "eu" so saved choices keep working.)
const needs = (over) => TARGETS.map((t) => over[t.k] ?? t.need);
const NO_CLASSES = { archer: 0, warrior: 0, thief: 0, mage: 0, pirate: 0 };
export const BUILDS = {
  original: { id: "original", name: "General BiS", short: "General", need: needs({}), prismatic: 4,
    about: "For mobbing, dungeons and quests: 3 each of Leap, White Hole, Registry, ATT; 1 Crit DMG; all 5 class lines (their procs hit many enemies); 4 prismatics",
    note: "General is fine for most players. Want to sweat it for bossing past the 22 badge? Bossing is about +7% Final Damage." },
  // In between: the 13 lines both builds share, plus any 5 of class, Crit DMG or Damage lines.
  flex: { id: "flex", name: "Flex", short: "Flex", need: needs({ crit: 3, dmg: 3 }), flexCap: 5, prismatic: 4,
    about: "In between: the 13 lines both builds share (3 each of Leap, White Hole, Registry, ATT, 1 Crit DMG), plus any 5 class, Crit DMG or Damage lines",
    note: "In between: the 13 lines both builds share, plus any 5 class, Crit DMG or Damage lines. Uses whatever mix your gear has." },
  eu: { id: "eu", name: "Bossing BiS", short: "Bossing", need: needs({ crit: 3, dmg: 3, ...NO_CLASSES }), prismatic: 6,
    about: "Optional min-max for heavy bossing past the 22 badge (about +7% Final Damage): 3 each of Leap, White Hole, Registry, ATT, Crit DMG and Damage; no class lines. The EU build, courtesy of Shapaz",
    note: "Optional min-max: only worth it past the 22 badge if you boss a lot (about +7% Final Damage). General is fine for everything else." },
};
export const BUILD_IDS = Object.keys(BUILDS);
export const buildOf = (id) => BUILDS[id] ?? BUILDS.original;

// Flex: both builds share 13 lines (3 each of Leap, White Hole, Registry, ATT, and 1 Crit DMG), the
// "core". The other 5 can be any class line (each class once), more Crit DMG (up to 3 in all) or
// Damage (up to 3). Only Boss DMG and Ignore DEF never help.
export const CORE_NEED = needs({ ...NO_CLASSES });
export const CORE_TOTAL = CORE_NEED.reduce((a, b) => a + b, 0); // 13
export const FLEX_TOTAL = 5;
// Tallies are packed into one number, one digit per line, sized for the biggest need of any build.
const MAXNEED = TARGETS.map((_, i) => Math.max(...Object.values(BUILDS).map((b) => b.need[i])));
const BASE = MAXNEED.map((n) => n + 1);
const MUL = [];
BASE.reduce((m, b, i) => ((MUL[i] = m), m * b), 1);
const NEED = BUILDS.original.need;
export const TOTAL = 18;

const digit = (st, i) => Math.floor(st / MUL[i]) % BASE[i];
export const counts = (st) => NEED.map((_, i) => digit(st, i));
const tally = (st) => counts(st).reduce((a, b) => a + b, 0);
// How many of the four big skills (3 each) a tally has.
const CORE = ["leap", "wh", "reg", "atk"].map((k) => IDX[k]);
const core = (st) => CORE.reduce((n, i) => n + digit(st, i), 0);
// The three big damage skills, 3 each: Leap, White Hole, Registry.
const BIG = ["leap", "wh", "reg"].map((k) => IDX[k]);
const big = (st) => BIG.reduce((n, i) => n + digit(st, i), 0);

// Lines past the 13 core ones (a class, Damage, or a 2nd or 3rd Crit DMG).
const coreScore = (st) => CORE_NEED.reduce((n, need, i) => n + Math.min(need, digit(st, i)), 0);
const flexUsed = (st) => tally(st) - coreScore(st);
// Roughly what one level of each line adds (from the skill tooltips): Leap, White Hole and Registry
// +5% Final Damage each; ATT +5% ATT and a little Final Damage; Crit DMG +5% Crit Damage; Damage +5%
// Damage (spread over all your other Damage %); a class line a Lv. 1 proc. In tenths.
const WORTH = TARGETS.map((t) => ({ leap: 50, wh: 50, reg: 50, atk: 30, crit: 25, dmg: 20 })[t.k] ?? 10);
const worth = (st) => WORTH.reduce((n, w, i) => n + w * digit(st, i), 0);
// Flex, scored from an uncapped tally: the 13 shared lines, plus the best 5 of the rest (by WORTH).
// (Searching with the cap applied would fill the 5 spots in slot order, not with the best lines.)
function flexScore(st, cap) {
  const extra = [];
  let lines = 0;
  let w = 0;
  CORE_NEED.forEach((need, i) => {
    const d = digit(st, i);
    lines += Math.min(need, d);
    w += WORTH[i] * Math.min(need, d);
    for (let j = need; j < d; j++) extra.push(WORTH[i]);
  });
  const best = extra.sort((a, b) => b - a).slice(0, cap);
  return { tally: lines + best.length, worth: w + best.reduce((a, b) => a + b, 0) };
}
// Can this line still count in this build's tally?
const counts1 = (st, i, b) => digit(st, i) < b.need[i] && (!b.flexCap || digit(st, i) < CORE_NEED[i] || flexUsed(st) < b.flexCap);

function add(st, lines, b = BUILDS.original) {
  for (const k of lines) {
    const i = IDX[k];
    if (i !== undefined && counts1(st, i, b)) st += MUL[i];
  }
  return st;
}

// The same piece added twice: same slot, class, 3 lines and jewels (in any order). Two real pieces
// that match on all of that are rare enough to treat as one.
const sorted = (list) => [...(list ?? [])].sort().join(",");
export const samePiece = (a, b) => a.slot === b.slot && (a.cls ?? null) === (b.cls ?? null) && sorted(a.lines) === sorted(b.lines) && sorted(a.sockets) === sorted(b.sockets);
export const findSame = (items, piece) => items.find((it) => it !== piece && samePiece(it, piece)) ?? null;

// Could this piece be part of a perfect 18/18 set for a build? All 3 of its lines are ones the
// build uses (a Thief line never fits Bossing; a Damage line never fits General).
export const fitsBuild = (item, id) => item.lines.length === 3 && item.lines.every((k) => IDX[k] !== undefined && buildOf(id).need[IDX[k]] > 0);

// How many of an item's lines are on the list (the most it could ever add).
export const useful = (item) => item.lines.filter((k) => IDX[k] !== undefined).length;

// items: [{ id, slot, lines }]. Returns the picks and how good they are.
// classId (optional): on a tie, the piece with more sockets your class can use wins (no Orb needed).
export function solve(items, mode = "endgame", build = "original", classId = null) {
  const b = buildOf(build);
  const bySlot = SLOTS.map((s) => items.filter((it) => it.slot === s));
  // Map of tally -> { score, prev, item }. score = how much we like the path so far (more lines).
  // Flex searches without its 5-spot cap and applies it when scoring (flexScore).
  const searchB = b.flexCap ? { ...b, flexCap: 0 } : b;
  let layer = new Map([[0, { extra: 0 }]]);
  const layers = [];
  for (const [si, opts] of bySlot.entries()) {
    const next = new Map();
    for (const [st, info] of layer) {
      for (const it of opts.length ? opts : [null]) {
        const ns = it ? add(st, it.lines, searchB) : st;
        // early: every line counts most. endgame: the 18 come first, then more lines in total (an
        // extra Mage line is still +1 to that skill, up to Lv. 8).
        const sockets = it && classId ? socketValue(it, classId).good : 0;
        const extra = info.extra + (it ? it.lines.length * (mode === "early" ? 1000 : 100) + sockets : 0);
        const cur = next.get(ns);
        if (!cur || extra > cur.extra) next.set(ns, { extra, prev: st, item: it, slot: si });
      }
    }
    layers.push(next);
    layer = next;
  }
  // General and Bossing (a fixed 18): the most of the 18 first, then the most damage (each counted
  // line weighted by roughly what a level of it adds, see WORTH). Flex (any 5 of several lines): the
  // most damage first, then the most of the 18. Then the four 3-each skills; then more lines; then
  // more usable sockets.
  const value = (st, e) => (mode === "early" ? e.extra * 100 + tally(st) * 10 : (b.flexCap
    ? flexScore(st, b.flexCap).worth * 1e8 + flexScore(st, b.flexCap).tally * 1e6
    : tally(st) * 1e8 + worth(st) * 1e5) + core(st) * 1e4 + e.extra);
  let bestSt = 0;
  let best = null;
  for (const [st, e] of layer) if (!best || value(st, e) > value(bestSt, best)) [bestSt, best] = [st, e];

  const picks = Object.fromEntries(SLOTS.map((s) => [s, null]));
  for (let l = layers.length - 1, st = bestSt; l >= 0; l--) {
    const e = layers[l].get(st);
    if (e.item) picks[SLOTS[e.slot]] = e.item;
    st = e.prev;
  }
  // Which picked lines count toward the 18 (a 4th Leap or a 2nd Pirate is an extra). In Flex, when
  // there are more "any 5" lines than spots, Crit DMG and Damage (they have Final Damage passives)
  // take the spots first, so a class line is the one left over.
  const counted = Object.fromEntries(SLOTS.map((s) => [s, (picks[s]?.lines ?? []).map(() => false)]));
  let run = 0;
  // (Then the class lines strongest first, so the weakest is the one left over.)
  const passes = b.flexCap ? [(k) => !CLASS_KEYS.has(k), ...[...CLASS_KEYS].map((c) => (k) => k === c)] : [() => true];
  for (const pass of passes)
    for (const s of SLOTS)
      picks[s]?.lines.forEach((k, j) => {
        const i = IDX[k];
        if (!pass(k) || i === undefined || !counts1(run, i, b)) return;
        run += MUL[i];
        counted[s][j] = true;
      });
  const lines = SLOTS.reduce((n, s) => n + (picks[s]?.lines.length ?? 0), 0);
  return { picks, counted, counts: counts(run), score: tally(run), core: coreScore(run), flex: tally(run) - coreScore(run), lines, build: b.id };
}

// "One more piece finishes it": for each slot, the lines a single new piece there would need to
// reach 18/18, keeping the best possible pieces in the other five slots. A piece holds at most 3
// lines and can't repeat one, so only gaps of up to 3 different lines count. Fewest lines first.
// build: General ("original") or Bossing ("eu"). Flex's "any 5" has too many ways to finish to list.
export function onePieceAway(items, build = "original") {
  const b = buildOf(build);
  if (b.flexCap) return [];
  const bySlot = SLOTS.map((s) => items.filter((it) => it.slot === s));
  const out = [];
  const seen = new Set();
  for (let skip = 0; skip < SLOTS.length; skip++) {
    let layer = new Set([0]);
    for (const [si, opts] of bySlot.entries()) {
      if (si === skip) continue;
      const next = new Set();
      for (const st of layer) for (const it of opts.length ? opts : [null]) next.add(it ? add(st, it.lines, b) : st);
      layer = next;
    }
    for (const st of layer) {
      if (tally(st) < TOTAL - 3) continue;
      const need = TARGETS.flatMap((t, i) => Array(Math.max(0, b.need[i] - digit(st, i))).fill(t.k));
      if (!need.length || new Set(need).size !== need.length) continue;
      const key = `${skip}:${need.join(",")}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ slot: SLOTS[skip], need });
      }
    }
  }
  // Fewer lines needed is an easier drop; drop options that ask for more than another in the same slot.
  out.sort((a, b) => a.need.length - b.need.length || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  return out.filter((o, i) => !out.slice(0, i).some((p) => p.slot === o.slot && p.need.every((k) => o.need.includes(k))));
}

// What's still missing from the 18, as line keys (e.g. ["wh", "wh", "mage"]).
// For core + flex, only the core lines (the flex ones can be any of several: see res.flex).
export function missing(res) {
  const b = buildOf(res.build);
  const need = b.flexCap ? CORE_NEED : b.need;
  return TARGETS.flatMap((t, i) => Array(Math.max(0, need[i] - res.counts[i])).fill(t.k));
}

// ---- Sockets (after the 18 lines) ----
// Jewels go in sockets. Once the 18 lines are done, you farm a second set with the right sockets and
// use Orbs to move your lines onto it. The goal: 4 pieces with prismatic + stat + stat and 2 with
// stat + stat + stat. A prismatic socket can also hold a stat gem (handy for mages), so it counts as good.

// Which socket colours hold your stat gems. Each colour's gems roll one class's stats plus Attack
// Power (Magic ATT for blue): red = Warrior, green = Bowman, grey = Pirate, purple = Thief, blue = Magician.
const COLOURS = {
  STR: ["red", "green", "grey"],
  DEX: ["red", "green", "grey", "purple"],
  LUK: ["purple", "grey"],
  INT: ["blue"],
};

// The five classes (the one in brackets on Quanah gear). Pirates also pick their main stat, since a
// DEX pirate can use purple gems and a STR pirate can't.
export const CLASSES = ["Magician", "Warrior", "Bowman", "Thief", "Pirate"];
export const CLASS_OPTIONS = [
  { id: "Magician", cls: "Magician", stat: "INT" },
  { id: "Warrior", cls: "Warrior", stat: "STR" },
  { id: "Bowman", cls: "Bowman", stat: "DEX" },
  { id: "Thief", cls: "Thief", stat: "LUK" },
  { id: "Pirate (STR)", cls: "Pirate", stat: "STR" },
  { id: "Pirate (DEX)", cls: "Pirate", stat: "DEX" },
].map((o) => ({ ...o, classes: [o.cls], colours: COLOURS[o.stat] }));

// A class by id. "Pirate" alone means a STR pirate; anything unknown (like a job name from an
// older save) falls back to Magician.
export const classOption = (id) =>
  CLASS_OPTIONS.find((o) => o.id === id) ?? (id === "Pirate" ? CLASS_OPTIONS[4] : CLASS_OPTIONS[0]);

export function socketValue(item, classId) {
  const { colours } = classOption(classId);
  const s = item.sockets ?? [];
  const prismatic = s.filter((c) => c === "prismatic").length;
  const mine = s.filter((c) => colours.includes(c)).length;
  return { prismatic, mine, dead: s.length - prismatic - mine, good: Math.min(3, prismatic + mine) };
}

export const PRISMATIC_GOAL = 4;

// Orbs are rare, so a jewel base has to be perfect already: 3 sockets, all ones your class can use
// (prismatic counts). Anything less isn't worth fusing onto.
export const worthSockets = (v) => v.good >= 3 && v.dead === 0;

// "2 of 3 usable (prismatic, blue); red is no use to you"
export function socketNote(item, classId) {
  const { colours } = classOption(classId);
  const s = item.sockets ?? [];
  const usable = s.filter((c) => c === "prismatic" || colours.includes(c));
  const dead = s.filter((c) => !(c === "prismatic" || colours.includes(c)));
  const deadText = dead.length ? `; ${[...new Set(dead)].join(" and ")} ${dead.length > 1 ? "are" : "is"} no use to you` : "";
  return `${usable.length} of ${s.length} usable (${usable.join(", ")})${deadText}`;
}

// The best socket piece per slot, aiming for 4 slots with a prismatic. Returns
// { picks: { slot: item|null }, good (of 18), prismatic (pieces with one) }.
export function socketSet(items, classId, build = "original") {
  const goal = buildOf(build).prismatic;
  const best = SLOTS.map((s) => {
    const mine = items
      .filter((it) => it.slot === s)
      .map((it) => ({ it, v: socketValue(it, classId) }))
      .filter(({ v }) => worthSockets(v));
    const top = (list) => list.sort((a, b) => b.v.good - a.v.good || a.v.dead - b.v.dead)[0] ?? null;
    return { any: top([...mine]), prism: top(mine.filter((x) => x.v.prismatic > 0)) };
  });
  let plan = null;
  for (let mask = 0; mask < 1 << SLOTS.length; mask++) {
    let good = 0;
    let prism = 0;
    let ok = true;
    const picks = {};
    SLOTS.forEach((s, i) => {
      const want = mask & (1 << i) ? best[i].prism : best[i].any;
      if (mask & (1 << i) && !want) ok = false;
      picks[s] = want?.it ?? null;
      good += want?.v.good ?? 0;
      if (want?.v.prismatic) prism++;
    });
    if (!ok) continue;
    const rank = Math.min(prism, goal) * 100 + good;
    if (!plan || rank > plan.rank) plan = { rank, picks, good, prismatic: prism, goal };
  }
  return plan;
}

// ---- Keep or trash ----
// Two verdicts, each with a reason:
//   keep  - "best":    in the best combo you can make
//         - "spare":   all 3 lines are on the list (worth holding while you farm)
//         - "sockets": the best socket piece for its slot, to fuse your lines onto
//   trash - anything else, and gear for another class
export function verdicts(items, { classId = "Magician", mode = "endgame", build = "original" } = {}) {
  const { classes } = classOption(classId);
  const mine = items.filter((it) => classes.includes(it.cls));
  const res = solve(mine, mode, build, classId);
  const sockets = socketSet(mine, classId, build);
  // Every build's best combo, so each piece can say which ones it's in.
  const all = Object.fromEntries(BUILD_IDS.map((id) => [id, id === res.build ? res : solve(mine, mode, id, classId)]));
  const inBuilds = {};
  for (const [id, r] of Object.entries(all)) for (const it of Object.values(r.picks)) if (it) (inBuilds[it.id] ??= []).push(id);
  const picked = new Set(Object.values(res.picks).filter(Boolean).map((it) => it.id));
  const donor = new Set(Object.values(sockets.picks).filter(Boolean).map((it) => it.id));
  const out = {};
  for (const it of items) {
    if (!classes.includes(it.cls)) out[it.id] = { verdict: "trash", why: `${it.cls ?? "Another class"} gear` };
    else if (picked.has(it.id)) out[it.id] = { verdict: "keep", reason: "best", why: "In your best combo" };
    else if (it.lines.length === 3 && useful(it) === 3) out[it.id] = { verdict: "keep", reason: "spare", why: "Spare 3-line piece: all 3 lines are on the list" };
    else if (donor.has(it.id)) out[it.id] = { verdict: "keep", reason: "sockets", why: `For its sockets: ${socketNote(it, classId)}` };
    else out[it.id] = { verdict: "trash", why: useful(it) ? "The best combo has a better piece for this slot" : "No lines on the list" };
  }
  return { res, sockets, verdicts: out, all, inBuilds };
}
