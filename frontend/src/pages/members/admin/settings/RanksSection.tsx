/**
 * Operational Ranks — the department's rank ladder and which shift positions
 * each rung may fill.
 *
 * The ladder lived on the global settings screen, where its state, its six
 * handlers and its loader were threaded through `SettingsPage` alongside email
 * credentials and storage providers. That is why this file exists rather than a
 * `<RanksSettingsSection {...fifteenProps} />` at a new address: a section that
 * cannot be moved without moving fifteen props is a section that is not really
 * its own screen. `RanksSettingsSection` stays exactly as it was — it renders,
 * and this owns what it renders.
 *
 * No `SettingsPanelHead` here, unlike its sibling sections: `RanksSettingsSection`
 * renders its own heading and description, and the global settings page mounted
 * it directly for that reason. A wrapper head would show the title twice and put
 * a redundant level in the heading outline.
 *
 * **A failed load is not an empty ladder.** The version this replaces caught the
 * load error into `/* empty state shown *\/`, so an unreachable API rendered
 * "No ranks configured yet" — a department being told it has no rank structure
 * because a request failed. Every rung it does have is still in the database,
 * and members still hold them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ranksService } from '../../../../services/api';
import type { OperationalRankResponse, RankValidationIssue } from '../../../../services/api';
import { invalidateRanksCache } from '../../../../hooks/useRanks';
import RanksSettingsSection from '../../../../components/settings/RanksSettingsSection';

interface RankForm {
  rank_code: string;
  display_name: string;
}

const EMPTY_FORM: RankForm = { rank_code: '', display_name: '' };

const RanksSection: React.FC = () => {
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

  // Non-blocking on purpose: the validation call reports members whose rank
  // matches no configured rung. Its failure must not take the ladder down with
  // it, and an absent warning is not a claim that nothing is wrong.
  const fetchRankValidation = useCallback(async () => {
    try {
      const result = await ranksService.validateRanks();
      // Same reasoning, one call over: the issues list is rendered directly.
      setRankValidationIssues(Array.isArray(result?.issues) ? result.issues : []);
    } catch {
      setRankValidationIssues([]);
    }
  }, []);

  const fetchRanks = useCallback(async () => {
    setRanksLoading(true);
    try {
      invalidateRanksCache();
      const data = await ranksService.getRanks();
      // A 2xx is not a ladder. A gateway, a proxy error page or a changed
      // response shape all resolve rather than throw, and the section renders
      // rows straight from this array — so an object arriving here took the
      // whole page down through the ErrorBoundary rather than showing the
      // failure state three lines below, which is a worse answer than either.
      if (!Array.isArray(data)) throw new TypeError('rank list was not an array');
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

  const handleAddRank = async () => {
    if (!rankForm.rank_code.trim() || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      await ranksService.createRank({
        rank_code: rankForm.rank_code.trim().toLowerCase().replace(/\s+/g, '_'),
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
  };

  const handleUpdateRank = async () => {
    if (!editingRank || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      await ranksService.updateRank(editingRank.id, {
        rank_code: rankForm.rank_code.trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: rankForm.display_name.trim(),
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
  };

  const handleDeleteRank = async (rankId: string) => {
    setDeletingRankId(rankId);
    try {
      await ranksService.deleteRank(rankId);
      toast.success('Rank removed');
      await fetchRanks();
    } catch {
      toast.error('Failed to remove rank');
    } finally {
      setDeletingRankId(null);
    }
  };

  const handleMoveRank = async (index: number, direction: 'up' | 'down') => {
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
  };

  const handleToggleEligiblePosition = async (rank: OperationalRankResponse, position: string) => {
    const current = rank.eligible_positions ?? [];
    const updated = current.includes(position) ? current.filter((p) => p !== position) : [...current, position];
    try {
      await ranksService.updateRank(rank.id, { eligible_positions: updated });
      setRanks((prev) => prev.map((r) => (r.id === rank.id ? { ...r, eligible_positions: updated } : r)));
    } catch {
      toast.error('Failed to update eligible positions');
    }
  };

  return (
    <div className="space-y-6">
      {failed && !ranksLoading ? (
        <div className="alert-danger" role="alert">
          <p className="text-theme-text-primary text-sm font-medium">The rank ladder could not be loaded.</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Nothing has changed — the ranks below are not shown, not missing.
          </p>
          <button
            type="button"
            className="btn-secondary mobile-touch-target mt-3 px-4 text-sm font-medium"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <RanksSettingsSection
          ranks={ranks}
          ranksLoading={ranksLoading}
          editingRank={editingRank}
          addingRank={addingRank}
          rankForm={rankForm}
          rankSaving={rankSaving}
          deletingRankId={deletingRankId}
          editingPositionsRankId={editingPositionsRankId}
          rankValidationIssues={rankValidationIssues}
          onSetEditingRank={setEditingRank}
          onSetAddingRank={setAddingRank}
          onSetRankForm={setRankForm}
          onSetEditingPositionsRankId={setEditingPositionsRankId}
          onAddRank={() => {
            void handleAddRank();
          }}
          onUpdateRank={() => {
            void handleUpdateRank();
          }}
          onDeleteRank={(id) => {
            void handleDeleteRank(id);
          }}
          onMoveRank={(index, direction) => {
            void handleMoveRank(index, direction);
          }}
          onToggleEligiblePosition={(rank, pos) => {
            void handleToggleEligiblePosition(rank, pos);
          }}
        />
      )}
    </div>
  );
};

export default RanksSection;
