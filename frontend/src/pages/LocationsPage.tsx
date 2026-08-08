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

/** Copy text to clipboard with fallback for non-HTTPS contexts */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // clipboard API failed (e.g. non-secure context) — fall through to fallback
    }
  }
  // Fallback: temporary textarea + execCommand
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

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

type StationMode = 'single_station' | 'multi_station' | null;

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

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-sm font-medium text-theme-text-secondary mb-1';

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
    }
    setIsSaving(true);
    try {
      const newStations = [...stations];
      for (let i = 0; i < newStations.length; i++) {
        const s = newStations[i];
        if (!s) continue;
        if (!s.saved) {
          const created = await locationsService.createLocation({
            name: s.name.trim(),
            ...(s.address.trim() ? { address: s.address.trim() } : {}),
            ...(s.city.trim() ? { city: s.city.trim() } : {}),
            ...(s.state.trim() ? { state: s.state.trim() } : {}),
            ...(s.zip.trim() ? { zip: s.zip.trim() } : {}),
          });
          newStations[i] = { ...s, saved: true, savedId: created.id };
        }
      }
      setStations(newStations);
      setActiveStationIdx(0);
      setStep('rooms');
    } catch {
      toast.error('Failed to save station');
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
        for (const room of roomList) {
          await locationsService.createLocation({
            name: room.name.trim(),
            building: station.name.trim(),
            ...(room.room_number.trim() ? { room_number: room.room_number.trim() } : {}),
            ...(room.floor.trim() ? { floor: room.floor.trim() } : {}),
            ...(room.capacity ? { capacity: Number(room.capacity) } : {}),
          });
        }
      }
      setStep('done');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to save rooms');
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-theme-surface-modal border-theme-surface-border flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border">
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
                  onClick={onDismiss}
                  className="text-theme-text-muted hover:text-theme-text-primary max-md:mobile-touch-target transition-colors"
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
                        <label className={labelCls}>Station Name / Number *</label>
                        <input
                          type="text"
                          value={station.name}
                          onChange={(e) => updateStation(idx, 'name', e.target.value)}
                          placeholder="e.g., Station 1, Headquarters"
                          className={inputCls}
                          disabled={station.saved}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Street Address</label>
                        <input
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
                          <label className={labelCls}>City</label>
                          <input
                            type="text"
                            value={station.city}
                            onChange={(e) => updateStation(idx, 'city', e.target.value)}
                            className={inputCls}
                            disabled={station.saved}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>State</label>
                          <input
                            type="text"
                            value={station.state}
                            onChange={(e) => updateStation(idx, 'state', e.target.value)}
                            className={inputCls}
                            disabled={station.saved}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Zip</label>
                          <input
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
                      <button
                        onClick={() => removeRoom(idx)}
                        aria-label="Remove room"
                        className="text-theme-text-muted p-1 transition-colors hover:text-red-500"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
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
                  <label className={labelCls}>Room Name *</label>
                  <input
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
                    <label className={labelCls}>Room #</label>
                    <input
                      type="text"
                      value={roomForm.room_number}
                      onChange={(e) => setRoomForm((p) => ({ ...p, room_number: e.target.value }))}
                      placeholder="101"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Floor</label>
                    <input
                      type="text"
                      value={roomForm.floor}
                      onChange={(e) => setRoomForm((p) => ({ ...p, floor: e.target.value }))}
                      placeholder="1"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Capacity</label>
                    <input
                      type="number"
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
                              className="bg-theme-surface border-theme-surface-border text-theme-text-secondary inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
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
        <div className="border-theme-surface-border flex items-center justify-between border-t p-6">
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
      </div>
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
  onEdit: (r: Location) => void;
  onDelete: (r: Location) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

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
    <div className="bg-theme-surface border-theme-surface-border group flex flex-col rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <DoorOpen className="text-theme-text-muted h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-theme-text-primary truncate text-sm font-medium">
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
        <div className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          {kioskUrl && (
            <button
              onClick={() => setShowQR((prev) => !prev)}
              aria-label="Toggle QR code"
              className="text-theme-text-muted rounded-sm p-1 transition-colors hover:text-blue-500"
              title="Show QR code"
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={() => onEdit(room)}
            aria-label="Edit room"
            className="text-theme-text-muted hover:text-theme-text-primary rounded-sm p-1 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={() => onDelete(room)}
            aria-label="Delete room"
            className="text-theme-text-muted rounded-sm p-1 transition-colors hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {kioskUrl && (
        <button
          onClick={() => {
            void handleCopyKioskUrl();
          }}
          className="text-theme-text-muted mt-2 flex items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
          title="Copy kiosk display URL for this room"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Monitor className="h-3 w-3" />}
          <span className="truncate font-mono">/display/{room.display_code}</span>
          {!copied && <Copy className="h-3 w-3 sm:opacity-0 sm:group-hover:opacity-100" />}
        </button>
      )}
      {showQR && kioskUrl && (
        <div className="border-theme-surface-border mt-3 flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
          {' '}
          {/* bg-white intentional for QR code readability */}
          <QRCodeSVG value={kioskUrl} size={140} level="H" includeMargin />
          <p className="text-theme-text-muted text-center font-mono text-[10px] break-all">{kioskUrl}</p>
        </div>
      )}
    </div>
  );
}

