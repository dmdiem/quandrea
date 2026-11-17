import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findTooltips, findIcon, findSockets, socketColor, prepareForOcr, textProfile, profileDiff } from "../src/vision.js";

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
