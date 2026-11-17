// Fast entry keys for Add manually: one keyboard row per kind, top to bottom in the order you fill
// a piece in. Number row: equipment. Q row: jewels. Home row: skills. Z row: lines that don't count.

import { OTHER } from "./parse.js?v=34";

export const KEYS = {
  slot: { Hat: "1", Top: "2", Bottom: "3", Cape: "4", Gloves: "5", Shoes: "6" },
  sock: { blue: "Q", green: "W", purple: "E", red: "R", grey: "T", prismatic: "Y" },
  line: { leap: "A", wh: "S", reg: "D", atk: "F", crit: "G", warrior: "H", mage: "J", archer: "K", thief: "L", pirate: ";", boss: "Z", ied: "X", dmg: "C", [OTHER]: "V" },
};

// key (lower case) -> [kind, value], e.g. "q" -> ["sock", "blue"]
export const KEY_TO = Object.fromEntries(Object.entries(KEYS).flatMap(([kind, m]) => Object.entries(m).map(([v, key]) => [key.toLowerCase(), [kind, v]])));