export default function LocationsPage() {
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
  const [stationForm, setStationForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    description: '',
  });
  const [isSavingStation, setIsSavingStation] = useState(false);

  // Room modal state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Location | null>(null);
  const [roomParentStation, setRoomParentStation] = useState<string>('');
  const [roomForm, setRoomForm] = useState({ name: '', room_number: '', floor: '', capacity: '', description: '' });
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
    if (wizardDismissedRef.current) return;
    // Only auto-show when there are truly no locations at all.
    // If the user already has locations (even if stationMode isn't set), let them
    // use the page normally — they can launch the wizard manually if needed.
    if (locations.length === 0) {
      setShowWizard(true);
    }
  }, [stationModeLoading, isLoading, locations]);

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
  const openCreateStation = () => {
    setEditingStation(null);
    setStationForm({ name: '', address: '', city: '', state: '', zip: '', description: '' });
    setShowStationModal(true);
  };

  const openEditStation = (station: Location) => {
    setEditingStation(station);
    setStationForm({
      name: station.name || '',
      address: station.address || '',
      city: station.city || '',
      state: station.state || '',
      zip: station.zip || '',
      description: station.description || '',
    });
    setShowStationModal(true);
  };

  const handleSaveStation = async () => {
    if (!stationForm.name.trim()) {
      toast.error('Station name is required');
      return;
    }
    setIsSavingStation(true);
    try {
      const payload: LocationCreate = {
        name: stationForm.name.trim(),
        ...(stationForm.address.trim() ? { address: stationForm.address.trim() } : {}),
        ...(stationForm.city.trim() ? { city: stationForm.city.trim() } : {}),
        ...(stationForm.state.trim() ? { state: stationForm.state.trim() } : {}),
        ...(stationForm.zip.trim() ? { zip: stationForm.zip.trim() } : {}),
        ...(stationForm.description.trim() ? { description: stationForm.description.trim() } : {}),
      };
      if (editingStation) {
        const oldName = editingStation.name;
        await locationsService.updateLocation(editingStation.id, payload);
        // If station name changed, update the building field on all child rooms
        // so they stay grouped under the renamed station.
        if (oldName !== payload.name) {
          const stationRooms = rooms.get(oldName) || [];
          for (const room of stationRooms) {
            await locationsService.updateLocation(room.id, { building: payload.name });
          }
        }
        toast.success('Station updated');
      } else {
        await locationsService.createLocation(payload);
        toast.success('Station added');
      }
      setShowStationModal(false);
      void loadLocations();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to save station');
    } finally {
      setIsSavingStation(false);
    }
  };

  const handleDeleteStation = async (station: Location) => {
    if (!window.confirm(`Delete "${station.name}" and all its rooms? This cannot be undone.`)) return;
    try {
      // Delete rooms first
      const stationRooms = rooms.get(station.name) || [];
      for (const room of stationRooms) {
        await locationsService.deleteLocation(room.id);
      }
      await locationsService.deleteLocation(station.id);
      toast.success('Station deleted');
      void loadLocations();
    } catch {
      toast.error('Failed to delete station. It may have events associated with it.');
    }
  };

  // ── Room CRUD ──
  const openAddRoom = (stationName: string) => {
    setEditingRoom(null);
    setRoomParentStation(stationName);
    setRoomForm({ name: '', room_number: '', floor: '', capacity: '', description: '' });
    setShowRoomModal(true);
  };

  const openEditRoom = (room: Location) => {
    setEditingRoom(room);
    setRoomParentStation(room.building || '');
    setRoomForm({
      name: room.name || '',
      room_number: room.room_number || '',
      floor: room.floor || '',
      capacity: room.capacity?.toString() || '',
      description: room.description || '',
    });
    setShowRoomModal(true);
  };

  const handleSaveRoom = async () => {
    if (!roomForm.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    setIsSavingRoom(true);
    try {
      const payload: LocationCreate = {
        name: roomForm.name.trim(),
        ...(roomParentStation ? { building: roomParentStation } : {}),
        ...(roomForm.room_number.trim() ? { room_number: roomForm.room_number.trim() } : {}),
        ...(roomForm.floor.trim() ? { floor: roomForm.floor.trim() } : {}),
        ...(roomForm.capacity ? { capacity: Number(roomForm.capacity) } : {}),
        ...(roomForm.description.trim() ? { description: roomForm.description.trim() } : {}),
      };
      if (editingRoom) {
        await locationsService.updateLocation(editingRoom.id, payload);
        toast.success('Room updated');
      } else {
        await locationsService.createLocation(payload);
        toast.success('Room added');
      }
      setShowRoomModal(false);
      void loadLocations();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to save room');
    } finally {
      setIsSavingRoom(false);
    }
  };

  const handleDeleteRoom = async (room: Location) => {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    try {
      await locationsService.deleteLocation(room.id);
      toast.success('Room deleted');
      void loadLocations();
    } catch {
      toast.error('Failed to delete room. It may have events associated with it.');
    }
  };

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-sm font-medium text-theme-text-secondary mb-1';

  const isSingleStation = stationMode === 'single_station';

  // For single-station mode, show a simplified header
  return (
    <div className="space-y-6">
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
        <div className="text-theme-text-muted flex items-center gap-2 text-xs">
          {isSingleStation ? (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-700 dark:text-blue-400">
              <Building className="h-3.5 w-3.5" /> Single-Station Department
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-700 dark:text-blue-400">
              <Building2 className="h-3.5 w-3.5" /> Multi-Station Agency
            </span>
          )}
          <button
            onClick={() => {
              void handleSetStationMode(isSingleStation ? 'multi_station' : 'single_station');
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Change
          </button>
          <button
            onClick={() => {
              wizardDismissedRef.current = false;
              setShowWizard(true);
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Run Setup Wizard
          </button>
        </div>
      )}

      {/* Station mode not set but locations exist — let user set mode or launch wizard */}
      {!stationModeLoading && stationMode === null && locations.length > 0 && (
        <div className="text-theme-text-muted flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-2.5 py-1 text-yellow-500">
            <HelpCircle className="h-3.5 w-3.5" /> Station mode not configured
          </span>
          <button
            onClick={() => {
              void handleSetStationMode('single_station');
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Set Single-Station
          </button>
          <button
            onClick={() => {
              void handleSetStationMode('multi_station');
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Set Multi-Station
          </button>
          <button
            onClick={() => {
              wizardDismissedRef.current = false;
              setShowWizard(true);
            }}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Run Setup Wizard
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">
            {isSingleStation ? 'Location & Rooms' : 'Locations & Rooms'}
          </h1>
          <p className="text-theme-text-secondary mt-1">
            {isSingleStation
              ? 'Manage your station address and rooms for events, forms, and QR check-in'
              : 'Manage station addresses and room names for events, forms, and QR check-in'}
          </p>
        </div>
        {(!isSingleStation || stations.length === 0) && (
          <button onClick={openCreateStation} className="btn-primary flex items-center gap-2 py-2.5">
            <Plus className="h-4 w-4" /> {isSingleStation ? 'Set Up Location' : 'Add Station'}
          </button>
        )}
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
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No locations yet</h3>
          <p className="text-theme-text-muted mb-4">
            Add your first station to get started. You can then add rooms within it.
          </p>
          <button onClick={openCreateStation} className="btn-primary inline-flex items-center gap-2 py-2.5">
            <Plus className="h-4 w-4" /> Add Station
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {stations.map((station) => {
            const stationRooms = rooms.get(station.name) || [];
            const isExpanded = expandedStations.has(station.name);
            const address = [station.address, station.city, station.state, station.zip].filter(Boolean).join(', ');

            return (
              <div
                key={station.id}
                className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border"
              >
                {/* Station Header */}
                <div className="flex items-center gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                    <Building2 className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-theme-text-primary text-lg font-semibold">{station.name}</h3>
                    {address && (
                      <p className="text-theme-text-secondary mt-0.5 flex items-center gap-1.5 text-sm">
                        <MapPin className="h-3.5 w-3.5 shrink-0" /> {address}
                      </p>
                    )}
                    {station.description && <p className="text-theme-text-muted mt-1 text-sm">{station.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditStation(station)}
                      title="Edit station"
                      aria-label="Edit station"
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => {
                        void handleDeleteStation(station);
                      }}
                      title="Delete station"
                      aria-label="Delete station"
                      className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => toggleStation(station.name)}
                      className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
                    >
                      <DoorOpen className="h-4 w-4" />
                      <span>
                        {stationRooms.length} room{stationRooms.length !== 1 ? 's' : ''}
                      </span>
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* Rooms Panel */}
                {isExpanded && (
                  <div className="border-theme-surface-border bg-theme-surface-hover/30 space-y-2 border-t p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-theme-text-primary text-sm font-semibold">Rooms</h4>
                      <button
                        onClick={() => openAddRoom(station.name)}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                      >
                        <Plus className="h-3 w-3" /> Add Room
                      </button>
                    </div>
                    {stationRooms.length === 0 ? (
                      <p className="text-theme-text-muted py-2 text-sm">
                        No rooms added yet. Add rooms for QR check-in and event scheduling.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {stationRooms.map((room) => (
                          <RoomCard
                            key={room.id}
                            room={room}
                            onEdit={openEditRoom}
                            onDelete={(r) => {
                              void handleDeleteRoom(r);
                            }}
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
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-5">
              <h3 className="text-theme-text-primary mb-3 text-lg font-semibold">Other Locations</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(rooms.get('__other__') || []).map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    onEdit={openEditRoom}
                    onDelete={(r) => {
                      void handleDeleteRoom(r);
                    }}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowStationModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">
                {editingStation ? 'Edit Station' : 'Add Station'}
              </h2>
              <button
                onClick={() => setShowStationModal(false)}
                aria-label="Close dialog"
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className={labelCls}>Station Name / Number *</label>
                <input
                  type="text"
                  value={stationForm.name}
                  onChange={(e) => setStationForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Station 1, Headquarters"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Street Address</label>
                <input
                  type="text"
                  value={stationForm.address}
                  onChange={(e) => setStationForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="123 Main Street"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>City</label>
                  <input
                    type="text"
                    value={stationForm.city}
                    onChange={(e) => setStationForm((p) => ({ ...p, city: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>State</label>
                  <input
                    type="text"
                    value={stationForm.state}
                    onChange={(e) => setStationForm((p) => ({ ...p, state: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Zip</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={stationForm.zip}
                    onChange={(e) => setStationForm((p) => ({ ...p, zip: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  value={stationForm.description}
                  onChange={(e) => setStationForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional notes about this station..."
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowStationModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSaveStation();
                }}
                disabled={isSavingStation || !stationForm.name.trim()}
                className="btn-primary flex items-center gap-2 px-5"
              >
                {isSavingStation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingStation ? 'Update' : 'Add Station'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Modal */}
      {showRoomModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowRoomModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">
                {editingRoom ? 'Edit Room' : `Add Room${roomParentStation ? ` to ${roomParentStation}` : ''}`}
              </h2>
              <button
                onClick={() => setShowRoomModal(false)}
                aria-label="Close dialog"
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className={labelCls}>Room Name *</label>
                <input
                  type="text"
                  value={roomForm.name}
                  onChange={(e) => setRoomForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Main Hall, Bunk Room A, Training Room"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Room Number</label>
                  <input
                    type="text"
                    value={roomForm.room_number}
                    onChange={(e) => setRoomForm((p) => ({ ...p, room_number: e.target.value }))}
                    placeholder="e.g., 101"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Floor</label>
                  <input
                    type="text"
                    value={roomForm.floor}
                    onChange={(e) => setRoomForm((p) => ({ ...p, floor: e.target.value }))}
                    placeholder="e.g., 1, 2, Basement"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Capacity</label>
                <input
                  type="number"
                  value={roomForm.capacity}
                  onChange={(e) => setRoomForm((p) => ({ ...p, capacity: e.target.value }))}
                  placeholder="Maximum occupancy"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  value={roomForm.description}
                  onChange={(e) => setRoomForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Equipment, amenities, or notes about this room..."
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowRoomModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSaveRoom();
                }}
                disabled={isSavingRoom || !roomForm.name.trim()}
                className="btn-primary flex items-center gap-2 px-5"
              >
                {isSavingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingRoom ? 'Update' : 'Add Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
