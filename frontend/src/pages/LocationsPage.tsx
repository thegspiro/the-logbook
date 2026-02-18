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
  Building, HelpCircle,
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
      {/* Station Mode Setup Question (shown when not yet configured) */}
      {!stationModeLoading && stationMode === null && (
        <div className="bg-theme-surface border-2 border-blue-500/30 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-theme-text-primary mb-2">How is your department organized?</h2>
              <p className="text-sm text-theme-text-secondary mb-4">
                This helps us simplify the experience. Single-station departments won't be asked to choose a station when adding members or scheduling events.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => handleSetStationMode('single_station')}
                  className="flex flex-col items-center p-5 bg-theme-surface-hover border-2 border-theme-surface-border rounded-xl hover:border-red-500/50 transition-all group"
                >
                  <Building className="w-8 h-8 text-theme-text-muted group-hover:text-red-500 mb-3 transition-colors" />
                  <span className="text-sm font-semibold text-theme-text-primary mb-1">Single Station</span>
                  <span className="text-xs text-theme-text-muted text-center">
                    We operate from one location. No need to select a station for each member.
                  </span>
                </button>
                <button
                  onClick={() => handleSetStationMode('multi_station')}
                  className="flex flex-col items-center p-5 bg-theme-surface-hover border-2 border-theme-surface-border rounded-xl hover:border-red-500/50 transition-all group"
                >
                  <Building2 className="w-8 h-8 text-theme-text-muted group-hover:text-red-500 mb-3 transition-colors" />
                  <span className="text-sm font-semibold text-theme-text-primary mb-1">Multiple Stations</span>
                  <span className="text-xs text-theme-text-muted text-center">
                    We have multiple stations or locations. Members are assigned to specific stations.
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
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
                          <div key={room.id} className="flex items-center justify-between p-3 bg-theme-surface border border-theme-surface-border rounded-lg group">
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
                              <button onClick={() => openEditRoom(room)} className="p-1 text-theme-text-muted hover:text-theme-text-primary rounded transition-colors">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteRoom(room)} className="p-1 text-theme-text-muted hover:text-red-500 rounded transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
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
                  <div key={room.id} className="flex items-center justify-between p-3 bg-theme-surface-hover/50 border border-theme-surface-border rounded-lg group">
                    <div className="flex items-center gap-3 min-w-0">
                      <MapPin className="w-4 h-4 text-theme-text-muted flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-theme-text-primary truncate">{room.name}</p>
                        <p className="text-xs text-theme-text-muted">
                          {[room.room_number ? `#${room.room_number}` : null, room.capacity ? `Cap: ${room.capacity}` : null].filter(Boolean).join(' · ') || 'Standalone location'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditRoom(room)} className="p-1 text-theme-text-muted hover:text-theme-text-primary rounded transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteRoom(room)} className="p-1 text-theme-text-muted hover:text-red-500 rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
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
