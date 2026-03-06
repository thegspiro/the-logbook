/**
 * Storage Areas Page
 *
 * Manages hierarchical storage locations within rooms. Storage areas belong to
 * rooms (locations) and can nest inside each other (e.g., Room > Rack > Shelf > Box).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Plus, Pencil, Trash2, ChevronRight, ChevronDown,
  Package, Loader2, RefreshCw, MapPin, Box, Layers, Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { inventoryService, locationsService } from '../../../services/api';
import type { StorageAreaResponse, StorageAreaCreate, Location } from '../types';
import { STORAGE_TYPES } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const inputClass = 'form-input w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const selectClass = 'form-input w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

interface AreaFormData {
  name: string; label: string; description: string; storage_type: string;
  parent_id: string; location_id: string; barcode: string; sort_order: string;
}
const EMPTY_FORM: AreaFormData = {
  name: '', label: '', description: '', storage_type: 'rack',
  parent_id: '', location_id: '', barcode: '', sort_order: '0',
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
  const sort = (ns: TreeNode[]) => { ns.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)); ns.forEach((n) => sort(n.treeChildren)); };
  sort(roots);
  return roots;
}

function flattenForDropdown(nodes: TreeNode[], d = 0): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth: d }, ...flattenForDropdown(n.treeChildren, d + 1)]);
}

/* ---------- Tree row ---------- */
interface TreeRowProps {
  node: TreeNode; depth: number; expanded: Set<string>;
  onToggle: (id: string) => void; onEdit: (a: StorageAreaResponse) => void; onDelete: (a: StorageAreaResponse) => void;
}
const TreeRow: React.FC<TreeRowProps> = ({ node, depth, expanded, onToggle, onEdit, onDelete }) => {
  const has = node.treeChildren.length > 0;
  const open = expanded.has(node.id);
  return (
    <>
      <div className="flex items-center gap-2 py-2 px-3 hover:bg-theme-surface-hover rounded-lg transition-colors group"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}>
        <button onClick={() => onToggle(node.id)} disabled={!has}
          className="w-5 h-5 flex items-center justify-center shrink-0 text-theme-text-muted"
          aria-label={has ? (open ? 'Collapse' : 'Expand') : undefined}>
          {has ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4 h-4" />}
        </button>
        <Box className="w-4 h-4 text-theme-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-theme-text-primary truncate block">
            {node.name}{node.label && <span className="ml-1.5 text-theme-text-muted font-normal">({node.label})</span>}
          </span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30 shrink-0">
          {getTypeLabel(node.storage_type)}
        </span>
        <span className="text-xs text-theme-text-muted shrink-0 w-16 text-right">
          {node.item_count} {node.item_count === 1 ? 'item' : 'items'}
        </span>
        {node.barcode && <span className="text-xs text-theme-text-muted font-mono shrink-0 hidden sm:inline">{node.barcode}</span>}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(node)} aria-label={`Edit ${node.name}`}
            className="p-1 rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(node)} aria-label={`Delete ${node.name}`}
            className="p-1 rounded text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {has && open && node.treeChildren.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1} expanded={expanded}
          onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
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

  const facilities = locations.filter((l) => l.building && !l.facility_room_id);
  const rooms = locations.filter((l) => !!l.facility_room_id || !!l.room_number);
  const filteredRooms = selectedFacilityId ? rooms.filter((r) => r.facility_id === selectedFacilityId) : rooms;
  const tree = buildTree(storageAreas);
  const searchTree = buildTree(searchResults);
  const isShowingSearch = searchQuery.trim().length > 0;
  const displayTree = isShowingSearch ? searchTree : tree;
  const displayLoading = isShowingSearch ? isSearching : isLoadingAreas;

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try { setLocations(await locationsService.getLocations({ is_active: true })); }
    catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to load locations')); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void loadLocations(); }, [loadLocations]);

  const loadStorageAreas = useCallback(async (locationId: string) => {
    setIsLoadingAreas(true);
    try { setStorageAreas(await inventoryService.getStorageAreas({ location_id: locationId, flat: true })); }
    catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to load storage areas')); }
    finally { setIsLoadingAreas(false); }
  }, []);

  useEffect(() => {
    if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    else setStorageAreas([]);
  }, [selectedRoomId, loadStorageAreas]);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const all = await inventoryService.getStorageAreas({ flat: true });
      const lower = q.toLowerCase();
      setSearchResults(all.filter((a) => a.name.toLowerCase().includes(lower)));
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Search failed')); }
    finally { setIsSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void handleSearch(searchQuery); }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, handleSearch]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const handleFacilityChange = (id: string) => { setSelectedFacilityId(id); setSelectedRoomId(''); setStorageAreas([]); };

  const openCreateModal = () => { setEditingArea(null); setFormData({ ...EMPTY_FORM, location_id: selectedRoomId }); setShowModal(true); };
  const openEditModal = (area: StorageAreaResponse) => {
    setEditingArea(area);
    setFormData({
      name: area.name, label: area.label ?? '', description: area.description ?? '',
      storage_type: area.storage_type, parent_id: area.parent_id ?? '',
      location_id: area.location_id ?? selectedRoomId, barcode: area.barcode ?? '',
      sort_order: String(area.sort_order),
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingArea(null); setFormData(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Storage area name is required'); return; }
    setIsSaving(true);
    try {
      const sortNum = parseInt(formData.sort_order, 10);
      const payload: StorageAreaCreate = {
        name: formData.name.trim(), label: formData.label.trim() || undefined,
        description: formData.description.trim() || undefined, storage_type: formData.storage_type,
        parent_id: formData.parent_id || undefined, location_id: formData.location_id || undefined,
        barcode: formData.barcode.trim() || undefined, sort_order: isNaN(sortNum) ? undefined : sortNum,
      };
      if (editingArea) { await inventoryService.updateStorageArea(editingArea.id, payload); toast.success('Storage area updated'); }
      else { await inventoryService.createStorageArea(payload); toast.success('Storage area created'); }
      closeModal();
      if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to save storage area')); }
    finally { setIsSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await inventoryService.deleteStorageArea(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      if (selectedRoomId) void loadStorageAreas(selectedRoomId);
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to delete storage area')); }
    finally { setIsDeleting(false); }
  };

  const parentOptions = flattenForDropdown(tree).filter((o) => o.id !== editingArea?.id);
  const set = (patch: Partial<AreaFormData>) => setFormData((p) => ({ ...p, ...patch }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/inventory" className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary">Storage Areas</h1>
            <p className="text-theme-text-secondary mt-1">Manage hierarchical storage locations within rooms.</p>
          </div>
        </div>
        <button onClick={openCreateModal} className="btn-primary flex gap-2 items-center py-2.5">
          <Plus className="w-4 h-4" /> Add Storage Area
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search storage areas by name across all rooms..." className={inputClass + ' pl-9'} />
      </div>

      {/* Facility / Room picker */}
      {!isShowingSearch && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="facility-select" className={labelClass}><MapPin className="w-3.5 h-3.5 inline mr-1" />Facility</label>
            <select id="facility-select" value={selectedFacilityId} onChange={(e) => handleFacilityChange(e.target.value)}
              className={selectClass} disabled={isLoading}>
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}{f.building ? ` (${f.building})` : ''}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="room-select" className={labelClass}><Layers className="w-3.5 h-3.5 inline mr-1" />Room</label>
            <select id="room-select" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)}
              className={selectClass} disabled={isLoading || filteredRooms.length === 0}>
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
              <button onClick={() => void loadStorageAreas(selectedRoomId)} aria-label="Refresh storage areas"
                className="p-2.5 rounded-lg border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : !isShowingSearch && !selectedRoomId ? (
        <div className="text-center py-16 bg-theme-surface border border-theme-surface-border rounded-xl">
          <Package className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">Select a facility and room above to view storage areas.</p>
        </div>
      ) : displayLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" /></div>
      ) : displayTree.length === 0 ? (
        <div className="text-center py-16 bg-theme-surface border border-theme-surface-border rounded-xl">
          <Box className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted mb-4">
            {isShowingSearch ? 'No storage areas match your search.' : 'No storage areas in this room yet.'}
          </p>
          {!isShowingSearch && (
            <button onClick={openCreateModal} className="btn-primary inline-flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Storage Area
            </button>
          )}
        </div>
      ) : (
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-2">
          {isShowingSearch && (
            <p className="text-xs text-theme-text-muted px-3 py-2 border-b border-theme-surface-border mb-1">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </p>
          )}
          {displayTree.map((n) => (
            <TreeRow key={n.id} node={n} depth={0} expanded={expanded}
              onToggle={toggleExpand} onEdit={openEditModal} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal}
        title={editingArea ? 'Edit Storage Area' : 'Add Storage Area'}
        footer={<>
          <button type="submit" form="sa-form" disabled={isSaving}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{editingArea ? 'Update' : 'Create'}
          </button>
          <button type="button" onClick={closeModal}
            className="mr-2 sm:mr-3 inline-flex items-center px-4 py-2 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
        </>} size="md">
        <form id="sa-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="sa-name" className={labelClass}>Name <span className="text-red-500">*</span></label>
            <input id="sa-name" type="text" required value={formData.name}
              onChange={(e) => set({ name: e.target.value })} className={inputClass} placeholder="e.g. Rack A-1" />
          </div>
          <div>
            <label htmlFor="sa-label" className={labelClass}>Label</label>
            <input id="sa-label" type="text" value={formData.label}
              onChange={(e) => set({ label: e.target.value })} className={inputClass} placeholder="Optional display label" />
          </div>
          <div>
            <label htmlFor="sa-desc" className={labelClass}>Description</label>
            <textarea id="sa-desc" rows={2} value={formData.description}
              onChange={(e) => set({ description: e.target.value })} className={inputClass} placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sa-type" className={labelClass}>Storage Type</label>
              <select id="sa-type" value={formData.storage_type} onChange={(e) => set({ storage_type: e.target.value })} className={selectClass}>
                {STORAGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sa-sort" className={labelClass}>Sort Order</label>
              <input id="sa-sort" type="number" min="0" value={formData.sort_order}
                onChange={(e) => set({ sort_order: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="sa-parent" className={labelClass}>Parent Area</label>
            <select id="sa-parent" value={formData.parent_id} onChange={(e) => set({ parent_id: e.target.value })} className={selectClass}>
              <option value="">None (top level)</option>
              {parentOptions.map((o) => <option key={o.id} value={o.id}>{'  '.repeat(o.depth)}{o.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sa-room" className={labelClass}>Room</label>
            <select id="sa-room" value={formData.location_id} onChange={(e) => set({ location_id: e.target.value })} className={selectClass}>
              <option value="">No room assigned</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} &mdash; Room {r.room_number ?? ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sa-barcode" className={labelClass}>Barcode</label>
            <input id="sa-barcode" type="text" value={formData.barcode}
              onChange={(e) => set({ barcode: e.target.value })} className={inputClass} placeholder="Optional barcode" />
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete Storage Area"
        footer={<>
          <button type="button" onClick={() => void confirmDelete()} disabled={isDeleting}
            className="btn-info inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
            {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}Delete
          </button>
          <button type="button" onClick={() => setDeleteTarget(null)}
            className="mr-2 sm:mr-3 inline-flex items-center px-4 py-2 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
        </>} size="sm">
        <p className="text-sm text-theme-text-secondary">
          Are you sure you want to delete <strong className="text-theme-text-primary">{deleteTarget?.name ?? ''}</strong>?
          {(deleteTarget?.item_count ?? 0) > 0 && (
            <span className="block mt-2 text-red-600 dark:text-red-400">
              This area contains {deleteTarget?.item_count ?? 0} item{(deleteTarget?.item_count ?? 0) !== 1 ? 's' : ''}. They will need to be reassigned.
            </span>
          )}
          {(deleteTarget?.children?.length ?? 0) > 0 && (
            <span className="block mt-2 text-amber-600 dark:text-amber-400">This area has nested sub-areas that may also be affected.</span>
          )}
        </p>
      </Modal>
    </div>
  );
};

export default StorageAreasPage;
