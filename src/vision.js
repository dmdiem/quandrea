// Finding things in a screen capture without reading text: the item tooltips, the item picture
// in each, and the coloured socket droplets above that picture.
//
// Every function takes an image as { width, height, data } (RGBA bytes, like canvas ImageData),
// so the same code runs in the browser and in the Node tests.

const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

// ---- Tooltip boxes ----
// A tooltip has a 1px light grey-blue border with darker pixels on both sides, running straight
// down for hundreds of pixels. Nothing else on the MapleStory screen looks like that, so we look
// for those vertical lines, then pair a left edge with a right edge the right distance apart.

const EDGE_MIN_RUN = 150; // px tall, at least
const BOX_MIN_W = 240;
const BOX_MAX_W = 460;

function isEdge(d, w, x, y) {
  const i = (y * w + x) * 4;
  const c = lum(d, i);
  if (c < 55 || c > 175) return false; // up to 175: over bright scenery the border gets lighter too
  const l1 = lum(d, i - 4);
  const r1 = lum(d, i + 4);
  // A sharp 1px line, or (when the game is shown smaller or bigger and the line is smeared) a softer
  // peak over two pixels.
  if (c - l1 >= 14 && c - r1 >= 12) return true;
  if (x < 2 || x > w - 3 || c < l1 || c < r1) return false;
  return c - l1 >= 7 && c - r1 >= 6 && c - Math.min(l1, lum(d, i - 8)) >= 10 && c - Math.min(r1, lum(d, i + 8)) >= 9;
}

// Vertical runs of edge pixels: [{ x, top, bottom }]. Gaps of a few rows are bridged.
export function findEdges(img, { minRun = EDGE_MIN_RUN, maxGap = 4 } = {}) {
  const { width: w, height: h, data: d } = img;
  const edges = [];
  for (let x = 1; x < w - 1; x++) {
    let top = -1;
    let last = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && isEdge(d, w, x, y);
      if (on) {
        if (top < 0 || y - last > maxGap + 1) {
          if (top >= 0 && last - top + 1 >= minRun) edges.push({ x, top, bottom: last });
          top = y;
        }
        last = y;
      }
    }
    if (top >= 0 && last - top + 1 >= minRun) edges.push({ x, top, bottom: last });
  }
  return edges;
}

// The tooltips on screen, left to right: [{ x, y, width, height }]. scale: how big the game is drawn
// (1 = normal). Uses the 1px border where it shows, and the title block where the border has blurred
// away (a small game window).
export function findTooltips(img, scale = 1) {
  const byBorder = findTooltipsByBorder(img, scale);
  const byTitle = findTooltipsByTitle(img, scale);
  const overlaps = (a, b) => a.x < b.x + b.width - 20 && b.x < a.x + a.width - 20;
  return [...byBorder, ...byTitle.filter((t) => !byBorder.some((b) => overlaps(b, t)))].sort((a, b) => a.x - b.x);
}

function findTooltipsByBorder(img, scale = 1) {
  const edges = findEdges(img, { minRun: Math.round(EDGE_MIN_RUN * scale) });
  const boxes = [];
  let usedTo = -1;
  for (const left of edges.sort((a, b) => a.x - b.x || a.top - b.top)) {
    if (left.x <= usedTo) continue;
    // The nearest right edge that overlaps it vertically and makes a tooltip-sized box.
    const right = edges
      .filter((e) => e.x - left.x >= BOX_MIN_W * scale && e.x - left.x <= BOX_MAX_W * scale)
      .filter((e) => Math.min(e.bottom, left.bottom) - Math.max(e.top, left.top) >= EDGE_MIN_RUN * scale)
      .sort((a, b) => a.x - b.x)[0];
    if (!right) continue;
    const [y, bottom] = verticalExtent(img, left.x, right.x, Math.max(left.top, right.top), Math.min(left.bottom, right.bottom));
    if (!isDarkInside(img, left.x, right.x, y, bottom)) continue;
    boxes.push({ x: left.x, y, width: right.x - left.x + 1, height: bottom - y + 1 });
    usedTo = right.x;
  }
  return boxes.sort((a, b) => a.x - b.x);
}

