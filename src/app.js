// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, FILLERS, OTHER, isTarget } from "./parse.js?v=29";
import { verdicts, solve, missing, TOTAL, CLASSES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js?v=29";
import { exportCode, importCode, looksLikeBackup, sanitize } from "./backup.js?v=29";
import { findTooltips, findIcon, findSockets, prepareForOcr, textProfile, profileDiff, findGrid, readCells, findCursor, cellAt, findScale, resizeImage, GRID } from "./vision.js?v=29";

const KEY = "quandrea.v1";
// Looks in the pop-out window too, while Simpling Dumpling's readout lives there.
let pipDoc = null;
const $ = (id) => document.getElementById(id) ?? pipDoc?.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), ...FILLERS.map((f) => [f.k, f.name]), [OTHER, "Other"]]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];
const VERDICT = { keep: "Keep", trash: "Trash" };
const REASON = { best: "best combo", spare: "spare 3-line", sockets: "for sockets" };

let state = { items: [], classId: "Magician", mode: "endgame", cells: [] };
let grid = null; // where the inventory grid is on screen (found while no tooltip is open)
let selected = null; // the inventory cell clicked in the map, "c,r"
let piecesOpen = false; // the "each piece" section; kept across redraws and remembered
try {
  piecesOpen = localStorage.getItem("quandrea.piecesOpen") === "1";
} catch {}
let last = null; // { item, crop } of the most recent hovered (not equipped) tooltip
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
      gearTab: ["trash", "keep", "all"].includes(raw.gearTab) ? raw.gearTab : undefined,
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

// ---------- capture and scanning ----------
// Live screen sharing is switched off for now: screenshots (Ctrl+V) and recorded videos only.
// Set to true to bring the Share buttons back.
const LIVE_SHARE = false;

const video = $("video");
const frame = document.createElement("canvas");
const fctx = frame.getContext("2d", { willReadFrequently: true });
let stream = null;
let timer = null;
let worker = null;
let busy = false;
// Tooltips seen last frame ({ box, profile, still }), and ones already read that are still open.
let prev = [];
let done = [];
const SAME = 0.04; // profiles closer than this are the same tooltip
const near = (a, b) => Math.abs(a.x - b.x) <= 6 && Math.abs(a.y - b.y) <= 6;

function setStatus(text, on = false) {
  $("status").textContent = text;
  $("status").classList.toggle("on", on);
}

// The text reader (Tesseract), loaded the first time it's needed. Returns false if it can't load.
async function ensureWorker() {
  if (worker) return true;
  setStatus("Loading the text reader (first time only)…", true);
  try {
    worker = await Tesseract.createWorker("eng");
    return true;
  } catch (err) {
    setStatus(`Couldn't load the text reader: ${err.message}`);
    return false;
  }
}

async function startShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("This browser can't share a screen. Use Chrome, Edge or Firefox on a computer.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  } catch {
    setStatus("Screen sharing was cancelled.");
    return;
  }
  video.srcObject = stream;
  await video.play();
  stream.getVideoTracks()[0].addEventListener("ended", stopShare);
  $("share").hidden = true;
  $("simple-share").hidden = true;
  $("stop").hidden = false;
  $("save-frame").hidden = false;
  if (!(await ensureWorker())) return;
  setStatus("Watching. Hover an item in your inventory.", true);
  timer = setInterval(tick, 400);
}

function stopShare() {
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("share").hidden = !LIVE_SHARE;
  $("simple-share").hidden = !LIVE_SHARE;
  $("stop").hidden = true;
  $("save-frame").hidden = true;
  setStatus("Stopped. Your items are saved in this browser.");
}

// A rectangle cut out of an image.
function cropImage(img, a) {
  const out = new Uint8ClampedArray(a.width * a.height * 4);
  for (let y = 0; y < a.height; y++) {
    const from = ((a.y + y) * img.width + a.x) * 4;
    out.set(img.data.subarray(from, from + a.width * 4), y * a.width * 4);
  }
  return { width: a.width, height: a.height, data: out };
}

// Simple mode's readout: for each tooltip (left = the item you hover, right = what you have equipped),
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
  $("simple-status").textContent = stream ? "Watching." : LIVE_SHARE ? "Not watching." : "Read from your screenshot.";
}

// The scale the game is drawn at in the shared window (1 = normal), found from the inventory grid.
let lastCalibration = 0;
const norm = document.createElement("canvas");
const nctx = norm.getContext("2d", { willReadFrequently: true });
// The frame resized back to normal scale, for reading the inventory grid.
function normalFrame(img) {
  const s = state.scale ?? 1;
  if (s === 1) return img;
  norm.width = Math.round(frame.width / s);
  norm.height = Math.round(frame.height / s);
  nctx.imageSmoothingQuality = "high";
  nctx.drawImage(frame, 0, 0, norm.width, norm.height);
  return nctx.getImageData(0, 0, norm.width, norm.height);
}
// Equipped tooltips already read: recognised on sight and skipped, so the hovered item gets read.
let equippedSeen = [];

