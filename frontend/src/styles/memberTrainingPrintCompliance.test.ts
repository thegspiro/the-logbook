import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ComplianceSummary } from '../types/training';
import { contrastRatio, hexToRgb, relativeLuminance } from '../utils/colorContrast';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');
const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The member training print page writes `member-training-print__compliance--<status>`
 * for whatever `compliance_status` the summary endpoint returns. A status with
 * no modifier prints in the base rule's amber, the at-risk colour: an exempt
 * member's record read as a warning (owner pick 2026-11-20). `satisfies`
 * fails the build when the union gains a value this list does not name.
 */
const STATUSES = {
  green: true,
  yellow: true,
  red: true,
  exempt: true,
  not_applicable: true,
} satisfies Record<ComplianceSummary['compliance_status'], true>;

/** The `color` of a rule whose selector list names the modifier as a whole token. */
const modifierColour = (status: string): string | undefined => {
  const name = `.member-training-print__compliance--${status}`;
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(name)) continue;
    const colour = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})\s*(?:;|$)/.exec(match[2] ?? '');
    if (colour) return colour[1];
  }
  return undefined;
};

const ratioOnWhite = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`not a hex colour: ${hex}`);
  return contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), 1);
};

describe('member training print compliance modifiers', () => {
  it.each(Object.keys(STATUSES))('has a modifier for %s', (status) => {
    expect(modifierColour(status)).toBeDefined();
  });

  it.each(Object.keys(STATUSES))('prints %s at 7:1 or better on the white sheet', (status) => {
    const colour = modifierColour(status) ?? '#ffffff';
    expect(ratioOnWhite(colour)).toBeGreaterThanOrEqual(7);
  });
});
