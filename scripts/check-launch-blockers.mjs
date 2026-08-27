#!/usr/bin/env node
/**
 * Fails while anything that must not reach a launch is still in the tree.
 *
 *   node scripts/check-launch-blockers.mjs
 *
 * Runs in CI on every push. It does not decide whether the product is ready;
 * it makes a specific, checkable class of mistake impossible — shipping a page
 * that tells a person `[LEGAL ENTITY]` is responsible for their health data.
 *
 * The placeholders are deliberate. Privacy and Terms were written with the
 * structure and the substance in place and the five facts nobody had yet left
 * as obvious blanks, which is more honest than inventing a company name and
 * far more honest than writing something vague enough to look filled in. The
 * risk of that approach is exactly one thing: that they ship as they are. This
 * is that risk, closed.
 *
 * Filling them in is not the same as legal review, and passing this check
 * proves nothing about whether a lawyer has read the result. See HANDOVER.md
 * §11.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every placeholder, and what has to be true before it can be removed.
 *
 * Named individually rather than matched with a `\[[A-Z ]+\]` pattern, so that
 * a new placeholder somebody invents is not silently covered by a regex nobody
 * revisits, and so the failure message can say what each one is waiting on.
 */
const PLACEHOLDERS = {
  '[LEGAL ENTITY]': 'the registered company that controls the data',
  '[JURISDICTION]': 'the governing law and the courts that hear a dispute',
  '[HOSTING PROVIDER]': 'who physically holds the records, named in the privacy policy',
  '[EMAIL PROVIDER]': 'the processor that handles account email',
  '[LIABILITY CAP]': 'the limit of liability, which a lawyer sets and not us',
};

const SEARCH_ROOTS = ['frontend/src', 'docs', 'README.md', 'PRODUCT.md'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.git']);

/** This file names every placeholder by definition, so it is never a finding. */
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

async function* walk(path) {
  const entries = await readdir(join(ROOT, path), { withFileTypes: true }).catch(() => null);
  if (!entries) {
    yield path; // A file rather than a directory.
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else yield child;
  }
}

const findings = [];

for (const root of SEARCH_ROOTS) {
  for await (const file of walk(root)) {
    if (file === SELF) continue;
    const text = await readFile(join(ROOT, file), 'utf8').catch(() => '');
    for (const [placeholder, waitingOn] of Object.entries(PLACEHOLDERS)) {
      if (!text.includes(placeholder)) continue;
      const line = text.slice(0, text.indexOf(placeholder)).split('\n').length;
      findings.push({ file, line, placeholder, waitingOn });
    }
  }
}

if (findings.length === 0) {
  console.log('No launch blockers in the tree.');
  process.exit(0);
}

console.error('Unfilled placeholders are still in user-facing pages:\n');
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.placeholder}`);
  console.error(`      needs: ${finding.waitingOn}\n`);
}
console.error(
  'These are launch blockers, not build errors. While they are here the pages\n' +
    'are honest about being unfinished, and this check exists so they cannot\n' +
    'quietly stop being either. Filling them in is not legal review — see\n' +
    'HANDOVER.md §11.',
);
process.exit(1);