async function tick() {
  if (busy || !video.videoWidth) return;
  frame.width = video.videoWidth;
  frame.height = video.videoHeight;
  fctx.drawImage(video, 0, 0);
  const img = fctx.getImageData(0, 0, frame.width, frame.height);
  if (state.simple) {
    showSimple(img);
    return;
  }
  const scale = state.scale ?? 1;
  // The stillness check looks at the top of each tooltip only (title, picture, stats), so game
  // animation under a small tooltip doesn't keep resetting it.
  const now = findTooltips(img, scale).map((box) => ({ box, profile: textProfile(img, { ...box, height: Math.min(box.height, Math.round(300 * scale)) }) }));
  const same = (a, b) => near(a.box, b.box) && profileDiff(a.profile, b.profile) < SAME;
  // A tooltip counts as still when it matches one from the last frame (it fades in, the mouse moves).
  for (const t of now) t.still = (prev.find((p) => same(p, t))?.still ?? 0) + 1;
  prev = now;
  // Forget read tooltips once they close, so hovering that item again reads it again.
  done = done.filter((d) => now.some((t) => same(d, t)));
  if (!now.length) {
    // Nothing covering the inventory: find the grid (and the screen's scale, once) and refresh the map.
    const nimg = normalFrame(img);
    let g = findGrid(nimg);
    if (!g && Date.now() - lastCalibration > 5000) {
      lastCalibration = Date.now();
      setStatus("Working out your game window's size…", true);
      const s2 = findScale(img);
      if (s2) {
        state.scale = s2;
        save();
        g = findGrid(normalFrame(img));
        setStatus(s2 === 1 ? "Watching. Hover an item in your inventory." : `Found your inventory (game shown at ${Math.round(s2 * 100)}% size). Hover an item.`, true);
      } else setStatus("Watching. Open your inventory's Equip tab (expanded) so the map can find it.", true);
    }
    if (g) {
      grid = g;
      // A pasted screenshot pins the map: keep tracking where the grid is, but don't overwrite it.
      const cells = state.mapPinned ? state.cells : readCells(normalFrame(img), g);
      if (cells.join() !== state.cells.join()) {
        state.cells = cells;
        save();
        render();
      }
    } else if (findGrid(nimg, 4)) {
      setStatus("Your inventory is in the small view (4 columns). Expand it with the + at its top right so all 16 columns show.", true);
    }
    return;
  }
  // Equipped tooltips we've already read are skipped on sight.
  const known = (t) => equippedSeen.some((p) => profileDiff(p, t.profile) < SAME);
  for (const t of now) if (!done.some((d) => same(d, t)) && known(t)) done.push(t);
  const fresh = now.filter((t) => !done.some((d) => same(d, t)));
  if (!fresh.length) {
    if (now.length === 1 && known(now[0])) setStatus("I can see your equipped piece but not the item you're hovering. Hover it again, or move it away from bright things.", true);
    return;
  }
  // The hovered item's tooltip is the left one when two are open: read it first.
  const ready = fresh.filter((t) => t.still >= 2).sort((a, b) => a.box.x - b.box.x);
  if (!ready.length) {
    setStatus("Found a tooltip. Hold still…", true);
    return;
  }
  busy = true;
  try {
    for (const t of ready) {
      done.push(t);
      const parsed = await readTooltip(img, t.box);
      if (parsed?.equipped) equippedSeen = [...equippedSeen.slice(-11), t.profile];
    }
  } finally {
    busy = false;
  }
}

async function readTooltip(img, box, { sc = state.scale ?? 1, inGrid = grid, pasted = false } = {}) {
  setStatus("Reading…", true);
  const top = Math.max(0, box.y - Math.round(40 * sc)); // the title can sit just above where the border is found
  const area = { x: box.x, y: top, width: box.width, height: box.y + box.height - top };
  // Read the tooltip at normal size: when the game is shown smaller or bigger, resize just this part.
  const tip = sc === 1 ? { img, box, area } : (() => {
    const sub = resizeImage(cropImage(img, area), 1 / sc);
    const b = { x: 0, y: Math.round((box.y - top) / sc), width: sub.width, height: sub.height - Math.round((box.y - top) / sc) };
    return { img: sub, box: b, area: { x: 0, y: 0, width: sub.width, height: sub.height } };
  })();
  const icon = findIcon(tip.img, tip.box);
  const sockets = findSockets(tip.img, icon);
  // Small or scaled text reads better enlarged smoothly before the black-and-white cut.
  const prepared = sc === 1 ? prepareForOcr(tip.img, tip.area) : (() => {
    const big = resizeImage(cropImage(img, area), 3 / sc);
    return prepareForOcr(big, { x: 0, y: 0, width: big.width, height: big.height }, { scale: 1 });
  })();
  const c = document.createElement("canvas");
  c.width = prepared.width;
  c.height = prepared.height;
  c.getContext("2d").putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
  const { data } = await worker.recognize(c);
  const parsed = parseTooltip(data.text);
  if (!parsed.slot && parsed.skip) {
    setStatus(`That's a ${parsed.skip.toLowerCase()}. It can't roll hologram lines, so there's nothing to scan.`, true);
    return parsed;
  }
  if (!parsed.slot) {
    setStatus("Couldn't read that tooltip. Hover it again, or move it so nothing bright is behind it.", true);
    return parsed;
  }
  // Which inventory cell it came from: the one under the game's glove cursor.
  const at = parsed.equipped ? null : findCursor(img, box);
  const cell = at && inGrid && cellAt(inGrid, at.x / sc, at.y / sc);
  const before = state.items.length;
  const item = remember({ ...parsed, sockets, cell: cell ? `${cell.c},${cell.r}` : null });
  const known = state.items.length === before;
  if (!parsed.equipped) last = { id: item.id };
  const what = `${parsed.equipped ? "your equipped " : ""}${item.slot.toLowerCase()}`;
  if (!item.sockets.length) setStatus(`Read ${what}, but couldn't see its sockets. Every piece has at least one: hover it again with nothing bright behind the item picture.`, true);
  else setStatus(`${known ? "Already have this" : "Read"} ${what} ✓  ${pasted ? "Paste the next one." : "Hover the next one."}`, true);
  render();
  return parsed;
}


