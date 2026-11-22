// Turning a tooltip's OCR text into an item. OCR misreads a few letters (Lv. as "Ly.", Damage as
// "Darnage", None as "Mone"), so every pattern here is loose on purpose.

export const CLASSES = ["Magician", "Warrior", "Bowman", "Thief", "Pirate"];
export const SLOTS = ["Hat", "Top", "Bottom", "Shoes", "Gloves", "Cape"];

// Every line some build counts. need = the Original BiS (3 each of four, one of each class plus Crit
// DMG); the other builds (solver.js BUILDS) change the counts. Damage only counts in the EU build.
export const TARGETS = [
  { k: "leap", name: "Leap", need: 3 },
  { k: "wh", name: "White Hole", need: 3 },
  { k: "reg", name: "Registry", need: 3 },
  { k: "atk", name: "ATT & M.ATT", need: 3 },
  { k: "crit", name: "Crit DMG", need: 1 },
  { k: "dmg", name: "Damage", need: 0 },
  // The class lines, strongest to weakest (their hologram skill damage in the v.272 patch notes;
  // the same order for every job).
  { k: "archer", name: "Bowman", need: 1 },
  { k: "warrior", name: "Warrior", need: 1 },
  { k: "thief", name: "Thief", need: 1 },
  { k: "mage", name: "Mage", need: 1 },
  { k: "pirate", name: "Pirate", need: 1 },
  // No built-in build counts these, but Custom can.
  { k: "boss", name: "Boss DMG", need: 0 },
  { k: "ied", name: "Ignore DEF", need: 0 },
];
export const OTHER = "other"; // a line we don't recognise
// Lines no built-in build counts (they're in TARGETS so Custom can ask for them).
export const NOT_BIS = ["boss", "ied"];
export const FILLERS = [];
export const isTarget = (k) => TARGETS.some((t) => t.k === k) && !NOT_BIS.includes(k);
const FILLER_RE = [
  ["boss", /boss\s*da\w*\s*enh/i],
  ["ied", /[il1]?gn\w*\s*def\w*\s*enh/i],
  ["dmg", /\bda\w{3,5}\s*enh/i], // checked after Crit DMG and Boss DMG, which also say "Damage Enhancement"
];

const SKILL = [
  ["leap", /mens[il1]\w*\s*le[a-z]?p/i],
  // "White Hole", also when OCR loses or mangles the W ("thite Hole", "‘hite Hole").
  ["wh", /\bw[a-z1]{2,4}\s*h[a-z0][l1I]e\b|[a-z]?h[il1]te\s*h[o0][l1I]e\b/i],
  ["reg", /reg[il1]str/i],
  ["atk", /magic\s*at+\w?\s*enh|attack\s*[a-z]?ower\s*[&8]|[&8]\s*ma\w{1,3}\s*at+\w?\s*enh/i],
  ["crit", /crit\w*\s*da\w*\s*enh/i],
  ["warrior", /warr?[il1]or\s*att/i],
  ["mage", /mag[il1]c[il1]an\s*att/i],
  ["archer", /bowm[a-z]n\s*att|\bbow[a-z]{0,3}\s+a[a-z]?\s+[a-z]{2,6}\s*[=s]?kil/i],
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
    const start = /holo|enh\w*\s*sk[il1]/i.test(l) || SKILL.some(([, re]) => re.test(l)) || /mens[il1]|h[il1]te\s*h[o0a]|reg[il1]str/i.test(l);
    if (!start) continue;
    // A line naming a target skill counts even when OCR mangles its "Lv. +1" (small or blurry text):
    // those names never appear in stat or potential lines.
    if (LEVEL.test(l) || SKILL.some(([, re]) => re.test(l))) {
      lines.push(l);
      if (!LEVEL.test(l) && i + 1 < raw.length && LEVEL.test(raw[i + 1]) && !/holo/i.test(raw[i + 1]) && !SKILL.some(([, re]) => re.test(raw[i + 1]))) i++; // its wrapped "Skill Lv. +1"
    }
    else if (i + 1 < raw.length && LEVEL.test(raw[i + 1]) && !/holo/i.test(raw[i + 1])) lines.push(`${l} ${raw[++i]}`);
  }
  return lines;
}

export const noRepeats = (keys) => keys.filter((k, i) => k === OTHER || keys.indexOf(k) === i);

export function lineKey(line) {
  for (const [k, re] of SKILL) if (re.test(line)) return k;
  for (const [k, re] of FILLER_RE) if (re.test(line)) return k;
  return fuzzyKey(line) ?? OTHER;
}

