import React, { useEffect, useState } from 'react';
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
  /**
   * Told while `newTierName` holds something that has not been added.
   *
   * The field's value lives here, so it is in neither `dirty` nor the config a
   * Save would write — a caller that unmounts this section on a Continue would
   * discard it silently. Setup guards on it; the settings screen has no such
   * moment and does not pass one.
   */
  onPendingTierChange?: ((pending: boolean) => void) | undefined;
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
  onPendingTierChange,
  onSave,
  onReset,
}) => {
  const [newTierName, setNewTierName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const tierNamePending = newTierName.trim().length > 0;
  // Declared above the loading early-return, or the hook order changes between
  // renders. Reported on every change so a cleared field retracts the guard.
  useEffect(() => {
    onPendingTierChange?.(tierNamePending);
  }, [tierNamePending, onPendingTierChange]);

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

      {/* Everything a save would submit is sealed while the PUT is in flight.
          The endpoint takes the whole ladder in one write, so an edit made
          after Save is pressed is not part of what was sent — and the hook
          clears `dirty` when that write returns, which marked the newer draft
          clean and then let the read-back overwrite it. A native fieldset is
          what disables the whole region rather than twenty controls that each
          have to remember. */}
      <fieldset disabled={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
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
              {/* Monthly, not nightly: `membership_tier_advance` is registered
                with cron `0 8 1 * *`. Saying "nightly" would have a member
                sitting on the wrong tier — and so with the wrong voting and
                training treatment — for up to a month after their anniversary,
                with the screen insisting it had already happened. */}
              On the first of each month, a scheduled job promotes every member to the highest tier their years of
              service qualify them for — so someone reaching a threshold mid-month moves at the start of the next one.
              Turn this off if your department promotes by vote, by application, or on a date of its own choosing.
            </span>
          </span>
        </label>

        {tiers.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center text-sm">
            No tiers configured. Add the first one below.
          </p>
        ) : (
          <div className="space-y-2">
            {tiers.map((tier, index) => {
              const held = memberCount(tier.id);
              const isOpen = expanded === tier.id;
              return (
                <div key={tier.id} className="border-theme-surface-border rounded-lg border">
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    {/* Side by side on a phone, stacked on a laptop. Both arrows
                      carry the 44px phone minimum, and two stacked 44px buttons
                      would make every rung 88px tall on the width where the list
                      is longest. */}
                    <div className="flex shrink-0 flex-row md:flex-col">
                      <button
                        type="button"
                        onClick={() => onMoveTier(index, 'up')}
                        disabled={index === 0}
                        aria-label={`Move ${tier.name} up`}
                        className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveTier(index, 'down')}
                        disabled={index === tiers.length - 1}
                        aria-label={`Move ${tier.name} down`}
                        className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone p-0.5 disabled:cursor-not-allowed disabled:opacity-20"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="min-w-[10rem] flex-1">
                      <label
                        className="text-theme-text-muted mb-1 block text-xs font-medium"
                        htmlFor={`name-${tier.id}`}
                      >
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
                        className="text-theme-text-secondary hover:text-theme-text-primary touch-target-phone rounded-md px-2 py-1 text-xs font-medium"
                      >
                        {isOpen ? 'Hide' : 'Rights'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveTier(tier.id)}
                        disabled={held > 0}
                        aria-label={`Remove ${tier.name}`}
                        title={held > 0 ? 'Members hold this tier. Move them to another tier first.' : undefined}
                        className="text-theme-accent-red touch-target-phone p-1 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
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

                      {/* Stored, and read by nothing. No nomination or candidate
                        path in `election_service.py` consults
                        `can_hold_office`, so clearing it does not stop a member
                        being nominated or elected. CLAUDE.md pitfall #19 allows
                        exactly two responses to that — wire a reader, or say on
                        the control that it is not in effect — and wiring office
                        eligibility into the ballot is a change to elections,
                        not to this screen. Saying so is the honest half until
                        it is. Remove this note in the same change that adds the
                        reader. */}
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="form-checkbox mt-0.5"
                          checked={tier.benefits.can_hold_office !== false}
                          onChange={(e) => onUpdateBenefits(tier.id, { can_hold_office: e.target.checked })}
                        />
                        <span className="text-theme-text-secondary text-sm">
                          Can hold elected office
                          <span className="text-theme-alert-warning-title block text-xs font-medium">
                            Recorded, but not yet enforced — elections do not check this, so clearing it will not stop a
                            member being nominated. Screen candidates by hand until it does.
                          </span>
                        </span>
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

                      {/* `training_exempt_types` is a separate, narrower list that
                        `TrainingService.get_training_report` honours on its own:
                        a tier with `training_exempt: false` and a non-empty list
                        still has those requirement types counted as met. The
                        checkbox above reads unchecked in that state, so without
                        this an officer believes the tier is fully graded while
                        it is not — and toggling the box on and off again leaves
                        the list untouched. Shown rather than edited: adding a
                        type picker is a larger change than saying what is
                        already in effect. */}
                      {tier.benefits.training_exempt !== true &&
                        (tier.benefits.training_exempt_types?.length ?? 0) > 0 && (
                          <p className="alert-warning text-theme-text-secondary ml-6 text-xs">
                            Not fully exempt, but these requirement types are still counted as met for this tier:{' '}
                            <strong>{(tier.benefits.training_exempt_types ?? []).join(', ')}</strong>. This screen
                            cannot change that list yet.
                          </p>
                        )}
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
      </fieldset>

      {dirty && (
        <div className="action-bar-safe flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary mobile-touch-target px-4 text-sm font-medium"
            disabled={saving}
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
