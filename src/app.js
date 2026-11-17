// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, OTHER } from "./parse.js?v=6";
import { verdicts, solve, TOTAL, CLASSES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js?v=6";
import { findTooltips, findIcon, findSockets, prepareForOcr, textProfile, profileDiff, findGrid, readCells, findCursor, cellAt, GRID } from "./vision.js?v=6";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), [OTHER, "Other"]]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];
const VERDICT = { keep: "Keep", backup: "Backup", donor: "Socket donor", trash: "Trash" };

let state = { items: [], classId: "Magician", mode: "endgame", cells: [] };
let grid = null; // where the inventory grid is on screen (found while no tooltip is open)
let selected = null; // the inventory cell clicked in the map, "c,r"
let last = null; // { item, crop } of the most recent hovered (not equipped) tooltip
let confirmClear = false;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.items)) state = { ...state, ...raw };
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
  setStatus("Stopped. Your items are saved in this browser.");
}

async function tick() {
  if (busy || !video.videoWidth) return;
  frame.width = video.videoWidth;
  frame.height = video.videoHeight;
  fctx.drawImage(video, 0, 0);
  const img = fctx.getImageData(0, 0, frame.width, frame.height);
  const now = findTooltips(img).map((box) => ({ box, profile: textProfile(img, box) }));
  const same = (a, b) => near(a.box, b.box) && profileDiff(a.profile, b.profile) < SAME;
  // A tooltip counts as still when it matches one from the last frame (it fades in, the mouse moves).
  for (const t of now) t.still = (prev.find((p) => same(p, t))?.still ?? 0) + 1;
  prev = now;
  // Forget read tooltips once they close, so hovering that item again reads it again.
  done = done.filter((d) => now.some((t) => same(d, t)));
  if (!now.length) {
    // Nothing covering the inventory: refresh the map of what's in each cell.
    const g = findGrid(img);
    if (g) {
      grid = g;
      const cells = readCells(img, g);
      if (cells.join() !== state.cells.join()) {
        state.cells = cells;
        save();
        render();
      }
    }
    return;
  }
  const fresh = now.filter((t) => !done.some((d) => same(d, t)));
  if (!fresh.length) return;
  const ready = fresh.filter((t) => t.still >= 2);
  if (!ready.length) {
    setStatus("Found a tooltip. Hold still…", true);
    return;
  }
  busy = true;
  try {
    for (const t of ready) {
      done.push(t);
      await readTooltip(img, t.box);
    }
  } finally {
    busy = false;
  }
}

async function readTooltip(img, box) {
  setStatus("Reading…", true);
  const icon = findIcon(img, box);
  const sockets = findSockets(img, icon);
  const top = Math.max(0, box.y - 40); // the title can sit just above where the border is found
  const area = { x: box.x, y: top, width: box.width, height: box.y + box.height - top };
  const prepared = prepareForOcr(img, area);
  const c = document.createElement("canvas");
  c.width = prepared.width;
  c.height = prepared.height;
  c.getContext("2d").putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
  const { data } = await worker.recognize(c);
  const parsed = parseTooltip(data.text);
  if (!parsed.slot && parsed.skip) {
    setStatus(`That's a ${parsed.skip.toLowerCase()}. It can't roll hologram lines, so there's nothing to scan.`, true);
    return;
  }
  if (!parsed.slot) {
    setStatus("Couldn't read that tooltip. Hover it again, or move it so nothing bright is behind it.", true);
    return;
  }
  // Which inventory cell it came from: the one under the game's glove cursor.
  const at = parsed.equipped ? null : findCursor(img, box);
  const cell = at && cellAt(grid, at.x, at.y);
  const before = state.items.length;
  const item = remember({ ...parsed, sockets, cell: cell ? `${cell.c},${cell.r}` : null });
  const known = state.items.length === before;
  if (!parsed.equipped) last = { id: item.id, crop: cropCanvas(img, area) };
  const what = `${parsed.equipped ? "your equipped " : ""}${item.slot.toLowerCase()}`;
  setStatus(known ? `Already have this ${what} ✓  Hover the next one.` : `Read ${what} ✓  Hover the next one.`, true);
  render();
}

