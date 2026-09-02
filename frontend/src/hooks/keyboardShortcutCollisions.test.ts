import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';

/**
 * Page-level shortcuts must not reuse a key the app-wide set already owns.
 *
 * `useNavigationShortcuts` is mounted in the layout and `useKeyboardShortcuts`
 * is called again by individual pages, and each attaches its *own* `keydown`
 * listener to `document`. Nothing arbitrates between them: both handlers run,
 * and the navigating one wins visibly. The testing checklist bound `n` to
 * "jump to the next untested page" while the global set binds `n` to
 * /notifications, so pressing it left the screen instead of moving down it.
 *
 * Read as source text rather than by importing the hooks: the keys are what
 * matter and a render would need a router, a store and a permission mock.
 */

const SRC = join(__dirname, '..');

const keysIn = (source: string, from: number, to: number): string[] =>
  [...source.slice(from, to).matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1] as string);

const hookSource = readFileSync(join(SRC, 'hooks/useKeyboardShortcuts.ts'), 'utf8');

const globalKeys = (): Set<string> => {
  const start = hookSource.indexOf('export function useNavigationShortcuts');
  expect(start).toBeGreaterThan(-1);
  return new Set(keysIn(hookSource, start, hookSource.length));
};

const pageRegistrations = (): Array<{ file: string; keys: string[] }> =>
  globSync('**/*.{ts,tsx}', { cwd: SRC })
    .filter((file) => !file.endsWith('hooks/useKeyboardShortcuts.ts'))
    .map((file) => ({ file, source: readFileSync(join(SRC, file), 'utf8') }))
    .filter(({ source }) => source.includes('useKeyboardShortcuts(['))
    .map(({ file, source }) => {
      const start = source.indexOf('useKeyboardShortcuts([');
      const end = source.indexOf(']);', start);
      return { file, keys: keysIn(source, start, end) };
    });

describe('keyboard shortcuts', () => {
  it('finds the app-wide set', () => {
    expect(globalKeys().has('n')).toBe(true);
  });

  it('finds at least one page-level registration to check', () => {
    expect(pageRegistrations().length).toBeGreaterThan(0);
  });

  it('gives no page a key the app-wide set already owns', () => {
    const owned = globalKeys();
    const collisions = pageRegistrations().flatMap(({ file, keys }) =>
      keys.filter((key) => owned.has(key)).map((key) => `${file}: '${key}'`)
    );

    expect(collisions).toEqual([]);
  });
});
