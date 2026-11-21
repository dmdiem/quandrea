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
2. Adding a piece you already added (same slot, class, lines and jewels) doesn't make a copy: the one you
   have is highlighted instead.

**Hologram lines** shows your best combo's score out of 18 for the build you pick, and a board of its
lines (a small **+1** after a row is a spare copy: still +1 to that skill, but past what counts).
**Still missing** lists what to farm next, and **What to wear** lists the best combo piece by piece.
Quandrea doesn't track what you have on in game: compare What to wear with your character.

**Simpling Dumpling mode** (button at the top) is a simple screen for colour-blind players: hover an
item in the game, press PrtScn and paste the screenshot, and its socket colours show up as big words, with ✓ on the ones your class
can use. There's also a **Colour-blind friendly** switch for the full page.

**Presets** keep up to 5 named sets of pieces in this browser: open the list, type a name, **Save**,
and **Load** it back later.

**Copy backup** puts a code of your pieces on the clipboard; paste it back on the
page (Ctrl+V, or **Load backup**) to restore it, in another browser or after clearing your data. A
backup is checked before it's loaded: only known slots, classes, lines, sockets and cells are kept,
and everything else in it is thrown away.

Pick your class at the top (pirates also pick STR or DEX). It decides which socket colours you can
use. Another class's gear still counts for its lines (an Orb moves them onto your gear), so it's
marked "needs an Orb"; on a tie your own class's piece wins, since Orbs are rare.

## What it's aiming for

**First: 18/18 hologram lines.** Six pieces (hat, top, bottom, shoes, gloves, cape; weapons and
shoulders can't roll lines), three lines each. There are three builds, and Quandrea
works out your best combo for each (the buttons at the top of Hologram lines show each score;
click one to see its board):

- **General**: the one most people want. Its class lines' procs hit many enemies, which is great for
  mobbing, dungeons and quests.
- **Flex**: in between. Both builds share 13 lines (3 each of Leap, White Hole, Registry, ATT, and 1
  Crit DMG); Flex wants those plus any 5 class, Crit DMG or Damage lines, whatever mix your gear has.
  Only Boss DMG and Ignore DEF are wasted. When there are more of those lines than the 5 spots,
  Crit DMG and Damage count first.
- **Bossing**: an optional min-max for when you're going past the 22 badge and doing lots of bossing. It's
  about +7% Final Damage, give or take, so not necessary. It's the EU build, courtesy of Shapaz.

| Line | General | Flex | Bossing |
|---|---|---|---|
| Dimensional Leap, White Hole, Registry, Attack Power & Magic ATT | 3 each | 3 each | 3 each |
| Critical Damage | 1 | 1 + any | 3 |
| Damage Enhancement | – | any | 3 |
| Class lines (Bowman, Warrior, Thief, Mage, Pirate) | 1 each | any | – |
| "Any" lines (class, more Crit DMG, Damage) | – | 5 | – |
| Prismatic jewels | 4 | 4 | 6 |

Bossing drops the class lines (the only ones with no passive Final Damage, and their procs are spread
over many enemies) for 3 Crit DMG and 3 Damage, which hit one target harder. Class line damage, strongest first: Bowman, Warrior, Thief, Mage, Pirate (v.272 patch notes,
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

Everything you've added, by slot, with each slot's **BiS ✓** piece (for the build you picked) first and
highlighted. A **Bossing** tag means all 3 of a piece's lines fit a perfect Bossing set (Leap, White Hole,
Registry, ATT, Crit DMG or Damage: no class lines). Pieces are also tagged **For jewels** (perfect sockets for its slot,
3 your class can use, to move your lines onto with an Orb; Orbs are rare, so nothing less counts) or
spare.

The **best combo** is the best outfit you can make from everything you've added, worn or in your
bag: one piece per slot. For **General** and **Bossing** (a fixed 18) it gets as many of the 18 as possible
first, so adding a piece never lowers your score; between equal scores it takes the one with more
damage. Each line is weighted by roughly what a level of it adds (from the skill tooltips): Leap, White
Hole and Registry most (+5% Final Damage each), then ATT, Crit DMG, Damage, and class lines least (a Lv. 1
proc). **Flex** goes for the most damage first, and its 5 "any" spots go to the strongest lines. Then more
lines in total, then better jewel sockets (fewer Orbs). It's worked out over every combination, so it never wastes a
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
