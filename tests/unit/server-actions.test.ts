/**
 * Every exported `'use server'` function is a callable POST endpoint.
 *
 * One no UI invokes is reachable surface with no UI contract, and therefore nothing
 * end-to-end exercises its validation. That is not a hole — all of them authenticate and
 * go through the ownership-checked services — but it is surface that should shrink, not
 * grow.
 *
 * So this is a baseline, deliberately: the known-unreachable set may get smaller as
 * actions are wired or removed, and a NEW unreachable action fails the suite. When you
 * wire or delete one, take it out of the list below.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);

const root = process.cwd();
const SEARCH_DIRS = ['app', 'components', 'lib', 'tests'];

/**
 * Pre-existing from the original build, before the wellness modules. Listed in
 * SECURITY.md. Removing working code from the original build is a separate decision
 * from adding the wellness modules, so these are recorded rather than deleted.
 */
const KNOWN_UNREACHABLE = [
  'startSessionAction',
  'toggleEquipmentAction',
  'recordBiometricAction',
  'markNotificationReadAction',
  'setRevisionStatusAction',
  'deleteGroceryListAction',
  'goToStep',
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const sources = SEARCH_DIRS.filter((d) => fs.existsSync(path.join(root, d)))
  .flatMap((d) => walk(path.join(root, d)))
  // This file names every known-unreachable action, so counting itself as a reference
  // would make the baseline vacuously pass.
  .filter((f) => path.resolve(f) !== selfPath);
const corpus = new Map(sources.map((f) => [f, fs.readFileSync(f, 'utf8')]));

interface ActionRef {
  file: string;
  name: string;
}

const actions: ActionRef[] = [];
for (const [file, text] of corpus) {
  if (!/^\s*'use server';/m.test(text)) continue;
  for (const m of text.matchAll(/export async function (\w+)/g)) {
    actions.push({ file: path.relative(root, file), name: m[1]! });
  }
}

/** Any mention of the name other than its own declaration. */
function isReferenced(name: string): boolean {
  const word = new RegExp(`\\b${name}\\b`);
  const decl = new RegExp(`export async function ${name}\\b`);
  for (const text of corpus.values()) {
    for (const line of text.split('\n')) {
      if (!word.test(line)) continue;
      if (decl.test(line)) continue;
      return true;
    }
  }
  return false;
}

const unreachable = actions.filter((a) => !isReferenced(a.name)).map((a) => a.name);

describe('exported server actions', () => {
  it('finds the actions at all, so a broken scan cannot pass silently', () => {
    expect(actions.length).toBeGreaterThan(100);
    expect(actions.some((a) => a.name === 'saveJournalEntryAction' || a.name === 'setConsentAction')).toBe(
      true,
    );
  });

  it('adds no new unreachable action', () => {
    const unexpected = unreachable.filter(
      (name) => !(KNOWN_UNREACHABLE as readonly string[]).includes(name),
    );
    expect(
      unexpected,
      `These exported server actions are callable endpoints that no UI invokes. Wire them to a control or delete them — do not add them to KNOWN_UNREACHABLE:\n  ${unexpected.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps the baseline honest: nothing listed as unreachable has quietly been wired', () => {
    // If this fails, the fix is to delete that name from KNOWN_UNREACHABLE — the list is
    // a record of what is still unwired, not a permanent allowance.
    const nowReachable = (KNOWN_UNREACHABLE as readonly string[]).filter(
      (name) => !unreachable.includes(name),
    );
    expect(
      nowReachable,
      `No longer unreachable — remove from KNOWN_UNREACHABLE: ${nowReachable.join(', ')}`,
    ).toEqual([]);
  });
});
