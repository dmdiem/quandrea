// The page: the inventory map (from a pasted screenshot), typing in pieces, and drawing everything.

import { SLOTS, TARGETS, FILLERS, OTHER, isTarget, parseTooltip } from "./parse.js?v=49";
import { verdicts, solve, missing, TOTAL, CLASSES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js?v=49";
import { STEPS, STEP_NAME, OPTIONS } from "./options.js?v=49";
import { exportCode, importCode, looksLikeBackup, sanitize } from "./backup.js?v=49";
import { findTooltips, findIcon, findSockets, prepareForOcr, resizeImage } from "./vision.js?v=49";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), ...FILLERS.map((f) => [f.k, f.name]), [OTHER, "Other"]]);
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
      view: ["equipped", "best"].includes(raw.view) ? raw.view : undefined,
      scale: typeof raw.scale === "number" && raw.scale > 0.3 && raw.scale < 3 ? raw.scale : undefined,
    };
    state = { ...state, ...ui, ...sanitize(raw) };
  } catch {}
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function setStatus(text) {
  $("status").textContent = text;
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
  return best.reads;
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
          if (!c) return `<span class="simple-word empty">${k === 0 ? (list ? (list.length ? "" : "Hold still…") : "–") : ""}</span>`;
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
  if (p.equipped) for (const it of state.items) if (it.slot === p.slot) it.equipped = false;
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
    item.equipped = p.equipped || item.equipped;
    if (p.sockets.length) item.sockets = p.sockets;
  }
  else {
    item = { id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), key, slot: p.slot, cls: p.cls, lines: p.lines, sockets: p.sockets, equipped: p.equipped, cell: p.cell ?? null };
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
// ledger (Registry), sword and wand (ATT & M.ATT), a target (Crit), and for the classes a sword,
// wand, bow and arrow, shuriken and anchor.
const CLASS_PATHS = {
  leap: '<path d="M3.5 19.5C5 10 13 5.5 19.5 11"/><path d="M19.5 11l-4.8.3M19.5 11l.6-4.7"/><path d="M3 21h4"/>',
  wh: '<ellipse cx="12" cy="16" rx="9" ry="4"/><ellipse cx="12" cy="16" rx="4" ry="1.6"/><path d="M12 3v6M6.5 5l2.2 4.5M17.5 5l-2.2 4.5"/>',
  reg: '<path d="M6 3h9l3.5 3.5V21H6z"/><path d="M15 3v3.5h3.5"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>',
  atk: '<path d="M4 4l10 10"/><path d="M11.5 16.5l5-5"/><path d="M14 14l5.5 5.5"/><path d="M20 4 6 18"/><path d="M4.5 19.5 6 18"/><path d="M19.5 2.8l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" stroke-width="1.2"/>',
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
  // Always aims for the real 18 (an older "any 3 lines" setting in a save is ignored).
  const { res, sockets, verdicts: v } = verdicts(state.items, { ...state, mode: "endgame" });
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

  // What you're wearing now (from the "Currently Equipped" boxes), and how it compares.
  const worn = Object.fromEntries(SLOTS.map((s) => [s, state.items.find((it) => it.slot === s && it.equipped) ?? null]));
  const nowRes = solve(Object.values(worn).filter(Boolean));
  const nowScore = nowRes.score;
  const seenAny = Object.values(worn).some(Boolean);

  // The hologram lines panel: the best combo you could make, or (switch) what you have equipped now.
  // One view: the best combo (what you wear now shows on each piece, with Swap).
  const showNow = false;
  const shown = res;
  const head = shown.score;
  const from = Object.fromEntries(TARGETS.map((t) => [t.k, []])); // line -> slots that supply it
  for (const s of SLOTS) shown.picks[s]?.lines.forEach((k, j) => shown.counted[s][j] && from[k].push(s));
  // Just the slot's icon (its name on hover); an empty dashed box when the line is missing.
  // A filled spot shows the icon of the equipment that gives the line; a missing one is a faint dot.
  const cell = (k, slot) => `<span class="pip ${slot ? "on" : ""}" title="${slot ?? "Missing"}" aria-label="${slot ?? "Missing"}">${slot ? slotIcon(slot) : ""}</span>`;
  // Still missing: the lines this set doesn't have yet, with how many of each.
  const gaps = missing(shown);
  const gapCount = gaps.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
  // What the collapsed piece list says, so a swap is never hidden.
  const swaps = SLOTS.filter((s) => res.picks[s] && !res.picks[s].equipped);
  const swapNote = !seenAny ? "" : swaps.length ? `${swaps.length} to swap: ${swaps.join(", ")}` : "all of them are equipped";
  // Progress, beside Add a piece so it moves as you add: the score, what you wear now, the 18-line
  // board and what's still missing.
  $("progress").innerHTML = `<h2>Hologram lines</h2>
    <div class="score"><span class="big">${head}</span><span class="muted">/ ${TOTAL} with the best combo</span></div>
    ${seenAny ? `<p class="muted small"><b>${nowScore}/${TOTAL}</b> equipped now</p>` : ""}
    <div class="board">${TARGETS.map((t) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${Array.from({ length: 3 }, (_, j) => { const k2 = j - (3 - t.need); return k2 >= 0 ? cell(t.k, from[t.k][k2]) : ""; }).join("")}</div></div>`).join("")}</div>
    ${gaps.length ? `<div class="hunt"><span class="label">Still missing · ${gaps.length}</span><div class="lines">${[...gapCount].map(([k, n]) => `${chip(k)}${n > 1 ? `<span class="times">×${n}</span>` : ""}`).join("")}</div></div>` : `<p class="act on">All 18 ✓</p>`}`;
  if (typeof draft !== "undefined") $("add-panel").innerHTML = addForm();
  $("lines").innerHTML = `
    <div class="row spread"><h2>What to wear</h2></div>
    <section class="set pieces always-open" id="pieces">
      <div class="pieces-head"><span class="label">${showNow ? "Equipped now" : "Best combo"}</span>
        <span class="muted small">${swapNote}</span></div>
      <p class="muted small">Faded <b>extra</b> = a line you already have 3 (or 1) of.</p>
      <div class="pieces-list">${SLOTS.map((s) => {
          const it = shown.picks[s];
          const best = res.picks[s];
          const wearing = state.items.find((x) => x.slot === s && x.equipped);
          const action = showNow
            ? !it ? "" : best && best !== it ? `<button class="act swap" data-equip="${best.id}" title="A better piece for this slot is in your bag: click once you've put it on">Better in bag · Swap</button>` : `<span class="act on">Best ✓</span>`
            : !it ? "" : it.equipped ? `<span class="act on">Equipped ✓</span>` : `<button class="act swap" data-equip="${it.id}" title="${wearing ? "Click once you've put this on instead of what you wear now" : "Click once you've put this on"}">${wearing ? "Swap" : "Equip"}</button>`;
          if (!it) return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span><span class="none">${showNow ? "nothing equipped" : "nothing added yet"}</span></div>`;
          // On a swap, the piece you have on now, right under the one to swap in.
          const nowRow = !showNow && wearing && !it.equipped ? `<div class="piece-now"><span class="wearing-now">↳ Equipped:</span> ${linesOf(wearing)}</div>` : "";
          return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span>
            <span class="lines">${it.lines.map((k, j) => chip(k, !shown.counted[s][j])).join("") || `<span class="muted">no lines</span>`}</span>
            <span class="piece-socks">${socks(it.sockets)}<span class="tag">${socketValue(it, state.classId).good}/3</span></span>
            <span class="piece-act">${action}</span></div>${nowRow}`;
        }).join("")}
        <div class="piece totals"><span class="piece-slot">Sockets</span><span class="muted small">${(() => { const v3 = SLOTS.map((s) => shown.picks[s] && socketValue(shown.picks[s], state.classId)).filter(Boolean); return `${v3.reduce((n, x) => n + x.good, 0)}/18 usable · ${v3.filter((x) => x.prismatic).length}/${PRISMATIC_GOAL} prismatic pieces`; })()}</span></div>
      </div>
      ${showNow ? "" : `<div class="fuse"><span class="label">Best pieces to fuse your lines onto</span>
        <span class="muted small">Goal: 4 with a prismatic, all others ${option.colours.join(" / ")}.</span>
        <div class="fuse-list">${SLOTS.map((s) => { const it = sockets.picks[s]; const v4 = it && socketValue(it, state.classId); return `<span class="fuse-item">${slotIcon(s)}${it && v4.good ? `${socks(it.sockets)}` : `<span class="none">none yet</span>`}</span>`; }).join("")}</div></div>`}
    </section>
