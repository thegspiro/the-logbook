import React from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';
import type { OperationalRankResponse, RankValidationIssue } from '../../services/api';
import { POSITION_LABELS } from '../../constants/enums';

interface RankForm {
  rank_code: string;
  display_name: string;
}

interface RanksSettingsSectionProps {
  ranks: OperationalRankResponse[];
  ranksLoading: boolean;
  editingRank: OperationalRankResponse | null;
  addingRank: boolean;
  rankForm: RankForm;
  rankSaving: boolean;
  deletingRankId: string | null;
  editingPositionsRankId: string | null;
  rankValidationIssues: RankValidationIssue[];
  onSetEditingRank: (rank: OperationalRankResponse | null) => void;
  onSetAddingRank: (adding: boolean) => void;
  onSetRankForm: React.Dispatch<React.SetStateAction<RankForm>>;
  onSetEditingPositionsRankId: (rankId: string | null) => void;
  onAddRank: () => void;
  onUpdateRank: () => void;
  onDeleteRank: (rankId: string) => void;
  onMoveRank: (index: number, direction: 'up' | 'down') => void;
  onToggleEligiblePosition: (rank: OperationalRankResponse, position: string) => void;
}

const RanksSettingsSection: React.FC<RanksSettingsSectionProps> = ({
  ranks,
  ranksLoading,
  editingRank,
  addingRank,
  rankForm,
  rankSaving,
  deletingRankId,
  editingPositionsRankId,
  rankValidationIssues,
  onSetEditingRank,
  onSetAddingRank,
  onSetRankForm,
  onSetEditingPositionsRankId,
  onAddRank,
  onUpdateRank,
  onDeleteRank,
  onMoveRank,
  onToggleEligiblePosition,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">Operational Ranks</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Customize rank/position choices for your department. Higher ranks should appear first.
          </p>
        </div>
        {!addingRank && !editingRank && (
          <button
            type="button"
            onClick={() => {
              onSetAddingRank(true);
              onSetRankForm({ rank_code: '', display_name: '' });
            }}
            className="btn-info inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Rank
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {(addingRank || editingRank) && (
        <div className="border-theme-surface-border bg-theme-surface-secondary/50 rounded-lg border p-4">
          <p className="text-theme-text-primary mb-3 text-sm font-medium">{editingRank ? 'Edit Rank' : 'New Rank'}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs font-medium">Display Name</label>
              <input
                type="text"
                value={rankForm.display_name}
                onChange={(e) => {
                  const display = e.target.value;
                  onSetRankForm((prev) => ({
                    ...prev,
                    display_name: display,
                    ...(!editingRank
                      ? {
                          rank_code: display
                            .toLowerCase()
                            .replace(/\s+/g, '_')
                            .replace(/[^a-z0-9_]/g, ''),
                        }
                      : {}),
                  }));
                }}
                placeholder="e.g. Captain"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                autoFocus
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs font-medium">Code (internal identifier)</label>
              <input
                type="text"
                value={rankForm.rank_code}
                onChange={(e) =>
                  onSetRankForm((prev) => ({
                    ...prev,
                    rank_code: e.target.value
                      .toLowerCase()
                      .replace(/\s+/g, '_')
                      .replace(/[^a-z0-9_]/g, ''),
                  }))
                }
                placeholder="e.g. captain"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                onSetEditingRank(null);
                onSetAddingRank(false);
                onSetRankForm({ rank_code: '', display_name: '' });
              }}
              className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={editingRank ? onUpdateRank : onAddRank}
              disabled={rankSaving || !rankForm.display_name.trim() || !rankForm.rank_code.trim()}
              className="btn-info inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rankSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {editingRank ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Rank list */}
      {ranksLoading ? (
        <div className="flex justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : ranks.length === 0 ? (
        <p className="text-theme-text-muted py-8 text-center text-sm">
          No ranks configured. Click &quot;Add Rank&quot; to get started.
        </p>
      ) : (
        <div className="space-y-1">
          {ranks.map((rank, idx) => (
            <div
              key={rank.id}
              className="hover:bg-theme-surface-secondary/50 group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => {
                    void onMoveRank(idx, 'up');
                  }}
                  disabled={idx === 0}
                  className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onMoveRank(idx, 'down');
                  }}
                  disabled={idx === ranks.length - 1}
                  className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <GripVertical className="text-theme-text-muted/40 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-theme-text-primary text-sm font-medium">{rank.display_name}</p>
                  <p className="text-theme-text-muted text-xs">({rank.rank_code})</p>
                </div>
                {/* Eligible shift positions — display mode */}
                {editingPositionsRankId !== rank.id && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {(rank.eligible_positions ?? []).length > 0 ? (
                      <>
                        {(rank.eligible_positions ?? []).map((pos) => (
                          <span
                            key={pos}
                            className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400"
                          >
                            {POSITION_LABELS[pos] ?? pos}
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => onSetEditingPositionsRankId(rank.id)}
                          className="text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted rounded px-1.5 py-0.5 text-[10px] transition-colors"
                        >
                          Edit
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetEditingPositionsRankId(rank.id)}
                        className="text-theme-text-muted hover:text-theme-accent-blue text-[11px] transition-colors"
                      >
                        + Configure eligible positions
                      </button>
                    )}
                  </div>
                )}
                {/* Eligible shift positions — edit mode */}
                {editingPositionsRankId === rank.id && (
                  <div className="bg-theme-surface-secondary/60 border-theme-surface-border mt-1.5 rounded-md border p-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-theme-text-secondary text-[11px] font-medium">
                        Click to toggle eligible positions:
                      </p>
                      <button
                        type="button"
                        onClick={() => onSetEditingPositionsRankId(null)}
                        className="text-theme-text-muted hover:text-theme-text-primary text-[10px]"
                      >
                        Done
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          'officer',
                          'driver',
                          'firefighter',
                          'ems',
                          'captain',
                          'lieutenant',
                          'probationary',
                          'volunteer',
                          'other',
                        ] as const
                      ).map((pos) => {
                        const isEligible = (rank.eligible_positions ?? []).includes(pos);
                        return (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => {
                              void onToggleEligiblePosition(rank, pos);
                            }}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                              isEligible
                                ? 'bg-violet-600 text-white shadow-sm'
                                : 'bg-theme-surface border-theme-surface-border text-theme-text-muted border hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
                            }`}
                          >
                            {POSITION_LABELS[pos] ?? pos}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    onSetEditingRank(rank);
                    onSetAddingRank(false);
                    onSetRankForm({ rank_code: rank.rank_code, display_name: rank.display_name });
                  }}
                  className="text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted rounded-sm p-1.5"
                  aria-label={`Edit ${rank.display_name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onDeleteRank(rank.id);
                  }}
                  disabled={deletingRankId === rank.id}
                  className="text-theme-text-muted rounded-sm p-1.5 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  aria-label={`Delete ${rank.display_name}`}
                >
                  {deletingRankId === rank.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rank validation issues */}
      {rankValidationIssues.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {rankValidationIssues.length} active member{rankValidationIssues.length !== 1 ? 's' : ''} with
                unrecognised rank{rankValidationIssues.length !== 1 ? 's' : ''}
              </p>
              <p className="text-theme-text-muted mt-1 text-xs">
                The following members have a rank assigned that no longer matches any configured rank. Update their
                profile or re-add the missing rank to resolve.
              </p>
              <ul className="mt-3 space-y-1.5">
                {rankValidationIssues.map((issue) => (
                  <li key={issue.member_id} className="flex items-center gap-2 text-sm">
                    <span className="text-theme-text-primary font-medium">{issue.member_name}</span>
                    <span className="text-theme-text-muted text-xs">&mdash;</span>
                    <code className="bg-theme-surface-secondary rounded-sm px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                      {issue.rank_code}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RanksSettingsSection;
