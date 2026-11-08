/**
 * Locations Page (Lightweight)
 *
 * Used when the full Facilities module is NOT enabled.
 * Manages station numbers, addresses, and room names for use by
 * events, forms, QR code check-in, and other cross-module features.
 *
 * When the Facilities module IS enabled, FacilitiesPage handles
 * all physical location management instead.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { Link } from 'react-router';
import {
  MapPin,
  Plus,
  Search,
  Building2,
  DoorOpen,
  Pencil,
  Trash2,
  Loader2,
  X,
  Save,
  ChevronDown,
  ChevronUp,
  QrCode,
  Nfc,
  Building,
  HelpCircle,
  Monitor,
  Copy,
  Check,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { locationsService, organizationService } from '../services/api';
import type { Location, LocationCreate } from '../services/api';

import { useConfirm } from '../contexts/ConfirmContext';
import { useAuthStore } from '../stores/authStore';
import { copyToClipboard } from '../utils/clipboard';
import { getErrorDetail, getErrorMessage } from '../utils/errorHandling';
import { formCoercions } from '../utils/formValues';
import { FormField } from '../components/ux/FormField';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../utils/serverFieldErrors';

// Group locations: top-level = stations (has address, no room_number), children = rooms (have room_number or building)
function groupLocations(locations: Location[]): { stations: Location[]; rooms: Map<string, Location[]> } {
  const stations: Location[] = [];
  const rooms = new Map<string, Location[]>();
  const orphanRooms: Location[] = [];

  for (const loc of locations) {
    // A "station" is a location with an address that is not a facility room
    if (loc.address && !loc.facility_room_id && !loc.room_number) {
      stations.push(loc);
    } else if (loc.building) {
      // A room linked to a station via building name
      const existing = rooms.get(loc.building) || [];
      existing.push(loc);
      rooms.set(loc.building, existing);
    } else {
      // A standalone room/location (no building reference)
      orphanRooms.push(loc);
    }
  }

  // Add orphan rooms under a virtual "Other" key if any
  if (orphanRooms.length > 0) {
    rooms.set('__other__', orphanRooms);
  }

  return { stations, rooms };
}

/**
 * LocationCreate.capacity is `ge=1`, so a 0 or a fraction is refused with a 422
 * after the form has closed over the user's input. Blank means "not recorded".
 */
function capacityError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 ? null : 'Capacity must be a whole number of at least 1, or left blank';
}

type StationMode = 'single_station' | 'multi_station' | null;

// Limits from LocationBase / LocationUpdate (backend/app/schemas/location.py);
// `description` has none there, so its textarea carries none.
type StationField = 'name' | 'address' | 'city' | 'state' | 'zip' | 'description';
const STATION_FIELDS: Record<StationField, ServerFieldSpec> = {
  name: { label: 'Station name', maxLength: 200 },
  address: { label: 'Street address', maxLength: 255 },
  city: { label: 'City', maxLength: 100 },
  state: { label: 'State', maxLength: 50 },
  zip: { label: 'Zip', maxLength: 20 },
  description: { label: 'Description' },
};
const STATION_FIELD_IDS: Record<StationField, string> = {
  name: 'station-name',
  address: 'station-address',
  city: 'station-city',
  state: 'station-state',
  zip: 'station-zip',
  description: 'station-description',
};
const EMPTY_STATION_FORM: Record<StationField, string> = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  description: '',
};

type RoomField = 'name' | 'room_number' | 'floor' | 'capacity' | 'description';
const ROOM_FIELDS: Record<RoomField, ServerFieldSpec> = {
  name: { label: 'Room name', maxLength: 200 },
  room_number: { label: 'Room number', maxLength: 50 },
  floor: { label: 'Floor', maxLength: 20 },
  capacity: { label: 'Capacity' },
  description: { label: 'Description' },
};
const ROOM_FIELD_IDS: Record<RoomField, string> = {
  name: 'room-form-room-name',
  room_number: 'room-form-room-number',
  floor: 'room-form-floor',
  capacity: 'room-form-capacity',
  description: 'room-form-description',
};
const EMPTY_ROOM_FORM: Record<RoomField, string> = {
  name: '',
  room_number: '',
  floor: '',
  capacity: '',
  description: '',
};

const sameForm = <K extends string>(a: Record<K, string>, b: Record<K, string>) =>
  (Object.keys(a) as K[]).every((key) => a[key] === b[key]);

const firstErrorKey = <K extends string>(order: Record<K, unknown>, errors: Partial<Record<K, string | undefined>>) =>
  (Object.keys(order) as K[]).find((key) => errors[key]);

/**
 * Saves a location, putting a 422 on the fields it names (forms review F-2).
 *
 * A create refuses outright: nothing is created until every refused field is
 * fixed, because a record created without the value would leave the flag on a
 * dialog that has already closed. An edit follows the owner's single-save
 * rule of 2026-11-05: the refused fields are left out and the rest is written,
 * so the stored values of the refused ones stay, and the fields stay flagged.
 * Returns the fields the server refused and the payload actually written
 * (`null` when nothing was).
 */
async function saveLocationExceptRefused<K extends keyof LocationCreate>(
  payload: LocationCreate,
  fields: Record<K, ServerFieldSpec>,
  write:
    | { create: (body: LocationCreate) => Promise<unknown> }
    | { update: (body: Partial<LocationCreate>) => Promise<unknown> }
): Promise<{ refused: Partial<Record<K, string>>; written: Partial<LocationCreate> | null }> {
  try {
    await ('create' in write ? write.create(payload) : write.update(payload));
    return { refused: {}, written: payload };
  } catch (err: unknown) {
    const mapped = mapServerFieldErrors(err, fields);
    const keys = mapped ? (Object.keys(mapped.fieldErrors) as K[]) : [];
    if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
    if ('create' in write) return { refused: mapped.fieldErrors, written: null };
    const rest: Partial<LocationCreate> = { ...payload };
    for (const key of keys) delete rest[key];
    await write.update(rest);
    return { refused: mapped.fieldErrors, written: rest };
  }
}

/* ──────────────────────────────────────────────────────────
 * Location Setup Wizard
 *
 * A step-by-step modal that guides the user through:
 *   1. Single vs multi-station
 *   2. Station name + address
 *   3. Room(s) within each station
 *   4. Summary / done
 *
 * Shown automatically when no locations exist and station
 * mode hasn't been set, or when explicitly launched.
 * ────────────────────────────────────────────────────────── */

interface WizardStation {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  saved?: boolean; // true once the station is persisted
  savedId?: string; // id from the backend
}

interface WizardRoom {
  name: string;
  room_number: string;
  floor: string;
  capacity: string;
  saved?: boolean; // true once the room is persisted
}

type WizardStep = 'mode' | 'stations' | 'rooms' | 'done';

