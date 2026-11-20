// The page: the inventory map (from a pasted screenshot), typing in pieces, and drawing everything.

import { SLOTS, TARGETS, FILLERS, isTarget, parseTooltip } from "./parse.js?v=80";
import { verdicts, solve, missing, TOTAL, CLASSES, classOption, socketValue, socketNote, BUILDS, BUILD_IDS, buildOf, findSame, fitsBuild, socketSet, onePieceAway, solveOptions, CORE_NEED, FLEX_TOTAL } from "./solver.js?v=80";
import { STEPS, STEP_NAME, OPTIONS } from "./options.js?v=80";
import { exportCode, importCode, looksLikeBackup, sanitize } from "./backup.js?v=80";
import { cleanPresets, cleanName, makePreset, cleanCustom, NAME_MAX } from "./presets.js?v=80";
import { findTooltips, findIcon, findSockets, prepareForOcr, resizeImage } from "./vision.js?v=80";

const KEY = "quandrea.v1";
// Two builds (General, Bossing): the optimizer solves all of them, the progress panel shows
// the one you pick, and each piece says which builds' best combos it's in.
const $ = (id) => document.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", dmg: "DMG", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), ...FILLERS.map((f) => [f.k, f.name])]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];

let state = { items: [], classId: "Magician", mode: "endgame" };
let piecesOpen = false; // the "each piece" section; kept across redraws and remembered
try {
  piecesOpen = localStorage.getItem("quandrea.piecesOpen") === "1";
} catch {}
let confirmClear = false;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !Array.isArray(raw.items)) return;
    // Saved data goes through the same checks as an imported backup.
    const ui = {
      cb: raw.cb === true,
      simple: raw.simple === true,
      scale: typeof raw.scale === "number" && raw.scale > 0.3 && raw.scale < 3 ? raw.scale : undefined,
    };
    ui.build = BUILD_IDS.includes(raw.build) || raw.build === "custom" ? raw.build : "original";
    ui.custom = cleanCustom(raw.custom);
    state = { ...state, ...ui, ...sanitize(raw), presets: cleanPresets(raw.presets), activePreset: Number.isInteger(raw.activePreset) ? raw.activePreset : null };
  } catch {}
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

// Messages ("Added a hat ✓", "Saved to preset 1") pop up at the bottom of the screen and fade out,
// floating over the page so nothing moves.
let statusTimer = null;
function setStatus(text) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("show", Boolean(text));
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// Simple mode's readout: for each tooltip in a pasted screenshot (left = the hovered item, right = equipped),
// its socket colours as big words.
const SIMPLE_WORD = { red: "Red", green: "Green", blue: "Blue", purple: "Purple", grey: "Grey", prismatic: "Prismatic" };
let simpleLast = "";
// Simpling Dumpling mode only names socket colours, so it doesn't rely on the game-size guess from
// the inventory: it tries a few sizes for finding the tooltips (keeping the one that last worked)
// and reads the droplets straight off the screen, at whatever size they're drawn.
const SIMPLE_SIZES = [1, 0.9, 0.8, 0.7, 0.63, 1.25, 1.5, 1.75, 2];
let simpleSize = null;
// A real tooltip's item picture sits at its top left and is about a quarter of its width.
function iconFits(box, icon) {
  if (!icon) return false;
  const ratio = icon.size / box.width;
  return ratio > 0.17 && ratio < 0.32 && icon.x - box.x < box.width * 0.2;
}
function readSimple(img) {
  const at = (s) => {
    const reads = findTooltips(img, s).map((box) => ({ box, icon: findIcon(img, box) })).filter(({ box, icon }) => iconFits(box, icon)).slice(0, 2).map(({ icon }) => findSockets(img, icon));
    return { s, reads, n: reads.filter((r) => r.length).length };
  };
  if (simpleSize) {
    const r = at(simpleSize);
    if (r.n && r.n === r.reads.length) return r.reads;
  }
  let best = null;
  for (const s of SIMPLE_SIZES) {
    const r = at(s);
    if (!best || r.n > best.n) best = r;
    if (r.n === 2) break;
  }
  if (best.n) simpleSize = best.s;
  if (best.n) return best.reads;
  // No tooltip: maybe it's a snip of just the item picture. Read its sockets on their own.
  const icon = findIcon(img, undefined, { anywhere: true });
  const alone = icon ? findSockets(img, icon) : [];
  return alone.length ? [alone] : best.reads;
}
// Change the words only when two frames in a row agree, so a tooltip fading in can't flash
// the wrong colours.
let simplePending = null;
function showSimple(img, { now = false } = {}) {
  const { colours } = classOption(state.classId);
  const read = img ? readSimple(img) : [];
  const sig = JSON.stringify(read);
  if (!now && sig !== simplePending) {
    simplePending = sig;
    return;
  }
  simplePending = sig;
  // Always the same two cards with three socket rows each, so nothing jumps as you hover around.
  const card = (label, list) => `<div class="simple-card"><span class="label">${label}</span>
        <div class="simple-words">${[0, 1, 2].map((k) => {
          const c = list?.[k];
          if (!c) return `<span class="simple-word empty">${k === 0 ? (list ? (list.length ? "" : "Couldn't see its jewels") : "–") : ""}</span>`;
          return `<span class="simple-word"><span class="sock ${c}"></span>${SIMPLE_WORD[c] ?? c}${c === "prismatic" || colours.includes(c) ? ' <b title="Your class can use this colour">✓</b>' : ""}</span>`;
        }).join("")}</div></div>`;
  const html = card("Hovered item", read[0]) + card("Equipped", read[1]);
  if (html !== simpleLast) {
    simpleLast = html;
    $("simple-out").innerHTML = html;
  }
  $("simple-status").textContent = "Read from your screenshot.";
}

// Add an item, or update it if this exact one was read before. Returns the stored item.
function remember(p) {
  // Sockets aren't part of the key.
  const key = [p.slot, p.cls, p.lines.join(","), p.stats].join("|");
  // Same item read before (older saves called Boss DMG / Ignore DEF / Damage just "Other"): match
  // on slot, class, stats and the lines on the list, then refresh its lines.
  const coreOf = (lines) => lines.filter(isTarget).join(",");
  let item = state.items.find((it) => it.key === key)
    ?? state.items.find((it) => it.slot === p.slot && it.cls === p.cls && it.key?.endsWith(`|${p.stats}`) && coreOf(it.lines) === coreOf(p.lines));
  if (item && item.key !== key) {
    item.key = key;
    item.lines = p.lines;
  }
  if (item) {
    if (p.sockets.length) item.sockets = p.sockets;
  }
  else {
    item = { id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), key, slot: p.slot, cls: p.cls, lines: p.lines, sockets: p.sockets, equipped: false, cell: p.cell ?? null };
    state.items.push(item);
  }
  save();
  return item;
}

// ---------- drawing ----------

