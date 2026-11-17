// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, OTHER } from "./parse.js?v=12";
import { verdicts, solve, onePieceAway, TOTAL, CLASSES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js?v=12";
import { findTooltips, findIcon, findSockets, prepareForOcr, textProfile, profileDiff, findGrid, readCells, findCursor, cellAt, GRID } from "./vision.js?v=12";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const SHORT = { leap: "Leap", wh: "WH", reg: "Reg", atk: "ATT", crit: "Crit", warrior: "War", mage: "Mage", archer: "Bow", thief: "Thief", pirate: "Pir" };
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), [OTHER, "Other"]]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];
const VERDICT = { keep: "Keep", backup: "Backup", donor: "Socket donor", trash: "Trash" };

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
    } else if (findGrid(img, 4)) {
      setStatus("Your inventory is in the small view (4 columns). Expand it with the + at its top right so all 16 columns show.", true);
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
  if (!parsed.equipped) last = { id: item.id };
  const what = `${parsed.equipped ? "your equipped " : ""}${item.slot.toLowerCase()}`;
  if (!item.sockets.length) setStatus(`Read ${what}, but couldn't see its sockets. Every piece has at least one: hover it again with nothing bright behind the item picture.`, true);
  else setStatus(known ? `Already have this ${what} ✓  Hover the next one.` : `Read ${what} ✓  Hover the next one.`, true);
  render();
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
// The Libae's Supercharged item picture for each slot.
const slotIcon = (slot) => `<img class="slot-icon" src="icons/slots/${slot.toLowerCase()}.png" alt="">`;
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

  // The hologram lines panel: the best combo you could make, or (switch) what you have equipped now.
  const early = state.mode === "early";
  const showNow = state.view === "equipped" && seenAny;
  const shown = showNow ? nowRes : res;
  const head = early ? shown.lines : shown.score;
  const from = Object.fromEntries(TARGETS.map((t) => [t.k, []])); // line -> slots that supply it
  for (const s of SLOTS) shown.picks[s]?.lines.forEach((k, j) => shown.counted[s][j] && from[k].push(s));
  const cell = (k, slot) => `<div class="cell k-${k} ${slot ? "on" : ""}">${slot ? slotIcon(slot) : ""}<span class="cell-slot">${slot ?? "missing"}</span></div>`;
  // "One more piece finishes it": what a single drop in each slot would need (right-lines mode only).
  const mine = state.items.filter((it) => option.classes.includes(it.cls));
  const hunt = !early && res.score < TOTAL && mine.length ? onePieceAway(mine) : [];
  const huntBox = early || res.score >= TOTAL || !mine.length ? ""
    : `<div class="hunt"><span class="label">One more piece finishes it</span>${hunt.length
      ? hunt.slice(0, 6).map((o) => `<div class="hunt-row">${slotIcon(o.slot)}<b>${o.slot}</b> with ${o.need.map((k) => chip(k)).join(" + ")}${o.need.length < 3 ? `<span class="muted small">(+ any ${o.need.length === 2 ? "3rd line" : "2 more lines"})</span>` : ""}</div>`).join("")
        + (hunt.length > 6 ? `<span class="muted small">and ${hunt.length - 6} more options</span>` : "")
      : `<span class="muted small">More than one piece away: keep scanning and farming 3-line pieces.</span>`}</div>`;
  // What the collapsed piece list says, so a swap is never hidden.
  const swaps = SLOTS.filter((s) => res.picks[s] && !res.picks[s].equipped);
  const swapNote = !seenAny ? "Show pieces" : swaps.length ? `Show pieces · ${swaps.length} to swap: ${swaps.join(", ")}` : "Show pieces · all of them are equipped";
  const viewSwitch = seenAny ? `<div class="seg small-seg" role="group" aria-label="Show">
      <button data-view="best" aria-pressed="${!showNow}">Best combo</button><button data-view="equipped" aria-pressed="${showNow}">Equipped now</button></div>` : "";
  $("lines").innerHTML = `
    <div class="row spread"><h2>${early ? "Hologram lines (any 3 per piece)" : "Hologram lines (18/18)"}</h2>${viewSwitch}</div>
    <p class="muted small explain">${showNow
      ? "What you have equipped right now, line by line. Switch to Best combo to see the best outfit you could make from everything scanned."
      : "The best outfit you can make from everything scanned (equipped or in your bag): one piece per slot, covering as many of the 18 lines as possible. It improves as you scan more."}</p>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} lines ${showNow ? "equipped now" : "with the best combo"}${early ? ` · ${shown.score} on the list` : ""}</span>
      ${seenAny ? `<span class="compare">· ${showNow ? `best combo: <b>${early ? res.lines : res.score}/${TOTAL}</b>` : `<b>${nowScore}/${TOTAL}</b> equipped now`}</span>` : ""}</div>
    ${seenAny ? "" : `<p class="muted small">Hover any item and the scanner also reads the "Currently Equipped" box beside it. Do one per slot to see what you have on now.</p>`}
    <div class="board">${TARGETS.map((t) => `<div class="board-row"><span class="board-name">${icon(t.k)}${t.name}</span>
      <div class="cells">${Array.from({ length: 3 }, (_, j) => (j < t.need ? cell(t.k, from[t.k][j]) : `<div class="cell-gap"></div>`)).join("")}</div></div>`).join("")}</div>
    ${huntBox}
    <details class="set pieces" id="pieces"${piecesOpen ? " open" : ""}>
      <summary><span class="label">Lines per piece</span>
        <span class="muted small">${swapNote}</span></summary>
      <p class="muted small">Each row is one ${showNow ? "equipped piece" : "piece of the best combo"}. <b>●</b> = it gives that line · <b>+</b> = an extra copy (still +1 to the skill, up to Lv. 8, but a missing line would do more) · <b>Other</b> = lines not on the list.</p>
      <div class="pgrid-wrap"><table class="pgrid">
        <thead><tr><th></th>${TARGETS.map((t) => `<th title="${t.name}">${icon(t.k)}<span class="ph">${SHORT[t.k]}</span></th>`).join("")}<th class="ph" title="Lines not on the list">Other</th><th></th></tr></thead>
        <tbody>${SLOTS.map((s) => {
          const it = shown.picks[s];
          const best = res.picks[s];
          const wearing = state.items.find((x) => x.slot === s && x.equipped);
          const action = showNow
            ? !it ? "" : best && best !== it ? `<span class="act swap" title="A better piece for this slot is in your bag">Better in bag</span>` : `<span class="act on">Best ✓</span>`
            : !it ? "" : it.equipped ? `<span class="act on">Equipped ✓</span>` : `<span class="act swap" title="${wearing ? "Equip this instead of what you have on" : "The scanner hasn't seen what you have equipped here"}">${wearing ? "Swap" : "Equip"}</span>`;
          if (!it) return `<tr><th>${slotIcon(s)}${s}</th><td colspan="${TARGETS.length + 1}" class="none">${showNow ? "not seen yet" : "nothing scanned yet"}</td><td></td></tr>`;
          const marks = (piece, counted) => TARGETS.map((t) => {
            const idx = piece.lines.map((k, j) => [k, j]).filter(([k]) => k === t.k);
            if (!idx.length) return `<td></td>`;
            const counts = idx.some(([, j]) => counted[j]);
            return `<td><span class="mark k-${t.k} ${counts ? "on" : "extra"}" title="${counts ? t.name : `Extra ${t.name}: still +1 to the skill`}">${counts ? "●" : "+"}</span></td>`;
          }).join("") + `<td class="other">${piece.lines.filter((k) => k === OTHER).length || ""}</td>`;
          // On a swap, the piece you have on now, in words, right under the one to swap in.
          const nowRow = !showNow && wearing && !it.equipped ? `<tr class="now-row"><td colspan="${TARGETS.length + 3}"><span class="wearing-now">↳ Equipped:</span> ${linesOf(wearing)}</td></tr>` : "";
          return `<tr><th>${slotIcon(s)}${s}</th>${marks(it, shown.counted[s])}<td class="act-cell">${action}</td></tr>${nowRow}`;
        }).join("")}</tbody>
        <tfoot><tr><th>${showNow ? "Equipped" : "Best combo"}</th>${TARGETS.map((t, i) => `<td class="k-${t.k} ${shown.counts[i] >= t.need ? "done" : "short"}">${shown.counts[i]}/${t.need}</td>`).join("")}<td></td><td></td></tr>
          ${seenAny ? `<tr class="now-row"><th>${showNow ? "Best combo" : "Equipped"}</th>${TARGETS.map((t, i) => `<td>${(showNow ? res : nowRes).counts[i]}/${t.need}</td>`).join("")}<td></td><td></td></tr>` : ""}</tfoot>
      </table></div>
    </details>`;

  // The jewel sockets panel.
  $("sockets").innerHTML = `
    <div class="row spread"><h2>Jewel sockets</h2><span class="label">${option.cls} (${option.stat}): ${option.colours.join(", ")}</span></div>
    <div class="score"><span class="big">${sockets.good}</span><span class="muted">of 18 good sockets · ${sockets.prismatic}/${PRISMATIC_GOAL} prismatic pieces</span></div>
    <p class="muted">Aim for 4 pieces with prismatic + stat + stat and 2 with stat + stat + stat. Orbs move your 18 lines onto these.</p>
    <div class="set"><span class="label">Socket pieces</span>${SLOTS.map((s) => {
      const it = sockets.picks[s];
      const val = it && socketValue(it, state.classId);
      return `<div class="item"><span class="slotname">${slotIcon(s)}${s}</span>${it && val.good ? `<span class="row">${socks(it.sockets)}<span class="tag">${val.good}/3 good</span></span>` : `<span class="none">none yet</span>`}</div>`;
    }).join("")}</div>`;

  // Everything scanned, by slot.
  const totals = { keep: 0, backup: 0, donor: 0, trash: 0 };
  for (const it of state.items) totals[v[it.id].verdict]++;
  $("items").innerHTML = `
    <div class="row spread"><h2>Your gear <span class="muted">(${state.items.length})</span></h2>
      <div class="row">${Object.entries(totals).map(([k, n]) => `<span class="badge v-${k}">${VERDICT[k]} ${n}</span>`).join("")}
      ${state.items.length ? `<button id="clear" class="ghost ${confirmClear ? "danger" : ""}">${confirmClear ? "Click again to clear all" : "Clear all"}</button>` : ""}</div></div>
    ${addForm()}
    <div class="slots">${SLOTS.map((s) => {
      const list = state.items.filter((it) => it.slot === s);
      // Something you're wearing isn't "trash": a better piece should replace it.
      const row = (it) => `<div class="inv-item"${it.equipped ? "" : ` draggable="true" data-drag="${it.id}" title="Drag onto Equipped once you've equipped it in game"`}>${it.equipped && v[it.id].verdict === "trash" ? `<span class="badge v-trash" title="A better piece for this slot is in your inventory">Replace</span>` : badge(v[it.id])}<span class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}</span>${socks(it.sockets)}${it.equipped ? "" : `<button class="equip-btn" data-equip="${it.id}" title="You equipped this in game: mark it equipped">Equip</button>`}<button class="x" data-del="${it.id}" aria-label="Remove">×</button></div>`;
      const on = list.filter((it) => it.equipped);
      const bag = list.filter((it) => !it.equipped);
      return `<div class="slot" data-drop-slot="${s}"><div class="slot-head"><h3>${slotIcon(s)}${s}</h3><span class="tag">${list.length}</span></div>
        <div class="eq-box"><div class="sub eq">Equipped</div>${on.length ? on.map(row).join("") : `<div class="none">not seen yet: hover any ${s.toLowerCase()}</div>`}</div>
        <div class="bag"><div class="sub">In inventory <span class="tag">${bag.length}</span></div>${bag.length ? bag.map(row).join("") : `<div class="none">nothing scanned yet</div>`}</div>
      </div>`;
    }).join("")}</div>
