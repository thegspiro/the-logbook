/**
 * The membership tier editor's behaviour.
 *
 * This ladder decides who is in the ballot electorate, who may hold office and
 * who is graded for training, and a scheduled task advances members along it
 * unattended. The two things asserted hardest here are the ones that quietly
 * change who can vote: a failed load must not read as an empty ladder, and a
 * rung members are standing on must not be removable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getTierConfig = vi.fn();
const updateTierConfig = vi.fn();

vi.mock('../services/api', () => ({
  memberStatusService: {
    getTierConfig: (...args: unknown[]) => getTierConfig(...args) as unknown,
    updateTierConfig: (...args: unknown[]) => updateTierConfig(...args) as unknown,
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

import { useTierEditor } from './useTierEditor';

const config = (over: Record<string, unknown> = {}) => ({
  auto_advance: true,
  tiers: [
    {
      id: 'probationary',
      name: 'Probationary',
      years_required: 0,
      sort_order: 0,
      benefits: { voting_eligible: false },
    },
    { id: 'active', name: 'Active Member', years_required: 1, sort_order: 1, benefits: { voting_eligible: true } },
  ],
  member_counts: { active: 3 },
  ...over,
});

const installDefaults = () => {
  getTierConfig.mockReset();
  updateTierConfig.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  getTierConfig.mockResolvedValue(config());
  updateTierConfig.mockResolvedValue({});
};

const loaded = async () => {
  const { result } = renderHook(() => useTierEditor());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

describe('useTierEditor loading', () => {
  beforeEach(installDefaults);

  it('orders the ladder by sort_order, not by array position', async () => {
    // sort_order is what the backend climbs. A list rendered in array order
    // would show a ladder that disagrees with the one members advance along.
    getTierConfig.mockResolvedValue(
      config({
        tiers: [
          { id: 'life', name: 'Life', years_required: 20, sort_order: 3, benefits: {} },
          { id: 'active', name: 'Active', years_required: 1, sort_order: 1, benefits: {} },
        ],
      })
    );
    const result = await loaded();

    expect(result.current.tiers.map((t) => t.id)).toEqual(['active', 'life']);
  });

  it('reports a failed load rather than an empty ladder', async () => {
    // An empty editor invites building a ladder from scratch, and saving that
    // would remove the rungs the roster is standing on.
    getTierConfig.mockRejectedValue(new Error('network'));
    const result = await loaded();

    expect(result.current.failed).toBe(true);
    expect(result.current.tiers).toEqual([]);
  });
});

describe('useTierEditor editing', () => {
  beforeEach(installDefaults);

  it('renames a tier without touching its identifier', async () => {
    const result = await loaded();

    act(() => result.current.updateTier('active', { name: 'Regular Member' }));

    expect(result.current.tiers.find((t) => t.id === 'active')?.name).toBe('Regular Member');
    expect(result.current.tiers.map((t) => t.id)).toContain('active');
  });

  it('derives a new tier identifier from its name', async () => {
    const result = await loaded();

    act(() => result.current.addTier('Life Member'));

    const added = result.current.tiers.find((t) => t.name === 'Life Member');
    expect(added?.id).toBe('life_member');
    expect(added?.sort_order).toBe(2);
  });

  it('refuses a second tier with the same derived identifier', async () => {
    // "Active" derives `active`, which the ladder already has. Two rungs with
    // one id is a ladder whose readers disagree: get_tier_by_id returns the
    // first and resolve_tier the highest sort_order.
    const result = await loaded();

    act(() => result.current.addTier('Active'));

    expect(result.current.tiers.filter((t) => t.id === 'active')).toHaveLength(1);
    expect(toastError).toHaveBeenCalled();
  });

  it('renumbers sort_order when a tier moves', async () => {
    // Reordering the list without renumbering would change what is on screen
    // and nothing about who advances to what.
    const result = await loaded();

    act(() => result.current.moveTier(0, 'down'));

    expect(result.current.tiers.map((t) => [t.id, t.sort_order])).toEqual([
      ['active', 0],
      ['probationary', 1],
    ]);
  });

  it('turns auto-advance off', async () => {
    const result = await loaded();

    act(() => result.current.setAutoAdvance(false));

    expect(result.current.autoAdvance).toBe(false);
    expect(result.current.dirty).toBe(true);
  });
});

describe('useTierEditor removal', () => {
  beforeEach(installDefaults);

  it('refuses to remove a tier members hold, and says how many', async () => {
    const result = await loaded();

    act(() => result.current.removeTier('active'));

    expect(result.current.tiers.map((t) => t.id)).toContain('active');
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('3 members hold this tier'));
  });

  it('removes a tier nobody holds', async () => {
    const result = await loaded();

    act(() => result.current.removeTier('probationary'));

    expect(result.current.tiers.map((t) => t.id)).toEqual(['active']);
  });
});

describe('useTierEditor saving', () => {
  beforeEach(installDefaults);

  it('does not send the member counts back', async () => {
    // They are a report of the roster, not configuration; storing them would
    // persist a snapshot that is wrong the moment anybody joins.
    const result = await loaded();
    act(() => result.current.setAutoAdvance(false));

    await act(async () => {
      await result.current.save();
    });

    const sent = updateTierConfig.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toBeDefined();
    expect(sent).not.toHaveProperty('member_counts');
    expect(sent['auto_advance']).toBe(false);
  });

  it("relays the backend's reason for refusing a save", async () => {
    updateTierConfig.mockRejectedValueOnce({
      response: {
        data: { detail: "Cannot remove or rename a tier that members hold: 'senior' is held by 4 members." },
      },
    });
    const result = await loaded();

    await act(async () => {
      await result.current.save();
    });

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("'senior' is held by 4 members"));
  });

  it('reloads after a save so the counts are current', async () => {
    const result = await loaded();
    getTierConfig.mockClear();

    await act(async () => {
      await result.current.save();
    });

    expect(getTierConfig).toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });
});

describe('a save the refresh could not confirm', () => {
  beforeEach(installDefaults);

  it('stays clean, so the step is not left refusing an edit that was stored', async () => {
    // `fetchConfig` swallows its own failure, so a read that fails after an
    // accepted PUT used to leave `dirty` true. The section has by then swapped
    // its Save button for the failure panel, and `RoleSetup`'s Continue guard
    // goes on refusing — an administrator stranded on the step with no control
    // left that would clear it.
    const result = await loaded();
    act(() => result.current.setAutoAdvance(false));
    expect(result.current.dirty).toBe(true);
    getTierConfig.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await result.current.save();
    });

    expect(updateTierConfig).toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });

  it('keeps showing the ladder it just stored, rather than the load-failure panel', async () => {
    // That panel says "could not be loaded — nothing has changed", which after
    // an accepted PUT is untrue and contradicts the success toast raised a
    // moment earlier. The write landed; the ladder on screen is the stored one.
    const result = await loaded();
    act(() => result.current.setAutoAdvance(false));
    getTierConfig.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.failed).toBe(false);
    expect(result.current.tiers).toHaveLength(2);
    expect(result.current.config?.is_saved).toBe(true);
  });

  it('still reports a failed load that was not preceded by a save', async () => {
    // The narrowing is to the post-save refresh only. An ordinary read failure
    // must still reach the panel, or a department is told it has no ladder.
    getTierConfig.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTierEditor());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(true);
  });
});

describe('useTierEditor and a ladder that was never saved', () => {
  beforeEach(installDefaults);

  it('opens dirty when the backend synthesized the ladder', async () => {
    // `_load_tiers` reads the stored section, so a synthesized ladder is
    // proposed rather than in effect: nothing advances and no benefit applies
    // until it is saved. Presenting it as clean would show a department
    // settings that no reader honours.
    getTierConfig.mockResolvedValue(config({ is_saved: false }));
    const result = await loaded();

    expect(result.current.dirty).toBe(true);
  });

  it('opens clean when the ladder is stored', async () => {
    getTierConfig.mockResolvedValue(config({ is_saved: true }));
    const result = await loaded();

    expect(result.current.dirty).toBe(false);
  });

  it('opens clean when the backend does not say', async () => {
    // An older backend has no such field, and a missing answer must not be read
    // as "unsaved" — that would make every load dirty and every screen nag.
    const result = await loaded();

    expect(result.current.dirty).toBe(false);
  });

  it('does not send the saved-state flag back', async () => {
    // It is a statement about whether the section exists. Storing it would be
    // storing an answer about the storage.
    getTierConfig.mockResolvedValue(config({ is_saved: false }));
    const result = await loaded();

    await act(async () => {
      await result.current.save();
    });

    const sent = updateTierConfig.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('is_saved');
    expect(sent).not.toHaveProperty('member_counts');
  });
});