// Add an item, or update it if this exact one was read before. Returns the stored item.
function remember(p) {
  // Sockets aren't part of the key: a re-hover that finally sees them updates the same item.
  const key = [p.slot, p.cls, p.lines.join(","), p.stats].join("|");
  if (p.equipped) for (const it of state.items) if (it.slot === p.slot) it.equipped = false;
  // A cell holds one item: whatever was there before has moved or gone.
  if (p.cell) for (const it of state.items) if (it.cell === p.cell && it.key !== key) it.cell = null;
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
    if (p.cell) item.cell = p.cell;
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
// Where an item sits in the inventory ("Row 2 · Col 4"). Clicking it lights the cell up on the map.
function miniLoc(cell) {
  if (!cell) return "";
  const [c, r] = cell.split(",").map(Number);
  return `<button class="loc" data-cell="${cell}" title="Show it on the Inventory map">Row ${r + 1} · Col ${c + 1}</button>`;
}

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
// A symbol for each class line, so they're easy to tell apart without colour: sword, wand, bow and
// arrow, shuriken, anchor.
const CLASS_PATHS = {
  warrior: '<path d="M19.5 4.5 18.8 9 9.6 18.2 5.8 14.4 15 5.2z"/><path d="M4.2 12.8l7 7"/><path d="M7.4 16.6 3.8 20.2"/>',
  mage: '<path d="M4 20 14 10"/><path d="M17 2.8l1.1 2.9 2.9 1.1-2.9 1.1L17 10.8l-1.1-2.9L13 6.8l2.9-1.1z"/>',
  archer: '<path d="M5 3.5c8.5.4 15.1 7 15.5 15.5"/><path d="M5 3.5l15.5 15.5" stroke-width="1"/><path d="M3.5 20.5 16 8"/><path d="M11.8 7.6H16.4V12.2"/><path d="M3.5 17.5v3h3"/>',
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
  : state.cb ? `<span class="socks"><span class="sock-word not-read" title="Sockets not read yet: screenshot the item again">Not read</span></span>`
  : `<span class="socks unknown" title="Sockets not read yet: screenshot the item again">?</span>`);
const badge = (v) => `<span class="badge v-${v.verdict}" title="${v.why}">${VERDICT[v.verdict]}</span>`;
const linesOf = (it) => (it.lines.length ? it.lines.map((k) => chip(k)).join("") : `<span class="muted">no lines</span>`);

function render() {
  const { res, sockets, verdicts: v } = verdicts(state.items, state);
  const option = classOption(state.classId);

  $("class").innerHTML = CLASSES.map((c) => `<option ${c === option.cls ? "selected" : ""}>${c}</option>`).join("");
  // Pirates pick STR or DEX (a DEX pirate can also use purple sockets).
  $("pirate-stat").hidden = option.cls !== "Pirate";
  for (const st of ["STR", "DEX"]) $(`pirate-${st}`).setAttribute("aria-pressed", String(option.stat === st));
  for (const m of ["endgame", "early"]) $(`mode-${m}`).setAttribute("aria-pressed", String(state.mode === m));
  $("cb-toggle").setAttribute("aria-pressed", String(Boolean(state.cb)));
  // Simple mode hides everything but the jewel colour readout.
  $("simple").hidden = !state.simple;
  document.querySelector(".layout").hidden = Boolean(state.simple);
  $("simple-toggle").setAttribute("aria-pressed", String(Boolean(state.simple)));
  $("simple-toggle").textContent = state.simple ? "Back to full page" : "Simpling Dumpling mode";
  // Start over wipes everything (items, equipped pieces, the map), so it lives with the page-wide settings.
  $("clear").hidden = !state.items.length && !state.cells.length;
  $("clear").textContent = confirmClear ? "Click again: clear everything" : "Start over";
  $("clear").classList.toggle("danger", confirmClear);
  document.documentElement.classList.toggle("cb", Boolean(state.cb));

  // The last item hovered, big.
  const lastItem = last && state.items.find((it) => it.id === last.id);
  // The last item read, on one line: verdict, slot, lines, sockets.
  $("last").innerHTML = lastItem
    ? `<div class="last-line"><span class="badge v-${v[lastItem.id].verdict}" title="${v[lastItem.id].why}">${VERDICT[v[lastItem.id].verdict]}</span>
        ${slotIcon(lastItem.slot)}<b>${lastItem.slot}</b><span class="lines">${linesOf(lastItem)}</span>${socks(lastItem.sockets)}<span class="muted small why">${v[lastItem.id].why}</span></div>`
    : "";

  // The inventory map: every cell, ticked once scanned, coloured by verdict.
  const byCell = Object.fromEntries(state.items.filter((it) => it.cell).map((it) => [it.cell, it]));
  const cells = state.cells.length ? state.cells : [];
  const toScan = cells.filter((k, i) => k === "lines" && !byCell[`${i % GRID.cols},${Math.floor(i / GRID.cols)}`]).length;
  const scanned = cells.filter((k, i) => k === "lines" && byCell[`${i % GRID.cols},${Math.floor(i / GRID.cols)}`]).length;
  const pick = selected && byCell[selected];
  $("map").innerHTML = !cells.length
    ? `<p class="muted">Open the Equip tab (expanded, 16 columns), nothing hovered, press PrtScn and Ctrl+V here.</p>`
    : `<div class="row spread"><span class="muted">${scanned} scanned · ${toScan} with lines still to hover${state.mapPinned ? ` · <span class="pinned" title="Pasted from a screenshot: the live scan won't change it. Reset map to read it live again.">From your screenshot</span>` : ""}</span>
        <span class="legend"><span class="mcell lines"></span>to scan <span class="mcell item"></span>no lines (skip) <span class="mcell v-keep"></span>keep <span class="mcell v-trash"></span>trash</span></div>
      <div class="map-wrap"><div class="map">${cells.map((k, i) => {
        const id = `${i % GRID.cols},${Math.floor(i / GRID.cols)}`;
        const it = byCell[id];
        const cls = it ? `v-${v[it.id].verdict}` : k;
        return `<button class="mcell ${cls}${selected === id ? " sel" : ""}" data-cell="${id}" title="${it ? VERDICT[v[it.id].verdict] : k === "lines" ? "Has hologram lines: hover it" : k === "item" ? "An item with no hologram lines: nothing to scan" : "Empty"}">${it ? (v[it.id].verdict === "keep" ? "✓" : "✕") : k === "item" ? "–" : ""}</button>`;
      }).join("")}</div>
      ${cellPane(pick, v)}</div>`;

  // What you're wearing now (from the "Currently Equipped" boxes), and how it compares.
  const worn = Object.fromEntries(SLOTS.map((s) => [s, state.items.find((it) => it.slot === s && it.equipped) ?? null]));
  const nowRes = solve(Object.values(worn).filter(Boolean), state.mode);
  const nowScore = state.mode === "early" ? nowRes.lines : nowRes.score;
  const seenAny = Object.values(worn).some(Boolean);

  // The hologram lines panel: the best combo you could make, or (switch) what you have equipped now.
  const early = state.mode === "early";
  const showNow = state.view === "equipped" && seenAny;
  const shown = showNow ? nowRes : res;
  const head = early ? shown.lines : shown.score;
  const from = Object.fromEntries(TARGETS.map((t) => [t.k, []])); // line -> slots that supply it
  for (const s of SLOTS) shown.picks[s]?.lines.forEach((k, j) => shown.counted[s][j] && from[k].push(s));
  const cell = (k, slot) => {
    const at = slot && shown.picks[slot]?.cell;
    // Just the slot's icon (its name on hover); an empty dashed box when the line is missing.
    const inner = slot ? slotIcon(slot) : "";
    const tip = slot ? `${slot}${at ? " (in your bag: click to show it on the Inventory map)" : ""}` : "Missing";
    return at ? `<button class="cell on" data-cell="${at}" title="${tip}" aria-label="${tip}">${inner}</button>` : `<div class="cell ${slot ? "on" : ""}" title="${tip}" aria-label="${tip}">${inner}</div>`;
  };
  // Still missing: the lines this set doesn't have yet, with how many of each.
  const gaps = early ? [] : missing(shown);
  const gapCount = gaps.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
  const huntBox = !gaps.length ? ""
    : `<div class="hunt"><span class="label">Still missing · ${gaps.length} line${gaps.length === 1 ? "" : "s"}</span>
      <div class="lines">${[...gapCount].map(([k, n]) => `${chip(k)}${n > 1 ? `<span class="times">×${n}</span>` : ""}`).join("")}</div></div>`;
  // What the collapsed piece list says, so a swap is never hidden.
  const swaps = SLOTS.filter((s) => res.picks[s] && !res.picks[s].equipped);
  const swapNote = !seenAny ? "Show pieces" : swaps.length ? `Show pieces · ${swaps.length} to swap: ${swaps.join(", ")}` : "Show pieces · all of them are equipped";
  // Tabs over the left column: what you have on now, or the best combo you could make.
  $("side-tabs").innerHTML = `<button role="tab" data-view="equipped" aria-selected="${showNow}"${seenAny ? "" : ' disabled title="Hover an item first: the scanner reads the Currently Equipped box beside it"'}>Equipped now</button><button role="tab" data-view="best" aria-selected="${!showNow}">Best combo</button>`;
  // The tiny inventory map that lights up an item's cell on the big one.
  const loc = (it) => miniLoc(it?.cell);
  $("lines").innerHTML = `
    <div class="row spread"><h2>${early ? "Hologram lines (any 3 per piece)" : "Hologram lines (18/18)"}</h2></div>
    <p class="muted small explain">${showNow
      ? "What you're wearing now."
      : "The best set you can make from everything scanned."}</p>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} lines ${showNow ? "equipped now" : "with the best combo"}${early ? ` · ${shown.score} on the list` : ""}</span>
      ${seenAny ? `<span class="compare">· ${showNow ? `best combo: <b>${early ? res.lines : res.score}/${TOTAL}</b>` : `<b>${nowScore}/${TOTAL}</b> equipped now`}</span>` : ""}</div>
    ${seenAny ? "" : `<p class="muted small">Hover one item per slot to read what you're wearing.</p>`}
    <div class="board">${TARGETS.map((t) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${Array.from({ length: 3 }, (_, j) => { const k2 = j - (3 - t.need); return k2 >= 0 ? cell(t.k, from[t.k][k2]) : `<div class="cell-gap"></div>`; }).join("")}</div></div>`).join("")}</div>
    ${huntBox}
    <details class="set pieces" id="pieces"${piecesOpen ? " open" : ""}>
      <summary><span class="label">Lines per piece</span>
        <span class="muted small">${swapNote}</span></summary>
      <p class="muted small">Faded <b>extra</b> = a line you already have 3 (or 1) of.</p>
      <div class="pieces-list">${SLOTS.map((s) => {
          const it = shown.picks[s];
          const best = res.picks[s];
          const wearing = state.items.find((x) => x.slot === s && x.equipped);
          const action = showNow
            ? !it ? "" : best && best !== it ? `<span class="act swap" title="A better piece for this slot is in your bag">Better in bag</span>${loc(best)}` : `<span class="act on">Best ✓</span>`
            : !it ? "" : it.equipped ? `<span class="act on">Equipped ✓</span>` : `<span class="act swap" title="${wearing ? "Equip this instead of what you have on" : "The scanner hasn't seen what you have equipped here"}">${wearing ? "Swap" : "Equip"}</span>${loc(it)}`;
          if (!it) return `<div class="piece"><span class="piece-slot">${slotIcon(s)}${s}</span><span class="none">${showNow ? "not seen yet" : "nothing scanned yet"}</span></div>`;
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
        <div class="fuse-list">${SLOTS.map((s) => { const it = sockets.picks[s]; const v4 = it && socketValue(it, state.classId); return `<span class="fuse-item">${slotIcon(s)}${it && v4.good ? `${socks(it.sockets)}${loc(it)}` : `<span class="none">none yet</span>`}</span>`; }).join("")}</div></div>`}
    </details>`;

  // Keep or trash: your bag only (equipped pieces are on the left), filtered by verdict.
  const bag = state.items.filter((it) => !it.equipped);
  const count = { trash: bag.filter((it) => v[it.id].verdict === "trash").length, keep: bag.filter((it) => v[it.id].verdict === "keep").length, all: bag.length };
  const tab = state.gearTab ?? "trash";
  const list = bag
    .filter((it) => tab === "all" || v[it.id].verdict === tab)
    .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || (a.cell ?? "z").localeCompare(b.cell ?? "z"));
  const row = (it) => {
    const vv = v[it.id];
    return `<div class="bag-row v-row-${vv.verdict}${it.cell && it.cell === selected ? " sel" : ""}" draggable="true" data-drag="${it.id}">
      <div class="bag-top"><span class="badge v-${vv.verdict}" title="${vv.why}">${VERDICT[vv.verdict]}</span><span class="bag-why muted small">${vv.reason ? REASON[vv.reason] : vv.why}</span>
        <span class="bag-act">${miniLoc(it.cell)}<button class="equip-btn" data-equip="${it.id}" title="You equipped this in game: mark it equipped">Equip</button><button class="x" data-del="${it.id}" aria-label="Remove">×</button></span></div>
      <div class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}</div>
      ${socks(it.sockets)}
    </div>`;
  };
  $("items").innerHTML = `
    <h2>Keep or trash</h2>
    ${addForm()}
    <div class="gear-tabs" role="tablist">${[["trash", "Trash"], ["keep", "Keep"], ["all", "All"]].map(([k, label]) => `<button role="tab" data-gear-tab="${k}" aria-selected="${tab === k}" class="gt-${k}">${label} <span class="n">${count[k]}</span></button>`).join("")}</div>
    <p class="muted small">${tab === "trash" ? "Safe to throw away." : tab === "keep" ? "Best combo, spare 3-line pieces and the best sockets." : "Everything in your bag."}</p>
    ${bag.length ? `<div class="slots">${SLOTS.map((sl) => {
      const mineHere = list.filter((it) => it.slot === sl);
      const allHere = bag.filter((it) => it.slot === sl).length;
      return `<div class="slot" data-drop-slot="${sl}"><div class="slot-head"><h3>${slotIcon(sl)}${sl}</h3><span class="tag">${mineHere.length}${tab === "all" ? "" : ` of ${allHere}`}</span></div>
        ${mineHere.length ? mineHere.map(row).join("") : `<div class="none">${allHere ? "Nothing here" : "Nothing scanned yet"}</div>`}</div>`;
    }).join("")}</div>` : `<p class="none">Nothing scanned yet: hover items in your inventory.</p>`}`;
}

// ---------- equipping in game ----------
// After swapping in game: the new piece is equipped, and the old one goes back into the bag, in the
// inventory cell the new one came from (that's where the game puts it).
function equipItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const old = state.items.find((x) => x.slot === it.slot && x.equipped);
  if (old) {
    old.equipped = false;
    old.cell = it.cell;
  }
  it.equipped = true;
  it.cell = null;
  setStatus(`Marked your ${it.slot.toLowerCase()} as equipped ✓`, Boolean(stream));
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
    setStatus(`That's a ${it.slot.toLowerCase()}: drop it on the ${it.slot} card.`, Boolean(stream));
    return;
  }
  equipItem(id);
  save();
  render();
});

