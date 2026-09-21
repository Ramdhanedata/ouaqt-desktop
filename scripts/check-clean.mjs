/*
 * No past client may appear in this repository.
 *
 * Not in the code, the assets, the sample data, the tests or the history. The
 * apps here grew out of work done for named businesses, and a name left in a
 * variable, a logo left in a folder or a real menu left in a fixture would
 * ship one client's details to every other client.
 *
 *   npm run check:clean
 *
 * The names are held as hashes rather than as text, because a denylist
 * spelling them out would itself be the thing it is meant to prevent. The
 * check tokenises each file, hashes each token and looks for a match, so it
 * catches a name wherever it appears and in whatever case.
 *
 * When it fails it prints the file and the line and does not print the word.
 * A CI log is a public-ish place, and there is no reason to put the name
 * there in order to say it must not be there.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const FORBIDDEN = new Set([
  "6767ad0df88c4f85",
  "ea1c96cada5be95b",
  "8e15f0c17ede5a10",
  "9dfa3d238ccbb7cc",
  "9a838a7506d0ec8e",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "release",
  "out",
  ".vite",
  "vendor", // the website's app-ui, checked in its own repo
]);

/* Binaries are checked by name only: we cannot tokenise a PNG usefully. */
const TEXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".sql",
  ".css", ".html", ".yml", ".yaml", ".txt", ".sh",
]);

function hash(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function tokens(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const problems = [];

function checkName(path) {
  for (const token of tokens(relative(process.cwd(), path))) {
    if (FORBIDDEN.has(hash(token))) {
      problems.push({ file: relative(process.cwd(), path), line: 0, what: "the file name" });
    }
  }
}

function checkText(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const token of tokens(line)) {
      if (FORBIDDEN.has(hash(token))) {
        problems.push({
          file: relative(process.cwd(), path),
          line: index + 1,
          what: "a name from the list",
        });
        return;
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      checkName(path);
      walk(path);
      continue;
    }
    checkName(path);
    if (TEXT.has(extname(path))) checkText(path);
  }
}

walk(process.cwd());

if (problems.length === 0) {
  console.log("Clean: no past client appears in this repository.");
  process.exit(0);
}

console.error("\nA past client's name is in this repository:\n");
for (const problem of problems) {
  console.error(`  ${problem.file}${problem.line ? `:${problem.line}` : ""}  ${problem.what}`);
}
console.error(
  "\nRemove it. If it is in a commit that has been pushed, the history has to\n" +
    "be rewritten, not just the file.\n"
);
process.exit(1);
