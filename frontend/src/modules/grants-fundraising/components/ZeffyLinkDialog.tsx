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
  const [targetId, setTargetId] = useState(existing?.targetType === initialType ? (existing.targetId ?? '') : '');
  const [startDate, setStartDate] = useState(existing ? toLocalISODate(existing.applyFrom, tz) : '');
  const [startTouched, setStartTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const targetTypes = Object.values(ZeffyLinkTarget).filter((t) => t !== ZeffyLinkTarget.DUES_SCHEDULE || canLinkDues);
  const options: { id: string; name: string }[] =
    targetType === ZeffyLinkTarget.FUNDRAISING_CAMPAIGN
      ? campaigns
      : targetType === ZeffyLinkTarget.FUNDRAISING_EVENT
        ? events
        : duesSchedules.filter((s) => s.isActive !== false || s.id === targetId);

  const save = async () => {
    if (!targetId) {
      setError(`Choose the ${ZEFFY_TARGET_LABELS[targetType]?.toLowerCase() ?? 'record'} to link.`);
      return;
    }
    const sendStart = !existing || startTouched;
    const applyFrom = sendStart && startDate ? localToUTC(`${startDate}T00:00`, tz) || undefined : undefined;
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
      setError(getErrorMessage(err, 'Could not save the link.'));
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
      onClose={onClose}
      title={existing ? 'Change link' : 'Link Zeffy campaign'}
      titleId="zeffy-link-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Save link
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
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
          <p role="alert" className="alert-danger rounded-lg p-3 text-sm">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="zeffy-target-type" className="form-label">
            Record payments as
          </label>
          <select
            id="zeffy-target-type"
            className="form-input"
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value as ZeffyLinkTarget);
              setTargetId('');
              setError(null);
            }}
          >
            {targetTypes.map((t) => (
              <option key={t} value={t}>
                {ZEFFY_TARGET_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="text-theme-text-secondary mt-1 text-xs">
            {targetType === ZeffyLinkTarget.FUNDRAISING_CAMPAIGN &&
              'Each payment becomes a donation on the campaign, from a donor matched by email.'}
            {targetType === ZeffyLinkTarget.FUNDRAISING_EVENT &&
              'Each payment adds to the event’s revenue, and each ticket to its attendance.'}
            {targetType === ZeffyLinkTarget.DUES_SCHEDULE &&
              'Each payment is credited to the paying member’s open dues on the schedule, matched by email. Anything over the balance is recorded as a donation.'}
          </p>
        </div>

        <div>
          <label htmlFor="zeffy-target" className="form-label">
            {ZEFFY_TARGET_LABELS[targetType]}
          </label>
          <select
            id="zeffy-target"
            className="form-input"
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              setError(null);
            }}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="zeffy-start" className="form-label">
            Apply payments made on or after <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="zeffy-start"
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setStartTouched(true);
            }}
          />
          <p className="text-theme-text-secondary mt-1 text-xs">
            Leave blank to apply only payments from now on. Choose an earlier date only for payments that have not
            already been entered by hand, or they will be counted twice.
          </p>
        </div>
      </div>
    </Modal>
  );
};
