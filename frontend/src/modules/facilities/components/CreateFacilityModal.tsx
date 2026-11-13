/**
 * CreateFacilityModal — Modal dialog for adding a new facility.
 */

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { organizationEmailError } from '../../../utils/organizationProfile';
import type { FacilityCreate } from '../../../services/facilitiesServices';
import type { Facility, FacilityType, FacilityStatus } from '../types';

type FacilityField =
  | 'name'
  | 'facility_number'
  | 'address_line1'
  | 'city'
  | 'state'
  | 'zip_code'
  | 'phone'
  | 'email'
  | 'facility_type_id'
  | 'status_id'
  | 'notes';

const FACILITY_FIELDS: FieldSpecs<FacilityField> = {
  name: { id: 'facility-name', label: 'Name' },
  facility_number: { id: 'facility-facility-number', label: 'Facility Number' },
  address_line1: { id: 'facility-address', label: 'Address' },
  city: { id: 'facility-city', label: 'City' },
  state: { id: 'facility-state', label: 'State' },
  zip_code: { id: 'facility-zip', label: 'Zip Code' },
  phone: { id: 'facility-phone', label: 'Phone' },
  email: { id: 'facility-email', label: 'Email' },
  facility_type_id: { id: 'facility-type', label: 'Type' },
  status_id: { id: 'facility-status', label: 'Status' },
  notes: { id: 'facility-notes', label: 'Notes' },
};

// Mirror FacilityCreate (forms review F-2).
const FACILITY_LIMITS = {
  name: 200,
  facility_number: 50,
  address_line1: 200,
  city: 100,
  state: 50,
  zip_code: 20,
  phone: 50,
  email: 200,
} as const;

interface Props {
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  onClose: () => void;
  onCreated: (facility: Facility) => void;
}

const EMPTY: Record<FacilityField, string> = {
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

export default function CreateFacilityModal({ facilityTypes, facilityStatuses, onClose, onCreated }: Props) {
  const { createFacility } = useFacilitiesStore();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState(EMPTY);
  // The dialog mounts empty each time it opens, so anything typed is a change
  // that Escape, the X and Cancel ask about first (forms review F-6).
  const isDirty = (Object.keys(EMPTY) as FacilityField[]).some((k) => formData[k] !== EMPTY[k]);
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const fieldErrors = useFieldErrors(FACILITY_FIELDS);
  const setField = (field: FacilityField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    fieldErrors.setError(field, null);
  };
  // The server accepts any string as the address, so the form checks it.
  // Shown as it is typed; a server refusal of the address takes its place.
  const emailError = organizationEmailError(formData.email);
  const errors: FieldErrors<FacilityField> = {
    ...fieldErrors.errors,
    ...(emailError ? { email: emailError } : {}),
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    // Checked here rather than by greying out Add Facility, which told an
    // officer nothing about why it would not press (forms review F-3).
    const problems: FieldErrors<FacilityField> = {};
    if (!formData.name.trim()) problems.name = 'Enter a name for the facility.';
    if (emailError) problems.email = emailError;
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
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
    } catch (err: unknown) {
      // Nothing is created until a refused field is fixed (forms review F-2).
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Failed to create facility'));
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
      noValidate
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
          id={FACILITY_FIELDS.name.id}
          maxLength={FACILITY_LIMITS.name}
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
          id={FACILITY_FIELDS.facility_number.id}
          maxLength={FACILITY_LIMITS.facility_number}
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
          id={FACILITY_FIELDS.address_line1.id}
          maxLength={FACILITY_LIMITS.address_line1}
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
            id={FACILITY_FIELDS.city.id}
            maxLength={FACILITY_LIMITS.city}
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
            id={FACILITY_FIELDS.state.id}
            maxLength={FACILITY_LIMITS.state}
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
            id={FACILITY_FIELDS.zip_code.id}
            maxLength={FACILITY_LIMITS.zip_code}
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
            id={FACILITY_FIELDS.phone.id}
            maxLength={FACILITY_LIMITS.phone}
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
            error={errors.email}
            id={FACILITY_FIELDS.email.id}
            maxLength={FACILITY_LIMITS.email}
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
            <FormField label="Type" error={errors.facility_type_id} id={FACILITY_FIELDS.facility_type_id.id}>
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
            <FormField label="Status" error={errors.status_id} id={FACILITY_FIELDS.status_id.id}>
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
        <FormField label="Notes" error={errors.notes} id={FACILITY_FIELDS.notes.id}>
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
        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
      </div>
    </Modal>
  );
}
