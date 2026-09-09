import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ranksService } from '../services/api';
import type { OperationalRankResponse, RankValidationIssue } from '../services/api';
import type { PositionOption } from '../modules/scheduling/types/shiftSettings';
import { ensureShiftSettingsLoaded } from '../modules/scheduling/services/shiftSettingsApi';
import { rankEligibleSeatOptions } from '../modules/scheduling/utils/positionLabels';
import { invalidateRanksCache } from './useRanks';

export interface RankForm {
  rank_code: string;
  display_name: string;
}

const EMPTY_FORM: RankForm = { rank_code: '', display_name: '' };

export interface UseRankEditorOptions {
  /**
   * Whether the department may edit a rank's code, or only its display name.
   *
   * A rank code is the runtime key `get_rank_default_permissions()` resolves
   * against, so changing it on a seeded rank silently stops that rank
   * conferring anything. Members Administration allows it — an officer
   * renaming `fire_chief` is making a considered change, and the backend
   * enforces a grant ceiling on it. The setup wizard does not: a department
   * there is describing the ladder it already uses, and there is no "before"
   * against which to notice a rank has quietly stopped granting permissions.
   *
   * When false, adding a rank derives its code from the display name, and an
   * update omits the code rather than resending an unchanged one — the backend
   * treats any code it is handed as a rename to cascade, so those are not the
   * same request.
   */
  allowCodeEdit?: boolean;
}

/**
 * The state and handlers behind the operational rank editor.
 *
 * `RanksSettingsSection` is fully controlled — every value and every callback
 * arrives as a prop — and two screens now render it: Members Administration,
 * where an officer maintains the ladder, and the setup wizard, where a
 * department describes the one it already uses. This hook is the half that
 * talks to the API, and lives here rather than in either screen so the two
 * cannot answer the same question differently: a reorder that persists on one
 * and not the other, or a delete that refreshes one list and leaves the other
 * stale, is what two copies of these six handlers would eventually produce.
 */
export function useRankEditor(options: UseRankEditorOptions = {}) {
  const { allowCodeEdit = true } = options;

  const [ranks, setRanks] = useState<OperationalRankResponse[]>([]);
  const [ranksLoading, setRanksLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [editingRank, setEditingRank] = useState<OperationalRankResponse | null>(null);
  const [addingRank, setAddingRank] = useState(false);
  const [rankForm, setRankForm] = useState<RankForm>(EMPTY_FORM);
  const [rankSaving, setRankSaving] = useState(false);
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null);
  const [editingPositionsRankId, setEditingPositionsRankId] = useState<string | null>(null);
  const [rankValidationIssues, setRankValidationIssues] = useState<RankValidationIssue[]>([]);
  // Seeded with the built-ins so the picker is never empty, then replaced once
  // shift settings land and the department's own seats are known.
  // `rankEligibleSeatOptions` reads a cache synchronously, so calling it during
  // render would show whatever had arrived by then and never re-render when the
  // rest did — a department's custom seat would appear or not depending on
  // whether another screen had already warmed the cache.
  const [seatOptions, setSeatOptions] = useState<PositionOption[]>(() => rankEligibleSeatOptions());

  useEffect(() => {
    let cancelled = false;
    // A failure leaves the built-in seats in place: they are correct, just not
    // complete, and a rank editor with no seats at all is worse than one
    // missing the department's own.
    void ensureShiftSettingsLoaded()
      .then(() => {
        if (!cancelled) setSeatOptions(rankEligibleSeatOptions());
      })
      .catch(() => {
        /* keep the built-ins */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Non-blocking on purpose: the validation call reports members whose rank
  // matches no configured rung. Its failure must not take the ladder down with
  // it, and an absent warning is not a claim that nothing is wrong.
  //
  // Which is why a failure leaves the last known issues on screen rather than
  // clearing them. This re-runs after every add, rename and delete, so clearing
  // would make the warning vanish the moment an officer touched anything —
  // reading as "you fixed it" when nothing had confirmed that, and at exactly
  // the moment they would believe it.
  const fetchRankValidation = useCallback(async () => {
    try {
      const result = await ranksService.validateRanks();
      setRankValidationIssues(Array.isArray(result?.issues) ? result.issues : []);
    } catch {
      /* keep the last answer; an unanswered check is not a clean one */
    }
  }, []);

  const fetchRanks = useCallback(async () => {
    setRanksLoading(true);
    try {
      invalidateRanksCache();
      // getRankLadder, not getRanks: the latter routes through `asArray`, which
      // turns a non-array body into `[]` — so a gateway or proxy error page
      // resolved successfully and rendered "no ranks configured", the exact
      // false-empty the failure state exists to prevent. Checking here instead
      // would have been dead code, because the swallow happens one layer down.
      const data = await ranksService.getRankLadder();
      setRanks(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRanksLoading(false);
    }
    await fetchRankValidation();
  }, [fetchRankValidation]);

  useEffect(() => {
    void fetchRanks();
  }, [fetchRanks, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

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
      setRankForm(EMPTY_FORM);
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
      await ranksService.updateRank(editingRank.id, {
        display_name: rankForm.display_name.trim(),
        ...(allowCodeEdit ? { rank_code: codeFor(rankForm) } : {}),
      });
      setEditingRank(null);
      setRankForm(EMPTY_FORM);
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
        // how many. A bare "Failed to remove rank" leaves the officer with no
        // idea that reassigning those members is the way through.
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
    ranksLoading,
    failed,
    retry,
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
    seatOptions,
    fetchRanks,
    handleAddRank,
    handleUpdateRank,
    handleDeleteRank,
    handleMoveRank,
    handleToggleEligiblePosition,
  };
}