// The pane beside the map: what's in the clicked cell, or a way to add it by hand.
function cellPane(it, v) {
  if (!selected) return `<div class="cell-pane muted small">Click a cell to see what's in it.</div>`;
  const [c, r] = selected.split(",").map(Number);
  const where = `Row ${r + 1} · Col ${c + 1}`;
  if (!it) {
    return `<div class="cell-pane"><span class="label">${where}</span>
      <p class="muted small">Nothing scanned here yet. Hover it in the game, or add it by hand.</p>
      <button id="add-here" data-cell-add="${selected}">Add this item manually</button></div>`;
  }
  const vv = v[it.id];
  return `<div class="cell-pane"><span class="label">${where}</span>
    <div class="row"><span class="badge v-${vv.verdict}">${VERDICT[vv.verdict]}</span><span class="muted small">${vv.reason ? REASON[vv.reason] : vv.why}</span></div>
    <div class="row"><b>${slotIcon(it.slot)}${it.slot}</b></div>
    <div class="lines">${linesOf(it)}</div>
    <div>${socks(it.sockets)}</div>
    <div class="row"><button class="equip-btn" data-equip="${it.id}">Equip</button><button class="equip-btn" data-del="${it.id}">Remove</button></div></div>`;
}

// ---------- add manually ----------
// Tap a slot, up to 3 lines and up to 3 sockets, then Add. The slot stays picked for the next one.
let draft = { slot: "Hat", lines: [], sockets: [] };
let addOpen = false;
try {
  addOpen = localStorage.getItem("quandrea.addOpen") === "1";
} catch {}

