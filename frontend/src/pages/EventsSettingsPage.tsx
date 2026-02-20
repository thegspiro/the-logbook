/**
 * Events Module Settings Page
 *
 * Manages organization-level configuration for the events module:
 * event types, locations, default event settings, QR code/check-in,
 * and cancellation policy.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventService, locationsService } from '../services/api';
import type { Location, LocationCreate } from '../services/api';
import type { EventModuleSettings, EventType, RSVPStatus } from '../types/event';

const ALL_EVENT_TYPES: { value: EventType; defaultLabel: string }[] = [
  { value: 'business_meeting', defaultLabel: 'Business Meeting' },
  { value: 'public_education', defaultLabel: 'Public Education' },
  { value: 'training', defaultLabel: 'Training' },
  { value: 'social', defaultLabel: 'Social' },
  { value: 'fundraiser', defaultLabel: 'Fundraiser' },
  { value: 'ceremony', defaultLabel: 'Ceremony' },
  { value: 'other', defaultLabel: 'Other' },
];

const CHECK_IN_WINDOW_OPTIONS = [
  { value: 'flexible', label: 'Flexible — Anytime before event ends' },
  { value: 'strict', label: 'Strict — Only during the scheduled event time' },
  { value: 'window', label: 'Window — Custom minutes before/after start' },
] as const;

const REMINDER_HOUR_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 2, label: '2 hours' },
  { value: 4, label: '4 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '1 day' },
  { value: 48, label: '2 days' },
  { value: 72, label: '3 days' },
  { value: 168, label: '1 week' },
];

const DURATION_OPTIONS = [
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
];

const DEFAULT_SETTINGS: EventModuleSettings = {
  enabled_event_types: ['business_meeting', 'public_education', 'training', 'social', 'fundraiser', 'ceremony', 'other'],
  event_type_labels: {},
  defaults: {
    event_type: 'business_meeting',
    check_in_window_type: 'flexible',
    check_in_minutes_before: 15,
    check_in_minutes_after: 15,
    require_checkout: false,
    requires_rsvp: false,
    allowed_rsvp_statuses: ['going', 'not_going'],
    allow_guests: false,
    is_mandatory: false,
    send_reminders: true,
    reminder_hours_before: 24,
    default_duration_minutes: 120,
  },
  qr_code: {
    show_event_description: true,
    show_location_details: true,
    custom_instructions: '',
  },
  cancellation: {
    require_reason: true,
    notify_attendees: true,
  },
};

// ==================== Toggle Switch ====================

const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
  id?: string;
}> = ({ checked, onChange, label, description, id }) => (
  <div className="flex items-center justify-between py-3">
    <div className="pr-4">
      <label htmlFor={id} className="text-sm font-medium text-theme-text-primary">{label}</label>
      {description && <p className="text-sm text-theme-text-muted">{description}</p>}
    </div>
    <button
      type="button"
      id={id}
      onClick={onChange}
      className={`${checked ? 'bg-blue-600' : 'bg-theme-surface-hover'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
      role="switch"
      aria-checked={checked}
    >
      <span className={`${checked ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
    </button>
  </div>
);

// ==================== Section Card ====================

const SectionCard: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
  saving?: boolean;
  onSave?: () => void;
  saveLabel?: string;
}> = ({ title, description, children, saving, onSave, saveLabel }) => (
  <div className="card shadow p-6 mb-6">
    <h3 className="text-lg font-medium text-theme-text-primary mb-1">{title}</h3>
    <p className="text-sm text-theme-text-muted mb-6">{description}</p>
    {children}
    {onSave && (
      <div className="mt-6 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className={`${saving ? 'bg-theme-text-muted cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'} inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
        >
          {saving ? 'Saving...' : saveLabel || 'Save'}
        </button>
      </div>
    )}
  </div>
);

// ==================== Location Modal ====================

const LocationModal: React.FC<{
  location: Partial<LocationCreate> & { id?: string; is_active?: boolean };
  onSave: (data: LocationCreate & { id?: string; is_active?: boolean }) => void;
  onClose: () => void;
  saving: boolean;
}> = ({ location: initial, onSave, onClose, saving }) => {
  const [form, setForm] = useState({
    name: initial.name || '',
    address: initial.address || '',
    city: initial.city || '',
    state: initial.state || '',
    zip: initial.zip || '',
    is_active: initial.is_active !== false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...form, id: initial.id } as LocationCreate & { id?: string; is_active?: boolean });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className="card relative w-full max-w-md p-6 shadow-xl">
          <h3 className="text-lg font-medium text-theme-text-primary mb-4">
            {initial.id ? 'Edit Location' : 'Add Location'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                className="form-input"
                placeholder="e.g. Station 1, Training Center"
              />
            </div>
            <div>
              <label className="form-label">Street Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))}
                className="form-input"
              />
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3">
                <label className="form-label">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm(p => ({ ...p, city: e.target.value }))}
                  className="form-input"
                />
              </div>
              <div className="col-span-1">
                <label className="form-label">State</label>
                <input
                  type="text"
                  maxLength={2}
                  value={form.state}
                  onChange={(e) => setForm(p => ({ ...p, state: e.target.value.toUpperCase() }))}
                  className="form-input"
                />
              </div>
              <div className="col-span-2">
                <label className="form-label">ZIP</label>
                <input
                  type="text"
                  maxLength={10}
                  value={form.zip}
                  onChange={(e) => setForm(p => ({ ...p, zip: e.target.value }))}
                  className="form-input"
                />
              </div>
            </div>
            {initial.id && (
              <Toggle
                checked={form.is_active}
                onChange={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                label="Active"
                description="Inactive locations won't appear when creating events"
              />
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
                {saving ? 'Saving...' : 'Save Location'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// ==================== Main Component ====================

export const EventsSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<EventModuleSettings>(DEFAULT_SETTINGS);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  // Location modal state
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Partial<LocationCreate> & { id?: string; is_active?: boolean }>({});
  const [savingLocation, setSavingLocation] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [settingsData, locationsData] = await Promise.allSettled([
          eventService.getModuleSettings(),
          locationsService.getLocations(),
        ]);
        if (settingsData.status === 'fulfilled') {
          setSettings(settingsData.value);
        }
        if (locationsData.status === 'fulfilled') {
          setLocations(locationsData.value);
        }
      } catch {
        setError('Unable to load settings. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // ---- Event Types ----
  const toggleEventType = (type: EventType) => {
    setSettings(prev => {
      const enabled = prev.enabled_event_types.includes(type)
        ? prev.enabled_event_types.filter(t => t !== type)
        : [...prev.enabled_event_types, type];
      return { ...prev, enabled_event_types: enabled };
    });
  };

  const updateTypeLabel = (type: EventType, label: string) => {
    setSettings(prev => ({
      ...prev,
      event_type_labels: { ...prev.event_type_labels, [type]: label || undefined },
    }));
  };

  const saveEventTypes = async () => {
    try {
      setSavingSection('types');
      setError(null);
      await eventService.updateModuleSettings({
        enabled_event_types: settings.enabled_event_types,
        event_type_labels: settings.event_type_labels,
      });
      showSuccess('Event types saved.');
    } catch {
      setError('Unable to save event types. Please try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // ---- Defaults ----
  const updateDefaults = <K extends keyof EventModuleSettings['defaults']>(
    key: K,
    value: EventModuleSettings['defaults'][K]
  ) => {
    setSettings(prev => ({ ...prev, defaults: { ...prev.defaults, [key]: value } }));
  };

  const toggleRsvpStatus = (status: RSVPStatus) => {
    setSettings(prev => {
      const current = prev.defaults.allowed_rsvp_statuses;
      const updated = current.includes(status)
        ? current.filter(s => s !== status)
        : [...current, status];
      return { ...prev, defaults: { ...prev.defaults, allowed_rsvp_statuses: updated } };
    });
  };

  const saveDefaults = async () => {
    try {
      setSavingSection('defaults');
      setError(null);
      await eventService.updateModuleSettings({ defaults: settings.defaults });
      showSuccess('Default event settings saved.');
    } catch {
      setError('Unable to save defaults. Please try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // ---- QR Code / Check-In ----
  const updateQR = <K extends keyof EventModuleSettings['qr_code']>(
    key: K,
    value: EventModuleSettings['qr_code'][K]
  ) => {
    setSettings(prev => ({ ...prev, qr_code: { ...prev.qr_code, [key]: value } }));
  };

  const saveQRSettings = async () => {
    try {
      setSavingSection('qr');
      setError(null);
      await eventService.updateModuleSettings({ qr_code: settings.qr_code });
      showSuccess('QR code settings saved.');
    } catch {
      setError('Unable to save QR code settings. Please try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // ---- Cancellation ----
  const updateCancellation = <K extends keyof EventModuleSettings['cancellation']>(
    key: K,
    value: EventModuleSettings['cancellation'][K]
  ) => {
    setSettings(prev => ({ ...prev, cancellation: { ...prev.cancellation, [key]: value } }));
  };

  const saveCancellation = async () => {
    try {
      setSavingSection('cancel');
      setError(null);
      await eventService.updateModuleSettings({ cancellation: settings.cancellation });
      showSuccess('Cancellation policy saved.');
    } catch {
      setError('Unable to save cancellation settings. Please try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // ---- Locations ----
  const handleSaveLocation = async (data: LocationCreate & { id?: string; is_active?: boolean }) => {
    try {
      setSavingLocation(true);
      if (data.id) {
        const updated = await locationsService.updateLocation(data.id, {
          name: data.name,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
        });
        setLocations(prev => prev.map(l => l.id === updated.id ? updated : l));
      } else {
        const created = await locationsService.createLocation({
          name: data.name,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
        });
        setLocations(prev => [...prev, created]);
      }
      setLocationModalOpen(false);
      showSuccess(data.id ? 'Location updated.' : 'Location added.');
    } catch {
      setError('Unable to save location. Please try again.');
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async (id: string) => {
    if (!confirm('Delete this location? Events using it will keep the location name as text.')) return;
    try {
      await locationsService.deleteLocation(id);
      setLocations(prev => prev.filter(l => l.id !== id));
      showSuccess('Location deleted.');
    } catch {
      setError('Unable to delete location. It may be in use by existing events.');
    }
  };

  // ---- Render ----

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Events Module Settings</h2>
            <p className="mt-1 text-sm text-theme-text-muted">
              Configure event types, locations, defaults, QR code display, and cancellation policy.
            </p>
          </div>
          <Link
            to="/events"
            className="btn-secondary text-sm"
          >
            Back to Events
          </Link>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button onClick={() => setError(null)} className="mt-1 text-xs text-red-700 dark:text-red-400 underline">Dismiss</button>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-green-500/10 border border-green-500/30 rounded-lg p-4" role="status">
            <p className="text-sm text-green-700 dark:text-green-300">{successMessage}</p>
          </div>
        )}

        {/* ====== 1. Event Types ====== */}
        <SectionCard
          title="Event Types"
          description="Choose which event types are available when creating events. You can also customize the display labels."
          saving={savingSection === 'types'}
          onSave={saveEventTypes}
          saveLabel="Save Event Types"
        >
          <div className="space-y-3">
            {ALL_EVENT_TYPES.map(({ value, defaultLabel }) => {
              const enabled = settings.enabled_event_types.includes(value);
              return (
                <div key={value} className={`flex items-center gap-4 p-3 rounded-lg border ${enabled ? 'border-theme-surface-border bg-theme-surface-secondary' : 'border-transparent opacity-60'}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleEventType(value)}
                    className="form-checkbox"
                  />
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={settings.event_type_labels[value] ?? ''}
                      onChange={(e) => updateTypeLabel(value, e.target.value)}
                      placeholder={defaultLabel}
                      disabled={!enabled}
                      className="form-input-sm"
                    />
                  </div>
                  <span className="text-xs text-theme-text-muted whitespace-nowrap">{value}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* ====== 2. Locations ====== */}
        <SectionCard
          title="Locations"
          description="Manage predefined locations that can be selected when creating events. Members can also enter a location manually."
        >
          {locations.length === 0 ? (
            <p className="text-sm text-theme-text-muted py-4">No locations configured yet.</p>
          ) : (
            <div className="divide-y divide-theme-surface-border">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-theme-text-primary truncate">{loc.name}</p>
                    {(loc.address || loc.city) && (
                      <p className="text-xs text-theme-text-muted truncate">
                        {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    {!loc.is_active && (
                      <span className="text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded">Inactive</span>
                    )}
                    <button
                      onClick={() => { setEditingLocation(loc); setLocationModalOpen(true); }}
                      className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteLocation(loc.id)}
                      className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <button
              onClick={() => { setEditingLocation({}); setLocationModalOpen(true); }}
              className="btn-secondary text-sm inline-flex items-center gap-1"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Location
            </button>
          </div>
        </SectionCard>

        {/* ====== 3. Default Event Settings ====== */}
        <SectionCard
          title="Default Event Settings"
          description="Set organization-wide defaults applied when creating a new event. Creators can override these per event."
          saving={savingSection === 'defaults'}
          onSave={saveDefaults}
          saveLabel="Save Defaults"
        >
          <div className="space-y-5">
            {/* Default Type */}
            <div>
              <label className="form-label">Default Event Type</label>
              <select
                value={settings.defaults.event_type}
                onChange={(e) => updateDefaults('event_type', e.target.value as EventType)}
                className="form-input"
              >
                {ALL_EVENT_TYPES.filter(t => settings.enabled_event_types.includes(t.value)).map(({ value, defaultLabel }) => (
                  <option key={value} value={value}>{settings.event_type_labels[value] || defaultLabel}</option>
                ))}
              </select>
            </div>

            {/* Default Duration */}
            <div>
              <label className="form-label">Default Duration</label>
              <select
                value={settings.defaults.default_duration_minutes}
                onChange={(e) => updateDefaults('default_duration_minutes', Number(e.target.value))}
                className="form-input"
              >
                {DURATION_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-theme-surface-border pt-4">
              <p className="text-sm font-medium text-theme-text-primary mb-3">RSVP Defaults</p>
              <Toggle
                checked={settings.defaults.requires_rsvp}
                onChange={() => updateDefaults('requires_rsvp', !settings.defaults.requires_rsvp)}
                label="Require RSVP"
                description="New events will require RSVP by default"
              />
              {settings.defaults.requires_rsvp && (
                <div className="pl-4 space-y-2 mt-2">
                  <p className="text-xs font-medium text-theme-text-muted">Allowed RSVP responses:</p>
                  {(['going', 'not_going', 'maybe'] as RSVPStatus[]).map(status => (
                    <label key={status} className="flex items-center gap-2 text-sm text-theme-text-primary">
                      <input
                        type="checkbox"
                        checked={settings.defaults.allowed_rsvp_statuses.includes(status)}
                        onChange={() => toggleRsvpStatus(status)}
                        className="form-checkbox"
                      />
                      {status === 'going' ? 'Going' : status === 'not_going' ? 'Not Going' : 'Maybe'}
                    </label>
                  ))}
                  <Toggle
                    checked={settings.defaults.allow_guests}
                    onChange={() => updateDefaults('allow_guests', !settings.defaults.allow_guests)}
                    label="Allow Guests"
                  />
                </div>
              )}
            </div>

            <div className="border-t border-theme-surface-border pt-4">
              <Toggle
                checked={settings.defaults.is_mandatory}
                onChange={() => updateDefaults('is_mandatory', !settings.defaults.is_mandatory)}
                label="Mandatory Attendance"
                description="New events are mandatory by default"
              />
            </div>

            <div className="border-t border-theme-surface-border pt-4">
              <p className="text-sm font-medium text-theme-text-primary mb-3">Notification Defaults</p>
              <Toggle
                checked={settings.defaults.send_reminders}
                onChange={() => updateDefaults('send_reminders', !settings.defaults.send_reminders)}
                label="Send Reminders"
                description="Automatically send reminders before events"
              />
              {settings.defaults.send_reminders && (
                <div className="pl-4 mt-2">
                  <label className="form-label-sm">Remind members before event</label>
                  <select
                    value={settings.defaults.reminder_hours_before}
                    onChange={(e) => updateDefaults('reminder_hours_before', Number(e.target.value))}
                    className="form-input-sm w-48"
                  >
                    {REMINDER_HOUR_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ====== 4. QR Code & Check-In ====== */}
        <SectionCard
          title="QR Code & Check-In"
          description="Configure how the room QR code page looks and how check-in behaves by default."
          saving={savingSection === 'qr'}
          onSave={saveQRSettings}
          saveLabel="Save QR / Check-In Settings"
        >
          <div className="space-y-5">
            <div>
              <label className="form-label">Default Check-In Window</label>
              <select
                value={settings.defaults.check_in_window_type}
                onChange={(e) => updateDefaults('check_in_window_type', e.target.value as 'flexible' | 'strict' | 'window')}
                className="form-input"
              >
                {CHECK_IN_WINDOW_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {settings.defaults.check_in_window_type === 'window' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4">
                <div>
                  <label className="form-label-sm">Minutes before start</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.defaults.check_in_minutes_before}
                    onChange={(e) => updateDefaults('check_in_minutes_before', Number(e.target.value))}
                    className="form-input-sm"
                  />
                </div>
                <div>
                  <label className="form-label-sm">Minutes after start</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.defaults.check_in_minutes_after}
                    onChange={(e) => updateDefaults('check_in_minutes_after', Number(e.target.value))}
                    className="form-input-sm"
                  />
                </div>
              </div>
            )}

            <Toggle
              checked={settings.defaults.require_checkout}
              onChange={() => updateDefaults('require_checkout', !settings.defaults.require_checkout)}
              label="Require Manual Check-Out"
              description="Members must check out when leaving an event"
            />

            <div className="border-t border-theme-surface-border pt-4">
              <p className="text-sm font-medium text-theme-text-primary mb-3">QR Code Page Display</p>
              <Toggle
                checked={settings.qr_code.show_event_description}
                onChange={() => updateQR('show_event_description', !settings.qr_code.show_event_description)}
                label="Show Event Description"
                description="Display the event description on the QR code page"
              />
              <Toggle
                checked={settings.qr_code.show_location_details}
                onChange={() => updateQR('show_location_details', !settings.qr_code.show_location_details)}
                label="Show Location Details"
                description="Display additional directions / location notes on the QR code page"
              />
              <div className="mt-3">
                <label className="form-label">Custom Check-In Instructions</label>
                <textarea
                  value={settings.qr_code.custom_instructions}
                  onChange={(e) => updateQR('custom_instructions', e.target.value)}
                  rows={2}
                  className="form-input"
                  placeholder="e.g. Please check in when you arrive and check out before leaving."
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ====== 5. Cancellation Policy ====== */}
        <SectionCard
          title="Cancellation Policy"
          description="Control what happens when an event is cancelled."
          saving={savingSection === 'cancel'}
          onSave={saveCancellation}
          saveLabel="Save Cancellation Policy"
        >
          <Toggle
            checked={settings.cancellation.require_reason}
            onChange={() => updateCancellation('require_reason', !settings.cancellation.require_reason)}
            label="Require Cancellation Reason"
            description="Event managers must provide a reason when cancelling"
          />
          <Toggle
            checked={settings.cancellation.notify_attendees}
            onChange={() => updateCancellation('notify_attendees', !settings.cancellation.notify_attendees)}
            label="Notify Attendees"
            description="Automatically notify all RSVPs and attendees when an event is cancelled"
          />
        </SectionCard>

        {/* Permission note */}
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-yellow-700 dark:text-yellow-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="ml-3 text-sm text-yellow-700 dark:text-yellow-300">
              Changes to these settings affect all future events created in this department. Existing events are not modified.
            </p>
          </div>
        </div>
      </div>

      {/* Location Modal */}
      {locationModalOpen && (
        <LocationModal
          location={editingLocation}
          onSave={handleSaveLocation}
          onClose={() => setLocationModalOpen(false)}
          saving={savingLocation}
        />
      )}
    </div>
  );
};

export default EventsSettingsPage;