`;

  // Your pieces: everything you've added, by slot, what you wear first. Each one says whether it's
  // equipped or in your best combo.
  const inBest = new Set(Object.values(res.picks).filter(Boolean).map((it) => it.id));
  const list = [...state.items].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || b.equipped - a.equipped || inBest.has(b.id) - inBest.has(a.id));
  const row = (it) => `<div class="bag-row${it.equipped ? " worn-row" : ""}" draggable="true" data-drag="${it.id}">
      <div class="bag-top">${it.equipped ? `<span class="act on">Equipped ✓</span>` : inBest.has(it.id) ? `<span class="act swap">In best combo</span>` : `<span class="muted small">spare</span>`}
        <span class="bag-act">${it.equipped
          ? `<button class="equip-btn" data-unequip="${it.id}" title="Not wearing this any more">Unequip</button>`
          : `<button class="equip-btn" data-equip="${it.id}" title="You put this on in game">Equip</button>`}<button class="equip-btn" data-edit="${it.id}" title="Change its jewels, skills or slot">Edit</button><button class="x" data-del="${it.id}" aria-label="Remove">×</button></span></div>
      <div class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}</div>
      ${socks(it.sockets)}
    </div>`;
  $("items").innerHTML = `
    <h2>Your pieces</h2>
    ${state.items.length ? `<div class="slots">${SLOTS.map((sl) => {
      const here = list.filter((it) => it.slot === sl);
      return `<div class="slot" data-drop-slot="${sl}"><div class="slot-head"><h3>${slotIcon(sl)}${sl}</h3><span class="tag">${here.length}</span></div>
        ${here.length ? here.map(row).join("") : `<div class="none">Nothing added yet</div>`}</div>`;
    }).join("")}</div>` : `<p class="none">Nothing added yet: fill pieces in with <b>Add a piece</b>.</p>`}`;
}

// ---------- equipping in game ----------
// After swapping in game: the new piece is equipped, and the old one goes back into the bag.
function equipItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const old = state.items.find((x) => x.slot === it.slot && x.equipped);
  if (old) old.equipped = false;
  it.equipped = true;
  setStatus(`Marked your ${it.slot.toLowerCase()} as equipped ✓`);
}

// Drag an inventory piece onto its slot's card to equip it.
document.addEventListener("dragstart", (e) => {
  const id = e.target.closest?.("[data-drag]")?.dataset.drag;
  if (id) e.dataTransfer.setData("text/plain", id);
});
document.addEventListener("dragover", (e) => {
  if (e.target.closest?.("[data-drop-slot], .side-col")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const card = e.target.closest?.("[data-drop-slot], .side-col");
  const id = e.dataTransfer?.getData("text/plain");
  const it = state.items.find((x) => x.id === id);
  if (!card || !it) return;
  e.preventDefault();
  if (card.dataset.dropSlot && it.slot !== card.dataset.dropSlot) {
    setStatus(`That's a ${it.slot.toLowerCase()}: drop it on the ${it.slot} card.`);
    return;
  }
  equipItem(id);
  save();
  render();
});

