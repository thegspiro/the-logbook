/**
 * Plan or update a fundraising event — a dinner, raffle, golf outing.
 *
 * `fundraising.manage`, the gate on both endpoints. Creating plans the event;
 * editing it afterwards is where the results go (status, money raised,
 * expenses, attendance). The backend refuses a campaign outside the
 * department and a registration link that is not http or https.
 *
 * A create omits blank optional fields; an edit sends every field the form
 * owns, a cleared one as null (pitfall #1). Sponsors and a link to a calendar
 * event stay API-only.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { fundraisingService } from '../services/api';
import { FundraisingEventStatus, FundraisingEventType } from '../types';
import type {
  FundraisingCampaign,
  FundraisingEvent,
  FundraisingEventCreatePayload,
  FundraisingEventUpdatePayload,
} from '../types';
import { FUNDRAISING_EVENT_STATUS_LABELS, FUNDRAISING_EVENT_TYPE_LABELS } from '../utils/labels';

const MAX_AMOUNT = 99_999_999.99;

interface FundraisingEventDialogProps {
  event?: FundraisingEvent | undefined;
  campaigns: FundraisingCampaign[];
  onClose: () => void;
  onSaved: () => void;
}

const moneyText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

export const FundraisingEventDialog: React.FC<FundraisingEventDialogProps> = ({
  event,
  campaigns,
  onClose,
  onSaved,
}) => {
  const tz = useTimezone();
  const isEdit = event !== undefined;
  const [name, setName] = useState(event?.name ?? '');
  const [eventType, setEventType] = useState<string>(event?.eventType ?? FundraisingEventType.DINNER);
  const [eventDate, setEventDate] = useState(event ? formatForDateTimeInput(event.eventDate, tz) : '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [campaignId, setCampaignId] = useState(event?.campaignId ?? '');
  const [ticketPrice, setTicketPrice] = useState(moneyText(event?.ticketPrice));
  const [maxAttendees, setMaxAttendees] = useState(moneyText(event?.maxAttendees));
  const [revenueGoal, setRevenueGoal] = useState(moneyText(event?.revenueGoal));
  const [registrationUrl, setRegistrationUrl] = useState(event?.registrationUrl ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [status, setStatus] = useState<string>(event?.status ?? FundraisingEventStatus.PLANNING);
  const [actualRevenue, setActualRevenue] = useState(moneyText(event?.actualRevenue ?? 0));
  const [expenses, setExpenses] = useState(moneyText(event?.expenses ?? 0));
  const [currentAttendees, setCurrentAttendees] = useState(moneyText(event?.currentAttendees ?? 0));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const checkNumber = (next: Record<string, string>, field: string, value: string, whole = false) => {
    if (value.trim() === '') return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || (whole && !Number.isInteger(parsed))) {
      next[field] = whole ? 'Enter a whole number of zero or more.' : 'Enter an amount of zero or more.';
    } else if (!whole && parsed > MAX_AMOUNT) {
      next[field] = 'That amount is too large.';
    }
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the event a name.';
    if (!eventDate) next.eventDate = 'Enter when the event takes place.';
    checkNumber(next, 'ticketPrice', ticketPrice);
    checkNumber(next, 'maxAttendees', maxAttendees, true);
    checkNumber(next, 'revenueGoal', revenueGoal);
    if (isEdit) {
      checkNumber(next, 'actualRevenue', actualRevenue);
      checkNumber(next, 'expenses', expenses);
      checkNumber(next, 'currentAttendees', currentAttendees, true);
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    void save();
  };

  const save = async () => {
    setSaving(true);
    const when = localToUTC(eventDate, tz);
    try {
      if (event) {
        const payload: FundraisingEventUpdatePayload = {
          name: name.trim(),
          eventType: eventType as FundraisingEventType,
          eventDate: when,
          location: blankToNull(location),
          campaignId: campaignId || null,
          ticketPrice: blankToNull(ticketPrice),
          maxAttendees: numberOrNull(maxAttendees),
          revenueGoal: blankToNull(revenueGoal),
          registrationUrl: blankToNull(registrationUrl),
          description: blankToNull(description),
          notes: blankToNull(notes),
          status: status as FundraisingEventStatus,
          actualRevenue: actualRevenue.trim() || '0',
          expenses: expenses.trim() || '0',
          currentAttendees: Number(currentAttendees || 0),
        };
        await fundraisingService.updateFundraisingEvent(event.id, payload);
        toast.success('Event saved');
      } else {
        const payload: FundraisingEventCreatePayload = {
          name: name.trim(),
          eventType: eventType as FundraisingEventType,
          eventDate: when,
          location: location.trim() || undefined,
          campaignId: campaignId || undefined,
          ticketPrice: ticketPrice.trim() || undefined,
          maxAttendees: maxAttendees.trim() ? Number(maxAttendees) : undefined,
          revenueGoal: revenueGoal.trim() || undefined,
          registrationUrl: registrationUrl.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined,
        };
        await fundraisingService.createFundraisingEvent(payload);
        toast.success('Event added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the event'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`fr-event-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;
  const describedBy = (field: string) => (errors[field] ? `fr-event-${field}-error` : undefined);
  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;

  const numberField = (
    id: string,
    field: string,
    label: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
    whole = false
  ) => (
    <div>
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode={whole ? 'numeric' : 'decimal'}
        min="0"
        step={whole ? '1' : '0.01'}
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={describedBy(field)}
      />
      {errorText(field)}
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit fundraising event' : 'Add fundraising event'}
      titleId="fr-event-form-title"
      size="lg"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save event' : 'Add event'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="fr-event-name" className="form-label">
              Name
            </label>
            <input
              id="fr-event-name"
              type="text"
              maxLength={255}
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy('name')}
            />
            {errorText('name')}
          </div>
          <div>
            <label htmlFor="fr-event-type" className="form-label">
              Type
            </label>
            <select
              id="fr-event-type"
              className="form-input"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              {Object.values(FundraisingEventType).map((value) => (
                <option key={value} value={value}>
                  {FUNDRAISING_EVENT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fr-event-date" className="form-label">
              Date and time
            </label>
            <input
              id="fr-event-date"
              type="datetime-local"
              className="form-input"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              aria-invalid={Boolean(errors.eventDate)}
              aria-describedby={describedBy('eventDate')}
            />
            {errorText('eventDate')}
          </div>
          <div>
            <label htmlFor="fr-event-location" className="form-label">
              Location {optional}
            </label>
            <input
              id="fr-event-location"
              type="text"
              maxLength={300}
              className="form-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fr-event-campaign" className="form-label">
              Campaign {optional}
            </label>
            <select
              id="fr-event-campaign"
              className="form-input"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {numberField('fr-event-ticket', 'ticketPrice', <>Ticket price {optional}</>, ticketPrice, setTicketPrice)}
          {numberField(
            'fr-event-capacity',
            'maxAttendees',
            <>Capacity {optional}</>,
            maxAttendees,
            setMaxAttendees,
            true
          )}
          {numberField('fr-event-goal', 'revenueGoal', <>Revenue goal {optional}</>, revenueGoal, setRevenueGoal)}
          <div>
            <label htmlFor="fr-event-url" className="form-label">
              Registration link {optional}
            </label>
            <input
              id="fr-event-url"
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder="https://"
              className="form-input"
              value={registrationUrl}
              onChange={(e) => setRegistrationUrl(e.target.value)}
            />
          </div>
        </div>

        {isEdit && (
          <fieldset className="border-theme-surface-border grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="text-theme-text-primary px-1 text-sm font-semibold">Results</legend>
            <div>
              <label htmlFor="fr-event-status" className="form-label">
                Status
              </label>
              <select
                id="fr-event-status"
                className="form-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.values(FundraisingEventStatus).map((value) => (
                  <option key={value} value={value}>
                    {FUNDRAISING_EVENT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {numberField(
              'fr-event-attendees',
              'currentAttendees',
              'Attendance',
              currentAttendees,
              setCurrentAttendees,
              true
            )}
            {numberField('fr-event-revenue', 'actualRevenue', 'Money raised', actualRevenue, setActualRevenue)}
            {numberField('fr-event-expenses', 'expenses', 'Expenses', expenses, setExpenses)}
          </fieldset>
        )}

        <div>
          <label htmlFor="fr-event-description" className="form-label">
            Description {optional}
          </label>
          <textarea
            id="fr-event-description"
            rows={2}
            className="form-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="fr-event-notes" className="form-label">
            Notes {optional}
          </label>
          <textarea
            id="fr-event-notes"
            rows={2}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
