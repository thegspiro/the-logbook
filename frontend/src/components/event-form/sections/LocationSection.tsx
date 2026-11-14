import React from 'react';
import { MapPin } from 'lucide-react';
import { FormField } from '../../ux/FormField';
import { EVENT_FIELDS, inputClass, labelClass, selectClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface LocationSectionProps {
  model: Pick<
    EventFormModel,
    | 'formData'
    | 'update'
    | 'fieldErrors'
    | 'locations'
    | 'locationMode'
    | 'handleLocationSelect'
    | 'formatLocationLabel'
    | 'formatLocationAddress'
    | 'selectedLocation'
  >;
}

/** A listed location or a typed one, and directions. */
export const LocationSection: React.FC<LocationSectionProps> = ({ model }) => {
  const {
    formData,
    update,
    fieldErrors,
    locations,
    locationMode,
    handleLocationSelect,
    formatLocationLabel,
    formatLocationAddress,
    selectedLocation,
  } = model;
  return (
    <section className="space-y-6">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
        <MapPin className="h-5 w-5 text-red-700" />
        <span>Location</span>
      </h2>

      <div>
        <label htmlFor="location-select" className={labelClass}>
          Location
        </label>
        {locations.length > 0 ? (
          <select
            id="location-select"
            value={locationMode === 'other' ? '__other__' : formData.location_id || ''}
            onChange={(e) => handleLocationSelect(e.target.value)}
            className={selectClass}
          >
            <option value="">-- Select a location --</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {formatLocationLabel(loc)}
              </option>
            ))}
            <option value="__other__">Other (off-site / enter manually)</option>
          </select>
        ) : (
          <>
            <input
              type="text"
              id="location-text-fallback"
              maxLength={EVENT_FIELDS.location.maxLength}
              aria-invalid={fieldErrors.location ? true : undefined}
              aria-describedby={fieldErrors.location ? 'location-text-fallback-error' : undefined}
              value={formData.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              className={inputClass}
              placeholder="e.g., Station 1 Conference Room"
            />
            {fieldErrors.location && (
              <p id="location-text-fallback-error" className="mt-1 text-sm text-red-700 dark:text-red-400">
                {fieldErrors.location}
              </p>
            )}
          </>
        )}
      </div>

      {/* Show selected location details */}
      {locationMode === 'select' && selectedLocation && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
            <div className="flex-1">
              <p className="text-theme-text-primary font-semibold">{selectedLocation.name}</p>
              {selectedLocation.building && (
                <p className="text-theme-text-secondary mt-0.5 text-sm">Building: {selectedLocation.building}</p>
              )}
              {formatLocationAddress(selectedLocation) && (
                <p className="text-theme-text-secondary mt-0.5 text-sm">{formatLocationAddress(selectedLocation)}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-4">
                {selectedLocation.room_number && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    Room {selectedLocation.room_number}
                  </span>
                )}
                {selectedLocation.capacity && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    Capacity: {selectedLocation.capacity}
                  </span>
                )}
                {selectedLocation.floor && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    Floor {selectedLocation.floor}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Free-text location when "Other" is selected */}
      {locationMode === 'other' && locations.length > 0 && (
        <FormField
          id="location-text"
          label="Location Name / Address"
          error={fieldErrors.location}
          maxLength={EVENT_FIELDS.location.maxLength}
          count={(formData.location || '').length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              value={formData.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              className={inputClass}
              placeholder="e.g., City Hall — 123 Main St, Anytown"
            />
          )}
        </FormField>
      )}

      <FormField id="location-details" label="Additional Directions" error={fieldErrors.location_details}>
        {(field) => (
          <input
            {...field}
            type="text"
            value={formData.location_details || ''}
            onChange={(e) => update({ location_details: e.target.value })}
            className={inputClass}
            placeholder="e.g., Enter through side door, Room 204"
          />
        )}
      </FormField>
    </section>
  );
};
