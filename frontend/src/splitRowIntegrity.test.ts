/**
 * Split-row integrity
 *
 * A title-and-actions row was written as
 * `flex flex-col sm:flex-row sm:justify-between`. That switches to one row on
 * the SCREEN's width, but what decides whether the two sides fit is the ROW's:
 * from 768px the 256px sidebar is open, the aside keeps its width, and the
 * title is squeezed until it breaks a word per line beside its buttons. Ninety
 * rows were moved onto `split-row` / `split-row-main` / `split-row-aside`
 * (styles/index.css), which wrap the aside under the title once the row is too
 * narrow for both, and this keeps the old shape from coming back.
 *
 * A page title row uses `page-header` instead; it is the same shape with a
 * wider basis for the title.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Rows that keep the viewport-switched shape on purpose, keyed by file and a
 * fragment of the row's class string, with the reason. An entry that no longer
 * matches fails the run, so this list cannot outlive the rows it excuses.
 */
const ALLOWED: { file: string; classes: string; reason: string }[] = [
  {
    file: 'modules/inventory/pages/InventorySetupPage.tsx',
    classes: 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
    reason:
      'wizard footer: three controls with a documented reading order (Continue first on a phone) set by order-*, which a wrapping row would scramble',
  },
  {
    file: 'components/CalendarView.tsx',
    classes: 'flex flex-col gap-2 md:flex-row md:items-center md:justify-between',
    reason: 'month navigator: a full-width grid on a phone, and a month name beside "Today" cannot crowd the row',
  },
];

/** A class string: the contents of a "…", '…' or `…` literal on one line. */
const CLASS_STRING = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;

/** Whether a class string stacks on phones and splits into a spaced-apart row at a width breakpoint. */
const isViewportSplitRow = (classes: string): boolean => {
  const tokens = new Set(classes.split(/\s+/));
  if (!tokens.has('flex-col')) return false;
  return ['sm', 'md', 'lg', 'xl'].some((bp) => tokens.has(`${bp}:flex-row`) && tokens.has(`${bp}:justify-between`));
};

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const findViewportSplitRows = (): { file: string; line: number; classes: string }[] => {
  const rows: { file: string; line: number; classes: string }[] = [];
  for (const file of collectSourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        for (const match of text.matchAll(CLASS_STRING)) {
          const classes = match[1] ?? match[2] ?? match[3] ?? '';
          if (isViewportSplitRow(classes)) rows.push({ file: rel, line: i + 1, classes });
        }
      });
  }
  return rows;
};

describe('split-row integrity', () => {
  const rows = findViewportSplitRows();
  const isAllowed = (row: { file: string; classes: string }) =>
    ALLOWED.some((entry) => entry.file === row.file && row.classes.includes(entry.classes));

  it('builds title-and-actions rows with split-row, not a viewport breakpoint', () => {
    const offenders = rows.filter((row) => !isAllowed(row)).map((row) => `${row.file}:${row.line}`);
    expect(
      offenders,
      'Use split-row / split-row-main / split-row-aside (or page-header for a page title) — a viewport breakpoint cannot see the sidebar, so the title is squeezed beside its actions on a tablet'
    ).toEqual([]);
  });

  it('allows only rows that still exist', () => {
    const stale = ALLOWED.filter(
      (entry) => !rows.some((row) => row.file === entry.file && row.classes.includes(entry.classes))
    ).map((entry) => entry.file);
    expect(stale, 'Remove ALLOWED entries whose row has been changed or deleted').toEqual([]);
  });

  it('detects the shape it exists to forbid', () => {
    expect(isViewportSplitRow('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')).toBe(true);
    expect(isViewportSplitRow('flex flex-col lg:flex-row lg:justify-between p-4')).toBe(true);
    expect(isViewportSplitRow('split-row gap-3 sm:items-center')).toBe(false);
    // A stacked column that merely goes horizontal, with no spacing apart, is a different layout.
    expect(isViewportSplitRow('flex flex-col gap-2 sm:flex-row')).toBe(false);
    // Breakpoints must agree: a row at sm spaced apart only at lg is not this shape.
    expect(isViewportSplitRow('flex flex-col sm:flex-row lg:justify-between')).toBe(false);
  });
});
