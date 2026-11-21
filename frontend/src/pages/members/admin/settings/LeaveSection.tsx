/**
 * Leave — the reminder before a leave of absence ends, and members' leave
 * requests: whether they are taken, who decides them and how.
 *
 * Saved as one object through `PUT /users/leaves-of-absence/settings`, which
 * wants `members.manage` — the hub's own grant, so a members officer can change
 * everything here. Every save is audited server-side.
 *
 * **A request left waiting reaches the Chief.** After the chosen number of days
 * (0 for never) the Chief is told once, or everyone who can record leave when
 * no Chief can open the request.
 *
 * **Who decides falls back rather than stalls.** A request goes to the chosen
 * positions; when nobody else holds them it goes to the Chief, then to everyone
 * who can record leave. The screen says so beside the picker, and marks a
 * chosen position nobody holds, so a vacancy is visible before a request waits
 * on it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../../../../components/settings/SettingsToggle';
import { leaveRequestService } from '../../../../services/leaveRequestService';
import {
  LeaveDecisionRule,
  type LeaveApproverPosition,
  type LeaveSettings,
  type LeaveDecisionRule as LeaveDecisionRuleValue,
} from '../../../../types/leaveRequest';

const DEFAULTS: LeaveSettings = {
  end_reminder_days: 7,
  end_reminder_copy_officers: true,
  requests_enabled: false,
  request_approver_position_ids: [],
  request_decision_rule: LeaveDecisionRule.ANY,
  request_escalation_days: 21,
};

const RULES: Array<{ value: LeaveDecisionRuleValue; label: string; help: string }> = [
  {
    value: LeaveDecisionRule.ANY,
    label: 'Any one approver',
    help: 'The first approver to approve or deny decides the request.',
  },
  {
    value: LeaveDecisionRule.MAJORITY,
    label: 'A majority of approvers',
    help: 'Approved once more than half of the current approvers approve; denied once that can no longer happen.',
  },
  {
    value: LeaveDecisionRule.ALL,
    label: 'Every approver',
    help: 'Approved only when every current approver approves; any one denial denies it.',
  },
];

const dayCount = (value: string, max = 60): number => Math.min(max, Math.max(0, parseInt(value, 10) || 0));

interface Props {
  /** The page's autosave — see the note in `ContactVisibilitySection`. */
  save: (saver: () => Promise<unknown>) => void;
  /** The page's debounced autosave, for the number field. */
  saveDebounced: (key: string, saver: () => Promise<unknown>) => void;
}

