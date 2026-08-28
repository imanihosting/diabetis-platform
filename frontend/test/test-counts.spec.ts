import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The white paper quotes how many tests this platform has. This checks it.
 *
 * That page is written for people evaluating the platform, and it makes
 * specific, checkable claims on purpose. The counts have gone stale twice —
 * once when the timezone work added tests and once when the post-meal work
 * did — and each time the page kept quoting the old numbers, which is a public
 * page making a false specific claim. Nothing enforced it. This does.
 *
 * It counts from source rather than by running the suites, because a frontend
 * test that shelled out to pytest and vitest would be slower than the suites
 * it was checking and would need both toolchains present.
 */

const REPO = join(__dirname, '..', '..');

function sourcesIn(dir: string, extension: string): string[] {
  return readdirSync(join(REPO, dir))
    .filter((f) => f.endsWith(extension))
    .map((f) => readFileSync(join(REPO, dir, f), 'utf8'));
}

/**
 * Vitest cases in a directory.
 *
 * `it.each` would make one declaration into many tests and break this count,
 * so its absence is asserted rather than assumed — a guard that silently
 * undercounts is worse than no guard.
 */
function countVitest(dir: string): number {
  const files = sourcesIn(dir, '.spec.ts');
  for (const source of files) {
    expect(
      /\b(it|test)\.each\b/.test(source),
      `${dir} uses it.each, which this count cannot see through`,
    ).toBe(false);
  }
  return files.reduce((n, s) => n + (s.match(/^\s*it\(/gm) ?? []).length, 0);
}

/**
 * Pytest cases in a directory, parametrized ones expanded.
 *
 * A `@pytest.mark.parametrize` over four values is four tests and one `def`.
 * Only the flat single-argument form is understood; anything else makes this
 * throw rather than quietly counting one, because the whole point is that the
 * number cannot drift without somebody noticing.
 */
function countPytest(dir: string): number {
  return sourcesIn(dir, '.py').reduce((total, source) => {
    const defs = (source.match(/^\s*def test_/gm) ?? []).length;

    const blocks = [
      ...source.matchAll(/@pytest\.mark\.parametrize\(\s*"[^"]+",\s*\[([^\]]*)\]/g),
    ];
    const declared = (source.match(/@pytest\.mark\.parametrize/g) ?? []).length;
    if (blocks.length !== declared) {
      throw new Error(
        `A parametrize in ${dir} is in a form this count does not understand. ` +
          'Teach it the new form rather than letting the number drift.',
      );
    }

    // Each block turns its one `def` into one test per case.
    const extra = blocks.reduce((n, block) => {
      const cases = block[1].split(',').filter((v) => v.trim().length > 0).length;
      return n + cases - 1;
    }, 0);

    return total + defs + extra;
  }, 0);
}

describe('the white paper quotes the real test counts', () => {
  /** Whitespace-flattened, because the claims wrap across lines in the JSX. */
  const page = readFileSync(
    join(REPO, 'frontend', 'src', 'app', 'white-paper', 'page.tsx'),
    'utf8',
  ).replace(/\s+/g, ' ');

  const claimed = (label: string): number => {
    const match = page.match(new RegExp(`(\\d+) ${label}`));
    if (!match) throw new Error(`The white paper no longer claims "${label}"`);
    return Number(match[1]);
  };

  it('counts the backend unit suite correctly', () => {
    expect(claimed('unit tests')).toBe(countVitest('backend/test'));
  });

  it('counts the integration suite correctly', () => {
    expect(claimed('integration tests')).toBe(countVitest('backend/test/integration'));
  });

  it('counts the engine suite correctly', () => {
    expect(claimed('engine tests')).toBe(countPytest('metabolic-engine/tests'));
  });
});
