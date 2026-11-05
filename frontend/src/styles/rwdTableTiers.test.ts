import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const TIERS = [
  { cls: 'rwd-table-wide', width: '64rem' },
  { cls: 'rwd-table-xwide', width: '80rem' },
  { cls: 'rwd-table-2xwide', width: '96rem' },
];

const blockFor = (width: string): string => {
  const open = `@container rwd-table (width < ${width}) {`;
  const start = stylesheet.indexOf(open);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start + open.length - 1; i < stylesheet.length; i += 1) {
    if (stylesheet[i] === '{') depth += 1;
    if (stylesheet[i] === '}') depth -= 1;
    if (depth === 0) return stylesheet.slice(start + open.length, i);
  }
  return '';
};

/**
 * The container-query reflow tiers are three copies of one rule set, differing
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
