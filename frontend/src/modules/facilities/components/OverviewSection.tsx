/**
 * OverviewSection — Displays and edits core facility details.
 */

import { useState } from 'react';
import {
  Pencil,
  Save,
  X,
  MapPin,
  Phone,
  Mail,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { FacilityCreate } from '../../../services/facilitiesServices';
import type { Facility, FacilityType, FacilityStatus } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';

interface Props {
  facility: Facility;
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
}

export default function OverviewSection({ facility, facilityTypes, facilityStatuses }: Props) {
  const tz = useTimezone();
  const { updateFacility } = useFacilitiesStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});

  const startEditing = () => {
    setEditData({
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
      year_built: facility.yearBuilt || '',
      square_footage: facility.squareFootage || '',
      num_floors: facility.numFloors || '',
      num_bays: facility.numBays || '',
      max_occupancy: facility.maxOccupancy || '',
      sleeping_quarters: facility.sleepingQuarters || '',
      notes: facility.notes || '',
      description: facility.description || '',
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!(editData.name as string)?.trim()) {
      toast.error('Facility name is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      const numericFields = new Set([
        'year_built',
        'square_footage',
        'num_floors',
        'num_bays',
        'max_occupancy',
        'sleeping_quarters',
      ]);

      for (const [key, value] of Object.entries(editData)) {
        if (value !== '' && value !== undefined) {
          if (numericFields.has(key)) {
            const num = Number(value);
            payload[key] = Number.isNaN(num) ? undefined : num;
          } else {
            payload[key] = value;
          }
        } else if (value === '') {
          // Use || pattern: empty string → undefined to omit from payload
          payload[key] = undefined;
        }
      }

      await updateFacility(facility.id, payload as Partial<FacilityCreate>);
      toast.success('Facility updated');
      setIsEditing(false);
    } catch {
      toast.error('Failed to update facility');
    } finally {
      setIsSaving(false);
    }
  };

  const ed = (field: string) => editData[field] as string;
  const setEd = (field: string, value: string) =>
    setEditData((prev) => ({ ...prev, [field]: value }));

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  const address = [facility.addressLine1, facility.city, facility.state, facility.zipCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      {/* Section Header */}
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">Facility Details</h2>
        {!isEditing ? (
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={isSaving}
              className="btn-primary flex gap-1.5 items-center text-sm px-3 py-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        )}
      </div>

      <div className="p-5">
        {!isEditing ? (
          /* View Mode */
          <div className="space-y-5">
            {/* Location */}
            {address && (
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-theme-text-muted mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-theme-text-primary">{address}</p>
                  {facility.addressLine2 && (
                    <p className="text-sm text-theme-text-secondary">{facility.addressLine2}</p>
                  )}
                  {facility.county && (
                    <p className="text-xs text-theme-text-muted mt-0.5">
                      {facility.county} County
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Contact */}
            {(facility.phone || facility.fax || facility.email) && (
              <div className="flex flex-wrap items-center gap-4 text-sm text-theme-text-secondary">
                {facility.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    {facility.phone}
                  </span>
                )}
                {facility.fax && (
                  <span className="flex items-center gap-1.5 text-theme-text-muted">
                    <Phone className="w-3.5 h-3.5" />
                    Fax: {facility.fax}
                  </span>
                )}
                {facility.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    {facility.email}
                  </span>
                )}
              </div>
            )}

            {/* Building Info Grid */}
            {(facility.yearBuilt ||
              facility.squareFootage ||
              facility.numFloors ||
              facility.numBays ||
              facility.maxOccupancy ||
              facility.sleepingQuarters) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 p-4 bg-theme-surface-hover/50 rounded-lg">
                {facility.yearBuilt != null && (
                  <InfoItem label="Year Built" value={String(facility.yearBuilt)} />
                )}
                {facility.squareFootage != null && (
                  <InfoItem label="Sq. Footage" value={facility.squareFootage.toLocaleString()} />
                )}
                {facility.numFloors != null && (
                  <InfoItem label="Floors" value={String(facility.numFloors)} />
                )}
                {facility.numBays != null && (
                  <InfoItem label="Apparatus Bays" value={String(facility.numBays)} />
                )}
                {facility.maxOccupancy != null && (
                  <InfoItem label="Max Occupancy" value={String(facility.maxOccupancy)} />
                )}
                {facility.sleepingQuarters != null && (
                  <InfoItem label="Sleeping Quarters" value={String(facility.sleepingQuarters)} />
                )}
              </div>
            )}

            {/* Description & Notes */}
            {facility.description && (
              <div>
                <p className="text-xs font-medium text-theme-text-muted mb-1">Description</p>
                <p className="text-sm text-theme-text-secondary">{facility.description}</p>
              </div>
            )}
            {facility.notes && (
              <div>
                <p className="text-xs font-medium text-theme-text-muted mb-1">Notes</p>
                <p className="text-sm text-theme-text-muted italic">{facility.notes}</p>
              </div>
            )}

            {/* Timestamps */}
            <div className="flex items-center gap-4 text-xs text-theme-text-muted pt-2 border-t border-theme-surface-border">
              <span>Created: {formatDate(facility.createdAt, tz)}</span>
              <span>Updated: {formatDate(facility.updatedAt, tz)}</span>
            </div>
          </div>
        ) : (
          /* Edit Mode */
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input
                  type="text"
                  value={ed('name')}
                  onChange={(e) => setEd('name', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Facility Number</label>
                <input
                  type="text"
                  value={ed('facility_number')}
                  onChange={(e) => setEd('facility_number', e.target.value)}
                  className={inputCls}
                  placeholder="e.g., STA-01"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Type</label>
                <select
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
                <label className={labelCls}>Status</label>
                <select
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
              <label className={labelCls}>Address Line 1</label>
              <input
                type="text"
                value={ed('address_line1')}
                onChange={(e) => setEd('address_line1', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Address Line 2</label>
              <input
                type="text"
                value={ed('address_line2')}
                onChange={(e) => setEd('address_line2', e.target.value)}
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>City</label>
                <input
                  type="text"
                  value={ed('city')}
                  onChange={(e) => setEd('city', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <input
                  type="text"
                  value={ed('state')}
                  onChange={(e) => setEd('state', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Zip Code</label>
                <input
                  type="text"
                  value={ed('zip_code')}
                  onChange={(e) => setEd('zip_code', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>County</label>
                <input
                  type="text"
                  value={ed('county')}
                  onChange={(e) => setEd('county', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  type="text"
                  value={ed('phone')}
                  onChange={(e) => setEd('phone', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Fax</label>
                <input
                  type="text"
                  value={ed('fax')}
                  onChange={(e) => setEd('fax', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input
                  type="text"
                  value={ed('email')}
                  onChange={(e) => setEd('email', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Year Built</label>
                <input
                  type="number"
                  value={ed('year_built')}
                  onChange={(e) => setEd('year_built', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Sq. Footage</label>
                <input
                  type="number"
                  value={ed('square_footage')}
                  onChange={(e) => setEd('square_footage', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Floors</label>
                <input
                  type="number"
                  value={ed('num_floors')}
                  onChange={(e) => setEd('num_floors', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Apparatus Bays</label>
                <input
                  type="number"
                  value={ed('num_bays')}
                  onChange={(e) => setEd('num_bays', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Max Occupancy</label>
                <input
                  type="number"
                  value={ed('max_occupancy')}
                  onChange={(e) => setEd('max_occupancy', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Sleeping Quarters</label>
                <input
                  type="number"
                  value={ed('sleeping_quarters')}
                  onChange={(e) => setEd('sleeping_quarters', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea
                value={ed('description')}
                onChange={(e) => setEd('description', e.target.value)}
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                value={ed('notes')}
                onChange={(e) => setEd('notes', e.target.value)}
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className="text-sm font-medium text-theme-text-primary">{value}</p>
    </div>
  );
}