// Grow a box up and down while either side still has its border (bridging short breaks, where
// something bright behind the see-through tooltip interrupts the line).
// Each side is followed on its own: the top is where the lower of the two stops (so another
// window's border lining up with one side can't stretch the box), the bottom where the lower one stops.
function verticalExtent(img, xl, xr, top, bottom, gap = 14) {
  const { width: w, height: h, data: d } = img;
  const follow = (x0) => {
    const edgeRow = (y) => [x0 - 1, x0, x0 + 1].some((x) => x > 0 && x < w - 1 && isEdge(d, w, x, y));
    let t = top;
    let b = bottom;
    for (let miss = 0, y = top - 1; y >= 0 && miss <= gap; y--) {
      if (edgeRow(y)) { t = y; miss = 0; } else miss++;
    }
    for (let miss = 0, y = bottom + 1; y < h && miss <= gap; y++) {
      if (edgeRow(y)) { b = y; miss = 0; } else miss++;
    }
    return [t, b];
  };
  const [tl, bl] = follow(xl);
  const [tr, br] = follow(xr);
  return [Math.max(tl, tr), Math.max(bl, br)];
}

// Tooltips are dark navy inside (lighter where bright scenery shows through). Rules out light windows (like the inventory) that have lines too.
function isDarkInside(img, x0, x1, y0, y1) {
  const { width: w, data: d } = img;
  const vals = [];
  for (let y = y0; y <= y1; y += 7) for (let x = x0 + 6; x < x1 - 6; x += 9) vals.push(lum(d, (y * w + x) * 4));
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)] < 125; // see-through, so lighter over bright scenery
}

// ---- The item picture ----
// The picture sits in a square frame that fades to near-white at the bottom. Its bottom rows are
// the first long bright runs in the left part of the tooltip, which gives us the square.
export function findIcon(img, box = { x: 0, y: 0, width: img.width, height: img.height }) {
  const { width: w, data: d } = img;
  const minRun = Math.max(40, Math.round(box.width * 0.17));
  const maxRun = Math.round(box.width * 0.34);
  const xEnd = box.x + Math.round(box.width * 0.45);
  const yEnd = Math.min(img.height, box.y + Math.round(box.height * 0.6));
  let found = null;
  // A finished block of bright rows is the frame's bottom if the square above it fits in the box.
  const frame = () => {
    const size = found.right - found.left + 1;
    const y = found.bottom - size + 1;
    return y >= box.y ? { x: found.left, y, size } : null;
  };
  for (let y = box.y; y < yEnd; y++) {
    let start = -1;
    let best = null;
    for (let x = box.x; x <= xEnd; x++) {
      const on = x < xEnd && lum(d, (y * w + x) * 4) > 165;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun && x - start <= maxRun && start > box.x + 1 && (!best || x - start > best.len)) best = { start, len: x - start };
        start = -1;
      }
    }
    if (best) {
      if (!found) found = { left: best.start, right: best.start + best.len - 1, bottom: y };
      else if (Math.abs(best.start - found.left) <= 4 || best.len >= found.right - found.left - 6) {
        found.bottom = y;
        if (best.len > found.right - found.left + 1) Object.assign(found, { left: best.start, right: best.start + best.len - 1 });
      }
    } else if (found && y - found.bottom > 3) {
      const f = frame();
      if (f) return f;
      found = null;
    }
  }
  return found ? frame() : null;
}

// ---- Sockets ----
// 0 to 3 droplets sit along the top of the picture frame. We read only the top half of each
// droplet (the item art never reaches that high), and name it by the colour of its outline.

const hsv = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min) + 6) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h *= 60;
  }
  return { h, s, v };
};