`;
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
  if (e.target.closest?.("[data-drop-slot]")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const card = e.target.closest?.("[data-drop-slot]");
  const id = e.dataTransfer?.getData("text/plain");
  const it = state.items.find((x) => x.id === id);
  if (!card || !it) return;
  e.preventDefault();
  if (it.slot !== card.dataset.dropSlot) {
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
  if (t.id === "stop") return stopShare();
  if (t.dataset.themePick) return setTheme(t.dataset.themePick);
  if (t.id === "reset-map") {
    state.cells = [];
    grid = null;
    selected = null;
    save();
    render();
    setStatus(stream ? "Map cleared. Move the mouse off your inventory and it reads it again." : "Map cleared. Share your game window, or paste a screenshot of your inventory (Ctrl+V).", Boolean(stream));
    return;
  }
  if (t.dataset.equip) equipItem(t.dataset.equip);
  else if (t.dataset.view) state.view = t.dataset.view;
  else if (t.dataset.cell) selected = selected === t.dataset.cell ? null : t.dataset.cell;
  else if (t.dataset.mode) state.mode = t.dataset.mode;
  else if (t.dataset.stat) state.classId = `Pirate (${t.dataset.stat})`;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
      state.cells = [];
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
    save();
    render();
    setStatus("Map filled in from your screenshot ✓", Boolean(stream));
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
