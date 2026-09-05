/**
 * The close-out settings mirror.
 *
 * The point of the file is the word "mirror": every value on it is a link to
 * the section that owns it, and nothing here writes. A second screen writing
 * the same settings object means whichever saved last silently reverts the
 * other, which is the failure that moved checklist timing to one home in
 * Inventory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../../test/utils';

const mockGetFeatureSettings = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getFeatureSettings: (...args: unknown[]) => mockGetFeatureSettings(...args) as unknown,
  },
}));

import CloseoutSettingsSummary from './CloseoutSettingsSummary';

describe('CloseoutSettingsSummary', () => {
  beforeEach(() => {
    mockGetFeatureSettings.mockReset();
    mockGetFeatureSettings.mockResolvedValue({
      require_end_of_shift_checks: true,
      open_ended_shift_cushion_hours: 12,
      call_tracking: { mode: 'count_only', call_types: [{ slug: 'fire', label: 'Fire' }] },
    });
  });

  it('shows the rules that govern close-out', async () => {
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByText('Block close-out')).toBeInTheDocument();
    expect(screen.getByText('A count at close-out')).toBeInTheDocument();
    expect(screen.getByText('12 hours')).toBeInTheDocument();
    expect(screen.getByText('1 configured')).toBeInTheDocument();
  });

  it('offers no control that writes — every value links to where it is edited', async () => {
    renderWithRouter(<CloseoutSettingsSummary />);
    await screen.findByText('Block close-out');

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Block close-out' })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/general'
    );
    expect(screen.getByRole('link', { name: 'Shift Reports section' })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/shift-reports'
    );
  });

  // A dash reads as "not loaded"; a fabricated default reads as a value
  // somebody chose, and an officer would act on it.
  it('shows a dash rather than a made-up default when the settings do not load', async () => {
    mockGetFeatureSettings.mockRejectedValue(new Error('nope'));
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByText('What close-out asks for')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Block close-out')).not.toBeInTheDocument();
  });
});
