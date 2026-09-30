/**
 * OverviewSection — Displays and edits core facility details.
 *
 * Split into OverviewViewMode and OverviewEditMode sub-components
 * for clarity and maintainability.
 */

import { useState } from 'react';
import { Pencil, Save, X, MapPin, Phone, Mail, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { Facility, FacilityType, FacilityStatus } from '../types';
import { inputCls, labelCls } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { blankToNull, numberOrNull } from '@/utils/formValues';
import { organizationEmailError } from '@/utils/organizationProfile';
import { getErrorMessage } from '@/utils/errorHandling';

interface Props {
  facility: Facility;
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  canManage: boolean;
}

const NUMERIC_FIELDS = new Set([
  'year_built',
  'square_footage',
  'num_floors',
  'num_bays',
  'max_occupancy',
  'sleeping_quarters',
]);

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
const REQUIRED_FIELDS: Record<string, string> = {
  name: 'Facility name is required',
  facility_type_id: 'Facility type is required',
  status_id: 'Facility status is required',
};

function facilityToEditData(facility: Facility): Record<string, string | number> {
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

  const startEditing = () => {
    setEditData(facilityToEditData(facility));
    setIsEditing(true);
  };

  // The server accepts any string here, so a mistyped address is caught
  // before it is saved rather than shown back on the overview.
  const emailError = isEditing ? organizationEmailError(String(editData.email ?? '')) : null;

  const handleSave = async () => {
    for (const [field, message] of Object.entries(REQUIRED_FIELDS)) {
      if (!String(editData[field] ?? '').trim()) {
        toast.error(message);
        return;
      }
    }
    if (emailError) {
      toast.error(emailError);
      return;
    }
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

      await updateFacility(facility.id, payload);
      toast.success('Facility updated');
      setIsEditing(false);
    } catch (error) {
      // The generic message hid the reason: with real nulls now going out, a
      // rejection names the field, and swallowing that leaves the user
      // retrying the same save.
      toast.error(getErrorMessage(error, 'Failed to update facility'));
    } finally {
      setIsSaving(false);
    }
  };

  const ed = (field: string) => editData[field] as string;
  const setEd = (field: string, value: string) => setEditData((prev) => ({ ...prev, [field]: value }));

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
              onClick={() => {
                void handleSave();
              }}
              disabled={isSaving}
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
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
          <OverviewEditMode
            ed={ed}
            setEd={setEd}
            facilityTypes={withRetainedOption(facilityTypes, facility.facilityType, facility.facilityTypeId)}
            facilityStatuses={withRetainedOption(facilityStatuses, facility.statusRecord, facility.statusId)}
          />
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
  ed: (field: string) => string;
  setEd: (field: string, value: string) => void;
  // Already resolved by the parent — the active lookups plus, when this
  // facility references a deactivated one, that value kept selectable.
  facilityTypes: LookupOption[];
  facilityStatuses: LookupOption[];
}

