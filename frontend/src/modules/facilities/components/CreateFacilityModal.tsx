/**
 * CreateFacilityModal — Modal dialog for adding a new facility.
 */

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { organizationEmailError } from '../../../utils/organizationProfile';
import type { FacilityCreate } from '../../../services/facilitiesServices';
import type { Facility, FacilityType, FacilityStatus } from '../types';

interface Props {
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  onClose: () => void;
  onCreated: (facility: Facility) => void;
}

const EMPTY = {
  name: '',
  facility_number: '',
  address_line1: '',
  city: '',
  state: '',
  zip_code: '',
  phone: '',
  email: '',
  facility_type_id: '',
  status_id: '',
  notes: '',
};

type FacilityField = keyof typeof EMPTY;

/**
 * How the facility create endpoint's field names land on this dialog (forms
 * review F-2), in screen order. Lengths are `FacilityBase`'s max_length.
 */
const FACILITY_FIELDS: Record<FacilityField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 200 },
  facility_number: { label: 'Facility number', maxLength: 50 },
  address_line1: { label: 'Address', maxLength: 200 },
  city: { label: 'City', maxLength: 100 },
  state: { label: 'State', maxLength: 50 },
  zip_code: { label: 'Zip code', maxLength: 20 },
  phone: { label: 'Phone', maxLength: 50 },
  email: { label: 'Email', maxLength: 200 },
  facility_type_id: { label: 'Type' },
  status_id: { label: 'Status' },
  notes: { label: 'Notes' },
};

// The ids the dialog has always used, so labels and focus keep their targets.
const IDS: Record<FacilityField, string> = {
  name: 'facility-name',
  facility_number: 'facility-facility-number',
  address_line1: 'facility-address',
  city: 'facility-city',
  state: 'facility-state',
  zip_code: 'facility-zip',
  phone: 'facility-phone',
  email: 'facility-email',
  facility_type_id: 'facility-type',
  status_id: 'facility-status',
  notes: 'facility-notes',
};

