import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const TIERS = [
  { cls: 'rwd-table-narrow', width: '32rem' },
  { cls: 'rwd-table-wide', width: '64rem' },
  { cls: 'rwd-table-xwide', width: '78rem' },
  { cls: 'rwd-table-2xwide', width: '96rem' },
];

const bodyOf = (open: string, from = 0): { start: number; body: string } => {
  const start = stylesheet.indexOf(open, from);
  if (start < 0) return { start, body: '' };
  let depth = 0;
  for (let i = start + open.length - 1; i < stylesheet.length; i += 1) {
    if (stylesheet[i] === '{') depth += 1;
    if (stylesheet[i] === '}') depth -= 1;
    if (depth === 0) return { start, body: stylesheet.slice(start + open.length, i) };
  }
  return { start, body: '' };
};

const blockFor = (width: string): string => bodyOf(`@container rwd-table (width < ${width}) {`).body;

/**
 * The container-query reflow tiers are four copies of one rule set, differing
 * only in the tier class and the width — CSS cannot vary an @container
 * condition per class. A fix made to one copy and not the others would leave
 * the same table reflowing differently depending on its tier, which nothing
 * else would catch: jsdom applies no container queries.
 */
describe('rwd-table container-query tiers', () => {
  it('declares the named container the tiers query', () => {
    expect(stylesheet).toMatch(/\.rwd-table-container \{\s*container:\s*rwd-table \/ inline-size;?\s*\}/);
  });

  it.each(TIERS)('has a $cls block under $width', ({ cls, width }) => {
    const body = blockFor(width);
    expect(body, `no @container rwd-table (width < ${width}) block`).not.toBe('');
    expect(body).toContain(`.rwd-table.${cls} thead`);
    expect(body).toMatch(/display:\s*none/);
  });

  // A container query also answers on paper, where a printed page is ~700px
  // wide: unguarded, every opted-in table would print as stacked cards.
  it('applies on screen only, so a printed table stays a table', () => {
    const screenBlocks: string[] = [];
    for (let from = 0; ;) {
      const { start, body } = bodyOf('@media screen {', from);
      if (start < 0) break;
      screenBlocks.push(body);
      from = start + 1;
    }
    for (const { width } of TIERS) {
      expect(
        screenBlocks.some((body) => body.includes(`@container rwd-table (width < ${width}) {`)),
        `the ${width} tier is not inside @media screen`
      ).toBe(true);
    }
  });

  // The base reflow reaches <tbody> only. In a tier, a <tfoot> totals row kept
  // its table layout once the body became cards and set the table's width on
  // its own, wider than the card the tier exists to fit.
  it.each(TIERS)('reflows $cls footer rows as well as body rows', ({ cls, width }) => {
    const body = blockFor(width);
    expect(body).toContain(`.rwd-table.${cls} :is(tbody, tfoot) tr`);
    expect(body).toContain(`.rwd-table.${cls} :is(tbody td, tfoot td, tfoot th)`);
  });

  it('keeps every tier identical apart from its class', () => {
    const [first, ...rest] = TIERS.map(({ cls, width }) => blockFor(width).split(cls).join('TIER').trim());
    for (const body of rest) expect(body).toBe(first);
  });

  it('scopes each tier to its own class only', () => {
    for (const { cls, width } of TIERS) {
      const others = TIERS.filter((t) => t.cls !== cls).map((t) => `.${t.cls} `);
      const body = blockFor(width);
      for (const other of others) expect(body).not.toContain(other);
    }
  });
});
