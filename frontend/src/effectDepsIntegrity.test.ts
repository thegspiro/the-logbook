/**
 * Effect dependency integrity
 *
 * `react-hooks/exhaustive-deps` is the only thing that keeps a hook's
 * dependency array in step with what the hook reads. Suppressing it and typing
 * the array by hand replaces a machine-checked list with a human-maintained
 * one — and a human-maintained mirror of a filter set drifts.
 *
 * That is not hypothetical. `InventoryItemsPage` suppressed the rule and hand
 * -listed six filters beside a `filterParams` callback that read eleven. The
 * five that went missing — location, size, colour, style and the vendor scope
 * — changed the request the page *would* send and never sent it, so those
 * controls did nothing at all until some unrelated reload applied a filter
 * nobody had touched since. It is what made the location panel impossible to
 * reconcile with the list beneath it, and it survived review because a
 * plausible-looking array of six names reads as deliberate.
 *
 * Most suppressions in this codebase are legitimate and stay that way: they
 * omit a *function identity* from a mount-only or single-key effect, where
 * there is no list to drift. What is banned is the long hand-maintained array
 * that is trying to be exhaustive — the shape that failed. Depend on a
 * `useCallback` whose own dependency array ESLint maintains, and key the hook
 * on that one identity instead:
 *
 *     const filterParams = useCallback(() => ({ ... }), [a, b, c, d, e, f]);
 *     useEffect(() => { void load(); }, [filterParams]);
 *
 * A filter added to `filterParams` then reaches the effect with no second list
 * to remember to update, which is the property the hand-written array lacked.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const DIRECTIVE = 'eslint-disable-next-line react-hooks/exhaustive-deps';

/**
 * The largest hand-maintained array allowed under a suppression.
 *
 * Set from the measured distribution rather than picked: across the tree the
 * legitimate suppressions run 0-4 entries (mount-only effects, route-param
 * keys, and a handful of genuine pairs and triples), and the one defect ran
 * eleven. Five leaves a slot of headroom above everything legitimate while
 * still catching the shape that broke. A hook that genuinely needs more inputs
 * than this is describing a derived value — give that value a name and a
 * checked dependency array of its own.
 */
const MAX_HAND_MAINTAINED_DEPS = 5;

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // e2e specs drive a real browser; they hold no React hooks.
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/**
 * The dependency array that the directive at `from` governs.
 *
 * Read as balanced brackets rather than by line, because the array is written
 * both inline (`}, [a, b]);`) and on a line of its own (a `useMemo`'s second
 * argument). Returns null when no array follows within a few lines — a
 * directive on something other than a dependency array, which this does not
 * police.
 */
const readDepsArray = (source: string, from: number): string | null => {
  const window = source.slice(from, from + 400);
  const open = window.indexOf('[');
  if (open === -1) return null;
  // Anything before the array that is not whitespace, a closing brace/paren or
  // a comma means the directive governs something else entirely.
  if (/[^\s})\],;]/.test(window.slice(0, open))) return null;

  let depth = 0;
  for (let i = open; i < window.length; i++) {
    const ch = window[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return window.slice(open + 1, i);
    }
  }
  return null;
};

/** Top-level entries, so `[a.b, f(c, d), e]` counts three rather than four. */
const countEntries = (deps: string): number => {
  const withoutComments = deps.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (withoutComments.trim() === '') return 0;

  let depth = 0;
  let entries = 1;
  for (const ch of withoutComments) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) entries++;
  }
  return entries;
};

interface Offender {
  file: string;
  line: number;
  count: number;
  deps: string;
}

const findOffenders = (): Offender[] => {
  const offenders: Offender[] = [];

  for (const file of collectSourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    let index = source.indexOf(DIRECTIVE);

    while (index !== -1) {
      const lineEnd = source.indexOf('\n', index);
      const deps = readDepsArray(source, lineEnd === -1 ? index + DIRECTIVE.length : lineEnd);

      if (deps !== null) {
        const count = countEntries(deps);
        if (count > MAX_HAND_MAINTAINED_DEPS) {
          offenders.push({
            file: path.relative(SRC, file),
            line: source.slice(0, index).split('\n').length,
            count,
            deps: deps.replace(/\s+/g, ' ').trim(),
          });
        }
      }

      index = source.indexOf(DIRECTIVE, index + DIRECTIVE.length);
    }
  }

  return offenders;
};

describe('effect dependency integrity', () => {
  it('scans the source tree', () => {
    expect(collectSourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it('finds the suppressions it is meant to be reading', () => {
    // Guards the parser, not the codebase: a rename of the directive, or a
    // readDepsArray that silently stops matching, would otherwise turn this
    // whole file into a test that passes because it inspects nothing.
    const seen = collectSourceFiles(SRC).filter((file) => fs.readFileSync(file, 'utf8').includes(DIRECTIVE));
    expect(seen.length).toBeGreaterThan(10);
  });

  it('reads a dependency array the way the source writes them', () => {
    // The detector, not the tree. A parser that quietly stopped matching would
    // leave the check below passing on an empty list of findings forever —
    // which is the failure mode a source-walking test is most prone to.
    const inline = `\n  }, [fCat, fStatus, fCond, fType, fLoc, fSize]);`;
    expect(countEntries(readDepsArray(inline, 0) ?? '')).toBe(6);

    // A `useMemo`'s array sits on its own line, after the callback's comma.
    const ownLine = `\n    [assignments]\n  );`;
    expect(countEntries(readDepsArray(ownLine, 0) ?? '')).toBe(1);

    // Member expressions and calls are one entry each, not one per identifier.
    const nested = `\n  }, [shift.shift_date, toKey(a, b), tz]);`;
    expect(countEntries(readDepsArray(nested, 0) ?? '')).toBe(3);

    expect(countEntries(readDepsArray(`\n  }, []);`, 0) ?? '')).toBe(0);

    // A directive governing something that is not a dependency array.
    expect(readDepsArray(`\n  const x = foo();\n`, 0)).toBeNull();
  });

  it('never hand-maintains a long dependency array under a suppression', () => {
    const report = findOffenders().map(
      (o) => `${o.file}:${o.line} — ${o.count} hand-maintained dependencies: [${o.deps}]`
    );

    expect(
      report,
      `A suppressed dependency array of more than ${MAX_HAND_MAINTAINED_DEPS} entries is a mirror of ` +
        'something else, and mirrors drift — this is exactly how five inventory filters came to do ' +
        'nothing. Move the inputs into a useCallback/useMemo whose dependency array ESLint maintains, ' +
        'and key the hook on that single identity instead.'
    ).toEqual([]);
  });
});
