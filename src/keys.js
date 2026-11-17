// Fast entry keys for Add manually, laid out like the keyboard: the top row picks sockets (Q W E R T,
// with 1 above Q for prismatic) and the slot (Y U I O P, H for gloves); the home row picks lines
// (A S D F the four big ones, G Crit, J K L ; ' the classes); Z X C V the lines that don't count.

import { OTHER } from "./parse.js?v=30";

export const KEYS = {
  slot: { Hat: "Y", Top: "U", Bottom: "I", Cape: "O", Gloves: "H", Shoes: "P" },
  line: { leap: "A", wh: "S", reg: "D", atk: "F", crit: "G", warrior: "J", mage: "K", archer: "L", thief: ";", pirate: "'", boss: "Z", ied: "X", dmg: "C", [OTHER]: "V" },
  sock: { blue: "Q", green: "W", purple: "E", red: "R", grey: "T", prismatic: "1" },
};

// key (lower case) -> [kind, value], e.g. "q" -> ["sock", "blue"]
export const KEY_TO = Object.fromEntries(Object.entries(KEYS).flatMap(([kind, m]) => Object.entries(m).map(([v, key]) => [key.toLowerCase(), [kind, v]])));
