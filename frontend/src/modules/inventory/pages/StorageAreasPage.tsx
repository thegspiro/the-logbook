/**
 * Storage Areas Page
 *
 * Manages hierarchical storage locations within rooms. Storage areas belong to
 * rooms (locations) and can nest inside each other (e.g., Room > Rack > Shelf > Box).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { facilitiesService, inventoryService, locationsService } from '../../../services/api';
import type { StorageAreaResponse, StorageAreaCreate, Location, InventoryItem } from '../types';
import { STORAGE_TYPES, getStatusStyle, getStatusLabel, getConditionColor } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';
import { formCoercions } from '../../../utils/formValues';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { Breadcrumbs } from '../../../components/ux';

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
  sort_order: string;
}
const EMPTY_FORM: AreaFormData = {
  name: '',
  label: '',
  description: '',
  storage_type: 'rack',
  parent_id: '',
  location_id: '',
  sort_order: '0',
};

type TreeNode = StorageAreaResponse & { treeChildren: TreeNode[] };

/** A facility the rooms can be grouped under in the picker. */
interface FacilityOption {
  id: string;
  name: string;
}

/**
 * Which facility a room belongs to.
 *
 * Rooms created through the Facilities module carry `facility_id`. Locations
 * entered by hand never do, so they group under their building name instead —
 * without the fallback those rooms have no facility to filter by and drop out
 * of the picker entirely.
 */
function facilityKeyOf(location: Location): string | null {
  if (location.facility_id) return location.facility_id;
  return location.building ? `building:${location.building}` : null;
}

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
              {getStatusLabel(item.status)}
            </span>
            <span className={`shrink-0 text-xs capitalize ${condColor}`}>{item.condition.replace(/_/g, ' ')}</span>
            {item.tracking_type === 'pool' && (
              <span className="text-theme-text-muted shrink-0 text-xs">qty: {item.quantity}</span>
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
  path: TreeNode[];
  isDesktop: boolean;
  onNavigate: (node: TreeNode) => void;
}
/**
 * The flexible middle of a tree row: a button when it navigates, a plain
 * container when it does not. Given the row's full 44px height so the target
 * is the whole name, not the glyph beside it.
 *
 * Module scope, not inside the row: a component declared during render is a
 * new type every render, so React would unmount and remount the name on each
 * one.
 */
const NameCell: React.FC<{
  children: React.ReactNode;
  label: string;
  onNavigate?: () => void;
}> = ({ children, label, onNavigate }) =>
  onNavigate ? (
    <button type="button" onClick={onNavigate} className="min-h-11 min-w-0 flex-1 text-left" aria-label={label}>
      {children}
    </button>
  ) : (
    <div className="min-w-0 flex-1">{children}</div>
  );

const TreeRow: React.FC<TreeRowProps> = ({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  itemsVisible,
  onToggleItems,
  path,
  isDesktop,
  onNavigate,
}) => {
  const has = node.treeChildren.length > 0;
  const open = expanded.has(node.id);
  const showItems = itemsVisible.has(node.id);
  const indent = isDesktop ? depth * 16 + 12 : 12;
  const pathLabel = path.map((area) => area.name).join(' › ');
  return (
    <>
      <div
        data-storage-area-row={node.id}
        data-testid="storage-area-row"
        className={`hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 transition-colors ${
          isDesktop ? '' : 'border-theme-surface-border border-l-2'
        }`}
        style={{ paddingLeft: `${indent}px` }}
      >
        {/* Desktop expands in place, so the chevron is its own control. On a
            phone it drills in, which the whole name now does — so the glyph
            is decoration there rather than a second control with the same
            name, which would leave two "Open <area>" buttons per row. */}
        {isDesktop ? (
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
        ) : (
          <span className="text-theme-text-muted flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
            {has ? <ChevronRight className="h-4 w-4" /> : <span className="h-4 w-4" />}
          </span>
        )}
        <Box className="text-theme-text-muted hidden h-4 w-4 shrink-0 md:block" />
        {/* On a phone the tree drills in rather than expanding in place, and
            the 24px chevron was the only way to do it — a fingertip aimed at
            the area's name, which is what looks tappable, did nothing, and a
            near-miss to the right hit the item-count button instead. The name
            is the control here; the chevron stays as the affordance. */}
        <NameCell {...(!isDesktop && has ? { onNavigate: () => onNavigate(node) } : {})} label={`Open ${node.name}`}>
          <span
            className="text-theme-text-primary block truncate text-sm font-medium"
            title={pathLabel}
            aria-label={pathLabel}
            data-testid="storage-area-row-path"
          >
            <span aria-hidden="true">
              {isDesktop ? (
                node.name
              ) : (
                <>
                  {path.length > 2 && <>… › </>}
                  {path.slice(-2).map((area, index) => (
                    <React.Fragment key={area.id}>
                      {index > 0 && ' › '}
                      {area.name}
                    </React.Fragment>
                  ))}
                </>
              )}
            </span>
            {node.label && <span className="text-theme-text-muted ml-1.5 font-normal">({node.label})</span>}
          </span>
        </NameCell>
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
      {isDesktop &&
        has &&
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
            path={[...path, c]}
            isDesktop={isDesktop}
            onNavigate={onNavigate}
          />
        ))}
    </>
  );
};

