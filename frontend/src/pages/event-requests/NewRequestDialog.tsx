/**
 * Enter an outreach request that reached the department by phone, email or in
 * person, so it is worked on the same board as one from the public form.
 *
 * The coordinator is typing for somebody else, which is why this is not the
 * public form: an email is optional when there is a phone number (a caller may
 * give only that), the requester's acknowledgement can be declined because the
 * coordinator has just told them everything it says, and none of the public
 * gates apply. The server flags a date inside the minimum lead time rather
 * than refusing it.
 */

import React, { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ErrorSummary } from '../../components/ux/ErrorSummary';
import { FormField } from '../../components/ux/FormField';
import { EVENT_REQUEST_SOURCE_LABELS, STAFF_ENTERED_SOURCES, type EventRequestSource } from '../../constants/enums';
import { useDiscardGuard } from '../../hooks/useDiscardGuard';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../hooks/useFieldErrors';
import { eventRequestService } from '../../services/api';
import type { DateFlexibility, EventRequest, TimeOfDay, VenuePreference } from '../../types/event';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CoordinatorOption {
  id: string;
  name: string;
}

interface NewRequestDialogProps {
  /** The department's request types, value to label. */
  outreachTypes: Record<string, string>;
  /** Current members who can coordinate a request. */
  coordinators: CoordinatorOption[];
  onClose: () => void;
  onCreated: (request: EventRequest) => void;
}

interface Values {
  source: EventRequestSource;
  contactName: string;
  organizationName: string;
  phone: string;
  email: string;
  outreachType: string;
  description: string;
  audienceSize: string;
  ageGroup: string;
  dateFlexibility: DateFlexibility;
  earliestDate: string;
  latestDate: string;
  timeframe: string;
  timeOfDay: TimeOfDay;
  venuePreference: VenuePreference;
  venueAddress: string;
  specialRequests: string;
  coordinatorId: string;
  notifyRequester: boolean;
}

const INITIAL: Values = {
  source: 'phone',
  contactName: '',
  organizationName: '',
  phone: '',
  email: '',
  outreachType: '',
  description: '',
  audienceSize: '',
  ageGroup: '',
  dateFlexibility: 'flexible',
  earliestDate: '',
  latestDate: '',
  timeframe: '',
  timeOfDay: 'flexible',
  venuePreference: 'their_location',
  venueAddress: '',
  specialRequests: '',
  coordinatorId: '',
  notifyRequester: true,
};

type Field =
  | 'contactName'
  | 'phone'
  | 'email'
  | 'outreachType'
  | 'description'
  | 'audienceSize'
  | 'earliestDate'
  | 'latestDate'
  | 'venueAddress';

/** In page order, so the first failing field takes focus. Keys are EventRequestStaffCreate's. */
const FIELDS: FieldSpecs<Field> = {
  contactName: { id: 'new-request-name', label: 'Requester name', apiKeys: ['contact_name'] },
  phone: { id: 'new-request-phone', label: 'Phone', apiKeys: ['contact_phone'] },
  email: { id: 'new-request-email', label: 'Email', apiKeys: ['contact_email'] },
  outreachType: { id: 'new-request-type', label: 'Type of event', apiKeys: ['outreach_type'] },
  description: { id: 'new-request-description', label: 'What they asked for', apiKeys: ['description'] },
  audienceSize: { id: 'new-request-audience', label: 'Expected audience', apiKeys: ['audience_size'] },
  earliestDate: { id: 'new-request-earliest', label: 'Earliest date', apiKeys: ['preferred_date_start'] },
  latestDate: { id: 'new-request-latest', label: 'Latest date', apiKeys: ['preferred_date_end'] },
  venueAddress: { id: 'new-request-address', label: 'Address', apiKeys: ['venue_address'] },
};

const FLEXIBILITY_OPTIONS: { value: DateFlexibility; label: string }[] = [
  { value: 'specific_dates', label: 'They named dates' },
  { value: 'general_timeframe', label: 'A general timeframe' },
  { value: 'flexible', label: 'Flexible — we pick' },
];

const TIME_OF_DAY_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: 'flexible', label: 'Any time' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
];

const VENUE_OPTIONS: { value: VenuePreference; label: string }[] = [
  { value: 'their_location', label: 'At their location' },
  { value: 'our_station', label: 'At our station' },
  { value: 'either', label: 'Either' },
];

