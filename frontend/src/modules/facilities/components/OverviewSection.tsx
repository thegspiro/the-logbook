/**
 * OverviewSection — Displays and edits core facility details.
 *
 * Split into OverviewViewMode and OverviewEditMode sub-components
 * for clarity and maintainability.
 */

import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Pencil, Save, X, MapPin, Phone, Mail, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { Facility, FacilityType, FacilityStatus } from '../types';
import { inputCls, labelCls } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { blankToNull, numberOrNull } from '@/utils/formValues';
import { organizationEmailError } from '@/utils/organizationProfile';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '@/hooks/useFieldErrors';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { firstRefused, saveExceptRefused } from '@/utils/saveExceptRefused';

interface Props {
  facility: Facility;
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  canManage: boolean;
}

type OverviewField =
  | 'name'
  | 'facility_number'
  | 'facility_type_id'
  | 'status_id'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state'
  | 'zip_code'
  | 'county'
  | 'phone'
  | 'fax'
  | 'email'
  | 'year_built'
  | 'square_footage'
  | 'num_floors'
  | 'num_bays'
  | 'max_occupancy'
  | 'sleeping_quarters'
  | 'description'
  | 'notes';

// Ordered as on screen, so the first refusal takes focus. The ids are the
// ones this form has always used.
const OVERVIEW_FIELDS: FieldSpecs<OverviewField> = {
  name: { id: 'facility-edit-name', label: 'Name' },
  facility_number: { id: 'facility-edit-facility-number', label: 'Facility Number' },
  facility_type_id: { id: 'facility-edit-facility-type-id', label: 'Type' },
  status_id: { id: 'facility-edit-status-id', label: 'Status' },
  address_line1: { id: 'facility-edit-address-line1', label: 'Address Line 1' },
  address_line2: { id: 'facility-edit-address-line2', label: 'Address Line 2' },
  city: { id: 'facility-edit-city', label: 'City' },
  state: { id: 'facility-edit-state', label: 'State' },
  zip_code: { id: 'facility-edit-zip-code', label: 'Zip Code' },
  county: { id: 'facility-edit-county', label: 'County' },
  phone: { id: 'facility-edit-phone', label: 'Phone' },
  fax: { id: 'facility-edit-fax', label: 'Fax' },
  email: { id: 'facility-edit-email', label: 'Email' },
  year_built: { id: 'facility-edit-year-built', label: 'Year Built' },
  square_footage: { id: 'facility-edit-square-footage', label: 'Sq. Footage' },
  num_floors: { id: 'facility-edit-num-floors', label: 'Floors' },
  num_bays: { id: 'facility-edit-num-bays', label: 'Apparatus Bays' },
  max_occupancy: { id: 'facility-edit-max-occupancy', label: 'Max Occupancy' },
  sleeping_quarters: { id: 'facility-edit-sleeping-quarters', label: 'Sleeping Quarters' },
  description: { id: 'facility-edit-description', label: 'Description' },
  notes: { id: 'facility-edit-notes', label: 'Notes' },
};
const OVERVIEW_ORDER = Object.keys(OVERVIEW_FIELDS) as OverviewField[];

// Mirrors FacilityUpdate (forms review F-2).
const TEXT_LIMITS: Partial<Record<OverviewField, number>> = {
  name: 200,
  facility_number: 50,
  address_line1: 200,
  address_line2: 200,
  city: 100,
  state: 50,
  zip_code: 20,
  county: 100,
  phone: 50,
  fax: 50,
  email: 200,
};

/** Whole-number fields and the range FacilityUpdate accepts for each. */
const NUMBER_RANGES: Partial<Record<OverviewField, { min: number; max?: number; message: string }>> = {
  year_built: { min: 1800, max: 2100, message: 'Enter a year from 1800 to 2100, or leave it empty.' },
  square_footage: { min: 0, message: 'Enter a whole number, 0 or more, or leave it empty.' },
  num_floors: { min: 1, message: 'Enter a whole number, 1 or more, or leave it empty.' },
  num_bays: { min: 0, message: 'Enter a whole number, 0 or more, or leave it empty.' },
  max_occupancy: { min: 0, message: 'Enter a whole number, 0 or more, or leave it empty.' },
  sleeping_quarters: { min: 0, message: 'Enter a whole number, 0 or more, or leave it empty.' },
};
const NUMERIC_FIELDS = new Set<string>(Object.keys(NUMBER_RANGES));

