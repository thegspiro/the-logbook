/**
 * Link a Zeffy campaign to the Logbook record its payments feed.
 *
 * `fundraising.manage`; a member-dues link also needs `finance.manage`, which
 * the backend enforces and this dialog mirrors by not offering the option.
 *
 * The start date is the guard against counting money twice: a department that
 * has been typing Zeffy gifts in by hand links a campaign "from now on" (the
 * default, a blank date) and only chooses an earlier date to import history it
 * has not recorded. On an existing link the date is sent only when it was
 * changed — re-sending the stored instant rounded to midnight would quietly
 * move the start earlier and re-apply that morning's payments.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { getErrorMessage } from '../../../utils/errorHandling';
import { localToUTC, toLocalISODate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { zeffyService } from '../services/api';
import { ZeffyLinkTarget } from '../types';
import type {
  FundraisingCampaign,
  FundraisingEvent,
  ZeffyCampaign,
  ZeffyDuesScheduleOption,
  ZeffyLinkPayload,
} from '../types';
import { ZEFFY_TARGET_LABELS } from '../utils/labels';

interface ZeffyLinkDialogProps {
  campaign: ZeffyCampaign;
  campaigns: FundraisingCampaign[];
  events: FundraisingEvent[];
  duesSchedules: ZeffyDuesScheduleOption[];
  canLinkDues: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type LinkField = 'targetType' | 'targetId' | 'applyFrom';

/**
 * `ZeffyLinkUpsert` in schemas/zeffy.py. The link is replaced whole on every
 * save, so a refusal holds the save back rather than keeping part of it: there
 * is no "rest" of a link to save without its target. Ordered as on screen.
 */
const LINK_FIELDS: Record<LinkField, ServerFieldSpec & { id: string }> = {
  targetType: { label: 'Record payments as', id: 'zeffy-target-type' },
  targetId: { label: 'Linked record', id: 'zeffy-target' },
  applyFrom: { label: 'Start date', id: 'zeffy-start' },
};

const defaultTarget = (campaign: ZeffyCampaign, canLinkDues: boolean): ZeffyLinkTarget => {
  if (campaign.link && (campaign.link.targetType !== ZeffyLinkTarget.DUES_SCHEDULE || canLinkDues)) {
    return campaign.link.targetType;
  }
  if (campaign.category === 'membership' && canLinkDues) return ZeffyLinkTarget.DUES_SCHEDULE;
  if (campaign.campaignType === 'ticketing' || campaign.category === 'event') {
    return ZeffyLinkTarget.FUNDRAISING_EVENT;
  }
  return ZeffyLinkTarget.FUNDRAISING_CAMPAIGN;
};

