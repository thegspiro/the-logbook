/**
 * CreateFacilityModal — Modal dialog for adding a new facility.
 */

import { useState } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { organizationEmailError } from '../../../utils/organizationProfile';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
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

const LABEL_CLASS = 'text-theme-text-secondary mb-1 block text-sm font-medium';

interface Props {
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  onClose: () => void;
  onCreated: (facility: Facility) => void;
}

export default function CreateFacilityModal({ facilityTypes, facilityStatuses, onClose, onCreated }: Props) {
  const dialogRef = useDialog<HTMLDivElement>({ onClose });

  const { createFacility } = useFacilitiesStore();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    facility_number: '',
    address_line1: '',
    city: '',
    state: '',
    zip_code: '',
    facility_type_id: '',
    status_id: '',
    phone: '',
    email: '',
    notes: '',
  });

  const fieldErrors = useFieldErrors(FACILITY_FIELDS);
  const setField = (field: FacilityField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    fieldErrors.setError(field, null);
  };
  // The modal submits from a button rather than a form, so type="email" is
  // never checked by the browser, and the server accepts any string. Shown
  // as it is typed; a server refusal of the address takes its place.
  const emailError = organizationEmailError(formData.email);
  const errors: FieldErrors<FacilityField> = {
    ...fieldErrors.errors,
    ...(emailError ? { email: emailError } : {}),
  };

  const handleCreate = async () => {
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
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Failed to create facility'));
    } finally {
      setIsCreating(false);
    }
  };

  const inputCls = 'form-input py-2.5';

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-facility-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div ref={dialogRef} className="modal-panel max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="create-facility-title" className="text-theme-text-primary text-lg font-bold">
            Add Facility
          </h2>
          <button
            type="button"
            data-dialog-close
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <FormField
            id={FACILITY_FIELDS.name.id}
            label="Name"
            required
            labelClassName={LABEL_CLASS}
            error={errors.name}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                value={formData.name}
                maxLength={FACILITY_LIMITS.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g., Station 1"
                className={inputCls}
                autoFocus
              />
            )}
          </FormField>

          <FormField
            id={FACILITY_FIELDS.facility_number.id}
            label="Facility Number"
            labelClassName={LABEL_CLASS}
            error={errors.facility_number}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                value={formData.facility_number}
                maxLength={FACILITY_LIMITS.facility_number}
                onChange={(e) => setField('facility_number', e.target.value)}
                placeholder="e.g., STA-01"
                className={inputCls}
              />
            )}
          </FormField>

          <FormField
            id={FACILITY_FIELDS.address_line1.id}
            label="Address"
            labelClassName={LABEL_CLASS}
            error={errors.address_line1}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                value={formData.address_line1}
                maxLength={FACILITY_LIMITS.address_line1}
                onChange={(e) => setField('address_line1', e.target.value)}
                placeholder="123 Main St"
                className={inputCls}
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField id={FACILITY_FIELDS.city.id} label="City" labelClassName={LABEL_CLASS} error={errors.city}>
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.city}
                  maxLength={FACILITY_LIMITS.city}
                  onChange={(e) => setField('city', e.target.value)}
                  className={inputCls}
                />
              )}
            </FormField>
            <FormField id={FACILITY_FIELDS.state.id} label="State" labelClassName={LABEL_CLASS} error={errors.state}>
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.state}
                  maxLength={FACILITY_LIMITS.state}
                  onChange={(e) => setField('state', e.target.value)}
                  className={inputCls}
                />
              )}
            </FormField>
            <FormField
              id={FACILITY_FIELDS.zip_code.id}
              label="Zip Code"
              labelClassName={LABEL_CLASS}
              error={errors.zip_code}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.zip_code}
                  maxLength={FACILITY_LIMITS.zip_code}
                  onChange={(e) => setField('zip_code', e.target.value)}
                  className={inputCls}
                />
              )}
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField id={FACILITY_FIELDS.phone.id} label="Phone" labelClassName={LABEL_CLASS} error={errors.phone}>
              {(field) => (
                <input
                  {...field}
                  type="tel"
                  value={formData.phone}
                  maxLength={FACILITY_LIMITS.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className={inputCls}
                />
              )}
            </FormField>
            <FormField id={FACILITY_FIELDS.email.id} label="Email" labelClassName={LABEL_CLASS} error={errors.email}>
              {(field) => (
                <input
                  {...field}
                  type="email"
                  value={formData.email}
                  maxLength={FACILITY_LIMITS.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="station@example.com"
                  className={inputCls}
                />
              )}
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {facilityTypes.length > 0 && (
              <FormField
                id={FACILITY_FIELDS.facility_type_id.id}
                label="Type"
                labelClassName={LABEL_CLASS}
                error={errors.facility_type_id}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.facility_type_id}
                    onChange={(e) => setField('facility_type_id', e.target.value)}
                    className={inputCls}
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
              <FormField
                id={FACILITY_FIELDS.status_id.id}
                label="Status"
                labelClassName={LABEL_CLASS}
                error={errors.status_id}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.status_id}
                    onChange={(e) => setField('status_id', e.target.value)}
                    className={inputCls}
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

          <FormField id={FACILITY_FIELDS.notes.id} label="Notes" labelClassName={LABEL_CLASS} error={errors.notes}>
            {(field) => (
              <textarea
                {...field}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
                rows={3}
                placeholder="Optional notes..."
                className={inputCls + ' resize-none'}
              />
            )}
          </FormField>
          {fieldErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {fieldErrors.formError}
            </p>
          )}
        </div>

        <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleCreate();
            }}
            disabled={isCreating}
            className="btn-primary flex items-center gap-2 px-5"
          >
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Facility
          </button>
        </div>
      </div>
    </div>
  );
}
