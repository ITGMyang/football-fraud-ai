// Keep the last few builds' bundles instead of pruning to just the current one.
//
// Content hashing exists so old and new can coexist. Deleting the previous bundle on
// every deploy throws that away: anyone holding the old HTML - a cached copy, an open
// tab, a browser back-navigation - asks for a file that no longer exists, the SPA
// fallback answers with HTML, the browser runs that HTML as JavaScript, and the page
// goes black. Retaining a couple of generations makes stale HTML harmless.

import fs from 'node:fs';
import path from 'node:path';

const BUILD_DIR = path.resolve('public/build');
const SHELLS = ['public/index.html', 'public/admin.html'];
const LEDGER = path.join(BUILD_DIR, 'generations.json');
const KEEP_GENERATIONS = 3;

function referencedFiles() {
  const names = new Set();
  for (const shell of SHELLS) {
    if (!fs.existsSync(shell)) continue;
    for (const match of fs.readFileSync(shell, 'utf8').matchAll(/\/build\/([A-Za-z0-9._-]+)/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function readLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    return Array.isArray(parsed.generations) ? parsed.generations : [];
  } catch {
    return [];
  }
}

const current = referencedFiles();
if (!current.length) {
  console.error('prune-build: no bundles referenced by the shells; refusing to touch public/build');
  process.exit(1);
}

// Rebuilding the same source must not push a generation, or a few no-op builds would
// evict every retained one.
const previous = readLedger().filter((generation) => generation.join('|') !== current.join('|'));
const generations = [current, ...previous].slice(0, KEEP_GENERATIONS);
const keep = new Set(generations.flat());

const removed = [];
for (const name of fs.readdirSync(BUILD_DIR)) {
  if (name === path.basename(LEDGER) || keep.has(name)) continue;
  fs.rmSync(path.join(BUILD_DIR, name));
  removed.push(name);
}

fs.writeFileSync(LEDGER, `${JSON.stringify({ keep: KEEP_GENERATIONS, generations }, null, 2)}\n`);

const retained = keep.size - current.length;
console.log(`prune-build: ${current.length} current, ${retained} retained from ${generations.length - 1} earlier build(s), ${removed.length} removed`);
if (removed.length) console.log(`  removed: ${removed.join(', ')}`);
