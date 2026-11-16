/**
 * The event form and the training-event form write a required marker, a
 * field's refusal and the error banner in one red: FormField's own pair,
 * `FIELD_ERROR_CLASS` (red-800, red-300 in dark mode), which clears AAA on the
 * form's surfaces. red-700 / red-400 / red-500 do not, and red-500 on white is
 * under AA. Forms batch 17 moved the Create Training Session wizard onto that
 * pair; this keeps the form that replaced it there.
 *
 * Asserted against the source, in the manner of the repository's other
 * integrity tests: a colour is a class string, and a render test would have
 * to reach every branch to see each one.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = [join(__dirname, 'sections'), join(__dirname, '..', 'training-event'), __dirname];
const sources = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }))
);

const AAA_PAIR = new Set(['text-red-800', 'dark:text-red-300']);
/** An icon's size: an icon is decoration, not text, and keeps its own red. */
const ICON_SIZE = /\bh-\d+(\.\d+)?\s+w-\d+/;

describe('event form red text', () => {
  it('finds the form sources', () => {
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(['ScheduleSection.tsx', 'DetailsSection.tsx', 'TrainingEventWizard.tsx'])
    );
  });

  it('draws every red text on the AAA pair', () => {
    const offenders: string[] = [];
    for (const { file, source } of sources) {
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const classes = match[1] ?? match[2] ?? '';
        if (ICON_SIZE.test(classes)) continue;
        const reds = classes.split(/\s+/).filter((c) => /^(dark:)?text-red-\d+$/.test(c));
        if (reds.some((c) => !AAA_PAIR.has(c))) offenders.push(`${file}: ${reds.join(' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('draws every required marker as FormField does, hidden from screen readers', () => {
    const markers = sources.flatMap(({ file, source }) =>
      [...source.matchAll(/<span\b([^>]*)>\s*\*\s*<\/span>/g)].map((m) => ({ file, props: m[1] ?? '' }))
    );
    expect(markers.length).toBeGreaterThan(0);
    for (const { file, props } of markers) {
      expect(`${file}: ${props}`).toMatch(/className=\{FIELD_ERROR_CLASS\}/);
      expect(`${file}: ${props}`).toMatch(/aria-hidden="true"/);
    }
  });
});