export const ZeffyLinkDialog: React.FC<ZeffyLinkDialogProps> = ({
  campaign,
  campaigns,
  events,
  duesSchedules,
  canLinkDues,
  onClose,
  onSaved,
}) => {
  const tz = useTimezone();
  const existing = campaign.link ?? null;
  const initialType = defaultTarget(campaign, canLinkDues);
  const [targetType, setTargetType] = useState<ZeffyLinkTarget>(initialType);
  const [targetId, setTargetId] = useState(() =>
    existing?.targetType === initialType ? (existing.targetId ?? '') : ''
  );
  const [startDate, setStartDate] = useState(existing ? toLocalISODate(existing.applyFrom, tz) : '');
  const [startTouched, setStartTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LinkField, string>>>({});
  const [saving, setSaving] = useState(false);
  const initialTargetId = existing?.targetType === initialType ? (existing.targetId ?? '') : '';
  // Escape, the X and Cancel ask before a changed link is thrown away (forms review F-6).
  const requestClose = useDiscardGuard({
    isDirty: targetType !== initialType || targetId !== initialTargetId || startTouched,
    onClose,
  });

  const showFieldErrors = (next: Partial<Record<LinkField, string>>) => {
    setFieldErrors(next);
    const first = (Object.keys(LINK_FIELDS) as LinkField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(LINK_FIELDS[first].id)?.focus(), 0);
  };

  const targetTypes = Object.values(ZeffyLinkTarget).filter((t) => t !== ZeffyLinkTarget.DUES_SCHEDULE || canLinkDues);
  const options: { id: string; name: string }[] =
    targetType === ZeffyLinkTarget.FUNDRAISING_CAMPAIGN
      ? campaigns
      : targetType === ZeffyLinkTarget.FUNDRAISING_EVENT
        ? events
        : duesSchedules.filter((s) => s.isActive !== false || s.id === targetId);

  const save = async () => {
    setError(null);
    if (!targetId) {
      showFieldErrors({
        targetId: `Choose the ${ZEFFY_TARGET_LABELS[targetType]?.toLowerCase() ?? 'record'} to link.`,
      });
      return;
    }
    // Untouched on an existing link: omitted, so the stored start stands.
    // Cleared on an existing link: "from now on" means now, so it is sent —
    // omitted, the backend would keep the old start. Blank on a new link: the
    // backend's own default is now.
    let applyFrom: string | undefined;
    if (startDate && (!existing || startTouched)) {
      applyFrom = localToUTC(`${startDate}T00:00`, tz) || undefined;
    } else if (existing && startTouched) {
      applyFrom = new Date().toISOString();
    }
    const payload: ZeffyLinkPayload = {
      targetType,
      targetId,
      zeffyCampaignTitle: campaign.title || undefined,
      applyFrom,
    };
    setSaving(true);
    try {
      await zeffyService.saveLink(campaign.id, payload);
      toast.success('Campaign linked');
      onSaved();
    } catch (err: unknown) {
      // A refusal lands on its field (forms review F-2); anything no field
      // answers for is said above the form.
      const mapped = mapServerFieldErrors(err, LINK_FIELDS);
      if (mapped) showFieldErrors(mapped.fieldErrors);
      const placed = mapped ? Object.keys(mapped.fieldErrors).length > 0 : false;
      setError(mapped?.unmatched.join(' ') || (placed ? null : getErrorMessage(err, 'Could not save the link.')));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void save();
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={existing ? 'Change link' : 'Link Zeffy campaign'}
      titleId="zeffy-link-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Save link
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          Payments to <span className="text-theme-text-primary font-medium">{campaign.title || campaign.id}</span> will
          be recorded on the record you choose. Payments already applied stay where they are.
        </p>

        {error && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {error}
          </p>
        )}

        <FormField
          id={LINK_FIELDS.targetType.id}
          label="Record payments as"
          error={fieldErrors.targetType}
          hint={
            targetType === ZeffyLinkTarget.FUNDRAISING_CAMPAIGN
              ? 'Each payment becomes a donation on the campaign, from a donor matched by email.'
              : targetType === ZeffyLinkTarget.FUNDRAISING_EVENT
                ? 'Each payment adds to the event’s revenue, and each ticket to its attendance.'
                : 'Each payment is credited to the paying member’s open dues on the schedule, matched by email. Anything over the balance is recorded as a donation.'
          }
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value as ZeffyLinkTarget);
                setTargetId('');
                setFieldErrors({});
              }}
            >
              {targetTypes.map((t) => (
                <option key={t} value={t}>
                  {ZEFFY_TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={LINK_FIELDS.targetId.id}
          label={ZEFFY_TARGET_LABELS[targetType]}
          required
          error={fieldErrors.targetId}
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setFieldErrors(({ targetId: _cleared, ...rest }) => rest);
              }}
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={LINK_FIELDS.applyFrom.id}
          label="Apply payments made on or after"
          optional
          error={fieldErrors.applyFrom}
          hint="Leave blank to apply only payments from now on. Choose an earlier date only for payments that have not already been entered by hand, or they will be counted twice."
        >
          {(field) => (
            <input
              {...field}
              type="date"
              className="form-input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setStartTouched(true);
                setFieldErrors(({ applyFrom: _cleared, ...rest }) => rest);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