/** The checks the server makes too, run first so each reason sits on its field. */
function validateNewRequest(values: Values): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {};
  if (!values.contactName.trim()) errors.contactName = 'Enter who the request is from.';
  const phone = values.phone.trim();
  const email = values.email.trim();
  if (!phone && !email) {
    errors.phone = 'Enter a phone number or an email address.';
  }
  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter an email address like name@example.org.';
  if (!values.outreachType) errors.outreachType = 'Choose the type of event.';
  if (!values.description.trim()) errors.description = 'Note what they asked for.';
  const audience = values.audienceSize.trim();
  if (audience) {
    const count = Number(audience);
    if (!Number.isInteger(count) || count < 1 || count > 10000) {
      errors.audienceSize = 'Enter a whole number from 1 to 10,000.';
    }
  }
  if (values.dateFlexibility === 'specific_dates') {
    if (!values.earliestDate && !values.latestDate) {
      errors.earliestDate = 'Enter at least one date, or choose a timeframe instead.';
    }
    // ISO dates compare correctly as strings.
    if (values.earliestDate && values.latestDate && values.latestDate < values.earliestDate) {
      errors.latestDate = 'The latest date cannot be before the earliest.';
    }
  }
  return errors;
}

const NewRequestDialog: React.FC<NewRequestDialogProps> = ({ outreachTypes, coordinators, onClose, onCreated }) => {
  const [values, setValues] = useState<Values>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const { errors, formError, setErrors, setError, setFromApiError, focusFirst, summary, clear } =
    useFieldErrors(FIELDS);
  const requestClose = useDiscardGuard({ isDirty: values !== INITIAL, onClose });

  const typeOptions = useMemo(() => Object.entries(outreachTypes), [outreachTypes]);
  const hasEmail = values.email.trim() !== '';

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // An open flag clears as soon as its field is edited; the rest stay.
    if (key in FIELDS) setError(key as Field, null);
    if (key === 'email') setError('phone', null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateNewRequest(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFocusKey((k) => k + 1);
      focusFirst(found);
      return;
    }
    clear();
    setSaving(true);
    const specific = values.dateFlexibility === 'specific_dates';
    try {
      const created = await eventRequestService.createRequest({
        source: values.source,
        contact_name: values.contactName.trim(),
        contact_email: values.email.trim() || undefined,
        contact_phone: values.phone.trim() || undefined,
        organization_name: values.organizationName.trim() || undefined,
        outreach_type: values.outreachType,
        description: values.description.trim(),
        date_flexibility: values.dateFlexibility,
        preferred_date_start: (specific && values.earliestDate) || undefined,
        preferred_date_end: (specific && values.latestDate) || undefined,
        preferred_timeframe: (values.dateFlexibility === 'general_timeframe' && values.timeframe.trim()) || undefined,
        preferred_time_of_day: values.timeOfDay,
        audience_size: values.audienceSize.trim() ? Number(values.audienceSize) : undefined,
        age_group: values.ageGroup.trim() || undefined,
        venue_preference: values.venuePreference,
        venue_address: values.venueAddress.trim() || undefined,
        special_requests: values.specialRequests.trim() || undefined,
        assigned_to: values.coordinatorId || undefined,
        notify_requester: hasEmail && values.notifyRequester,
      });
      onCreated(created);
    } catch (err: unknown) {
      const placed = setFromApiError(err, 'Could not save the request. Try again.');
      setFocusKey((k) => k + 1);
      focusFirst(placed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="New request"
      size="lg"
      noValidate
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add request'}
          </button>
          <button type="button" className="btn-secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-theme-text-muted text-sm">
          For a request that came in by phone, email or in person. It goes on the board like one from the public form.
        </p>
        <ErrorSummary items={summary} formError={formError} focusKey={focusKey} />

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Who asked</legend>
          <div>
            <label htmlFor="new-request-source" className="form-label">
              How it came in
            </label>
            <select
              id="new-request-source"
              className="form-input"
              value={values.source}
              onChange={(e) => set('source', e.target.value as EventRequestSource)}
            >
              {STAFF_ENTERED_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {EVENT_REQUEST_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              id={FIELDS.contactName.id}
              label="Requester name"
              required
              error={errors.contactName}
              maxLength={255}
              count={values.contactName.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  className="form-input"
                  autoComplete="off"
                  value={values.contactName}
                  onChange={(e) => set('contactName', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Organization" optional maxLength={255} count={values.organizationName.length}>
              {(field) => (
                <input
                  {...field}
                  type="text"
                  className="form-input"
                  autoComplete="off"
                  value={values.organizationName}
                  onChange={(e) => set('organizationName', e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id={FIELDS.phone.id}
              label="Phone"
              error={errors.phone}
              hint="A phone number, an email, or both."
              maxLength={50}
            >
              {(field) => (
                <input
                  {...field}
                  type="tel"
                  className="form-input"
                  autoComplete="off"
                  value={values.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              )}
            </FormField>
            <FormField id={FIELDS.email.id} label="Email" error={errors.email} maxLength={255}>
              {(field) => (
                <input
                  {...field}
                  type="email"
                  className="form-input"
                  autoComplete="off"
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">What they asked for</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id={FIELDS.outreachType.id} label="Type of event" required error={errors.outreachType}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={values.outreachType}
                  onChange={(e) => set('outreachType', e.target.value)}
                >
                  <option value="">Choose a type…</option>
                  {typeOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id={FIELDS.audienceSize.id} label="Expected audience" optional error={errors.audienceSize}>
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  className="form-input"
                  value={values.audienceSize}
                  onChange={(e) => set('audienceSize', e.target.value)}
                />
              )}
            </FormField>
          </div>
          <FormField
            id={FIELDS.description.id}
            label="What they asked for"
            required
            error={errors.description}
            maxLength={2000}
            count={values.description.length}
          >
            {(field) => (
              <textarea
                {...field}
                rows={3}
                className="form-input"
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Age group" optional maxLength={100} count={values.ageGroup.length}>
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input"
                placeholder="e.g. K-5 and parents"
                value={values.ageGroup}
                onChange={(e) => set('ageGroup', e.target.value)}
              />
            )}
          </FormField>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">When and where</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Dates">
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={values.dateFlexibility}
                  onChange={(e) => set('dateFlexibility', e.target.value as DateFlexibility)}
                >
                  {FLEXIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Time of day">
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={values.timeOfDay}
                  onChange={(e) => set('timeOfDay', e.target.value as TimeOfDay)}
                >
                  {TIME_OF_DAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {values.dateFlexibility === 'specific_dates' && (
              <>
                <FormField id={FIELDS.earliestDate.id} label="Earliest date" error={errors.earliestDate}>
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      className="form-input"
                      value={values.earliestDate}
                      onChange={(e) => set('earliestDate', e.target.value)}
                    />
                  )}
                </FormField>
                <FormField id={FIELDS.latestDate.id} label="Latest date" optional error={errors.latestDate}>
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      className="form-input"
                      value={values.latestDate}
                      onChange={(e) => set('latestDate', e.target.value)}
                    />
                  )}
                </FormField>
              </>
            )}
            {values.dateFlexibility === 'general_timeframe' && (
              <FormField
                label="Timeframe"
                optional
                className="sm:col-span-2"
                maxLength={500}
                count={values.timeframe.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    className="form-input"
                    placeholder="e.g. A Saturday morning in March"
                    value={values.timeframe}
                    onChange={(e) => set('timeframe', e.target.value)}
                  />
                )}
              </FormField>
            )}
            <FormField label="Where">
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={values.venuePreference}
                  onChange={(e) => set('venuePreference', e.target.value as VenuePreference)}
                >
                  {VENUE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
          {values.venuePreference !== 'our_station' && (
            <FormField
              id={FIELDS.venueAddress.id}
              label="Address"
              optional
              error={errors.venueAddress}
              maxLength={500}
              count={values.venueAddress.length}
            >
              {(field) => (
                <textarea
                  {...field}
                  rows={2}
                  className="form-input"
                  value={values.venueAddress}
                  onChange={(e) => set('venueAddress', e.target.value)}
                />
              )}
            </FormField>
          )}
          <FormField label="Special requests" optional maxLength={2000} count={values.specialRequests.length}>
            {(field) => (
              <textarea
                {...field}
                rows={2}
                className="form-input"
                value={values.specialRequests}
                onChange={(e) => set('specialRequests', e.target.value)}
              />
            )}
          </FormField>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Handling</legend>
          <FormField label="Coordinator" hint="Left on the default, it goes to the department's default coordinator.">
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={values.coordinatorId}
                onChange={(e) => set('coordinatorId', e.target.value)}
              >
                <option value="">Department default</option>
                {coordinators.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={hasEmail && values.notifyRequester}
              disabled={!hasEmail}
              onChange={(e) => set('notifyRequester', e.target.checked)}
            />
            <span>
              <span className="text-theme-text-primary font-medium">Email the requester a confirmation</span>
              <span className="text-theme-text-muted block">
                {hasEmail
                  ? 'Untick it if you have already told them everything on the call.'
                  : 'Needs an email address. Without one, copy the status link from the request and send it yourself.'}
              </span>
            </span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
};

export default NewRequestDialog;
