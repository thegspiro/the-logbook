/**
 * Election-wide voter rules: a meeting-attendance requirement and, per member
 * type, how long a member waits after becoming that type before they may vote.
 * Used for the department's defaults on Election Settings and for one
 * election's own copy of them on the election screen.
 *
 * A number that is not yet valid stays in its box and nothing is reported up
 * until it is — the same draft pattern the Max Proxies field uses (W50-49) —
 * so a half-typed "12" is never saved as "1".
 */

import React, { useState } from 'react';
import type { AttendanceRule, ElectionEligibilityRules, WaitingPeriod } from '../../../types/election';
import { AttendanceRuleMode, WaitingPeriodMode, type MemberVoterType } from '../../../constants/enums';
import { MEETING_TYPE_OPTIONS } from '../../minutes/utils/meetingTypes';
import { ATTENDANCE_RULE_STARTERS, ELIGIBILITY_BOUNDS, MEMBER_VOTER_TYPES } from '../eligibilityRules';

type NumberField = 'min_meetings' | 'of_last_meetings' | 'min_pct' | 'period_months';

const FIELD_LABELS: Record<NumberField, string> = {
  min_meetings: 'Meetings attended',
  of_last_meetings: 'Out of the last',
  min_pct: 'Minimum attendance (%)',
  period_months: 'Over the last (months)',
};

/** Months offered when a type is first given a timed wait. */
const DEFAULT_WAIT_MONTHS = 12;

interface EligibilityRulesEditorProps {
  value: ElectionEligibilityRules;
  onChange: (next: ElectionEligibilityRules) => void;
  /** Prefixes element ids so two editors on one page do not collide. */
  idPrefix: string;
  disabled?: boolean;
}

const parseBounded = (field: keyof typeof ELIGIBILITY_BOUNDS, raw: string): number | null => {
  const bounds = ELIGIBILITY_BOUNDS[field];
  const pattern = bounds.integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= bounds.min && value <= bounds.max ? value : null;
};

type Drafts = Partial<Record<NumberField, string>>;

/** Id suffix of the one error the two count boxes share. */
const COUNT_PAIR_ERROR = 'count-pair-error';

const withoutDrafts = (drafts: Drafts, ...fields: NumberField[]): Drafts =>
  Object.fromEntries(Object.entries(drafts).filter(([key]) => !fields.includes(key as NumberField)));

const savedNumber = (rules: ElectionEligibilityRules, field: NumberField): number | null | undefined =>
  rules.attendance[field];