function addForm() {
  const tap = (attr, val, label, on, off = false, extra = "") => `<button class="tap${attr === "pick-line" ? ` k-${val}` : ""}${on ? " on" : ""}" data-${attr}="${val}"${off ? " disabled" : ""}${extra}>${label}</button>`;
  const fullLines = draft.lines.length >= 3;
  const fullSocks = draft.sockets.length >= 3;
  return `<details class="add-manual" id="add-manual"${addOpen ? " open" : ""}>
    <summary><span class="label">Add manually</span><span class="muted small">${draft.cell ? `for the item at Row ${+draft.cell.split(",")[1] + 1} · Col ${+draft.cell.split(",")[0] + 1} <button class="loc" id="add-nocell" title="Don't tie it to a map cell">×</button>` : "for an item the scanner can't read"}</span></summary>
    <div class="add-row"><span class="add-label">Slot</span>${SLOTS.map((s) => tap("pick-slot", s, `${slotIcon(s)}${s}`, draft.slot === s)).join("")}</div>
    <div class="add-row"><span class="add-label">Lines <span class="muted">${draft.lines.length}/3</span></span>${[...TARGETS.map((t) => t.k), ...FILLERS.map((f) => f.k), OTHER].map((k) => {
      const picked = draft.lines.includes(k);
      // A piece can't have the same line twice; only unrecognised "Other" lines can repeat.
      const off = fullLines && !picked;
      return tap("pick-line", k, `${icon(k)}${NAME[k]}${k === OTHER && draft.lines.filter((x) => x === OTHER).length > 1 ? ` ×${draft.lines.filter((x) => x === OTHER).length}` : ""}`, picked, off);
    }).join("")}</div>
    <div class="add-row"><span class="add-label">Sockets <span class="muted">${draft.sockets.length}/3</span></span>${SOCKETS.map((c) => tap("pick-sock", c, `${jewel(c)}${draft.sockets.filter((x) => x === c).length > 1 ? `×${draft.sockets.filter((x) => x === c).length}` : ""}`, draft.sockets.includes(c), fullSocks && !draft.sockets.includes(c), ` title="${c}"`)).join("")}</div>
    <div class="add-row"><span class="add-label"></span>
      <span class="draft"><b>${draft.slot}</b>
        ${draft.lines.length ? draft.lines.map((k, i) => `<button class="unpick" data-unline="${i}" title="Remove">${chip(k)}</button>`).join("") : `<span class="muted">tap its lines</span>`}
        ${draft.sockets.length ? draft.sockets.map((c, i) => `<button class="unpick" data-unsock="${i}" title="Remove">${jewel(c)}</button>`).join("") : `<span class="muted">· tap its sockets</span>`}</span>
      <button id="add" class="primary"${draft.sockets.length ? "" : " disabled"}>Add</button>
      ${draft.lines.length || draft.sockets.length ? `<button id="add-clear" class="ghost">Start over</button>` : ""}</div>
  </details>`;
}

