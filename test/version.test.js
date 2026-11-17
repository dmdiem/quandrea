import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Every file link carries ?v=N so browsers fetch new files after an update instead of mixing old
// and new. Bump N everywhere for each release; this checks they all match.
test("every file link has the same version", () => {
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const html = read("index.html");
  const versions = [
    ...html.matchAll(/(?:href|src)="(?:style\.css|src\/app\.js)\?v=(\w+)"/g),
    ...["src/app.js", "src/solver.js", "src/backup.js"].flatMap((f) => [...read(f).matchAll(/from "\.\/\w+\.js\?v=(\w+)"/g)]),
  ].map((m) => m[1]);
  assert.equal(versions.length, 9);
  assert.equal(new Set(versions).size, 1, `versions differ: ${versions.join(", ")}`);
  for (const f of ["src/app.js", "src/solver.js", "src/backup.js"]) assert.doesNotMatch(read(f), /from "\.\/\w+\.js"/, `${f} has an unversioned import`);
});
