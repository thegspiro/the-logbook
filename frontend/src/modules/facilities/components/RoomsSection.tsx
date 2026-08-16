/**
 * RoomsSection — Manage rooms within a facility.
 *
 * Rooms nest: a quartermaster's storage space lives inside the volunteer
 * office, which lives on the facility. The list is rendered as that tree, and
 * each room's form carries a "Located inside" parent picker.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { Check, Copy, CornerDownRight, DoorOpen, Plus, Trash2, Loader2, Pencil, QrCode, Save } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { copyToClipboard } from '../../../utils/clipboard';
import { facilitiesService } from '../../../services/api';
import type { RoomCreate, RoomUpdate } from '../../../services/facilitiesServices';
import type { Room } from '../types';
import { enumLabel, ZONE_CLASSIFICATION_COLORS } from '../types';
import { inputCls, labelCls, MAX_ROOM_NESTING_DEPTH, ROOM_TYPE_OPTIONS, ZONE_OPTIONS } from '../constants';
import type { RoomNode } from '../roomTree';
import { buildRoomTree, collectSubtreeIds, countDescendants, orderRoomsByHierarchy } from '../roomTree';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatNumber } from '../../../utils/dateFormatting';

import { useConfirm } from '../../../contexts/ConfirmContext';
interface Props {
  facilityId: string;
  canManage: boolean;
}

/**
 * Height of a room's subtree, counting the room itself as 1 — a room with one
 * level of sub-rooms has height 2. Mirrors `_room_descendants` in
 * `backend/app/services/facilities_service.py`, which is the authority.
 */
function subtreeHeight(rooms: Room[], roomId: string): number {
  const childrenByParent = new Map<string, string[]>();
  for (const room of rooms) {
    // Self-parenting is rejected by the API, but corrupt data must not loop.
    if (!room.parentRoomId || room.parentRoomId === room.id) continue;
    const siblings = childrenByParent.get(room.parentRoomId);
    if (siblings) {
      siblings.push(room.id);
    } else {
      childrenByParent.set(room.parentRoomId, [room.id]);
    }
  }

  let height = 1;
  const seen = new Set<string>([roomId]);
  let frontier = [roomId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const childId of childrenByParent.get(id) ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        next.push(childId);
      }
    }
    if (next.length === 0) break;
    height += 1;
    frontier = next;
  }
  return height;
}

const emptyForm = {
  name: '',
  room_number: '',
  floor: '',
  room_type: 'other',
  zone_classification: 'unclassified',
  capacity: '',
  square_footage: '',
  description: '',
  equipment: '',
  parent_room_id: '',
};

