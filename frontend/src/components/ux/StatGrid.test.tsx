import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatGrid } from './StatGrid';

const columnClasses = () => screen.getByTestId('stat-grid').className.split(/\s+/);

describe('StatGrid', () => {
  it('queries its own width rather than the viewport', () => {
    render(
      <StatGrid columns={4} role="region" aria-label="Totals">
        <div>a</div>
      </StatGrid>
    );
    expect(screen.getByRole('region', { name: 'Totals' })).toHaveClass('@container');
    expect(screen.getByTestId('stat-grid')).toHaveClass('@[44rem]:grid-cols-4');
    // A viewport breakpoint here is the bug this component replaced.
    expect(columnClasses().filter((c) => /^(sm|md|lg|xl):grid-cols/.test(c))).toEqual([]);
  });

  // A four-tile row must go 1 -> 2 -> 4; a three-column step would leave one
  // tile alone on the last row.
  it.each([
    [3, ['grid-cols-1', '@[34rem]:grid-cols-3'], ['grid-cols-2']],
    [4, ['grid-cols-1', '@[17rem]:grid-cols-2', '@[44rem]:grid-cols-4'], ['grid-cols-3']],
    [5, ['@[34rem]:grid-cols-3', '@[56rem]:grid-cols-5'], []],
    [6, ['@[34rem]:grid-cols-3', '@[66rem]:grid-cols-6'], []],
  ] as const)('steps a %i-tile row through the right column counts', (columns, present, absent) => {
    render(
      <StatGrid columns={columns}>
        <div>a</div>
      </StatGrid>
    );
    const classes = columnClasses();
    for (const c of present) expect(classes).toContain(c);
    for (const c of absent) expect(classes.filter((k) => k.endsWith(c))).toEqual([]);
  });

  it('keeps a landmark label and the caller’s spacing on the outer element', () => {
    render(
      <StatGrid columns={5} gap={4} className="mb-8" role="region" aria-label="Forms statistics">
        <div>a</div>
      </StatGrid>
    );
    expect(screen.getByRole('region', { name: 'Forms statistics' })).toHaveClass('mb-8');
    expect(screen.getByTestId('stat-grid')).toHaveClass('gap-4');
  });
});
