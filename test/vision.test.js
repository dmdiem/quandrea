import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findTooltips, findIcon, findSockets, socketColor, prepareForOcr, textProfile, profileDiff, findGrid, readCells, cellAt, cellBox, findCursor, GRID } from "../src/vision.js";

// A fake screen: dark game background with a tooltip drawn the way MapleStory draws one
// (dark outline, 1px light border, dark navy inside) and an item picture with socket droplets.
function screen(w = 900, h = 700) {
  const data = new Uint8ClampedArray(w * h * 4);
  const img = { width: w, height: h, data };
  fill(img, 0, 0, w, h, [12, 10, 16]);
  return img;
}
function fill(img, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.set([r, g, b, 255], (y * img.width + x) * 4);
}
function tooltip(img, x, y, w, h, sockets = []) {
  fill(img, x - 1, y, 1, h, [38, 44, 51]); // dark outline
  fill(img, x + w, y, 1, h, [38, 44, 51]);
  fill(img, x, y, 1, h, [74, 80, 89]); // light border
  fill(img, x + w - 1, y, 1, h, [74, 80, 89]);
  fill(img, x + 1, y, w - 2, h, [46, 53, 62]); // navy inside
  fill(img, x + w - 2, y, 1, h, [46, 53, 62]);
  fill(img, x + 1, y + 1, 1, h - 2, [46, 53, 62]);
  // item picture: grey square, near-white at the bottom
  const ix = x + 15, iy = y + 120, s = 78;
  fill(img, ix, iy, s, s, [95, 100, 108]);
  fill(img, ix, iy + s - 20, s, 20, [225, 230, 235]);
  // droplets: outline in the socket's colour, purple-ish inside
  const ring = { blue: [60, 110, 220], red: [210, 50, 60], green: [50, 170, 80], purple: [150, 70, 200], grey: [40, 44, 50] };
  sockets.forEach((c, i) => {
    const cx = ix + Math.round(((i + 1) * s) / (sockets.length + 1)) - 6;
    for (let r = 0; r < 12; r++) {
      const half = Math.min(6, 1 + Math.floor(r / 1.5));
      for (let dx = -half; dx <= half; dx++) {
        const edge = Math.abs(dx) === half;
        const col = c === "prismatic" ? (dx < 0 ? [220, 60, 50] : [230, 200, 60]) : ring[c];
        img.data.set(edge ? [...col, 255] : [80, 70, 110, 255], ((iy + 5 + r) * img.width + cx + 6 + dx) * 4);
      }
      // class droplets have a dark outline just inside the coloured one, like in the game
      if (c !== "prismatic" && half > 1) for (const dx of [-half + 1, half - 1]) img.data.set([30, 30, 40, 255], ((iy + 5 + r) * img.width + cx + 6 + dx) * 4);
    }
  });
  return { x, y, w, h };
}

test("finds a tooltip, and two side by side (hovered + equipped)", () => {
  const img = screen();
  tooltip(img, 100, 120, 320, 520);
  tooltip(img, 424, 100, 320, 560);
  const boxes = findTooltips(img);
  assert.equal(boxes.length, 2);
  assert.deepEqual([boxes[0].x, boxes[0].width], [100, 320]);
  assert.deepEqual([boxes[1].x, boxes[1].width], [424, 320]);
  assert.ok(boxes[0].height >= 500 && boxes[1].height >= 540);
});

test("ignores light windows and short lines", () => {
  const img = screen();
  fill(img, 100, 100, 320, 400, [230, 232, 236]); // a light window, like the inventory
  fill(img, 100, 100, 1, 400, [74, 80, 89]);
  fill(img, 419, 100, 1, 400, [74, 80, 89]);
  fill(img, 600, 100, 1, 60, [74, 80, 89]); // too short to be a tooltip side
  assert.deepEqual(findTooltips(img), []);
});

test("finds the item picture and reads its sockets", () => {
  for (const want of [[], ["blue"], ["prismatic", "blue"], ["red", "grey", "green"], ["purple"]]) {
    const img = screen();
    const t = tooltip(img, 100, 100, 320, 560, want);
    const box = { x: t.x, y: t.y, width: t.w, height: t.h };
    const icon = findIcon(img, box);
    assert.deepEqual(icon, { x: 115, y: 220, size: 78 }, want.join());
    assert.deepEqual(findSockets(img, icon), want);
  }
  assert.deepEqual(findSockets(screen(), null), []);
});

