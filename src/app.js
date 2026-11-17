// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, OTHER } from "./parse.js?v=17";
import { verdicts, solve, onePieceAway, TOTAL, CLASSES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js?v=17";
import { findTooltips, findIcon, findSockets, prepareForOcr, textProfile, profileDiff, findGrid, readCells, findCursor, cellAt, findScale, resizeImage, GRID } from "./vision.js?v=17";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), [OTHER, "Other"]]);
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
    if (raw && Array.isArray(raw.items)) state = { ...state, ...raw };
    // Older saves had the sockets inside each item's key (slot|class|lines|sockets|stats).
    for (const it of state.items) {
      const parts = String(it.key ?? "").split("|");
      if (parts.length === 5) it.key = [parts[0], parts[1], parts[2], parts[4]].join("|");
    }
  } catch {}
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

// ---------- capture and scanning ----------

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
  $("stop").hidden = false;
  $("save-frame").hidden = false;
  setStatus("Loading the text reader (first time only)…", true);
  if (!worker) {
    try {
      worker = await Tesseract.createWorker("eng");
    } catch (err) {
      setStatus(`Couldn't load the text reader: ${err.message}`);
      return;
    }
  }
  setStatus("Watching. Hover an item in your inventory.", true);
  timer = setInterval(tick, 400);
}

