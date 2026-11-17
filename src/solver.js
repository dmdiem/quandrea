// Picking the best set: one item per slot. The counting idea is the same as the community's
// "3L Set Solver": walk the slots one at a time, keeping every reachable tally of target lines
// (each count capped at what the set needs), so the best tally is exact without trying every combo.
//
// Two goals:
//   endgame: the most of the 18 target lines (3 Leap, 3 White Hole, 3 Registry, 3 ATT & M.ATT, 1 of each other)
//   early:   the most skill lines of any kind (18 = a 3-line item in every slot), target lines as tiebreak

import { SLOTS, TARGETS, OTHER } from "./parse.js?v=29";

const IDX = Object.fromEntries(TARGETS.map((t, i) => [t.k, i]));
const NEED = TARGETS.map((t) => t.need);
const BASE = NEED.map((n) => n + 1);
const MUL = [];
BASE.reduce((m, b, i) => ((MUL[i] = m), m * b), 1);
export const TOTAL = NEED.reduce((a, b) => a + b, 0); // 18

const digit = (st, i) => Math.floor(st / MUL[i]) % BASE[i];
export const counts = (st) => NEED.map((_, i) => digit(st, i));
const tally = (st) => counts(st).reduce((a, b) => a + b, 0);

function add(st, lines) {
  for (const k of lines) {
    const i = IDX[k];
    if (i !== undefined && digit(st, i) < NEED[i]) st += MUL[i];
  }
  return st;
}

// How many of an item's lines are on the list (the most it could ever add).
export const useful = (item) => item.lines.filter((k) => IDX[k] !== undefined).length;

// items: [{ id, slot, lines, equipped? }]. Returns the picks and how good they are.
export function solve(items, mode = "endgame") {
  const bySlot = SLOTS.map((s) => items.filter((it) => it.slot === s));
  // Map of tally -> { score, prev, item }. score = how much we like the path so far (lines, equipped).
  let layer = new Map([[0, { extra: 0 }]]);
  const layers = [];
  for (const [si, opts] of bySlot.entries()) {
    const next = new Map();
    for (const [st, info] of layer) {
      for (const it of opts.length ? opts : [null]) {
        const ns = it ? add(st, it.lines) : st;
        // early: every line counts most. endgame: the 18 come first, then more lines in total (an
        // extra Mage line is still +1 to that skill, up to Lv. 8), then what you already wear.
        const extra = info.extra + (it ? it.lines.length * (mode === "early" ? 100 : 10) + (it.equipped ? 1 : 0) : 0);
        const cur = next.get(ns);
        if (!cur || extra > cur.extra) next.set(ns, { extra, prev: st, item: it, slot: si });
      }
    }
    layers.push(next);
    layer = next;
  }
  const value = (st, e) => (mode === "early" ? e.extra * 100 + tally(st) * 10 : tally(st) * 1000 + e.extra);
  let bestSt = 0;
  let best = null;
  for (const [st, e] of layer) if (!best || value(st, e) > value(bestSt, best)) [bestSt, best] = [st, e];

  const picks = Object.fromEntries(SLOTS.map((s) => [s, null]));
  for (let l = layers.length - 1, st = bestSt; l >= 0; l--) {
    const e = layers[l].get(st);
    if (e.item) picks[SLOTS[e.slot]] = e.item;
    st = e.prev;
  }
  // Which picked lines count toward the 18 (a 4th Leap or a 2nd Pirate is an extra).
  const run = NEED.map(() => 0);
  const counted = {};
  for (const s of SLOTS) {
    const it = picks[s];
    counted[s] = it ? it.lines.map((k) => { const i = IDX[k]; if (i === undefined || run[i] >= NEED[i]) return false; run[i]++; return true; }) : [];
  }
  const lines = SLOTS.reduce((n, s) => n + (picks[s]?.lines.length ?? 0), 0);
  return { picks, counted, counts: counts(bestSt), score: tally(bestSt), lines };
}

// "One more piece finishes it": for each slot, the lines a single new piece there would need to
// reach 18/18, keeping the best possible pieces in the other five slots. A piece holds at most 3
// lines and can't repeat one, so only gaps of up to 3 different lines count. Fewest lines first.
export function onePieceAway(items) {
  const bySlot = SLOTS.map((s) => items.filter((it) => it.slot === s));
  const out = [];
  const seen = new Set();
  for (let skip = 0; skip < SLOTS.length; skip++) {
    let layer = new Set([0]);
    for (const [si, opts] of bySlot.entries()) {
      if (si === skip) continue;
      const next = new Set();
      for (const st of layer) for (const it of opts.length ? opts : [null]) next.add(it ? add(st, it.lines) : st);
      layer = next;
    }
    for (const st of layer) {
      if (tally(st) < TOTAL - 3) continue;
      const need = TARGETS.flatMap((t, i) => Array(t.need - digit(st, i)).fill(t.k));
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
export const missing = (res) => TARGETS.flatMap((t, i) => Array(t.need - res.counts[i]).fill(t.k));

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

// Worth fusing your lines onto: a prismatic socket, or at least 2 sockets you can use. One usable
// socket next to dead ones isn't worth an Orb; prismatic + your colour is the usual stepping stone.
export const worthSockets = (v) => v.prismatic > 0 || v.good >= 2;

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
export function socketSet(items, classId) {
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
    const rank = Math.min(prism, PRISMATIC_GOAL) * 100 + good;
    if (!plan || rank > plan.rank) plan = { rank, picks, good, prismatic: prism };
  }
  return plan;
}

// ---- Keep or trash ----
// Two verdicts, each with a reason:
//   keep  - "best":    in the best combo you can make
//         - "spare":   all 3 lines are on the list (worth holding while you farm)
//         - "sockets": the best socket piece for its slot, to fuse your lines onto
//   trash - anything else, and gear for another class
export function verdicts(items, { classId = "Magician", mode = "endgame" } = {}) {
  const { classes } = classOption(classId);
  const mine = items.filter((it) => classes.includes(it.cls));
  const res = solve(mine, mode);
  const sockets = socketSet(mine, classId);
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
  return { res, sockets, verdicts: out };
}
