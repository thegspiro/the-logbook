/**
 * Facility Detail Panel — Shows full facility details with edit capabilities,
 * rooms, building systems, and emergency contacts in a tabbed layout.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, X, Archive, RotateCcw, MapPin, DoorOpen, Wrench,
  ClipboardCheck, Plus, Pencil, Save, Trash2,
  Loader2, Phone, Mail, Settings, Users, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatNumber } from '../../utils/dateFormatting';
import { facilitiesService } from '../../services/api';
import type { FacilityCreate, EmergencyContact } from '../../services/facilitiesServices';
import type { Facility, FacilityType, FacilityStatus, Room, FacilitySystem, ROOM_TYPES } from './types';
import { enumLabel, ZONE_CLASSIFICATION_COLORS } from './types';

const ROOM_TYPE_OPTIONS: Array<typeof ROOM_TYPES[number]> = [
  'apparatus_bay', 'bunk_room', 'kitchen', 'bathroom', 'office',
  'training_room', 'storage', 'mechanical', 'lobby', 'common_area',
  'laundry', 'gym', 'decontamination', 'dispatch', 'other',
];

type DetailTab = 'rooms' | 'systems' | 'contacts';

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

  // Sub-entity state
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [systems, setSystems] = useState<FacilitySystem[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoadingSub, setIsLoadingSub] = useState(false);

  // Add room form
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: '', room_number: '', floor: '', room_type: 'other', capacity: '', square_footage: '', description: '' });

  const startEditing = () => {
    setEditData({
      name: facility.name || '',
      facility_number: facility.facilityNumber || '',
      address_line1: facility.addressLine1 || '',
      address_line2: facility.addressLine2 || '',
      city: facility.city || '',
      state: facility.state || '',
      zip_code: facility.zipCode || '',
      facility_type_id: facility.facilityTypeId || '',
      status_id: facility.statusId || '',
      phone: facility.phone || '',
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
      for (const [key, value] of Object.entries(editData)) {
        if (value !== '' && value !== undefined) {
          if (['year_built', 'square_footage', 'num_floors', 'num_bays', 'max_occupancy', 'sleeping_quarters'].includes(key)) {
            const num = Number(value);
            payload[key] = Number.isNaN(num) ? undefined : num;
          } else {
            payload[key] = value;
          }
        } else if (value === '') {
          payload[key] = null;
        }
      }
      await facilitiesService.updateFacility(facility.id, payload as Partial<FacilityCreate>);
      toast.success('Facility updated');
      setIsEditing(false);
      onUpdated();
    } catch {
      toast.error('Failed to update facility');
    } finally {
      setIsSaving(false);
    }
  };

  // Load sub-entities when tab changes
  const loadSubEntities = useCallback(async (tab: DetailTab) => {
    setIsLoadingSub(true);
    try {
      if (tab === 'rooms') {
        const data = await facilitiesService.getRooms({ facility_id: facility.id });
        setRooms(data);
      } else if (tab === 'systems') {
        const data = await facilitiesService.getSystems({ facility_id: facility.id });
        setSystems(data);
      } else if (tab === 'contacts') {
        const data = await facilitiesService.getEmergencyContacts({ facility_id: facility.id });
        setContacts(data);
      }
    } catch {
      toast.error(`Failed to load ${tab}`);
    } finally {
      setIsLoadingSub(false);
    }
  }, [facility.id]);

  useEffect(() => {
    if (activeDetailTab) void loadSubEntities(activeDetailTab);
  }, [activeDetailTab, loadSubEntities]);

  const handleTabToggle = (tab: DetailTab) => {
    setActiveDetailTab(prev => prev === tab ? null : tab);
  };

  const handleAddRoom = async () => {
    if (!newRoom.name.trim()) { toast.error('Room name is required'); return; }
    try {
      await facilitiesService.createRoom({
        facility_id: facility.id,
        name: newRoom.name.trim(),
        room_type: newRoom.room_type,
        ...(newRoom.room_number.trim() ? { room_number: newRoom.room_number.trim() } : {}),
        ...(newRoom.floor ? { floor: Number(newRoom.floor) } : {}),
        ...(newRoom.capacity ? { capacity: Number(newRoom.capacity) } : {}),
        ...(newRoom.square_footage ? { square_footage: Number(newRoom.square_footage) } : {}),
        ...(newRoom.description.trim() ? { description: newRoom.description.trim() } : {}),
      });
      toast.success('Room added');
      setNewRoom({ name: '', room_number: '', floor: '', room_type: 'other', capacity: '', square_footage: '', description: '' });
      setShowAddRoom(false);
      void loadSubEntities('rooms');
    } catch {
      toast.error('Failed to add room');
    }
  };

  const handleDeleteRoom = async (room: Room) => {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    try {
      await facilitiesService.deleteRoom(room.id);
      toast.success('Room deleted');
      void loadSubEntities('rooms');
    } catch {
      toast.error('Failed to delete room');
    }
  };

  const handleDeleteSystem = async (sys: FacilitySystem) => {
    if (!window.confirm(`Delete system "${sys.name}"?`)) return;
    try {
      await facilitiesService.deleteSystem(sys.id);
      toast.success('System deleted');
      void loadSubEntities('systems');
    } catch {
      toast.error('Failed to delete system');
    }
  };

  const handleDeleteContact = async (contact: EmergencyContact) => {
    if (!window.confirm(`Delete contact "${contact.companyName || contact.contactName}"?`)) return;
    try {
      await facilitiesService.deleteEmergencyContact(contact.id);
      toast.success('Contact deleted');
      void loadSubEntities('contacts');
    } catch {
      toast.error('Failed to delete contact');
    }
  };

  const address = [facility.addressLine1, facility.city, facility.state, facility.zipCode].filter(Boolean).join(', ');

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  const CONDITION_COLORS: Record<string, string> = {
    excellent: 'text-emerald-600 dark:text-emerald-400',
    good: 'text-blue-600 dark:text-blue-400',
    fair: 'text-amber-600 dark:text-amber-400',
    poor: 'text-orange-600 dark:text-orange-400',
    critical: 'text-red-600 dark:text-red-400',
  };

  const detailTabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'rooms', label: 'Rooms', icon: DoorOpen },
    { id: 'systems', label: 'Systems', icon: Settings },
    { id: 'contacts', label: 'Emergency', icon: Users },
  ];

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
            {facility.facilityNumber && (
              <p className="text-sm text-theme-text-muted">{facility.facilityNumber}</p>
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
          {facility.isArchived ? (
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
        {facility.facilityType && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-theme-surface-hover text-theme-text-muted">
            {facility.facilityType.name}
          </span>
        )}
        {facility.statusRecord && (
          <span className="text-xs px-2.5 py-1 rounded-full text-theme-text-primary"
            style={{ backgroundColor: facility.statusRecord.color ? `${facility.statusRecord.color}20` : undefined, color: facility.statusRecord.color ?? undefined }}
          >
            {facility.statusRecord.name}
          </span>
        )}
        {facility.isArchived && (
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
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <span>{address}{facility.addressLine2 ? `, ${facility.addressLine2}` : ''}</span>
                {facility.county && <span className="block text-xs text-theme-text-muted mt-0.5">{facility.county} County</span>}
              </div>
            </div>
          )}
          {(facility.phone || facility.fax || facility.email) && (
            <div className="flex flex-wrap items-center gap-4 text-sm text-theme-text-secondary">
              {facility.phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{facility.phone}</span>}
              {facility.fax && <span className="flex items-center gap-1.5 text-theme-text-muted"><Phone className="w-3.5 h-3.5" />Fax: {facility.fax}</span>}
              {facility.email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{facility.email}</span>}
            </div>
          )}
          {/* Building Info */}
          {(facility.yearBuilt || facility.squareFootage || facility.numFloors || facility.numBays) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
              {facility.yearBuilt && <div><p className="text-xs text-theme-text-muted">Year Built</p><p className="text-sm font-medium text-theme-text-primary">{facility.yearBuilt}</p></div>}
              {facility.squareFootage && <div><p className="text-xs text-theme-text-muted">Sq. Footage</p><p className="text-sm font-medium text-theme-text-primary">{formatNumber(facility.squareFootage)}</p></div>}
              {facility.numFloors && <div><p className="text-xs text-theme-text-muted">Floors</p><p className="text-sm font-medium text-theme-text-primary">{facility.numFloors}</p></div>}
              {facility.numBays && <div><p className="text-xs text-theme-text-muted">Bays</p><p className="text-sm font-medium text-theme-text-primary">{facility.numBays}</p></div>}
              {facility.maxOccupancy && <div><p className="text-xs text-theme-text-muted">Max Occupancy</p><p className="text-sm font-medium text-theme-text-primary">{facility.maxOccupancy}</p></div>}
              {facility.sleepingQuarters && <div><p className="text-xs text-theme-text-muted">Sleeping Qtrs</p><p className="text-sm font-medium text-theme-text-primary">{facility.sleepingQuarters}</p></div>}
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
            <div><label className={labelCls}>County</label><input type="text" value={editData.county as string} onChange={e => setEditData(p => ({...p, county: e.target.value}))} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Phone</label><input type="text" value={editData.phone as string} onChange={e => setEditData(p => ({...p, phone: e.target.value}))} className={inputCls} /></div>
            <div><label className={labelCls}>Fax</label><input type="text" value={editData.fax as string} onChange={e => setEditData(p => ({...p, fax: e.target.value}))} className={inputCls} /></div>
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
              className="btn-primary flex gap-2 items-center text-sm"
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
      </div>

      {/* Detail Sub-Tabs */}
      <div className="border-t border-theme-surface-border pt-4">
        <div className="flex gap-1 mb-3">
          {detailTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeDetailTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabToggle(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  isActive
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Sub-tab content */}
        {activeDetailTab && (
          <div className="space-y-3">
            {isLoadingSub ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
            ) : activeDetailTab === 'rooms' ? (
              /* Rooms */
              <>
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
                        {ROOM_TYPE_OPTIONS.map(rt => <option key={rt} value={rt}>{enumLabel(rt)}</option>)}
                      </select>
                      <input type="number" value={newRoom.floor} onChange={e => setNewRoom(p => ({...p, floor: e.target.value}))} placeholder="Floor" className={inputCls} />
                      <input type="number" value={newRoom.capacity} onChange={e => setNewRoom(p => ({...p, capacity: e.target.value}))} placeholder="Capacity" className={inputCls} />
                      <input type="number" value={newRoom.square_footage} onChange={e => setNewRoom(p => ({...p, square_footage: e.target.value}))} placeholder="Sq ft" className={inputCls} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { void handleAddRoom(); }} className="btn-primary px-3 py-1.5 text-xs">Add</button>
                      <button onClick={() => setShowAddRoom(false)} className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
                {rooms.length === 0 ? (
                  <p className="text-sm text-theme-text-muted py-2">No rooms added yet.</p>
                ) : (
                  <div className="space-y-1">
                    {rooms.map(room => (
                      <div key={room.id} className="flex items-center justify-between p-2.5 bg-theme-surface-hover/30 rounded-lg group">
                        <div className="flex items-center gap-3">
                          <DoorOpen className="w-4 h-4 text-theme-text-muted" />
                          <div>
                            <p className="text-sm font-medium text-theme-text-primary">
                              {room.name}{room.roomNumber ? ` (#${room.roomNumber})` : ''}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                              <span>{enumLabel(room.roomType)}</span>
                              {room.floor != null && <span>Floor {room.floor}</span>}
                              {room.capacity && <span>Cap: {room.capacity}</span>}
                              {room.zoneClassification && room.zoneClassification !== 'unclassified' && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${ZONE_CLASSIFICATION_COLORS[room.zoneClassification] || ''}`}>
                                  {enumLabel(room.zoneClassification)} Zone
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => { void handleDeleteRoom(room); }} className="opacity-0 group-hover:opacity-100 text-theme-text-muted hover:text-red-500 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : activeDetailTab === 'systems' ? (
              /* Building Systems */
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-theme-text-primary">Building Systems ({systems.length})</h3>
                </div>
                {systems.length === 0 ? (
                  <p className="text-sm text-theme-text-muted py-2">No building systems recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {systems.map(sys => (
                      <div key={sys.id} className="flex items-center justify-between p-2.5 bg-theme-surface-hover/30 rounded-lg group">
                        <div className="flex items-center gap-3">
                          <Settings className="w-4 h-4 text-theme-text-muted" />
                          <div>
                            <p className="text-sm font-medium text-theme-text-primary">{sys.name}</p>
                            <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                              <span>{enumLabel(sys.systemType)}</span>
                              {sys.condition && (
                                <span className={`font-medium ${CONDITION_COLORS[sys.condition.toLowerCase()] || ''}`}>
                                  {enumLabel(sys.condition)}
                                </span>
                              )}
                              {sys.manufacturer && <span>{sys.manufacturer}</span>}
                              {sys.warrantyExpiration && (
                                <span className={new Date(sys.warrantyExpiration) < new Date() ? 'text-red-500' : ''}>
                                  Warranty: {sys.warrantyExpiration}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => { void handleDeleteSystem(sys); }} className="opacity-0 group-hover:opacity-100 text-theme-text-muted hover:text-red-500 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : activeDetailTab === 'contacts' ? (
              /* Emergency Contacts */
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-theme-text-primary">Emergency Contacts ({contacts.length})</h3>
                </div>
                {contacts.length === 0 ? (
                  <p className="text-sm text-theme-text-muted py-2">No emergency contacts recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {contacts.map(contact => (
                      <div key={contact.id} className="flex items-center justify-between p-2.5 bg-theme-surface-hover/30 rounded-lg group">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="w-4 h-4 text-theme-text-muted" />
                          <div>
                            <p className="text-sm font-medium text-theme-text-primary">
                              {contact.companyName || contact.contactName || 'Unknown'}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                              <span>{enumLabel(contact.contactType)}</span>
                              {contact.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" />{contact.phone}
                                </span>
                              )}
                              {contact.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" />{contact.email}
                                </span>
                              )}
                              {contact.priority && (
                                <span className={contact.priority === 1 ? 'text-red-500 font-medium' : ''}>
                                  Priority {contact.priority}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => { void handleDeleteContact(contact); }} className="opacity-0 group-hover:opacity-100 text-theme-text-muted hover:text-red-500 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
