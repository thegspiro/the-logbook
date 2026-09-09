/**
 * The rank ladder, as the setup wizard shows it.
 *
 * Ranks used to be seeded lazily, the first time anyone loaded the rank list
 * after setup — and the seed only ever fires into an empty table, so whatever
 * it wrote on day one was what the department lived with. These assert the two
 * things that make editing it during setup safe rather than merely possible:
 * the department can say what it actually uses, and it cannot change a rank
 * code, which is the runtime key the backend resolves permissions against.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getRankLadder = vi.fn();
const createRank = vi.fn();
const updateRank = vi.fn();
const deleteRank = vi.fn();
const reorderRanks = vi.fn();
const validateRanks = vi.fn();

const updateUserProfile = vi.fn();

vi.mock('../../../services/api', () => ({
  userService: {
    updateUserProfile: (...args: unknown[]) => updateUserProfile(...args) as unknown,
  },
  ranksService: {
    getRanks: vi.fn(),
    getRankLadder: (...args: unknown[]) => getRankLadder(...args) as unknown,
    createRank: (...args: unknown[]) => createRank(...args) as unknown,
    updateRank: (...args: unknown[]) => updateRank(...args) as unknown,
    deleteRank: (...args: unknown[]) => deleteRank(...args) as unknown,
    reorderRanks: (...args: unknown[]) => reorderRanks(...args) as unknown,
    validateRanks: (...args: unknown[]) => validateRanks(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useRanks', () => ({ invalidateRanksCache: vi.fn() }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import RankLadderSection from './RankLadderSection';
import { useAuthStore } from '../../../stores/authStore';

const rank = (over: Record<string, unknown> = {}) => ({
  id: 'rank-1',
  organization_id: 'org-1',
  rank_code: 'captain',
  display_name: 'Captain',
  description: null,
  sort_order: 0,
  is_active: true,
  eligible_positions: ['officer'],
  default_permission_count: 12,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const installDefaults = () => {
  getRankLadder.mockReset();
  createRank.mockReset();
  updateRank.mockReset();
  deleteRank.mockReset();
  reorderRanks.mockReset();
  validateRanks.mockReset();
  updateUserProfile.mockReset();
  updateUserProfile.mockResolvedValue({});
  useAuthStore.setState({ user: null });
  getRankLadder.mockResolvedValue([
    rank(),
    rank({ id: 'rank-2', rank_code: 'firefighter', display_name: 'Firefighter' }),
  ]);
  createRank.mockResolvedValue(rank({ id: 'rank-3' }));
  updateRank.mockResolvedValue(rank());
  deleteRank.mockResolvedValue(undefined);
  reorderRanks.mockResolvedValue([]);
  validateRanks.mockResolvedValue({ issues: [] });
};

describe('RankLadderSection', () => {
  beforeEach(installDefaults);

  it('loads the department ladder on mount', async () => {
    render(<RankLadderSection />);

    expect(await screen.findByText('Captain')).toBeInTheDocument();
    expect(screen.getByText('Firefighter')).toBeInTheDocument();
  });

  it('does not offer the rank code field', async () => {
    // The code is the runtime key get_rank_default_permissions() resolves
    // against. Setup is the worst place to change one: there is no "before"
    // to notice the rank quietly conferring nothing against.
    const user = userEvent.setup();
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    await user.click(screen.getByRole('button', { name: /add rank/i }));

    expect(screen.getByText('Display Name')).toBeInTheDocument();
    expect(screen.queryByText(/code \(internal identifier\)/i)).not.toBeInTheDocument();
  });

  it('derives a code from the display name when a department adds its own rank', async () => {
    const user = userEvent.setup();
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    await user.click(screen.getByRole('button', { name: /add rank/i }));
    await user.type(screen.getByPlaceholderText('e.g. Captain'), 'Battalion Chief');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(createRank).toHaveBeenCalledWith({
        rank_code: 'battalion_chief',
        display_name: 'Battalion Chief',
        sort_order: 2,
      })
    );
  });

  it('renames a rank without touching its code', async () => {
    const user = userEvent.setup();
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    await user.click(screen.getByRole('button', { name: 'Edit Captain' }));
    const nameField = screen.getByPlaceholderText('e.g. Captain');
    await user.clear(nameField);
    await user.type(nameField, 'Company Officer');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateRank).toHaveBeenCalledWith('rank-1', { display_name: 'Company Officer' }));
  });

  it('does not claim that only positions grant access', async () => {
    // It used to. `_collect_user_permissions` unions
    // `get_rank_default_permissions(user.rank)` into a member's effective
    // grants, so the built-in ranks confer on their own — and an administrator
    // told otherwise could restrict a position believing the rank was inert,
    // while anyone holding it kept the chief-level defaults.
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    expect(screen.getByText(/the built-in ranks carry some too/i)).toBeInTheDocument();
    expect(screen.queryByText(/positions grant access/i)).not.toBeInTheDocument();
  });

  it('still says a rank the department adds itself grants nothing', async () => {
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    expect(screen.getByText(/a rank you add yourself carries none/i)).toBeInTheDocument();
  });

  it('does not offer a rank for the System Owner before there is one signed in', async () => {
    render(<RankLadderSection />);
    await screen.findByText('Captain');

    expect(screen.queryByLabelText('Your rank')).not.toBeInTheDocument();
  });
});

describe('RankLadderSection with the System Owner signed in', () => {
  beforeEach(() => {
    installDefaults();
    useAuthStore.setState({
      user: { id: 'user-1', rank: null } as never,
      loadUser: async () => undefined,
    });
  });

  it("offers the ladder as the System Owner's own rank", async () => {
    render(<RankLadderSection />);
    await screen.findByRole('button', { name: 'Edit Captain' });

    const picker = await screen.findByLabelText('Your rank');
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Firefighter' })).toBeInTheDocument();
  });

  it('writes the chosen rank through the profile endpoint', async () => {
    // Not a wizard-only path: the ordinary endpoint validates the code against
    // the department's own ladder and enforces the permission-grant ceiling,
    // and setup has no business skipping either.
    const user = userEvent.setup();
    render(<RankLadderSection />);
    await screen.findByRole('button', { name: 'Edit Captain' });

    await user.selectOptions(await screen.findByLabelText('Your rank'), 'captain');

    await waitFor(() => expect(updateUserProfile).toHaveBeenCalledWith('user-1', { rank: 'captain' }));
  });

  it('puts the previous choice back when the write is refused', async () => {
    updateUserProfile.mockRejectedValueOnce(new Error('nope'));
    const user = userEvent.setup();
    render(<RankLadderSection />);
    await screen.findByRole('button', { name: 'Edit Captain' });

    const picker = await screen.findByLabelText('Your rank');
    await user.selectOptions(picker, 'captain');

    await waitFor(() => expect(picker).toHaveValue(''));
  });
});
