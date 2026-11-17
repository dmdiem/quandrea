# Quandrea

**Let Quandrea tell you if your gear is trash.**

A gear scanner for MapleStory's Quanah world. Share your game window, hover your gear, and it reads
each item's hologram lines and sockets, then tells you what to **keep** and what to **trash**.

Everything runs in your browser. Nothing you share leaves your computer, and your scanned items are
saved only in that browser.

## Using it

1. Open your inventory's Equip tab, **expanded** so all 16 columns show, with nothing hovered. Press
   **PrtScn**, then **Ctrl+V** on the page: the **Inventory map** fills in, with dashed cells for
   items that have hologram lines. **Reset map** clears it.
2. Hover an item, press **PrtScn**, then **Ctrl+V** on the page. Repeat for each dashed item. The
   "Currently Equipped" box beside the tooltip is read too.
3. If a screenshot won't read, click **Add manually** and type the piece, one keyboard row per kind:
   1–6 Hat / Top / Bottom / Cape / Gloves / Shoes; Q W E R T Y Blue / Green / Purple / Red / Grey /
   Prismatic; A S D F G Leap / White Hole / Registry / ATT / Crit and H J K L ; Warrior / Mage /
   Bowman / Thief / Pirate. Enter (or Space, or Tab) adds it and moves on to the next map cell with lines.
4. Show the game at full size; tiny text reads poorly. Don't sort items mid-scan.
5. Throw out what's marked **Trash**.

Live screen sharing is switched off for now (`LIVE_SHARE` in `src/app.js`).

**Simpling Dumpling mode** (button at the top) is a simple screen for colour-blind players: paste a
screenshot of a hovered item, and its socket colours show up as big words, with ✓ on the ones your class
can use. There's also a **Colour-blind friendly** switch for the full page.

**Copy backup** puts a code of your scanned items and map on the clipboard; paste it back on the
page (Ctrl+V, or **Load backup**) to restore it, in another browser or after clearing your data. A
backup is checked before it's loaded: only known slots, classes, lines, sockets and cells are kept,
and everything else in it is thrown away.

Pick your class at the top (pirates also pick STR or DEX). It decides which gear is yours and
which socket colours you can use.

## What it's aiming for

**First: 18/18 hologram lines.** Six pieces (hat, top, bottom, cape, gloves, shoes; weapons and
shoulders can't roll lines), three lines each:

| Line | How many |
|---|---|
| Dimensional Leap, White Hole, Registry, Attack Power & Magic ATT | 3 each |
| Critical Damage, Warrior, Magician, Bowman, Thief, Pirate attack | 1 each |

Boss Damage, Ignore Defense and Damage Enhancement lines don't count, and neither do extra copies.
**Any 3 lines** mode is for the very start: fill every slot with 3 lines of anything, preferring
the right ones.

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

### Keep or trash

Every item in your bag gets one of two verdicts:

- **Keep**, with the reason: it's in your **best combo**, it's a **spare 3-line** piece (all three
  lines on the list), or it has the best sockets for its slot (**for sockets**: a prismatic, or at
  least 2 usable ones, to fuse your lines onto).
- **Trash**: none of those, or gear for another class.

The right side of the page lists them under **Trash · Keep · All**, each with a little grid showing its spot on the
Inventory map. The left side shows your sets: **Equipped now** and the **Best combo**.

The **best combo** is the best outfit you can make from everything you've scanned, worn or in your
bag: one piece per slot, covering as many of the 18 lines as possible (ties go to more lines in
total, then to what you already wear). It's worked out over every combination, so it never wastes a
slot on a line another piece already covers. Thanks to the community's 3L Set Solver for the idea.

## How it reads the screen

- **Tooltips:** found by their 1px border, so it works wherever your cursor is.
- **Text:** read with [Tesseract.js](https://github.com/naptha/tesseract.js) after enlarging and
  keeping only bright pixels (the tooltip is see-through).
- **Sockets:** read from the colour of each droplet's outline above the item picture.
- **Inventory map:** the Equip tab's grid (16 x 8 cells, 46px apart) is found by the bright gaps
  between cells; the grey bar marks items with lines; the game's glove cursor says which cell a
  tooltip belongs to.

If a line is misread, delete the item (×) and hover it again, or use **Add by hand**.

## Development

Plain HTML and JavaScript modules; no build step. GitHub Pages serves it from `main`.

```bash
npm test
```

The tests use real OCR output from tooltip screenshots (`test/fixtures/ocr/`) and generated images.
Screenshots themselves aren't in the repo, since they show character names.