function LocationSetupWizard({
  onComplete,
  onDismiss,
  existingMode,
  existingStations,
}: {
  onComplete: () => void;
  onDismiss?: () => void;
  existingMode: StationMode;
  existingStations: Location[];
}) {
  const [step, setStep] = useState<WizardStep>(
    existingMode ? (existingStations.length > 0 ? 'rooms' : 'stations') : 'mode'
  );
  const [mode, setMode] = useState<'single_station' | 'multi_station' | null>(existingMode);
  const [stations, setStations] = useState<WizardStation[]>(
    existingStations.length > 0
      ? existingStations.map((s) => ({
          name: s.name,
          address: s.address || '',
          city: s.city || '',
          state: s.state || '',
          zip: s.zip || '',
          saved: true,
          savedId: s.id,
        }))
      : [{ name: '', address: '', city: '', state: '', zip: '' }]
  );
  const [activeStationIdx, setActiveStationIdx] = useState(0);
  const [roomsByStation, setRoomsByStation] = useState<Map<number, WizardRoom[]>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [roomForm, setRoomForm] = useState<WizardRoom>({ name: '', room_number: '', floor: '', capacity: '' });

  const inputCls = 'form-input py-2.5';
  const labelCls = 'form-label';

  /* ── Step navigation ── */
  const totalSteps = 4;
  const stepIndex = step === 'mode' ? 1 : step === 'stations' ? 2 : step === 'rooms' ? 3 : 4;

  /* ── Step 1: mode selection ── */
  const handleModeSelect = async (selected: 'single_station' | 'multi_station') => {
    try {
      await organizationService.updateSettings({ station_mode: selected });
      setMode(selected);
      if (selected === 'single_station') {
        // Pre-fill from the organization's onboarding address
        try {
          const orgAddr = await organizationService.getAddress();
          setStations([
            {
              name: '',
              address: orgAddr.address || '',
              city: orgAddr.city || '',
              state: orgAddr.state || '',
              zip: orgAddr.zip || '',
            },
          ]);
        } catch {
          setStations([{ name: '', address: '', city: '', state: '', zip: '' }]);
        }
      }
      setStep('stations');
    } catch {
      toast.error('Failed to save setting');
    }
  };

  /* ── Step 2: station form helpers ── */
  const updateStation = (idx: number, field: keyof WizardStation, value: string) => {
    setStations((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const addAnotherStation = () => {
    setStations((prev) => [...prev, { name: '', address: '', city: '', state: '', zip: '' }]);
  };

  const removeStation = (idx: number) => {
    if (stations.length <= 1) return;
    setStations((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveStations = async () => {
    const unsaved = stations.filter((s) => !s.saved);
    for (const s of unsaved) {
      if (!s.name.trim()) {
        toast.error('Every station needs a name');
        return;
      }
      // groupLocations treats a location as a station only when it has an
      // address; one saved without would be filed under "Other Locations" and
      // the rooms added to it next would have no card to appear under.
      if (!s.address.trim()) {
        toast.error('Every station needs a street address');
        return;
      }
    }
    setIsSaving(true);
    try {
      for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        if (!s || s.saved) continue;
        const created = await locationsService.createLocation({
          name: s.name.trim(),
          address: s.address.trim(),
          ...(s.city.trim() ? { city: s.city.trim() } : {}),
          ...(s.state.trim() ? { state: s.state.trim() } : {}),
          ...(s.zip.trim() ? { zip: s.zip.trim() } : {}),
        });
        // Marked as each one lands, so a failure further down the list leaves
        // the earlier stations saved and a retry does not post them twice.
        setStations((prev) => prev.map((p, j) => (j === i ? { ...p, saved: true, savedId: created.id } : p)));
      }
      setActiveStationIdx(0);
      setStep('rooms');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save station'));
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Step 3: room helpers ── */
  const currentRooms = roomsByStation.get(activeStationIdx) || [];

  const addRoom = () => {
    if (!roomForm.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    const roomCapacityError = capacityError(roomForm.capacity);
    if (roomCapacityError) {
      toast.error(roomCapacityError);
      return;
    }
    const updated = new Map(roomsByStation);
    const list = [...(updated.get(activeStationIdx) || []), { ...roomForm }];
    updated.set(activeStationIdx, list);
    setRoomsByStation(updated);
    setRoomForm({ name: '', room_number: '', floor: '', capacity: '' });
  };

  const removeRoom = (roomIdx: number) => {
    const updated = new Map(roomsByStation);
    const list = [...(updated.get(activeStationIdx) || [])];
    list.splice(roomIdx, 1);
    updated.set(activeStationIdx, list);
    setRoomsByStation(updated);
  };

  const handleNextStation = () => {
    if (activeStationIdx < stations.length - 1) {
      setActiveStationIdx((prev) => prev + 1);
      setRoomForm({ name: '', room_number: '', floor: '', capacity: '' });
    }
  };

  const handlePrevStation = () => {
    if (activeStationIdx > 0) {
      setActiveStationIdx((prev) => prev - 1);
      setRoomForm({ name: '', room_number: '', floor: '', capacity: '' });
    }
  };

  const handleFinishRooms = async () => {
    setIsSaving(true);
    try {
      for (const [stationIdx, roomList] of roomsByStation.entries()) {
        const station = stations[stationIdx];
        if (!station) continue;
        for (let roomIdx = 0; roomIdx < roomList.length; roomIdx++) {
          const room = roomList[roomIdx];
          if (!room || room.saved) continue;
          await locationsService.createLocation({
            name: room.name.trim(),
            building: station.name.trim(),
            ...(room.room_number.trim() ? { room_number: room.room_number.trim() } : {}),
            ...(room.floor.trim() ? { floor: room.floor.trim() } : {}),
            ...(room.capacity.trim() ? { capacity: Number(room.capacity) } : {}),
          });
          // Marked as each one lands, so a retry after a failure part-way
          // through posts only the rooms that did not save.
          setRoomsByStation((prev) => {
            const next = new Map(prev);
            next.set(
              stationIdx,
              (prev.get(stationIdx) || []).map((r, j) => (j === roomIdx ? { ...r, saved: true } : r))
            );
            return next;
          });
        }
      }
      setStep('done');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save rooms'));
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Common quick-add room types ── */
  const quickRoomTypes = [
    'Training Room',
    'Meeting Room',
    'Apparatus Bay',
    'Bunk Room',
    'Kitchen',
    'Office',
    'Common Area',
    'Gym',
  ];

  /* ── Render ── */
  return (
    // Named directly rather than by `aria-labelledby`: the only text at the top
    // of this wizard is the current step, which is a span and changes as you
    // move through it. A dialog's name should be what the dialog is.
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Location setup"
    >
      <DialogPanel
        onClose={() => onDismiss?.()}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden"
      >
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-theme-text-muted text-xs font-medium">
              Step {stepIndex} of {totalSteps}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-theme-text-muted text-xs">
                {step === 'mode' && 'Department Type'}
                {step === 'stations' && 'Station Setup'}
                {step === 'rooms' && 'Room Setup'}
                {step === 'done' && 'Complete'}
              </span>
              {onDismiss && (
                <button
                  data-dialog-close
                  onClick={onDismiss}
                  className="text-theme-text-muted hover:text-theme-text-primary touch:mobile-touch-target transition-colors"
                  aria-label="Close wizard"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="bg-theme-surface-hover h-1.5 w-full rounded-full">
            <div
              className="h-1.5 rounded-full bg-red-500 transition-all duration-500"
              style={{ width: `${(stepIndex / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Content area — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ── STEP 1: Mode ── */}
          {step === 'mode' && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10">
                  <HelpCircle className="h-7 w-7 text-blue-700 dark:text-blue-400" />
                </div>
                <h2 className="text-theme-text-primary text-xl font-bold">How is your department organized?</h2>
                <p className="text-theme-text-secondary mt-2 text-sm">
                  This helps us tailor the experience. You can always change this later.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => {
                    void handleModeSelect('single_station');
                  }}
                  className="bg-theme-surface-hover border-theme-surface-border group flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all hover:border-red-500/50"
                >
                  <div className="bg-theme-surface flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors group-hover:bg-red-500/10">
                    <Building className="text-theme-text-muted h-6 w-6 transition-colors group-hover:text-red-500" />
                  </div>
                  <div>
                    <span className="text-theme-text-primary block text-sm font-semibold">Single Station</span>
                    <span className="text-theme-text-muted text-xs">
                      We operate from one location — no need to choose a station when scheduling events.
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => {
                    void handleModeSelect('multi_station');
                  }}
                  className="bg-theme-surface-hover border-theme-surface-border group flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all hover:border-red-500/50"
                >
                  <div className="bg-theme-surface flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors group-hover:bg-red-500/10">
                    <Building2 className="text-theme-text-muted h-6 w-6 transition-colors group-hover:text-red-500" />
                  </div>
                  <div>
                    <span className="text-theme-text-primary block text-sm font-semibold">Multiple Stations</span>
                    <span className="text-theme-text-muted text-xs">
                      We have more than one station. Members and events are assigned to specific stations.
                    </span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Stations ── */}
          {step === 'stations' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-theme-text-primary text-xl font-bold">
                  {mode === 'single_station' ? 'Tell us about your station' : 'Add your stations'}
                </h2>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  {mode === 'single_station'
                    ? 'Enter your station name and address. This will be used across the application.'
                    : 'Add each station with its name and address. You can add more stations later.'}
                </p>
              </div>

              <div className="space-y-4">
                {stations.map((station, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-4 ${
                      station.saved
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-theme-surface-border bg-theme-surface-hover/30'
                    }`}
                  >
                    {stations.length > 1 && (
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">
                          Station {idx + 1}
                          {station.saved && <span className="ml-2 text-green-500">Saved</span>}
                        </span>
                        {!station.saved && stations.length > 1 && (
                          <button
                            onClick={() => removeStation(idx)}
                            aria-label="Remove station"
                            className="text-theme-text-muted transition-colors hover:text-red-500"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="space-y-3">
                      <div>
                        <label htmlFor={`wizard-station-${idx}-name`} className={labelCls}>
                          Station Name / Number *
                        </label>
                        <input
                          id={`wizard-station-${idx}-name`}
                          type="text"
                          value={station.name}
                          onChange={(e) => updateStation(idx, 'name', e.target.value)}
                          placeholder="e.g., Station 1, Headquarters"
                          className={inputCls}
                          disabled={station.saved}
                        />
                      </div>
                      <div>
                        <label htmlFor={`wizard-station-${idx}-address`} className={labelCls}>
                          Street Address *
                        </label>
                        <input
                          id={`wizard-station-${idx}-address`}
                          type="text"
                          value={station.address}
                          onChange={(e) => updateStation(idx, 'address', e.target.value)}
                          placeholder="e.g., 123 Main Street"
                          className={inputCls}
                          disabled={station.saved}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label htmlFor={`wizard-station-${idx}-city`} className={labelCls}>
                            City
                          </label>
                          <input
                            id={`wizard-station-${idx}-city`}
                            type="text"
                            value={station.city}
                            onChange={(e) => updateStation(idx, 'city', e.target.value)}
                            className={inputCls}
                            disabled={station.saved}
                          />
                        </div>
                        <div>
                          <label htmlFor={`wizard-station-${idx}-state`} className={labelCls}>
                            State
                          </label>
                          <input
                            id={`wizard-station-${idx}-state`}
                            type="text"
                            value={station.state}
                            onChange={(e) => updateStation(idx, 'state', e.target.value)}
                            className={inputCls}
                            disabled={station.saved}
                          />
                        </div>
                        <div>
                          <label htmlFor={`wizard-station-${idx}-zip`} className={labelCls}>
                            Zip
                          </label>
                          <input
                            id={`wizard-station-${idx}-zip`}
                            type="text"
                            inputMode="numeric"
                            autoComplete="postal-code"
                            value={station.zip}
                            onChange={(e) => updateStation(idx, 'zip', e.target.value)}
                            className={inputCls}
                            disabled={station.saved}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {mode === 'multi_station' && (
                  <button
                    onClick={addAnotherStation}
                    className="text-theme-text-secondary border-theme-surface-border flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 text-sm transition-all hover:border-red-500/50 hover:text-red-500"
                  >
                    <Plus className="h-4 w-4" /> Add Another Station
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Rooms ── */}
          {step === 'rooms' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-theme-text-primary text-xl font-bold">
                  Add rooms to {stations[activeStationIdx]?.name || 'your station'}
                </h2>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  Rooms are used for meeting scheduling, training sessions, and QR check-in.
                  {stations.length > 1 && (
                    <span className="text-theme-text-primary ml-1 font-medium">
                      (Station {activeStationIdx + 1} of {stations.length})
                    </span>
                  )}
                </p>
              </div>

              {/* Quick-add buttons */}
              <div>
                <label className="text-theme-text-muted mb-2 block text-xs font-medium">Quick add common rooms</label>
                <div className="flex flex-wrap gap-2">
                  {quickRoomTypes.map((type) => {
                    const alreadyAdded = currentRooms.some((r) => r.name === type);
                    return (
                      <button
                        key={type}
                        disabled={alreadyAdded}
                        onClick={() => {
                          const updated = new Map(roomsByStation);
                          const list = [
                            ...(updated.get(activeStationIdx) || []),
                            { name: type, room_number: '', floor: '', capacity: '' },
                          ];
                          updated.set(activeStationIdx, list);
                          setRoomsByStation(updated);
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          alreadyAdded
                            ? 'cursor-not-allowed border-green-500/30 bg-green-500/10 text-green-500'
                            : 'border-theme-surface-border bg-theme-surface-hover text-theme-text-secondary hover:border-red-500/50 hover:text-red-500'
                        }`}
                      >
                        {alreadyAdded ? '+ ' : '+ '}
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Added rooms list */}
              {currentRooms.length > 0 && (
                <div className="space-y-2">
                  <label className="text-theme-text-muted block text-xs font-medium">
                    Rooms added ({currentRooms.length})
                  </label>
                  {currentRooms.map((room, idx) => (
                    <div
                      key={idx}
                      className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <DoorOpen className="text-theme-text-muted h-4 w-4" />
                        <div>
                          <span className="text-theme-text-primary text-sm font-medium">{room.name}</span>
                          {(room.room_number || room.floor || room.capacity) && (
                            <span className="text-theme-text-muted ml-2 text-xs">
                              {[
                                room.room_number && `#${room.room_number}`,
                                room.floor && `Floor ${room.floor}`,
                                room.capacity && `Cap: ${room.capacity}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                      {room.saved ? (
                        <span className="text-xs text-green-700 dark:text-green-400">Saved</span>
                      ) : (
                        <button
                          onClick={() => removeRoom(idx)}
                          aria-label="Remove room"
                          className="text-theme-text-muted p-1 transition-colors hover:text-red-500"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Custom room form */}
              <div className="bg-theme-surface-hover/30 border-theme-surface-border space-y-3 rounded-xl border p-4">
                <label className="text-theme-text-muted block text-xs font-semibold tracking-wider uppercase">
                  Add a custom room
                </label>
                <div>
                  <label htmlFor="wizard-room-room-name" className={labelCls}>
                    Room Name *
                  </label>
                  <input
                    id="wizard-room-room-name"
                    type="text"
                    value={roomForm.name}
                    onChange={(e) => setRoomForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Chief's Office, Supply Closet"
                    className={inputCls}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addRoom();
                      }
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wizard-room-room-number" className={labelCls}>
                      Room #
                    </label>
                    <input
                      id="wizard-room-room-number"
                      type="text"
                      value={roomForm.room_number}
                      onChange={(e) => setRoomForm((p) => ({ ...p, room_number: e.target.value }))}
                      placeholder="101"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-room-floor" className={labelCls}>
                      Floor
                    </label>
                    <input
                      id="wizard-room-floor"
                      type="text"
                      value={roomForm.floor}
                      onChange={(e) => setRoomForm((p) => ({ ...p, floor: e.target.value }))}
                      placeholder="1"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-room-capacity" className={labelCls}>
                      Capacity
                    </label>
                    <input
                      id="wizard-room-capacity"
                      type="number"
                      min="1"
                      step="1"
                      value={roomForm.capacity}
                      onChange={(e) => setRoomForm((p) => ({ ...p, capacity: e.target.value }))}
                      placeholder="25"
                      className={inputCls}
                    />
                  </div>
                </div>
                <button
                  onClick={addRoom}
                  disabled={!roomForm.name.trim()}
                  className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                >
                  <Plus className="h-4 w-4" /> Add Room
                </button>
              </div>

              {/* Multi-station nav */}
              {stations.length > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handlePrevStation}
                    disabled={activeStationIdx === 0}
                    className="text-theme-text-secondary hover:text-theme-text-primary text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ← Previous Station
                  </button>
                  <span className="text-theme-text-muted text-xs">{stations[activeStationIdx]?.name}</span>
                  {activeStationIdx < stations.length - 1 ? (
                    <button
                      onClick={handleNextStation}
                      className="text-sm font-medium text-red-500 transition-colors hover:text-red-800 dark:hover:text-red-400"
                    >
                      Next Station →
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Done ── */}
          {step === 'done' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10">
                <Building2 className="h-8 w-8 text-green-500" />
              </div>
              <div>
                <h2 className="text-theme-text-primary text-xl font-bold">You're all set!</h2>
                <p className="text-theme-text-secondary mt-2 text-sm">
                  Your locations are configured and ready for use in meetings, training, events, and QR check-in.
                </p>
              </div>
              <div className="bg-theme-surface-hover/50 space-y-3 rounded-xl p-4 text-left">
                {stations.map((station, idx) => {
                  const stationRooms = roomsByStation.get(idx) || [];
                  return (
                    <div key={idx}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-red-500" />
                        <span className="text-theme-text-primary text-sm font-semibold">{station.name}</span>
                      </div>
                      {station.address && (
                        <p className="text-theme-text-muted ml-6 text-xs">
                          {[station.address, station.city, station.state, station.zip].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {stationRooms.length > 0 && (
                        <div className="mt-1 ml-6 flex flex-wrap gap-1.5">
                          {stationRooms.map((room, rIdx) => (
                            <span
                              key={rIdx}
                              className="card text-theme-text-secondary inline-flex items-center gap-1 px-2 py-0.5 text-xs"
                            >
                              <DoorOpen className="h-3 w-3" /> {room.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 border-t p-6">
          {step === 'mode' && (
            <>
              <span />
              <span className="text-theme-text-muted text-xs">Select an option above</span>
            </>
          )}

          {step === 'stations' && (
            <>
              <button
                onClick={() => setStep('mode')}
                className="text-theme-text-secondary hover:text-theme-text-primary text-sm transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  void handleSaveStations();
                }}
                disabled={isSaving || stations.every((s) => !s.name.trim())}
                className="btn-primary flex items-center gap-2 px-5 py-2.5"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue to Rooms →
              </button>
            </>
          )}

          {step === 'rooms' && (
            <>
              <button
                onClick={() => setStep('stations')}
                className="text-theme-text-secondary hover:text-theme-text-primary text-sm transition-colors"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setStep('done');
                    onComplete();
                  }}
                  className="text-theme-text-secondary hover:text-theme-text-primary text-sm transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => {
                    void handleFinishRooms();
                  }}
                  disabled={isSaving}
                  className="btn-primary flex items-center gap-2 px-5 py-2.5"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {[...roomsByStation.values()].some((r) => r.length > 0)
                    ? 'Save Rooms & Finish'
                    : 'Finish Without Rooms'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <span />
              <button onClick={onComplete} className="btn-primary flex items-center gap-2 px-5 py-2.5">
                Go to Locations →
              </button>
            </>
          )}
        </div>
      </DialogPanel>
    </div>
  );
}

/**
 * Room card with kiosk display URL
 */
function RoomCard({
  room,
  onEdit,
  onDelete,
}: {
  room: Location;
  onEdit?: ((r: Location) => void) | undefined;
  onDelete?: ((r: Location) => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const qrPanelId = `room-qr-${room.id}`;

  const kioskUrl = room.display_code ? `${window.location.origin}/display/${room.display_code}` : null;

  const handleCopyKioskUrl = async () => {
    if (!kioskUrl) return;
    try {
      await copyToClipboard(kioskUrl);
      setCopied(true);
      toast.success('Kiosk URL copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  return (
    <div className="card group flex flex-col p-3">
      <div className="flex min-w-0 items-center gap-3">
        <DoorOpen className="text-theme-text-muted h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-theme-text-primary line-clamp-2 text-sm font-medium">
            {room.name}
            {room.room_number ? ` #${room.room_number}` : ''}
          </p>
          <p className="text-theme-text-muted text-xs">
            {[room.floor ? `Floor ${room.floor}` : null, room.capacity ? `Cap: ${room.capacity}` : null]
              .filter(Boolean)
              .join(' · ') || 'No details'}
          </p>
        </div>
      </div>
      {/* The actions share a row with the display URL rather than the title.
          Beside the title, three 44px touch targets would have left a 320px
          phone's 230px room card about 80px for the room name; at their old
          22px they fit, but were too small to hit. The row wraps rather than
          squeezing the URL: at 320px the actions drop beneath it. */}
      {(kioskUrl || onEdit || onDelete) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {kioskUrl && (
            <button
              onClick={() => {
                void handleCopyKioskUrl();
              }}
              className="text-theme-text-muted touch:min-h-11 flex max-w-full items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
              title="Copy kiosk display URL for this room"
            >
              {copied ? (
                <Check className="h-3 w-3 shrink-0 text-green-500" />
              ) : (
                <Monitor className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate font-mono">/display/{room.display_code}</span>
              {!copied && (
                <Copy className="h-3 w-3 shrink-0 pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100" />
              )}
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {/* QR toggle stays visible at all times — it was nearly undiscoverable
                when it only appeared on hover with the edit/delete actions */}
            {kioskUrl && (
              <button
                type="button"
                onClick={() => setShowQR((prev) => !prev)}
                aria-label="Toggle QR code"
                aria-expanded={showQR}
                aria-controls={showQR ? qrPanelId : undefined}
                className="text-theme-text-muted touch-target-phone rounded-sm p-1 transition-colors hover:text-blue-500"
                title="Show QR code"
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {(onEdit || onDelete) && (
              <div className="flex items-center gap-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                {onEdit && (
                  <button
                    onClick={() => onEdit(room)}
                    aria-label="Edit room"
                    className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone rounded-sm p-1 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(room)}
                    aria-label="Delete room"
                    className="text-theme-text-muted touch-target-phone rounded-sm p-1 transition-colors hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {showQR && kioskUrl && (
        <div
          id={qrPanelId}
          className="border-theme-surface-border mt-3 flex flex-col items-center gap-2 rounded-lg border bg-white p-3"
        >
          {' '}
          {/* bg-white intentional for QR code readability */}
          <QRCodeSVG value={kioskUrl} size={140} level="H" includeMargin title={`Kiosk QR code for ${room.name}`} />
          <p className="text-theme-text-muted text-center font-mono text-[10px] break-all">{kioskUrl}</p>
        </div>
      )}
    </div>
  );
}

export default function LocationsPage() {
  const { confirm } = useConfirm();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canExportQRCodes = checkPermission('locations.manage') || checkPermission('facilities.manage');
  // Mirrors the Card Readers route: room managers and room-tag writers.
  const canViewReaders = canExportQRCodes || checkPermission('locations.manage_nfc_tags');
  // The page is open to every member, since events and forms pick from these
  // locations, so each control mirrors the permission its endpoint enforces.
  // Offered to a plain member, they ended in a 403 and "Failed to save setting".
  const canCreate = checkPermission('locations.create') || checkPermission('locations.manage');
  const canEdit = checkPermission('locations.edit') || checkPermission('locations.manage');
  const canDelete = checkPermission('locations.delete') || checkPermission('locations.manage');
  const canSetStationMode = checkPermission('settings.manage') || checkPermission('organization.update_settings');
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());

  // Station mode (single vs multi-station department)
  const [stationMode, setStationMode] = useState<StationMode>(null);
  const [stationModeLoading, setStationModeLoading] = useState(true);

  // Station modal state
  const [showStationModal, setShowStationModal] = useState(false);
  const [editingStation, setEditingStation] = useState<Location | null>(null);
  const [stationForm, setStationForm] = useState<Record<StationField, string>>(EMPTY_STATION_FORM);
  const [stationInitial, setStationInitial] = useState<Record<StationField, string>>(EMPTY_STATION_FORM);
  const [stationErrors, setStationErrors] = useState<Partial<Record<StationField, string | undefined>>>({});
  const [isSavingStation, setIsSavingStation] = useState(false);

  // Room modal state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Location | null>(null);
  const [roomParentStation, setRoomParentStation] = useState<string>('');
  const [roomForm, setRoomForm] = useState<Record<RoomField, string>>(EMPTY_ROOM_FORM);
  const [roomInitial, setRoomInitial] = useState<Record<RoomField, string>>(EMPTY_ROOM_FORM);
  const [roomErrors, setRoomErrors] = useState<Partial<Record<RoomField, string | undefined>>>({});
  const [isSavingRoom, setIsSavingRoom] = useState(false);

  // Setup wizard state
  const [showWizard, setShowWizard] = useState(false);
  const wizardDismissedRef = React.useRef(false);

  // Load station mode from org settings
  useEffect(() => {
    const loadStationMode = async () => {
      try {
        const settings = await organizationService.getSettings();
        const mode = (settings as Record<string, unknown>).station_mode as StationMode;
        setStationMode(mode || null);
      } catch {
        // If we can't load settings, proceed without mode set
      } finally {
        setStationModeLoading(false);
      }
    };
    void loadStationMode();
  }, []);

  const handleSetStationMode = async (mode: 'single_station' | 'multi_station') => {
    try {
      await organizationService.updateSettings({ station_mode: mode });
      setStationMode(mode);
      toast.success(mode === 'single_station' ? 'Single-station mode set' : 'Multi-station mode set');
    } catch {
      toast.error('Failed to save setting');
    }
  };

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await locationsService.getLocations({ is_active: true });
      setLocations(data);
    } catch {
      toast.error('Failed to load locations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  // Auto-show wizard only when the user has zero locations and hasn't dismissed it
  useEffect(() => {
    if (stationModeLoading || isLoading) return;
    if (wizardDismissedRef.current || !canCreate) return;
    // Only auto-show when there are truly no locations at all.
    // If the user already has locations (even if stationMode isn't set), let them
    // use the page normally — they can launch the wizard manually if needed.
    if (locations.length === 0) {
      setShowWizard(true);
    }
  }, [stationModeLoading, isLoading, locations, canCreate]);

  const { stations, rooms } = groupLocations(
    locations.filter(
      (l) =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.building?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.room_number?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const toggleStation = (stationName: string) => {
    setExpandedStations((prev) => {
      const next = new Set(prev);
      if (next.has(stationName)) next.delete(stationName);
      else next.add(stationName);
      return next;
    });
  };

  // ── Station CRUD ──
  const openStationDialog = (station: Location | null, form: Record<StationField, string>) => {
    setEditingStation(station);
    setStationForm(form);
    setStationInitial(form);
    setStationErrors({});
    setShowStationModal(true);
  };

  const openCreateStation = () => openStationDialog(null, EMPTY_STATION_FORM);

  const openEditStation = (station: Location) =>
    openStationDialog(station, {
      name: station.name || '',
      address: station.address || '',
      city: station.city || '',
      state: station.state || '',
      zip: station.zip || '',
      description: station.description || '',
    });

  const setStationField = (field: StationField, value: string) => {
    setStationForm((p) => ({ ...p, [field]: value }));
    setStationErrors((p) => ({ ...p, [field]: undefined }));
  };

  // Escape, the X and Cancel all ask before discarding a changed station.
  const requestCloseStation = useDiscardGuard({
    isDirty: showStationModal && !sameForm(stationForm, stationInitial),
    onClose: () => setShowStationModal(false),
  });

  const showStationErrors = (errors: Partial<Record<StationField, string | undefined>>) => {
    setStationErrors(errors);
    const first = firstErrorKey(STATION_FIELDS, errors);
    if (first) document.getElementById(STATION_FIELD_IDS[first])?.focus();
  };

  const handleSaveStation = async () => {
    const missing: Partial<Record<StationField, string>> = {};
    if (!stationForm.name.trim()) missing.name = 'Enter the station name or number.';
    // groupLocations decides "station" by the presence of an address. A new
    // station without one, or an existing one with it cleared, lands under
    // "Other Locations" and every room filed under its name has no card to
    // render under, so the page would appear to lose them.
    if (!stationForm.address.trim()) missing.address = 'A station needs a street address.';
    if (Object.keys(missing).length > 0) {
      showStationErrors(missing);
      return;
    }
    setIsSavingStation(true);
    try {
      // On edit, a cleared box is sent as null: the update endpoint treats an
      // omitted key as "keep the stored value".
      const { text } = formCoercions(Boolean(editingStation));
      const payload: LocationCreate = {
        name: stationForm.name.trim(),
        address: text(stationForm.address),
        city: text(stationForm.city),
        state: text(stationForm.state),
        zip: text(stationForm.zip),
        description: text(stationForm.description),
      };
      let refused: Partial<Record<StationField, string>>;
      if (editingStation) {
        const oldName = editingStation.name;
        const result = await saveLocationExceptRefused(payload, STATION_FIELDS, {
          update: (body) => locationsService.updateLocation(editingStation.id, body),
        });
        refused = result.refused;
        // If station name changed, update the building field on all child rooms
        // so they stay grouped under the renamed station. A refused name was
        // not written, so the rooms keep the name the station still has.
        const newName = result.written?.name;
        if (newName !== undefined && oldName !== newName) {
          const stationRooms = rooms.get(oldName) || [];
          for (const room of stationRooms) {
            await locationsService.updateLocation(room.id, { building: newName });
          }
        }
      } else {
        refused = (
          await saveLocationExceptRefused(payload, STATION_FIELDS, {
            create: (body) => locationsService.createLocation(body),
          })
        ).refused;
      }
      const firstRefused = firstErrorKey(STATION_FIELDS, refused);
      if (firstRefused) {
        showStationErrors(refused);
        if (editingStation) {
          toast.error(
            `Station saved, except ${STATION_FIELDS[firstRefused].label.toLowerCase()}. Fix it and save again.`
          );
          void loadLocations();
        }
        return;
      }
      toast.success(editingStation ? 'Station updated' : 'Station added');
      setShowStationModal(false);
      void loadLocations();
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      toast.error(detail || 'Failed to save station');
    } finally {
      setIsSavingStation(false);
    }
  };

  const handleDeleteStation = async (station: Location) => {
    if (
      !(await confirm({
        title: 'Delete station',
        message: `Delete "${station.name}" and every room in it? Any of them that events, event templates or apparatus still use is deactivated instead of deleted, so those records keep it. This cannot be undone.`,
        confirmLabel: 'Delete station',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      // Rooms first, one request each. The server deactivates rather than
      // deletes anything still referenced, so a failure here is unexpected —
      // but the rooms already removed stay removed, which is why the list is
      // reloaded either way.
      const stationRooms = rooms.get(station.name) || [];
      for (const room of stationRooms) {
        await locationsService.deleteLocation(room.id);
      }
      await locationsService.deleteLocation(station.id);
      toast.success('Station deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete station'));
    } finally {
      void loadLocations();
    }
  };

  // ── Room CRUD ──
  const openRoomDialog = (room: Location | null, parent: string, form: Record<RoomField, string>) => {
    setEditingRoom(room);
    setRoomParentStation(parent);
    setRoomForm(form);
    setRoomInitial(form);
    setRoomErrors({});
    setShowRoomModal(true);
  };

  const openAddRoom = (stationName: string) => openRoomDialog(null, stationName, EMPTY_ROOM_FORM);

  const openEditRoom = (room: Location) =>
    openRoomDialog(room, room.building || '', {
      name: room.name || '',
      room_number: room.room_number || '',
      floor: room.floor || '',
      capacity: room.capacity?.toString() || '',
      description: room.description || '',
    });

  const setRoomField = (field: RoomField, value: string) => {
    setRoomForm((p) => ({ ...p, [field]: value }));
    setRoomErrors((p) => ({ ...p, [field]: undefined }));
  };

  const requestCloseRoom = useDiscardGuard({
    isDirty: showRoomModal && !sameForm(roomForm, roomInitial),
    onClose: () => setShowRoomModal(false),
  });

  const showRoomErrors = (errors: Partial<Record<RoomField, string | undefined>>) => {
    setRoomErrors(errors);
    const first = firstErrorKey(ROOM_FIELDS, errors);
    if (first) document.getElementById(ROOM_FIELD_IDS[first])?.focus();
  };

  const handleSaveRoom = async () => {
    const missing: Partial<Record<RoomField, string>> = {};
    if (!roomForm.name.trim()) missing.name = 'Enter the room name.';
    const roomCapacityError = capacityError(roomForm.capacity);
    if (roomCapacityError) missing.capacity = `${roomCapacityError}.`;
    if (Object.keys(missing).length > 0) {
      showRoomErrors(missing);
      return;
    }
    setIsSavingRoom(true);
    try {
      // On edit, a cleared box is sent as null: the update endpoint treats an
      // omitted key as "keep the stored value".
      const { text, num } = formCoercions(Boolean(editingRoom));
      const payload: LocationCreate = {
        name: roomForm.name.trim(),
        ...(roomParentStation ? { building: roomParentStation } : {}),
        room_number: text(roomForm.room_number),
        floor: text(roomForm.floor),
        capacity: num(roomForm.capacity),
        description: text(roomForm.description),
      };
      const { refused } = editingRoom
        ? await saveLocationExceptRefused(payload, ROOM_FIELDS, {
            update: (body) => locationsService.updateLocation(editingRoom.id, body),
          })
        : await saveLocationExceptRefused(payload, ROOM_FIELDS, {
            create: (body) => locationsService.createLocation(body),
          });
      const firstRefused = firstErrorKey(ROOM_FIELDS, refused);
      if (firstRefused) {
        showRoomErrors(refused);
        if (editingRoom) {
          toast.error(`Room saved, except ${ROOM_FIELDS[firstRefused].label.toLowerCase()}. Fix it and save again.`);
          void loadLocations();
        }
        return;
      }
      toast.success(editingRoom ? 'Room updated' : 'Room added');
      setShowRoomModal(false);
      void loadLocations();
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      toast.error(detail || 'Failed to save room');
    } finally {
      setIsSavingRoom(false);
    }
  };

  const handleDeleteRoom = async (room: Location) => {
    if (
      !(await confirm({
        title: 'Delete room',
        message: `Delete "${room.name}"? If events, event templates or apparatus still use it, it is deactivated instead of deleted, so those records keep it. This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await locationsService.deleteLocation(room.id);
      toast.success('Room deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete room'));
    } finally {
      void loadLocations();
    }
  };

  const inputCls = 'form-input py-2.5';

  const isSingleStation = stationMode === 'single_station';

  // For single-station mode, show a simplified header
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Setup Wizard */}
      {showWizard && (
        <LocationSetupWizard
          existingMode={stationMode}
          existingStations={groupLocations(locations).stations}
          onDismiss={() => {
            wizardDismissedRef.current = true;
            setShowWizard(false);
          }}
          onComplete={() => {
            wizardDismissedRef.current = true;
            setShowWizard(false);
            void loadLocations();
            // Reload station mode from settings in case it changed
            organizationService
              .getSettings()
              .then((settings) => {
                const mode = (settings as Record<string, unknown>).station_mode as StationMode;
                setStationMode(mode || null);
              })
              .catch(() => {
                /* non-critical settings reload */
              });
          }}
        />
      )}

      {/* Station Mode Badge (shown when configured, allows changing) */}
      {!stationModeLoading && stationMode !== null && (
        <div className="text-theme-text-muted flex flex-wrap items-center gap-2 text-xs">
          {isSingleStation ? (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-700 dark:text-blue-400">
              <Building className="h-3.5 w-3.5" /> Single-Station Department
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-700 dark:text-blue-400">
              <Building2 className="h-3.5 w-3.5" /> Multi-Station Agency
            </span>
          )}
          {canSetStationMode && (
            <button
              onClick={() => {
                void handleSetStationMode(isSingleStation ? 'multi_station' : 'single_station');
              }}
              className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 touch:min-w-11 underline"
            >
              Change
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => {
                wizardDismissedRef.current = false;
                setShowWizard(true);
              }}
              className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 touch:min-w-11 underline"
            >
              Run Setup Wizard
            </button>
          )}
        </div>
      )}

      {/* Station mode not set but locations exist — let user set mode or launch wizard */}
      {!stationModeLoading && stationMode === null && locations.length > 0 && canSetStationMode && (
        <div className="text-theme-text-muted flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-2.5 py-1 text-yellow-500">
            <HelpCircle className="h-3.5 w-3.5" /> Station mode not configured
          </span>
          <button
            onClick={() => {
              void handleSetStationMode('single_station');
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 touch:min-w-11 underline"
          >
            Set Single-Station
          </button>
          <button
            onClick={() => {
              void handleSetStationMode('multi_station');
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 touch:min-w-11 underline"
          >
            Set Multi-Station
          </button>
          {canCreate && (
            <button
              onClick={() => {
                wizardDismissedRef.current = false;
                setShowWizard(true);
              }}
              className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 touch:min-w-11 underline"
            >
              Run Setup Wizard
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="page-header gap-3 sm:items-center">
        <div className="page-header-title">
          <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">
            {isSingleStation ? 'Location & Rooms' : 'Locations & Rooms'}
          </h1>
          <p className="text-theme-text-secondary mt-1">
            {isSingleStation
              ? 'Manage your station address and rooms for events, forms, and QR check-in'
              : 'Manage station addresses and room names for events, forms, and QR check-in'}
          </p>
        </div>
        <div className="page-header-actions flex flex-wrap items-center gap-2">
          {canExportQRCodes && (
            <Link
              to="/locations/qr-codes"
              className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover hover:text-theme-text-primary touch:min-h-11 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" /> Check-In QR Codes
            </Link>
          )}
          {canViewReaders && (
            <Link
              to="/locations/card-readers"
              className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover hover:text-theme-text-primary touch:min-h-11 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
            >
              <Nfc className="h-4 w-4" aria-hidden="true" /> Card Readers
            </Link>
          )}
          {canCreate && (!isSingleStation || stations.length === 0) && (
            <button onClick={openCreateStation} className="btn-primary flex items-center gap-2 py-2.5">
              <Plus className="h-4 w-4" /> {isSingleStation ? 'Set Up Location' : 'Add Station'}
            </button>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
        <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="text-theme-text-secondary text-sm">
          {isSingleStation ? (
            <p>
              Set up your station address and rooms. These are used for event scheduling, meeting rooms, training
              sessions, and QR code check-in. Since you operate from a single location, members will be automatically
              associated with this station.
            </p>
          ) : (
            <p>
              Locations added here are available for event scheduling, meeting room selection, training sessions, and QR
              code check-in. Add your stations with their addresses and list each room for use across the platform.
            </p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search stations or rooms..."
          placeholder="Search stations or rooms..."
          className="form-input placeholder-theme-text-muted py-2.5 pr-4 pl-10"
        />
      </div>

      {/* Station List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : stations.length === 0 && !rooms.has('__other__') ? (
        <div className="py-20 text-center">
          <Building2 className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h2 className="text-theme-text-primary mb-1 text-lg font-medium">No locations yet</h2>
          {canCreate && (
            <>
              <p className="text-theme-text-muted mb-4">
                Add your first station to get started. You can then add rooms within it.
              </p>
              <button onClick={openCreateStation} className="btn-primary inline-flex items-center gap-2 py-2.5">
                <Plus className="h-4 w-4" /> Add Station
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {stations.map((station) => {
            const stationRooms = rooms.get(station.name) || [];
            const isExpanded = expandedStations.has(station.name);
            const address = [station.address, station.city, station.state, station.zip].filter(Boolean).join(', ');

            return (
              <div key={station.id} className="card overflow-hidden">
                {/* Station Header */}
                <div className="flex flex-wrap items-center gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                    <Building2 className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-theme-text-primary text-lg font-semibold">{station.name}</h2>
                    {address && (
                      <p className="text-theme-text-secondary mt-0.5 flex items-center gap-1.5 text-sm">
                        <MapPin className="h-3.5 w-3.5 shrink-0" /> {address}
                      </p>
                    )}
                    {station.description && <p className="text-theme-text-muted mt-1 text-sm">{station.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        onClick={() => openEditStation(station)}
                        title="Edit station"
                        aria-label="Edit station"
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-lg p-2 transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => {
                          void handleDeleteStation(station);
                        }}
                        title="Delete station"
                        aria-label="Delete station"
                        className="text-theme-text-muted touch-target-phone rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleStation(station.name)}
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? `station-rooms-${station.id}` : undefined}
                      className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover touch:min-h-11 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
                    >
                      <DoorOpen className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {stationRooms.length} room{stationRooms.length !== 1 ? 's' : ''}
                      </span>
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* Rooms Panel */}
                {isExpanded && (
                  <div
                    id={`station-rooms-${station.id}`}
                    className="border-theme-surface-border bg-theme-surface-hover/30 space-y-2 border-t p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-theme-text-primary text-sm font-semibold">Rooms</h3>
                      {canCreate && (
                        <button
                          onClick={() => openAddRoom(station.name)}
                          className="touch:min-h-11 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                        >
                          <Plus className="h-3 w-3" /> Add Room
                        </button>
                      )}
                    </div>
                    {stationRooms.length === 0 ? (
                      <p className="text-theme-text-muted py-2 text-sm">
                        No rooms added yet. Add rooms for QR check-in and event scheduling.
                      </p>
                    ) : (
                      <div className="card-grid items-start gap-2 [--card-grid-min:18rem]">
                        {stationRooms.map((room) => (
                          <RoomCard
                            key={room.id}
                            room={room}
                            onEdit={canEdit ? openEditRoom : undefined}
                            onDelete={
                              canDelete
                                ? (r) => {
                                    void handleDeleteRoom(r);
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Orphan rooms (rooms without a station) */}
          {rooms.has('__other__') && (
            <div className="card p-5">
              <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">Other Locations</h2>
              <div className="card-grid items-start gap-2 [--card-grid-min:18rem]">
                {(rooms.get('__other__') || []).map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    onEdit={canEdit ? openEditRoom : undefined}
                    onDelete={
                      canDelete
                        ? (r) => {
                            void handleDeleteRoom(r);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Station Modal */}
      {showStationModal && (
        <div
          className="modal-overlay z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="station-dialog-title"
        >
          <DialogPanel onClose={requestCloseStation} className="modal-panel-scroll w-full max-w-md">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveStation();
              }}
            >
              <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
                <h2 id="station-dialog-title" className="text-theme-text-primary text-lg font-bold">
                  {editingStation ? 'Edit Station' : 'Add Station'}
                </h2>
                <button
                  type="button"
                  data-dialog-close
                  onClick={requestCloseStation}
                  aria-label="Close dialog"
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <FormField
                  label="Station Name / Number"
                  required
                  id={STATION_FIELD_IDS.name}
                  error={stationErrors.name}
                  maxLength={STATION_FIELDS.name.maxLength}
                  count={stationForm.name.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoComplete="off"
                      value={stationForm.name}
                      onChange={(e) => setStationField('name', e.target.value)}
                      placeholder="e.g., Station 1, Headquarters"
                      className={inputCls}
                    />
                  )}
                </FormField>
                <FormField
                  label="Street Address"
                  required
                  id={STATION_FIELD_IDS.address}
                  error={stationErrors.address}
                  maxLength={STATION_FIELDS.address.maxLength}
                  count={stationForm.address.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoComplete="street-address"
                      value={stationForm.address}
                      onChange={(e) => setStationField('address', e.target.value)}
                      placeholder="123 Main Street"
                      className={inputCls}
                    />
                  )}
                </FormField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField
                    label="City"
                    id={STATION_FIELD_IDS.city}
                    error={stationErrors.city}
                    maxLength={STATION_FIELDS.city.maxLength}
                    count={stationForm.city.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="address-level2"
                        value={stationForm.city}
                        onChange={(e) => setStationField('city', e.target.value)}
                        className={inputCls}
                      />
                    )}
                  </FormField>
                  <FormField
                    label="State"
                    id={STATION_FIELD_IDS.state}
                    error={stationErrors.state}
                    maxLength={STATION_FIELDS.state.maxLength}
                    count={stationForm.state.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="address-level1"
                        value={stationForm.state}
                        onChange={(e) => setStationField('state', e.target.value)}
                        className={inputCls}
                      />
                    )}
                  </FormField>
                  <FormField
                    label="Zip"
                    id={STATION_FIELD_IDS.zip}
                    error={stationErrors.zip}
                    maxLength={STATION_FIELDS.zip.maxLength}
                    count={stationForm.zip.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        value={stationForm.zip}
                        onChange={(e) => setStationField('zip', e.target.value)}
                        className={inputCls}
                      />
                    )}
                  </FormField>
                </div>
                <FormField label="Description" id={STATION_FIELD_IDS.description} error={stationErrors.description}>
                  {(field) => (
                    <textarea
                      {...field}
                      value={stationForm.description}
                      onChange={(e) => setStationField('description', e.target.value)}
                      rows={2}
                      placeholder="Optional notes about this station..."
                      className={inputCls + ' resize-none'}
                    />
                  )}
                </FormField>
              </div>
              <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
                <button
                  type="button"
                  onClick={requestCloseStation}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSavingStation} className="btn-primary flex items-center gap-2 px-5">
                  {isSavingStation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingStation ? 'Update' : 'Add Station'}
                </button>
              </div>
            </form>
          </DialogPanel>
        </div>
      )}

      {/* Room Modal */}
      {showRoomModal && (
        <div
          className="modal-overlay z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-dialog-title"
        >
          <DialogPanel onClose={requestCloseRoom} className="modal-panel-scroll w-full max-w-md">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveRoom();
              }}
            >
              <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
                <h2 id="room-dialog-title" className="text-theme-text-primary text-lg font-bold">
                  {editingRoom ? 'Edit Room' : `Add Room${roomParentStation ? ` to ${roomParentStation}` : ''}`}
                </h2>
                <button
                  type="button"
                  data-dialog-close
                  onClick={requestCloseRoom}
                  aria-label="Close dialog"
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <FormField
                  label="Room Name"
                  required
                  id={ROOM_FIELD_IDS.name}
                  error={roomErrors.name}
                  maxLength={ROOM_FIELDS.name.maxLength}
                  count={roomForm.name.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoComplete="off"
                      value={roomForm.name}
                      onChange={(e) => setRoomField('name', e.target.value)}
                      placeholder="e.g., Main Hall, Bunk Room A, Training Room"
                      className={inputCls}
                    />
                  )}
                </FormField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    label="Room Number"
                    id={ROOM_FIELD_IDS.room_number}
                    error={roomErrors.room_number}
                    maxLength={ROOM_FIELDS.room_number.maxLength}
                    count={roomForm.room_number.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="off"
                        value={roomForm.room_number}
                        onChange={(e) => setRoomField('room_number', e.target.value)}
                        placeholder="e.g., 101"
                        className={inputCls}
                      />
                    )}
                  </FormField>
                  <FormField
                    label="Floor"
                    id={ROOM_FIELD_IDS.floor}
                    error={roomErrors.floor}
                    maxLength={ROOM_FIELDS.floor.maxLength}
                    count={roomForm.floor.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="off"
                        value={roomForm.floor}
                        onChange={(e) => setRoomField('floor', e.target.value)}
                        placeholder="e.g., 1, 2, Basement"
                        className={inputCls}
                      />
                    )}
                  </FormField>
                </div>
                <FormField label="Capacity" id={ROOM_FIELD_IDS.capacity} error={roomErrors.capacity}>
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      min="1"
                      step="1"
                      value={roomForm.capacity}
                      onChange={(e) => setRoomField('capacity', e.target.value)}
                      placeholder="Maximum occupancy"
                      className={inputCls}
                    />
                  )}
                </FormField>
                <FormField label="Description" id={ROOM_FIELD_IDS.description} error={roomErrors.description}>
                  {(field) => (
                    <textarea
                      {...field}
                      value={roomForm.description}
                      onChange={(e) => setRoomField('description', e.target.value)}
                      rows={2}
                      placeholder="Equipment, amenities, or notes about this room..."
                      className={inputCls + ' resize-none'}
                    />
                  )}
                </FormField>
              </div>
              <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
                <button
                  type="button"
                  onClick={requestCloseRoom}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSavingRoom} className="btn-primary flex items-center gap-2 px-5">
                  {isSavingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingRoom ? 'Update' : 'Add Room'}
                </button>
              </div>
            </form>
          </DialogPanel>
        </div>
      )}
    </div>
  );
}
