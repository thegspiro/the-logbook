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
import { useAuthStore } from '../../../stores/authStore';

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
  beforeEach(() => {
    installDefaults();
    useAuthStore.setState({ user: { membership_type: 'active' } as never });
  });

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

  it('names the rung the member actually holds, not a fixed position', async () => {
    // This editor reorders tiers, and a department that had already configured
    // a ladder may not have `active` in second place — or at all. Naming a
    // position would mark a removable rung as locked while the occupied one
    // sits elsewhere.
    useAuthStore.setState({ user: { membership_type: 'probationary' } as never });
    render(<MembershipLadderSection />);

    expect(await screen.findByText('Probationary')).toBeInTheDocument();
    expect(screen.queryByText(/second rung/i)).not.toBeInTheDocument();
  });

  it('says nothing when the member is on no rung of this ladder', async () => {
    // A legacy `membership_type` that is not one of these tiers. Pointing at a
    // rung would be a guess.
    useAuthStore.setState({ user: { membership_type: 'honorary' } as never });
    render(<MembershipLadderSection />);

    await screen.findByText(/This ladder decides who votes/i);
    expect(screen.queryByText(/can be renamed to whatever your bylaws call it/i)).not.toBeInTheDocument();
  });
});

describe('what the step is told while the ladder is still being read', () => {
  beforeEach(installDefaults);

  it('reports loading, so Continue does not read the not-yet-dirty ladder as clean', async () => {
    // The editor opens dirty only once the response says `is_saved: false`.
    // Until then `onDirtyChange` reports false, which is indistinguishable from
    // a stored ladder with nothing pending — and the step would let an
    // administrator leave without ever writing the synthesized one.
    let resolveConfig!: (config: unknown) => void;
    getTierConfig.mockImplementation(() => new Promise((resolve) => (resolveConfig = resolve)));
    const onLoadingChange = vi.fn();

    render(<MembershipLadderSection onLoadingChange={onLoadingChange} />);

    await waitFor(() => expect(onLoadingChange).toHaveBeenCalledWith(true));
    expect(onLoadingChange).not.toHaveBeenCalledWith(false);

    resolveConfig({ auto_advance: true, tiers: [], member_counts: {}, is_saved: false });
    await waitFor(() => expect(onLoadingChange).toHaveBeenLastCalledWith(false));
  });

  it('reports settled when the read fails, so the step is not a dead end', async () => {
    // The failure panel tells the administrator to carry on and set the tiers
    // up later. A step that refused to continue would contradict its own
    // instruction, behind a retry that may keep failing.
    getTierConfig.mockRejectedValue(new Error('network'));
    const onLoadingChange = vi.fn();

    render(<MembershipLadderSection onLoadingChange={onLoadingChange} />);

    await screen.findByText(/could not be loaded/i);
    // Waited for rather than asserted outright: the panel is rendered by the
    // commit that sets `failed` and clears `loading`, but the effect reporting
    // it upward flushes on a later tick — so `findByText` can resolve off the
    // MutationObserver with only `true` reported yet. That interleaving depends
    // on machine load, which is why this passed locally and failed in CI.
    await waitFor(() => expect(onLoadingChange).toHaveBeenLastCalledWith(false));
    expect(onLoadingChange).toHaveBeenCalledTimes(2);
  });
});

describe('a save whose refresh did not come back', () => {
  beforeEach(installDefaults);

  it('says so over a working editor, rather than hiding it or taking the editor away', async () => {
    // Three states are distinct here and were collapsed twice in review. The
    // write landed, so the load-failure panel ("nothing has changed") is untrue
    // and would remove the ladder just stored; saying nothing at all would
    // leave the success toast as the only account of a request that failed,
    // while stale member counts sit on screen looking authoritative.
    const user = userEvent.setup();
    render(<MembershipLadderSection />);
    const years = await screen.findByLabelText('Years of service', { selector: '#years-active' });

    await user.clear(years);
    await user.type(years, '3');
    getTierConfig.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: /save tiers/i }));

    expect(await screen.findByText(/could not be refreshed afterwards/i)).toBeInTheDocument();
    // The editor is still there, and the load-failure panel is not.
    expect(screen.getByDisplayValue('Active Member')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });
});

describe('the Refresh button beside the warning', () => {
  beforeEach(installDefaults);

  const saveThenFailTheRefresh = async (user: ReturnType<typeof userEvent.setup>) => {
    const years = await screen.findByLabelText('Years of service', { selector: '#years-active' });
    await user.clear(years);
    await user.type(years, '3');
    getTierConfig.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: /save tiers/i }));
    await screen.findByText(/could not be refreshed afterwards/i);
  };

  it('is offered while nothing is pending', async () => {
    const user = userEvent.setup();
    render(<MembershipLadderSection />);
    await saveThenFailTheRefresh(user);

    expect(screen.getByRole('button', { name: /^Refresh$/ })).toBeEnabled();
  });

  it('is withheld once there are edits it would discard', async () => {
    // The warning leaves the editor live, which is the point — but Refresh
    // replaces the whole configuration with the server's, so offering it beside
    // unsaved edits would throw them away without asking. Reset is the control
    // that means discard.
    const user = userEvent.setup();
    render(<MembershipLadderSection />);
    await saveThenFailTheRefresh(user);

    const years = screen.getByLabelText('Years of service', { selector: '#years-active' });
    await user.clear(years);
    await user.type(years, '5');

    expect(screen.getByRole('button', { name: /^Refresh$/ })).toBeDisabled();
    expect(screen.getByText(/refreshing would discard them/i)).toBeInTheDocument();
  });
});

describe('a tier name typed but not added', () => {
  beforeEach(installDefaults);

  it('is reported upward, so the step can refuse to unmount it', async () => {
    // `newTierName` lives inside MembershipTiersSection, so it is in neither
    // `dirty` nor the config a Save would write — the same silent loss the rank
    // form had, one field over.
    const user = userEvent.setup();
    const onPendingTierChange = vi.fn();
    render(<MembershipLadderSection onPendingTierChange={onPendingTierChange} />);
    await screen.findByDisplayValue('Probationary');

    await user.type(screen.getByLabelText(/add a tier/i), 'Cadet');

    await waitFor(() => expect(onPendingTierChange).toHaveBeenLastCalledWith(true));
  });

  it('retracts the report when the field is cleared', async () => {
    const user = userEvent.setup();
    const onPendingTierChange = vi.fn();
    render(<MembershipLadderSection onPendingTierChange={onPendingTierChange} />);
    await screen.findByDisplayValue('Probationary');

    const field = screen.getByLabelText(/add a tier/i);
    await user.type(field, 'Cadet');
    await user.clear(field);

    await waitFor(() => expect(onPendingTierChange).toHaveBeenLastCalledWith(false));
  });
});