function hueName({ h, s, v }) {
  if (s < 0.22 || v < 0.25) return null;
  if (h < 20 || h >= 335) return "red";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 250) return "blue";
  return "purple";
}

export function findSockets(img, icon) {
  if (!icon) return [];
  const { width: w, data: d } = img;
  const y0 = icon.y + Math.round(icon.size * 0.05);
  const y1 = icon.y + Math.round(icon.size * 0.17);
  const x0 = icon.x + 4;
  const x1 = icon.x + icon.size - 4;
  // The frame's top is a smooth grey. Mark anything clearly coloured or clearly darker.
  const bg = [];
  for (let x = x0; x < x1; x++) bg.push(lum(d, (y0 * w + x) * 4));
  bg.sort((a, b) => a - b);
  const bgL = bg[Math.floor(bg.length / 2)];
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return hueName(hsv(d[i], d[i + 1], d[i + 2])) ?? (lum(d, i) < bgL - 18 ? "dark" : null);
  };
  const colHits = new Map();
  for (let x = x0; x < x1; x++) for (let y = y0; y <= y1; y++) if (at(x, y)) colHits.set(x, (colHits.get(x) ?? 0) + 1);
  // Neighbouring marked columns make one droplet.
  const groups = [];
  for (const x of [...colHits.keys()].sort((a, b) => a - b)) {
    const g = groups.at(-1);
    if (g && x - g.end <= 2) g.end = x;
    else groups.push({ start: x, end: x });
  }
  const minW = Math.max(3, Math.round(icon.size * 0.06));
  const maxW = Math.round(icon.size * 0.24);
  const sockets = [];
  for (const g of groups) {
    if (g.end - g.start + 1 < minW || g.end - g.start + 1 > maxW) continue;
    // The outline: the outermost marked pixel on each side of every row.
    const outline = [];
    for (let y = y0; y <= y1; y++) {
      let l = null;
      let r = null;
      for (let x = g.start; x <= g.end; x++) {
        const c = at(x, y);
        if (c) {
          if (l === null) l = c;
          r = c;
        }
      }
      if (l) outline.push(l, r);
    }
    if (outline.length < 8) continue;
    // Every pixel of the droplet, for the prismatic check in socketColor.
    const all = {};
    for (let y = y0; y <= y1; y++)
      for (let x = g.start; x <= g.end; x++) {
        const c = at(x, y);
        if (c) all[c] = (all[c] ?? 0) + 1;
      }
    sockets.push(socketColor(outline, all));
  }
  return sockets;
}

// A droplet's colour from its outline pixels: its hue, gold (prismatic), or dark (grey).
// `all` (optional) counts every pixel of the droplet: a prismatic one has no dark outline and mixes
// colours (purple and blue, red and gold), while every class droplet has a dark outline. At small
// game sizes the prismatic's gold is only a pixel wide, so this catches it when the gold doesn't.
export function socketColor(px, all) {
  const counts = {};
  for (const p of px) counts[p] = (counts[p] ?? 0) + 1;
  const hues = ["red", "green", "blue", "purple", "yellow"].filter((k) => counts[k]);
  const coloured = hues.reduce((n, k) => n + counts[k], 0);
  if (all) {
    const total = Object.values(all).reduce((a, b) => a + b, 0);
    const big = ["red", "green", "blue", "purple", "yellow"].filter((k) => (all[k] ?? 0) >= total * 0.15);
    if ((all.dark ?? 0) <= total * 0.1 && big.length >= 2) return "prismatic";
  }
  if (coloured < px.length * 0.35) return "grey";
  // No class socket has yellow in it; the prismatic one's top half is red and gold.
  if ((counts.yellow ?? 0) >= coloured * 0.18) return "prismatic";
  return hues.filter((k) => k !== "yellow").sort((a, b) => counts[b] - counts[a])[0];
}