// ---------- add manually ----------
// Tap a slot, up to 3 lines and up to 3 sockets, then Add. The slot stays picked for the next one.
const freshDraft = () => ({ slot: null, lines: [], sockets: [] });
let draft = freshDraft();
let addMsg = ""; // "Added a hat ✓", shown in the panel after each piece
// Add a piece: click the equipment, its jewels and its skills, then Add.
function pick(kind, v) {
  if (kind === "slot") draft.slot = v;
  else if (kind === "sock") {
    // A prismatic socket is always the leftmost one in the game.
    if (draft.sockets.length < 3) draft.sockets = v === "prismatic" ? [v, ...draft.sockets] : [...draft.sockets, v];
  } else {
    // Picking a skill twice takes it back; Other can repeat (Boss + IED are both not BiS).
    if (v !== OTHER && draft.lines.includes(v)) draft.lines = draft.lines.filter((x) => x !== v);
    else if (draft.lines.length < 3) draft.lines = [...draft.lines, v];
  }
  render();
}

const KEY_SHORT = { leap: "Leap", wh: "White Hole", reg: "Registry", atk: "ATT & M.ATT", crit: "Crit DMG", warrior: "Warrior", mage: "Mage", archer: "Bowman", thief: "Thief", pirate: "Pirate", boss: "Boss DMG", ied: "Ignore DEF", dmg: "Damage", [OTHER]: "Other" };

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
    return `<button class="keycap kind-${kind}${kind === "line" && !isTarget(v) ? " filler" : ""}${on ? " on" : ""}" data-pick-${kind}="${v}"${full ? " disabled" : ""}>${label}</button>`;
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
      <div class="mt-name">${draft.slot ? `${draft.slot}` : "Pick the equipment"}${draft.equipped ? ` <span class="mt-worn">Equipped</span>` : ""}</div>
      <div class="mt-frame">
        <div class="mt-socks">${mockSocks}</div>
        <div class="mt-pic">${draft.slot ? slotIcon(draft.slot) : `<span class="mt-q">?</span>`}</div>
      </div>
      ${state.cb && draft.sockets.length ? `<div class="mt-sockwords">${[0, 1, 2].map((i) => `<span>${draft.sockets[i] ? SOCK_WORD[draft.sockets[i]] : "–"}</span>`).join("")}</div>` : ""}
      <div class="mt-lines">${mockLines}</div>
    </div>`;
  return `<div class="add-manual" id="add-manual">
    <h2>${draft.editId ? "Edit a piece" : "Add a piece"}</h2>
    <div class="scan-zone${scan.busy ? " busy" : ""}" id="scan-zone" title="Paste (Ctrl+V), drop an image here, or click to pick one">
      <span class="scan-text" id="scan-text">${scan.text}</span>
      <div class="scan-bar"><div class="scan-fill" id="scan-fill" style="width:${scan.pct}%"></div></div>
      <input type="file" id="scan-file" accept="image/*" hidden>
    </div>
    <div class="add-body"><div class="add-picks">
    ${STEPS.map((s2) => `<section class="pick-step">
      <div class="step-head">${STEP_NAME[s2]}${s2 === "slot" ? "" : ` <span class="muted small">${(s2 === "sock" ? draft.sockets : draft.lines).length}/3${(s2 === "sock" ? draft.sockets : draft.lines).length ? ` · <button class="linkish" data-clear="${s2}">clear</button>` : ""}</span>`}</div>
      <div class="picker${s2 === "line" ? " picker-grid" : ""}">${OPTIONS[s2].map((v) => option(s2, v)).join("")}</div>
    </section>${s2 === "line" ? `<section class="pick-step"><div class="step-head muted">Not BiS</div><div class="picker minor">${["boss", "ied", "dmg", OTHER].map((v) => option("line", v)).join("")}</div></section>` : ""}`).join("")}
    </div><div class="add-side">${mock}
    <div class="add-row add-under">
      <span class="add-msg muted small">${addMsg}</span>
      <button id="add-worn" class="ghost wear-toggle" aria-pressed="${Boolean(draft.equipped)}" title="You're wearing this piece in game">${draft.equipped ? "✓ " : ""}Currently Equipped</button>
      ${draft.editId ? `<button id="add-cancel" class="ghost">Cancel</button>`
        : draft.slot || draft.sockets.length || draft.lines.length || draft.equipped ? `<button id="add-cancel" class="ghost" title="Start this piece over without adding it">Clear</button>` : ""}
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
  if (t.dataset.equip) equipItem(t.dataset.equip);
  else if (t.dataset.unequip) {
    const it = state.items.find((x) => x.id === t.dataset.unequip);
    if (it) it.equipped = false;
  }
  else if (t.dataset.stat) state.classId = `Pirate (${t.dataset.stat})`;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
    }
    confirmClear = !confirmClear;
  } else if (t.dataset.pickSlot) return pick("slot", t.dataset.pickSlot);
  else if (t.dataset.pickSock) return pick("sock", t.dataset.pickSock);
  else if (t.dataset.pickLine) return pick("line", t.dataset.pickLine);
  else if (t.dataset.clear === "sock") draft.sockets = [];
  else if (t.dataset.clear === "line") draft.lines = [];
  else if (t.id === "add-worn") draft.equipped = !draft.equipped;
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
    draft = { ...freshDraft(), slot: it.slot, sockets: [...it.sockets], lines: [...it.lines], equipped: it.equipped, editId: it.id };
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
    if (draft.equipped) for (const it of state.items) if (it.slot === draft.slot && it !== old) it.equipped = false;
    Object.assign(old, { slot: draft.slot, lines: [...draft.lines], sockets: [...draft.sockets], equipped: Boolean(draft.equipped) });
    old.key = [old.slot, old.cls, old.lines.join(","), String(old.key ?? "").split("|").at(-1)].join("|");
    addMsg = `Saved your ${old.slot.toLowerCase()} ✓`;
    draft = freshDraft();
    save();
    render();
    return;
  }
  remember({ slot: draft.slot, cls: classOption(state.classId).classes[0], lines: draft.lines, sockets: draft.sockets, equipped: Boolean(draft.equipped), stats: `hand-${Date.now()}` });
  addMsg = `Added ${draft.equipped ? "your equipped " : draft.slot === "Shoes" || draft.slot === "Gloves" ? "" : "a "}${draft.slot.toLowerCase()} ✓`;
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
async function scanFile(file) {
  if (!file?.type.startsWith("image/")) return;
  try {
    await fillFromScreenshot(await imageFromFile(file));
  } catch (err) {
    setScan(`Couldn't read that image: ${err.message}`, 0, false);
  }
}
// The scan area also takes a dropped image, or a click to pick one.
document.addEventListener("dragover", (e) => {
  if (e.target.closest?.("#scan-zone")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (!e.target.closest?.("#scan-zone")) return;
  e.preventDefault();
  scanFile(e.dataTransfer?.files?.[0]);
});
document.addEventListener("click", (e) => {
  if (e.target.closest?.("#scan-zone") && !e.target.closest("input")) $("scan-file")?.click();
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "scan-file") return;
  scanFile(e.target.files?.[0]);
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
const SCAN_HINT = "Hover an item in the game, press <b>PrtScn</b>, then <b>Ctrl+V</b> here (or drop / click to pick a screenshot). It fills in the piece below; check it and click Add.";
const scan = { text: SCAN_HINT, pct: 0, busy: false };
function setScan(text, pct, busy = scan.busy) {
  Object.assign(scan, { text, pct, busy });
  if ($("scan-text")) $("scan-text").innerHTML = text;
  if ($("scan-fill")) $("scan-fill").style.width = `${pct}%`;
  $("scan-zone")?.classList.toggle("busy", busy);
}

async function fillFromScreenshot(img) {
  if (reading) return;
  setScan("Finding the item…", 8, true);
  const found = findPieceTooltip(img);
  if (!found) {
    setScan("Couldn't find an item tooltip in that screenshot. Hover the item in the game, then press PrtScn and Ctrl+V here.", 0, false);
    return;
  }
  reading = true;
  try {
    const { box, sc } = found;
    const top = Math.max(0, box.y - Math.round(40 * sc)); // the title can sit just above the border
    const area = { x: box.x, y: top, width: box.width, height: box.y + box.height - top };
    const icon = findIcon(img, box);
    const sockets = findSockets(img, icon).slice(0, 3);
    setScan("Reading the jewels…", 15, true);
    // Read the text enlarged to 3x normal size, smoothly, before the black-and-white cut.
    const big = resizeImage(cropImage(img, area), 3 / sc);
    const prepared = prepareForOcr(big, { x: 0, y: 0, width: big.width, height: big.height }, { scale: 1 });
    const c = document.createElement("canvas");
    c.width = prepared.width;
    c.height = prepared.height;
    c.getContext("2d").putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
    const worker = await getReader();
    setScan("Reading the skills…", 50, true);
    const parsed = parseTooltip((await worker.recognize(c)).data.text);
    if (!parsed.slot && parsed.skip) {
      setScan(`That's a ${parsed.skip.toLowerCase()}: it can't roll hologram lines.`, 0, false);
      return;
    }
    const known = new Set([...OPTIONS.line, ...FILLERS.map((f) => f.k), OTHER]);
    draft = {
      ...freshDraft(),
      slot: parsed.slot ?? null,
      sockets,
      lines: (parsed.lines ?? []).filter((k) => known.has(k)).slice(0, 3),
      equipped: Boolean(parsed.equipped),
    };
    addMsg = "";
    scan.text = parsed.slot
      ? "Filled in ✓ Check it below, fix anything with a click, then Add. Paste the next one any time."
      : "Read the jewels and skills, but not the equipment type: click it below, then Add.";
    scan.pct = 100;
    scan.busy = false;
    render();
  } catch (err) {
    setScan(`Couldn't read that screenshot: ${err.message}`, 0, false);
  } finally {
    reading = false;
  }
}

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
