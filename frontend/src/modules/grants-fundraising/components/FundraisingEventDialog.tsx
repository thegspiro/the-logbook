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

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
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

type EventField =
  | 'name'
  | 'eventType'
  | 'eventDate'
  | 'location'
  | 'campaignId'
  | 'ticketPrice'
  | 'maxAttendees'
  | 'revenueGoal'
  | 'registrationUrl'
  | 'description'
  | 'notes'
  | 'status'
  | 'actualRevenue'
  | 'expenses'
  | 'currentAttendees';

/**
 * Labels and `FundraisingEventCreate`'s max_length per field; each key is also
 * its payload key. Grant request schemas report the camelCase alias, and the
 * mapper reads both spellings.
 */
const SERVER_FIELDS: Record<EventField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 255 },
  eventType: { label: 'Type' },
  eventDate: { label: 'Date and time' },
  location: { label: 'Location', maxLength: 300 },
  campaignId: { label: 'Campaign' },
  ticketPrice: { label: 'Ticket price' },
  maxAttendees: { label: 'Capacity' },
  revenueGoal: { label: 'Revenue goal' },
  registrationUrl: { label: 'Registration link', maxLength: 500 },
  description: { label: 'Description' },
  notes: { label: 'Notes' },
  status: { label: 'Status' },
  actualRevenue: { label: 'Money raised' },
  expenses: { label: 'Expenses' },
  currentAttendees: { label: 'Attendance' },
};

