// Saved presets: up to 5 named snapshots of your pieces and class, kept in this browser.
// Loading one goes through the same checks as a backup (see backup.js), and names are plain text.

import { sanitize } from "./backup.js?v=89";

export const PRESET_COUNT = 5;
export const NAME_MAX = 30;

// Custom mode's picks: slot -> piece id (ids are checked against the pieces when drawn).
export const cleanCustom = (raw) => Object.fromEntries(
  ["Hat", "Top", "Bottom", "Shoes", "Gloves", "Cape"]
    .map((s) => [s, raw && typeof raw === "object" ? raw[s] : null])
    .filter(([, id]) => typeof id === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(id)),
);

// A name as plain, short, single-line text.
export const cleanName = (name, i) => {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return s || `Preset ${i + 1}`;
};

// One preset from saved data, or null for an empty slot.
function cleanPreset(p, i) {
  if (!p || typeof p !== "object" || !Array.isArray(p.items)) return null;
  const { items, classId } = sanitize({ items: p.items, classId: p.classId });
  const at = Number.isFinite(p.at) ? p.at : 0;
  return { name: cleanName(p.name, i), items, classId, custom: cleanCustom(p.custom), at };
}

// Always exactly 5 slots.
export const cleanPresets = (raw) => Array.from({ length: PRESET_COUNT }, (_, i) => cleanPreset(Array.isArray(raw) ? raw[i] : null, i));

// A snapshot of the current pieces and class, for slot i (keeps its name if it had one).
export const makePreset = (state, i, name) => ({
  name: cleanName(name, i),
  items: state.items.map((it) => ({ ...it, lines: [...it.lines], sockets: [...it.sockets] })),
  classId: state.classId,
  custom: cleanCustom(state.custom),
  at: Date.now(),
});
