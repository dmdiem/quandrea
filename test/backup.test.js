import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCode, importCode, looksLikeBackup, sanitize, MAX_CODE } from "../src/backup.js";

const code = (obj) => "QUANDREA1:" + Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

const state = {
  classId: "Pirate (DEX)",
  mode: "early",
  cells: ["lines", "item", "empty"],
  mapPinned: true,
  items: [
    { id: "a1", key: "Hat|Magician|leap,wh|12+34", slot: "Hat", cls: "Magician", lines: ["leap", "wh"], sockets: ["prismatic", "blue"], equipped: true, cell: null },
    { id: "b2", key: "Top|Magician|atk|56", slot: "Top", cls: "Magician", lines: ["atk"], sockets: ["grey"], equipped: false, cell: "3,1" },
  ],
};

test("a backup round-trips", () => {
  const c = exportCode(state);
  assert.ok(looksLikeBackup(c));
  const back = importCode(c);
  assert.equal(back.classId, "Pirate (DEX)");
  assert.equal(back.mode, "early");
  assert.deepEqual(back.cells, ["lines", "item", "empty"]);
  assert.equal(back.mapPinned, true);
  assert.deepEqual(back.items.map((it) => [it.slot, it.cls, it.lines, it.sockets, it.equipped, it.cell, it.key]), [
    ["Hat", "Magician", ["leap", "wh"], ["prismatic", "blue"], true, null, "Hat|Magician|leap,wh|12+34"],
    ["Top", "Magician", ["atk"], ["grey"], false, "3,1", "Top|Magician|atk|56"],
  ]);
});

test("rejects things that aren't backups", () => {
  for (const bad of ["", "hello", "QUANDREA1:@@@", "QUANDREA1:" + Buffer.from("not json").toString("base64"), code({ app: "other", items: [] }), code(null), code([1, 2])])
    assert.throws(() => importCode(bad));
  assert.throws(() => importCode("QUANDREA1:" + "A".repeat(MAX_CODE)), /too big/);
  assert.throws(() => importCode(42));
});

test("drops anything that isn't a known value", () => {
  const evil = {
    app: "quandrea",
    classId: "<img src=x onerror=alert(1)>",
    mode: "javascript:alert(1)",
    cells: ["<b>x</b>", "lines", 5],
    mapPinned: "yes",
    extra: "<script>alert(1)</script>",
    items: [
      { slot: "<script>", lines: ["leap"] }, // unknown slot: dropped
      {
        id: "<img src=x onerror=alert(1)>",
        key: "Hat|<b>|x|<script>",
        slot: "Hat",
        cls: "<svg onload=alert(1)>",
        lines: ["leap", "<img>", { toString: "x" }, "wh", "reg", "crit"],
        sockets: ["red", "javascript:", "blue", "green", "purple"],
        equipped: "true",
        cell: "99,99",
        onclick: "alert(1)",
        __proto__: { polluted: true },
      },
      "not an object",
      null,
    ],
  };
  const out = importCode(code(evil));
  assert.equal(out.classId, "Magician");
  assert.equal(out.mode, "endgame");
  assert.deepEqual(out.cells, ["empty", "lines", "empty"]);
  assert.equal(out.mapPinned, false);
  assert.equal("extra" in out, false);
  assert.equal(out.items.length, 1);
  const it = out.items[0];
  assert.deepEqual(Object.keys(it).sort(), ["cell", "cls", "equipped", "id", "key", "lines", "slot", "sockets", "stats"]);
  assert.equal(it.cls, null);
  assert.deepEqual(it.lines, ["leap", "wh", "reg"]);
  assert.deepEqual(it.sockets, ["red", "blue", "green"]);
  assert.equal(it.equipped, false);
  assert.equal(it.cell, null);
  assert.match(it.id, /^[A-Za-z0-9.-]+$/);
  assert.equal(/[<>]/.test(JSON.stringify(out)), false);
  assert.equal({}.polluted, undefined);
});

test("__proto__ in the JSON can't pollute objects", () => {
  const text = 'QUANDREA1:' + Buffer.from('{"app":"quandrea","__proto__":{"polluted":1},"items":[{"slot":"Hat","__proto__":{"polluted":2},"lines":[]}]}').toString("base64");
  const out = importCode(text);
  assert.equal(out.items.length, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(out.polluted, undefined);
  assert.equal(out.items[0].polluted, undefined);
});

test("caps sizes and fixes duplicates", () => {
  const items = Array.from({ length: 1500 }, (_, i) => ({ id: "same", slot: "Hat", lines: [], equipped: true, cell: "0,0", stats: String(i) }));
  const out = sanitize({ items, cells: Array(500).fill("item") });
  assert.equal(out.items.length, 1000);
  assert.equal(out.cells.length, 128);
  assert.equal(out.items.filter((it) => it.equipped).length, 1);
  assert.equal(out.items.filter((it) => it.cell).length, 1);
  assert.equal(new Set(out.items.map((it) => it.id)).size, 1000);
});

test("old saves still load", () => {
  const out = sanitize({ classId: "Pirate", items: [{ id: "x", key: "Cape|Thief|thief|1+2", slot: "Cape", cls: "Thief", lines: ["thief"], sockets: [] }] });
  assert.equal(out.classId, "Pirate (STR)");
  assert.equal(out.items[0].key, "Cape|Thief|thief|1+2");
});