export default function RoomsSection({ facilityId, canManage }: Props) {
  const { confirm } = useConfirm();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [qrRoomId, setQrRoomId] = useState<string | null>(null);
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  const loadRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      // Nested rooms are returned in the same flat list, so the request has to
      // cover the whole facility or the tree loses branches.
      const data = await facilitiesService.getRooms({ facility_id: facilityId, limit: 500 });
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

  const tree = useMemo(() => buildRoomTree(rooms), [rooms]);

  /**
   * Rooms that may hold the one being edited: everything in the facility
   * except the room itself and its own sub-rooms (which would make a cycle),
   * and except rooms deep enough that nesting the edited room's whole subtree
   * under them would breach the depth cap.
   */
  const parentOptions = useMemo(() => {
    const excluded = editingRoom ? collectSubtreeIds(rooms, editingRoom.id) : new Set<string>();
    // The backend (_assert_parent_room_valid) rejects when
    //   parent_depth + subtree_height > MAX_ROOM_NESTING_DEPTH
    // with a 1-based parent_depth (a top-level room is depth 1) and
    // subtree_height counting the moved room itself as 1. node.depth here is
    // 0-based, so a candidate is offered iff
    //   (node.depth + 1) + movedSubtreeHeight <= MAX_ROOM_NESTING_DEPTH.
    // On create there is no subtree yet (height 1), which reduces to the
    // node.depth + 2 <= cap check used for the "add a room inside" button.
    const movedSubtreeHeight = editingRoom ? subtreeHeight(rooms, editingRoom.id) : 1;
    return orderRoomsByHierarchy(rooms).filter(
      (node) => !excluded.has(node.room.id) && node.depth + 1 + movedSubtreeHeight <= MAX_ROOM_NESTING_DEPTH
    );
  }, [rooms, editingRoom]);

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingRoom(null);
    setShowForm(false);
  };

  const openCreate = (parentRoomId = '') => {
    setEditingRoom(null);
    setFormData({ ...emptyForm, parent_room_id: parentRoomId });
    setShowForm(true);
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
      parent_room_id: room.parentRoomId || '',
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
      if (editingRoom) {
        // Update: send every field the form owns, with an explicit null for
        // the blank ones, or clearing a field silently does nothing.
        const payload: RoomUpdate = {
          name: formData.name.trim(),
          room_type: formData.room_type,
          zone_classification: formData.zone_classification,
          parent_room_id: blankToNull(formData.parent_room_id),
          room_number: blankToNull(formData.room_number),
          floor: numberOrNull(formData.floor),
          capacity: numberOrNull(formData.capacity),
          square_footage: numberOrNull(formData.square_footage),
          description: blankToNull(formData.description),
          equipment: blankToNull(formData.equipment),
        };
        await facilitiesService.updateRoom(editingRoom.id, payload);
        toast.success('Room updated');
      } else {
        // Create: omit the blanks so "" never reaches a Pydantic validator.
        const payload: RoomCreate = {
          facility_id: facilityId,
          name: formData.name.trim(),
          room_type: formData.room_type,
          zone_classification: formData.zone_classification,
        };
        if (formData.parent_room_id) payload.parent_room_id = formData.parent_room_id;
        if (formData.room_number.trim()) payload.room_number = formData.room_number.trim();
        if (formData.floor) payload.floor = Number(formData.floor);
        if (formData.capacity) payload.capacity = Number(formData.capacity);
        if (formData.square_footage) payload.square_footage = Number(formData.square_footage);
        if (formData.description.trim()) payload.description = formData.description.trim();
        if (formData.equipment.trim()) payload.equipment = formData.equipment.trim();
        await facilitiesService.createRoom(payload);
        toast.success('Room added');
      }
      resetForm();
      void loadRooms();
    } catch (err: unknown) {
      // Nesting rejections ("a room cannot be placed inside one of its own
      // sub-rooms") only make sense if the reason survives the toast.
      toast.error(getErrorMessage(err, 'Failed to save room'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyKioskUrl = async (room: Room) => {
    const kioskUrl = `${window.location.origin}/display/${room.displayCode}`;
    try {
      await copyToClipboard(kioskUrl);
      setCopiedRoomId(room.id);
      toast.success('Kiosk URL copied');
      setTimeout(() => setCopiedRoomId(null), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  const handleDelete = async (node: RoomNode) => {
    const nested = countDescendants(node);
    // Sub-rooms survive: the backend re-parents them onto this room's parent.
    const message = nested
      ? `Delete "${node.room.name}"? Its ${nested === 1 ? 'sub-room' : `${nested} sub-rooms`} will move up a level rather than be deleted. This cannot be undone.`
      : `Delete "${node.room.name}"? This cannot be undone.`;
    if (
      !(await confirm({
        title: 'Delete room',
        message,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteRoom(node.room.id);
      toast.success('Room deleted');
      void loadRooms();
    } catch {
      toast.error('Failed to delete room');
    }
  };

  const renderNode = (node: RoomNode) => {
    const { room } = node;
    const nested = node.children.length;
    const canNestDeeper = node.depth + 2 <= MAX_ROOM_NESTING_DEPTH;

    return (
      <div key={room.id}>
        <div className="bg-theme-surface-hover/30 rounded-lg p-3">
          <div className="group flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              {node.depth > 0 ? (
                <CornerDownRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <DoorOpen className="text-theme-text-muted h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-theme-text-primary text-sm font-medium">
                  {room.name}
                  {room.roomNumber ? ` (#${room.roomNumber})` : ''}
                </p>
                <div className="text-theme-text-muted flex flex-wrap items-center gap-2 text-xs">
                  <span>{enumLabel(room.roomType)}</span>
                  {room.floor != null && <span>Floor {room.floor}</span>}
                  {room.capacity != null && <span>Cap: {room.capacity}</span>}
                  {room.squareFootage != null && <span>{formatNumber(room.squareFootage)} sq ft</span>}
                  {nested > 0 && <span>{nested === 1 ? '1 sub-room' : `${nested} sub-rooms`}</span>}
                  {room.zoneClassification && room.zoneClassification !== 'unclassified' && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        ZONE_CLASSIFICATION_COLORS[room.zoneClassification] || ''
                      }`}
                    >
                      {enumLabel(room.zoneClassification)} Zone
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* An inactive room's linked Location is inactive too, and the
                  public display lookup refuses inactive locations — a QR
                  for it would scan to "Display not found" */}
              {room.displayCode && room.isActive !== false && (
                <button
                  onClick={() => setQrRoomId((prev) => (prev === room.id ? null : room.id))}
                  className="text-theme-text-muted inline-flex items-center justify-center rounded-lg p-1.5 transition-colors hover:text-blue-500 max-md:min-h-11 max-md:min-w-11"
                  aria-label={`Toggle QR code for ${room.name}`}
                  title="Show check-in QR code"
                >
                  <QrCode className="h-3.5 w-3.5" />
                </button>
              )}
              {canManage && (
                <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  {canNestDeeper && (
                    <button
                      onClick={() => openCreate(room.id)}
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                      aria-label={`Add a room inside ${room.name}`}
                      title="Add a room inside this one"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(room)}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                    aria-label={`Edit room ${room.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      void handleDelete(node);
                    }}
                    className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    aria-label={`Delete room ${room.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          {qrRoomId === room.id && room.displayCode && room.isActive !== false && (
            <div className="border-theme-surface-border mt-3 flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
              {/* bg-white intentional for QR code readability */}
              <QRCodeSVG
                value={`${window.location.origin}/display/${room.displayCode}`}
                size={140}
                level="H"
                includeMargin
              />
              <p className="text-center font-mono text-[10px] break-all text-gray-600">
                {`${window.location.origin}/display/${room.displayCode}`}
              </p>
              <button
                onClick={() => {
                  void handleCopyKioskUrl(room);
                }}
                className="flex items-center gap-1.5 text-xs text-gray-600 transition-colors hover:text-blue-500 max-md:min-h-11"
              >
                {copiedRoomId === room.id ? (
                  <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden="true" />
                )}
                Copy kiosk URL
              </button>
            </div>
          )}
        </div>
        {node.children.length > 0 && (
          <div className="border-theme-surface-border mt-2 ml-3 space-y-2 border-l pl-3 sm:ml-5 sm:pl-4">
            {node.children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">Rooms {!isLoading && `(${rooms.length})`}</h2>
        <div className="flex items-center gap-1">
          {/* Rooms sync to Locations with kiosk display codes — the QR
              directory is where those codes can be viewed and printed */}
          {canManage && (
            <Link
              to="/locations/qr-codes"
              className="text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors max-md:min-h-11"
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" /> Check-In QR Codes
            </Link>
          )}
          {canManage && (
            <button
              onClick={() => openCreate()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
            >
              <Plus className="h-3.5 w-3.5" /> Add Room
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* Add/Edit Form */}
        {canManage && showForm && (
          <div className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4">
            <h3 className="text-theme-text-primary text-sm font-medium">{editingRoom ? 'Edit Room' : 'Add Room'}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls} htmlFor="room-name">
                  Name *
                </label>
                <input
                  id="room-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Engine Bay 1"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="room-number">
                  Room Number
                </label>
                <input
                  id="room-number"
                  type="text"
                  value={formData.room_number}
                  onChange={(e) => setFormData((p) => ({ ...p, room_number: e.target.value }))}
                  placeholder="e.g., 101"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="room-parent">
                  Located Inside
                </label>
                <select
                  id="room-parent"
                  value={formData.parent_room_id}
                  onChange={(e) => setFormData((p) => ({ ...p, parent_room_id: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Facility (top level)</option>
                  {parentOptions.map((node) => (
                    <option key={node.room.id} value={node.room.id}>
                      {/* Non-breaking spaces: a select collapses ordinary option indentation */}
                      {`${'  '.repeat(node.depth)}${node.room.name}`}
                      {node.room.roomNumber ? ` (#${node.room.roomNumber})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="room-type">
                  Type
                </label>
                <select
                  id="room-type"
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
                <label className={labelCls} htmlFor="room-zone">
                  Zone
                </label>
                <select
                  id="room-zone"
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
                <label className={labelCls} htmlFor="room-floor">
                  Floor
                </label>
                <input
                  id="room-floor"
                  type="number"
                  value={formData.floor}
                  onChange={(e) => setFormData((p) => ({ ...p, floor: e.target.value }))}
                  placeholder="1"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="room-capacity">
                  Capacity
                </label>
                <input
                  id="room-capacity"
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData((p) => ({ ...p, capacity: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="room-sqft">
                  Sq. Footage
                </label>
                <input
                  id="room-sqft"
                  type="number"
                  value={formData.square_footage}
                  onChange={(e) => setFormData((p) => ({ ...p, square_footage: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls} htmlFor="room-description">
                  Description
                </label>
                <input
                  id="room-description"
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
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingRoom ? 'Update' : 'Add'}
              </button>
              <button
                onClick={resetForm}
                className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rooms List */}
        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="py-8 text-center">
            <DoorOpen className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No rooms added yet.</p>
          </div>
        ) : (
          <div className="space-y-2">{tree.map(renderNode)}</div>
        )}
      </div>
    </div>
  );
}
