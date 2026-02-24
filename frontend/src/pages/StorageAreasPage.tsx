/**
 * Storage Areas Page
 *
 * Manages structured storage locations: boxes can live on a shelf, in a closet, or directly in a room.
 * Each storage area belongs to a Room (Location) and can contain child areas.
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
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  inventoryService,
  locationsService,
  type StorageAreaResponse,
  type StorageAreaCreate,
  type InventoryItem,
  type Location,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import toast from 'react-hot-toast';
import { Modal } from '../components/Modal';

const STORAGE_TYPES = [
  { value: 'rack', label: 'Rack / Closet' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'box', label: 'Box' },
  { value: 'cabinet', label: 'Cabinet / Locker' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'bin', label: 'Bin / Container' },
  { value: 'other', label: 'Other' },
];

const TYPE_ICONS: Record<string, string> = {
  rack: '🗄️',
  shelf: '📚',
  box: '📦',
  cabinet: '🔒',
  drawer: '🗃️',
  bin: '🗑️',
  other: '📍',
};

const STATUS_STYLES: Record<string, string> = {
  available: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  assigned: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  checked_out: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  in_maintenance: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  lost: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  retired: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
};

interface StorageTreeNodeProps {
  area: StorageAreaResponse;
  depth: number;
  onEdit: (area: StorageAreaResponse) => void;
  onDelete: (area: StorageAreaResponse) => void;
  onAddChild: (parent: StorageAreaResponse) => void;
  canManage: boolean;
}

const StorageTreeNode: React.FC<StorageTreeNodeProps> = ({ area, depth, onEdit, onDelete, onAddChild, canManage }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = area.children && area.children.length > 0;

  // Items display state (lazy-loaded)
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  const toggleItems = async () => {
    if (showItems) {
      setShowItems(false);
      return;
    }
    setShowItems(true);
    if (items !== null) return; // Already loaded
    setLoadingItems(true);
    try {
      const data = await inventoryService.getItems({ storage_area_id: area.id, limit: 100 });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2.5 px-3 hover:bg-theme-surface-hover rounded-lg transition-colors group ${
          depth === 0 ? 'border-b border-theme-surface-border' : ''
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`p-0.5 rounded transition-colors ${hasChildren ? 'text-theme-text-muted hover:text-theme-text-primary' : 'invisible'}`}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Type icon */}
        <span className="text-base" title={area.storage_type}>{TYPE_ICONS[area.storage_type] || '📍'}</span>

        {/* Name and label */}
        <div className="flex-1 min-w-0">
          <span className="text-theme-text-primary text-sm font-medium">{area.name}</span>
          {area.label && <span className="text-theme-text-muted text-xs ml-2">({area.label})</span>}
          {area.location_name && depth === 0 && (
            <span className="text-theme-text-muted text-xs ml-2 flex items-center gap-1 inline-flex">
              <MapPin className="w-3 h-3" /> {area.location_name}
            </span>
          )}
        </div>

        {/* Item count badge — clickable to show items */}
        {area.item_count > 0 ? (
          <button
            onClick={() => void toggleItems()}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
              showItems
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
            }`}
            title={showItems ? 'Hide items' : 'Show items'}
          >
            <Package className="w-3 h-3" /> {area.item_count}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-theme-surface-secondary text-theme-text-muted text-xs">
            <Package className="w-3 h-3" /> 0
          </span>
        )}

        {/* Type badge */}
        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-theme-surface-secondary text-theme-text-muted text-xs capitalize">
          {area.storage_type}
        </span>

        {/* Actions */}
        {canManage && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onAddChild(area)} className="p-1 text-theme-text-muted hover:text-emerald-600 rounded" title="Add child">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onEdit(area)} className="p-1 text-theme-text-muted hover:text-blue-600 rounded" title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(area)} className="p-1 text-theme-text-muted hover:text-red-600 rounded" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Items in this storage area */}
      {showItems && (
        <div
          className="border-l-2 border-emerald-500/30 ml-4 my-1"
          style={{ marginLeft: `${depth * 24 + 36}px` }}
        >
          {loadingItems ? (
            <div className="flex items-center gap-2 px-3 py-2 text-theme-text-muted text-xs">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading items...
            </div>
          ) : items && items.length > 0 ? (
            <div className="py-1">
              {items.map(item => (
                <Link
                  key={item.id}
                  to={`/inventory?item=${item.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-theme-surface-hover rounded text-xs group/item"
                >
                  <span className="text-theme-text-primary font-medium truncate">
                    {item.name}
                  </span>
                  {item.serial_number && (
                    <span className="text-theme-text-muted font-mono hidden sm:inline">
                      {item.serial_number}
                    </span>
                  )}
                  {item.quantity > 1 && (
                    <span className="text-theme-text-muted">
                      x{item.quantity}
                    </span>
                  )}
                  <span className={`ml-auto px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase whitespace-nowrap ${STATUS_STYLES[item.status] ?? 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'}`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-theme-text-muted text-xs">
              No items found
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {area.children.map(child => (
            <StorageTreeNode
              key={child.id}
              area={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const StorageAreasPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');

  const [areas, setAreas] = useState<StorageAreaResponse[]>([]);
  const [rooms, setRooms] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingArea, setEditingArea] = useState<StorageAreaResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<StorageAreaCreate>>({
    name: '',
    label: '',
    description: '',
    storage_type: 'rack',
    parent_id: undefined,
    location_id: undefined,
    sort_order: 0,
  });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<StorageAreaResponse | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [areasData, locationsData] = await Promise.all([
        inventoryService.getStorageAreas(),
        locationsService.getLocations({ is_active: true }),
      ]);
      setAreas(areasData);
      setRooms(locationsData.filter(l => l.room_number || l.building));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load storage areas'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAddModal = (parent?: StorageAreaResponse) => {
    setEditingArea(null);
    setFormError(null);

    // Default type based on parent
    let defaultType = 'rack';
    if (parent) {
      if (parent.storage_type === 'rack' || parent.storage_type === 'cabinet') defaultType = 'shelf';
      else if (parent.storage_type === 'shelf') defaultType = 'box';
    }

    setForm({
      name: '',
      label: '',
      description: '',
      storage_type: defaultType,
      parent_id: parent?.id,
      location_id: parent?.location_id || undefined,
      sort_order: 0,
    });
    setShowModal(true);
  };

  const openEditModal = (area: StorageAreaResponse) => {
    setEditingArea(area);
    setFormError(null);
    setForm({
      name: area.name,
      label: area.label || '',
      description: area.description || '',
      storage_type: area.storage_type,
      parent_id: area.parent_id || undefined,
      location_id: area.location_id || undefined,
      sort_order: area.sort_order,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (editingArea) {
        await inventoryService.updateStorageArea(editingArea.id, form);
        toast.success('Storage area updated');
      } else {
        await inventoryService.createStorageArea(form as StorageAreaCreate);
        toast.success('Storage area created');
      }
      setShowModal(false);
      loadData();
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Failed to save storage area'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await inventoryService.deleteStorageArea(deleteTarget.id);
      toast.success('Storage area deleted');
      setDeleteTarget(null);
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete storage area'));
    } finally {
      setSubmitting(false);
    }
  };

  // Filter areas by search
  const filterAreas = (items: StorageAreaResponse[], query: string): StorageAreaResponse[] => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.reduce<StorageAreaResponse[]>((acc, area) => {
      const matches = area.name.toLowerCase().includes(q) || (area.label || '').toLowerCase().includes(q);
      const filteredChildren = filterAreas(area.children || [], query);
      if (matches || filteredChildren.length > 0) {
        acc.push({ ...area, children: filteredChildren });
      }
      return acc;
    }, []);
  };

  const filteredAreas = filterAreas(areas, searchQuery);

  // Flatten areas for parent picker in the modal
  const flattenAreas = (items: StorageAreaResponse[], depth = 0): Array<{ id: string; name: string; depth: number }> => {
    const result: Array<{ id: string; name: string; depth: number }> = [];
    for (const area of items) {
      result.push({ id: area.id, name: area.name, depth });
      if (area.children) {
        result.push(...flattenAreas(area.children, depth + 1));
      }
    }
    return result;
  };

  const flatAreas = flattenAreas(areas);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <Link to="/inventory" className="inline-flex items-center gap-2 text-sm text-theme-text-muted hover:text-theme-text-primary mb-2">
          <ArrowLeft className="w-4 h-4" /> Back to Inventory
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
              <Layers className="w-6 h-6 text-emerald-600" /> Storage Areas
            </h1>
            <p className="text-theme-text-secondary text-sm mt-1">
              Organize storage locations: racks, shelves, boxes, and more.
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => openAddModal()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Storage Area
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <p className="text-red-700 dark:text-red-300 text-sm flex-1">{error}</p>
          <button onClick={loadData} className="flex items-center gap-1 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
        <input
          type="text"
          placeholder="Search storage areas..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-3" />
          <p className="text-theme-text-secondary text-sm">Loading storage areas...</p>
        </div>
      ) : filteredAreas.length === 0 ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Box className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
          <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Storage Areas</h3>
          <p className="text-theme-text-secondary mb-6">
            {searchQuery ? 'No storage areas match your search.' : 'Create storage areas to organize where inventory items are stored.'}
          </p>
          {canManage && !searchQuery && (
            <button onClick={() => openAddModal()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
              <Plus className="w-4 h-4 inline-block mr-1" /> Add First Storage Area
            </button>
          )}
        </div>
      ) : (
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border">
          {/* Column headers */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-theme-surface-border text-xs font-medium text-theme-text-muted uppercase">
            <span className="flex-1 pl-8">Name</span>
            <span className="w-16 text-center">Items</span>
            <span className="hidden sm:block w-20 text-center">Type</span>
            {canManage && <span className="w-24 text-right">Actions</span>}
          </div>
          {filteredAreas.map(area => (
            <StorageTreeNode
              key={area.id}
              area={area}
              depth={0}
              onEdit={openEditModal}
              onDelete={setDeleteTarget}
              onAddChild={openAddModal}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingArea ? 'Edit Storage Area' : 'Add Storage Area'}>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{formError}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="sa-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
                <input id="sa-name" type="text" required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., Rack A, Shelf 3" />
              </div>
              <div>
                <label htmlFor="sa-label" className="block text-sm font-medium text-theme-text-secondary mb-1">Label / Number</label>
                <input id="sa-label" type="text" value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., A, 3, Box-12" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="sa-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Type *</label>
                <select id="sa-type" value={form.storage_type || 'rack'} onChange={(e) => setForm({ ...form, storage_type: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {STORAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sa-room" className="block text-sm font-medium text-theme-text-secondary mb-1">Room</label>
                <select id="sa-room" value={form.location_id || ''} onChange={(e) => setForm({ ...form, location_id: e.target.value || undefined })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">No room</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.building ? `${r.building} — ` : ''}{r.name}{r.room_number ? ` (${r.room_number})` : ''}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="sa-parent" className="block text-sm font-medium text-theme-text-secondary mb-1">Parent Storage Area</label>
              <select id="sa-parent" value={form.parent_id || ''} onChange={(e) => setForm({ ...form, parent_id: e.target.value || undefined })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="">None (top-level)</option>
                {flatAreas.filter(a => a.id !== editingArea?.id).map(a => (
                  <option key={a.id} value={a.id}>{'—'.repeat(a.depth)} {a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sa-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
              <textarea id="sa-description" rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Optional description..." />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {submitting ? 'Saving...' : editingArea ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Storage Area">
        <p className="text-theme-text-secondary text-sm mb-2">
          Are you sure you want to delete <strong className="text-theme-text-primary">{deleteTarget?.name}</strong>?
        </p>
        {deleteTarget && deleteTarget.children && deleteTarget.children.length > 0 && (
          <p className="text-red-700 dark:text-red-400 text-sm mb-2">
            This will also delete {deleteTarget.children.length} child storage area(s).
          </p>
        )}
        {deleteTarget && deleteTarget.item_count > 0 && (
          <p className="text-yellow-700 dark:text-yellow-400 text-sm mb-2">
            {deleteTarget.item_count} item(s) are stored here. They will be unlinked from this storage area.
          </p>
        )}
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
          <button onClick={handleDelete} disabled={submitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {submitting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default StorageAreasPage;