const LeaveSection: React.FC<Props> = ({ save, saveDebounced }) => {
  const [settings, setSettings] = useState<LeaveSettings>(DEFAULTS);
  const [positions, setPositions] = useState<LeaveApproverPosition[]>([]);
  const [loading, setLoading] = useState(true);
  // An unloaded page shows requests off and no approvers, which reads as a
  // department that has chosen exactly that.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<LeaveSettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const { available_positions, ...loaded } = await leaveRequestService.getSettings();
        if (cancelled) return;
        const next = { ...DEFAULTS, ...loaded };
        setSettings(next);
        ref.current = next;
        setPositions(Array.isArray(available_positions) ? available_positions : []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const update = (patch: Partial<LeaveSettings>, debounceKey?: string) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    // Read at fire time, so a debounced write persists the latest value.
    const write = () => leaveRequestService.updateSettings(ref.current);
    if (debounceKey) saveDebounced(debounceKey, write);
    else save(write);
  };

  const togglePosition = (id: string) => {
    const chosen = ref.current.request_approver_position_ids;
    update({
      request_approver_position_ids: chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id],
    });
  };

  const head = (
    <SettingsPanelHead
      title="Leave of Absence"
      description="The reminder before a leave ends, and whether members may ask for leave."
    />
  );

  if (failed) {
    return (
      <div>
        {head}
        <div
          className="alert-warning text-theme-alert-warning-text flex flex-wrap items-center gap-2 text-sm"
          role="alert"
        >
          <span className="min-w-0 flex-1">
            These settings did not load. Retry to see what your department has chosen.
          </span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const chosen = new Set(settings.request_approver_position_ids);
  const vacant = positions.filter((p) => chosen.has(p.id) && p.holder_count === 0);
  const missing = settings.request_approver_position_ids.filter((id) => !positions.some((p) => p.id === id));

  return (
    <div aria-busy={loading}>
      {head}

      <fieldset className="border-theme-surface-border mb-6 border-b pb-6">
        <legend className="text-theme-text-primary mb-3 text-sm font-semibold">Before a leave ends</legend>
        <label className="form-label" htmlFor="leave-end-reminder-days">
          Remind the member this many days ahead
        </label>
        <input
          id="leave-end-reminder-days"
          type="number"
          min={0}
          max={60}
          value={settings.end_reminder_days}
          disabled={loading}
          onChange={(e) => update({ end_reminder_days: dayCount(e.target.value) }, 'leave-end-reminder-days')}
          aria-describedby="leave-end-reminder-days-help"
          className="form-input w-24"
        />
        <p id="leave-end-reminder-days-help" className="text-theme-text-muted mt-1 text-xs">
          The member is emailed when their training requirements apply again. 0 sends no reminder.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Copy the officers who manage leave</p>
            <p className="text-theme-text-muted text-xs">
              Everyone who can record leave is told the same day which member is returning.
            </p>
          </div>
          <Toggle
            label="Copy the officers who manage leave"
            checked={settings.end_reminder_copy_officers}
            disabled={loading || settings.end_reminder_days === 0}
            onChange={() => update({ end_reminder_copy_officers: !settings.end_reminder_copy_officers })}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-theme-text-primary mb-3 text-sm font-semibold">Leave requests</legend>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Members may ask for leave</p>
            <p className="text-theme-text-muted text-xs">
              From Leave Requests in Members. An approved request becomes a leave, exactly as if an officer recorded it.
            </p>
          </div>
          <Toggle
            label="Members may ask for leave"
            checked={settings.requests_enabled}
            disabled={loading}
            onChange={() => update({ requests_enabled: !settings.requests_enabled })}
          />
        </div>

        {settings.requests_enabled && (
          <div className="mt-5 space-y-5">
            <div>
              <p className="form-label" id="leave-approvers-label">
                Who decides
              </p>
              <p className="text-theme-text-muted mb-2 text-xs">
                When no one else holds these positions, a request goes to the Chief, then to everyone who can record
                leave. A member never decides their own request.
              </p>
              {positions.length === 0 ? (
                <p className="text-theme-text-muted text-sm">This department has no positions yet.</p>
              ) : (
                <ul
                  className="border-theme-surface-border grid gap-1 rounded-md border p-2 sm:grid-cols-2"
                  aria-labelledby="leave-approvers-label"
                >
                  {positions.map((position) => (
                    <li key={position.id}>
                      <label className="touch-target-phone flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="form-checkbox"
                          checked={chosen.has(position.id)}
                          disabled={loading}
                          onChange={() => togglePosition(position.id)}
                        />
                        <span className="text-theme-text-primary">{position.name}</span>
                        <span className="text-theme-text-muted text-xs">
                          {position.holder_count === 0
                            ? 'vacant'
                            : `${position.holder_count} ${position.holder_count === 1 ? 'member' : 'members'}`}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {(vacant.length > 0 || missing.length > 0) && (
                <p className="alert-warning text-theme-alert-warning-text mt-2 text-xs" role="status">
                  {vacant.length > 0 && <>Nobody holds {vacant.map((p) => p.name).join(', ')}. </>}
                  {missing.length > 0 && <>A chosen position no longer exists. </>}
                  Requests fall back to the Chief while that is so.
                </p>
              )}
            </div>

            <fieldset>
              <legend className="form-label">How they decide</legend>
              <div className="space-y-2">
                {RULES.map((rule) => (
                  <label key={rule.value} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="leave-decision-rule"
                      className="mt-1"
                      value={rule.value}
                      checked={settings.request_decision_rule === rule.value}
                      disabled={loading}
                      onChange={() => update({ request_decision_rule: rule.value })}
                    />
                    <span>
                      <span className="text-theme-text-primary font-medium">{rule.label}</span>
                      <span className="text-theme-text-muted block text-xs">{rule.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-theme-text-muted mt-2 text-xs">
                A request keeps the rule it was made under, so changing this does not move the bar for requests already
                being decided.
              </p>
            </fieldset>

            <div>
              <label className="form-label" htmlFor="leave-escalation-days">
                Tell the Chief about a request still undecided after this many days
              </label>
              <input
                id="leave-escalation-days"
                type="number"
                min={0}
                max={180}
                value={settings.request_escalation_days}
                disabled={loading}
                onChange={(e) =>
                  update({ request_escalation_days: dayCount(e.target.value, 180) }, 'leave-escalation-days')
                }
                aria-describedby="leave-escalation-days-help"
                className="form-input w-24"
              />
              <p id="leave-escalation-days-help" className="text-theme-text-muted mt-1 text-xs">
                Sent once per request, by email and in the app. When the Chief cannot open requests, everyone who can
                record leave is told instead. 0 tells no one. Approvers are reminded three days in and weekly whatever
                this is set to.
              </p>
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
};

export default LeaveSection;