// extra: a copy beyond what the 18 need. Still +1 to that skill (they go to Lv. 8), just not best in slot.
const chip = (k, extraCopy = false) => chipHtml(k, extraCopy && isTarget(k)); // filler is never an "extra"
// Simple line icons for each slot, drawn in the text colour.
const SLOT_PATHS = {
  Hat: '<path d="M2.5 13.5c1.8 3 5.4 4.4 9.5 4.4s7.7-1.4 9.5-4.4"/><path d="M7 15.6c0-4.4.7-8.3 2.2-9.2.9-.5 1.8.5 2.8.5s1.9-1 2.8-.5c1.5.9 2.2 4.8 2.2 9.2"/><path d="M7.2 12.6h9.6"/>',
  Top: '<path d="M9 4 4.5 6.5l1.8 4 2.2-1V20h7V9.5l2.2 1 1.8-4L15 4c-.6 1.6-1.6 2.5-3 2.5S9.6 5.6 9 4z"/>',
  Bottom: '<path d="M7 4h10l1.2 16h-4.4L12 10.5 10.2 20H5.8z"/><path d="M7 7h10"/>',
  Cape: '<path d="M8.5 4h7l1.2 3.2C19 11 20 15.5 20 20H4c0-4.5 1-9 3.3-12.8z"/><path d="M8.5 4c.8 2 2 3 3.5 3s2.7-1 3.5-3"/>',
  Gloves: '<path d="M8 21v-4.2L5.1 13.4c-.8-1 .4-2.5 1.6-1.7L8 12.7V6.4a1 1 0 0 1 2 0V11V4.6a1 1 0 0 1 2 0V11V5.2a1 1 0 0 1 2 0V11V7a1 1 0 0 1 2 0v8.4c0 3-1.2 5.6-3.4 5.6z"/><path d="M8 18.4h7.4"/>',
  Shoes: '<path d="M7 4h5v8.5l5 2.4A3 3 0 0 1 19 17.6V19H6z"/><path d="M6 16h13"/><path d="M12 7h-5"/>',
};
const slotIcon = (slot) => `<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SLOT_PATHS[slot] ?? ""}</svg>`;
// A symbol for each line, so they're easy to tell apart without colour: a leap, a white hole, a
// ledger (Registry), sword and wand (ATT & M.ATT), a target (Crit), a burst (Damage), and for the classes a sword,
// wand, bow and arrow, shuriken and anchor.
const CLASS_PATHS = {
  leap: '<path d="M3.5 19.5C5 10 13 5.5 19.5 11"/><path d="M19.5 11l-4.8.3M19.5 11l.6-4.7"/><path d="M3 21h4"/>',
  wh: '<ellipse cx="12" cy="16" rx="9" ry="4"/><ellipse cx="12" cy="16" rx="4" ry="1.6"/><path d="M12 3v6M6.5 5l2.2 4.5M17.5 5l-2.2 4.5"/>',
  reg: '<path d="M6 3h9l3.5 3.5V21H6z"/><path d="M15 3v3.5h3.5"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>',
  atk: '<path d="M4 4l10 10"/><path d="M11.5 16.5l5-5"/><path d="M14 14l5.5 5.5"/><path d="M20 4 6 18"/><path d="M4.5 19.5 6 18"/><path d="M19.5 2.8l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" stroke-width="1.2"/>',
  dmg: '<path d="M12 2.5l1.9 5.3 5.4-1.6-2.8 4.9 4.9 2.6-5.6.9.5 5.6L12 16.3l-4.3 3.9.5-5.6-5.6-.9 4.9-2.6-2.8-4.9 5.4 1.6z"/>',
  crit: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  warrior: '<path d="M19.5 4.5 18.8 9 9.6 18.2 5.8 14.4 15 5.2z"/><path d="M4.2 12.8l7 7"/><path d="M7.4 16.6 3.8 20.2"/>',
  mage: '<path d="M4 20 14 10"/><path d="M17 2.8l1.1 2.9 2.9 1.1-2.9 1.1L17 10.8l-1.1-2.9L13 6.8l2.9-1.1z"/>',
  archer: '<path d="M5 3.5c9 0 15.5 6.5 15.5 15.5"/><path d="M5 3.5 7.5 16.5 20.5 19" stroke-width="1.2"/><path d="M7.5 16.5 20.5 3.5"/><path d="M15.5 3.5h5v5"/><path d="M4 20l3.5-3.5M4 17.5h2.5M6.5 20v-2.5" stroke-width="1.5"/>',
  thief: '<path d="M12 2.5l2 7.5 7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2z"/><circle cx="12" cy="12" r="1.3"/>',
  pirate: '<circle cx="12" cy="4.6" r="2"/><path d="M12 6.6V21"/><path d="M8.2 10h7.6"/><path d="M4.8 14.2c0 3.9 3.2 6.8 7.2 6.8s7.2-2.9 7.2-6.8"/><path d="M3 16l1.8-1.8L6.6 16"/><path d="M17.4 16l1.8-1.8L21 16"/>',
};
const classIcon = (k) => (CLASS_PATHS[k] ? `<svg class="class-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CLASS_PATHS[k]}</svg>` : "");
const icon = (k) => classIcon(k);
const chipHtml = (k, extra) => `<span class="chip k-${k}${extra ? " extra" : ""}"${extra ? ' title="Extra copy: still +1 to the skill, but a line you\'re missing would do more here"' : ""}>${icon(k)}${NAME[k]}${extra ? '<small>extra</small>' : ""}</span>`;
// Sockets drawn as the jewel that fits them (cropped from the game's jewel inventory).
// A socket, drawn as a filled droplet in its colour. In colour-blind mode it also carries a letter.
const SOCK_WORD = { red: "Red", green: "Green", blue: "Blue", purple: "Purple", grey: "Grey", prismatic: "Prismatic" };
// Colour-blind mode: the colour's name as a word, so nothing depends on seeing the colour.
const jewel = (c) => (state.cb
  ? `<span class="sock-word" title="${c} socket"><span class="sock ${c}"></span>${SOCK_WORD[c] ?? c}</span>`
  : `<span class="sock ${c}" title="${c} socket"></span>`);
const socks = (list) => (list?.length ? `<span class="socks">${list.map(jewel).join("")}</span>`
  : `<span class="socks none-yet muted small" title="No jewels entered for this piece">no jewels</span>`);
const linesOf = (it) => (it.lines.length ? it.lines.map((k) => chip(k)).join("") : `<span class="muted">no lines</span>`);

