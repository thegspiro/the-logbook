/**
 * Version 2 voter rules: one row per member type — whether they may vote, how
 * long they wait and from when, and the meeting-attendance rules they must
 * meet. Used for each meeting kind's defaults on Election Settings and for one
 * election's own copy on the election screen.
 *
 * A member is judged by the row for their status (or department tier) and,
 * when administrative or social, by their class row as well; the class rows
 * say so. A number that is not yet valid stays in its box and nothing is
 * reported up until it is, as in `EligibilityRulesEditor`.
 */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AttendanceRule, ElectionEligibilityRules, TypeRule, VoterRow } from '../../../types/election';
import { AttendanceRuleMode, WaitCountedFrom } from '../../../constants/enums';
import { MEETING_TYPE_OPTIONS } from '../../minutes/utils/meetingTypes';
import { ATTENDANCE_RULE_STARTERS, ELIGIBILITY_BOUNDS, parseBounded } from '../eligibilityRules';

/** Mirrors backend `MAX_TYPE_ATTENDANCE_RULES`. */
const MAX_ATTENDANCE_RULES = 4;
/** Months offered when a type is first given a wait. */
const DEFAULT_WAIT_MONTHS = 12;

const NO_RULE: TypeRule = { may_vote: true, wait: null, attendance: [] };

type AttendanceNumber = 'min_meetings' | 'of_last_meetings' | 'min_pct' | 'period_months';

const NUMBER_LABELS: Record<AttendanceNumber, string> = {
  min_meetings: 'Meetings attended',
  of_last_meetings: 'Out of the last',
  min_pct: 'Minimum attendance (%)',
  period_months: 'Over the last (months)',
};

const meetingTypesSummary = (types: string[] | null | undefined): string => {
  if (!types || types.length === 0) return 'Every meeting counts';
  const labels = types.map((t) => MEETING_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t);
  return `Counts: ${labels.join(', ')}`;
};

interface TypeRulesEditorProps {
  value: ElectionEligibilityRules;
  /** The rows to offer, in order (`rowsForRules`). */
  rows: VoterRow[];
  onChange: (next: ElectionEligibilityRules) => void;
  /** Prefixes element ids so two editors on one page do not collide. */
  idPrefix: string;
  disabled?: boolean;
}

