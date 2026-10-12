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

  // jsdom applies no stylesheet, so which cards a phone shows is asserted as
  // the class that hides a card below sm.
  describe('on a phone', () => {
    const metrics = [
      { key: 'a', label: 'Slot one', value: '1', context: '', fixed: false },
      { key: 'b', label: 'Slot two', value: '2', context: '', fixed: false },
      { key: 'c', label: 'Slot three', value: '3', context: '', fixed: false },
      { key: 'attention', label: 'Needs attention', value: '4', context: '', fixed: true },
    ];
    const card = (label: string) => screen.getByRole('group', { name: label });

    // The settings screen labels slots 1 and 2 "phone"; the row has to agree.
    it('shows the two phone slots and hides the third', () => {
      render(<AdminMetricsRow metrics={metrics} queueShown />);

      expect(card('Slot one')).not.toHaveClass('max-sm:hidden');
      expect(card('Slot two')).not.toHaveClass('max-sm:hidden');
      expect(card('Slot three')).toHaveClass('max-sm:hidden');
    });

    it('drops the attention count while the queue above it carries the same count', () => {
      render(<AdminMetricsRow metrics={metrics} queueShown />);

      expect(card('Needs attention')).toHaveClass('max-sm:hidden');
    });

    it('keeps the attention count when there is no queue to carry it', () => {
      render(<AdminMetricsRow metrics={metrics} queueShown={false} />);

      expect(card('Needs attention')).not.toHaveClass('max-sm:hidden');
    });
  });
});
