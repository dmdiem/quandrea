# Quandrea

**Quandrea will help you get what's yours.**

A gear checker for MapleStory's Quanah world. Click in each piece's hologram lines and sockets, and it
builds the best set: one piece per slot, as close to the 18 lines as you can get.

**No install, and it never touches the game.** It's a web page: open the link and use it. It doesn't
connect to MapleStory, read its memory or files, or press anything; it only sees screenshots you choose
to paste. Everything stays in your browser.

Your pieces are saved only in that browser (Presets and Copy backup help you keep them).

## Using it

1. In **Add a piece**, click each item's **equipment**, **jewels** and **skills**, then **Add**. Or hover the item in the game, press **PrtScn**, then **Ctrl+V** on
   the page: it fills them in for you to check before you click Add.
2. For the pieces you're wearing, switch on **Currently Equipped** before Add (or click **Equip** later).

**Simpling Dumpling mode** (button at the top) is a simple screen for colour-blind players: hover an
item in the game, press PrtScn and paste the screenshot, and its socket colours show up as big words, with ✓ on the ones your class
can use. There's also a **Colour-blind friendly** switch for the full page.

**Presets** keep up to 5 named sets of pieces in this browser: open the list, type a name, **Save**,
and **Load** it back later.

**Copy backup** puts a code of your pieces on the clipboard; paste it back on the
page (Ctrl+V, or **Load backup**) to restore it, in another browser or after clearing your data. A
backup is checked before it's loaded: only known slots, classes, lines, sockets and cells are kept,
and everything else in it is thrown away.

Pick your class at the top (pirates also pick STR or DEX). It decides which gear is yours and
which socket colours you can use.

## What it's aiming for

**First: 18/18 hologram lines.** Six pieces (hat, top, bottom, shoes, gloves, cape; weapons and
shoulders can't roll lines), three lines each. There are two builds people go for, and Quandrea
works out your best combo for both (the buttons at the top of Hologram lines show each score;
click one to see its board):

| Line | Original BiS | EU BiS |
|---|---|---|
| Dimensional Leap, White Hole, Registry, Attack Power & Magic ATT | 3 each | 3 each |
| Critical Damage | 1 | 3 |
| Damage Enhancement | – | 3 |
| Class lines (Bowman, Warrior, Thief, Mage, Pirate) | 1 each | – |
| Prismatic jewels | 4 | 6 |

The EU build is courtesy of Shapaz: after the Nov 19, 2026 maintenance it drops the class lines (the only
ones with no passive Final Damage) for 3 Crit DMG and 3 Damage. Class line damage, strongest first: Bowman, Warrior, Thief, Mage, Pirate (v.272 patch notes,
Lv. 8, the same for every job). Boss Damage and Ignore Defense lines never count, and neither do extra copies.
When it's a tie, the piece with more lines wins, so early on it still fills every slot.

**Then: jewel sockets.** A second set with good sockets: 4 pieces with prismatic + stat + stat and 2 with
stat + stat + stat. Orbs move your 18 lines onto them.

Each socket colour takes one class's gems, which roll that class's stats plus Attack Power (or
Magic ATT for blue). You can use any colour whose gems roll your stats:

| Class | Main / secondary stat | Socket colours you can use |
|---|---|---|
| Magician | INT / LUK | blue only (the only Magic ATT gems) |
| Warrior | STR / DEX | red, green, grey |
| Bowman | DEX / STR | red, green, grey, purple |
| Thief | LUK / DEX or STR | purple, grey |
| Pirate (STR) | STR / DEX | red, green, grey |
| Pirate (DEX) | DEX / STR | red, green, grey, purple |

Gem colours by class: red = Warrior, green = Bowman, grey = Pirate, purple = Thief, blue = Magician.

### Your pieces

Everything you've added, by slot, each tagged with the builds whose best combo it's in (**Original**,
**EU**; the one you're looking at is highlighted), and marked **Equipped**, **In best combo**, **For jewels** (perfect
sockets for its slot, 3 your class can use, to move your lines onto with an Orb; Orbs are rare, so nothing
less counts) or spare. The left
side, **What to wear**, is the best combo piece by piece, with Equip / Swap buttons.

The **best combo** is the best outfit you can make from everything you've added, worn or in your
bag: one piece per slot. **Leap, White Hole and Registry come first** (their damage is why 3 of each is
BiS), then as many of the 18 lines as possible, then ATT & M.ATT, then more lines in total, then what
you already wear. It's worked out over every combination, so it never wastes a
slot on a line another piece already covers. The idea comes from the community's 3L Set Solver (see Credits).

## What it reads from a screenshot

Only screenshots you paste, and nothing is saved until you click Add:

- **Tooltip:** found by its 1px border (or its title block), wherever it is in the screenshot.
- **Text:** read with [Tesseract.js](https://github.com/naptha/tesseract.js), loaded the first time you
  paste, after enlarging and keeping only bright pixels.
- **Sockets:** each droplet above the item picture is named by the colour of its outline (also what
  Simpling Dumpling mode shows).

## Credits

- **[3L Set Solver](https://freehtmlhost.com/3l-set-solver/)**: the community tool that first worked out
  the best one-piece-per-slot combo for the 18 lines; Quandrea's solver follows the same idea.
- **The MapleStory community's Quanah guides**: the Event FAQ and the jewel / socket guides that
  explain the 18 lines, the socket colours per class and the prismatic + stat goal.
- **[Tesseract.js](https://github.com/naptha/tesseract.js)** (Apache 2.0): reads the text in pasted
  screenshots.
- **Logo**: a Bubu (Bubu & Dudu) sticker; the character belongs to its creator.

MapleStory, Quanah and everything in them belong to NEXON. Quandrea is a fan-made tool, not made by or
affiliated with NEXON, and it uses none of the game's files or art.

## Development

**Builds** live in `BUILDS` in `src/solver.js`: each has how many of every line it needs
and its prismatic goal. Adding one there adds its button and tags.

Plain HTML and JavaScript modules; no build step. GitHub Pages serves it from `main`.

```bash
npm test
```

The tests use generated images and text from real tooltips (`test/fixtures/ocr/`, from when lines were read off the screen).
Screenshots themselves aren't in the repo, since they show character names.
