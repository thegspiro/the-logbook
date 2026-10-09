import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminMetricsRow } from './AdminMetricsRow';

describe('AdminMetricsRow', () => {
  // In a two-column row on a 320px phone, a single-line label was cut to
  // "TO CLOSE…" / "NEEDS AT…", leaving a number with no way to tell what it
  // counts. jsdom applies no stylesheet, so the wrap is asserted as the
  // absence of the class that prevented it.
  it('lets a metric label wrap instead of truncating it', () => {
    render(
      <AdminMetricsRow
        metrics={[{ key: 'to_close', label: 'To close out', value: '1', context: 'waiting 1 day', fixed: false }]}
      />
    );
    const label = screen.getByText('To close out');
    expect(label).not.toHaveClass('truncate');
  });
});