function render() {
  renderPresets();
  // Always aims for the real 18 (an older "any 3 lines" setting in a save is ignored).
  // Core + flex: the 13 lines both builds share, plus 5 flex lines (class, Crit DMG or Damage). The
  // General / Bossing choice only says which flex lines to favour.
  // Custom: you pick a piece per slot (starting from the General best combo) and see its totals.
  const custom = state.build === "custom";
  const build = buildOf(custom ? "original" : state.build);
  const v = verdicts(state.items, { ...state, mode: "endgame", build: build.id });
  const { sockets, all, inBuilds } = v;
  // Ties: other outfits with the same score (each missing something different). Option 1 is the
  // recommended one; the arrows cycle through the rest.
  const options = custom ? [v.res] : solveOptions(state.items.filter((it) => classOption(state.classId).classes.includes(it.cls)), "endgame", build.id, state.classId);
  // The arrows wrap around: › on the last option goes back to option 1, ‹ on option 1 to the last.
  const optIdx = (((state.optIdx?.[build.id] ?? 0) % options.length) + options.length) % options.length;
  const res = options[optIdx] ?? v.res;
  // The board's fixed rows: the lines this build needs (in Flex, the 13 shared ones; its other 5 go in
  // one "Any 5" row that shows which line fills each spot).
  const rowNeed = build.flexCap ? CORE_NEED : build.need;
  const option = classOption(state.classId);

  $("class").innerHTML = CLASSES.map((c) => `<option ${c === option.cls ? "selected" : ""}>${c}</option>`).join("");
  // Pirates pick STR or DEX (a DEX pirate can also use purple sockets).
  $("pirate-stat").hidden = option.cls !== "Pirate";
  for (const st of ["STR", "DEX"]) $(`pirate-${st}`).setAttribute("aria-pressed", String(option.stat === st));
  $("cb-toggle").setAttribute("aria-pressed", String(Boolean(state.cb)));
  // Simple mode hides everything but the jewel colour readout.
  $("simple").hidden = !state.simple;
  document.querySelector(".layout").hidden = Boolean(state.simple);
  $("simple-toggle").setAttribute("aria-pressed", String(Boolean(state.simple)));
  $("simple-toggle").textContent = state.simple ? "Back to full page" : "Simpling Dumpling mode";
  // Start over wipes everything (items, equipped pieces, the map), so it lives with the page-wide settings.
  $("clear").hidden = !state.items.length;
  $("clear").textContent = confirmClear ? "Click again: clear everything" : "Start over";
  $("clear").classList.toggle("danger", confirmClear);
  document.documentElement.classList.toggle("cb", Boolean(state.cb));

  // Everything shows your best combo: what to wear, from all the pieces you've added. (What you have
  // on in game isn't tracked: you'd have to keep it in sync by hand.)
  const shown = res;
  const head = shown.score;
  // Split the counted lines of a set into the core rows and the flex row (in slot order).
  const split = (set) => {
    const coreAt = Object.fromEntries(TARGETS.map((t) => [t.k, []]));
    const flex = [];
    for (const s of SLOTS) set.picks[s]?.lines.forEach((k, j) => {
      if (!set.counted[s][j]) return;
      const i = TARGETS.findIndex((t) => t.k === k);
      // In Flex, an "any 5" line goes in its own line's row too (a 2nd Crit DMG, a Thief line).
      if (coreAt[k].length < rowNeed[i] || build.flexCap) coreAt[k].push(s);
      else flex.push({ k, slot: s });
    });
    return { coreAt, flex };
  };
  const board = split(res);
  // Just the slot's icon (its name on hover); an empty dashed box when the line is missing.
  // A filled spot shows the icon of the equipment that gives the line; a missing one is a faint dot.
  const cell = (k, slot, any = false) => `<span class="pip ${slot ? "on" : ""}${any ? " any" : ""}" title="${slot ? (any ? `${slot}: Flex` : slot) : "Missing"}" aria-label="${slot ?? "Missing"}">${slot ? slotIcon(slot) : ""}</span>`;
  // Extra copies (beyond the 1 or 3 that count) in the best combo: still +1 to the skill.
  const extras = Object.fromEntries(TARGETS.map((t) => [t.k, []]));
  for (const s of SLOTS) res.picks[s]?.lines.forEach((k, j) => !res.counted[s][j] && extras[k] && extras[k].push(s));
  // A copy past what counts (a 4th Leap, a 2nd Crit DMG in General, a class line once Flex's 5 are
  // full): a red box with that piece's icon. Still +1 to the skill.
  const leftNote = (slots) => slots.map((sl) => `<span class="pip on left" title="Excess (${sl.toLowerCase()}): past what counts toward 18${build.flexCap ? " (all 5 Flex spots are full)" : ""}. Still +1 to the skill." aria-label="Excess, ${sl}">${slotIcon(sl)}</span>`).join("");
  const spots = (t) => board.coreAt[t.k];
  // Still missing: the lines this set doesn't have yet, with how many of each.
  const gaps = missing(shown);
  // A line this build doesn't count at all (a class line in Bossing, Damage in General) is drawn like
  // Boss DMG, not as an "extra".
  const inBuild = (k) => build.need[TARGETS.findIndex((t) => t.k === k)] > 0;
  const offChip = (k) => `<span class="chip k-${k} off" title="Not part of ${build.name}">${icon(k)}${NAME[k]}</span>`;
  // In Flex, rows for the 13 shared lines plus a row for each other line you have (class, Damage),
  // and the Crit DMG row grows to hold its extra copies that count.
  const rowsOf = TARGETS.map((t, i) => ({ t, n: Math.max(rowNeed[i], build.flexCap ? board.coreAt[t.k].length : 0) }))
    .filter((r) => r.n > 0 || (build.flexCap && extras[r.t.k].length));
  const boardRow = ({ t, n }) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${(() => { const sp = spots(t); return Array.from({ length: n }, (_, j) => cell(t.k, sp[j], Boolean(build.flexCap) && j >= rowNeed[TARGETS.indexOf(t)])).join("") + leftNote(extras[t.k]); })()}</div></div>`;

  // One button per build with its best score, so you can see which suits your gear.
  const buildPick = `<div class="build-pick" role="group" aria-label="Which BiS">${BUILD_IDS.map((id) => `<button data-build="${id}" aria-pressed="${!custom && id === build.id}" title="${BUILDS[id].about}"><span>${BUILDS[id].short}</span><b>${all[id].score}/${TOTAL}</b></button>`).join("")}<button data-build="custom" aria-pressed="${custom}" title="Pick any piece for each slot and see its totals"><span>Custom</span><b>your pick</b></button></div>${custom ? `<p class="muted small build-note">Your own outfit: click <b>Use</b> on a piece in Your pieces to put it in. It starts as your General best combo.</p>` : build.note ? `<p class="muted small build-note">${build.note}${build.flexCap ? ` <span class="legend-any"></span> = Flex.` : ""}</p>` : ""}`;
  const gapCount = gaps.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
  // Progress, beside Add a piece so it moves as you add: the score, what you wear now, the 18-line
  // board and what's still missing.
  const flexLeft = build.flexCap ? FLEX_TOTAL - res.flex : 0;
  $("progress").innerHTML = `<h2>Hologram lines</h2>
    ${buildPick}
    <div class="score"><span class="big">${head}</span><span class="muted">/ ${TOTAL} with your best combo</span></div>
    ${options.length > 1 ? `<div class="opt-cycle"><button class="ghost" data-opt="-1" aria-label="Previous option">‹</button>
      <span>Option <b>${optIdx + 1}</b> of ${options.length} · ${optIdx === 0 ? "recommended" : "same score"}${gaps.length ? `, missing ${[...new Set(gaps)].map((k) => NAME[k]).join(", ")}` : ""}</span>
      <button class="ghost" data-opt="1" aria-label="Next option">›</button></div>` : ""}
    <div class="board" style="grid-template-rows: repeat(${Math.ceil(rowsOf.length / 2)}, auto)">${rowsOf.map(boardRow).join("")}</div>
    ${gaps.length || flexLeft ? `<div class="hunt"><span class="label">Still missing · ${gaps.length + flexLeft}</span><div class="lines">${[...gapCount].map(([k, n]) => `${chip(k)}${n > 1 ? `<span class="times">×${n}</span>` : ""}`).join("")}${flexLeft ? `<span class="chip flex-chip" title="Any class line (each class once), a 2nd or 3rd Crit DMG, or Damage">✦ Any: class · Crit · Damage</span>${flexLeft > 1 ? `<span class="times">×${flexLeft}</span>` : ""}` : ""}</div></div>` : `<p class="act on">All 18 ✓</p>`}
    ${dropsHtml(onePieceAway(state.items.filter((it) => option.classes.includes(it.cls)), build.id), res)}
    ${jewelProgress(sockets, option, res)}`;
  if (typeof draft !== "undefined") $("add-panel").innerHTML = addForm();
  $("lines").innerHTML = `
    <div class="row spread"><h2>What to wear</h2></div>
    <section class="set pieces always-open" id="pieces">
      <div class="pieces-head"><span class="label">Best combo · ${build.short}</span></div>
      <p class="muted small">Faded <b>extra</b> = a line you already have 3 (or 1) of.</p>
      <div class="pieces-list">${SLOTS.map((s) => {
          const it = shown.picks[s];
          if (!it) return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span><span class="none">nothing added yet</span></div>`;
          return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span>
            <span class="lines">${it.lines.map((k, j) => (inBuild(k) ? chip(k, !shown.counted[s][j]) : offChip(k))).join("") || `<span class="muted">no lines</span>`}</span>
            <span class="piece-socks">${socks(it.sockets)}</span></div>`;
        }).join("")}
        <div class="piece totals"><span class="piece-slot">Sockets</span><span class="muted small">${(() => { const v3 = SLOTS.map((s) => shown.picks[s] && socketValue(shown.picks[s], state.classId)).filter(Boolean); return `${v3.reduce((n, x) => n + x.good, 0)}/18 usable · ${v3.filter((x) => x.prismatic).length}/${build.prismatic} prismatic pieces`; })()}</span></div>
      </div>
    </section>
`;

  // Custom: your picks (or the General best piece where you haven't picked), and their totals.
  const mine = new Set(option.classes);
  const outfit = Object.fromEntries(SLOTS.map((s) => [s, state.items.find((it) => it.id === state.custom?.[s] && it.slot === s && mine.has(it.cls)) ?? res.picks[s] ?? null]));
  if (custom) renderCustom(outfit, buildPick, option);

  // Your pieces: everything you've added, by slot, BiS first.
  const inBest = new Set(Object.values(custom ? outfit : res.picks).filter(Boolean).map((it) => it.id));
  // Which builds' best combos each piece is in (the one you're looking at first and solid).
  const buildTags = (it) => {
    // Which builds' perfect 18/18 set this piece could be part of (all 3 lines used). Flex takes
    // anything that fits either, so pieces are tagged General and/or Bossing only.
    // General takes almost any line, so only the Bossing tag tells you something.
    const ids = ["eu"].filter((id) => fitsBuild(it, id));
    return ids.length ? `<span class="build-tags" title="All 3 lines fit a perfect set for: ${ids.map((id) => BUILDS[id].name).join(", ")}">${ids.map((id) => `<span class="bt${id === build.id ? " on" : ""}">${BUILDS[id].short}</span>`).join("")}</span>` : "";
  };
  // The best piece per slot to fuse your lines onto with an Orb (its jewel sockets), worth keeping.
  const forJewels = new Set(Object.values(sockets.picks).filter(Boolean).map((it) => it.id));
  const jewelTag = (it) => (!forJewels.has(it.id) ? ""
    : inBest.has(it.id) ? `<span class="act jewels" title="Perfect sockets and in your best combo: no Orb needed">Perfect jewels ✓</span>`
    : `<span class="act jewels" title="Perfect sockets for this slot (${socketNote(it, state.classId)}): keep it to move your lines onto with an Orb">For jewels</span>`);
  // Each slot leads with its BiS piece (the best combo for the build you picked), highlighted.
  const list = [...state.items].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || inBest.has(b.id) - inBest.has(a.id));
  const status = (it) => (custom ? (inBest.has(it.id) ? `<span class="act on">In use ✓</span>` : mine.has(it.cls) ? `<button class="act swap" data-use="${it.id}" title="Put this in your Custom outfit">Use</button>` : "")
    : inBest.has(it.id) ? `<span class="act on" title="Best in slot for ${build.name}">BiS ✓</span>`
    : forJewels.has(it.id) || BUILD_IDS.some((id) => fitsBuild(it, id)) ? "" : `<span class="muted small">spare</span>`);
  // Another class's gear never counts: say so loudly, with a one-click fix for a misread title.
  const notMine = (it) => !option.classes.includes(it.cls);
  const classWarn = (it) => (notMine(it) ? `<div class="class-warn">⚠ ${it.cls ?? "Unknown"} gear: not counted for you <button class="linkish" data-mine="${it.id}" title="The screenshot's class was misread: make it ${option.cls} gear">It's ${option.cls} gear</button></div>` : "");
  // Hologram gear always has 3 skill lines: fewer means one wasn't read.
  const linesWarn = (it) => (it.lines.length < 3 ? `<div class="lines-warn">⚠ Only ${it.lines.length} skill${it.lines.length === 1 ? "" : "s"}: one is probably missing <button class="linkish" data-edit="${it.id}">Edit</button></div>` : "");
  const row = (it) => `<div class="bag-row${inBest.has(it.id) ? " best-row" : ""}${recentIds.has(it.id) ? " new-row" : ""}${notMine(it) ? " other-class" : ""}">
      ${classWarn(it)}${linesWarn(it)}<div class="bag-top">${status(it)}${buildTags(it)}${jewelTag(it)}
        <span class="bag-act"><button class="equip-btn" data-edit="${it.id}" title="Change its jewels, skills or slot">Edit</button><button class="x" data-del="${it.id}" aria-label="Remove">×</button></span></div>
      <div class="lines">${linesOf(it)}</div>
      ${socks(it.sockets)}
    </div>`;
  $("items").innerHTML = `
    <h2>Your pieces</h2>
    ${state.items.length ? `<div class="slots">${SLOTS.map((sl) => {
      const here = list.filter((it) => it.slot === sl);
      return `<div class="slot"><div class="slot-head"><h3>${slotIcon(sl)}${sl}</h3><span class="tag">${here.length}</span></div>
        ${here.length ? here.map(row).join("") : `<div class="none">Nothing added yet</div>`}</div>`;
    }).join("")}</div>` : `<p class="none">Nothing added yet: fill pieces in with <b>Add a piece</b>.</p>`}`;
}

