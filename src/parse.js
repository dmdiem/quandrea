// Turning a tooltip's OCR text into an item. OCR misreads a few letters (Lv. as "Ly.", Damage as
// "Darnage", None as "Mone"), so every pattern here is loose on purpose.

export const CLASSES = ["Magician", "Warrior", "Bowman", "Thief", "Pirate"];
export const SLOTS = ["Hat", "Top", "Bottom", "Cape", "Gloves", "Shoes"];

// The 18 lines a finished set wants: 3 each of four, and one of each class plus Crit DMG.
export const TARGETS = [
  { k: "leap", name: "Dimensional Leap", need: 3 },
  { k: "wh", name: "White Hole", need: 3 },
  { k: "reg", name: "Registry", need: 3 },
  { k: "atk", name: "ATT & M.ATT", need: 3 },
  { k: "crit", name: "Crit DMG", need: 1 },
  { k: "warrior", name: "Warrior", need: 1 },
  { k: "mage", name: "Mage", need: 1 },
  { k: "archer", name: "Bowman", need: 1 },
  { k: "thief", name: "Thief", need: 1 },
  { k: "pirate", name: "Pirate", need: 1 },
];
export const OTHER = "other"; // a line that isn't on the list (Boss DMG, Ignore DEF, Damage)

const SKILL = [
  ["leap", /dimens\w*\s*le[a-z]p/i],
  ["wh", /wh[il1]te\s*h[a-z0][l1I]e/i],
  ["reg", /reg[il1]str/i],
  ["atk", /magic\s*at+\w?\s*enh|attack\s*power\s*[&8]/i],
  ["crit", /crit\w*\s*da\w*\s*enh/i],
  ["warrior", /warr?[il1]or\s*att/i],
  ["mage", /mag[il1]c[il1]an\s*att/i],
  ["archer", /bowm[a-z]n\s*att/i],
  ["thief", /th[il1]ef\s*att/i],
  ["pirate", /p[il1]rate\s*att/i],
];

// "Lv. +1" as OCR sees it: Lv. Ly. Lv, L. and so on, then +1.
const LEVEL = /\bL[vy1]?[.,]?\s*\+\s*\d\b/i;

// The skill lines, with wrapped ones joined back up ("...Enhancement" / "Skill Lv. +1").
export function skillLines(text) {
  const raw = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    const start = /holo|enh\w*\s*sk[il1]/i.test(l) || SKILL.some(([, re]) => re.test(l)) || /dimens|wh[il1]te\s*h[a-z0]|reg[il1]str/i.test(l);
    if (!start) continue;
    if (LEVEL.test(l)) lines.push(l);
    else if (i + 1 < raw.length && LEVEL.test(raw[i + 1]) && !/holo/i.test(raw[i + 1])) lines.push(`${l} ${raw[++i]}`);
  }
  return lines;
}

export function lineKey(line) {
  for (const [k, re] of SKILL) if (re.test(line)) return k;
  return OTHER;
}

const SKIP = ["Shoulder", "Weapon", "Secondary", "Emblem", "Badge", "Pendant", "Earring", "Ring", "Belt", "Pocket", "Medal", "Heart", "Android", "Totem"];

// Everything we can read off one tooltip. slot is null when the title couldn't be read.
export function parseTooltip(text) {
  const t = String(text);
  const title = t.match(/supercharged\s+(hat|top|pants|bottom|shoes?|gloves?|cape)\b([^\n]*)/i);
  const slotWord = title?.[1].toLowerCase();
  const slot = !slotWord ? null
    : slotWord === "pants" ? "Bottom"
    : slotWord.startsWith("shoe") ? "Shoes"
    : slotWord.startsWith("glove") ? "Gloves"
    : slotWord[0].toUpperCase() + slotWord.slice(1);
  // The class in brackets after it, which OCR sometimes reads as "iMagician)".
  const cls = CLASSES.find((c) => title && title[2].toLowerCase().includes(c.toLowerCase().slice(1, 6))) ?? null;
  const lines = skillLines(t).map(lineKey).slice(0, 3);
  // Gear that can't roll hologram lines (shoulder, weapon, accessories): say so instead of
  // treating it as a misread.
  const skip = slot ? null : SKIP.find((w) => new RegExp(`\\b${w}`, "i").test(t)) ?? null;
  return {
    slot,
    skip,
    cls,
    equipped: /currently\s*equ[il1]pped/i.test(t),
    lines,
    // Stat numbers make two otherwise identical items look different, so a second hover of the
    // same item isn't counted twice.
    stats: statDigits(t),
  };
}

function statDigits(text) {
  const m = text.match(/set\s*effect[\s\S]*?(?=\[holo|dimens|wh[il1]te\s*h|reg[il1]str|scro|$)/i);
  return (m?.[0] ?? "").replace(/[^0-9+]/g, "").slice(0, 60);
}