/**
 * The lookup options this facility can be saved with.
 *
 * The store loads active types and statuses only, so that deactivating one on
 * the settings screen actually stops it being chosen. But an existing facility
 * still references whatever it was filed under, and dropping that option from
 * the editor left the select showing its blank placeholder against a NOT NULL
 * column: an unrelated edit either could not be saved ("Facility type is
 * required") or quietly re-filed the station under something else.
 *
 * So the retained value is added back for this facility only, marked, and the
 * choice stays out of every other facility's list.
 */
interface LookupOption {
  id: string;
  name: string;
}

function withRetainedOption<T extends LookupOption>(
  active: T[],
  current: T | undefined,
  currentId: string | undefined
): LookupOption[] {
  if (!currentId || active.some((option) => option.id === currentId)) return active;
  return [...active, { id: currentId, name: current ? `${current.name} (inactive)` : 'Current value (inactive)' }];
}

/**
 * Columns the facility row declares NOT NULL. Both selects offer a blank
 * "Select type..." option, so the form can present a value the column cannot
 * hold; caught here rather than sent as a null the backend has to refuse.
 */
const REQUIRED_FIELDS: Partial<Record<OverviewField, string>> = {
  name: 'Enter a name for the facility.',
  facility_type_id: 'Choose the facility type.',
  status_id: 'Choose the facility status.',
};

function facilityToEditData(facility: Facility): Record<OverviewField, string | number> {
  return {
    name: facility.name || '',
    facility_number: facility.facilityNumber || '',
    address_line1: facility.addressLine1 || '',
    address_line2: facility.addressLine2 || '',
    city: facility.city || '',
    state: facility.state || '',
    zip_code: facility.zipCode || '',
    county: facility.county || '',
    facility_type_id: facility.facilityTypeId || '',
    status_id: facility.statusId || '',
    phone: facility.phone || '',
    fax: facility.fax || '',
    email: facility.email || '',
    // `??`, not `||`, for every NUMERIC_FIELDS member: a stored 0 is a real
    // answer — a station with no bays, no bunks, no second floor — and `||`
    // turned it into '', which handleSave then sends as an explicit null.
    // Opening the editor and pressing Save wiped every zero on the record.
    year_built: facility.yearBuilt ?? '',
    square_footage: facility.squareFootage ?? '',
    num_floors: facility.numFloors ?? '',
    num_bays: facility.numBays ?? '',
    max_occupancy: facility.maxOccupancy ?? '',
    sleeping_quarters: facility.sleepingQuarters ?? '',
    notes: facility.notes || '',
    description: facility.description || '',
  };
}

