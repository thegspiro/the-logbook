/**
 * CreateFacilityModal — Modal dialog for adding a new facility.
 */

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { Facility, FacilityType, FacilityStatus } from '../types';

interface Props {
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  onClose: () => void;
  onCreated: (facility: Facility) => void;
}

export default function CreateFacilityModal({
  facilityTypes,
  facilityStatuses,
  onClose,
  onCreated,
}: Props) {
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

  const set = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Facility name is required');
      return;
    }
    setIsCreating(true);
    try {
      // Use || to coerce empty strings to undefined (not ?? — see CLAUDE.md pitfall #1)
      const payload: Record<string, unknown> = {
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
    } catch {
      toast.error('Failed to create facility');
    } finally {
      setIsCreating(false);
    }
  };

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-facility-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
          <h2
            id="create-facility-title"
            className="text-lg font-bold text-theme-text-primary"
          >
            Add Facility
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g., Station 1"
              className={inputCls}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Facility Number
            </label>
            <input
              type="text"
              value={formData.facility_number}
              onChange={(e) => set('facility_number', e.target.value)}
              placeholder="e.g., STA-01"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Address
            </label>
            <input
              type="text"
              value={formData.address_line1}
              onChange={(e) => set('address_line1', e.target.value)}
              placeholder="123 Main St"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                City
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => set('city', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                State
              </label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => set('state', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Zip
              </label>
              <input
                type="text"
                value={formData.zip_code}
                onChange={(e) => set('zip_code', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(555) 123-4567"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="station@example.com"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {facilityTypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Type
                </label>
                <select
                  value={formData.facility_type_id}
                  onChange={(e) => set('facility_type_id', e.target.value)}
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
            )}
            {facilityStatuses.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Status
                </label>
                <select
                  value={formData.status_id}
                  onChange={(e) => set('status_id', e.target.value)}
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
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Optional notes..."
              className={inputCls + ' resize-none'}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleCreate();
            }}
            disabled={isCreating || !formData.name.trim()}
            className="btn-primary flex gap-2 items-center px-5"
          >
            {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Facility
          </button>
        </div>
      </div>
    </div>
  );
}
