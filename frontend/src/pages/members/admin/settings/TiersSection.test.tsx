/**
 * The settings screen reports the same failures the setup wizard does.
 *
 * Both drive `useTierEditor`, and the refresh warning was added to the wizard
 * alone — so a save from here whose read-back failed showed stale member counts
 * with a success toast as the only account of it. The warning is shared rather
 * than written twice for exactly that reason, and this asserts the screen
 * renders it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getTierConfig = vi.fn();
const updateTierConfig = vi.fn();

vi.mock('../../../../services/api', () => ({
  memberStatusService: {
    getTierConfig: (...args: unknown[]) => getTierConfig(...args) as unknown,
    updateTierConfig: (...args: unknown[]) => updateTierConfig(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import TiersSection from './TiersSection';

const installDefaults = () => {
  getTierConfig.mockReset();
  updateTierConfig.mockReset();
  updateTierConfig.mockResolvedValue({});
  getTierConfig.mockResolvedValue({
    auto_advance: true,
    tiers: [
      { id: 'probationary', name: 'Probationary', years_required: 0, sort_order: 0, benefits: {} },
      { id: 'active', name: 'Active Member', years_required: 1, sort_order: 1, benefits: {} },
    ],
    member_counts: { active: 3 },
    is_saved: true,
  });
};

describe('TiersSection', () => {
  beforeEach(installDefaults);

  it('renders the stored ladder', async () => {
    render(<TiersSection />);

    expect(await screen.findByDisplayValue('Probationary')).toBeInTheDocument();
  });

  it('reports a failed load rather than an empty ladder', async () => {
    // An empty editor here invites building a ladder from scratch, and saving
    // that removes the rungs the roster is standing on.
    getTierConfig.mockRejectedValue(new Error('network'));
    render(<TiersSection />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('reports a save whose read-back failed, over a working editor', async () => {
    const user = userEvent.setup();
    render(<TiersSection />);
    const years = await screen.findByLabelText('Years of service', { selector: '#years-active' });

    await user.clear(years);
    await user.type(years, '2');
    getTierConfig.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: /save tiers/i }));

    expect(await screen.findByText(/could not be refreshed afterwards/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Active Member')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });
});