// ---- Text vs background ----
// The tooltip is see-through, so its background is lighter over bright scenery. Each row's cut-off
// sits a margin above that row's own background (the darker quarter of its pixels; text is sparse).
export function rowCuts(img, box, { min = 120, margin = 50 } = {}) {
  const { width: w, data: d } = img;
  const cuts = [];
  const vals = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    vals.length = 0;
    for (let x = box.x + 4; x < box.x + box.width - 4; x += 2) vals.push(lum(d, (y * w + x) * 4));
    vals.sort((a, b) => a - b);
    cuts.push(Math.max(min, (vals[Math.floor(vals.length / 4)] ?? 0) + margin));
  }
  return cuts;
}

// ---- Getting text ready for OCR ----
// Enlarge 3x (nearest neighbour is enough for this crisp game font) and keep only pixels brighter
// than their row's cut-off, as black text on white. Scenery showing through falls under it.
export function prepareForOcr(img, box, { scale = 3 } = {}) {
  const { width: w, data: d } = img;
  const cuts = rowCuts(img, box);
  const ow = box.width * scale;
  const oh = box.height * scale;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = box.y + Math.floor(y / scale);
    for (let x = 0; x < ow; x++) {
      const sx = box.x + Math.floor(x / scale);
      const v = lum(d, (sy * w + sx) * 4) > cuts[sy - box.y] ? 0 : 255;
      const o = (y * ow + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { width: ow, height: oh, data: out };
}

// A tooltip's "shape": how many bright text pixels are on each row. The game showing through the
// see-through tooltip is far too dim to count, so animation behind it doesn't change this; only
// the tooltip's own text does.
export function textProfile(img, box) {
  const { width: w, data: d } = img;
  const cuts = rowCuts(img, box, { min: 150, margin: 60 });
  const rows = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    let n = 0;
    const cut = cuts[y - box.y];
    for (let x = box.x + 4; x < box.x + box.width - 4; x++) if (lum(d, (y * w + x) * 4) > cut) n++;
    rows.push(n);
  }
  return rows;
}

// How different two profiles are, from 0 (same) to 1, allowing the box to shift a few rows.
export function profileDiff(a, b, maxShift = 4) {
  const total = Math.max(1, a.reduce((s, v) => s + v, 0), b.reduce((s, v) => s + v, 0));
  let best = Infinity;
  for (let k = -maxShift; k <= maxShift; k++) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - (b[i + k] ?? 0));
    for (let j = 0; j < b.length; j++) if (j - k < 0 || j - k >= a.length) diff += b[j];
    best = Math.min(best, diff);
  }
  return best / total;
}

// ---- The inventory grid ----
// The Equip tab is 16 x 8 cells of 42px, 46px apart, with 2px more after every 4 columns. Between
// cells the window shows through near-white, so the grid is where bright lines repeat that way.

export const GRID = { cols: 16, rows: 8, cell: 42, pitch: 46 };
const colOffset = (c) => c * GRID.pitch + 2 * Math.floor(c / 4);

