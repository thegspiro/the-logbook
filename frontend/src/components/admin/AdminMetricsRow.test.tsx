import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminMetricsRow } from './AdminMetricsRow';

describe('AdminMetricsRow', () => {
  // In a two-column row on a 320px phone, a single-line label was cut to
  // "TO CLOSE…" / "NEEDS AT…", leaving a number with no way to tell what it
  // counts. jsdom applies no stylesheet, so the clamp is asserted as a class.
  it('lets a metric label wrap to two lines instead of truncating it', () => {
    render(
      <AdminMetricsRow metrics={[{ key: 'to_close', label: 'To close out', value: '1', context: 'waiting 1 day' }]} />
    );
    const label = screen.getByText('To close out');
    expect(label).toHaveClass('line-clamp-2');
    expect(label).not.toHaveClass('truncate');
  });
});
