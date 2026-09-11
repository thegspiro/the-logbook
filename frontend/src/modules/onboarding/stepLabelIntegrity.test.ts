/**
 * No page hardcodes the name of the step it continues to.
 *
 * "Continue to Modules" on Ranks & Positions and "Continue to Module
 * Selection" on IT Contacts both survived the 2026-09-11 reorder unchanged,
 * so each button named a destination it no longer went to. Nothing failed:
 * the navigation was correct and only the promise on the button was wrong,
 * which is invisible to every test that clicks by role.
 *
 * `nextStepName` reads the same array the navigation does. This sweep stops
 * the literal form coming back.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ONBOARDING_STEPS } from './config/steps';

const PAGES_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url))), 'pages');

const pageSources = (): Array<{ file: string; text: string }> =>
  fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((file) => ({ file, text: fs.readFileSync(path.join(PAGES_DIR, file), 'utf8') }));

describe('next-step button labels', () => {
  it('name no step as a literal', () => {
    // "Module Selection" is the older wording for the Modules step and was one
    // of the two that drifted, so it is checked alongside the current names.
    const names = [...ONBOARDING_STEPS.map((s) => s.name), 'Module Selection', 'Modules'];
    const offenders: string[] = [];

    for (const { file, text } of pageSources()) {
      for (const name of names) {
        if (text.includes(`Continue to ${name}'`) || text.includes(`Continue to ${name}"`)) {
          offenders.push(`${file}: "Continue to ${name}"`);
        }
      }
    }

    // Deduped: a name can match both the step list and the legacy wording.
    expect([...new Set(offenders)], 'use `Continue to ${nextStepName(<key>)}` instead').toEqual([]);
  });
});
