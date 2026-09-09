/**
 * The membership ladder, as the setup wizard shows it.
 *
 * The ladder decides who is in the ballot electorate and who is graded for
 * training, and until this section existed it had no screen anywhere — a
 * department got the shipped Probationary/Active/Senior/Life arrangement and
 * found out at its first election. These assert that setup is where it can be
 * stated, and that the two consequences a department most needs to see are on
 * the screen rather than in documentation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getTierConfig = vi.fn();
const updateTierConfig = vi.fn();

vi.mock('../../../services/api', () => ({
  memberStatusService: {
    getTierConfig: (...args: unknown[]) => getTierConfig(...args) as unknown,
    updateTierConfig: (...args: unknown[]) => updateTierConfig(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MembershipLadderSection from './MembershipLadderSection';

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
    member_counts: {},
  });
};

describe('MembershipLadderSection', () => {
  beforeEach(installDefaults);

  it('loads the department ladder', async () => {
    render(<MembershipLadderSection />);

    expect(await screen.findByDisplayValue('Probationary')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Active Member')).toBeInTheDocument();
  });

  it('says what the ladder decides, on the screen', async () => {
    render(<MembershipLadderSection />);
    await screen.findByDisplayValue('Probationary');

    expect(screen.getByText(/this ladder decides who votes/i)).toBeInTheDocument();
  });

  it('offers auto-advance as something a department can turn off', async () => {
    // It defaults on, and a monthly task acts on it. A department that promotes
    // by vote needs to be able to say so before the job runs.
    const user = userEvent.setup();
    render(<MembershipLadderSection />);
    await screen.findByDisplayValue('Probationary');

    const toggle = screen.getByRole('checkbox', { name: /advance members automatically/i });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
  });

  it('changes a tier and saves the whole ladder in one write', async () => {
    // The endpoint takes the config whole; a per-rung save would make a
    // half-applied ladder reachable, which is the state that quietly changes
    // who can vote.
    const user = userEvent.setup();
    render(<MembershipLadderSection />);
    const years = await screen.findByLabelText('Years of service', { selector: '#years-active' });

    await user.clear(years);
    await user.type(years, '2');
    await user.click(screen.getByRole('button', { name: /save tiers/i }));

    await waitFor(() => expect(updateTierConfig).toHaveBeenCalled());
    const sent = updateTierConfig.mock.calls[0]?.[0] as { tiers: { id: string; years_required: number }[] };
    expect(sent.tiers.find((t) => t.id === 'active')?.years_required).toBe(2);
  });

  it('reports a failed load rather than an empty ladder', async () => {
    getTierConfig.mockRejectedValue(new Error('network'));
    render(<MembershipLadderSection />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no tiers configured/i)).not.toBeInTheDocument();
  });
});

describe('the rung the System Owner is already on', () => {
  beforeEach(installDefaults);

  it('says it can be renamed but not removed while they hold it', async () => {
    // `register_user` leaves the owner on the column default
    // `membership_type='active'`, so that rung reports a holder and its remove
    // button is disabled for the whole of setup — with no control here for
    // moving them. The backend's guard is id-based, so renaming *is* allowed;
    // a disabled button with no explanation reads as a bug.
    render(<MembershipLadderSection />);

    expect(
      await screen.findByText(/can be renamed to whatever your bylaws call it but not removed/i)
    ).toBeInTheDocument();
  });

  it('names where removal becomes possible later', async () => {
    render(<MembershipLadderSection />);

    expect(await screen.findByText(/Members → Settings → Membership Tiers/i)).toBeInTheDocument();
  });
});
