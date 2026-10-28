/**
 * Things that must never end up in the repository.
 *
 * `data/media/` holds encrypted photographs and recordings, and — on a development
 * install — the key that decrypts them. It was not ignored when the wellness modules
 * first landed, so a `git add .` would have committed both the files and the means to
 * read them. This test is the guard.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const patterns = gitignore
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'));

describe('.gitignore', () => {
  it('ignores the private media directory', () => {
    expect(patterns).toContain('data/media/');
  });

  it('ignores the development media key wherever it sits', () => {
    expect(patterns).toContain('**/.media-key');
  });

  it('still ignores the database and local env files', () => {
    expect(patterns).toContain('data/*.db');
    expect(patterns).toContain('.env');
    expect(patterns).toContain('.env.local');
  });
});

describe('the served tree', () => {
  it('contains no media directory, because private files are never served statically', () => {
    expect(fs.existsSync(path.join(root, 'public', 'media'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'public', 'uploads'))).toBe(false);
  });

  it('contains no stray key material', () => {
    const entries = fs.readdirSync(path.join(root, 'public'), { recursive: true }) as string[];
    for (const entry of entries) {
      expect(entry).not.toMatch(/\.media-key$|\.pem$|\.key$|\.bin$/);
    }
  });
});

describe('the default media path', () => {
  it('is outside the served directory', async () => {
    const { mediaRoot } = await import('@/lib/media/crypto');
    const resolved = path.resolve(mediaRoot());
    const publicDir = path.resolve(root, 'public');
    expect(resolved.startsWith(publicDir)).toBe(false);
  });
});