function cropCanvas(img, area) {
  const c = document.createElement("canvas");
  c.width = area.width;
  c.height = area.height;
  const sub = new ImageData(area.width, area.height);
  for (let y = 0; y < area.height; y++) {
    const from = ((area.y + y) * img.width + area.x) * 4;
    sub.data.set(img.data.subarray(from, from + area.width * 4), y * area.width * 4);
  }
  c.getContext("2d").putImageData(sub, 0, 0);
  return c;
}

// Add an item, or update it if this exact one was read before. Returns the stored item.
function remember(p) {
  const key = [p.slot, p.cls, p.lines.join(","), p.sockets.join(","), p.stats].join("|");
  if (p.equipped) for (const it of state.items) if (it.slot === p.slot) it.equipped = false;
  // A cell holds one item: whatever was there before has moved or gone.
  if (p.cell) for (const it of state.items) if (it.cell === p.cell && it.key !== key) it.cell = null;
  let item = state.items.find((it) => it.key === key);
  if (item) {
    item.equipped = p.equipped || item.equipped;
    if (p.cell) item.cell = p.cell;
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
const icon = (k) => (k === OTHER ? "" : `<img class="skill-icon" src="icons/${k}.png" alt="">`);
const chipHtml = (k, extra) => `<span class="chip k-${k}${extra ? " extra" : ""}"${extra ? ' title="Extra copy: still +1 to the skill, but a line you\'re missing would do more here"' : ""}>${icon(k)}${NAME[k]}${extra ? '<small>extra</small>' : ""}</span>`;
// Sockets drawn as the jewel that fits them (cropped from the game's jewel inventory).
const socks = (list) => `<span class="socks">${(list ?? []).map((c) => `<img class="jewel" src="icons/jewels/${c}.png" alt="${c}" title="${c} socket">`).join("")}</span>`;
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
  $("last").innerHTML = lastItem
    ? `<div class="last"><span id="last-crop"></span><div class="info">
        <div class="row"><span class="verdict-big" style="color:var(--${v[lastItem.id].verdict})">${VERDICT[v[lastItem.id].verdict]}</span><span class="muted">${v[lastItem.id].why}</span></div>
        <div class="row"><b>${lastItem.slot}</b><span class="tag">${lastItem.cls ?? ""}</span>${socks(lastItem.sockets)}</div>
        <div class="lines">${linesOf(lastItem)}</div></div></div>`
    : "";
  if (lastItem) $("last-crop").replaceWith(last.crop);

  // The inventory map: every cell, ticked once scanned, coloured by verdict.
  const byCell = Object.fromEntries(state.items.filter((it) => it.cell).map((it) => [it.cell, it]));
  const cells = state.cells.length ? state.cells : [];
  const toScan = cells.filter((k, i) => k === "lines" && !byCell[`${i % GRID.cols},${Math.floor(i / GRID.cols)}`]).length;
  const scanned = cells.filter((k, i) => k === "lines" && byCell[`${i % GRID.cols},${Math.floor(i / GRID.cols)}`]).length;
  const pick = selected && byCell[selected];
  $("map").innerHTML = !cells.length
    ? `<p class="muted">Open your inventory's Equip tab with nothing hovered, and the map of your items appears here.</p>`
    : `<div class="row spread"><span class="muted">${scanned} scanned · ${toScan} with lines still to hover</span>
        <span class="legend"><span class="mcell lines"></span>to scan <span class="mcell item"></span>no lines (skip) <span class="mcell v-keep"></span>keep <span class="mcell v-backup"></span>backup <span class="mcell v-donor"></span>donor <span class="mcell v-trash"></span>trash</span></div>
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

  // Stage 1: lines. A board of the 18 lines (filled = which piece gives it), then the set itself.
  const early = state.mode === "early";
  const head = early ? res.lines : res.score;
  const from = Object.fromEntries(TARGETS.map((t) => [t.k, []])); // line -> slots that supply it
  for (const s of SLOTS) res.picks[s]?.lines.forEach((k, j) => res.counted[s][j] && from[k].push(s));
  const cell = (k, slot) => `<div class="cell ${slot ? "on" : ""}"><span class="cell-slot">${slot ?? "missing"}</span></div>`;
  const anyWasted = SLOTS.some((s) => res.counted[s].includes(false));
  $("lines").innerHTML = `
    <div class="row spread"><h2>Stage 1 · ${early ? "18 lines" : "18/18 hologram lines"}</h2><span class="label">best set</span></div>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} ${early ? "lines" : "target lines"}${early ? ` · ${res.score} on the list` : ""}</span>
      ${seenAny ? `<span class="compare">· you have <b>${nowScore}/${TOTAL}</b> on now</span>` : ""}</div>
    ${seenAny ? "" : `<p class="muted small">Hover any item and the scanner also reads the "Currently Equipped" box beside it. Do one per slot to see what you have on now.</p>`}
    <div class="board">${TARGETS.map((t) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${Array.from({ length: 3 }, (_, j) => (j < t.need ? cell(t.k, from[t.k][j]) : `<div class="cell-gap"></div>`)).join("")}</div></div>`).join("")}</div>
    <div class="set"><span class="label">Your set</span>
      <div class="pgrid-wrap"><table class="pgrid">
        <thead><tr><th></th>${TARGETS.map((t) => `<th title="${t.name}">${icon(t.k)}<span class="ph">${SHORT[t.k]}</span></th>`).join("")}<th class="ph" title="Lines not on the list">Other</th><th></th></tr></thead>
        <tbody>${SLOTS.map((s) => {
          const it = res.picks[s];
          const wearing = state.items.find((x) => x.slot === s && x.equipped);
          const action = !it ? "" : it.equipped ? `<span class="act on">Wearing ✓</span>` : `<span class="act swap" title="${wearing ? "Equip this instead of what you have on" : "The scanner hasn't seen what you wear here"}">${wearing ? "Swap" : "Equip"}</span>`;
          if (!it) return `<tr><th>${s}</th><td colspan="${TARGETS.length + 1}" class="none">nothing scanned yet</td><td></td></tr>`;
          const marks = (piece, counted) => TARGETS.map((t) => {
            const idx = piece.lines.map((k, j) => [k, j]).filter(([k]) => k === t.k);
            if (!idx.length) return `<td></td>`;
            const counts = idx.some(([, j]) => counted[j]);
            return `<td><span class="mark ${counts ? "on" : "extra"}" title="${counts ? t.name : `Extra ${t.name}: still +1 to the skill`}">${counts ? "●" : "+"}</span></td>`;
          }).join("") + `<td class="other">${piece.lines.filter((k) => k === OTHER).length || ""}</td>`;
          // On a swap, what you wear now sits faded underneath, so the change is right there.
          const nowRow = wearing && !it.equipped ? `<tr class="now-row"><th>now</th>${marks(wearing, nowRes.counted[s])}<td class="act-cell"><span class="tag">wearing</span></td></tr>` : "";
          return `<tr><th>${s}</th>${marks(it, res.counted[s])}<td class="act-cell">${action}</td></tr>${nowRow}`;
        }).join("")}</tbody>
        <tfoot><tr><th>Total</th>${TARGETS.map((t, i) => `<td class="${res.counts[i] >= t.need ? "done" : "short"}">${res.counts[i]}/${t.need}</td>`).join("")}<td></td><td></td></tr>
          ${seenAny ? `<tr class="now-row"><th>now</th>${TARGETS.map((t, i) => `<td>${nowRes.counts[i]}/${t.need}</td>`).join("")}<td></td><td></td></tr>` : ""}</tfoot>
      </table></div>
      ${anyWasted ? `<span class="muted small"><b>+</b> = an extra copy: not wasted (each skill goes up to Lv. 8), but a line you're missing, like White Hole or Leap, would do more there.</span>` : ""}
    </div>`;

  // Stage 2: sockets.
  $("sockets").innerHTML = `
    <div class="row spread"><h2>Stage 2 · Sockets</h2><span class="label">${option.cls} (${option.stat}): ${option.colours.join(", ")}</span></div>
    <div class="score"><span class="big">${sockets.good}</span><span class="muted">of 18 good sockets · ${sockets.prismatic}/${PRISMATIC_GOAL} prismatic pieces</span></div>
    <p class="muted">Aim for 4 pieces with prismatic + stat + stat and 2 with stat + stat + stat. Orbs move your 18 lines onto these. A prismatic + ${option.colours[0]} piece is a fine stepping stone.</p>
    <div class="set"><span class="label">Socket pieces</span>${SLOTS.map((s) => {
      const it = sockets.picks[s];
      const val = it && socketValue(it, state.classId);
      return `<div class="item"><span class="slotname">${s}</span>${it && val.good ? `<span class="row">${socks(it.sockets)}<span class="tag">${val.good}/3 good</span></span>` : `<span class="none">none yet</span>`}</div>`;
    }).join("")}</div>`;

  // Everything scanned, by slot.
  const totals = { keep: 0, backup: 0, donor: 0, trash: 0 };
  for (const it of state.items) totals[v[it.id].verdict]++;
  $("items").innerHTML = `
    <div class="row spread"><h2>Your gear <span class="muted">(${state.items.length})</span></h2>
      <div class="row">${Object.entries(totals).map(([k, n]) => `<span class="badge v-${k}">${VERDICT[k]} ${n}</span>`).join("")}
      ${state.items.length ? `<button id="clear" class="ghost ${confirmClear ? "danger" : ""}">${confirmClear ? "Click again to clear all" : "Clear all"}</button>` : ""}</div></div>
    <div class="slots">${SLOTS.map((s) => {
      const list = state.items.filter((it) => it.slot === s);
      // Something you're wearing isn't "trash": a better piece should replace it.
      const row = (it) => `<div class="inv-item">${it.equipped && v[it.id].verdict === "trash" ? `<span class="badge v-trash" title="A better piece for this slot is in your inventory">Replace</span>` : badge(v[it.id])}<span class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}</span>${socks(it.sockets)}<button class="x" data-del="${it.id}" aria-label="Remove">×</button></div>`;
      const on = list.filter((it) => it.equipped);
      const bag = list.filter((it) => !it.equipped);
      return `<div class="slot"><div class="slot-head"><h3>${s}</h3><span class="tag">${list.length}</span></div>
        <div class="sub">Equipped</div>${on.length ? on.map(row).join("") : `<div class="none">not seen yet</div>`}
        <div class="sub">In inventory <span class="tag">${bag.length}</span></div>${bag.length ? bag.map(row).join("") : `<div class="none">nothing scanned yet</div>`}
      </div>`;
    }).join("")}</div>
    <div class="add"><span class="label">Add by hand</span>
      <select id="add-slot">${SLOTS.map((s) => `<option>${s}</option>`).join("")}</select>
      ${[0, 1, 2].map((i) => `<select id="add-line-${i}"><option value="">line ${i + 1}</option>${[...TARGETS.map((t) => t.k), OTHER].map((k) => `<option value="${k}">${NAME[k]}</option>`).join("")}</select>`).join("")}
      ${[0, 1, 2].map((i) => `<select id="add-sock-${i}"><option value="">socket ${i + 1}</option>${SOCKETS.map((c) => `<option>${c}</option>`).join("")}</select>`).join("")}
      <button id="add">Add</button></div>`;
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id !== "clear") confirmClear = false;
  if (t.id === "share") return startShare();
  if (t.id === "stop") return stopShare();
  if (t.dataset.cell) selected = selected === t.dataset.cell ? null : t.dataset.cell;
  else if (t.dataset.mode) state.mode = t.dataset.mode;
  else if (t.dataset.stat) state.classId = `Pirate (${t.dataset.stat})`;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
      last = null;
      done = [];
    }
    confirmClear = !confirmClear;
  } else if (t.id === "add") {
    const lines = [0, 1, 2].map((i) => $(`add-line-${i}`).value).filter(Boolean);
    const sockets = [0, 1, 2].map((i) => $(`add-sock-${i}`).value).filter(Boolean);
    remember({ slot: $("add-slot").value, cls: classOption(state.classId).classes[0], lines, sockets, equipped: false, stats: `hand-${Date.now()}` });
  } else return;
  save();
  render();
});

$("class").addEventListener("change", (e) => {
  state.classId = e.target.value === "Pirate" ? "Pirate (STR)" : e.target.value;
  save();
  render();
});

// The version is the ?v=N this script was loaded with (see index.html), so it always matches.
$("version").textContent = `Quandrea v${new URL(import.meta.url).searchParams.get("v") ?? "dev"}`;

load();
render();
