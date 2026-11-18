// What Add manually offers, in order: the equipment, then its jewels, then its skills.

import { SLOTS, TARGETS } from "./parse.js?v=42";

export const STEPS = ["slot", "sock", "line"];
export const STEP_NAME = { slot: "Equipment", sock: "Jewels", line: "Skills" };
export const OPTIONS = {
  slot: SLOTS,
  sock: ["blue", "green", "purple", "red", "grey", "prismatic"],
  line: TARGETS.map((t) => t.k),
};