// ---------- add manually ----------
// Tap a slot, up to 3 lines and up to 3 sockets, then Add. The slot stays picked for the next one.
const freshDraft = () => ({ slot: null, lines: [], sockets: [] });
let draft = freshDraft();
let addMsg = ""; // "Added a hat ✓", shown in the panel after each piece
// Add a piece: click the equipment, its jewels and its skills, then Add.
function pick(kind, v) {
  if (kind === "slot") draft.slot = draft.slot === v ? null : v; // click it again to unpick
  else if (kind === "sock") {
    // A prismatic socket is always the leftmost one in the game.
    if (draft.sockets.length < 3) draft.sockets = v === "prismatic" ? [v, ...draft.sockets] : [...draft.sockets, v];
  } else {
    // Picking a skill twice takes it back; Other can repeat (Boss + IED are both not BiS).
    if (draft.lines.includes(v)) draft.lines = draft.lines.filter((x) => x !== v);
    else if (draft.lines.length < 3) draft.lines = [...draft.lines, v];
  }
  render();
}

// Equipment and jewels sit side by side, three across, in this order.
const GRID_ORDER = {
  slot: ["Hat", "Top", "Cape", "Bottom", "Shoes", "Gloves"],
  sock: ["prismatic", "blue", "red", "green", "purple", "grey"],
};
const KEY_SHORT = { leap: "Leap", wh: "White Hole", reg: "Registry", atk: "ATT & M.ATT", crit: "Crit DMG", warrior: "Warrior", mage: "Mage", archer: "Bowman", thief: "Thief", pirate: "Pirate", boss: "Boss DMG", ied: "Ignore DEF", dmg: "Damage" };