export const EligibilityRulesEditor: React.FC<EligibilityRulesEditorProps> = ({
  value,
  onChange,
  idPrefix,
  disabled = false,
}) => {
  /** Box text that is not (yet) a valid value, keyed by field. */
  const [drafts, setDrafts] = useState<Drafts>({});
  /** Why the current drafts cannot be saved as a whole, when they each parse. */
  const [ruleError, setRuleError] = useState<string | null>(null);
  /** A waiting-period months box that is not (yet) a valid number, per type. */
  const [waitDrafts, setWaitDrafts] = useState<Partial<Record<MemberVoterType, string>>>({});

  const attendance = value.attendance;
  const id = (field: string) => `${idPrefix}-${field}`;

  const withAttendance = (patch: Partial<AttendanceRule>): ElectionEligibilityRules => ({
    ...value,
    attendance: { ...attendance, ...patch },
  });

  const setMode = (mode: AttendanceRule['mode']) => {
    setDrafts({});
    setRuleError(null);
    if (mode === AttendanceRuleMode.COUNT || mode === AttendanceRuleMode.PERCENT) {
      const starter = ATTENDANCE_RULE_STARTERS[mode];
      onChange(
        withAttendance({
          mode,
          ...Object.fromEntries(
            Object.entries(starter).map(([key, fallback]) => [key, attendance[key as keyof AttendanceRule] ?? fallback])
          ),
        })
      );
      return;
    }
    onChange(withAttendance({ mode }));
  };

  const setNumber = (field: NumberField, raw: string) => {
    const parsed = parseBounded(field, raw);
    if (parsed === null) {
      setDrafts((prev) => ({ ...prev, [field]: raw }));
      return;
    }
    const patch: Partial<AttendanceRule> = { [field]: parsed };
    // The count pair is judged together: a box held back only because the
    // other one disagreed is taken up once this one makes them agree.
    if (field === 'min_meetings' || field === 'of_last_meetings') {
      const other = field === 'min_meetings' ? 'of_last_meetings' : 'min_meetings';
      const otherDraft = drafts[other];
      const otherParsed = otherDraft === undefined ? null : parseBounded(other, otherDraft);
      if (otherParsed !== null) patch[other] = otherParsed;
    }
    const next = withAttendance(patch);
    const nextAtt = next.attendance;
    if (
      nextAtt.mode === AttendanceRuleMode.COUNT &&
      nextAtt.min_meetings != null &&
      nextAtt.of_last_meetings != null &&
      nextAtt.min_meetings > nextAtt.of_last_meetings
    ) {
      setDrafts((prev) => ({ ...prev, [field]: raw }));
      setRuleError('Meetings attended cannot be more than the meetings looked back over.');
      return;
    }
    // The other count box's draft goes too when it was saved with this one.
    const consumed: NumberField[] = (['min_meetings', 'of_last_meetings'] as const).filter(
      (key) => key !== field && patch[key] !== undefined
    );
    setDrafts((prev) => withoutDrafts(prev, field, ...consumed));
    setRuleError(null);
    onChange(next);
  };

  const numberInput = (field: NumberField, suffix?: string) => {
    const bounds = ELIGIBILITY_BOUNDS[field];
    const draft = drafts[field];
    const saved = savedNumber(value, field);
    // The count pair's disagreement is one error about two boxes, so it is
    // shown once under the row rather than inside whichever box was typed in
    // last — where it widened that column and pushed its partner aside.
    const pairError = ruleError !== null && (field === 'min_meetings' || field === 'of_last_meetings');
    const errorId = id(pairError ? COUNT_PAIR_ERROR : `${field}-error`);
    return (
      // Fixed width, so a range error wraps inside its own column.
      <div className="w-48">
        <label htmlFor={id(field)} className="form-label">
          {FIELD_LABELS[field]}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id(field)}
            type="number"
            inputMode={bounds.integer ? 'numeric' : 'decimal'}
            className="form-input w-28"
            min={bounds.min}
            max={bounds.max}
            step={bounds.integer ? 1 : 'any'}
            value={draft ?? (saved == null ? '' : String(saved))}
            onChange={(e) => setNumber(field, e.target.value)}
            disabled={disabled}
            aria-invalid={draft !== undefined}
            aria-describedby={draft !== undefined ? errorId : undefined}
          />
          {suffix && <span className="text-theme-text-secondary text-sm">{suffix}</span>}
        </div>
        {draft !== undefined && !pairError && (
          <p id={errorId} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
            {`Enter a ${bounds.integer ? 'whole number' : 'number'} from ${bounds.min} to ${bounds.max}.`}{' '}
            {saved == null ? 'Nothing is saved yet.' : `It is still saved as ${saved}.`}
          </p>
        )}
      </div>
    );
  };

  const waitingPeriods = value.waiting_periods ?? {};

  const setWaitingPeriod = (type: MemberVoterType, period: WaitingPeriod | null) => {
    const next = { ...waitingPeriods };
    // "No waiting period" is what a missing type means, so it is removed
    // rather than stored as a second spelling of the same rule.
    if (period === null) delete next[type];
    else next[type] = period;
    onChange({ ...value, waiting_periods: next });
  };

  const setWaitMode = (type: MemberVoterType, mode: WaitingPeriod['mode']) => {
    setWaitDrafts(({ [type]: _dropped, ...rest }) => rest);
    if (mode === WaitingPeriodMode.MONTHS) {
      setWaitingPeriod(type, { mode, months: waitingPeriods[type]?.months ?? DEFAULT_WAIT_MONTHS });
    } else if (mode === WaitingPeriodMode.NEVER) {
      setWaitingPeriod(type, { mode });
    } else {
      setWaitingPeriod(type, null);
    }
  };

  const setWaitMonths = (type: MemberVoterType, raw: string) => {
    const parsed = parseBounded('waiting_months', raw);
    if (parsed === null) {
      setWaitDrafts((prev) => ({ ...prev, [type]: raw }));
      return;
    }
    setWaitDrafts(({ [type]: _dropped, ...rest }) => rest);
    setWaitingPeriod(type, { mode: WaitingPeriodMode.MONTHS, months: parsed });
  };

  const selectedTypes = attendance.meeting_types ?? [];
  const toggleMeetingType = (type: string, checked: boolean) => {
    const next = checked ? [...selectedTypes, type] : selectedTypes.filter((t) => t !== type);
    // No type ticked means every meeting counts, never "none of them".
    onChange(withAttendance({ meeting_types: next.length > 0 ? next : null }));
  };

  return (
    <div className="space-y-6">
      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="text-theme-text-primary text-sm font-medium">Meeting attendance</legend>
        <div className="max-w-sm">
          <label htmlFor={id('attendance-mode')} className="form-label">
            Requirement
          </label>
          <select
            id={id('attendance-mode')}
            className="form-input"
            value={attendance.mode}
            onChange={(e) => setMode(e.target.value as AttendanceRule['mode'])}
          >
            <option value={AttendanceRuleMode.NONE}>No attendance requirement</option>
            <option value={AttendanceRuleMode.COUNT}>Attended a number of recent meetings</option>
            <option value={AttendanceRuleMode.PERCENT}>Attended a percentage of meetings</option>
          </select>
        </div>

        {attendance.mode === AttendanceRuleMode.COUNT && (
          <div>
            <div className="flex flex-wrap gap-4">
              {numberInput('min_meetings')}
              {numberInput('of_last_meetings', 'meetings')}
            </div>
            {ruleError !== null && (
              <p id={id(COUNT_PAIR_ERROR)} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                {ruleError} The saved rule is still {attendance.min_meetings ?? '?'} of the last{' '}
                {attendance.of_last_meetings ?? '?'}.
              </p>
            )}
          </div>
        )}
        {attendance.mode === AttendanceRuleMode.PERCENT && (
          <div className="flex flex-wrap gap-4">
            {numberInput('min_pct', '%')}
            {numberInput('period_months', 'months')}
          </div>
        )}

        {attendance.mode !== AttendanceRuleMode.NONE && (
          <>
            <div>
              <p className="text-theme-text-secondary text-sm">
                Meetings that count {selectedTypes.length === 0 && '(none ticked: every meeting counts)'}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {MEETING_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={selectedTypes.includes(opt.value)}
                      onChange={(e) => toggleMeetingType(opt.value, e.target.checked)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-theme-text-muted text-xs">
              Only meetings since the member&apos;s current period of membership began are counted. Waived meetings and
              meetings during a leave of absence are left out. A member who has had fewer meetings than the look-back is
              held to the same proportion (6 of 12 becomes 2 of 4).
            </p>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="text-theme-text-primary text-sm font-medium">Waiting period before a member may vote</legend>
        <p className="text-theme-text-muted text-xs">
          Counted from when the member became that type, and never from before their current period of membership.
          Administrative and social members follow their class whatever their status. A secretary can correct the start
          date or waive the wait for one member on their profile.
        </p>
        <ul className="divide-theme-surface-border divide-y">
          {MEMBER_VOTER_TYPES.map((type) => {
            const period = waitingPeriods[type.value];
            const mode = period?.mode ?? WaitingPeriodMode.NONE;
            const draft = waitDrafts[type.value];
            const errorId = id(`wait-${type.value}-error`);
            return (
              // Stacked on a phone; a row from `sm:` up.
              <li key={type.value} className="grid gap-2 py-2 sm:grid-cols-[13rem_1fr] sm:items-start">
                <label htmlFor={id(`wait-${type.value}`)} className="text-theme-text-primary pt-2 text-sm font-medium">
                  {type.label} members
                </label>
                <div className="flex flex-wrap items-start gap-3">
                  <select
                    id={id(`wait-${type.value}`)}
                    className="form-input w-auto"
                    value={mode}
                    onChange={(e) => setWaitMode(type.value, e.target.value as WaitingPeriod['mode'])}
                  >
                    <option value={WaitingPeriodMode.NONE}>No waiting period</option>
                    <option value={WaitingPeriodMode.MONTHS}>Wait a number of months</option>
                    <option value={WaitingPeriodMode.NEVER}>Never eligible to vote</option>
                  </select>
                  {mode === WaitingPeriodMode.MONTHS && (
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          aria-label={`${type.label} members: months to wait`}
                          className="form-input w-24"
                          min={ELIGIBILITY_BOUNDS.waiting_months.min}
                          max={ELIGIBILITY_BOUNDS.waiting_months.max}
                          step={1}
                          value={draft ?? String(period?.months ?? '')}
                          onChange={(e) => setWaitMonths(type.value, e.target.value)}
                          aria-invalid={draft !== undefined}
                          aria-describedby={draft !== undefined ? errorId : undefined}
                        />
                        <span className="text-theme-text-secondary text-sm">months</span>
                      </div>
                      {draft !== undefined && (
                        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                          Enter a whole number from {ELIGIBILITY_BOUNDS.waiting_months.min} to{' '}
                          {ELIGIBILITY_BOUNDS.waiting_months.max}. It is still saved as {period?.months}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
};

export default EligibilityRulesEditor;