test("socket colour from outline pixels", () => {
  assert.equal(socketColor(["dark", "dark", "dark", "blue"]), "grey");
  assert.equal(socketColor(["blue", "blue", "dark"]), "blue");
  assert.equal(socketColor(["red", "yellow", "red", "yellow"]), "prismatic");
  assert.equal(socketColor(["green", "green", "green", "blue"]), "green");
});

test("OCR prep: 3x bigger, bright text turned black on white", () => {
  const img = screen(20, 10);
  fill(img, 5, 5, 2, 2, [240, 240, 240]);
  const out = prepareForOcr(img, { x: 4, y: 4, width: 4, height: 4 });
  assert.deepEqual([out.width, out.height], [12, 12]);
  assert.equal(out.data[(3 * 12 + 3) * 4], 0); // the bright pixel, enlarged
  assert.equal(out.data[0], 255);
});

test("a tooltip stays 'the same' when the game moves behind it, but not when its text changes", () => {
  const img = screen(400, 300);
  const t = tooltip(img, 20, 20, 320, 260);
  const box = { x: t.x, y: t.y, width: t.w, height: t.h };
  for (let i = 0; i < 6; i++) fill(img, 40, 40 + i * 30, 120, 2, [235, 235, 235]); // lines of text
  const a = textProfile(img, box);
  fill(img, 170, 50, 150, 120, [90, 110, 100]); // dim game animation showing through, beside the text
  assert.ok(profileDiff(a, textProfile(img, box)) < 0.04);
  assert.ok(profileDiff(a, textProfile(img, { ...box, y: box.y + 2 })) < 0.04); // box found 2px lower
  fill(img, 40, 230, 160, 2, [235, 235, 235]); // a different item: more text
  assert.ok(profileDiff(a, textProfile(img, box)) > 0.04);
  assert.equal(profileDiff([], []), 0);
});

test("over bright scenery: still finds the tooltip and keeps only its text", () => {
  const img = screen(500, 700);
  fill(img, 0, 0, 500, 700, [240, 235, 220]); // a bright map behind
  const x = 60, y = 60, w = 320, h = 560;
  fill(img, x - 1, y, 1, h, [95, 100, 105]);
  fill(img, x + w, y, 1, h, [95, 100, 105]);
  fill(img, x, y, 1, h, [150, 155, 162]);
  fill(img, x + w - 1, y, 1, h, [150, 155, 162]);
  fill(img, x + 1, y, w - 2, h, [112, 118, 124]); // the see-through navy, lit up from behind
  fill(img, x + 30, y + 300, 150, 3, [250, 250, 250]); // white text
  fill(img, x + 30, y + 320, 150, 3, [178, 178, 182]); // grey text ("Scroll Enhancement")
  const [box] = findTooltips(img);
  assert.deepEqual([box?.x, box?.width], [x, w]);
  const out = prepareForOcr(img, box);
  const at = (px, py) => out.data[(((py - box.y) * 3) * out.width + (px - box.x) * 3) * 4];
  assert.equal(at(x + 50, y + 301), 0); // white text kept
  assert.equal(at(x + 50, y + 321), 0); // grey text kept
  assert.equal(at(x + 50, y + 200), 255); // lit-up background dropped
});

// A fake Equip tab: near-white window, 16 x 8 cells (2px extra gap after every 4 columns).
function inventory(img, x0, y0, kinds) {
  fill(img, x0 - 8, y0 - 8, 16 * 46 + 6 + 12, 8 * 46 + 12, [244, 246, 248]);
  const grid = { x: x0, y: y0 };
  kinds.forEach((k, i) => {
    const b = cellBox(grid, i % 16, Math.floor(i / 16));
    fill(img, b.x, b.y, 42, 42, [214, 218, 224]);
    if (k === "empty") return;
    fill(img, b.x + 10, b.y + 12, 22, 24, [180, 40, 40]); // item art
    fill(img, b.x + 16, b.y + 18, 8, 8, [250, 220, 60]);
    if (k === "lines") fill(img, b.x + 1, b.y + 1, 40, 6, [120, 124, 130]); // the grey bar
  });
  return grid;
}