function stopShare() {
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("share").hidden = false;
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
  const scale = state.scale ?? 1;
  const now = findTooltips(img, scale).map((box) => ({ box, profile: textProfile(img, box) }));
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

async function readTooltip(img, box) {
  setStatus("Reading…", true);
  const sc = state.scale ?? 1;
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
  const cell = at && cellAt(grid, at.x / sc, at.y / sc);
  const before = state.items.length;
  const item = remember({ ...parsed, sockets, cell: cell ? `${cell.c},${cell.r}` : null });
  const known = state.items.length === before;
  if (!parsed.equipped) last = { id: item.id };
  const what = `${parsed.equipped ? "your equipped " : ""}${item.slot.toLowerCase()}`;
  if (!item.sockets.length) setStatus(`Read ${what}, but couldn't see its sockets. Every piece has at least one: hover it again with nothing bright behind the item picture.`, true);
  else setStatus(known ? `Already have this ${what} ✓  Hover the next one.` : `Read ${what} ✓  Hover the next one.`, true);
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
  let item = state.items.find((it) => it.key === key);
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
const chip = (k, extraCopy = false) => chipHtml(k, extraCopy && k !== OTHER); // filler is never an "extra"
// The in-game hologram skill icon for each line (class lines use one skill of their pair).
// Where an item sits in the inventory ("Row 2 · Col 4"). Clicking it lights the cell up on the map.
function miniLoc(cell) {
  if (!cell) return "";
  const [c, r] = cell.split(",").map(Number);
  return `<button class="loc" data-cell="${cell}" title="Show it on the Inventory map">Row ${r + 1} · Col ${c + 1}</button>`;
}

// Simple line icons for each slot, drawn in the text colour.
const SLOT_PATHS = {
  Hat: '<path d="M7 17.5 12 4l5 13.5"/><path d="M3.5 18.5c3 1.6 14 1.6 17 0"/><path d="M9.2 12h5.6"/>',
  Top: '<path d="M9 4 4.5 6.5l1.8 4 2.2-1V20h7V9.5l2.2 1 1.8-4L15 4c-.6 1.6-1.6 2.5-3 2.5S9.6 5.6 9 4z"/>',
  Bottom: '<path d="M7 4h10l1.2 16h-4.4L12 10.5 10.2 20H5.8z"/><path d="M7 7h10"/>',
  Cape: '<path d="M8.5 4h7l1.2 3.2C19 11 20 15.5 20 20H4c0-4.5 1-9 3.3-12.8z"/><path d="M8.5 4c.8 2 2 3 3.5 3s2.7-1 3.5-3"/>',
  Gloves: '<path d="M8 20v-4.5L5.3 11.8c-.9-1.2.6-2.8 1.9-1.8L8 10.7V6.2a1.4 1.4 0 0 1 2.8 0V5.4a1.4 1.4 0 0 1 2.8 0v.8a1.4 1.4 0 0 1 2.8 0V14c0 3.3-1.2 6-3.4 6z"/><path d="M8 17h8"/>',
  Shoes: '<path d="M7 4h5v8.5l5 2.4A3 3 0 0 1 19 17.6V19H6z"/><path d="M6 16h13"/><path d="M12 7h-5"/>',
};
const slotIcon = (slot) => `<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SLOT_PATHS[slot] ?? ""}</svg>`;
const icon = (k) => (k === OTHER ? "" : `<img class="skill-icon" src="icons/${k}.png" alt="">`);
const chipHtml = (k, extra) => `<span class="chip k-${k}${extra ? " extra" : ""}"${extra ? ' title="Extra copy: still +1 to the skill, but a line you\'re missing would do more here"' : ""}>${icon(k)}${NAME[k]}${extra ? '<small>extra</small>' : ""}</span>`;
// Sockets drawn as the jewel that fits them (cropped from the game's jewel inventory).
const socks = (list) => (!list?.length ? `<span class="socks unknown" title="Sockets not read yet: hover the item again">?</span>` : `<span class="socks">${list.map((c) => `<img class="jewel" src="icons/jewels/${c}.png" alt="${c}" title="${c} socket">`).join("")}</span>`);
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
    ? `<p class="muted">Open your inventory's Equip tab, <b>expanded</b> so all 16 columns show (the small view only shows 4), and move the mouse off it: the map appears here. Or take a screenshot of the inventory window (Win+Shift+S) and paste it here with Ctrl+V.</p>`
    : `<div class="row spread"><span class="muted">${scanned} scanned · ${toScan} with lines still to hover${state.mapPinned ? ` · <span class="pinned" title="Pasted from a screenshot: the live scan won't change it. Reset map to read it live again.">From your screenshot</span>` : ""}</span>
        <span class="legend"><span class="mcell lines"></span>to scan <span class="mcell item"></span>no lines (skip) <span class="mcell v-keep"></span>keep <span class="mcell v-trash"></span>trash</span></div>
      <div class="map">${cells.map((k, i) => {
        const id = `${i % GRID.cols},${Math.floor(i / GRID.cols)}`;
        const it = byCell[id];
        const cls = it ? `v-${v[it.id].verdict}` : k;
        return `<button class="mcell ${cls}${selected === id ? " sel" : ""}" data-cell="${id}" title="${it ? VERDICT[v[it.id].verdict] : k === "lines" ? "Has hologram lines: hover it" : k === "item" ? "An item with no hologram lines: nothing to scan" : "Empty"}">${it ? "✓" : k === "item" ? "–" : ""}</button>`;
      }).join("")}</div>
      ${pick ? `<div class="last"><div class="info"><div class="row"><span class="verdict-big" style="color:var(--${v[pick.id].verdict})">${VERDICT[v[pick.id].verdict]}</span><span class="muted">${v[pick.id].why}</span></div>
        <div class="row"><b>${pick.slot}</b><span class="tag">row ${+selected.split(",")[1] + 1}, column ${+selected.split(",")[0] + 1}</span>${socks(pick.sockets)}</div><div class="lines">${linesOf(pick)}</div></div></div>`
        : selected ? `<p class="muted">Nothing scanned in that cell yet. Hover it in the game.</p>` : `<p class="muted small">Click a ticked cell to see its lines and sockets.</p>`}`;

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
    const inner = `${slot ? slotIcon(slot) : ""}<span class="cell-slot">${slot ?? "missing"}</span>`;
    return at ? `<button class="cell k-${k} on" data-cell="${at}" title="In your bag: show it on the Inventory map">${inner}</button>` : `<div class="cell k-${k} ${slot ? "on" : ""}">${inner}</div>`;
  };
  // "One more piece finishes it": what a single drop in each slot would need (right-lines mode only).
  const mine = state.items.filter((it) => option.classes.includes(it.cls));
  const hunt = !early && res.score < TOTAL && mine.length ? onePieceAway(mine) : [];
  // Only shown when a single piece really can finish 18/18.
  const huntBox = early || res.score >= TOTAL || !hunt.length ? ""
    : `<div class="hunt"><span class="label">One more piece finishes it</span>${hunt.length
      ? hunt.slice(0, 6).map((o) => `<div class="hunt-row">${slotIcon(o.slot)}<b>${o.slot}</b> with ${o.need.map((k) => chip(k)).join(" + ")}${o.need.length < 3 ? `<span class="muted small">(+ any ${o.need.length === 2 ? "3rd line" : "2 more lines"})</span>` : ""}</div>`).join("")
        + (hunt.length > 6 ? `<span class="muted small">and ${hunt.length - 6} more options</span>` : "")
      : `<span class="muted small">More than one piece away: keep scanning and farming 3-line pieces.</span>`}</div>`;
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
      ? "What you have equipped right now. Row · Col shows where a better piece sits in your bag."
      : "The best outfit you can make from everything scanned (equipped or in your bag): one piece per slot, covering as many of the 18 lines as possible. Row · Col shows where a piece sits in your bag."}</p>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} lines ${showNow ? "equipped now" : "with the best combo"}${early ? ` · ${shown.score} on the list` : ""}</span>
      ${seenAny ? `<span class="compare">· ${showNow ? `best combo: <b>${early ? res.lines : res.score}/${TOTAL}</b>` : `<b>${nowScore}/${TOTAL}</b> equipped now`}</span>` : ""}</div>
    ${seenAny ? "" : `<p class="muted small">Hover any item and the scanner also reads the "Currently Equipped" box beside it. Do one per slot to see what you have on now.</p>`}
    <div class="board">${TARGETS.map((t) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${Array.from({ length: 3 }, (_, j) => { const k2 = j - (3 - t.need); return k2 >= 0 ? cell(t.k, from[t.k][k2]) : `<div class="cell-gap"></div>`; }).join("")}</div></div>`).join("")}</div>
    ${huntBox}
    <details class="set pieces" id="pieces"${piecesOpen ? " open" : ""}>
      <summary><span class="label">Lines per piece</span>
        <span class="muted small">${swapNote}</span></summary>
      <p class="muted small">Each row is one ${showNow ? "equipped piece" : "piece of the best combo"}, with its lines and sockets. Faded <b>extra</b> = a copy beyond the 18 (still +1 to the skill, up to Lv. 8, but a missing line would do more).</p>
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
        <span class="muted small">Aim for 4 with prismatic + ${option.colours[0]} + ${option.colours[0]} and 2 with ${option.colours[0]} ×3 (${option.cls}: ${option.colours.join(", ")}). Orbs move your lines onto them.</span>
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
      <span class="badge v-${vv.verdict}" title="${vv.why}">${VERDICT[vv.verdict]}</span>
      <span class="bag-slot">${slotIcon(it.slot)}${it.slot}</span>
      <span class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}</span>
      ${socks(it.sockets)}
      <span class="bag-why muted small">${vv.reason ? REASON[vv.reason] : vv.why}</span>
      <span class="bag-act">${miniLoc(it.cell)}<button class="equip-btn" data-equip="${it.id}" title="You equipped this in game: mark it equipped">Equip</button><button class="x" data-del="${it.id}" aria-label="Remove">×</button></span>
    </div>`;
  };
  $("items").innerHTML = `
    <div class="row spread"><h2>Keep or trash</h2>
      ${state.items.length ? `<button id="clear" class="ghost ${confirmClear ? "danger" : ""}">${confirmClear ? "Click again to clear all" : "Clear all"}</button>` : ""}</div>
    ${addForm()}
    <div class="gear-tabs" role="tablist">${[["trash", "Trash"], ["keep", "Keep"], ["all", "All"]].map(([k, label]) => `<button role="tab" data-gear-tab="${k}" aria-selected="${tab === k}" class="gt-${k}">${label} <span class="n">${count[k]}</span></button>`).join("")}</div>
    <p class="muted small">${tab === "trash" ? "Safe to throw away. Click Row · Col to find one on the Inventory map." : tab === "keep" ? "Hold on to these: in your best combo, a spare 3-line piece, or the best sockets for their slot." : "Everything in your bag. Equipped pieces are on the left."}</p>
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
    <summary><span class="label">Add manually</span><span class="muted small">for an item the scanner can't read</span></summary>
    <div class="add-row"><span class="add-label">Slot</span>${SLOTS.map((s) => tap("pick-slot", s, `${slotIcon(s)}${s}`, draft.slot === s)).join("")}</div>
    <div class="add-row"><span class="add-label">Lines <span class="muted">${draft.lines.length}/3</span></span>${[...TARGETS.map((t) => t.k), OTHER].map((k) => {
      const picked = draft.lines.includes(k);
      // A piece can't have the same line twice; Other (Boss, IED, Damage) can repeat.
      const off = fullLines && !picked;
      return tap("pick-line", k, `${icon(k)}${NAME[k]}${k === OTHER && draft.lines.filter((x) => x === OTHER).length > 1 ? ` ×${draft.lines.filter((x) => x === OTHER).length}` : ""}`, picked, off);
    }).join("")}</div>
    <div class="add-row"><span class="add-label">Sockets <span class="muted">${draft.sockets.length}/3</span></span>${SOCKETS.map((c) => tap("pick-sock", c, `<img class="jewel" src="icons/jewels/${c}.png" alt="">${draft.sockets.filter((x) => x === c).length > 1 ? `×${draft.sockets.filter((x) => x === c).length}` : ""}`, draft.sockets.includes(c), fullSocks && !draft.sockets.includes(c), ` title="${c}"`)).join("")}</div>
    <div class="add-row"><span class="add-label"></span>
      <span class="draft"><b>${draft.slot}</b>
        ${draft.lines.length ? draft.lines.map((k, i) => `<button class="unpick" data-unline="${i}" title="Remove">${chip(k)}</button>`).join("") : `<span class="muted">tap its lines</span>`}
        ${draft.sockets.length ? draft.sockets.map((c, i) => `<button class="unpick" data-unsock="${i}" title="Remove"><img class="jewel" src="icons/jewels/${c}.png" alt="${c}"></button>`).join("") : `<span class="muted">· tap its sockets</span>`}</span>
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
  if (t.id === "share") return startShare();
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
  if (t.id === "reset-map") {
    state.cells = [];
    state.mapPinned = false;
    state.scale = undefined;
    lastCalibration = 0;
    grid = null;
    selected = null;
    save();
    render();
    setStatus(stream ? "Map cleared. Move the mouse off your inventory and it reads it again." : "Map cleared. Share your game window, or paste a screenshot of your inventory (Ctrl+V).", Boolean(stream));
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
    remember({ slot: draft.slot, cls: classOption(state.classId).classes[0], lines: draft.lines, sockets: draft.sockets, equipped: false, stats: `hand-${Date.now()}` });
    setStatus(`Added a ${draft.slot.toLowerCase()} ✓`, Boolean(stream));
    draft = { ...draft, lines: [], sockets: [] };
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

// Paste a screenshot of the inventory window (Win+Shift+S, then Ctrl+V here) to fill in the map.
document.addEventListener("paste", async (e) => {
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
    const g = findGrid(img);
    if (!g) {
      setStatus(findGrid(img, 4) ? "That's the small inventory view (4 columns). Expand it with the + at its top right, then take the screenshot again." : "Couldn't find the inventory in that screenshot. Capture the whole Equip tab, expanded so all 16 columns show.", Boolean(stream));
      return;
    }
    state.cells = readCells(img, g);
    state.mapPinned = true;
    save();
    render();
    setStatus("Map filled in from your screenshot ✓ The live scan won't change it; Reset map to read it live again.", Boolean(stream));
  } catch (err) {
    setStatus(`Couldn't read that image: ${err.message}`, Boolean(stream));
  }
});

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
