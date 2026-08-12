/**
 * Storage Areas Page
 *
 * Manages hierarchical storage locations within rooms. Storage areas belong to
 * rooms (locations) and can nest inside each other (e.g., Room > Rack > Shelf > Box).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  Package,
  Loader2,
  RefreshCw,
  MapPin,
  Box,
  Layers,
  Search,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router';
import { inventoryService, locationsService } from '../../../services/api';
import type { StorageAreaResponse, StorageAreaCreate, Location, InventoryItem } from '../types';
import { STORAGE_TYPES, getStatusStyle, getConditionColor } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const inputClass = 'form-input w-full';
const selectClass = 'form-input w-full';
const labelClass = 'form-label';

interface AreaFormData {
  name: string;
  label: string;
  description: string;
  storage_type: string;
  parent_id: string;
  location_id: string;
  barcode: string;
  sort_order: string;
}
const EMPTY_FORM: AreaFormData = {
  name: '',
  label: '',
  description: '',
  storage_type: 'rack',
  parent_id: '',
  location_id: '',
  barcode: '',
  sort_order: '0',
};

type TreeNode = StorageAreaResponse & { treeChildren: TreeNode[] };

function getTypeLabel(v: string): string {
  return STORAGE_TYPES.find((t) => t.value === v)?.label ?? v;
}

function buildTree(flat: StorageAreaResponse[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const a of flat) map.set(a.id, { ...a, treeChildren: [] });
  const roots: TreeNode[] = [];
  for (const n of map.values()) {
    const parent = n.parent_id ? map.get(n.parent_id) : undefined;
    if (parent) parent.treeChildren.push(n);
    else roots.push(n);
  }
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.treeChildren));
  };
  sort(roots);
  return roots;
}

function flattenForDropdown(nodes: TreeNode[], d = 0): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth: d }, ...flattenForDropdown(n.treeChildren, d + 1)]);
}

/* ---------- Items panel (shown when item count is clicked) ---------- */
interface ItemsPanelProps {
  areaId: string;
  indent: number;
}
const ItemsPanel: React.FC<ItemsPanelProps> = ({ areaId, indent }) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    inventoryService
      .getItems({ storage_area_id: areaId, limit: 50 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [areaId]);

  const panelIndent = indent + 24;

  if (loading) {
    return (
      <div className="text-theme-text-muted flex items-center gap-2 py-2" style={{ paddingLeft: `${panelIndent}px` }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Loading items…</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-theme-text-muted py-2 text-xs" style={{ paddingLeft: `${panelIndent}px` }}>
        No items found in this area.
      </div>
    );
  }

  return (
    <div className="border-theme-surface-border ml-4 border-l-2" style={{ marginLeft: `${indent + 12}px` }}>
      {items.map((item) => {
        const statusStyle = getStatusStyle(item.status);
        const condColor = getConditionColor(item.condition);
        return (
          <Link
            key={item.id}
            to={`/inventory/items/${item.id}`}
            className="hover:bg-theme-surface-hover group/item flex items-center gap-2 rounded-r-lg px-3 py-1.5 transition-colors"
          >
            <Package className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
            <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm">
              {item.name}
              {item.serial_number && (
                <span className="text-theme-text-muted ml-1.5 font-mono text-xs">#{item.serial_number}</span>
              )}
            </span>
            {item.size && <span className="text-theme-text-muted shrink-0 text-xs">{item.size}</span>}
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-xs ${statusStyle}`}>
              {item.status.replace(/_/g, ' ')}
            </span>
            <span className={`shrink-0 text-xs capitalize ${condColor}`}>{item.condition.replace(/_/g, ' ')}</span>
            {item.tracking_type === 'pool' && (
              <span className="text-theme-text-muted shrink-0 text-xs">
                qty: {item.quantity - item.quantity_issued}
              </span>
            )}
            <ExternalLink className="text-theme-text-muted h-3 w-3 shrink-0 transition-opacity sm:opacity-0 sm:group-hover/item:opacity-100" />
          </Link>
        );
      })}
    </div>
  );
};

/* ---------- Tree row ---------- */
interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (a: StorageAreaResponse) => void;
  onDelete: (a: StorageAreaResponse) => void;
  itemsVisible: Set<string>;
  onToggleItems: (id: string) => void;
}
const TreeRow: React.FC<TreeRowProps> = ({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  itemsVisible,
  onToggleItems,
}) => {
  const has = node.treeChildren.length > 0;
  const open = expanded.has(node.id);
  const showItems = itemsVisible.has(node.id);
  // Cap indentation on mobile to prevent overflow on small screens
  const cappedDepth = typeof window !== 'undefined' && window.innerWidth < 768 ? Math.min(depth, 3) : depth;
  const indent = cappedDepth * 16 + 12;
  return (
    <>
      <div
        className="hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button
          onClick={() => onToggle(node.id)}
          disabled={!has}
          className="text-theme-text-muted flex h-6 w-6 shrink-0 items-center justify-center"
          aria-label={has ? (open ? 'Collapse' : 'Expand') : undefined}
        >
          {has ? (
            open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="h-4 w-4" />
          )}
        </button>
        <Box className="text-theme-text-muted h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-theme-text-primary block truncate text-sm font-medium">
            {node.name}
            {node.label && <span className="text-theme-text-muted ml-1.5 font-normal">({node.label})</span>}
          </span>
          {depth > 3 && <span className="text-theme-text-muted text-[10px] md:hidden">depth {depth + 1}</span>}
        </div>
        <span className="hidden shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 sm:inline dark:text-blue-400">
          {getTypeLabel(node.storage_type)}
        </span>
        <button
          onClick={() => onToggleItems(node.id)}
          className={`w-16 shrink-0 rounded px-1 py-0.5 text-right text-xs transition-colors ${
            node.item_count > 0
              ? 'hover:bg-theme-surface-hover cursor-pointer text-blue-700 underline decoration-dotted underline-offset-2 dark:text-blue-400'
              : 'text-theme-text-muted cursor-default'
          } ${showItems ? 'bg-blue-500/10 font-medium' : ''}`}
          disabled={node.item_count === 0}
          aria-label={
            node.item_count > 0
              ? `${showItems ? 'Hide' : 'Show'} ${node.item_count} item${node.item_count !== 1 ? 's' : ''} in ${node.name}`
              : undefined
          }
        >
          {node.item_count} {node.item_count === 1 ? 'item' : 'items'}
        </button>
        {node.barcode && (
          <span className="text-theme-text-muted hidden shrink-0 font-mono text-xs sm:inline">{node.barcode}</span>
        )}
        <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={() => onEdit(node)}
            aria-label={`Edit ${node.name}`}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded p-2"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(node)}
            aria-label={`Delete ${node.name}`}
            className="text-theme-text-muted rounded p-2 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {showItems && node.item_count > 0 && <ItemsPanel areaId={node.id} indent={indent} />}
      {has &&
        open &&
        node.treeChildren.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            itemsVisible={itemsVisible}
            onToggleItems={onToggleItems}
          />
        ))}
    </>
  );
};

/* ---------- Main page ---------- */
const StorageAreasPage: React.FC = () => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StorageAreaResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAreas, setIsLoadingAreas] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingArea, setEditingArea] = useState<StorageAreaResponse | null>(null);
  const [formData, setFormData] = useState<AreaFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StorageAreaResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemsVisible, setItemsVisible] = useState<Set<string>>(new Set());

  const toggleItemsPanel = (id: string) => {
    setItemsVisible((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const facilities = locations.filter((l) => l.building && !l.facility_room_id);
  const rooms = locations.filter((l) => !!l.facility_room_id || !!l.room_number);
  const selectedFacility = facilities.find((f) => f.id === selectedFacilityId);
  const filteredRooms = selectedFacility
    ? rooms.filter((r) => r.building === selectedFacility.building || r.facility_id === selectedFacilityId)
    : rooms;
  const tree = buildTree(storageAreas);
  const searchTree = buildTree(searchResults);
  const isShowingSearch = searchQuery.trim().length > 0;
  const displayTree = isShowingSearch ? searchTree : tree;
  const displayLoading = isShowingSearch ? isSearching : isLoadingAreas;

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      setLocations(await locationsService.getLocations({ is_active: true }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load locations'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const loadStorageAreas = useCallback(async (locationId: string) => {
    setIsLoadingAreas(true);
    try {
      setStorageAreas(await inventoryService.getStorageAreas({ location_id: locationId, flat: true }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load storage areas'));
    } finally {
      setIsLoadingAreas(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    else setStorageAreas([]);
  }, [selectedRoomId, loadStorageAreas]);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const all = await inventoryService.getStorageAreas({ flat: true });
      const lower = q.toLowerCase();
      setSearchResults(all.filter((a) => a.name.toLowerCase().includes(lower)));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Search failed'));
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void handleSearch(searchQuery);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, handleSearch]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const handleFacilityChange = (id: string) => {
    setSelectedFacilityId(id);
    setSelectedRoomId('');
    setStorageAreas([]);
  };

  const openCreateModal = () => {
    setEditingArea(null);
    setFormData({ ...EMPTY_FORM, location_id: selectedRoomId });
    setShowModal(true);
  };
  const openEditModal = (area: StorageAreaResponse) => {
    setEditingArea(area);
    setFormData({
      name: area.name,
      label: area.label ?? '',
      description: area.description ?? '',
      storage_type: area.storage_type,
      parent_id: area.parent_id ?? '',
      location_id: area.location_id ?? selectedRoomId,
      barcode: area.barcode ?? '',
      sort_order: String(area.sort_order),
    });
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingArea(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Storage area name is required');
      return;
    }
    setIsSaving(true);
    try {
      const sortNum = parseInt(formData.sort_order, 10);
      const payload: StorageAreaCreate = {
        name: formData.name.trim(),
        label: formData.label.trim() || undefined,
        description: formData.description.trim() || undefined,
        storage_type: formData.storage_type,
        parent_id: formData.parent_id || undefined,
        location_id: formData.location_id || undefined,
        barcode: formData.barcode.trim() || undefined,
        sort_order: isNaN(sortNum) ? undefined : sortNum,
      };
      if (editingArea) {
        await inventoryService.updateStorageArea(editingArea.id, payload);
        toast.success('Storage area updated');
      } else {
        await inventoryService.createStorageArea(payload);
        toast.success('Storage area created');
      }
      closeModal();
      if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save storage area'));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await inventoryService.deleteStorageArea(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete storage area'));
    } finally {
      setIsDeleting(false);
    }
  };

  const parentOptions = flattenForDropdown(tree).filter((o) => o.id !== editingArea?.id);
  const set = (patch: Partial<AreaFormData>) => setFormData((p) => ({ ...p, ...patch }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Storage Areas</h1>
          <p className="text-theme-text-secondary mt-1">Manage hierarchical storage locations within rooms.</p>
        </div>
        <button onClick={openCreateModal} className="btn-info btn-md flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Storage Area
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search storage areas by name across all rooms..."
          placeholder="Search storage areas by name across all rooms..."
          className={inputClass + ' pl-9'}
        />
      </div>

      {/* Facility / Room picker */}
      {!isShowingSearch && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="facility-select" className={labelClass}>
              <MapPin className="mr-1 inline h-3.5 w-3.5" />
              Facility
            </label>
            <select
              id="facility-select"
              value={selectedFacilityId}
              onChange={(e) => handleFacilityChange(e.target.value)}
              className={selectClass}
              disabled={isLoading}
            >
              <option value="">All Facilities</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.building ? ` (${f.building})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="room-select" className={labelClass}>
              <Layers className="mr-1 inline h-3.5 w-3.5" />
              Room
            </label>
            <select
              id="room-select"
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className={selectClass}
              disabled={isLoading || filteredRooms.length === 0}
            >
              <option value="">Select a room...</option>
              {filteredRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} &mdash; {r.building ?? ''} {r.floor ? `Floor ${r.floor}` : ''} Room {r.room_number ?? ''}
                </option>
              ))}
            </select>
          </div>
          {selectedRoomId && (
            <div className="flex items-end">
              <button
                onClick={() => void loadStorageAreas(selectedRoomId)}
                aria-label="Refresh storage areas"
                className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border p-2.5 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : !isShowingSearch && !selectedRoomId ? (
        <div className="card-secondary py-16 text-center">
          <Package className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">Select a facility and room above to view storage areas.</p>
        </div>
      ) : displayLoading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : displayTree.length === 0 ? (
        <div className="card-secondary py-16 text-center">
          <Box className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-4">
            {isShowingSearch ? 'No storage areas match your search.' : 'No storage areas in this room yet.'}
          </p>
          {!isShowingSearch && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Storage Area
            </button>
          )}
        </div>
      ) : (
        <div className="card-secondary p-2">
          {isShowingSearch && (
            <p className="text-theme-text-muted border-theme-surface-border mb-1 border-b px-3 py-2 text-xs">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </p>
          )}
          {displayTree.map((n) => (
            <TreeRow
              key={n.id}
              node={n}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpand}
              onEdit={openEditModal}
              onDelete={setDeleteTarget}
              itemsVisible={itemsVisible}
              onToggleItems={toggleItemsPanel}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingArea ? 'Edit Storage Area' : 'Add Storage Area'}
        footer={
          <>
            <button
              type="submit"
              form="sa-form"
              disabled={isSaving}
              className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingArea ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={closeModal}
              className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
            >
              Cancel
            </button>
          </>
        }
        size="md"
      >
        <form id="sa-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="sa-name" className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="sa-name"
              type="text"
              required
              value={formData.name}
              onChange={(e) => set({ name: e.target.value })}
              className={inputClass}
              placeholder="e.g. Rack A-1"
            />
          </div>
          <div>
            <label htmlFor="sa-label" className={labelClass}>
              Label
            </label>
            <input
              id="sa-label"
              type="text"
              value={formData.label}
              onChange={(e) => set({ label: e.target.value })}
              className={inputClass}
              placeholder="Optional display label"
            />
          </div>
          <div>
            <label htmlFor="sa-desc" className={labelClass}>
              Description
            </label>
            <textarea
              id="sa-desc"
              rows={2}
              value={formData.description}
              onChange={(e) => set({ description: e.target.value })}
              className={inputClass}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sa-type" className={labelClass}>
                Storage Type
              </label>
              <select
                id="sa-type"
                value={formData.storage_type}
                onChange={(e) => set({ storage_type: e.target.value })}
                className={selectClass}
              >
                {STORAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sa-sort" className={labelClass}>
                Sort Order
              </label>
              <input
                id="sa-sort"
                type="number"
                min="0"
                value={formData.sort_order}
                onChange={(e) => set({ sort_order: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="sa-parent" className={labelClass}>
              Parent Area
            </label>
            <select
              id="sa-parent"
              value={formData.parent_id}
              onChange={(e) => set({ parent_id: e.target.value })}
              className={selectClass}
            >
              <option value="">None (top level)</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {'  '.repeat(o.depth)}
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sa-room" className={labelClass}>
              Room
            </label>
            <select
              id="sa-room"
              value={formData.location_id}
              onChange={(e) => set({ location_id: e.target.value })}
              className={selectClass}
            >
              <option value="">No room assigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} &mdash; Room {r.room_number ?? ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sa-barcode" className={labelClass}>
              Barcode
            </label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="sa-barcode"
              type="text"
              value={formData.barcode}
              onChange={(e) => set({ barcode: e.target.value })}
              className={inputClass}
              placeholder="Optional barcode"
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Storage Area"
        footer={
          <>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
              className="btn-primary btn-md inline-flex items-center gap-2 disabled:opacity-50"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}Delete
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
            >
              Cancel
            </button>
          </>
        }
        size="sm"
      >
        <p className="text-theme-text-secondary text-sm">
          Are you sure you want to delete{' '}
          <strong className="text-theme-text-primary">{deleteTarget?.name ?? ''}</strong>?
          {(deleteTarget?.item_count ?? 0) > 0 && (
            <span className="mt-2 block text-red-600 dark:text-red-400">
              This area contains {deleteTarget?.item_count ?? 0} item{(deleteTarget?.item_count ?? 0) !== 1 ? 's' : ''}.
              They will need to be reassigned.
            </span>
          )}
          {(deleteTarget?.children?.length ?? 0) > 0 && (
            <span className="mt-2 block text-amber-600 dark:text-amber-400">
              This area has nested sub-areas that may also be affected.
            </span>
          )}
        </p>
      </Modal>
    </div>
  );
};

export default StorageAreasPage;