// cols: 16 for the full Equip tab, 4 to spot the compact view (which shows only 4 columns).
export function findGrid(img, cols = GRID.cols) {
  const { width: w, height: h, data: d } = img;
  const span = GRID.pitch * GRID.rows;
  if (h < span || w < colOffset(cols)) return null;
  const rowBright = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 2) if (lum(d, (y * w + x) * 4) > 236) rowBright[y]++;
  // The gap lines above, between and below the 8 rows.
  let gy = 0;
  let best = -1;
  for (let y = 0; y + span < h; y++) {
    let s = 0;
    for (let k = 0; k <= GRID.rows; k++) s += rowBright[y + k * GRID.pitch];
    if (s > best) [best, gy] = [s, y];
  }
  const lines = Array.from({ length: GRID.rows + 1 }, (_, k) => rowBright[gy + k * GRID.pitch]);
  const strong = Math.max(...lines);
  // A gap line spans every column (sampled every 2px), so a 4-column view has much shorter lines.
  if (strong < Math.min(150, cols * 12) || lines.filter((v) => v > strong * 0.5).length < 5) return null;
  // Cells start just after the gap.
  let top = gy;
  while (top < gy + 6 && rowBright[top] > strong * 0.5) top++;
  // (If the best line found was a gap's last row, top is already the first cell row.)
  // Columns: the bright line at each cell's left edge, through the middle of every row.
  const colBright = new Array(w).fill(0);
  for (let r = 0; r < GRID.rows; r++) {
    for (let y = top + r * GRID.pitch + 6; y < top + r * GRID.pitch + 36 && y < h; y += 2) {
      for (let x = 0; x < w; x++) if (lum(d, (y * w + x) * 4) > 236) colBright[x]++;
    }
  }
  let x0 = 0;
  best = -1;
  for (let x = 0; x + colOffset(cols - 1) + GRID.cell < w; x++) {
    let s = 0;
    for (let c = 0; c < cols; c++) s += colBright[x + colOffset(c)];
    if (s > best) [best, x0] = [s, x];
  }
  // The gap is a few px wide: cells start right after its last bright column.
  const score = (x) => { let t = 0; for (let c = 0; c < cols; c++) t += colBright[x + colOffset(c)] ?? 0; return t; };
  while (x0 + 1 < w && score(x0 + 1) >= best * 0.85) x0++;
  const colHits = Array.from({ length: cols }, (_, c) => colBright[x0 + colOffset(c)]);
  if (colHits.filter((v) => v > 40).length < Math.min(8, cols)) return null;
  const grid = { x: x0 + 1, y: top };
  return looksLikeInventory(img, grid, cols) ? grid : null;
}

// The real Equip tab has near-white gaps (about 238 bright) left of and above every cell. Something
// else on screen that happens to line up won't have that nearly everywhere.
function looksLikeInventory(img, grid, cols) {
  const { width: w, height: h, data: d } = img;
  let ok = 0;
  let seen = 0;
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = cellBox(grid, c, r);
      if (b.x < 2 || b.y < 2 || b.x + b.width >= w || b.y + b.height >= h) continue;
      seen++;
      const gapL = [];
      const gapT = [];
      for (let k = 8; k < 34; k += 3) {
        gapL.push(lum(d, ((b.y + k) * w + b.x - 1) * 4));
        gapT.push(lum(d, ((b.y - 1) * w + b.x + k) * 4));
      }
      const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
      if (med(gapL) > 225 && med(gapT) > 225) ok++;
    }
  }
  return seen >= cols * 4 && ok >= seen * 0.7;
}

// Where cell (c, r) is on screen.
export const cellBox = (grid, c, r) => ({ x: grid.x + colOffset(c), y: grid.y + r * GRID.pitch, width: GRID.cell, height: GRID.cell });

// Which cell a screen point falls in, or null.
export function cellAt(grid, px, py) {
  if (!grid) return null;
  const r = Math.floor((py - grid.y) / GRID.pitch);
  if (r < 0 || r >= GRID.rows) return null;
  for (let c = 0; c < GRID.cols; c++) {
    const b = cellBox(grid, c, r);
    if (px >= b.x - 2 && px < b.x + GRID.pitch) return { c, r };
  }
  return null;
}