function addForm() {
  const count = (list, v) => list.filter((x) => x === v).length;
  const option = (kind, v) => {
    let on, label;
    if (kind === "slot") {
      on = draft.slot === v;
      label = `${slotIcon(v)}<span>${v}</span>`;
    } else if (kind === "sock") {
      on = draft.sockets.includes(v);
      label = `<span class="sock ${v}"></span><span>${SOCK_WORD[v]}${count(draft.sockets, v) > 1 ? ` ×${count(draft.sockets, v)}` : ""}</span>`;
    } else {
      on = draft.lines.includes(v);
      label = `${classIcon(v)}<span>${KEY_SHORT[v]}</span>`;
    }
    const full = (kind === "sock" && draft.sockets.length >= 3) || (kind === "line" && draft.lines.length >= 3 && !on);
    // A picked jewel gets a small "−" to take one off (clicking the jewel itself adds another).
    const minus = kind === "sock" && on ? `<span class="minus" data-unpick-sock="${v}" title="Take one ${SOCK_WORD[v]} off">−</span>` : "";
    return `<button class="keycap kind-${kind}${kind === "line" && !isTarget(v) ? " filler" : ""}${on ? " on" : ""}" data-pick-${kind}="${v}"${full && !(kind === "sock" && on) ? " disabled" : ""}>${label}${minus}</button>`;
  };
  // A mock of the game's tooltip, built as you click: the three jewel sockets on top, the equipment
  // in the middle, the three skill lines under it. Click a jewel or a line to take it off.
  const mockSocks = [0, 1, 2].map((i) => (draft.sockets[i]
    ? `<button class="mt-sock" data-unsock="${i}" title="${SOCK_WORD[draft.sockets[i]]} (click to remove)"><span class="sock ${draft.sockets[i]}"></span></button>`
    : `<span class="mt-sock empty" title="No jewel"></span>`)).join("");
  const mockLines = [0, 1, 2].map((i) => (draft.lines[i]
    ? `<button class="mt-line${isTarget(draft.lines[i]) ? "" : " filler"}" data-unline="${i}" title="Click to remove">${classIcon(draft.lines[i])}[Hologram] ${KEY_SHORT[draft.lines[i]]} Lv. +1</button>`
    : `<span class="mt-line empty">skill line ${i + 1}</span>`)).join("");
  const mock = `<div class="mock-tip" aria-label="The piece so far">
      <div class="mt-name">${draft.slot ? `${draft.slot}` : "Pick the equipment"}</div>
      ${draft.cls && !classOption(state.classId).classes.includes(draft.cls) ? `<div class="class-warn">⚠ ${draft.cls} gear: not counted for you <button class="linkish" data-draft-mine="1" title="The screenshot's class was misread">It's ${classOption(state.classId).cls} gear</button></div>` : ""}
      <div class="mt-frame">
        <div class="mt-socks">${mockSocks}</div>
        <div class="mt-pic">${draft.slot ? slotIcon(draft.slot) : `<span class="mt-q">?</span>`}</div>
      </div>
      ${state.cb && draft.sockets.length ? `<div class="mt-sockwords">${[0, 1, 2].map((i) => `<span>${draft.sockets[i] ? SOCK_WORD[draft.sockets[i]] : "–"}</span>`).join("")}</div>` : ""}
      <div class="mt-lines">${mockLines}</div>
      ${draft.slot && draft.lines.length > 0 && draft.lines.length < 3 ? `<div class="lines-warn">⚠ Only ${draft.lines.length} skill${draft.lines.length === 1 ? "" : "s"}: hologram gear has 3. Pick the missing one.</div>` : ""}
    </div>`;
  return `<div class="add-manual" id="add-manual">
    <h2>${draft.editId ? "Edit a piece" : "Add a piece"}</h2>
    <div class="scan-zone${scan.busy ? " busy" : ""}" id="scan-zone" title="Paste (Ctrl+V) or drop screenshots here">
      <div class="scan-row"><span class="scan-text" id="scan-text">${scan.text}</span>
        <button type="button" class="ghost scan-pick" id="scan-pick" title="Pick one or more screenshot files">Upload…</button></div>
      <div class="scan-bar"><div class="scan-fill" id="scan-fill" style="width:${scan.pct}%"></div></div>
      <input type="file" id="scan-file" accept="image/*" multiple hidden>
    </div>
    <div class="add-body"><div class="add-picks">
    <div class="pick-pair">${STEPS.slice(0, 2).map((s2) => `<section class="pick-step">
      <div class="step-head">${STEP_NAME[s2]}${s2 === "slot" ? "" : ` <span class="muted small">${(s2 === "sock" ? draft.sockets : draft.lines).length}/3${(s2 === "sock" ? draft.sockets : draft.lines).length ? ` · <button class="linkish" data-clear="${s2}">clear</button>` : ""}</span>`}</div>
      <div class="picker picker-3">${GRID_ORDER[s2].map((v) => option(s2, v)).join("")}</div>
    </section>`).join("")}</div>
    <section class="pick-step">
      <div class="step-head">${STEP_NAME.line} <span class="muted small">${draft.lines.length}/3${draft.lines.length ? ` · <button class="linkish" data-clear="line">clear</button>` : ""}</span></div>
      <div class="picker picker-grid">${OPTIONS.line.map((v) => option("line", v)).join("")}</div>
    </section>
    <section class="pick-step"><div class="step-head muted">Not BiS</div><div class="picker minor">${["boss", "ied"].map((v) => option("line", v)).join("")}</div></section>
    </div><div class="add-side">${mock}
    <div class="add-row add-under">
      <span class="add-msg muted small">${addMsg}</span>
      ${draft.editId ? `<button id="add-cancel" class="ghost">Cancel</button>`
        : draft.slot || draft.sockets.length || draft.lines.length ? `<button id="add-cancel" class="ghost" title="Start this piece over without adding it">Clear</button>` : ""}
      <button id="add" class="primary"${draft.slot ? "" : " disabled"}>${draft.editId ? "Save" : "Add"}</button></div>
    </div></div>
  </div>`;
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id !== "clear") confirmClear = false;
  if (t.dataset.themePick) return setTheme(t.dataset.themePick);
  if (presetAction(t)) return;
  if (t.dataset.opt) {
    const id = buildOf(state.build).id;
    state.optIdx = { ...state.optIdx, [id]: (state.optIdx?.[id] ?? 0) + Number(t.dataset.opt) };
    render(); // not saved: a fresh visit starts on the recommended option
    return;
  }
  if (t.dataset.draftMine) {
    draft.cls = null; // Add then uses your class
    render();
    return;
  }
  if (t.dataset.mine) {
    const it = state.items.find((x) => x.id === t.dataset.mine);
    if (it) {
      it.cls = classOption(state.classId).cls;
      it.key = [it.slot, it.cls, it.lines.join(","), String(it.key ?? "").split("|").at(-1)].join("|");
      setStatus(`Your ${it.slot.toLowerCase()} is ${it.cls} gear now ✓`);
    }
    save();
    render();
    return;
  }
  if (t.dataset.use) {
    const it = state.items.find((x) => x.id === t.dataset.use);
    if (it) state.custom = { ...state.custom, [it.slot]: it.id };
    save();
    render();
    return;
  }
  if (t.dataset.build && (BUILD_IDS.includes(t.dataset.build) || t.dataset.build === "custom")) {
    state.build = t.dataset.build;
    save();
    render();
    return;
  }
  if (t.id === "simple-toggle") {
    state.simple = !state.simple;
    save();
    render();
    return;
  }
  if (t.id === "cb-toggle") {
    state.cb = !state.cb;
    save();
    render();
    return;
  }
  if (t.dataset.stat) state.classId = `Pirate (${t.dataset.stat})`;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
    }
    confirmClear = !confirmClear;
  } else if (e.target.closest("[data-unpick-sock]")) {
    const c = e.target.closest("[data-unpick-sock]").dataset.unpickSock;
    draft.sockets.splice(draft.sockets.lastIndexOf(c), 1);
  } else if (t.dataset.pickSlot) return pick("slot", t.dataset.pickSlot);
  else if (t.dataset.pickSock) return pick("sock", t.dataset.pickSock);
  else if (t.dataset.pickLine) return pick("line", t.dataset.pickLine);
  else if (t.dataset.clear === "sock") draft.sockets = [];
  else if (t.dataset.clear === "line") draft.lines = [];
  else if (t.dataset.unline) draft.lines.splice(+t.dataset.unline, 1);
  else if (t.dataset.unsock) draft.sockets.splice(+t.dataset.unsock, 1);
  else if (t.id === "add") return addPiece();
  else if (t.id === "add-cancel") {
    draft = freshDraft(); // Cancel an edit, or Clear the piece you were about to add
    addMsg = "";
  }
  else if (t.dataset.edit) {
    const it = state.items.find((x) => x.id === t.dataset.edit);
    if (!it) return;
    draft = { ...freshDraft(), slot: it.slot, sockets: [...it.sockets], lines: [...it.lines], editId: it.id };
    addMsg = "";
    render();
    $("add-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  else return;
  save();
  render();
});

// Save the piece being built and start the next one.
function addPiece() {
  if (!draft.slot) return;
  // Editing a piece you added: change it in place.
  const old = draft.editId && state.items.find((it) => it.id === draft.editId);
  if (old) {
    Object.assign(old, { slot: draft.slot, lines: [...draft.lines], sockets: [...draft.sockets] });
    old.key = [old.slot, old.cls, old.lines.join(","), String(old.key ?? "").split("|").at(-1)].join("|");
    addMsg = `Saved your ${old.slot.toLowerCase()} ✓`;
    draft = freshDraft();
    save();
    render();
    return;
  }
  const piece = { slot: draft.slot, cls: draft.cls ?? classOption(state.classId).classes[0], lines: draft.lines, sockets: draft.sockets };
  // Already added: don't add it twice, and point at it.
  const same = findSame(state.items, piece);
  if (same) {
    recentIds = new Set([same.id]);
    addMsg = `You already added this ${draft.slot.toLowerCase()}: it's highlighted in Your pieces`;
    setStatus(addMsg);
    draft = freshDraft();
    save();
    render();
    return;
  }
  remember({ ...piece, stats: `hand-${Date.now()}` });
  addMsg = `Added ${draft.slot === "Shoes" || draft.slot === "Gloves" ? "" : "a "}${draft.slot.toLowerCase()} ✓`;
  setStatus(addMsg);
  draft = freshDraft();
  save();
  render();
}