test("finds the inventory grid and what's in each cell", () => {
  const kinds = Array.from({ length: 128 }, (_, i) => (i % 7 === 0 ? "empty" : i % 3 === 0 ? "item" : "lines"));
  kinds[0] = kinds[16] = "lines";
  for (const [x0, y0] of [[24, 96], [337, 151]]) {
    const img = screen(1100, 600);
    inventory(img, x0, y0, kinds);
    assert.deepEqual(findGrid(img), { x: x0, y: y0 });
    assert.deepEqual(readCells(img, findGrid(img)), kinds);
  }
  assert.equal(findGrid(screen(1100, 600)), null);
});

test("an inventory that isn't fully unlocked: the '+ SLOT' button isn't an item", () => {
  const kinds = Array.from({ length: 128 }, (_, i) => (i % 16 < 8 && i % 5 ? "item" : "empty"));
  const img = screen(1100, 600);
  const grid = inventory(img, 24, 96, kinds);
  const b = cellBox(grid, 8, 0);
  fill(img, b.x, b.y, 42, 42, [40, 170, 220]); // + SLOT
  fill(img, b.x + 18, b.y + 8, 6, 14, [255, 255, 255]);
  assert.deepEqual(readCells(img, findGrid(img)), kinds);
});

test("the small inventory view (4 columns) isn't taken for the full one, but is spotted", () => {
  const img = screen(600, 600);
  fill(img, 30, 80, 4 * 46 + 12, 8 * 46 + 12, [244, 246, 248]);
  const g = { x: 38, y: 88 };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
    const b = cellBox(g, c, r);
    fill(img, b.x, b.y, 42, 42, [214, 218, 224]);
    if ((r + c) % 2) fill(img, b.x + 10, b.y + 12, 22, 24, [180, 40, 40]);
  }
  assert.equal(findGrid(img), null);
  assert.deepEqual(findGrid(img, 4), g);
});

test("cell under a point, with the extra gap after every 4 columns", () => {
  const g = { x: 24, y: 96 };
  assert.deepEqual(cellAt(g, 30, 100), { c: 0, r: 0 });
  assert.deepEqual(cellAt(g, 24 + 4 * 46 + 2 + 5, 96 + 46 + 5), { c: 4, r: 1 });
  assert.deepEqual(cellAt(g, 24 + 15 * 46 + 6 + 40, 96 + 7 * 46 + 40), { c: 15, r: 7 });
  assert.equal(cellAt(g, 30, 96 + 8 * 46 + 5), null);
  assert.equal(cellAt(null, 30, 100), null);
  assert.equal(GRID.cols * GRID.rows, 128);
});

test("the glove cursor at the tooltip's corner, pointing or grabbing", () => {
  const img = screen(800, 700);
  tooltip(img, 300, 150, 320, 500);
  const box = findTooltips(img)[0];
  assert.equal(findCursor(img, box), null);
  fill(img, 298, 190, 8, 9, [255, 255, 255]); // pointing glove on the left border
  assert.deepEqual(findCursor(img, box), { x: 294, y: 192 });
  const img2 = screen(800, 700);
  tooltip(img2, 300, 150, 320, 500);
  fill(img2, 302, 120, 9, 14, [255, 255, 255]); // open hand just above the corner
  assert.deepEqual(findCursor(img2, findTooltips(img2)[0]), { x: 294, y: 122 });
});

// Optional: real screenshots, converted to raw RGBA (8-byte size header). Not in the repo because
// screenshots show character names. Point QUANDREA_SHOTS at a folder of them to run this.
const SHOTS = process.env.QUANDREA_SHOTS;
test("real screenshots: sockets on every icon", { skip: !SHOTS }, () => {
  const expect = JSON.parse(fs.readFileSync(`${SHOTS}/sockets.json`, "utf8"));
  for (const [n, want] of Object.entries(expect)) {
    const b = fs.readFileSync(`${SHOTS}/${n}.rgba`);
    const img = { width: b.readUInt32LE(0), height: b.readUInt32LE(4), data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8) };
    assert.equal(findSockets(img, findIcon(img)).join(" "), want, n);
  }
});

