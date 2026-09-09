import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Plus, Trash2, Users } from 'lucide-react';
import type { MembershipTier } from '../../types/user';

interface MembershipTiersSectionProps {
  tiers: MembershipTier[];
  autoAdvance: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  memberCount: (tierId: string) => number;
  onSetAutoAdvance: (value: boolean) => void;
  onUpdateTier: (tierId: string, changes: Partial<MembershipTier>) => void;
  onUpdateBenefits: (tierId: string, changes: Record<string, unknown>) => void;
  onAddTier: (name: string) => void;
  onRemoveTier: (tierId: string) => void;
  onMoveTier: (index: number, direction: 'up' | 'down') => void;
  onSave: () => void;
  onReset: () => void;
}

/**
 * The department's membership ladder.
 *
 * Fully controlled, like `RanksSettingsSection`, so the Members Administration
 * screen and the setup wizard render the same editor and `useTierEditor` is the
 * only thing that talks to the API.
 *
 * The screen states the consequences on the rung itself rather than in help
 * text somewhere else. Each tier's benefits decide who is in the ballot
 * electorate, who may stand for office and who is graded for training, and the
 * shipped ladder answers all three before anybody has looked at it — so the
 * answer has to be visible at the point of editing, not discovered at an
 * election.
 */
const MembershipTiersSection: React.FC<MembershipTiersSectionProps> = ({
  tiers,
  autoAdvance,
  loading,
  saving,
  dirty,
  memberCount,
  onSetAutoAdvance,
  onUpdateTier,
  onUpdateBenefits,
  onAddTier,
  onRemoveTier,
  onMoveTier,
  onSave,
  onReset,
}) => {
  const [newTierName, setNewTierName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex justify-center py-8" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="alert-warning">
        <div className="flex items-start">
          <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 mr-3 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-theme-alert-warning-title mb-1 font-semibold">This ladder decides who votes</p>
            <p className="text-theme-text-secondary text-sm">
              A tier&apos;s settings decide whether its members can vote in elections, whether they may hold office,
              whether they must meet a meeting-attendance threshold to vote, and whether they are graded for training.
              Set these to match your bylaws — the values we ship are a common arrangement, not a recommendation.
            </p>
          </div>
        </div>
      </div>

      <label className="border-theme-surface-border flex items-start gap-3 rounded-lg border p-4">
        <input
          type="checkbox"
          className="form-checkbox mt-0.5"
          checked={autoAdvance}
          onChange={(e) => onSetAutoAdvance(e.target.checked)}
        />
        <span>
          <span className="text-theme-text-primary block text-sm font-medium">
            Advance members automatically by years of service
          </span>
          <span className="text-theme-text-muted block text-sm">
            A nightly job promotes each member to the highest tier their years of service qualify them for. Turn this
            off if your department promotes by vote, by application, or on a date of its own choosing.
          </span>
        </span>
      </label>

      {tiers.length === 0 ? (
        <p className="text-theme-text-muted py-8 text-center text-sm">No tiers configured. Add the first one below.</p>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, index) => {
            const held = memberCount(tier.id);
            const isOpen = expanded === tier.id;
            return (
              <div key={tier.id} className="border-theme-surface-border rounded-lg border">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => onMoveTier(index, 'up')}
                      disabled={index === 0}
                      aria-label={`Move ${tier.name} up`}
                      className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveTier(index, 'down')}
                      disabled={index === tiers.length - 1}
                      aria-label={`Move ${tier.name} down`}
                      className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="min-w-[10rem] flex-1">
                    <label className="text-theme-text-muted mb-1 block text-xs font-medium" htmlFor={`name-${tier.id}`}>
                      Tier name
                    </label>
                    <input
                      id={`name-${tier.id}`}
                      type="text"
                      className="form-input"
                      value={tier.name}
                      onChange={(e) => onUpdateTier(tier.id, { name: e.target.value })}
                    />
                  </div>

                  <div className="w-32">
                    <label
                      className="text-theme-text-muted mb-1 block text-xs font-medium"
                      htmlFor={`years-${tier.id}`}
                    >
                      Years of service
                    </label>
                    <input
                      id={`years-${tier.id}`}
                      type="number"
                      min={0}
                      className="form-input"
                      value={tier.years_required}
                      onChange={(e) => onUpdateTier(tier.id, { years_required: Number(e.target.value) || 0 })}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {/* The count is what makes removal safe to offer: a rung
                        somebody is standing on cannot be taken away, and the
                        screen says why before the button is pressed. */}
                    <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {held} {held === 1 ? 'member' : 'members'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : tier.id)}
                      aria-expanded={isOpen}
                      className="text-theme-text-secondary hover:text-theme-text-primary rounded-md px-2 py-1 text-xs font-medium"
                    >
                      {isOpen ? 'Hide' : 'Rights'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveTier(tier.id)}
                      disabled={held > 0}
                      aria-label={`Remove ${tier.name}`}
                      title={held > 0 ? 'Members hold this tier. Move them to another tier first.' : undefined}
                      className="text-theme-accent-red p-1 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-theme-surface-border space-y-3 border-t p-4">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={tier.benefits.voting_eligible !== false}
                        onChange={(e) => onUpdateBenefits(tier.id, { voting_eligible: e.target.checked })}
                      />
                      <span className="text-theme-text-secondary text-sm">Can vote in elections</span>
                    </label>

                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={tier.benefits.can_hold_office !== false}
                        onChange={(e) => onUpdateBenefits(tier.id, { can_hold_office: e.target.checked })}
                      />
                      <span className="text-theme-text-secondary text-sm">Can hold elected office</span>
                    </label>

                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={tier.benefits.voting_requires_meeting_attendance === true}
                        onChange={(e) =>
                          onUpdateBenefits(tier.id, { voting_requires_meeting_attendance: e.target.checked })
                        }
                      />
                      <span className="text-theme-text-secondary text-sm">
                        Must meet a meeting-attendance threshold to vote
                      </span>
                    </label>

                    {tier.benefits.voting_requires_meeting_attendance === true && (
                      <div className="flex flex-wrap gap-3 pl-6">
                        <div className="w-32">
                          <label
                            className="text-theme-text-muted mb-1 block text-xs font-medium"
                            htmlFor={`pct-${tier.id}`}
                          >
                            Minimum %
                          </label>
                          <input
                            id={`pct-${tier.id}`}
                            type="number"
                            min={0}
                            max={100}
                            className="form-input"
                            value={tier.benefits.voting_min_attendance_pct ?? 0}
                            onChange={(e) =>
                              onUpdateBenefits(tier.id, { voting_min_attendance_pct: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="w-40">
                          <label
                            className="text-theme-text-muted mb-1 block text-xs font-medium"
                            htmlFor={`months-${tier.id}`}
                          >
                            Over the last (months)
                          </label>
                          <input
                            id={`months-${tier.id}`}
                            type="number"
                            min={1}
                            max={60}
                            className="form-input"
                            value={tier.benefits.voting_attendance_period_months ?? 12}
                            onChange={(e) =>
                              onUpdateBenefits(tier.id, {
                                voting_attendance_period_months: Number(e.target.value) || 12,
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={tier.benefits.training_exempt === true}
                        onChange={(e) => onUpdateBenefits(tier.id, { training_exempt: e.target.checked })}
                      />
                      <span className="text-theme-text-secondary text-sm">
                        Exempt from training requirements
                        <span className="text-theme-text-muted block text-xs">
                          These members stop being graded for compliance entirely.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-theme-surface-border flex flex-wrap items-end gap-2 border-t pt-4">
        <div className="min-w-[12rem] flex-1">
          <label className="text-theme-text-muted mb-1 block text-xs font-medium" htmlFor="new-tier-name">
            Add a tier
          </label>
          <input
            id="new-tier-name"
            type="text"
            className="form-input"
            placeholder="e.g. Life Member"
            value={newTierName}
            onChange={(e) => setNewTierName(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-info mobile-touch-target inline-flex items-center gap-1 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!newTierName.trim()}
          onClick={() => {
            onAddTier(newTierName);
            setNewTierName('');
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </button>
      </div>

      {dirty && (
        <div className="action-bar-safe flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary mobile-touch-target px-4 text-sm font-medium"
            onClick={onReset}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="btn-primary mobile-touch-target inline-flex items-center gap-1 px-4 text-sm font-medium"
            disabled={saving}
            onClick={onSave}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save tiers
          </button>
        </div>
      )}
    </div>
  );
};

export default MembershipTiersSection;
