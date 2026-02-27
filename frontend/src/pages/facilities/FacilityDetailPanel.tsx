/**
 * Facility Detail Panel - Shows full facility details with edit, rooms, and actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, X, Archive, RotateCcw, MapPin, DoorOpen, Wrench,
  ClipboardCheck, ChevronDown, ChevronUp, Plus, Pencil, Save, Trash2,
  Loader2, Phone, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../services/api';
import type { Facility, FacilityType, FacilityStatus, Room, ROOM_TYPES } from './types';

const ROOM_TYPE_OPTIONS: Array<typeof ROOM_TYPES[number]> = [
  'APPARATUS_BAY', 'BUNK_ROOM', 'KITCHEN', 'BATHROOM', 'OFFICE',
  'TRAINING_ROOM', 'STORAGE', 'MECHANICAL', 'LOBBY', 'COMMON_AREA',
  'LAUNDRY', 'GYM', 'DECONTAMINATION', 'DISPATCH', 'OTHER',
];

interface Props {
  facility: Facility;
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  onClose: () => void;
  onArchive: (f: Facility) => void;
  onRestore: (f: Facility) => void;
  onUpdated: () => void;
  onViewMaintenance: (facilityId: string) => void;
  onViewInspections: (facilityId: string) => void;
}

export default function FacilityDetailPanel({
  facility, facilityTypes, facilityStatuses, onClose,
  onArchive, onRestore, onUpdated, onViewMaintenance, onViewInspections,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [showRooms, setShowRooms] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: '', room_number: '', floor: '', room_type: 'OTHER', capacity: '', square_footage: '', description: '' });

  const startEditing = () => {
    setEditData({
      name: facility.name || '',
      facility_number: facility.facility_number || '',
      address_line1: facility.address_line1 || '',
      address_line2: facility.address_line2 || '',
      city: facility.city || '',
      state: facility.state || '',
      zip_code: facility.zip_code || '',
      facility_type_id: facility.facility_type_id || '',
      status_id: facility.status_id || '',
      phone: facility.phone || '',
      email: facility.email || '',
      year_built: facility.year_built || '',
      square_footage: facility.square_footage || '',
      num_floors: facility.num_floors || '',
      num_bays: facility.num_bays || '',
      max_occupancy: facility.max_occupancy || '',
      sleeping_quarters: facility.sleeping_quarters || '',
      notes: facility.notes || '',
      description: facility.description || '',
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(editData)) {
        if (value !== '' && value !== undefined) {
          if (['year_built', 'square_footage', 'num_floors', 'num_bays', 'max_occupancy', 'sleeping_quarters'].includes(key)) {
            payload[key] = Number(value) || undefined;
          } else {
            payload[key] = value;
          }
        } else if (value === '') {
          payload[key] = null;
        }
      }
      await facilitiesService.updateFacility(facility.id, payload);
      toast.success('Facility updated');
      setIsEditing(false);
      onUpdated();
    } catch {
      toast.error('Failed to update facility');
    } finally {
      setIsSaving(false);
    }
  };

  const loadRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      const data = await facilitiesService.getRooms({ facility_id: facility.id });
      setRooms(data as unknown as Room[]);
    } catch {
      toast.error('Failed to load rooms');
    } finally {
      setIsLoadingRooms(false);
    }
  }, [facility.id]);

  useEffect(() => {
    if (showRooms) void loadRooms();
  }, [showRooms, loadRooms]);

  const handleAddRoom = async () => {
    if (!newRoom.name.trim()) { toast.error('Room name is required'); return; }
    try {
      await facilitiesService.createRoom({
        facility_id: facility.id,
        name: newRoom.name.trim(),
        room_number: newRoom.room_number.trim() || undefined,
        floor: newRoom.floor ? Number(newRoom.floor) : undefined,
        room_type: newRoom.room_type,
        capacity: newRoom.capacity ? Number(newRoom.capacity) : undefined,
        square_footage: newRoom.square_footage ? Number(newRoom.square_footage) : undefined,
        description: newRoom.description.trim() || undefined,
      });
      toast.success('Room added');
      setNewRoom({ name: '', room_number: '', floor: '', room_type: 'OTHER', capacity: '', square_footage: '', description: '' });
      setShowAddRoom(false);
      void loadRooms();
    } catch {
      toast.error('Failed to add room');
    }
  };

  const handleDeleteRoom = async (room: Room) => {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    try {
      await facilitiesService.deleteRoom(room.id);
      toast.success('Room deleted');
      void loadRooms();
    } catch {
      toast.error('Failed to delete room');
    }
  };

  const address = [facility.address_line1, facility.city, facility.state, facility.zip_code].filter(Boolean).join(', ');

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-theme-text-primary">{facility.name}</h2>
            {facility.facility_number && (
              <p className="text-sm text-theme-text-muted">{facility.facility_number}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button onClick={startEditing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {facility.is_archived ? (
            <button onClick={() => onRestore(facility)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore
            </button>
          ) : (
            <button onClick={() => onArchive(facility)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
            >
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
          )}
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Status & Type badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {facility.facility_type && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-theme-surface-hover text-theme-text-muted">
            {facility.facility_type.name}
          </span>
        )}
        {facility.status && (
          <span className="text-xs px-2.5 py-1 rounded-full text-theme-text-primary"
            style={{ backgroundColor: facility.status.color ? `${facility.status.color}20` : undefined, color: facility.status.color || undefined }}
          >
            {facility.status.name}
          </span>
        )}
        {facility.is_archived && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Archived
          </span>
        )}
      </div>

      {/* View Mode */}
      {!isEditing ? (
        <div className="space-y-4">
          {address && (
            <div className="flex items-start gap-2 text-sm text-theme-text-secondary">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{address}{facility.address_line2 ? `, ${facility.address_line2}` : ''}</span>
            </div>
          )}
          {(facility.phone || facility.email) && (
            <div className="flex items-center gap-4 text-sm text-theme-text-secondary">
              {facility.phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{facility.phone}</span>}
              {facility.email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{facility.email}</span>}
            </div>
          )}
          {/* Building Info */}
          {(facility.year_built || facility.square_footage || facility.num_floors || facility.num_bays) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
              {facility.year_built && <div><p className="text-xs text-theme-text-muted">Year Built</p><p className="text-sm font-medium text-theme-text-primary">{facility.year_built}</p></div>}
              {facility.square_footage && <div><p className="text-xs text-theme-text-muted">Sq. Footage</p><p className="text-sm font-medium text-theme-text-primary">{facility.square_footage.toLocaleString()}</p></div>}
              {facility.num_floors && <div><p className="text-xs text-theme-text-muted">Floors</p><p className="text-sm font-medium text-theme-text-primary">{facility.num_floors}</p></div>}
              {facility.num_bays && <div><p className="text-xs text-theme-text-muted">Bays</p><p className="text-sm font-medium text-theme-text-primary">{facility.num_bays}</p></div>}
              {facility.max_occupancy && <div><p className="text-xs text-theme-text-muted">Max Occupancy</p><p className="text-sm font-medium text-theme-text-primary">{facility.max_occupancy}</p></div>}
              {facility.sleeping_quarters && <div><p className="text-xs text-theme-text-muted">Sleeping Qtrs</p><p className="text-sm font-medium text-theme-text-primary">{facility.sleeping_quarters}</p></div>}
            </div>
          )}
          {facility.description && <p className="text-sm text-theme-text-secondary">{facility.description}</p>}
          {facility.notes && <p className="text-sm text-theme-text-muted italic">{facility.notes}</p>}
        </div>
      ) : (
        /* Edit Mode */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Name *</label><input type="text" value={editData.name as string} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Facility Number</label><input type="text" value={editData.facility_number as string} onChange={e => setEditData(p => ({...p, facility_number: e.target.value}))} className={inputCls} placeholder="e.g., Station 1" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Type</label>
              <select value={editData.facility_type_id as string} onChange={e => setEditData(p => ({...p, facility_type_id: e.target.value}))} className={inputCls}>
                <option value="">Select type...</option>
                {facilityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={editData.status_id as string} onChange={e => setEditData(p => ({...p, status_id: e.target.value}))} className={inputCls}>
                <option value="">Select status...</option>
                {facilityStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div><label className={labelCls}>Address Line 1</label><input type="text" value={editData.address_line1 as string} onChange={e => setEditData(p => ({...p, address_line1: e.target.value}))} className={inputCls} /></div>
          <div><label className={labelCls}>Address Line 2</label><input type="text" value={editData.address_line2 as string} onChange={e => setEditData(p => ({...p, address_line2: e.target.value}))} className={inputCls} /></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className={labelCls}>City</label><input type="text" value={editData.city as string} onChange={e => setEditData(p => ({...p, city: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>State</label><input type="text" value={editData.state as string} onChange={e => setEditData(p => ({...p, state: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Zip Code</label><input type="text" value={editData.zip_code as string} onChange={e => setEditData(p => ({...p, zip_code: e.target.value}))} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Phone</label><input type="text" value={editData.phone as string} onChange={e => setEditData(p => ({...p, phone: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Email</label><input type="text" value={editData.email as string} onChange={e => setEditData(p => ({...p, email: e.target.value}))} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Year Built</label><input type="number" value={editData.year_built as string} onChange={e => setEditData(p => ({...p, year_built: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Sq. Footage</label><input type="number" value={editData.square_footage as string} onChange={e => setEditData(p => ({...p, square_footage: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Floors</label><input type="number" value={editData.num_floors as string} onChange={e => setEditData(p => ({...p, num_floors: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Apparatus Bays</label><input type="number" value={editData.num_bays as string} onChange={e => setEditData(p => ({...p, num_bays: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Max Occupancy</label><input type="number" value={editData.max_occupancy as string} onChange={e => setEditData(p => ({...p, max_occupancy: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Sleeping Qtrs</label><input type="number" value={editData.sleeping_quarters as string} onChange={e => setEditData(p => ({...p, sleeping_quarters: e.target.value}))} className={inputCls} /></div>
          </div>
          <div><label className={labelCls}>Description</label><textarea value={editData.description as string} onChange={e => setEditData(p => ({...p, description: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
          <div><label className={labelCls}>Notes</label><textarea value={editData.notes as string} onChange={e => setEditData(p => ({...p, notes: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => { void handleSave(); }} disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
            </button>
            <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-3 pt-4 border-t border-theme-surface-border">
        <button onClick={() => onViewMaintenance(facility.id)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
        >
          <Wrench className="w-4 h-4" /> Maintenance
        </button>
        <button onClick={() => onViewInspections(facility.id)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
        >
          <ClipboardCheck className="w-4 h-4" /> Inspections
        </button>
        <button onClick={() => setShowRooms(!showRooms)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
        >
          <DoorOpen className="w-4 h-4" /> Rooms
          {showRooms ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Rooms Panel */}
      {showRooms && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-theme-text-primary">Rooms ({rooms.length})</h3>
            <button onClick={() => setShowAddRoom(!showAddRoom)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Room
            </button>
          </div>
          {showAddRoom && (
            <div className="p-3 bg-theme-surface-hover/50 rounded-lg space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <input type="text" value={newRoom.name} onChange={e => setNewRoom(p => ({...p, name: e.target.value}))} placeholder="Room name *" className={inputCls} />
                <input type="text" value={newRoom.room_number} onChange={e => setNewRoom(p => ({...p, room_number: e.target.value}))} placeholder="Room #" className={inputCls} />
                <select value={newRoom.room_type} onChange={e => setNewRoom(p => ({...p, room_type: e.target.value}))} className={inputCls}>
                  {ROOM_TYPE_OPTIONS.map(rt => <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>)}
                </select>
                <input type="number" value={newRoom.floor} onChange={e => setNewRoom(p => ({...p, floor: e.target.value}))} placeholder="Floor" className={inputCls} />
                <input type="number" value={newRoom.capacity} onChange={e => setNewRoom(p => ({...p, capacity: e.target.value}))} placeholder="Capacity" className={inputCls} />
                <input type="number" value={newRoom.square_footage} onChange={e => setNewRoom(p => ({...p, square_footage: e.target.value}))} placeholder="Sq ft" className={inputCls} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { void handleAddRoom(); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs transition-colors">Add</button>
                <button onClick={() => setShowAddRoom(false)} className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors">Cancel</button>
              </div>
            </div>
          )}
          {isLoadingRooms ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
          ) : rooms.length === 0 ? (
            <p className="text-sm text-theme-text-muted py-2">No rooms added yet.</p>
          ) : (
            <div className="space-y-1">
              {rooms.map(room => (
                <div key={room.id} className="flex items-center justify-between p-2.5 bg-theme-surface-hover/30 rounded-lg group">
                  <div className="flex items-center gap-3">
                    <DoorOpen className="w-4 h-4 text-theme-text-muted" />
                    <div>
                      <p className="text-sm font-medium text-theme-text-primary">
                        {room.name}{room.room_number ? ` (#${room.room_number})` : ''}
                      </p>
                      <p className="text-xs text-theme-text-muted">
                        {room.room_type?.replace(/_/g, ' ')}{room.floor != null ? ` · Floor ${room.floor}` : ''}{room.capacity ? ` · Cap: ${room.capacity}` : ''}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => { void handleDeleteRoom(room); }} className="opacity-0 group-hover:opacity-100 text-theme-text-muted hover:text-red-500 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