export const TypeRulesEditor: React.FC<TypeRulesEditorProps> = ({
  value,
  rows,
  onChange,
  idPrefix,
  disabled = false,
}) => {
  /** Box text that is not (yet) a valid value, keyed by the box's id. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** A count pair that disagrees, keyed by the attendance rule's id. */
  const [pairErrors, setPairErrors] = useState<Record<string, true>>({});

  const types = value.types ?? {};
  const labelOf = (key: string) => rows.find((row) => row.key === key)?.label ?? key;
  const setRule = (key: string, rule: TypeRule) => onChange({ ...value, version: 2, types: { ...types, [key]: rule } });

  const dropDrafts = (prefix: string) => {
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !id.startsWith(prefix))));
    setPairErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !id.startsWith(prefix))));
  };

  const renderAttendanceRule = (row: VoterRow, rule: TypeRule, att: AttendanceRule, index: number) => {
    const ruleId = `${idPrefix}-${row.key}-att-${index}`;
    const replace = (next: AttendanceRule) =>
      setRule(row.key, { ...rule, attendance: rule.attendance.map((a, i) => (i === index ? next : a)) });

    const setMode = (mode: AttendanceRule['mode']) => {
      dropDrafts(ruleId);
      const starter =
        mode === AttendanceRuleMode.PERCENT ? ATTENDANCE_RULE_STARTERS.percent : ATTENDANCE_RULE_STARTERS.count;
      replace({ mode, meeting_types: att.meeting_types ?? null, ...starter });
    };

    const setNumber = (field: AttendanceNumber, raw: string) => {
      const boxId = `${ruleId}-${field}`;
      const parsed = parseBounded(field, raw);
      if (parsed === null) {
        setDrafts((prev) => ({ ...prev, [boxId]: raw }));
        return;
      }
      const next: AttendanceRule = { ...att, [field]: parsed };
      // The count pair is judged together: a box held back only because the
      // other disagreed is taken up once this one makes them agree.
      if (field === 'min_meetings' || field === 'of_last_meetings') {
        const other = field === 'min_meetings' ? 'of_last_meetings' : 'min_meetings';
        const otherDraft = drafts[`${ruleId}-${other}`];
        const otherParsed = otherDraft === undefined ? null : parseBounded(other, otherDraft);
        if (otherParsed !== null) next[other] = otherParsed;
        if (next.min_meetings != null && next.of_last_meetings != null && next.min_meetings > next.of_last_meetings) {
          setDrafts((prev) => ({ ...prev, [boxId]: raw }));
          setPairErrors((prev) => ({ ...prev, [ruleId]: true }));
          return;
        }
        dropDrafts(ruleId);
      } else {
        setDrafts(({ [boxId]: _dropped, ...rest }) => rest);
      }
      replace(next);
    };

    const toggleMeetingType = (type: string, checked: boolean) => {
      const selected = att.meeting_types ?? [];
      const next = checked ? [...selected, type] : selected.filter((t) => t !== type);
      // No type ticked means every meeting counts, never "none of them".
      replace({ ...att, meeting_types: next.length > 0 ? next : null });
    };

    const numberBox = (field: AttendanceNumber, suffix?: string) => {
      const bounds = ELIGIBILITY_BOUNDS[field];
      const boxId = `${ruleId}-${field}`;
      const draft = drafts[boxId];
      const saved = att[field];
      const pairField = field === 'min_meetings' || field === 'of_last_meetings';
      const errorId = pairField && pairErrors[ruleId] ? `${ruleId}-pair-error` : `${boxId}-error`;
      return (
        <div className="w-44">
          <label htmlFor={boxId} className="form-label">
            {NUMBER_LABELS[field]}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={boxId}
              type="number"
              inputMode={bounds.integer ? 'numeric' : 'decimal'}
              className="form-input w-24"
              min={bounds.min}
              max={bounds.max}
              step={bounds.integer ? 1 : 'any'}
              value={draft ?? (saved == null ? '' : String(saved))}
              onChange={(e) => setNumber(field, e.target.value)}
              aria-invalid={draft !== undefined}
              aria-describedby={draft !== undefined ? errorId : undefined}
            />
            {suffix && <span className="text-theme-text-secondary text-sm">{suffix}</span>}
          </div>
          {draft !== undefined && !(pairField && pairErrors[ruleId]) && (
            <p id={errorId} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
              {`Enter a ${bounds.integer ? 'whole number' : 'number'} from ${bounds.min} to ${bounds.max}.`}{' '}
              {saved == null ? 'Nothing is saved yet.' : `It is still saved as ${saved}.`}
            </p>
          )}
        </div>
      );
    };

    return (
      <li key={index} className="border-theme-surface-border space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-xs min-w-0 flex-1">
            <label htmlFor={`${ruleId}-mode`} className="form-label">
              Attendance rule {index + 1}
            </label>
            <select
              id={`${ruleId}-mode`}
              className="form-input"
              value={att.mode}
              onChange={(e) => setMode(e.target.value as AttendanceRule['mode'])}
            >
              <option value={AttendanceRuleMode.COUNT}>Attended a number of recent meetings</option>
              <option value={AttendanceRuleMode.PERCENT}>Attended a percentage of meetings</option>
            </select>
          </div>
          <button
            type="button"
            className="btn-icon"
            aria-label={`Remove attendance rule ${index + 1} for ${row.label} members`}
            onClick={() => {
              dropDrafts(`${idPrefix}-${row.key}-att-`);
              setRule(row.key, { ...rule, attendance: rule.attendance.filter((_, i) => i !== index) });
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {att.mode === AttendanceRuleMode.COUNT ? (
          <div>
            <div className="flex flex-wrap gap-4">
              {numberBox('min_meetings')}
              {numberBox('of_last_meetings', 'meetings')}
            </div>
            {pairErrors[ruleId] && (
              <p id={`${ruleId}-pair-error`} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                Meetings attended cannot be more than the meetings looked back over. The saved rule is still{' '}
                {att.min_meetings ?? '?'} of the last {att.of_last_meetings ?? '?'}.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {numberBox('min_pct', '%')}
            {numberBox('period_months', 'months')}
          </div>
        )}
        <fieldset>
          <legend className="text-theme-text-secondary text-sm">{meetingTypesSummary(att.meeting_types)}</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {MEETING_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="text-theme-text-primary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={(att.meeting_types ?? []).includes(opt.value)}
                  onChange={(e) => toggleMeetingType(opt.value, e.target.checked)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>
      </li>
    );
  };

  const renderRow = (row: VoterRow) => {
    const stored = types[row.key];
    const rule = stored ?? NO_RULE;
    const rowId = `${idPrefix}-${row.key}`;
    const waitDraft = drafts[`${rowId}-wait-months`];

    const setMayVote = (mayVote: boolean) => {
      dropDrafts(`${rowId}-`);
      setRule(row.key, mayVote ? { ...rule, may_vote: true } : { may_vote: false, wait: null, attendance: [] });
    };

    const setWaitMonths = (raw: string) => {
      const parsed = parseBounded('waiting_months', raw);
      if (parsed === null) {
        setDrafts((prev) => ({ ...prev, [`${rowId}-wait-months`]: raw }));
        return;
      }
      setDrafts(({ [`${rowId}-wait-months`]: _dropped, ...rest }) => rest);
      setRule(row.key, {
        ...rule,
        wait: { months: parsed, counted_from: rule.wait?.counted_from ?? WaitCountedFrom.JOINED },
      });
    };

    return (
      <li key={row.key}>
        <fieldset
          className="border-theme-surface-border space-y-4 rounded-lg border p-4"
          aria-describedby={row.decided_by === 'class' || (!stored && row.counts_as) ? `${rowId}-note` : undefined}
        >
          <legend className="text-theme-text-primary px-1 text-base font-semibold">{row.label} members</legend>
          {row.decided_by === 'class' && (
            <p id={`${rowId}-note`} className="text-theme-text-muted -mt-2 text-xs">
              Applies on top of the row for the member&apos;s status: a {row.label.toLowerCase()} member must meet both.
            </p>
          )}
          {!stored && row.counts_as && (
            <p id={`${rowId}-note`} className="text-theme-text-muted -mt-2 text-xs">
              Not set yet, so these members are judged by the {labelOf(row.counts_as)} row. Change anything here to give
              them rules of their own.
            </p>
          )}

          <div className="max-w-[12rem]">
            <label htmlFor={`${rowId}-may-vote`} className="form-label">
              May vote
            </label>
            <select
              id={`${rowId}-may-vote`}
              className="form-input"
              value={rule.may_vote ? 'yes' : 'no'}
              onChange={(e) => setMayVote(e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          {rule.may_vote && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor={`${rowId}-wait`} className="form-label">
                    Waiting period
                  </label>
                  <select
                    id={`${rowId}-wait`}
                    className="form-input w-auto"
                    value={rule.wait ? 'months' : 'none'}
                    onChange={(e) => {
                      dropDrafts(`${rowId}-wait`);
                      setRule(row.key, {
                        ...rule,
                        wait:
                          e.target.value === 'months'
                            ? { months: DEFAULT_WAIT_MONTHS, counted_from: WaitCountedFrom.JOINED }
                            : null,
                      });
                    }}
                  >
                    <option value="none">No waiting period</option>
                    <option value="months">Wait a number of months</option>
                  </select>
                </div>
                {rule.wait && (
                  <>
                    <div>
                      <label htmlFor={`${rowId}-wait-months`} className="form-label">
                        Months
                      </label>
                      <input
                        id={`${rowId}-wait-months`}
                        type="number"
                        inputMode="numeric"
                        className="form-input w-24"
                        min={ELIGIBILITY_BOUNDS.waiting_months.min}
                        max={ELIGIBILITY_BOUNDS.waiting_months.max}
                        step={1}
                        value={waitDraft ?? String(rule.wait.months)}
                        onChange={(e) => setWaitMonths(e.target.value)}
                        aria-invalid={waitDraft !== undefined}
                        aria-describedby={waitDraft !== undefined ? `${rowId}-wait-months-error` : undefined}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${rowId}-wait-from`} className="form-label">
                        Counted from
                      </label>
                      <select
                        id={`${rowId}-wait-from`}
                        className="form-input w-auto"
                        value={rule.wait.counted_from}
                        onChange={(e) =>
                          rule.wait &&
                          setRule(row.key, {
                            ...rule,
                            wait: { ...rule.wait, counted_from: e.target.value as WaitCountedFrom },
                          })
                        }
                      >
                        <option value={WaitCountedFrom.JOINED}>Joining the department</option>
                        <option value={WaitCountedFrom.TYPE}>Becoming {row.label.toLowerCase()}</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              {rule.wait && waitDraft !== undefined && (
                <p id={`${rowId}-wait-months-error`} role="alert" className="text-sm text-red-700 dark:text-red-400">
                  Enter a whole number from {ELIGIBILITY_BOUNDS.waiting_months.min} to{' '}
                  {ELIGIBILITY_BOUNDS.waiting_months.max}. It is still saved as {rule.wait.months}.
                </p>
              )}

              <div className="space-y-3">
                <p className="text-theme-text-primary text-sm font-medium">Meeting attendance</p>
                {rule.attendance.length === 0 ? (
                  <p className="text-theme-text-secondary text-sm">Not required.</p>
                ) : (
                  <>
                    {rule.attendance.length > 1 && (
                      <p className="text-theme-text-muted text-xs">Every rule below must be met.</p>
                    )}
                    <ul className="space-y-3">
                      {rule.attendance.map((att, index) => renderAttendanceRule(row, rule, att, index))}
                    </ul>
                  </>
                )}
                {rule.attendance.length < MAX_ATTENDANCE_RULES && (
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                    onClick={() =>
                      setRule(row.key, {
                        ...rule,
                        attendance: [
                          ...rule.attendance,
                          { mode: AttendanceRuleMode.COUNT, ...ATTENDANCE_RULE_STARTERS.count },
                        ],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add attendance rule
                  </button>
                )}
              </div>
            </>
          )}
        </fieldset>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-theme-text-muted text-sm">
        A member must meet every rule on their row. Excused meetings and meetings during a leave of absence are left
        out, and only meetings since the member&apos;s current period of membership began are counted. A waiting period
        never counts from before that either. A secretary can correct a member&apos;s start date or waive their wait on
        their profile.
      </p>
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="sr-only">Rules by member type</legend>
        <ul className="space-y-4">{rows.map(renderRow)}</ul>
      </fieldset>
    </div>
  );
};

export default TypeRulesEditor;