test("a prismatic droplet with only a sliver of gold is still prismatic", () => {
  // From a small game window: purple outline, blue middle, one pixel of gold, no dark outline.
  const outline = Array(14).fill("purple").concat(["blue", "blue", "yellow"]);
  assert.equal(socketColor(outline, { purple: 54, blue: 24, yellow: 1 }), "prismatic");
  // A real purple droplet: dark outline inside, a few blue-ish pixels.
  assert.equal(socketColor(outline, { purple: 116, blue: 10, dark: 21 }), "purple");
  assert.equal(socketColor(Array(16).fill("purple"), { purple: 97, blue: 4, dark: 4 }), "purple");
  // A grey droplet: dark outline, pale blue middle.
  assert.equal(socketColor(Array(16).fill("dark"), { dark: 21, blue: 15 }), "grey");
});

test("a socket touching the item's picture is still read", () => {
  // The glove's art pokes up next to the red droplet (like Supercharged Gloves).
  const img = screen();
  const t = tooltip(img, 100, 100, 320, 560, ["grey", "red"]);
  const ix = t.x + 15, iy = t.y + 120;
  fill(img, ix + 34, iy + 10, 11, 4, [20, 20, 24]);
  const icon = findIcon(img, { x: t.x, y: t.y, width: t.w, height: t.h });
  assert.deepEqual(findSockets(img, icon), ["grey", "red"]);
});

test("sockets are still found when a dark band sits above the item picture", () => {
  // Some screenshots show a few dark rows above the picture frame, pushing everything down.
  const img = screen();
  const t = tooltip(img, 100, 100, 320, 560, ["prismatic", "red", "purple"]);
  const ix = t.x + 15, iy = t.y + 120, s = 78, shift = 5;
  const w = img.width;
  for (let y = iy + s - 1; y >= iy + shift; y--) img.data.copyWithin(((y) * w + ix) * 4, ((y - shift) * w + ix) * 4, ((y - shift) * w + ix + s) * 4);
  fill(img, ix, iy, s, shift, [24, 26, 32]);
  // the frame's light top edge, like the game's
  fill(img, ix, iy + shift, s, 1, [130, 134, 140]);
  const icon = findIcon(img, { x: t.x, y: t.y, width: t.w, height: t.h });
  assert.ok(icon, "found the picture");
  assert.deepEqual(findSockets(img, icon), ["prismatic", "red", "purple"]);
});

test("sockets are still found when the picture box comes out a few pixels too low", () => {
  const img = screen();
  const t = tooltip(img, 100, 100, 320, 560, ["prismatic", "blue"]);
  const ix = t.x + 15, iy = t.y + 120;
  fill(img, ix, iy, 78, 1, [130, 134, 140]); // the frame's light top edge
  const icon = findIcon(img, { x: t.x, y: t.y, width: t.w, height: t.h });
  assert.deepEqual(findSockets(img, icon), ["prismatic", "blue"]);
  assert.deepEqual(findSockets(img, { ...icon, y: icon.y + 6 }), ["prismatic", "blue"]);
});

test("a snip of just the item picture: its sockets are found anywhere in the image", () => {
  // Only the picture (no tooltip around it), in the middle of a small image.
  const img = screen(160, 200);
  fill(img, 0, 0, 160, 200, [46, 53, 62]);
  const t = tooltip(screen(), 100, 100, 320, 560, ["purple", "red", "green"]);
  const src = screen();
  tooltip(src, 100, 100, 320, 560, ["purple", "red", "green"]);
  // copy the 78px picture (at 115,220 in the tooltip) to (40, 60)
  for (let y = 0; y < 78; y++) img.data.set(src.data.subarray(((220 + y) * src.width + 115) * 4, ((220 + y) * src.width + 115 + 78) * 4), ((60 + y) * img.width + 40) * 4);
  assert.equal(findIcon(img), null); // not inside a tooltip's left part
  const icon = findIcon(img, undefined, { anywhere: true });
  assert.deepEqual(icon, { x: 40, y: 60, size: 78 });
  assert.deepEqual(findSockets(img, icon), ["purple", "red", "green"]);
  void t;
});
