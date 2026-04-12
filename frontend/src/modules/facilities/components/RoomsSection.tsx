/**
 * RoomsSection — Manage rooms within a facility.
 */

import { useState, useEffect, useCallback } from 'react';
import { DoorOpen, Plus, Trash2, Loader2, Pencil, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { RoomCreate } from '../../../services/facilitiesServices';
import type { Room } from '../types';
import { enumLabel, ZONE_CLASSIFICATION_COLORS } from '../types';
import { inputCls, labelCls, ROOM_TYPE_OPTIONS, ZONE_OPTIONS } from '../constants';
import { formatNumber } from '../../../utils/dateFormatting';

interface Props {
  facilityId: string;
}

export default function RoomsSection({ facilityId }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    room_number: '',
    floor: '',
    room_type: 'other',
    zone_classification: 'unclassified',
    capacity: '',
    square_footage: '',
    description: '',
    equipment: '',
  });

  const loadRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getRooms({ facility_id: facilityId });
      setRooms(data);
    } catch {
      toast.error('Failed to load rooms');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const resetForm = () => {
    setFormData({
      name: '', room_number: '', floor: '', room_type: 'other',
      zone_classification: 'unclassified', capacity: '', square_footage: '',
      description: '', equipment: '',
    });
    setEditingRoom(null);
    setShowForm(false);
  };

  const openEdit = (room: Room) => {
    setEditingRoom(room);
    setFormData({
      name: room.name || '',
      room_number: room.roomNumber || '',
      floor: room.floor != null ? String(room.floor) : '',
      room_type: room.roomType || 'other',
      zone_classification: room.zoneClassification || 'unclassified',
      capacity: room.capacity != null ? String(room.capacity) : '',
      square_footage: room.squareFootage != null ? String(room.squareFootage) : '',
      description: room.description || '',
      equipment: room.equipment || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload: RoomCreate = {
        facility_id: facilityId,
        name: formData.name.trim(),
        room_type: formData.room_type,
        zone_classification: formData.zone_classification,
      };
      if (formData.room_number.trim()) payload.room_number = formData.room_number.trim();
      if (formData.floor) payload.floor = Number(formData.floor);
      if (formData.capacity) payload.capacity = Number(formData.capacity);
      if (formData.square_footage) payload.square_footage = Number(formData.square_footage);
      if (formData.description.trim()) payload.description = formData.description.trim();
      if (formData.equipment.trim()) payload.equipment = formData.equipment.trim();

      if (editingRoom) {
        await facilitiesService.updateRoom(editingRoom.id, payload);
        toast.success('Room updated');
      } else {
        await facilitiesService.createRoom(payload);
        toast.success('Room added');
      }
      resetForm();
      void loadRooms();
    } catch {
      toast.error('Failed to save room');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (room: Room) => {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    try {
      await facilitiesService.deleteRoom(room.id);
      toast.success('Room deleted');
      void loadRooms();
    } catch {
      toast.error('Failed to delete room');
    }
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Rooms {!isLoading && `(${rooms.length})`}
        </h2>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Room
        </button>
      </div>

      <div className="p-5">
        {/* Add/Edit Form */}
        {showForm && (
          <div className="mb-5 p-4 bg-theme-surface-hover/50 rounded-lg space-y-3">
            <h3 className="text-sm font-medium text-theme-text-primary">
              {editingRoom ? 'Edit Room' : 'Add Room'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Engine Bay 1"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>Room Number</label>
                <input
                  type="text"
                  value={formData.room_number}
                  onChange={(e) => setFormData((p) => ({ ...p, room_number: e.target.value }))}
                  placeholder="e.g., 101"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select
                  value={formData.room_type}
                  onChange={(e) => setFormData((p) => ({ ...p, room_type: e.target.value }))}
                  className={inputCls}
                >
                  {ROOM_TYPE_OPTIONS.map((rt) => (
                    <option key={rt} value={rt}>
                      {enumLabel(rt)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Zone</label>
                <select
                  value={formData.zone_classification}
                  onChange={(e) => setFormData((p) => ({ ...p, zone_classification: e.target.value }))}
                  className={inputCls}
                >
                  {ZONE_OPTIONS.map((z) => (
                    <option key={z} value={z}>
                      {enumLabel(z)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Floor</label>
                <input
                  type="number"
                  value={formData.floor}
                  onChange={(e) => setFormData((p) => ({ ...p, floor: e.target.value }))}
                  placeholder="1"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Capacity</label>
                <input
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData((p) => ({ ...p, capacity: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Sq. Footage</label>
                <input
                  type="number"
                  value={formData.square_footage}
                  onChange={(e) => setFormData((p) => ({ ...p, square_footage: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving}
                className="btn-primary flex gap-1.5 items-center px-3 py-1.5 text-xs"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {editingRoom ? 'Update' : 'Add'}
              </button>
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rooms List */}
        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center py-8">
            <DoorOpen className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
            <p className="text-sm text-theme-text-muted">No rooms added yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="flex items-center justify-between p-3 bg-theme-surface-hover/30 rounded-lg group"
              >
                <div className="flex items-center gap-3">
                  <DoorOpen className="w-4 h-4 text-theme-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">
                      {room.name}
                      {room.roomNumber ? ` (#${room.roomNumber})` : ''}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                      <span>{enumLabel(room.roomType)}</span>
                      {room.floor != null && <span>Floor {room.floor}</span>}
                      {room.capacity != null && <span>Cap: {room.capacity}</span>}
                      {room.squareFootage != null && (
                        <span>{formatNumber(room.squareFootage)} sq ft</span>
                      )}
                      {room.zoneClassification &&
                        room.zoneClassification !== 'unclassified' && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              ZONE_CLASSIFICATION_COLORS[room.zoneClassification] || ''
                            }`}
                          >
                            {enumLabel(room.zoneClassification)} Zone
                          </span>
                        )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(room)}
                    className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                    aria-label={`Edit room ${room.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      void handleDelete(room);
                    }}
                    className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    aria-label={`Delete room ${room.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
