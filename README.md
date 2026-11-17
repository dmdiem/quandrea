# Quandrea

**Let Quandrea tell you if your gear is trash.**

A gear scanner for MapleStory's Quanah world. Share your game window, hover your gear, and it reads
each item's hologram lines and sockets, then tells you what to **keep** and what to **trash**.

Everything runs in your browser. Nothing you share leaves your computer, and your scanned items are
saved only in that browser.

## Using it

1. Open the site and click **Share MapleStory window**. Pick the game window (or the whole screen).
2. Open your inventory and hover each item with the grey bar on top (those have hologram lines).
   Wait for the ✓, about a second each.
3. Hover one item per slot so it also reads the "Currently Equipped" box next to it.
4. Don't move or sort items while scanning. When you're done, throw out what's marked **Trash**.

Pick your class at the top (pirates also pick STR or DEX). It decides which gear is yours and
which socket colours you can use.

## What it's aiming for

**Stage 1: 18/18 hologram lines.** Six pieces (hat, top, bottom, cape, gloves, shoes; weapons and
shoulders can't roll lines), three lines each:

| Line | How many |
|---|---|
| Dimensional Leap, White Hole, Registry, Attack Power & Magic ATT | 3 each |
| Critical Damage, Warrior, Magician, Bowman, Thief, Pirate attack | 1 each |

Boss Damage, Ignore Defense and Damage Enhancement lines don't count, and neither do extra copies.
**Any 3 lines** mode is for the very start: fill every slot with 3 lines of anything, preferring
the right ones.

**Stage 2: sockets.** A second set with good sockets: 4 pieces with prismatic + stat + stat and 2 with
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

### Verdicts

- **Keep**: part of your best 18-line set.
- **Backup**: all three lines are on the list, but the set already has a better piece for that slot.
- **Socket donor**: the best socket piece for its slot so far (stage 2). It needs a prismatic socket
  or at least 2 usable ones; one usable socket isn't worth an Orb.
- **Trash**: none of the above, or gear for another class.

The best set is worked out over every combination, so it never wastes a slot on a line another
piece already covers. Thanks to the community's 3L Set Solver for the idea.

## How it reads the screen

- **Tooltips:** found by their 1px border, so it works wherever your cursor is.
- **Text:** read with [Tesseract.js](https://github.com/naptha/tesseract.js) after enlarging and
  keeping only bright pixels (the tooltip is see-through).
- **Sockets:** read from the colour of each droplet's outline above the item picture.

If a line is misread, delete the item (×) and hover it again, or use **Add by hand**.

## Development

Plain HTML and JavaScript modules; no build step. GitHub Pages serves it from `main`.

```bash
npm test
```

The tests use real OCR output from tooltip screenshots (`test/fixtures/ocr/`) and generated images.
Screenshots themselves aren't in the repo, since they show character names.