/* ---------- Main page ---------- */
const StorageAreasPage: React.FC = () => {
  const isDesktopTree = useMediaQuery('(min-width: 768px)');
  const [locations, setLocations] = useState<Location[]>([]);
  const [facilityNames, setFacilityNames] = useState<Map<string, string>>(new Map());
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingArea, setEditingArea] = useState<StorageAreaResponse | null>(null);
  const [formData, setFormData] = useState<AreaFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StorageAreaResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemsVisible, setItemsVisible] = useState<Set<string>>(new Set());
  const [mobileParentId, setMobileParentId] = useState<string | null>(null);

  const toggleItemsPanel = (id: string) => {
    setItemsVisible((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Every location is a candidate home for a storage area: filtering the list
  // down to rooms would hide the areas parked on a plain location, which the
  // picker then has no way to reach.
  const rooms = locations;

  // Facilities that actually hold a room. A facility with none can't scope the
  // list to anything, so offering it would only ever empty the page.
  const facilities = useMemo<FacilityOption[]>(() => {
    const byKey = new Map<string, string>();
    for (const loc of locations) {
      const key = facilityKeyOf(loc);
      if (!key || byKey.has(key)) continue;
      const name = (loc.facility_id ? facilityNames.get(loc.facility_id) : undefined) ?? loc.building ?? 'Unnamed';
      byKey.set(key, name);
    }
    return [...byKey.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, facilityNames]);

  const filteredRooms = useMemo(
    () => (selectedFacilityId ? rooms.filter((r) => facilityKeyOf(r) === selectedFacilityId) : rooms),
    [rooms, selectedFacilityId]
  );

  const isShowingSearch = searchQuery.trim().length > 0;

  // Areas in scope. With nothing picked that is everything the organization
  // has — a member landing here sees their storage rather than an empty page
  // asking them to guess which room to open. Descendants come along with a
  // matching area even when they carry no room of their own (the model treats
  // a child's room as inherited from its parent).
  const scopedAreas = useMemo(() => {
    if (!selectedFacilityId && !selectedRoomId) return storageAreas;
    const roomIds = new Set(selectedRoomId ? [selectedRoomId] : filteredRooms.map((r) => r.id));
    const kept = new Set(storageAreas.filter((a) => a.location_id && roomIds.has(a.location_id)).map((a) => a.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const area of storageAreas) {
        if (!kept.has(area.id) && area.parent_id && kept.has(area.parent_id)) {
          kept.add(area.id);
          grew = true;
        }
      }
    }
    return storageAreas.filter((a) => kept.has(a.id));
  }, [storageAreas, selectedFacilityId, selectedRoomId, filteredRooms]);

  // Search reaches across every room, so it reads from the full set rather
  // than the current scope.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return storageAreas.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.label ?? '').toLowerCase().includes(q) ||
        (a.barcode ?? '').toLowerCase().includes(q)
    );
  }, [storageAreas, searchQuery]);

  const tree = useMemo(() => buildTree(scopedAreas), [scopedAreas]);
  const searchTree = useMemo(() => buildTree(searchResults), [searchResults]);
  const displayTree = isShowingSearch ? searchTree : tree;
  const areaById = useMemo(() => new Map(storageAreas.map((area) => [area.id, area])), [storageAreas]);
  const pathFor = useCallback(
    (node: TreeNode): TreeNode[] => {
      const path: TreeNode[] = [node];
      let parentId = node.parent_id;
      const visited = new Set([node.id]);
      while (parentId && !visited.has(parentId)) {
        const parent = areaById.get(parentId);
        if (!parent) break;
        path.unshift({ ...parent, treeChildren: [] });
        visited.add(parent.id);
        parentId = parent.parent_id;
      }
      return path;
    },
    [areaById]
  );
  const mobileParent = mobileParentId ? areaById.get(mobileParentId) : undefined;
  const mobileNodes = useMemo(() => {
    if (isShowingSearch) return searchResults.map((area) => ({ ...area, treeChildren: [] }));
    if (!mobileParentId) return tree;
    const parent = areaById.get(mobileParentId);
    if (!parent) return tree;
    const findChildren = (nodes: TreeNode[]): TreeNode[] | undefined => {
      for (const node of nodes) {
        if (node.id === parent.id) return node.treeChildren;
        const found = findChildren(node.treeChildren);
        if (found) return found;
      }
      return undefined;
    };
    return findChildren(tree) ?? [];
  }, [areaById, isShowingSearch, mobileParentId, searchResults, tree]);

  useEffect(() => {
    if (isDesktopTree || isShowingSearch) setMobileParentId(null);
  }, [isDesktopTree, isShowingSearch]);

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

  // Facility names for the picker. Best-effort: reading facilities needs the
  // facilities permission, which an inventory manager may not hold — without
  // it the rooms still group correctly, they just label by building name.
  const loadFacilityNames = useCallback(async () => {
    try {
      const facilityList = await facilitiesService.getFacilities({ is_archived: false });
      setFacilityNames(new Map(facilityList.map((f) => [f.id, f.name])));
    } catch {
      /* non-critical — the building-name fallback covers the label */
    }
  }, []);

  const loadStorageAreas = useCallback(async () => {
    setIsLoadingAreas(true);
    try {
      // The whole set, filtered in the browser: the tree needs children whose
      // own room is unset, and search spans rooms the picker isn't showing.
      setStorageAreas(await inventoryService.getStorageAreas({ flat: true }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load storage areas'));
    } finally {
      setIsLoadingAreas(false);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
    void loadFacilityNames();
    void loadStorageAreas();
  }, [loadLocations, loadFacilityNames, loadStorageAreas]);

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
      // Create and edit want opposite things from a blank box. On create a blank
      // is omitted so `""` never reaches a Pydantic validator; on edit it goes
      // as an explicit null, because the backend dumps update payloads with
      // `exclude_unset` and an omitted key means "leave this alone" — the clear
      // was being lost behind a success toast (CLAUDE.md pitfall #1).
      const { text, pick, num } = formCoercions(Boolean(editingArea));
      const sortNum = parseInt(formData.sort_order, 10);
      const payload: StorageAreaCreate = {
        name: formData.name.trim(),
        label: text(formData.label),
        description: text(formData.description),
        storage_type: formData.storage_type,
        parent_id: pick(formData.parent_id),
        location_id: pick(formData.location_id),
        sort_order: isNaN(sortNum) ? num('') : sortNum,
      };
      if (editingArea) {
        await inventoryService.updateStorageArea(editingArea.id, payload);
        toast.success('Storage area updated');
      } else {
        // The backend assigns the barcode, so the new row has to come back
        // from the server before it can be shown with one.
        await inventoryService.createStorageArea(payload);
        toast.success('Storage area created');
      }
      closeModal();
      await loadStorageAreas();
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
      await loadStorageAreas();
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
      <Breadcrumbs />

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
              <option value="">All Rooms</option>
              {filteredRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.room_number ? ` — Room ${r.room_number}` : ''}
                  {r.floor ? ` (Floor ${r.floor})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => void loadStorageAreas()}
              aria-label="Refresh storage areas"
              className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border p-2.5 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading || isLoadingAreas ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : displayTree.length === 0 ? (
        <div className="card-secondary py-16 text-center">
          {isShowingSearch ? (
            <Box className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          ) : (
            <Package className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          )}
          <p className="text-theme-text-muted mb-4">
            {isShowingSearch
              ? 'No storage areas match your search.'
              : storageAreas.length === 0
                ? 'No storage areas yet.'
                : 'No storage areas in this part of the department yet.'}
          </p>
          {!isShowingSearch && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Storage Area
            </button>
          )}
        </div>
      ) : (
        <div className="card-secondary p-2" data-testid="storage-area-tree">
          {isShowingSearch && (
            <p className="text-theme-text-muted border-theme-surface-border mb-1 border-b px-3 py-2 text-xs">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </p>
          )}
          {!isDesktopTree && mobileParent && !isShowingSearch && (
            <button
              type="button"
              className="text-theme-text-secondary hover:text-theme-text-primary mb-1 flex min-h-11 w-full items-center gap-1 px-3 text-sm"
              onClick={() => setMobileParentId(mobileParent.parent_id ?? null)}
              aria-label={`Back from ${mobileParent.name}`}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="truncate">
                {pathFor({ ...mobileParent, treeChildren: [] })
                  .map((area) => area.name)
                  .join(' › ')}
              </span>
            </button>
          )}
          {(isDesktopTree ? displayTree : mobileNodes).map((n) => (
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
              path={pathFor(n)}
              isDesktop={isDesktopTree}
              onNavigate={(node) => {
                if (node.treeChildren.length > 0) setMobileParentId(node.id);
              }}
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
                  {r.name}
                  {r.room_number ? ` — Room ${r.room_number}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sa-barcode" className={labelClass}>
              Barcode
            </label>
            <input
              id="sa-barcode"
              type="text"
              readOnly
              value={editingArea?.barcode ?? ''}
              className={inputClass + ' font-mono'}
              placeholder="Assigned automatically"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Every storage area gets a barcode automatically so it can be scanned.
            </p>
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