document.addEventListener("toggle", (e) => {
  if (e.target.id !== "add-manual") return;
  addOpen = e.target.open;
  try {
    localStorage.setItem("quandrea.addOpen", addOpen ? "1" : "0");
  } catch {}
}, true);

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id !== "clear") confirmClear = false;
  if (t.id === "share" && LIVE_SHARE) return startShare();
  if (t.id === "save-frame") {
    // The exact frame the scanner sees, to send for tuning (it may show character names).
    frame.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `quandrea-frame-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
    return;
  }
  if (t.id === "stop") return stopShare();
  if (t.dataset.themePick) return setTheme(t.dataset.themePick);
  if (t.id === "simple-toggle") {
    state.simple = !state.simple;
    save();
    render();
    return;
  }
  if (t.id === "simple-share" && LIVE_SHARE) return startShare();
  if (t.id === "cb-toggle") {
    state.cb = !state.cb;
    save();
    render();
    return;
  }
  if (t.id === "reset-map") {
    state.cells = [];
    state.mapPinned = false;
    state.scale = undefined;
    lastCalibration = 0;
    grid = null;
    selected = null;
    save();
    render();
    setStatus(stream ? "Map cleared. Move the mouse off your inventory and it reads it again." : "Map cleared. Paste a screenshot of your inventory (Ctrl+V).", Boolean(stream));
    return;
  }
  if (t.dataset.cellAdd) {
    draft = { ...draft, cell: t.dataset.cellAdd, lines: [], sockets: [] };
    addOpen = true;
    render();
    $("add-manual")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (t.dataset.gearTab) {
    state.gearTab = t.dataset.gearTab;
    save();
    render();
    return;
  }
  if (t.dataset.equip) equipItem(t.dataset.equip);
  else if (t.dataset.cell && !t.closest(".map")) {
    selected = t.dataset.cell;
    save();
    render();
    document.querySelector(".map")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  else if (t.dataset.view) state.view = t.dataset.view;
  else if (t.dataset.cell) selected = selected === t.dataset.cell ? null : t.dataset.cell;
  else if (t.dataset.mode) state.mode = t.dataset.mode;
  else if (t.dataset.stat) state.classId = `Pirate (${t.dataset.stat})`;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
      state.cells = [];
      state.mapPinned = false;
      grid = null;
      selected = null;
      last = null;
      done = [];
    }
    confirmClear = !confirmClear;
  } else if (t.dataset.pickSlot) draft.slot = t.dataset.pickSlot;
  else if (t.dataset.pickLine) {
    const k = t.dataset.pickLine;
    // Tapping a picked line removes it; Other adds another copy (Boss + IED are both Other).
    if (k !== OTHER && draft.lines.includes(k)) draft.lines = draft.lines.filter((x) => x !== k);
    else if (draft.lines.length < 3) draft.lines = [...draft.lines, k];
    else if (k === OTHER && draft.lines.includes(OTHER)) draft.lines.splice(draft.lines.lastIndexOf(OTHER), 1);
  } else if (t.dataset.pickSock) {
    const c = t.dataset.pickSock;
    if (draft.sockets.length < 3) draft.sockets = [...draft.sockets, c];
    else draft.sockets.splice(draft.sockets.lastIndexOf(c), 1);
  } else if (t.dataset.unline) draft.lines.splice(+t.dataset.unline, 1);
  else if (t.dataset.unsock) draft.sockets.splice(+t.dataset.unsock, 1);
  else if (t.id === "add-clear") draft = { ...draft, lines: [], sockets: [] };
  else if (t.id === "add") {
    if (!draft.sockets.length) {
      setStatus("Every piece has at least one socket. Tap its socket colours.");
      return;
    }
    remember({ slot: draft.slot, cls: classOption(state.classId).classes[0], lines: draft.lines, sockets: draft.sockets, equipped: false, stats: `hand-${Date.now()}`, cell: draft.cell ?? null });
    setStatus(`Added a ${draft.slot.toLowerCase()}${draft.cell ? " to that cell" : ""} ✓`, Boolean(stream));
    draft = { ...draft, lines: [], sockets: [], cell: null };
  } else return;
  save();
  render();
});

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

// Paste a screenshot (Win+Shift+S, then Ctrl+V here): an item's tooltip is read like a hover; the
// inventory window fills in the map. Works without sharing the screen.
const TIP_W = 321; // a tooltip's width at normal game size
async function pasteTooltips(img) {
  // The game size is unknown in a screenshot. A tooltip found by its border has its real width,
  // which gives the size (a normal one is 321px wide); a box found by its title is just drawn at
  // the size we tried, so it says nothing. Try a few sizes and use the border widths.
  const sizes = [];
  for (const s of SIMPLE_SIZES)
    for (const b of findTooltips(img, s)) {
      const k = b.width / TIP_W;
      if (b.width !== Math.round(TIP_W * s) && k > 0.55 && k < 2.2 && b.height > b.width) sizes.push(k);
    }
  sizes.sort((x, y) => x - y);
  let found = null;
  for (const s of [sizes[Math.floor(sizes.length / 2)], state.scale ?? 1, ...SIMPLE_SIZES].filter(Boolean)) {
    const boxes = findTooltips(img, s).filter((b) => iconFits(b, findIcon(img, b)));
    if (boxes.length > (found?.boxes.length ?? 0)) found = { s, boxes };
    if (found) break;
  }
  // Just the tooltip snipped, edges and all: the whole picture is the tooltip.
  if (!found && img.width < img.height && img.width > 150) {
    const box = { x: 0, y: 0, width: img.width, height: img.height };
    if (findIcon(img, box)) found = { s: img.width / TIP_W, boxes: [box] };
  }
  if (!found) return false;
  if (!(await ensureWorker())) return true;
  // If the inventory is in the same screenshot, the cursor says which cell the item is in.
  const inGrid = findGrid(found.s === 1 ? img : resizeImage(img, 1 / found.s));
  for (const box of found.boxes.slice(0, 2)) await readTooltip(img, box, { sc: found.s, inGrid, pasted: true });
  return true;
}

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
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    if (state.simple) {
      showSimple(img, { now: true });
      return;
    }
    if (busy) return;
    busy = true;
    try {
      if (await pasteTooltips(img)) return;
    } finally {
      busy = false;
    }
    const g = findGrid(img);
    if (!g) {
      setStatus(findGrid(img, 4) ? "That's the small inventory view (4 columns). Expand it with the + at its top right, then take the screenshot again." : "Couldn't find an item tooltip or the inventory in that screenshot. Snip the whole tooltip (or the whole Equip tab, expanded to 16 columns).", true);
      return;
    }
    state.cells = readCells(img, g);
    state.mapPinned = true;
    save();
    render();
    setStatus("Map filled in from your screenshot ✓ The live scan won't change it; Reset map to read it live again.", true);
  } catch (err) {
    setStatus(`Couldn't read that image: ${err.message}`, true);
  }
});