export default function OverviewSection({ facility, facilityTypes, facilityStatuses, canManage }: Props) {
  const tz = useTimezone();
  const { updateFacility } = useFacilitiesStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<Record<string, string | number>>({});
  // What the form held when it opened (or last saved), so Cancel asks before
  // throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<Record<string, string | number>>({});
  const overviewErrors = useFieldErrors(OVERVIEW_FIELDS);

  const startEditing = () => {
    const seeded = facilityToEditData(facility);
    setEditData(seeded);
    setBaseline(seeded);
    overviewErrors.clear();
    setIsEditing(true);
  };

  const stopEditing = () => {
    overviewErrors.clear();
    setIsEditing(false);
  };
  const requestCancel = useDiscardGuard({
    isDirty: isEditing && JSON.stringify(editData) !== JSON.stringify(baseline),
    onClose: stopEditing,
  });

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    // Named on the field rather than in a toast that vanished (forms review F-3).
    const problems: FieldErrors<OverviewField> = {};
    for (const [field, message] of Object.entries(REQUIRED_FIELDS) as [OverviewField, string][]) {
      if (!String(editData[field] ?? '').trim()) problems[field] = message;
    }
    // The server accepts any string here, so a mistyped address is caught
    // before it is saved rather than shown back on the overview.
    const emailError = organizationEmailError(String(editData.email ?? ''));
    if (emailError) problems.email = emailError;
    for (const [field, range] of Object.entries(NUMBER_RANGES) as [
      OverviewField,
      { min: number; max?: number; message: string },
    ][]) {
      const raw = String(editData[field] ?? '').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < range.min || (range.max !== undefined && n > range.max))
        problems[field] = range.message;
    }
    overviewErrors.setFormError(null);
    overviewErrors.setErrors(problems);
    setIsSaving(true);
    try {
      // An update payload, so a cleared box is an explicit `null` and not
      // `undefined`: JSON.stringify drops an undefined value entirely, the key
      // never leaves the browser, and the backend's `exclude_unset` dump reads
      // the absence as "leave this alone". Clearing a facility's phone number
      // or its notes used to be a no-op behind a success toast.
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(editData)) {
        if (key in REQUIRED_FIELDS) {
          payload[key] = typeof value === 'string' ? value.trim() : value;
        } else if (NUMERIC_FIELDS.has(key)) {
          payload[key] = numberOrNull(value);
        } else {
          payload[key] = blankToNull(String(value));
        }
      }

      // An edit saves the rest and keeps a refused field's stored value
      // (owner rule, 2026-11-05): a blank type or a mistyped email no longer
      // holds back the phone number changed beside it.
      const { refused } = await saveExceptRefused<OverviewField, unknown>({
        payload,
        refused: problems,
        send: (body) => updateFacility(facility.id, body),
        place: (err) => placeApiError(OVERVIEW_FIELDS, err),
      });
      const first = firstRefused(OVERVIEW_ORDER, refused);
      if (first) {
        // The form stays open with the refused field flagged; only that field
        // still counts as unsaved.
        overviewErrors.setErrors(refused);
        overviewErrors.setFormError(
          `Facility saved, except ${OVERVIEW_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
        );
        overviewErrors.focusFirst(refused);
        const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k] ?? '']));
        setBaseline({ ...editData, ...keep });
        return;
      }
      toast.success('Facility updated');
      stopEditing();
    } catch (error) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the form.
      overviewErrors.focusFirst(overviewErrors.setFromApiError(error, 'Failed to update facility'));
    } finally {
      setIsSaving(false);
    }
  };

  const ed = (field: OverviewField) => String(editData[field] ?? '');
  const setEd = (field: OverviewField, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
    overviewErrors.setError(field, null);
  };

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">Facility Details</h2>
        {!isEditing ? (
          canManage ? (
            <button
              onClick={startEditing}
              className="text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          ) : null
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="submit"
              form="facility-overview-form"
              disabled={isSaving}
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
            <button
              type="button"
              onClick={requestCancel}
              className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        )}
      </div>

      <div className="p-4">
        {!isEditing ? (
          <OverviewViewMode facility={facility} tz={tz} />
        ) : (
          <form id="facility-overview-form" noValidate onSubmit={(e) => void handleSave(e)}>
            {overviewErrors.formError && (
              <p role="alert" className={`mb-4 text-sm ${FIELD_ERROR_CLASS}`}>
                {overviewErrors.formError}
              </p>
            )}
            <OverviewEditMode
              ed={ed}
              setEd={setEd}
              errors={overviewErrors.errors}
              facilityTypes={withRetainedOption(facilityTypes, facility.facilityType, facility.facilityTypeId)}
              facilityStatuses={withRetainedOption(facilityStatuses, facility.statusRecord, facility.statusId)}
            />
          </form>
        )}
      </div>
    </div>
  );
}

function OverviewViewMode({ facility, tz }: { facility: Facility; tz: string }) {
  const address = [facility.addressLine1, facility.city, facility.state, facility.zipCode].filter(Boolean).join(', ');

  return (
    <div className="space-y-5">
      {address && (
        <div className="flex items-start gap-2.5">
          <MapPin className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-theme-text-primary text-sm">{address}</p>
            {facility.addressLine2 && <p className="text-theme-text-secondary text-sm">{facility.addressLine2}</p>}
            {facility.county && <p className="text-theme-text-muted mt-0.5 text-xs">{facility.county} County</p>}
          </div>
        </div>
      )}

      {(facility.phone || facility.fax || facility.email) && (
        <div className="text-theme-text-secondary flex flex-wrap items-center gap-4 text-sm">
          {facility.phone && (
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              {facility.phone}
            </span>
          )}
          {facility.fax && (
            <span className="text-theme-text-muted flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Fax: {facility.fax}
            </span>
          )}
          {facility.email && (
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {facility.email}
            </span>
          )}
        </div>
      )}

      {(facility.yearBuilt ||
        facility.squareFootage ||
        facility.numFloors ||
        facility.numBays ||
        facility.maxOccupancy ||
        facility.sleepingQuarters) && (
        <div className="bg-theme-surface-hover/50 grid grid-cols-2 gap-4 rounded-lg p-4 sm:grid-cols-3 lg:grid-cols-6">
          {facility.yearBuilt != null && <InfoItem label="Year Built" value={String(facility.yearBuilt)} />}
          {facility.squareFootage != null && (
            <InfoItem label="Sq. Footage" value={formatNumber(facility.squareFootage)} />
          )}
          {facility.numFloors != null && <InfoItem label="Floors" value={String(facility.numFloors)} />}
          {facility.numBays != null && <InfoItem label="Apparatus Bays" value={String(facility.numBays)} />}
          {facility.maxOccupancy != null && <InfoItem label="Max Occupancy" value={String(facility.maxOccupancy)} />}
          {facility.sleepingQuarters != null && (
            <InfoItem label="Sleeping Quarters" value={String(facility.sleepingQuarters)} />
          )}
        </div>
      )}

      {facility.description && (
        <div>
          <p className="text-theme-text-muted mb-1 text-xs font-medium">Description</p>
          <p className="text-theme-text-secondary text-sm">{facility.description}</p>
        </div>
      )}
      {facility.notes && (
        <div>
          <p className="text-theme-text-muted mb-1 text-xs font-medium">Notes</p>
          <p className="text-theme-text-muted text-sm italic">{facility.notes}</p>
        </div>
      )}

      <div className="text-theme-text-muted border-theme-surface-border flex items-center gap-4 border-t pt-2 text-xs">
        <span>Created: {formatDate(facility.createdAt, tz)}</span>
        <span>Updated: {formatDate(facility.updatedAt, tz)}</span>
      </div>
    </div>
  );
}

interface EditModeProps {
  ed: (field: OverviewField) => string;
  setEd: (field: OverviewField, value: string) => void;
  errors: FieldErrors<OverviewField>;
  // Already resolved by the parent — the active lookups plus, when this
  // facility references a deactivated one, that value kept selectable.
  facilityTypes: LookupOption[];
  facilityStatuses: LookupOption[];
}

function OverviewEditMode({ ed, setEd, errors, facilityTypes, facilityStatuses }: EditModeProps) {
  // The email is checked as it is typed, as it always was here; a refusal
  // from a save takes its place until the box is edited.
  const shown: FieldErrors<OverviewField> = { ...errors };
  const typedEmailError = organizationEmailError(ed('email'));
  if (!shown.email && typedEmailError) shown.email = typedEmailError;
  const text = (field: OverviewField, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}): ReactNode => (
    <FormField
      id={OVERVIEW_FIELDS[field].id}
      label={OVERVIEW_FIELDS[field].label}
      required={field in REQUIRED_FIELDS}
      error={shown[field]}
      labelClassName={labelCls}
      {...(TEXT_LIMITS[field] !== undefined ? { maxLength: TEXT_LIMITS[field], count: ed(field).length } : {})}
    >
      {(props) => (
        <input
          {...props}
          type="text"
          value={ed(field)}
          onChange={(e) => setEd(field, e.target.value)}
          className={inputCls}
          {...extra}
        />
      )}
    </FormField>
  );
  const number = (field: OverviewField): ReactNode => (
    <FormField
      id={OVERVIEW_FIELDS[field].id}
      label={OVERVIEW_FIELDS[field].label}
      error={shown[field]}
      labelClassName={labelCls}
    >
      {(props) => (
        <input
          {...props}
          type="number"
          inputMode="numeric"
          value={ed(field)}
          onChange={(e) => setEd(field, e.target.value)}
          className={inputCls}
        />
      )}
    </FormField>
  );
  const lookup = (field: 'facility_type_id' | 'status_id', options: LookupOption[], blank: string): ReactNode => (
    <FormField
      id={OVERVIEW_FIELDS[field].id}
      label={OVERVIEW_FIELDS[field].label}
      required
      error={shown[field]}
      labelClassName={labelCls}
    >
      {(props) => (
        <select {...props} value={ed(field)} onChange={(e) => setEd(field, e.target.value)} className={inputCls}>
          <option value="">{blank}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
  const area = (field: 'description' | 'notes'): ReactNode => (
    <FormField
      id={OVERVIEW_FIELDS[field].id}
      label={OVERVIEW_FIELDS[field].label}
      error={shown[field]}
      labelClassName={labelCls}
    >
      {(props) => (
        <textarea
          {...props}
          value={ed(field)}
          onChange={(e) => setEd(field, e.target.value)}
          rows={2}
          className={inputCls + ' resize-none'}
        />
      )}
    </FormField>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('name')}
        {text('facility_number', { placeholder: 'e.g., STA-01' })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {lookup('facility_type_id', facilityTypes, 'Select type...')}
        {lookup('status_id', facilityStatuses, 'Select status...')}
      </div>

      {text('address_line1')}
      {text('address_line2')}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {text('city')}
        {text('state')}
        {text('zip_code', { inputMode: 'numeric', autoComplete: 'postal-code' })}
        {text('county')}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {text('phone', { type: 'tel', autoComplete: 'tel' })}
        {text('fax', { type: 'tel' })}
        {text('email', { type: 'email', autoComplete: 'email' })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {number('year_built')}
        {number('square_footage')}
        {number('num_floors')}
        {number('num_bays')}
        {number('max_occupancy')}
        {number('sleeping_quarters')}
      </div>

      {area('description')}
      {area('notes')}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-theme-text-muted text-xs">{label}</p>
      <p className="text-theme-text-primary text-sm font-medium">{value}</p>
    </div>
  );
}
