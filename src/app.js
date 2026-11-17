// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, OTHER } from "./parse.js";
import { verdicts, missing, TOTAL, CLASS_OPTIONS, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js";
import { findTooltips, findIcon, findSockets, prepareForOcr, regionHash } from "./vision.js";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), [OTHER, "Other"]]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];
const VERDICT = { keep: "Keep", backup: "Backup", donor: "Socket donor", trash: "Trash" };

let state = { items: [], classId: "Magician", mode: "endgame" };
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
const seen = new Map(); // tooltip hash -> time it was read (so a tooltip left open isn't re-read)
let pending = new Map(); // hash -> frames it has stayed the same

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
  const boxes = findTooltips(img);
  if (!boxes.length) {
    pending = new Map();
    return;
  }
  // Read a tooltip once it has held still for two frames (it fades in, and the mouse moves).
  const next = new Map();
  const ready = [];
  for (const box of boxes) {
    const h = regionHash(img, box);
    const n = (pending.get(h) ?? 0) + 1;
    next.set(h, n);
    if (n >= 2 && !(Date.now() - (seen.get(h) ?? 0) < 30000)) ready.push({ box, h });
  }
  pending = next;
  if (!ready.length) return;
  busy = true;
  try {
    for (const { box, h } of ready) {
      seen.set(h, Date.now());
      await readTooltip(img, box);
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
  const item = remember({ ...parsed, sockets });
  if (!parsed.equipped) last = { id: item.id, crop: cropCanvas(img, area) };
  setStatus(`Read ${parsed.equipped ? "your equipped " : ""}${item.slot.toLowerCase()} ✓  Hover the next one.`, true);
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
  let item = state.items.find((it) => it.key === key);
  if (item) item.equipped = p.equipped || item.equipped;
  else {
    item = { id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), key, slot: p.slot, cls: p.cls, lines: p.lines, sockets: p.sockets, equipped: p.equipped };
    state.items.push(item);
  }
  save();
  return item;
}

// ---------- drawing ----------

const chip = (k, wasted = false) => `<span class="chip k-${k}${wasted ? " wasted" : ""}">${NAME[k]}</span>`;
const socks = (list) => `<span class="socks">${(list ?? []).map((c) => `<span class="sock ${c}" title="${c}"></span>`).join("")}</span>`;
const badge = (v) => `<span class="badge v-${v.verdict}" title="${v.why}">${VERDICT[v.verdict]}</span>`;
const linesOf = (it) => (it.lines.length ? it.lines.map((k) => chip(k)).join("") : `<span class="muted">no lines</span>`);

function render() {
  const { res, sockets, verdicts: v } = verdicts(state.items, state);
  const option = classOption(state.classId);

  $("class").innerHTML = CLASS_OPTIONS.map((o) => `<option ${o.id === state.classId ? "selected" : ""}>${o.id}</option>`).join("");
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

  // Stage 1: lines.
  const early = state.mode === "early";
  const head = early ? res.lines : res.score;
  const miss = missing(res);
  $("lines").innerHTML = `
    <div class="row spread"><h2>Stage 1 · ${early ? "18 lines" : "18/18 hologram lines"}</h2><span class="label">best set</span></div>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} ${early ? "lines" : "target lines"}${early ? ` · ${res.score} on the list` : ""}</span></div>
    <div class="reqs">${TARGETS.map((t, i) => `<div class="req k-${t.k} ${res.counts[i] < t.need ? "miss" : ""}"><span class="name">${t.name}</span>
      <span class="pips">${Array.from({ length: t.need }, (_, j) => `<span class="pip ${j < res.counts[i] ? "on" : ""}"></span>`).join("")}</span></div>`).join("")}</div>
    <div class="set"><span class="label">Wear these</span>${SLOTS.map((s) => {
      const it = res.picks[s];
      return `<div class="item"><span class="slotname">${s}</span>${it ? `<span class="lines">${it.lines.map((k, j) => chip(k, !res.counted[s][j])).join("")}${it.equipped ? '<span class="tag">wearing</span>' : ""}</span>` : `<span class="none">nothing scanned yet</span>`}</div>`;
    }).join("")}</div>
    ${miss.length && !early ? `<div><span class="label">Still missing</span><div class="lines">${miss.map((k) => chip(k)).join("")}</div></div>` : ""}`;

  // Stage 2: sockets.
  $("sockets").innerHTML = `
    <div class="row spread"><h2>Stage 2 · Sockets</h2><span class="label">${option.id}: ${option.colours.join(", ")}</span></div>
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
      return `<div class="slot"><div class="slot-head"><h3>${s}</h3><span class="tag">${list.length}</span></div>
        ${list.length ? list.map((it) => `<div class="inv-item">${badge(v[it.id])}<span class="lines">${linesOf(it)}${it.cls !== option.cls ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}${it.equipped ? '<span class="tag">wearing</span>' : ""}</span>${socks(it.sockets)}<button class="x" data-del="${it.id}" aria-label="Remove">×</button></div>`).join("") : `<div class="none">Nothing scanned yet</div>`}
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
  if (t.dataset.mode) state.mode = t.dataset.mode;
  else if (t.dataset.del) state.items = state.items.filter((it) => it.id !== t.dataset.del);
  else if (t.id === "clear") {
    if (confirmClear) {
      state.items = [];
      last = null;
      seen.clear();
    }
    confirmClear = !confirmClear;
  } else if (t.id === "add") {
    const lines = [0, 1, 2].map((i) => $(`add-line-${i}`).value).filter(Boolean);
    const sockets = [0, 1, 2].map((i) => $(`add-sock-${i}`).value).filter(Boolean);
    remember({ slot: $("add-slot").value, cls: classOption(state.classId).cls, lines, sockets, equipped: false, stats: `hand-${Date.now()}` });
  } else return;
  save();
  render();
});

$("class").addEventListener("change", (e) => {
  state.classId = e.target.value;
  save();
  render();
});

load();
render();
