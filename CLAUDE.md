# Notes for Claude

Quandrea is a static site (GitHub Pages, served from `main`) that reads MapleStory Quanah gear
tooltips from a shared screen. See `README.md` for how it works.

- Commit locally after each change; ask the user to confirm the message first. Push only when they say "push".
- Author is always `dmdiem <28607805+dmdiem@users.noreply.github.com>` (use `--author`).
- Run `npm test` before every commit and add tests with each change.
- Never commit screenshots: they show character names. OCR text fixtures are fine.
- Layout: `src/vision.js` (finding tooltips, the item picture and sockets in pixels), `src/parse.js`
  (OCR text to item), `src/solver.js` (best set, socket set, verdicts), `src/app.js` (page, capture loop).
