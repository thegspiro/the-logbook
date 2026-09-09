/**
 * The shared rank editor's API behaviour.
 *
 * The interesting half is `allowCodeEdit`. A rank code is the runtime key the
 * backend resolves default permissions against, so the setup wizard does not
 * let a department change one: it is describing a ladder it already uses, and
 * a rank that quietly stops conferring permissions on day one is precisely the
 * accident setup should not be able to cause. These assert that the code is
 * left out of an update entirely rather than sent unchanged — the backend
 * enforces a grant ceiling on any code it is handed, and a rename cascades to
 * every member holding the old one, so "sends it but it happens to match" is a
 * different thing from "does not send it".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getRanks = vi.fn();
const createRank = vi.fn();
const updateRank = vi.fn();
const deleteRank = vi.fn();
const reorderRanks = vi.fn();
const validateRanks = vi.fn();

vi.mock('../services/api', () => ({
  ranksService: {
    getRanks: (...args: unknown[]) => getRanks(...args) as unknown,
    createRank: (...args: unknown[]) => createRank(...args) as unknown,
    updateRank: (...args: unknown[]) => updateRank(...args) as unknown,
    deleteRank: (...args: unknown[]) => deleteRank(...args) as unknown,
    reorderRanks: (...args: unknown[]) => reorderRanks(...args) as unknown,
    validateRanks: (...args: unknown[]) => validateRanks(...args) as unknown,
  },
}));

vi.mock('./useRanks', () => ({ invalidateRanksCache: vi.fn() }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

import { useRankEditor } from './useRankEditor';

const rank = (over: Partial<Record<string, unknown>> = {}) => ({
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

/** Each block installs the defaults it depends on; see CLAUDE.md pitfall 28. */
const installDefaults = () => {
  getRanks.mockReset();
  createRank.mockReset();
  updateRank.mockReset();
  deleteRank.mockReset();
  reorderRanks.mockReset();
  validateRanks.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  getRanks.mockResolvedValue([rank()]);
  createRank.mockResolvedValue(rank({ id: 'rank-2' }));
  updateRank.mockResolvedValue(rank());
  deleteRank.mockResolvedValue(undefined);
  reorderRanks.mockResolvedValue([rank()]);
  validateRanks.mockResolvedValue({ issues: [] });
};

describe('useRankEditor with code editing allowed', () => {
  beforeEach(installDefaults);

  it('sends the typed code when adding a rank', async () => {
    const { result } = renderHook(() => useRankEditor({ allowCodeEdit: true }));

    act(() => {
      result.current.setRankForm({ rank_code: 'Battalion Chief', display_name: 'Battalion Chief' });
    });
    await act(async () => {
      await result.current.handleAddRank();
    });

    expect(createRank).toHaveBeenCalledWith({
      rank_code: 'battalion_chief',
      display_name: 'Battalion Chief',
      sort_order: 0,
    });
  });

  it('sends the code on an update', async () => {
    const { result } = renderHook(() => useRankEditor({ allowCodeEdit: true }));

    act(() => {
      result.current.setEditingRank(rank());
      result.current.setRankForm({ rank_code: 'company_officer', display_name: 'Company Officer' });
    });
    await act(async () => {
      await result.current.handleUpdateRank();
    });

    expect(updateRank).toHaveBeenCalledWith('rank-1', {
      display_name: 'Company Officer',
      rank_code: 'company_officer',
    });
  });
});

describe('useRankEditor with code editing withheld', () => {
  beforeEach(installDefaults);

  it('derives a new rank code from its display name', async () => {
    const { result } = renderHook(() => useRankEditor({ allowCodeEdit: false }));

    act(() => {
      result.current.setRankForm({ rank_code: '', display_name: 'Battalion Chief' });
    });
    await act(async () => {
      await result.current.handleAddRank();
    });

    expect(createRank).toHaveBeenCalledWith({
      rank_code: 'battalion_chief',
      display_name: 'Battalion Chief',
      sort_order: 0,
    });
  });

  it('omits the code from an update rather than resending it', async () => {
    const { result } = renderHook(() => useRankEditor({ allowCodeEdit: false }));

    act(() => {
      result.current.setEditingRank(rank());
      result.current.setRankForm({ rank_code: 'captain', display_name: 'Company Officer' });
    });
    await act(async () => {
      await result.current.handleUpdateRank();
    });

    expect(updateRank).toHaveBeenCalledWith('rank-1', { display_name: 'Company Officer' });
  });
});

describe('useRankEditor loading and failures', () => {
  beforeEach(installDefaults);

  it('does not load on mount unless asked', async () => {
    renderHook(() => useRankEditor());
    expect(getRanks).not.toHaveBeenCalled();
  });

  it('loads on mount when autoLoad is set', async () => {
    const { result } = renderHook(() => useRankEditor({ autoLoad: true }));
    await waitFor(() => expect(result.current.ranks).toHaveLength(1));
    expect(getRanks).toHaveBeenCalled();
  });

  it("relays the backend's reason for refusing a delete", async () => {
    // The backend refuses to delete a rank members still hold and says how
    // many. A bare "Failed to remove rank" leaves the administrator with no
    // idea that reassigning those members is the way through.
    deleteRank.mockRejectedValueOnce({
      response: { data: { detail: "Cannot delete rank 'Captain' while it is assigned to 3 members." } },
    });
    const { result } = renderHook(() => useRankEditor());

    await act(async () => {
      await result.current.handleDeleteRank('rank-1');
    });

    expect(toastError).toHaveBeenCalledWith("Cannot delete rank 'Captain' while it is assigned to 3 members.");
  });

  it('refuses to add a rank with no display name', async () => {
    const { result } = renderHook(() => useRankEditor({ allowCodeEdit: false }));

    act(() => {
      result.current.setRankForm({ rank_code: '', display_name: '   ' });
    });
    await act(async () => {
      await result.current.handleAddRank();
    });

    expect(createRank).not.toHaveBeenCalled();
  });
});