$("class").addEventListener("change", (e) => {
  state.classId = e.target.value === "Pirate" ? "Pirate (STR)" : e.target.value;
  save();
  render();
});

document.addEventListener("toggle", (e) => {
  if (e.target.id !== "pieces") return;
  piecesOpen = e.target.open;
  try {
    localStorage.setItem("quandrea.piecesOpen", piecesOpen ? "1" : "0");
  } catch {}
}, true);

// Paste a screenshot (PrtScn or Win+Shift+S, then Ctrl+V here): the inventory window fills in the
// map. In Simpling Dumpling mode, a hovered item's socket colours are named instead.
async function imageFromFile(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}
async function scanFiles(list) {
  const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length > 1) return addFromScreenshots(files);
  return scanFile(files[0]);
}
async function scanFile(file) {
  if (!file?.type.startsWith("image/")) return;
  try {
    await fillFromScreenshot(await imageFromFile(file));
  } catch (err) {
    setScan(`Couldn't read that image: ${err.message}`, 0, false);
  }
}
// The scan area also takes dropped images (the Upload… button picks files).
document.addEventListener("dragover", (e) => {
  if (e.target.closest?.("#scan-zone")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (!e.target.closest?.("#scan-zone")) return;
  e.preventDefault();
  scanFiles(e.dataTransfer?.files);
});
document.addEventListener("click", (e) => {
  // Only the Upload button opens the file picker; clicking the area itself does nothing (paste there).
  if (e.target.closest?.("#scan-pick")) $("scan-file")?.click();
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "scan-file") return;
  scanFiles(e.target.files);
  e.target.value = "";
});

document.addEventListener("paste", async (e) => {
  const text = e.clipboardData?.getData("text/plain");
  if (looksLikeBackup(text)) {
    e.preventDefault();
    loadBackup(text);
    return;
  }
  const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  try {
    const img = await imageFromFile(file);
    if (state.simple) {
      showSimple(img, { now: true });
      return;
    }
    await fillFromScreenshot(img);
  } catch (err) {
    setStatus(`Couldn't read that image: ${err.message}`);
  }
});

// ---------- filling Add a piece from a screenshot ----------
// Paste a screenshot of a hovered item (PrtScn, then Ctrl+V) and Add a piece fills in its equipment,
// jewels and skills. Nothing is saved until you check it and click Add, so a misread is one click to
// fix. The text reader (Tesseract) only loads the first time you paste.
const TIP_W = 321; // a tooltip's width at normal game size
let reader = null;
let reading = false;

function cropImage(img, a) {
  const out = new Uint8ClampedArray(a.width * a.height * 4);
  for (let y = 0; y < a.height; y++) {
    const from = ((a.y + y) * img.width + a.x) * 4;
    out.set(img.data.subarray(from, from + a.width * 4), y * a.width * 4);
  }
  return { width: a.width, height: a.height, data: out };
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = ok;
    el.onerror = () => fail(new Error("couldn't load the text reader"));
    document.head.append(el);
  });
}

async function getReader() {
  if (reader) return reader;
  setScan("Loading the text reader (first time only)…", 20, true);
  if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  // The reader reports how far along it is: loading fills the bar to half, reading the rest.
  reader = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (!scan.busy) return;
      if (m.status === "recognizing text") setScan("Reading the skills…", 50 + Math.round(50 * (m.progress ?? 0)), true);
      else setScan("Loading the text reader (first time only)…", 20 + Math.round(30 * (m.progress ?? 0)), true);
    },
  });
  return reader;
}

// The hovered item's tooltip in a screenshot, and the size the game is drawn at.
function findPieceTooltip(img) {
  // A tooltip found by its border has its real width, which gives the size (321px at normal size).
  const sizes = [];
  for (const sz of SIMPLE_SIZES)
    for (const b of findTooltips(img, sz)) {
      const k = b.width / TIP_W;
      if (b.width !== Math.round(TIP_W * sz) && k > 0.55 && k < 2.2 && b.height > b.width) sizes.push(k);
    }
  sizes.sort((x, y) => x - y);
  for (const sz of [sizes[Math.floor(sizes.length / 2)], 1, ...SIMPLE_SIZES].filter(Boolean)) {
    const boxes = findTooltips(img, sz).filter((b) => iconFits(b, findIcon(img, b)));
    // The hovered item is the left tooltip when "Currently Equipped" shows beside it.
    if (boxes.length) return { box: boxes.sort((a, b) => a.x - b.x)[0], sc: sz };
  }
  // Just the tooltip snipped, edges and all.
  if (img.width < img.height && img.width > 150) {
    const box = { x: 0, y: 0, width: img.width, height: img.height };
    if (findIcon(img, box)) return { box, sc: img.width / TIP_W };
  }
  return null;
}

// The scan area at the top of Add a piece: what to do, and a bar that fills while it reads.
const SCAN_HINT = "Hover an item in the game, press <b>PrtScn</b>, then <b>Ctrl+V</b> here: it fills in the piece below to check and Add. Or drop screenshots here, or <b>Upload…</b> several at once to add them all.";
const scan = { text: SCAN_HINT, pct: 0, busy: false };
function setScan(text, pct, busy = scan.busy) {
  Object.assign(scan, { text, pct, busy });
  if ($("scan-text")) $("scan-text").innerHTML = text;
  if ($("scan-fill")) $("scan-fill").style.width = `${pct}%`;
  $("scan-zone")?.classList.toggle("busy", busy);
}

// Read one screenshot: the item's equipment type, skill lines and jewels, or why it couldn't.
// Returns { slot, lines, sockets, equipped } (slot may be null), { skip } for gear with no lines,
// { socketsOnly } for a snip of just the item picture, or null when there's no item at all.
async function readPiece(img, { quiet = false } = {}) {
  const say = (text, pct) => { if (!quiet) setScan(text, pct, true); };
  say("Finding the item…", 8);
  const found = findPieceTooltip(img);
  if (!found) {
    const icon = findIcon(img, undefined, { anywhere: true });
    const sockets = icon ? findSockets(img, icon).slice(0, 3) : [];
    return sockets.length ? { socketsOnly: sockets } : null;
  }
  const { box, sc } = found;
  const top = Math.max(0, box.y - Math.round(40 * sc)); // the title can sit just above the border
  const area = { x: box.x, y: top, width: box.width, height: box.y + box.height - top };
  const sockets = findSockets(img, findIcon(img, box)).slice(0, 3);
  say("Reading the jewels…", 15);
  // Read the text enlarged to 3x normal size, smoothly, before the black-and-white cut.
  const big = resizeImage(cropImage(img, area), 3 / sc);
  const prepared = prepareForOcr(big, { x: 0, y: 0, width: big.width, height: big.height }, { scale: 1 });
  const c = document.createElement("canvas");
  c.width = prepared.width;
  c.height = prepared.height;
  c.getContext("2d").putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
  const worker = await getReader();
  say("Reading the skills…", 50);
  const parsed = parseTooltip((await worker.recognize(c)).data.text);
  if (!parsed.slot && parsed.skip) return { skip: parsed.skip };
  // Every line in the game has a button; one the reader couldn't make out is left for you to pick.
  const known = new Set([...OPTIONS.line, ...FILLERS.map((f) => f.k)]);
  const read = parsed.lines ?? [];
  const lines = read.filter((k) => known.has(k)).slice(0, 3);
  return { slot: parsed.slot ?? null, cls: CLASSES.includes(parsed.cls) ? parsed.cls : null, sockets, lines, unread: Math.min(3, read.length) - lines.length, equipped: Boolean(parsed.equipped) };
}