const fieldId = (field: EventField) => `fr-event-field-${field}`;

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
  const [errors, setErrors] = useState<Partial<Record<EventField, string>>>({});
  const [saving, setSaving] = useState(false);
  // An edit that saved everything but a refused field stays open on that
  // field; closing then still tells the caller something was saved.
  const partlySaved = useRef(false);

  const snapshot = JSON.stringify([
    name,
    eventType,
    eventDate,
    location,
    campaignId,
    ticketPrice,
    maxAttendees,
    revenueGoal,
    registrationUrl,
    description,
    notes,
    status,
    actualRevenue,
    expenses,
    currentAttendees,
  ]);
  const initialSnapshot = useRef(snapshot);
  const isDirty = snapshot !== initialSnapshot.current;
  const close = () => (partlySaved.current ? onSaved() : onClose());
  // Escape, the X and Cancel all ask before throwing away a changed form.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });
  /** A field's change handler, which also clears the error it carried. */
  const change = (field: EventField, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };
  const focusField = (field: EventField | undefined) => {
    if (field) document.getElementById(fieldId(field))?.focus();
  };

  const checkNumber = (next: Partial<Record<EventField, string>>, field: EventField, value: string, whole = false) => {
    if (value.trim() === '') return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || (whole && !Number.isInteger(parsed))) {
      next[field] = whole ? 'Enter a whole number of zero or more.' : 'Enter an amount of zero or more.';
    } else if (!whole && parsed > MAX_AMOUNT) {
      next[field] = 'That amount is too large.';
    }
  };

  const validate = (): boolean => {
    const next: Partial<Record<EventField, string>> = {};
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
        let refused: Partial<Record<EventField, string>> = {};
        try {
          await fundraisingService.updateFundraisingEvent(event.id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the event
          // cannot hold is not written, the rest saves, and the field keeps
          // what was typed, flagged, until it is fixed. Anything the form has
          // no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as EventField[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: FundraisingEventUpdatePayload = { ...payload };
          for (const key of keys) delete rest[key];
          await fundraisingService.updateFundraisingEvent(event.id, rest);
        }
        const firstRefused = (Object.keys(refused) as EventField[])[0];
        if (firstRefused) {
          partlySaved.current = true;
          setErrors(refused);
          toast.error(
            `Event saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          focusField(firstRefused);
          return;
        }
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
      // A new event is added only once nothing is refused, so each refusal
      // goes on its field (forms review F-2).
      const mapped = event ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as EventField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        focusField(keys[0]);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not save the event'));
    } finally {
      setSaving(false);
    }
  };

  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;

  /** A text, date or URL input bound to one field. */
  const inputField = (
    field: EventField,
    label: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
    attrs: React.InputHTMLAttributes<HTMLInputElement> & { required?: boolean } = {},
    className?: string
  ) => {
    const { required, ...rest } = attrs;
    const { maxLength } = SERVER_FIELDS[field];
    return (
      <FormField
        id={fieldId(field)}
        className={className}
        label={label}
        required={required}
        error={errors[field]}
        maxLength={maxLength}
        count={maxLength ? value.length : undefined}
      >
        {(control) => (
          <input
            type="text"
            {...rest}
            {...control}
            className="form-input"
            value={value}
            onChange={(e) => change(field, onChange)(e.target.value)}
          />
        )}
      </FormField>
    );
  };

  const numberField = (
    field: EventField,
    label: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
    whole = false
  ) =>
    inputField(field, label, value, onChange, {
      type: 'number',
      inputMode: whole ? 'numeric' : 'decimal',
      min: '0',
      step: whole ? '1' : '0.01',
    });

  const textareaField = (field: EventField, label: React.ReactNode, value: string, onChange: (v: string) => void) => (
    <FormField id={fieldId(field)} label={label} error={errors[field]}>
      {(control) => (
        <textarea
          {...control}
          rows={2}
          className="form-input"
          value={value}
          onChange={(e) => change(field, onChange)(e.target.value)}
        />
      )}
    </FormField>
  );

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEdit ? 'Edit fundraising event' : 'Add fundraising event'}
      titleId="fr-event-form-title"
      size="lg"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save event' : 'Add event'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {inputField('name', 'Name', name, setName, { required: true, autoComplete: 'off' }, 'sm:col-span-2')}
          <FormField id={fieldId('eventType')} label="Type" required error={errors.eventType}>
            {(control) => (
              <select
                {...control}
                className="form-input"
                value={eventType}
                onChange={(e) => change('eventType', setEventType)(e.target.value)}
              >
                {Object.values(FundraisingEventType).map((value) => (
                  <option key={value} value={value}>
                    {FUNDRAISING_EVENT_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {inputField('eventDate', 'Date and time', eventDate, setEventDate, {
            type: 'datetime-local',
            required: true,
          })}
          {inputField('location', <>Location {optional}</>, location, setLocation, { autoComplete: 'off' })}
          <FormField id={fieldId('campaignId')} label={<>Campaign {optional}</>} error={errors.campaignId}>
            {(control) => (
              <select
                {...control}
                className="form-input"
                value={campaignId}
                onChange={(e) => change('campaignId', setCampaignId)(e.target.value)}
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {numberField('ticketPrice', <>Ticket price {optional}</>, ticketPrice, setTicketPrice)}
          {numberField('maxAttendees', <>Capacity {optional}</>, maxAttendees, setMaxAttendees, true)}
          {numberField('revenueGoal', <>Revenue goal {optional}</>, revenueGoal, setRevenueGoal)}
          {inputField('registrationUrl', <>Registration link {optional}</>, registrationUrl, setRegistrationUrl, {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://',
            autoComplete: 'url',
          })}
        </div>

        {isEdit && (
          <fieldset className="border-theme-surface-border grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="text-theme-text-primary px-1 text-sm font-semibold">Results</legend>
            <FormField id={fieldId('status')} label="Status" error={errors.status}>
              {(control) => (
                <select
                  {...control}
                  className="form-input"
                  value={status}
                  onChange={(e) => change('status', setStatus)(e.target.value)}
                >
                  {Object.values(FundraisingEventStatus).map((value) => (
                    <option key={value} value={value}>
                      {FUNDRAISING_EVENT_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {numberField('currentAttendees', 'Attendance', currentAttendees, setCurrentAttendees, true)}
            {numberField('actualRevenue', 'Money raised', actualRevenue, setActualRevenue)}
            {numberField('expenses', 'Expenses', expenses, setExpenses)}
          </fieldset>
        )}

        {textareaField('description', <>Description {optional}</>, description, setDescription)}
        {textareaField('notes', <>Notes {optional}</>, notes, setNotes)}
      </div>
    </Modal>
  );
};