export default function CreateFacilityModal({ facilityTypes, facilityStatuses, onClose, onCreated }: Props) {
  const { createFacility } = useFacilitiesStore();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FacilityField, string>>>({});
  // The dialog mounts empty each time it opens, so anything typed is a change
  // that Escape, the X and Cancel ask about first (forms review F-6).
  const isDirty = (Object.keys(EMPTY) as FacilityField[]).some((k) => formData[k] !== EMPTY[k]);
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const setField = (field: FacilityField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  // The server accepts any string as the address, so the form checks it.
  const emailError = organizationEmailError(formData.email);

  const showErrors = (next: Partial<Record<FacilityField, string>>) => {
    setErrors(next);
    const first = (Object.keys(IDS) as FacilityField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<FacilityField, string>> = {};
    if (!formData.name.trim()) missing.name = 'Facility name is required.';
    if (emailError) missing.email = emailError;
    if (Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setIsCreating(true);
    try {
      // Use || to coerce empty strings to undefined (not ?? — see CLAUDE.md pitfall #1)
      const payload: FacilityCreate = {
        name: formData.name.trim(),
      };
      if (formData.facility_number.trim()) payload.facility_number = formData.facility_number.trim();
      if (formData.address_line1.trim()) payload.address_line1 = formData.address_line1.trim();
      if (formData.city.trim()) payload.city = formData.city.trim();
      if (formData.state.trim()) payload.state = formData.state.trim();
      if (formData.zip_code.trim()) payload.zip_code = formData.zip_code.trim();
      if (formData.facility_type_id) payload.facility_type_id = formData.facility_type_id;
      if (formData.status_id) payload.status_id = formData.status_id;
      if (formData.phone.trim()) payload.phone = formData.phone.trim();
      if (formData.email.trim()) payload.email = formData.email.trim();
      if (formData.notes.trim()) payload.notes = formData.notes.trim();

      const facility = await createFacility(payload);
      toast.success('Facility created');
      onCreated(facility);
    } catch (err) {
      // A refused field is flagged on that field rather than in a toast that
      // names nothing (forms review F-2); nothing is created until it is fixed.
      const mapped = mapServerFieldErrors(err, FACILITY_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to create facility'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  // autoComplete is off throughout: these are the station's address and
  // contacts, and the browser would offer the member's own.
  const inputCls = 'form-input py-2.5';

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Add Facility"
      titleId="create-facility-title"
      size="md"
      onSubmit={(e) => void handleCreate(e)}
      footer={
        <>
          <button type="submit" disabled={isCreating} className="btn-primary flex items-center gap-2 px-5">
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add Facility
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          label="Name"
          required
          error={errors.name}
          id={IDS.name}
          maxLength={FACILITY_FIELDS.name.maxLength}
          count={formData.name.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputCls}
              type="text"
              placeholder="e.g., Station 1"
              autoFocus
              value={formData.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Facility Number"
          error={errors.facility_number}
          id={IDS.facility_number}
          maxLength={FACILITY_FIELDS.facility_number.maxLength}
          count={formData.facility_number.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputCls}
              type="text"
              placeholder="e.g., STA-01"
              autoComplete="off"
              value={formData.facility_number}
              onChange={(e) => setField('facility_number', e.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Address"
          error={errors.address_line1}
          id={IDS.address_line1}
          maxLength={FACILITY_FIELDS.address_line1.maxLength}
          count={formData.address_line1.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputCls}
              type="text"
              placeholder="123 Main St"
              autoComplete="off"
              value={formData.address_line1}
              onChange={(e) => setField('address_line1', e.target.value)}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField
            label="City"
            error={errors.city}
            id={IDS.city}
            maxLength={FACILITY_FIELDS.city.maxLength}
            count={formData.city.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputCls}
                type="text"
                autoComplete="off"
                value={formData.city}
                onChange={(e) => setField('city', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="State"
            error={errors.state}
            id={IDS.state}
            maxLength={FACILITY_FIELDS.state.maxLength}
            count={formData.state.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputCls}
                type="text"
                autoComplete="off"
                value={formData.state}
                onChange={(e) => setField('state', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Zip Code"
            error={errors.zip_code}
            id={IDS.zip_code}
            maxLength={FACILITY_FIELDS.zip_code.maxLength}
            count={formData.zip_code.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputCls}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formData.zip_code}
                onChange={(e) => setField('zip_code', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Phone"
            error={errors.phone}
            id={IDS.phone}
            maxLength={FACILITY_FIELDS.phone.maxLength}
            count={formData.phone.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputCls}
                type="tel"
                placeholder="(555) 123-4567"
                autoComplete="off"
                value={formData.phone}
                onChange={(e) => setField('phone', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Email"
            error={errors.email ?? (emailError || undefined)}
            id={IDS.email}
            maxLength={FACILITY_FIELDS.email.maxLength}
            count={formData.email.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputCls}
                type="email"
                placeholder="station@example.com"
                autoComplete="off"
                value={formData.email}
                onChange={(e) => setField('email', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {facilityTypes.length > 0 && (
            <FormField label="Type" error={errors.facility_type_id} id={IDS.facility_type_id}>
              {(field) => (
                <select
                  {...field}
                  className={inputCls}
                  value={formData.facility_type_id}
                  onChange={(e) => setField('facility_type_id', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {facilityTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          {facilityStatuses.length > 0 && (
            <FormField label="Status" error={errors.status_id} id={IDS.status_id}>
              {(field) => (
                <select
                  {...field}
                  className={inputCls}
                  value={formData.status_id}
                  onChange={(e) => setField('status_id', e.target.value)}
                >
                  <option value="">Select status...</option>
                  {facilityStatuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
        </div>
        <FormField label="Notes" error={errors.notes} id={IDS.notes}>
          {(field) => (
            <textarea
              {...field}
              className={inputCls + ' resize-none'}
              rows={3}
              placeholder="Optional notes..."
              value={formData.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