// One screenshot fills in Add a piece, for you to check and Add.
async function fillFromScreenshot(img) {
  if (reading) return;
  reading = true;
  try {
    const r = await readPiece(img);
    if (!r) return setScan("Couldn't find an item in that screenshot. Hover the item in the game, then press PrtScn and Ctrl+V here.", 0, false);
    if (r.skip) return setScan(`That's a ${r.skip.toLowerCase()}: it can't roll hologram lines.`, 0, false);
    if (r.socketsOnly) {
      draft = { ...draft, sockets: r.socketsOnly };
      scan.text = "Read the jewels from the item picture ✓ Pick its equipment and skills, then Add.";
    } else {
      draft = { ...freshDraft(), slot: r.slot, cls: r.cls, sockets: r.sockets, lines: r.lines };
      const unread = r.unread ? ` Couldn't read ${r.unread === 1 ? "one skill line" : `${r.unread} skill lines`}: pick ${r.unread === 1 ? "it" : "them"} below.` : "";
      scan.text = r.slot
        ? `Filled in ✓${unread} Check it below, fix anything with a click, then Add. Paste the next one any time.`
        : "Read the jewels and skills, but not the equipment type: click it below, then Add.";
    }
    addMsg = "";
    scan.pct = 100;
    scan.busy = false;
    render();
  } catch (err) {
    setScan(`Couldn't read that screenshot: ${err.message}`, 0, false);
  } finally {
    reading = false;
  }
}

// Several screenshots at once: each one that reads becomes a piece straight away, and the new pieces
// are highlighted in Your pieces so you can check them (each has Edit).
let recentIds = new Set();
async function addFromScreenshots(files) {
  if (reading) return;
  reading = true;
  const added = [];
  const failed = [];
  let unread = 0; // pieces with a skill line the reader couldn't make out
  let dupes = 0; // screenshots of pieces you'd already added
  recentIds = new Set();
  try {
    for (const [i, file] of files.entries()) {
      setScan(`Reading ${i + 1} of ${files.length}…`, Math.round((i / files.length) * 100), true);
      try {
        const r = await readPiece(await imageFromFile(file), { quiet: true });
        if (r?.slot) {
          // The class the tooltip names (another class's gear stays out of your best combo).
          const piece = { slot: r.slot, cls: r.cls ?? classOption(state.classId).classes[0], lines: r.lines, sockets: r.sockets };
          const same = findSame(state.items, piece);
          if (same) {
            recentIds.add(same.id);
            dupes++;
            continue;
          }
          const it = remember({ slot: r.slot, cls: r.cls ?? classOption(state.classId).classes[0], lines: r.lines, sockets: r.sockets, stats: `shot-${Date.now()}-${i}` });
          recentIds.add(it.id);
          added.push(it);
          if (r.unread) unread++;
        } else failed.push(file.name || `#${i + 1}`);
      } catch {
        failed.push(file.name || `#${i + 1}`);
      }
    }
  } finally {
    reading = false;
  }
  save();
  scan.text = `Added ${added.length} piece${added.length === 1 ? "" : "s"} from ${files.length} screenshots ✓${failed.length ? ` · ${failed.length} couldn't be read (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}): add those by hand` : ""}${dupes ? ` · ${dupes} ${dupes === 1 ? "was" : "were"} already added, so skipped` : ""}${unread ? ` · ${unread} ${unread === 1 ? "has a skill line" : "have skill lines"} it couldn't read: Edit to add` : ""}. The new ones are highlighted in Your pieces: check them, and Edit anything that's off.`;
  scan.pct = 100;
  scan.busy = false;
  render();
}

// ---------- one drop finishes it ----------
// Every single new piece that would take the set to 18/18: its slot and the lines it needs. Collapsed
// by default; open, one compact row per slot. Only when you're 1 to 3 lines short.
let dropsOpen = false;
function dropsHtml(opts, res) {
  if (!opts.length || res.score >= TOTAL) return "";
  const bySlot = SLOTS.map((s) => [s, opts.filter((o) => o.slot === s)]).filter(([, l]) => l.length);
  const name = (k) => ({ atk: "ATT", crit: "Crit", dmg: "Damage", mage: "Mage" })[k] ?? NAME[k];
  return `<details class="drops" id="drops"${dropsOpen ? " open" : ""}>
      <summary><span class="label">One drop finishes it</span> <span class="muted small">${opts.length} option${opts.length === 1 ? "" : "s"}</span></summary>
      <p class="muted small">A new piece in that slot with those lines gets you to 18/18.</p>
      ${bySlot.map(([s, l]) => `<div class="drop-row"><span class="drop-slot">${slotIcon(s)}${s}</span><span class="drop-opts">${l.map((o) => `<span class="drop-opt">${o.need.map(name).join(" · ")}</span>`).join("")}</span></div>`).join("")}
    </details>`;
}
document.addEventListener("toggle", (e) => {
  if (e.target.id === "drops") dropsOpen = e.target.open;
}, true);

// ---------- custom outfit ----------
// Every line on the outfit with its level (how many pieces carry it), no caps; how it would score in
// each build; its jewels; and the pieces in What to wear.
function renderCustom(outfit, buildPick, option) {
  const pieces = SLOTS.map((s) => outfit[s]).filter(Boolean);
  const at = new Map(); // line -> slots that carry it
  for (const s of SLOTS) for (const k of outfit[s]?.lines ?? []) at.set(k, [...(at.get(k) ?? []), s]);
  const order = [...TARGETS.map((t) => t.k), ...FILLERS.map((f) => f.k)].filter((k) => at.has(k));
  const rows = order.map((k) => `<div class="board-row"><span class="board-name">${icon(k)}${NAME[k]}</span>
      <div class="cells">${at.get(k).map((sl) => `<span class="pip on" title="${sl}">${slotIcon(sl)}</span>`).join("")}<span class="lv">Lv. ${at.get(k).length}</span></div></div>`).join("");
  const scores = BUILD_IDS.map((id) => `<span class="cs"><span class="muted">${BUILDS[id].short}</span> <b>${solve(pieces, "endgame", id).score}/${TOTAL}</b></span>`).join("");
  const lines = pieces.reduce((n, it) => n + it.lines.length, 0);
  $("progress").innerHTML = `<h2>Hologram lines</h2>
    ${buildPick}
    <div class="score"><span class="big">${lines}</span><span class="muted">/ ${TOTAL} lines on your outfit</span></div>
    <div class="custom-scores">${scores}</div>
    <div class="board" style="grid-template-rows: repeat(${Math.ceil(order.length / 2)}, auto)">${rows}</div>
    ${jewelProgress(socketSet(pieces, state.classId, "original"), option, { picks: outfit })}`;
  $("lines").innerHTML = `
    <div class="row spread"><h2>What to wear</h2></div>
    <section class="set pieces always-open" id="pieces">
      <div class="pieces-head"><span class="label">Your outfit · Custom</span></div>
      <div class="pieces-list">${SLOTS.map((s) => {
          const it = outfit[s];
          if (!it) return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span><span class="none">nothing added yet</span></div>`;
          return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span>
            <span class="lines">${linesOf(it)}</span>
            <span class="piece-socks">${socks(it.sockets)}</span></div>`;
        }).join("")}
      </div>
    </section>
`;
}

