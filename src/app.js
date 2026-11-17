// The page: screen capture, the scan loop, and drawing everything.

import { parseTooltip, SLOTS, TARGETS, OTHER } from "./parse.js";
import { verdicts, TOTAL, JOBS, BRANCHES, classOption, socketValue, PRISMATIC_GOAL } from "./solver.js";
import { findTooltips, findIcon, findSockets, prepareForOcr, textProfile, profileDiff } from "./vision.js";

const KEY = "quandrea.v1";
const $ = (id) => document.getElementById(id);
const NAME = Object.fromEntries([...TARGETS.map((t) => [t.k, t.name]), [OTHER, "Other"]]);
const SOCKETS = ["prismatic", "blue", "red", "green", "purple", "grey"];
const VERDICT = { keep: "Keep", backup: "Backup", donor: "Socket donor", trash: "Trash" };

let state = { items: [], classId: "Lethe", mode: "endgame" };
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
  if (!now.length) return;
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
  const before = state.items.length;
  const item = remember({ ...parsed, sockets });
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

  $("class").innerHTML = BRANCHES.map((b) => `<optgroup label="${b}">${JOBS.filter((j) => j.branch === b).map((j) => `<option ${j.id === option.id ? "selected" : ""}>${j.id}</option>`).join("")}</optgroup>`).join("");
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

  // Stage 1: lines. A board of the 18 lines (filled = which piece gives it), then the set itself.
  const early = state.mode === "early";
  const head = early ? res.lines : res.score;
  const from = Object.fromEntries(TARGETS.map((t) => [t.k, []])); // line -> slots that supply it
  for (const s of SLOTS) res.picks[s]?.lines.forEach((k, j) => res.counted[s][j] && from[k].push(s));
  const cell = (k, slot) => `<div class="cell ${slot ? "on" : ""}"><span class="cell-slot">${slot ?? "missing"}</span></div>`;
  const anyWasted = SLOTS.some((s) => res.counted[s].includes(false));
  $("lines").innerHTML = `
    <div class="row spread"><h2>Stage 1 · ${early ? "18 lines" : "18/18 hologram lines"}</h2><span class="label">best set</span></div>
    <div class="score"><span class="big">${head}</span><span class="muted">of ${TOTAL} ${early ? "lines" : "target lines"}${early ? ` · ${res.score} on the list` : ""}</span></div>
    ${["main", "single"].map((g) => `<div class="board ${g}">${TARGETS.filter((t) => (t.need > 1) === (g === "main")).map((t) => `<div class="board-row"><span class="board-name">${t.name}</span>
      <div class="cells">${Array.from({ length: t.need }, (_, j) => cell(t.k, from[t.k][j])).join("")}</div></div>`).join("")}</div>`).join("")}
    <div class="set"><span class="label">Your set</span>
      <table class="gear"><tbody>${SLOTS.map((s) => {
        const it = res.picks[s];
        const wearing = state.items.find((x) => x.slot === s && x.equipped);
        const action = !it ? "" : it.equipped ? `<span class="act on">Wearing ✓</span>` : `<span class="act swap" title="${wearing ? "Equip this instead of what you have on" : "The scanner hasn't seen what you wear here"}">${wearing ? "Swap" : "Equip"}</span>`;
        const cells = it ? [0, 1, 2].map((j) => `<td>${it.lines[j] ? chip(it.lines[j], !res.counted[s][j]) : `<span class="none">no line</span>`}</td>`).join("") : `<td colspan="3"><span class="none">nothing scanned yet</span></td>`;
        return `<tr><th>${s}</th>${cells}<td class="act-cell">${action}</td></tr>`;
      }).join("")}</tbody></table>
      ${anyWasted ? `<span class="muted small">Crossed out: another piece already covers that line, so it doesn't count.</span>` : ""}
    </div>`;

  // Stage 2: sockets.
  $("sockets").innerHTML = `
    <div class="row spread"><h2>Stage 2 · Sockets</h2><span class="label">${option.id} (${option.stat}): ${option.colours.join(", ")}</span></div>
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
        ${list.length ? list.map((it) => `<div class="inv-item">${badge(v[it.id])}<span class="lines">${linesOf(it)}${!option.classes.includes(it.cls) ? `<span class="tag">${it.cls ?? "?"}</span>` : ""}${it.equipped ? '<span class="tag">wearing now</span>' : ""}</span>${socks(it.sockets)}<button class="x" data-del="${it.id}" aria-label="Remove">×</button></div>`).join("") : `<div class="none">Nothing scanned yet</div>`}
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
  state.classId = e.target.value;
  save();
  render();
});

load();
render();
