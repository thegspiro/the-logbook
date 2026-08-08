/**
 * FacilityRoomPicker — reusable room selector for cross-module use.
 *
 * Loads facilities and their rooms from the facilities API and lets the user
 * pick a room. Used by events, training, scheduling, and other modules that
 * need to assign a room to a record.
 *
 * Usage:
 *   <FacilityRoomPicker
 *     value={selectedRoomId}
 *     onChange={(roomId, room) => setRoomId(roomId)}
 *   />
 */

import { useState, useEffect, useCallback } from 'react';
import { Building2, DoorOpen, ChevronDown, Loader2 } from 'lucide-react';
import { facilitiesService } from '../services/api';
import type { Facility, Room } from '../modules/facilities/types';
import { enumLabel } from '../modules/facilities/types';
import { formatNumber } from '../utils/dateFormatting';

interface FacilityRoomPickerProps {
  /** Currently selected room ID */
  value?: string | null;
  /** Callback when a room is selected or cleared */
  onChange: (roomId: string | null, room: Room | null) => void;
  /** Optional: restrict to a single facility */
  facilityId?: string;
  /** Optional: filter by room type */
  roomType?: string;
  /** Optional: custom placeholder */
  placeholder?: string;
  /** Optional: disable the picker */
  disabled?: boolean;
  /** Optional: additional CSS classes on the outer wrapper */
  className?: string;
}

export default function FacilityRoomPicker({
  value,
  onChange,
  facilityId,
  roomType,
  placeholder = 'Select a room...',
  disabled = false,
  className = '',
}: FacilityRoomPickerProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(facilityId ?? '');

  // Load facilities list (once)
  useEffect(() => {
    if (facilityId) {
      setFacilities([]);
      return;
    }
    facilitiesService
      .getFacilities({ is_archived: false })
      .then(setFacilities)
      .catch(() => {
        /* non-critical */
      });
  }, [facilityId]);

  // Load rooms when facility changes
  const loadRooms = useCallback(async () => {
    const fid = facilityId ?? selectedFacilityId;
    if (!fid) {
      setRooms([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      let data = await facilitiesService.getRooms({ facility_id: fid });
      if (roomType) {
        data = data.filter((r) => r.roomType === roomType);
      }
      setRooms(data);
    } catch {
      setRooms([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId, selectedFacilityId, roomType]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const handleFacilityChange = (fid: string) => {
    setSelectedFacilityId(fid);
    onChange(null, null);
  };

  const handleRoomChange = (rid: string) => {
    if (!rid) {
      onChange(null, null);
      return;
    }
    const room = rooms.find((r) => r.id === rid) ?? null;
    onChange(rid, room);
  };

  const selectedRoom = rooms.find((r) => r.id === value);

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2.5 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring appearance-none';

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Facility selector (hidden when locked to a facility) */}
      {!facilityId && (
        <div className="relative">
          <Building2 className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <select
            value={selectedFacilityId}
            onChange={(e) => handleFacilityChange(e.target.value)}
            disabled={disabled}
            className={`${inputCls} pl-9`}
            aria-label="Select facility"
          >
            <option value="">Select a facility...</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <ChevronDown className="text-theme-text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
        </div>
      )}

      {/* Room selector */}
      <div className="relative">
        <DoorOpen className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        {isLoading && (selectedFacilityId || facilityId) ? (
          <div className={`${inputCls} text-theme-text-muted flex items-center gap-2 pl-9`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading rooms...
          </div>
        ) : (
          <select
            value={value ?? ''}
            onChange={(e) => handleRoomChange(e.target.value)}
            disabled={disabled || rooms.length === 0}
            className={`${inputCls} pl-9`}
            aria-label="Select room"
          >
            <option value="">{rooms.length === 0 ? 'No rooms available' : placeholder}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.roomNumber ? ` (#${r.roomNumber})` : ''} — {enumLabel(r.roomType)}
              </option>
            ))}
          </select>
        )}
        {!isLoading && (
          <ChevronDown className="text-theme-text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
        )}
      </div>

      {/* Selected room info card */}
      {selectedRoom && (
        <div className="bg-theme-surface-hover/50 flex items-start gap-3 rounded-lg p-3 text-sm">
          <DoorOpen className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-theme-text-primary font-medium">
              {selectedRoom.name}
              {selectedRoom.roomNumber ? ` (#${selectedRoom.roomNumber})` : ''}
            </p>
            <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-2 text-xs">
              {selectedRoom.roomType && (
                <span className="bg-theme-surface-hover rounded-full px-2 py-0.5">
                  {enumLabel(selectedRoom.roomType)}
                </span>
              )}
              {selectedRoom.floor != null && <span>Floor {selectedRoom.floor}</span>}
              {selectedRoom.capacity && <span>Capacity: {selectedRoom.capacity}</span>}
              {selectedRoom.squareFootage && <span>{formatNumber(selectedRoom.squareFootage)} sq ft</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