// ---------- jewel progress ----------
// Like the lines board, for sockets: your best jewel piece per slot (the "For jewels" ones), its three
// sockets (usable solid, a colour your class can't use crossed out, missing dashed), and the goal of
// 18 usable sockets with 4 prismatic pieces.
function jewelProgress(sockets, option, res) {
  const usable = (c) => c === "prismatic" || option.colours.includes(c);
  const perfect = SLOTS.filter((s) => sockets.picks[s]).length;
  const rows = SLOTS.map((s) => {
    const it = sockets.picks[s];
    const list = it?.sockets ?? [];
    if (!it) return `<div class="jp-row"><span class="jp-slot" title="${s}">${slotIcon(s)}</span><span class="muted small jp-none">none yet</span></div>`;
    const done = res.picks[s]?.id === it.id;
    const spots = [0, 1, 2].map((i) => {
      const c = list[i];
      if (!c) return `<span class="jp-sock empty" title="No socket"></span>`;
      return `<span class="jp-sock${usable(c) ? "" : " dead"}" title="${SOCK_WORD[c]}${usable(c) ? "" : `: ${option.cls} can't use it`}"><span class="sock ${c}"></span></span>`;
    }).join("");
    const words = state.cb && list.length ? `<span class="jp-words">${list.map((c) => SOCK_WORD[c]).join(" · ")}</span>` : "";
    return `<div class="jp-row"><span class="jp-slot" title="${s}">${slotIcon(s)}</span><span class="jp-socks">${spots}</span>${words}${done ? `<span class="jp-done" title="This piece is in your best combo and already has perfect sockets: no Orb needed">✓</span>` : ""}</div>`;
  }).join("");
  return `<div class="jewel-progress">
      <div class="jp-head"><span class="label">Jewel sockets</span></div>
      <div class="score"><span class="big jp-big">${perfect}</span><span class="muted" title="Perfect = all 3 sockets are ones you can use (${option.colours.join(", ")} or prismatic). ✓ = already in your best combo.">/ 6 perfect pieces · <b>${Math.min(sockets.prismatic, sockets.goal)}/${sockets.goal}</b> prismatic</span></div>
      <div class="jp-board">${rows}</div>
    </div>`;
}

// ---------- presets ----------
// Five named slots in this browser: Save puts your current pieces and class in one, Load swaps them in.
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function renderPresets() {
  const list = state.presets ?? cleanPresets();
  const active = state.activePreset;
  $("presets-label").textContent = Number.isInteger(active) && list[active] ? `Preset: ${list[active].name}` : "Presets";
  $("preset-list").innerHTML = list.map((p, i) => `<div class="preset-row${i === active ? " on" : ""}">
      <span class="preset-n">${i + 1}</span>
      <input data-preset-name="${i}" maxlength="${NAME_MAX}" value="${esc(p?.name ?? "")}" placeholder="Preset ${i + 1}" aria-label="Name for preset ${i + 1}">
      <span class="muted small preset-info">${p ? `${p.items.length} piece${p.items.length === 1 ? "" : "s"}` : "empty"}</span>
      <button class="ghost" data-preset-save="${i}" title="Save your current pieces here">Save</button>
      <button class="ghost" data-preset-load="${i}"${p ? "" : " disabled"} title="Swap these pieces in">Load</button>
      <button class="x" data-preset-del="${i}"${p ? "" : " disabled"} aria-label="Clear preset ${i + 1}">×</button>
    </div>`).join("");
}
function presetAction(t) {
  const list = (state.presets = state.presets ?? cleanPresets());
  const nameOf = (i) => document.querySelector(`[data-preset-name="${i}"]`)?.value;
  if (t.dataset.presetSave) {
    const i = +t.dataset.presetSave;
    if (list[i] && !confirm(`Replace "${list[i].name}" with your current ${state.items.length} pieces?`)) return true;
    list[i] = makePreset(state, i, nameOf(i) || list[i]?.name);
    state.activePreset = i;
    setStatus(`Saved to preset ${i + 1}: ${list[i].name} ✓`);
  } else if (t.dataset.presetLoad) {
    const i = +t.dataset.presetLoad;
    const p = list[i];
    if (!p) return true;
    if (state.items.length && state.activePreset !== i && !confirm(`Load "${p.name}"? It replaces the ${state.items.length} pieces on the page (save them to a preset first if you want to keep them).`)) return true;
    state.items = p.items.map((it) => ({ ...it, lines: [...it.lines], sockets: [...it.sockets] }));
    state.classId = p.classId;
    state.custom = cleanCustom(p.custom);
    state.activePreset = i;
    draft = freshDraft();
    setStatus(`Loaded preset ${i + 1}: ${p.name} ✓`);
  } else if (t.dataset.presetDel) {
    const i = +t.dataset.presetDel;
    if (!list[i] || !confirm(`Clear preset ${i + 1} ("${list[i].name}")? Your pieces on the page stay.`)) return true;
    list[i] = null;
    if (state.activePreset === i) state.activePreset = null;
  } else return false;
  save();
  render();
  return true;
}
document.addEventListener("change", (e) => {
  const i = e.target.dataset?.presetName;
  if (i === undefined) return;
  const list = (state.presets = state.presets ?? cleanPresets());
  if (list[+i]) {
    list[+i].name = cleanName(e.target.value, +i);
    save();
    renderPresets();
  }
});

// ---------- backups ----------
// "Copy backup" puts a code on the clipboard; paste it back here (Ctrl+V or "Load backup") to restore.
// The code is checked and rebuilt from known values only (see backup.js).
function flash(btn, text) {
  const was = btn.dataset.label ?? (btn.dataset.label = btn.textContent);
  btn.textContent = text;
  setTimeout(() => (btn.textContent = was), 2500);
}

$("backup-copy").addEventListener("click", async () => {
  const code = exportCode(state);
  try {
    await navigator.clipboard.writeText(code);
    flash($("backup-copy"), "Copied ✓");
    setStatus(`Backup of ${state.items.length} item${state.items.length === 1 ? "" : "s"} copied. Keep it somewhere safe (a note, a Discord DM to yourself); paste it here any time to restore.`);
  } catch {
    // No clipboard access: save it as a file instead.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    a.download = `quandrea-backup-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash($("backup-copy"), "Saved as a file");
  }
});

$("backup-load").addEventListener("click", async () => {
  let text = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {}
  if (looksLikeBackup(text)) loadBackup(text);
  else setStatus("Copy your backup code, then press Ctrl+V on this page (or click Load backup again).");
});

function loadBackup(text) {
  let data;
  try {
    data = importCode(text);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  const n = data.items.length;
  if (state.items.length && !confirm(`Replace your ${state.items.length} item${state.items.length === 1 ? "" : "s"} with the ${n} in this backup?`)) return;
  state = { ...state, ...data };
  save();
  render();
  flash($("backup-load"), "Loaded ✓");
  setStatus(`Loaded ${n} item${n === 1 ? "" : "s"} from your backup ✓`);
}

// Light, dark, or follow the computer ("auto"). Remembered in this browser.
function setTheme(pick) {
  if (pick === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pick;
  try {
    localStorage.setItem("quandrea.theme", pick);
  } catch {}
  showTheme();
}
function showTheme() {
  const now = document.documentElement.dataset.theme ?? "auto";
  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", String(b.dataset.themePick === now));
}
showTheme();

// The version is the ?v=N this script was loaded with (see index.html), so it always matches.
$("version").textContent = `Quandrea v${new URL(import.meta.url).searchParams.get("v") ?? "dev"}`;

load();
render();
