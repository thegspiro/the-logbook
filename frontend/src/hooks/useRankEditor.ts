import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ranksService } from '../services/api';
import type { OperationalRankResponse, RankValidationIssue } from '../services/api';
import { invalidateRanksCache } from './useRanks';

export interface RankForm {
  rank_code: string;
  display_name: string;
}

export interface UseRankEditorOptions {
  /**
   * Whether the department may edit a rank's code, or only its display name.
   *
   * A rank code is the runtime key `get_rank_default_permissions()` resolves
   * against, so changing it on a seeded rank silently stops that rank
   * conferring anything. Settings allows it — a chief renaming `fire_chief` is
   * making a considered change, and the backend enforces a grant ceiling on it.
   * The setup wizard does not: a department is describing the ladder it already
   * uses, and a rank that quietly stops granting permissions on day one is
   * exactly the kind of accident setup should not be able to cause.
   *
   * When false, adding a rank derives its code from the display name.
   */
  allowCodeEdit?: boolean;
  /** Load the rank list on mount. Off for hosts that load it themselves. */
  autoLoad?: boolean;
}

/**
 * The state and handlers behind the operational rank editor.
 *
 * `RanksSettingsSection` is fully controlled — every value and every callback
 * arrives as a prop — so the same editor renders in Settings and in the setup
 * wizard. This hook is the half that talks to the API, and lives here rather
 * than in either screen so the two cannot answer the same question differently:
 * a reorder that persists on one screen and not the other, or a delete that
 * refreshes one list and leaves the other stale, is the kind of divergence
 * two copies of these six handlers would eventually produce.
 */
export function useRankEditor(options: UseRankEditorOptions = {}) {
  const { allowCodeEdit = true, autoLoad = false } = options;

  const [ranks, setRanks] = useState<OperationalRankResponse[]>([]);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [editingRank, setEditingRank] = useState<OperationalRankResponse | null>(null);
  const [addingRank, setAddingRank] = useState(false);
  const [rankForm, setRankForm] = useState<RankForm>({ rank_code: '', display_name: '' });
  const [rankSaving, setRankSaving] = useState(false);
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null);
  const [editingPositionsRankId, setEditingPositionsRankId] = useState<string | null>(null);
  const [rankValidationIssues, setRankValidationIssues] = useState<RankValidationIssue[]>([]);

  const fetchRankValidation = useCallback(async () => {
    try {
      const result = await ranksService.validateRanks();
      setRankValidationIssues(result.issues);
    } catch {
      // Silently ignore – validation is non-blocking
    }
  }, []);

  const fetchRanks = useCallback(async () => {
    try {
      setRanksLoading(true);
      invalidateRanksCache();
      const data = await ranksService.getRanks();
      setRanks(data);
    } catch {
      /* empty state shown */
    } finally {
      setRanksLoading(false);
    }
    // Re-run validation whenever the rank list changes
    await fetchRankValidation();
  }, [fetchRankValidation]);

  useEffect(() => {
    if (autoLoad) void fetchRanks();
  }, [autoLoad, fetchRanks]);

  const codeFor = useCallback(
    (form: RankForm) => (allowCodeEdit ? form.rank_code : form.display_name).trim().toLowerCase().replace(/\s+/g, '_'),
    [allowCodeEdit]
  );

  const handleAddRank = useCallback(async () => {
    const code = codeFor(rankForm);
    if (!code || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      await ranksService.createRank({
        rank_code: code,
        display_name: rankForm.display_name.trim(),
        sort_order: ranks.length,
      });
      setRankForm({ rank_code: '', display_name: '' });
      setAddingRank(false);
      toast.success('Rank added');
      await fetchRanks();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to add rank');
    } finally {
      setRankSaving(false);
    }
  }, [codeFor, fetchRanks, rankForm, ranks.length]);

  const handleUpdateRank = useCallback(async () => {
    if (!editingRank || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      // Only send the code when the host allows editing it. Sending the
      // unchanged one is not harmless: the backend enforces its grant ceiling
      // on any code it is given, and a rename cascades to every member holding
      // the old code.
      await ranksService.updateRank(editingRank.id, {
        display_name: rankForm.display_name.trim(),
        ...(allowCodeEdit ? { rank_code: codeFor(rankForm) } : {}),
      });
      setEditingRank(null);
      setRankForm({ rank_code: '', display_name: '' });
      toast.success('Rank updated');
      await fetchRanks();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to update rank');
    } finally {
      setRankSaving(false);
    }
  }, [allowCodeEdit, codeFor, editingRank, fetchRanks, rankForm]);

  const handleDeleteRank = useCallback(
    async (rankId: string) => {
      setDeletingRankId(rankId);
      try {
        await ranksService.deleteRank(rankId);
        toast.success('Rank removed');
        await fetchRanks();
      } catch (err: unknown) {
        // The backend refuses to delete a rank members still hold, and names
        // how many. A bare "Failed to remove rank" leaves the administrator
        // with no idea that reassigning those members is the way through.
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        toast.error(detail || 'Failed to remove rank');
      } finally {
        setDeletingRankId(null);
      }
    },
    [fetchRanks]
  );

  const handleMoveRank = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= ranks.length) return;
      const newRanks = [...ranks];
      const a = newRanks[index];
      const b = newRanks[swapIndex];
      if (a === undefined || b === undefined) return;
      [newRanks[index], newRanks[swapIndex]] = [b, a];
      const reorderPayload = newRanks.map((r, i) => ({ id: r.id, sort_order: i }));
      setRanks(newRanks);
      try {
        await ranksService.reorderRanks(reorderPayload);
      } catch {
        toast.error('Failed to reorder');
        await fetchRanks();
      }
    },
    [fetchRanks, ranks]
  );

  const handleToggleEligiblePosition = useCallback(async (rank: OperationalRankResponse, position: string) => {
    const current = rank.eligible_positions ?? [];
    const updated = current.includes(position) ? current.filter((p) => p !== position) : [...current, position];
    try {
      await ranksService.updateRank(rank.id, { eligible_positions: updated });
      setRanks((prev) => prev.map((r) => (r.id === rank.id ? { ...r, eligible_positions: updated } : r)));
    } catch {
      toast.error('Failed to update eligible positions');
    }
  }, []);

  return {
    ranks,
    setRanks,
    ranksLoading,
    editingRank,
    setEditingRank,
    addingRank,
    setAddingRank,
    rankForm,
    setRankForm,
    rankSaving,
    deletingRankId,
    editingPositionsRankId,
    setEditingPositionsRankId,
    rankValidationIssues,
    fetchRanks,
    handleAddRank,
    handleUpdateRank,
    handleDeleteRank,
    handleMoveRank,
    handleToggleEligiblePosition,
  };
}