// Each cell: "empty", "item", or "lines" (an item with the grey bar on top, which has hologram lines).
export function readCells(img, grid) {
  const { width: w, data: d } = img;
  const out = [];
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const b = cellBox(grid, c, r);
      // The grey bar: a flat grey band a few rows down from the top.
      let bar = 0;
      let n = 0;
      for (let y = b.y + 2; y <= b.y + 5; y++) {
        for (let x = b.x + 6; x < b.x + b.width - 6; x++) {
          const i = (y * w + x) * 4;
          const c2 = hsv(d[i], d[i + 1], d[i + 2]);
          n++;
          if (lum(d, i) < 165 && lum(d, i) > 60 && c2.s < 0.18) bar++;
        }
      }
      // Empty cells are one flat colour; items have art in the middle.
      const vals = [];
      for (let y = b.y + 12; y < b.y + 36; y += 2) for (let x = b.x + 8; x < b.x + 34; x += 2) vals.push(lum(d, (y * w + x) * 4));
      const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
      const spread = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
      // The "+ SLOT" button (inventories not fully unlocked) is a solid bright-blue square: not an item.
      let blue = 0;
      let m = 0;
      for (let y = b.y + 6; y < b.y + 36; y += 3) {
        for (let x = b.x + 6; x < b.x + 36; x += 3) {
          const i = (y * w + x) * 4;
          const c3 = hsv(d[i], d[i + 1], d[i + 2]);
          m++;
          if (c3.s > 0.45 && c3.v > 0.55 && c3.h >= 175 && c3.h <= 215) blue++;
        }
      }
      out.push(spread < 6 || blue / m > 0.5 ? "empty" : bar / n > 0.6 ? "lines" : "item");
    }
  }
  return out;
}

// The game's glove cursor, at the tooltip's top-left: on the left border while it points, or just
// above the corner while it's an open grabbing hand (it animates). Returns the point it's on, or null.
export function findCursor(img, box) {
  const { width: w, height: h, data: d } = img;
  const x0 = Math.max(0, box.x - 2);
  const x1 = Math.min(w, box.x + 12); // tooltip text starts ~14px in, so this stays clear of it
  const y0 = Math.max(0, box.y - 80);
  const y1 = Math.min(h, box.y + box.height);
  for (let y = y0; y < y1; y++) {
    let white = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (Math.min(d[i], d[i + 1], d[i + 2]) >= 245) white++;
    }
    // The glove is a few pure-white pixels wide on several rows in a row.
    if (white >= 3) {
      let rows = 0;
      for (let yy = y; yy < Math.min(y1, y + 8); yy++) {
        let n = 0;
        for (let x = x0; x < x1; x++) {
          const i = (yy * w + x) * 4;
          if (Math.min(d[i], d[i + 1], d[i + 2]) >= 245) n++;
        }
        if (n >= 2) rows++;
      }
      if (rows >= 5) return { x: box.x - 6, y: y + 2 };
    }
  }
  return null;
}

// ---- Other screen sizes ----
// Everything above is tuned for the game drawn at its normal size (inventory cells 46px apart). If
// the game window is shown smaller or bigger (a smaller game window, Windows display scaling), we
// find that scale once and resize each frame back to normal before reading it.

