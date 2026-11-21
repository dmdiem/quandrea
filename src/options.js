// What Add manually offers, in order: the equipment, then its jewels, then its skills.

import { SLOTS, TARGETS } from "./parse.js?v=85";

export const STEPS = ["slot", "sock", "line"];
export const STEP_NAME = { slot: "Equipment", sock: "Jewels", line: "Skills" };
export const OPTIONS = {
  slot: SLOTS,
  sock: ["prismatic", "blue", "green", "purple", "red", "grey"], // prismatic is always the leftmost socket
  line: TARGETS.map((t) => t.k),
};
