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
  MapPin, Plus, Search, Building2, DoorOpen, Pencil, Trash2,
  Loader2, X, Save, ChevronDown, ChevronUp, QrCode, Users,
  Building, HelpCircle, Monitor, Copy, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { locationsService, organizationService } from '../services/api';
import type { Location, LocationCreate } from '../services/api';

// Group locations: top-level = stations (has address, no room_number), children = rooms (have room_number or building)
function groupLocations(locations: Location[]): { stations: Location[]; rooms: Map<string, Location[]> } {
  const stations: Location[] = [];
  const rooms = new Map<string, Location[]>();
  const orphanRooms: Location[] = [];

  for (const loc of locations) {
    // A "station" is a location with an address and no room_number
    if (loc.address && !loc.room_number) {
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

const ROOM_TYPE_LABELS: Record<string, string> = {
  APPARATUS_BAY: 'Apparatus Bay',
  BUNK_ROOM: 'Bunk Room',
  KITCHEN: 'Kitchen',
  BATHROOM: 'Bathroom',
  OFFICE: 'Office',
  TRAINING_ROOM: 'Training Room',
  STORAGE: 'Storage',
  MECHANICAL: 'Mechanical',
  LOBBY: 'Lobby',
  COMMON_AREA: 'Common Area',
  LAUNDRY: 'Laundry',
  GYM: 'Gym',
  DISPATCH: 'Dispatch',
  OTHER: 'Other',
};

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
  saved?: boolean;        // true once the station is persisted
  savedId?: string;       // id from the backend
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
  existingMode,
  existingStations,
}: {
  onComplete: () => void;
  existingMode: StationMode;
  existingStations: Location[];
}) {
  const [step, setStep] = useState<WizardStep>(
    existingMode ? (existingStations.length > 0 ? 'rooms' : 'stations') : 'mode'
  );
  const [mode, setMode] = useState<'single_station' | 'multi_station' | null>(existingMode);
  const [stations, setStations] = useState<WizardStation[]>(
    existingStations.length > 0
      ? existingStations.map(s => ({
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

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500';
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
        setStations([{ name: '', address: '', city: '', state: '', zip: '' }]);
      }
      setStep('stations');
    } catch {
      toast.error('Failed to save setting');
    }
  };

  /* ── Step 2: station form helpers ── */
  const updateStation = (idx: number, field: keyof WizardStation, value: string) => {
    setStations(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addAnotherStation = () => {
    setStations(prev => [...prev, { name: '', address: '', city: '', state: '', zip: '' }]);
  };

  const removeStation = (idx: number) => {
    if (stations.length <= 1) return;
    setStations(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveStations = async () => {
    const unsaved = stations.filter(s => !s.saved);
    for (const s of unsaved) {
      if (!s.name.trim()) { toast.error('Every station needs a name'); return; }
    }
    setIsSaving(true);
    try {
      const newStations = [...stations];
      for (let i = 0; i < newStations.length; i++) {
        if (!newStations[i].saved) {
          const s = newStations[i];
          const created = await locationsService.createLocation({
            name: s.name.trim(),
            address: s.address.trim() || undefined,
            city: s.city.trim() || undefined,
            state: s.state.trim() || undefined,
            zip: s.zip.trim() || undefined,
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
    if (!roomForm.name.trim()) { toast.error('Room name is required'); return; }
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
      setActiveStationIdx(prev => prev + 1);
      setRoomForm({ name: '', room_number: '', floor: '', capacity: '' });
    }
  };

  const handlePrevStation = () => {
    if (activeStationIdx > 0) {
      setActiveStationIdx(prev => prev - 1);
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
            room_number: room.room_number.trim() || undefined,
            floor: room.floor.trim() || undefined,
            capacity: room.capacity ? Number(room.capacity) : undefined,
          });
        }
      }
      setStep('done');
    } catch {
      toast.error('Failed to save rooms');
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Common quick-add room types ── */
  const quickRoomTypes = [
    'Training Room', 'Meeting Room', 'Apparatus Bay', 'Bunk Room',
    'Kitchen', 'Office', 'Common Area', 'Gym',
  ];

  /* ── Render ── */
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-theme-surface-modal border border-theme-surface-border rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-theme-text-muted">Step {stepIndex} of {totalSteps}</span>
            <span className="text-xs text-theme-text-muted">
              {step === 'mode' && 'Department Type'}
              {step === 'stations' && 'Station Setup'}
              {step === 'rooms' && 'Room Setup'}
              {step === 'done' && 'Complete'}
            </span>
          </div>
          <div className="w-full bg-theme-surface-hover rounded-full h-1.5">
            <div
              className="bg-red-500 h-1.5 rounded-full transition-all duration-500"
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
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
                  <HelpCircle className="w-7 h-7 text-blue-400" />
                </div>
                <h2 className="text-xl font-bold text-theme-text-primary">How is your department organized?</h2>
                <p className="text-sm text-theme-text-secondary mt-2">
                  This helps us tailor the experience. You can always change this later.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => handleModeSelect('single_station')}
                  className="flex items-center gap-4 p-4 bg-theme-surface-hover border-2 border-theme-surface-border rounded-xl hover:border-red-500/50 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-xl bg-theme-surface flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/10 transition-colors">
                    <Building className="w-6 h-6 text-theme-text-muted group-hover:text-red-500 transition-colors" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-theme-text-primary block">Single Station</span>
                    <span className="text-xs text-theme-text-muted">
                      We operate from one location — no need to choose a station when scheduling events.
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => handleModeSelect('multi_station')}
                  className="flex items-center gap-4 p-4 bg-theme-surface-hover border-2 border-theme-surface-border rounded-xl hover:border-red-500/50 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-xl bg-theme-surface flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/10 transition-colors">
                    <Building2 className="w-6 h-6 text-theme-text-muted group-hover:text-red-500 transition-colors" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-theme-text-primary block">Multiple Stations</span>
                    <span className="text-xs text-theme-text-muted">
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
                <h2 className="text-xl font-bold text-theme-text-primary">
                  {mode === 'single_station' ? 'Tell us about your station' : 'Add your stations'}
                </h2>
                <p className="text-sm text-theme-text-secondary mt-1">
                  {mode === 'single_station'
                    ? 'Enter your station name and address. This will be used across the application.'
                    : 'Add each station with its name and address. You can add more stations later.'}
                </p>
              </div>

              <div className="space-y-4">
                {stations.map((station, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border ${
                      station.saved
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-theme-surface-border bg-theme-surface-hover/30'
                    }`}
                  >
                    {stations.length > 1 && (
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                          Station {idx + 1}
                          {station.saved && <span className="text-green-500 ml-2">Saved</span>}
                        </span>
                        {!station.saved && stations.length > 1 && (
                          <button onClick={() => removeStation(idx)} className="text-theme-text-muted hover:text-red-500 transition-colors">
                            <X className="w-4 h-4" />
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
                          onChange={e => updateStation(idx, 'name', e.target.value)}
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
                          onChange={e => updateStation(idx, 'address', e.target.value)}
                          placeholder="e.g., 123 Main Street"
                          className={inputCls}
                          disabled={station.saved}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className={labelCls}>City</label>
                          <input type="text" value={station.city} onChange={e => updateStation(idx, 'city', e.target.value)} className={inputCls} disabled={station.saved} />
                        </div>
                        <div>
                          <label className={labelCls}>State</label>
                          <input type="text" value={station.state} onChange={e => updateStation(idx, 'state', e.target.value)} className={inputCls} disabled={station.saved} />
                        </div>
                        <div>
                          <label className={labelCls}>Zip</label>
                          <input type="text" value={station.zip} onChange={e => updateStation(idx, 'zip', e.target.value)} className={inputCls} disabled={station.saved} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {mode === 'multi_station' && (
                  <button
                    onClick={addAnotherStation}
                    className="flex items-center gap-2 w-full p-3 text-sm text-theme-text-secondary border-2 border-dashed border-theme-surface-border rounded-xl hover:border-red-500/50 hover:text-red-500 transition-all justify-center"
                  >
                    <Plus className="w-4 h-4" /> Add Another Station
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Rooms ── */}
          {step === 'rooms' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-theme-text-primary">
                  Add rooms to {stations[activeStationIdx]?.name || 'your station'}
                </h2>
                <p className="text-sm text-theme-text-secondary mt-1">
                  Rooms are used for meeting scheduling, training sessions, and QR check-in.
                  {stations.length > 1 && (
                    <span className="font-medium text-theme-text-primary ml-1">
                      (Station {activeStationIdx + 1} of {stations.length})
                    </span>
                  )}
                </p>
              </div>

              {/* Quick-add buttons */}
              <div>
                <label className="block text-xs font-medium text-theme-text-muted mb-2">Quick add common rooms</label>
                <div className="flex flex-wrap gap-2">
                  {quickRoomTypes.map(type => {
                    const alreadyAdded = currentRooms.some(r => r.name === type);
                    return (
                      <button
                        key={type}
                        disabled={alreadyAdded}
                        onClick={() => {
                          const updated = new Map(roomsByStation);
                          const list = [...(updated.get(activeStationIdx) || []), { name: type, room_number: '', floor: '', capacity: '' }];
                          updated.set(activeStationIdx, list);
                          setRoomsByStation(updated);
                        }}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          alreadyAdded
                            ? 'border-green-500/30 bg-green-500/10 text-green-500 cursor-not-allowed'
                            : 'border-theme-surface-border bg-theme-surface-hover text-theme-text-secondary hover:border-red-500/50 hover:text-red-500'
                        }`}
                      >
                        {alreadyAdded ? '+ ' : '+ '}{type}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Added rooms list */}
              {currentRooms.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-theme-text-muted">
                    Rooms added ({currentRooms.length})
                  </label>
                  {currentRooms.map((room, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-theme-surface-hover/50 border border-theme-surface-border rounded-lg">
                      <div className="flex items-center gap-3">
                        <DoorOpen className="w-4 h-4 text-theme-text-muted" />
                        <div>
                          <span className="text-sm font-medium text-theme-text-primary">{room.name}</span>
                          {(room.room_number || room.floor || room.capacity) && (
                            <span className="text-xs text-theme-text-muted ml-2">
                              {[
                                room.room_number && `#${room.room_number}`,
                                room.floor && `Floor ${room.floor}`,
                                room.capacity && `Cap: ${room.capacity}`,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => removeRoom(idx)} className="p-1 text-theme-text-muted hover:text-red-500 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom room form */}
              <div className="p-4 bg-theme-surface-hover/30 border border-theme-surface-border rounded-xl space-y-3">
                <label className="block text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                  Add a custom room
                </label>
                <div>
                  <label className={labelCls}>Room Name *</label>
                  <input
                    type="text"
                    value={roomForm.name}
                    onChange={e => setRoomForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Chief's Office, Supply Closet"
                    className={inputCls}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRoom(); } }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Room #</label>
                    <input type="text" value={roomForm.room_number} onChange={e => setRoomForm(p => ({ ...p, room_number: e.target.value }))} placeholder="101" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Floor</label>
                    <input type="text" value={roomForm.floor} onChange={e => setRoomForm(p => ({ ...p, floor: e.target.value }))} placeholder="1" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Capacity</label>
                    <input type="number" value={roomForm.capacity} onChange={e => setRoomForm(p => ({ ...p, capacity: e.target.value }))} placeholder="25" className={inputCls} />
                  </div>
                </div>
                <button
                  onClick={addRoom}
                  disabled={!roomForm.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" /> Add Room
                </button>
              </div>

              {/* Multi-station nav */}
              {stations.length > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handlePrevStation}
                    disabled={activeStationIdx === 0}
                    className="text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Previous Station
                  </button>
                  <span className="text-xs text-theme-text-muted">
                    {stations[activeStationIdx]?.name}
                  </span>
                  {activeStationIdx < stations.length - 1 ? (
                    <button
                      onClick={handleNextStation}
                      className="text-sm text-red-500 hover:text-red-400 font-medium transition-colors"
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
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
                <Building2 className="w-8 h-8 text-green-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-theme-text-primary">You're all set!</h2>
                <p className="text-sm text-theme-text-secondary mt-2">
                  Your locations are configured and ready for use in meetings, training, events, and QR check-in.
                </p>
              </div>
              <div className="bg-theme-surface-hover/50 rounded-xl p-4 text-left space-y-3">
                {stations.map((station, idx) => {
                  const stationRooms = roomsByStation.get(idx) || [];
                  return (
                    <div key={idx}>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-red-500" />
                        <span className="text-sm font-semibold text-theme-text-primary">{station.name}</span>
                      </div>
                      {station.address && (
                        <p className="text-xs text-theme-text-muted ml-6">{[station.address, station.city, station.state, station.zip].filter(Boolean).join(', ')}</p>
                      )}
                      {stationRooms.length > 0 && (
                        <div className="ml-6 mt-1 flex flex-wrap gap-1.5">
                          {stationRooms.map((room, rIdx) => (
                            <span key={rIdx} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-theme-surface border border-theme-surface-border rounded-md text-theme-text-secondary">
                              <DoorOpen className="w-3 h-3" /> {room.name}
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
        <div className="flex items-center justify-between p-6 border-t border-theme-surface-border">
          {step === 'mode' && (
            <>
              <span />
              <span className="text-xs text-theme-text-muted">Select an option above</span>
            </>
          )}

          {step === 'stations' && (
            <>
              <button
                onClick={() => setStep('mode')}
                className="text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleSaveStations}
                disabled={isSaving || stations.every(s => !s.name.trim())}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue to Rooms →
              </button>
            </>
          )}

          {step === 'rooms' && (
            <>
              <button
                onClick={() => setStep('stations')}
                className="text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setStep('done'); onComplete(); }}
                  className="text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleFinishRooms}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {[...roomsByStation.values()].some(r => r.length > 0) ? 'Save Rooms & Finish' : 'Finish Without Rooms'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <span />
              <button
                onClick={onComplete}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
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
function RoomCard({ room, onEdit, onDelete }: { room: Location; onEdit: (r: Location) => void; onDelete: (r: Location) => void }) {
  const [copied, setCopied] = useState(false);

  const kioskUrl = room.display_code ? `${window.location.origin}/display/${room.display_code}` : null;

  const handleCopyKioskUrl = async () => {
    if (!kioskUrl) return;
    try {
      await navigator.clipboard.writeText(kioskUrl);
      setCopied(true);
      toast.success('Kiosk URL copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="flex flex-col p-3 bg-theme-surface border border-theme-surface-border rounded-lg group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <DoorOpen className="w-4 h-4 text-theme-text-muted flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-text-primary truncate">
              {room.name}{room.room_number ? ` #${room.room_number}` : ''}
            </p>
            <p className="text-xs text-theme-text-muted">
              {[room.floor ? `Floor ${room.floor}` : null, room.capacity ? `Cap: ${room.capacity}` : null].filter(Boolean).join(' · ') || 'No details'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(room)} className="p-1 text-theme-text-muted hover:text-theme-text-primary rounded transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(room)} className="p-1 text-theme-text-muted hover:text-red-500 rounded transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {kioskUrl && (
        <button
          onClick={handleCopyKioskUrl}
          className="mt-2 flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-blue-500 transition-colors"
          title="Copy kiosk display URL for this room"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Monitor className="w-3 h-3" />}
          <span className="font-mono truncate">/display/{room.display_code}</span>
          {!copied && <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
        </button>
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
  const [stationForm, setStationForm] = useState({ name: '', address: '', city: '', state: '', zip: '', description: '' });
  const [isSavingStation, setIsSavingStation] = useState(false);

  // Room modal state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Location | null>(null);
  const [roomParentStation, setRoomParentStation] = useState<string>('');
  const [roomForm, setRoomForm] = useState({ name: '', room_number: '', floor: '', capacity: '', description: '' });
  const [isSavingRoom, setIsSavingRoom] = useState(false);

  // Setup wizard state
  const [showWizard, setShowWizard] = useState(false);

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
    loadStationMode();
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

  useEffect(() => { loadLocations(); }, [loadLocations]);

  // Auto-show wizard when setup is incomplete (no stations, no mode, or no rooms yet)
  useEffect(() => {
    if (stationModeLoading || isLoading) return;
    const { stations: existingStations, rooms: existingRooms } = groupLocations(locations);
    const hasRooms = existingRooms.size > 0 && !([...existingRooms.keys()].length === 1 && existingRooms.has('__other__'));
    // Show wizard if: no station mode, or no stations, or stations but no rooms
    if (stationMode === null || existingStations.length === 0 || !hasRooms) {
      setShowWizard(true);
    }
  }, [stationModeLoading, isLoading, locations, stationMode]);

  const { stations, rooms } = groupLocations(
    locations.filter(l =>
      l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.building?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.room_number?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const toggleStation = (stationName: string) => {
    setExpandedStations(prev => {
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
    if (!stationForm.name.trim()) { toast.error('Station name is required'); return; }
    setIsSavingStation(true);
    try {
      const payload: LocationCreate = {
        name: stationForm.name.trim(),
        address: stationForm.address.trim() || undefined,
        city: stationForm.city.trim() || undefined,
        state: stationForm.state.trim() || undefined,
        zip: stationForm.zip.trim() || undefined,
        description: stationForm.description.trim() || undefined,
      };
      if (editingStation) {
        await locationsService.updateLocation(editingStation.id, payload);
        toast.success('Station updated');
      } else {
        await locationsService.createLocation(payload);
        toast.success('Station added');
      }
      setShowStationModal(false);
      loadLocations();
    } catch {
      toast.error('Failed to save station');
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
      loadLocations();
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
    if (!roomForm.name.trim()) { toast.error('Room name is required'); return; }
    setIsSavingRoom(true);
    try {
      const payload: LocationCreate = {
        name: roomForm.name.trim(),
        building: roomParentStation || undefined,
        room_number: roomForm.room_number.trim() || undefined,
        floor: roomForm.floor.trim() || undefined,
        capacity: roomForm.capacity ? Number(roomForm.capacity) : undefined,
        description: roomForm.description.trim() || undefined,
      };
      if (editingRoom) {
        await locationsService.updateLocation(editingRoom.id, payload);
        toast.success('Room updated');
      } else {
        await locationsService.createLocation(payload);
        toast.success('Room added');
      }
      setShowRoomModal(false);
      loadLocations();
    } catch {
      toast.error('Failed to save room');
    } finally {
      setIsSavingRoom(false);
    }
  };

  const handleDeleteRoom = async (room: Location) => {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    try {
      await locationsService.deleteLocation(room.id);
      toast.success('Room deleted');
      loadLocations();
    } catch {
      toast.error('Failed to delete room. It may have events associated with it.');
    }
  };

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500';
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
          onComplete={() => {
            setShowWizard(false);
            loadLocations();
            // Reload station mode from settings in case it changed
            organizationService.getSettings().then(settings => {
              const mode = (settings as Record<string, unknown>).station_mode as StationMode;
              setStationMode(mode || null);
            }).catch(() => {});
          }}
        />
      )}

      {/* Station Mode Badge (shown when configured, allows changing) */}
      {!stationModeLoading && stationMode !== null && (
        <div className="flex items-center gap-2 text-xs text-theme-text-muted">
          {isSingleStation ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-full">
              <Building className="w-3.5 h-3.5" /> Single-Station Department
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-full">
              <Building2 className="w-3.5 h-3.5" /> Multi-Station Agency
            </span>
          )}
          <button
            onClick={() => handleSetStationMode(isSingleStation ? 'multi_station' : 'single_station')}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Change
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="text-theme-text-muted hover:text-theme-text-secondary underline"
          >
            Run Setup Wizard
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">
            {isSingleStation ? 'Location & Rooms' : 'Locations & Rooms'}
          </h1>
          <p className="text-theme-text-secondary mt-1">
            {isSingleStation
              ? 'Manage your station address and rooms for events, forms, and QR check-in'
              : 'Manage station addresses and room names for events, forms, and QR check-in'}
          </p>
        </div>
        {(!isSingleStation || stations.length === 0) && (
          <button onClick={openCreateStation}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> {isSingleStation ? 'Set Up Location' : 'Add Station'}
          </button>
        )}
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
        <QrCode className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-theme-text-secondary">
          {isSingleStation ? (
            <p>Set up your station address and rooms. These are used for event scheduling, meeting rooms, training sessions, and QR code check-in. Since you operate from a single location, members will be automatically associated with this station.</p>
          ) : (
            <p>Locations added here are available for event scheduling, meeting room selection, training sessions, and QR code check-in. Add your stations with their addresses and list each room for use across the platform.</p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search stations or rooms..."
          className="w-full pl-10 pr-4 py-2.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Station List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : stations.length === 0 && !rooms.has('__other__') ? (
        <div className="text-center py-20">
          <Building2 className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">No locations yet</h3>
          <p className="text-theme-text-muted mb-4">
            Add your first station to get started. You can then add rooms within it.
          </p>
          <button onClick={openCreateStation}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Station
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {stations.map(station => {
            const stationRooms = rooms.get(station.name) || [];
            const isExpanded = expandedStations.has(station.name);
            const address = [station.address, station.city, station.state, station.zip].filter(Boolean).join(', ');

            return (
              <div key={station.id} className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
                {/* Station Header */}
                <div className="flex items-center gap-4 p-5">
                  <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-theme-text-primary">{station.name}</h3>
                    {address && (
                      <p className="flex items-center gap-1.5 text-sm text-theme-text-secondary mt-0.5">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" /> {address}
                      </p>
                    )}
                    {station.description && (
                      <p className="text-sm text-theme-text-muted mt-1">{station.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditStation(station)} title="Edit station"
                      className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteStation(station)} title="Delete station"
                      className="p-2 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleStation(station.name)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                    >
                      <DoorOpen className="w-4 h-4" />
                      <span>{stationRooms.length} room{stationRooms.length !== 1 ? 's' : ''}</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Rooms Panel */}
                {isExpanded && (
                  <div className="border-t border-theme-surface-border bg-theme-surface-hover/30 p-4 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-theme-text-primary">Rooms</h4>
                      <button onClick={() => openAddRoom(station.name)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add Room
                      </button>
                    </div>
                    {stationRooms.length === 0 ? (
                      <p className="text-sm text-theme-text-muted py-2">No rooms added yet. Add rooms for QR check-in and event scheduling.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {stationRooms.map(room => (
                          <RoomCard key={room.id} room={room} onEdit={openEditRoom} onDelete={handleDeleteRoom} />
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
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
              <h3 className="text-lg font-semibold text-theme-text-primary mb-3">Other Locations</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(rooms.get('__other__') || []).map(room => (
                  <RoomCard key={room.id} room={room} onEdit={openEditRoom} onDelete={handleDeleteRoom} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Station Modal */}
      {showStationModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowStationModal(false); }}
        >
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">
                {editingStation ? 'Edit Station' : 'Add Station'}
              </h2>
              <button onClick={() => setShowStationModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Station Name / Number *</label>
                <input type="text" value={stationForm.name} onChange={e => setStationForm(p => ({...p, name: e.target.value}))}
                  placeholder="e.g., Station 1, Headquarters" className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Street Address</label>
                <input type="text" value={stationForm.address} onChange={e => setStationForm(p => ({...p, address: e.target.value}))}
                  placeholder="123 Main Street" className={inputCls}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>City</label>
                  <input type="text" value={stationForm.city} onChange={e => setStationForm(p => ({...p, city: e.target.value}))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>State</label>
                  <input type="text" value={stationForm.state} onChange={e => setStationForm(p => ({...p, state: e.target.value}))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Zip</label>
                  <input type="text" value={stationForm.zip} onChange={e => setStationForm(p => ({...p, zip: e.target.value}))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea value={stationForm.description} onChange={e => setStationForm(p => ({...p, description: e.target.value}))}
                  rows={2} placeholder="Optional notes about this station..." className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowStationModal(false)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors">Cancel</button>
              <button onClick={handleSaveStation} disabled={isSavingStation || !stationForm.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSavingStation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingStation ? 'Update' : 'Add Station'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Modal */}
      {showRoomModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowRoomModal(false); }}
        >
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">
                {editingRoom ? 'Edit Room' : `Add Room${roomParentStation ? ` to ${roomParentStation}` : ''}`}
              </h2>
              <button onClick={() => setShowRoomModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Room Name *</label>
                <input type="text" value={roomForm.name} onChange={e => setRoomForm(p => ({...p, name: e.target.value}))}
                  placeholder="e.g., Main Hall, Bunk Room A, Training Room" className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Room Number</label>
                  <input type="text" value={roomForm.room_number} onChange={e => setRoomForm(p => ({...p, room_number: e.target.value}))}
                    placeholder="e.g., 101" className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Floor</label>
                  <input type="text" value={roomForm.floor} onChange={e => setRoomForm(p => ({...p, floor: e.target.value}))}
                    placeholder="e.g., 1, 2, Basement" className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Capacity</label>
                <input type="number" value={roomForm.capacity} onChange={e => setRoomForm(p => ({...p, capacity: e.target.value}))}
                  placeholder="Maximum occupancy" className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea value={roomForm.description} onChange={e => setRoomForm(p => ({...p, description: e.target.value}))}
                  rows={2} placeholder="Equipment, amenities, or notes about this room..." className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowRoomModal(false)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors">Cancel</button>
              <button onClick={handleSaveRoom} disabled={isSavingRoom || !roomForm.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSavingRoom ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingRoom ? 'Update' : 'Add Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
