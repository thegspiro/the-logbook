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
          <h3 className="text-lg font-semibold text-theme-text-primary">Operational Ranks</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Customize rank/position choices for your department. Higher ranks should appear first.
          </p>
        </div>
        {!addingRank && !editingRank && (
          <button
            type="button"
            onClick={() => { onSetAddingRank(true); onSetRankForm({ rank_code: '', display_name: '' }); }}
            className="btn-info font-medium gap-1.5 inline-flex items-center px-3 py-1.5 rounded-md text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Rank
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {(addingRank || editingRank) && (
        <div className="p-4 border border-theme-surface-border rounded-lg bg-theme-surface-secondary/50">
          <p className="text-sm font-medium text-theme-text-primary mb-3">
            {editingRank ? 'Edit Rank' : 'New Rank'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Display Name</label>
              <input
                type="text"
                value={rankForm.display_name}
                onChange={(e) => {
                  const display = e.target.value;
                  onSetRankForm(prev => ({
                    ...prev,
                    display_name: display,
                    ...(!editingRank ? { rank_code: display.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : {}),
                  }));
                }}
                placeholder="e.g. Captain"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Code (internal identifier)</label>
              <input
                type="text"
                value={rankForm.rank_code}
                onChange={(e) => onSetRankForm(prev => ({ ...prev, rank_code: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))}
                placeholder="e.g. captain"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => { onSetEditingRank(null); onSetAddingRank(false); onSetRankForm({ rank_code: '', display_name: '' }); }}
              className="inline-flex items-center gap-1 rounded-md border border-theme-surface-border px-3 py-1.5 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={editingRank ? onUpdateRank : onAddRank}
              disabled={rankSaving || !rankForm.display_name.trim() || !rankForm.rank_code.trim()}
              className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-1 inline-flex items-center px-3 py-1.5 rounded-md text-sm"
            >
              {rankSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editingRank ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Rank list */}
      {ranksLoading ? (
        <div className="flex justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
        </div>
      ) : ranks.length === 0 ? (
        <p className="text-sm text-theme-text-muted text-center py-8">
          No ranks configured. Click &quot;Add Rank&quot; to get started.
        </p>
      ) : (
        <div className="space-y-1">
          {ranks.map((rank, idx) => (
            <div
              key={rank.id}
              className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-theme-surface-secondary/50 transition-colors group"
            >
              <div className="flex flex-col shrink-0">
                <button type="button" onClick={() => { void onMoveRank(idx, 'up'); }} disabled={idx === 0} className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5" aria-label="Move up">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => { void onMoveRank(idx, 'down'); }} disabled={idx === ranks.length - 1} className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5" aria-label="Move down">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <GripVertical className="w-4 h-4 text-theme-text-muted/40 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-theme-text-primary">{rank.display_name}</p>
                  <p className="text-xs text-theme-text-muted">({rank.rank_code})</p>
                </div>
                {/* Eligible shift positions — display mode */}
                {editingPositionsRankId !== rank.id && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {(rank.eligible_positions ?? []).length > 0 ? (
                      <>
                        {(rank.eligible_positions ?? []).map((pos) => (
                          <span
                            key={pos}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-violet-500/15 text-violet-700 dark:text-violet-400 font-medium"
                          >
                            {POSITION_LABELS[pos] ?? pos}
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => onSetEditingPositionsRankId(rank.id)}
                          className="px-1.5 py-0.5 text-[10px] rounded text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted transition-colors"
                        >
                          Edit
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetEditingPositionsRankId(rank.id)}
                        className="text-[11px] text-theme-text-muted hover:text-theme-accent-blue transition-colors"
                      >
                        + Configure eligible positions
                      </button>
                    )}
                  </div>
                )}
                {/* Eligible shift positions — edit mode */}
                {editingPositionsRankId === rank.id && (
                  <div className="mt-1.5 p-2 bg-theme-surface-secondary/60 rounded-md border border-theme-surface-border">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-medium text-theme-text-secondary">Click to toggle eligible positions:</p>
                      <button
                        type="button"
                        onClick={() => onSetEditingPositionsRankId(null)}
                        className="text-[10px] text-theme-text-muted hover:text-theme-text-primary"
                      >
                        Done
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(['officer', 'driver', 'firefighter', 'ems', 'captain', 'lieutenant', 'probationary', 'volunteer', 'other'] as const).map((pos) => {
                        const isEligible = (rank.eligible_positions ?? []).includes(pos);
                        return (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => { void onToggleEligiblePosition(rank, pos); }}
                            className={`px-2 py-1 text-[11px] rounded-md font-medium transition-all ${
                              isEligible
                                ? 'bg-violet-600 text-white shadow-sm'
                                : 'bg-theme-surface border border-theme-surface-border text-theme-text-muted hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
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
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => { onSetEditingRank(rank); onSetAddingRank(false); onSetRankForm({ rank_code: rank.rank_code, display_name: rank.display_name }); }}
                  className="p-1.5 rounded-sm text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted"
                  aria-label={`Edit ${rank.display_name}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => { void onDeleteRank(rank.id); }}
                  disabled={deletingRankId === rank.id}
                  className="p-1.5 rounded-sm text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                  aria-label={`Delete ${rank.display_name}`}
                >
                  {deletingRankId === rank.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {rankValidationIssues.length} active member{rankValidationIssues.length !== 1 ? 's' : ''} with unrecognised rank{rankValidationIssues.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-theme-text-muted mt-1">
                The following members have a rank assigned that no longer matches any configured rank.
                Update their profile or re-add the missing rank to resolve.
              </p>
              <ul className="mt-3 space-y-1.5">
                {rankValidationIssues.map((issue) => (
                  <li key={issue.member_id} className="flex items-center gap-2 text-sm">
                    <span className="text-theme-text-primary font-medium">{issue.member_name}</span>
                    <span className="text-xs text-theme-text-muted">&mdash;</span>
                    <code className="text-xs bg-theme-surface-secondary px-1.5 py-0.5 rounded-sm text-amber-600 dark:text-amber-400">
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