function OverviewEditMode({ ed, setEd, facilityTypes, facilityStatuses }: EditModeProps) {
  const emailError = organizationEmailError(ed('email'));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="facility-edit-name" className={labelCls}>
            Name *
          </label>
          <input
            id="facility-edit-name"
            type="text"
            value={ed('name')}
            onChange={(e) => setEd('name', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-facility-number" className={labelCls}>
            Facility Number
          </label>
          <input
            id="facility-edit-facility-number"
            type="text"
            value={ed('facility_number')}
            onChange={(e) => setEd('facility_number', e.target.value)}
            className={inputCls}
            placeholder="e.g., STA-01"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="facility-edit-facility-type-id" className={labelCls}>
            Type *
          </label>
          <select
            id="facility-edit-facility-type-id"
            value={ed('facility_type_id')}
            onChange={(e) => setEd('facility_type_id', e.target.value)}
            className={inputCls}
          >
            <option value="">Select type...</option>
            {facilityTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="facility-edit-status-id" className={labelCls}>
            Status *
          </label>
          <select
            id="facility-edit-status-id"
            value={ed('status_id')}
            onChange={(e) => setEd('status_id', e.target.value)}
            className={inputCls}
          >
            <option value="">Select status...</option>
            {facilityStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="facility-edit-address-line1" className={labelCls}>
          Address Line 1
        </label>
        <input
          id="facility-edit-address-line1"
          type="text"
          value={ed('address_line1')}
          onChange={(e) => setEd('address_line1', e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="facility-edit-address-line2" className={labelCls}>
          Address Line 2
        </label>
        <input
          id="facility-edit-address-line2"
          type="text"
          value={ed('address_line2')}
          onChange={(e) => setEd('address_line2', e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="facility-edit-city" className={labelCls}>
            City
          </label>
          <input
            id="facility-edit-city"
            type="text"
            value={ed('city')}
            onChange={(e) => setEd('city', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-state" className={labelCls}>
            State
          </label>
          <input
            id="facility-edit-state"
            type="text"
            value={ed('state')}
            onChange={(e) => setEd('state', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-zip-code" className={labelCls}>
            Zip Code
          </label>
          <input
            id="facility-edit-zip-code"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={ed('zip_code')}
            onChange={(e) => setEd('zip_code', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-county" className={labelCls}>
            County
          </label>
          <input
            id="facility-edit-county"
            type="text"
            value={ed('county')}
            onChange={(e) => setEd('county', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="facility-edit-phone" className={labelCls}>
            Phone
          </label>
          <input
            id="facility-edit-phone"
            type="text"
            value={ed('phone')}
            onChange={(e) => setEd('phone', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-fax" className={labelCls}>
            Fax
          </label>
          <input
            id="facility-edit-fax"
            type="text"
            value={ed('fax')}
            onChange={(e) => setEd('fax', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-email" className={labelCls}>
            Email
          </label>
          <input
            id="facility-edit-email"
            type="text"
            value={ed('email')}
            onChange={(e) => setEd('email', e.target.value)}
            className={inputCls}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? 'facility-edit-email-error' : undefined}
          />
          {emailError && (
            <p id="facility-edit-email-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {emailError}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="facility-edit-year-built" className={labelCls}>
            Year Built
          </label>
          <input
            id="facility-edit-year-built"
            type="number"
            value={ed('year_built')}
            onChange={(e) => setEd('year_built', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-square-footage" className={labelCls}>
            Sq. Footage
          </label>
          <input
            id="facility-edit-square-footage"
            type="number"
            value={ed('square_footage')}
            onChange={(e) => setEd('square_footage', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-num-floors" className={labelCls}>
            Floors
          </label>
          <input
            id="facility-edit-num-floors"
            type="number"
            value={ed('num_floors')}
            onChange={(e) => setEd('num_floors', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-num-bays" className={labelCls}>
            Apparatus Bays
          </label>
          <input
            id="facility-edit-num-bays"
            type="number"
            value={ed('num_bays')}
            onChange={(e) => setEd('num_bays', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-max-occupancy" className={labelCls}>
            Max Occupancy
          </label>
          <input
            id="facility-edit-max-occupancy"
            type="number"
            value={ed('max_occupancy')}
            onChange={(e) => setEd('max_occupancy', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="facility-edit-sleeping-quarters" className={labelCls}>
            Sleeping Quarters
          </label>
          <input
            id="facility-edit-sleeping-quarters"
            type="number"
            value={ed('sleeping_quarters')}
            onChange={(e) => setEd('sleeping_quarters', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="facility-edit-description" className={labelCls}>
          Description
        </label>
        <textarea
          id="facility-edit-description"
          value={ed('description')}
          onChange={(e) => setEd('description', e.target.value)}
          rows={2}
          className={inputCls + ' resize-none'}
        />
      </div>
      <div>
        <label htmlFor="facility-edit-notes" className={labelCls}>
          Notes
        </label>
        <textarea
          id="facility-edit-notes"
          value={ed('notes')}
          onChange={(e) => setEd('notes', e.target.value)}
          rows={2}
          className={inputCls + ' resize-none'}
        />
      </div>
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
