// Backups: your scanned items as a short code you can copy, keep, and paste back later.
//
// Importing never trusts the code. Everything is rebuilt from scratch out of known values: slots,
// classes, line and socket names come from fixed lists, cells must be in the grid, and anything
// else (unknown fields, odd strings, HTML, "__proto__" tricks, huge inputs) is dropped. The page
// never runs or displays text from a backup as-is.

import { SLOTS, TARGETS, FILLERS, OTHER } from "./parse.js?v=48";
import { CLASSES, CLASS_OPTIONS } from "./solver.js?v=48";

const PREFIX = "QUANDREA1:";
export const MAX_CODE = 500_000; // characters; a full bag is far smaller
const MAX_ITEMS = 1000;
const LINES = new Set([...TARGETS.map((t) => t.k), ...FILLERS.map((f) => f.k), OTHER]);
const SOCKETS = new Set(["prismatic", "blue", "red", "green", "purple", "grey"]);
const CELLS = new Set(["empty", "item", "lines"]);
const CLASS_IDS = new Set(CLASS_OPTIONS.map((o) => o.id));

export const looksLikeBackup = (text) => typeof text === "string" && text.trim().startsWith(PREFIX);

// Base64 of UTF-8 text, in the browser and in Node.
const toB64 = (s) => (typeof btoa === "function" ? btoa(String.fromCharCode(...new TextEncoder().encode(s))) : Buffer.from(s, "utf8").toString("base64"));
const fromB64 = (b) => (typeof atob === "function" ? new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))) : Buffer.from(b, "base64").toString("utf8"));

export function exportCode(state) {
  const clean = sanitize(state); // only ever write what an import would accept
  return PREFIX + toB64(JSON.stringify({ app: "quandrea", v: 1, ...clean, items: clean.items.map(({ id, key, ...it }) => it) }));
}

// Returns a clean { items, classId, mode, cells, mapPinned }, or throws with a message for people.
export function importCode(text) {
  if (typeof text !== "string") throw new Error("That isn't a Quandrea backup.");
  const t = text.trim();
  if (t.length > MAX_CODE) throw new Error("That backup is too big.");
  if (!t.startsWith(PREFIX)) throw new Error("That isn't a Quandrea backup.");
  const body = t.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/=]*$/.test(body)) throw new Error("That backup is damaged.");
  let raw;
  try {
    raw = JSON.parse(fromB64(body));
  } catch {
    throw new Error("That backup is damaged.");
  }
  if (!raw || typeof raw !== "object" || raw.app !== "quandrea") throw new Error("That isn't a Quandrea backup.");
  return sanitize(raw);
}

const pick = (v, set, fallback) => (typeof v === "string" && set.has(v) ? v : fallback);

// Rebuild saved data from known values only. Also used on what's in this browser's storage.
export function sanitize(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const items = [];
  for (const it of Array.isArray(src.items) ? src.items.slice(0, MAX_ITEMS) : []) {
    if (!it || typeof it !== "object") continue;
    const slot = pick(it.slot, new Set(SLOTS), null);
    if (!slot) continue;
    const cls = pick(it.cls, new Set(CLASSES), null);
    const lines = (Array.isArray(it.lines) ? it.lines : []).filter((k) => typeof k === "string" && LINES.has(k)).slice(0, 3);
    const sockets = (Array.isArray(it.sockets) ? it.sockets : []).filter((c) => typeof c === "string" && SOCKETS.has(c)).slice(0, 3);
    const m = typeof it.cell === "string" && /^(\d{1,2}),(\d)$/.exec(it.cell);
    const cell = m && +m[1] < 16 && +m[2] < 8 ? `${+m[1]},${+m[2]}` : null;
    // The stat fingerprint tells two otherwise identical pieces apart: digits and + only.
    const stats = typeof it.stats === "string" ? it.stats.replace(/[^0-9+]/g, "").slice(0, 60)
      : String(it.key ?? "").split("|").at(-1).replace(/[^0-9+]/g, "").slice(0, 60);
    const key = [slot, cls, lines.join(","), stats].join("|");
    const id = typeof it.id === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(it.id) ? it.id : newId();
    items.push({ id, key, slot, cls, lines, sockets, equipped: it.equipped === true, cell, stats });
  }
  // One item per cell, one equipped piece per slot, no repeated ids.
  const cellsSeen = new Set();
  const equippedSeen = new Set();
  const ids = new Set();
  for (const it of items) {
    if (it.cell && cellsSeen.has(it.cell)) it.cell = null;
    if (it.cell) cellsSeen.add(it.cell);
    if (it.equipped && equippedSeen.has(it.slot)) it.equipped = false;
    if (it.equipped) equippedSeen.add(it.slot);
    if (ids.has(it.id)) it.id = newId();
    ids.add(it.id);
  }
  const cells = (Array.isArray(src.cells) ? src.cells.slice(0, 16 * 8) : []).map((c) => pick(c, CELLS, "empty"));
  return {
    items,
    classId: src.classId === "Pirate" ? "Pirate (STR)" : pick(src.classId, CLASS_IDS, "Magician"),
    mode: pick(src.mode, new Set(["endgame", "early"]), "endgame"),
    cells,
    mapPinned: src.mapPinned === true && cells.length > 0,
  };
}

let counter = 0;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${counter++}`;