// When OCR mangles a few letters ("Dimensionai Lcap", "Registrv", "thite Hole"), compare the line's
// letters with every skill's name: it counts if most letters match in the same order and it's
// clearly closer to one name than any other.
const NAMES = [
  ["leap", "dimensional leap"],
  ["wh", "white hole"],
  ["reg", "registry"],
  ["atk", "attack power magic att enhancement"],
  ["crit", "critical damage enhancement"],
  ["dmg", "damage enhancement"],
  ["boss", "boss damage increase enhancement"],
  ["ied", "ignore defense enhancement"],
  ["warrior", "warrior attack"],
  ["mage", "magician attack"],
  ["archer", "bowman attack"],
  ["thief", "thief attack"],
  ["pirate", "pirate attack"],
].map(([k, n]) => [k, n.replace(/ /g, "")]);
const letters = (line) => String(line).toLowerCase()
  .replace(/\[?h[o0]l[o0]gr[a-z]*\]?/g, " ") // "[Hologram]"
  .replace(/\b(skill|sk[il1]ll|level)\b/g, " ")
  .replace(/l[vy1]?[.,]?\s*\+\s*\d.*$/, " ") // "Lv. +1" and anything after
  .replace(/[^a-z]/g, "");
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export function fuzzyKey(line) {
  const t = letters(line);
  if (t.length < 5) return null;
  const scored = NAMES.map(([k, n]) => [k, 1 - editDistance(t, n) / Math.max(t.length, n.length)]).sort((a, b) => b[1] - a[1]);
  const [[k, best], [, next]] = scored;
  return best >= 0.75 && best - next >= 0.1 ? k : null;
}

// When OCR loses the title, the slot badge under "Armor" on the right ("Armor" / "Top"), even
// misread by a letter ("Tap", "Glaves").
const BADGES = { hat: "Hat", top: "Top", bottom: "Bottom", shoes: "Shoes", gloves: "Gloves", cape: "Cape" };
const slotWord = (w) => {
  if (w.length < 3 || w.length > 7) return null;
  for (const [k, slot] of Object.entries({ ...BADGES, pants: "Bottom" })) if (editDistance(w, k) <= (k.length <= 4 ? 1 : 2)) return slot;
  return null;
};
function badgeSlot(text) {
  const lines = String(text).split(/\r?\n/);
  // The top of the tooltip, before "Required Job" (stats and skills below can say anything).
  const end = lines.findIndex((l) => /requ[il1]red/i.test(l));
  const head = lines.slice(0, end < 0 ? 10 : end);
  // 1. The badge under "Armor".
  for (let i = 0; i < head.length; i++) {
    if (!/\bar[mn]{1,2}[o0]r\b/i.test(head[i])) continue;
    for (const l of head.slice(i + 1, i + 3)) {
      const slot = slotWord(l.toLowerCase().replace(/[^a-z]/g, ""));
      if (slot) return slot;
    }
  }
  // 2. The garbled title: the word just before "(Class)" ("…Supercharged Lape (wiagivian)").
  const title = head.slice(0, 3).map((l) => l.match(/([a-z]{3,7})\s*\(/i)?.[1]).find(Boolean);
  if (title && slotWord(title.toLowerCase())) return slotWord(title.toLowerCase());
  // 3. The badge on a line of its own, even if "Armor" was lost.
  for (const l of head) {
    const w = l.trim().toLowerCase();
    if (/^[a-z]{3,6}$/.test(w) && slotWord(w)) return slotWord(w);
  }
  return null;
}
// "Required Job  Magician"
function requiredJob(text) {
  const m = String(text).match(/requ[il1]red\s*j[o0]\w*\s+([a-z]+)/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return CLASSES.find((c) => editDistance(w, c.toLowerCase()) <= 2) ?? null;
}

const SKIP = ["Shoulder", "Weapon", "Secondary", "Emblem", "Badge", "Pendant", "Earring", "Ring", "Belt", "Pocket", "Medal", "Heart", "Android", "Totem"];

// Everything we can read off one tooltip. slot is null when the title couldn't be read.
export function parseTooltip(text) {
  const t = String(text);
  const title = t.match(/supercharged\s+(hat|top|pants|bottom|shoes?|gloves?|cape)\b([^\n]*)/i);
  const slotWord = title?.[1].toLowerCase();
  const slot = (!slotWord ? null
    : slotWord === "pants" ? "Bottom"
    : slotWord.startsWith("shoe") ? "Shoes"
    : slotWord.startsWith("glove") ? "Gloves"
    : slotWord[0].toUpperCase() + slotWord.slice(1)) ?? badgeSlot(t);
  // The class in brackets after it, which OCR sometimes reads as "iMagician)"; if the title was
  // lost, the "Required Job" line.
  const cls = CLASSES.find((c) => title && title[2].toLowerCase().includes(c.toLowerCase().slice(1, 6))) ?? requiredJob(t);
  // A piece can't roll the same line twice, so a repeat is a misread: keep one. ("Other" can
  // repeat: Boss DMG and Ignore DEF both count as Other.)
  const lines = noRepeats(skillLines(t).map(lineKey)).slice(0, 3);
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
  const m = text.match(/set\s*effect[\s\S]*?(?=\[holo|dimens|h[il1]te\s*h[o0]|reg[il1]str|scro|$)/i);
  return (m?.[0] ?? "").replace(/[^0-9+]/g, "").slice(0, 60);
}