// ---------- Simpling Dumpling pop-out ----------
// Chrome and Edge can open a small always-on-top window (Document Picture-in-Picture). The
// readout moves into it, so the colours stay visible over the game; closing it moves them back.
if (LIVE_SHARE && "documentPictureInPicture" in window) $("simple-popout").hidden = false;
$("simple-popout").addEventListener("click", async () => {
  if (pipDoc) {
    pipDoc.defaultView.close();
    return;
  }
  let win;
  try {
    win = await documentPictureInPicture.requestWindow({ width: 380, height: 420 });
  } catch (err) {
    $("simple-status").textContent = `Couldn't pop out: ${err.message}`;
    return;
  }
  // Copy the page's styles into the new window.
  const css = win.document.createElement("style");
  css.textContent = [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].map((r) => r.cssText);
    } catch {
      return [];
    }
  }).join("\n");
  win.document.head.append(css);
  win.document.title = "Simpling Dumpling";
  const sync = () => {
    win.document.documentElement.className = document.documentElement.className;
    if (document.documentElement.dataset.theme) win.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    else delete win.document.documentElement.dataset.theme;
  };
  sync();
  win.document.body.classList.add("popout");
  const status = $("simple-status");
  const out = $("simple-out");
  const home = out.parentNode;
  win.document.body.append(status, out);
  pipDoc = win.document;
  $("simple-popout").textContent = "Put back";
  const watch = new MutationObserver(sync);
  watch.observe(document.documentElement, { attributes: true });
  win.addEventListener("pagehide", () => {
    watch.disconnect();
    home.append(status, out);
    pipDoc = null;
    $("simple-popout").textContent = "Pop out";
  });
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
    setStatus(`Backup of ${state.items.length} item${state.items.length === 1 ? "" : "s"} copied. Keep it somewhere safe (a note, a Discord DM to yourself); paste it here any time to restore.`, Boolean(stream));
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
  else setStatus("Copy your backup code, then press Ctrl+V on this page (or click Load backup again).", Boolean(stream));
});

function loadBackup(text) {
  let data;
  try {
    data = importCode(text);
  } catch (err) {
    setStatus(err.message, Boolean(stream));
    return;
  }
  const n = data.items.length;
  if (state.items.length && !confirm(`Replace your ${state.items.length} scanned item${state.items.length === 1 ? "" : "s"} with the ${n} in this backup?`)) return;
  state = { ...state, ...data };
  equippedSeen = [];
  save();
  render();
  flash($("backup-load"), "Loaded ✓");
  setStatus(`Loaded ${n} item${n === 1 ? "" : "s"} from your backup ✓`, Boolean(stream));
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

// Firefox's screen capture often sends games black or frozen: point people to Chrome or Edge.
if (LIVE_SHARE && /firefox/i.test(navigator.userAgent)) for (const el of document.querySelectorAll(".browser-note")) el.hidden = false;

// The version is the ?v=N this script was loaded with (see index.html), so it always matches.
$("version").textContent = `Quandrea v${new URL(import.meta.url).searchParams.get("v") ?? "dev"}`;

if (!LIVE_SHARE) {
  $("share").hidden = true;
  $("simple-share").hidden = true;
}
load();
render();