// Resize an image by a factor (bilinear). f < 1 makes it smaller.
export function resizeImage(img, f) {
  const { width: w, height: h, data: d } = img;
  const ow = Math.max(1, Math.round(w * f));
  const oh = Math.max(1, Math.round(h * f));
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, (y + 0.5) / f - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, (x + 0.5) / f - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const o = (y * ow + x) * 4;
      for (let k = 0; k < 4; k++) {
        const a = d[(y0 * w + x0) * 4 + k] * (1 - fx) + d[(y0 * w + x1) * 4 + k] * fx;
        const b = d[(y1 * w + x0) * 4 + k] * (1 - fx) + d[(y1 * w + x1) * 4 + k] * fx;
        out[o + k] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { width: ow, height: oh, data: out };
}

// The scale the game is drawn at (1 = normal), found from the inventory grid, or null if no
// inventory is visible. Tries sizes near 1 first.
export function findScale(img) {
  if (findGrid(img)) return 1;
  const tries = [];
  for (let s = 0.6; s <= 2.001; s += 0.01) tries.push(Math.round(s * 100) / 100);
  tries.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
  for (const s of tries) {
    if (s === 1) continue;
    if (findGrid(resizeImage(img, 1 / s))) return s;
  }
  return null;
}

// ---- Finding tooltips by their title block ----
// Every item tooltip has three centred lines of orange text near the top ("Heroic: Untradable",
// "Interactive: Untradable", "Duration: ..."). When the game is shown small, the 1px border can blur
// away, but this stack of evenly spaced orange lines is still easy to find, and it gives the
// tooltip's centre exactly.
const TIP_W = 321; // tooltip width at normal size
const TIP_H = 640; // at most this tall at normal size

function isOrange(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (r < 120 || r - b < 40 || g - b < 8 || r - g < 12) return false;
  const { h, s } = hsv(r, g, b);
  return h >= 16 && h <= 44 && s >= 0.25;
}

// The item's name sits just above the orange lines: a line of bright white text on a dark background.
function hasTitleAbove(img, cx, y, scale) {
  const { width: w, data: d } = img;
  let bright = 0;
  let dark = 0;
  for (let yy = Math.round(y - 24 * scale); yy < Math.round(y - 4 * scale); yy++) {
    if (yy < 0) continue;
    for (let x = Math.round(cx - 110 * scale); x < Math.round(cx + 110 * scale); x++) {
      if (x < 0 || x >= w) continue;
      const v = lum(d, (yy * w + x) * 4);
      if (v > 195) bright++;
      else if (v < 110) dark++;
    }
  }
  return bright >= 60 * scale * scale && dark > bright * 2;
}

export function findTooltipsByTitle(img, scale = 1) {
  const { width: w, height: h, data: d } = img;
  // Orange runs on each row: [x0, x1, count].
  const segs = [];
  for (let y = 0; y < h; y++) {
    let start = -1, last = -1, n = 0;
    const row = [];
    for (let x = 0; x <= w; x++) {
      const on = x < w && isOrange(d, (y * w + x) * 4);
      if (on) {
        if (start < 0 || x - last > 14 * scale) {
          if (start >= 0) row.push([start, last, n]);
          start = x;
          n = 0;
        }
        last = x;
        n++;
      }
    }
    if (start >= 0) row.push([start, last, n]);
    segs.push(row.filter(([a, b, n2]) => n2 >= 5 * scale && b - a >= 45 * scale && b - a <= 280 * scale));
  }
  const centre = ([a, b]) => (a + b) / 2;
  const boxes = [];
  for (let y = 0; y < h; y++) {
    for (const s0 of segs[y]) {
      const c0 = centre(s0);
      // Two more lines below, evenly spaced (about 16px apart at normal size), on the same centre.
      for (let gap = Math.floor(12 * scale); gap <= Math.ceil(21 * scale); gap++) {
        const find = (yy) => {
          for (let dy = -1; dy <= 1; dy++) {
            const r = segs[yy + dy];
            const m = r && r.find((s) => Math.abs(centre(s) - c0) <= 16 * scale);
            if (m) return m;
          }
          return null;
        };
        if (y + 2 * gap + 1 >= h || !find(y + gap) || !find(y + 2 * gap)) continue;
        const width = Math.round(TIP_W * scale);
        const x = Math.max(0, Math.round(c0 - width / 2));
        if (boxes.some((bx) => Math.abs(bx.x - x) < width / 2 && Math.abs(bx.title - y) < 40 * scale)) break;
        if (!hasTitleAbove(img, c0, y, scale) || !isDarkInside(img, x, Math.min(w - 1, x + width - 1), Math.round(y + 3 * gap), Math.min(h - 1, Math.round(y + 3 * gap + 160 * scale)))) break;
        const top = Math.max(0, Math.round(y - 62 * scale));
        const box = { x, y: top, width: Math.min(width, w - x), height: Math.min(Math.round(TIP_H * scale), h - top), title: y };
        // A real item tooltip has the item's picture frame just below the title block, on the left.
        const icon = findIcon(img, box);
        if (!icon || icon.y < y || icon.y > y + 90 * scale || icon.x > x + width * 0.35) break;
        boxes.push(box);
        break;
      }
    }
  }
  return boxes.map(({ title, ...b }) => b);
}
