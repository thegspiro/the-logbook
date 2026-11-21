/**
 * Who an "email the members" send reaches: member class, membership status
 * (including the department's own tiers) and positions.
 *
 * Within one group any ticked box counts; across groups every group must
 * match; a group left empty does not narrow. The count below is the server's
 * answer for the current choice, not a client-side estimate, because only the
 * server applies the opt-out and reads a member's status the way the rest of
 * the app does.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { memberAudienceService } from '../../services/api';
import { MEMBER_CLASS_LABELS, type MemberClass } from '../../constants/enums';
import { memberStatusLabel } from '../../utils/membership';
import { getErrorMessage } from '../../utils/errorHandling';
import type { MemberAudienceChoice, MemberAudienceOptions, MemberAudiencePreview } from '../../types/memberAudience';

/** How long the choice must sit still before it is counted. */
const COUNT_DELAY_MS = 300;

interface MemberAudiencePickerProps {
  value: MemberAudienceChoice;
  onChange: (value: MemberAudienceChoice) => void;
  /** The current count, or null while counting or when it could not be had. */
  onCount?: ((recipients: number | null) => void) | undefined;
}

const toggle = (list: string[], item: string): string[] =>
  list.includes(item) ? list.filter((v) => v !== item) : [...list, item];

interface GroupProps {
  legend: string;
  items: { value: string; label: string }[];
  chosen: string[];
  onToggle: (value: string) => void;
  scroll?: boolean;
}

const CheckboxGroup: React.FC<GroupProps> = ({ legend, items, chosen, onToggle, scroll = false }) => (
  <fieldset className="space-y-1">
    <legend className="form-label">
      {legend}
      <span className="text-theme-text-muted ml-1 font-normal">
        {chosen.length === 0 ? '· any' : `· ${chosen.length} chosen`}
      </span>
    </legend>
    <div
      className={`grid gap-x-4 sm:grid-cols-2 ${scroll ? 'border-theme-surface-border max-h-44 overflow-y-auto rounded-md border p-2' : ''}`}
    >
      {items.map((item) => (
        <label key={item.value} className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={chosen.includes(item.value)}
            onChange={() => onToggle(item.value)}
          />
          {item.label}
        </label>
      ))}
    </div>
  </fieldset>
);

export const MemberAudiencePicker: React.FC<MemberAudiencePickerProps> = ({ value, onChange, onCount }) => {
  const countId = useId();
  const [options, setOptions] = useState<MemberAudienceOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MemberAudiencePreview | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [counting, setCounting] = useState(true);
  // Held in a ref so a parent that recreates its callback each render does not
  // restart the count.
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  });

  useEffect(() => {
    memberAudienceService
      .getOptions()
      .then(setOptions)
      .catch((err: unknown) => setOptionsError(getErrorMessage(err, 'Could not load the member choices.')));
  }, []);

  const { member_classes, member_statuses, position_ids } = value;
  useEffect(() => {
    const controller = new AbortController();
    setCounting(true);
    onCountRef.current?.(null);
    const timer = window.setTimeout(() => {
      memberAudienceService
        .preview({ member_classes, member_statuses, position_ids }, controller.signal)
        .then((result) => {
          setPreview(result);
          setCountError(null);
          setCounting(false);
          onCountRef.current?.(result.recipients);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (isAxiosError(err) && err.code === 'ERR_CANCELED')) return;
          setPreview(null);
          setCountError(getErrorMessage(err, 'Could not count the members.'));
          setCounting(false);
        });
    }, COUNT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [member_classes, member_statuses, position_ids]);

  if (optionsError) {
    return (
      <p className="alert-danger text-sm" role="alert">
        {optionsError}
      </p>
    );
  }
  if (!options) {
    return <p className="text-theme-text-muted text-sm">Loading member choices…</p>;
  }

  return (
    <div className="space-y-3" aria-describedby={countId}>
      <p className="text-theme-text-muted text-xs">
        Leave a group empty to include everyone in it. A member must match every group you narrow.
      </p>
      <CheckboxGroup
        legend="Member class"
        items={options.member_classes.map((c) => ({
          value: c,
          label: c in MEMBER_CLASS_LABELS ? MEMBER_CLASS_LABELS[c as MemberClass] : c,
        }))}
        chosen={member_classes}
        onToggle={(c) => onChange({ ...value, member_classes: toggle(member_classes, c) })}
      />
      <CheckboxGroup
        legend="Membership status"
        items={options.member_statuses.map((s) => ({
          value: s.value,
          label: s.label ?? memberStatusLabel(s.value),
        }))}
        chosen={member_statuses}
        onToggle={(s) => onChange({ ...value, member_statuses: toggle(member_statuses, s) })}
      />
      {options.positions.length > 0 && (
        <CheckboxGroup
          legend="Positions"
          items={options.positions.map((p) => ({ value: p.id, label: p.name }))}
          chosen={position_ids}
          onToggle={(p) => onChange({ ...value, position_ids: toggle(position_ids, p) })}
          scroll={options.positions.length > 8}
        />
      )}
      <p id={countId} className="text-sm" role="status" aria-live="polite">
        {counting ? (
          <span className="text-theme-text-muted">Counting members…</span>
        ) : countError ? (
          <span className="text-red-700 dark:text-red-400">{countError}</span>
        ) : preview ? (
          <>
            <span className="text-theme-text-primary font-semibold">
              {preview.recipients === 0
                ? 'No members match these choices'
                : `${preview.recipients} ${preview.recipients === 1 ? 'member' : 'members'} will be emailed`}
            </span>
            {preview.skipped_opted_out > 0 && (
              <span className="text-theme-text-muted">
                {' '}
                · {preview.skipped_opted_out} more match but turned off volunteer call emails
              </span>
            )}
          </>
        ) : null}
      </p>
    </div>
  );
};

export default MemberAudiencePicker;
