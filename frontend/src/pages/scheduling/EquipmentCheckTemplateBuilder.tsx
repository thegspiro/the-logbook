/**
 * Equipment Check Template Builder
 *
 * Admin page for creating and editing equipment check templates with
 * compartments and items. Supports nested compartments, multiple check
 * types, expiration tracking, and drag-handle placeholders for reordering.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Save,
  ArrowLeft,
  Image,
  Clock,
  AlertTriangle,
  Loader2,
  Truck,
  Eye,
  X,
  Copy,
  ChevronsUpDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Hash,
  CheckSquare,
  Square,
  Type,
  Pencil,
  Download,
  Upload,
  ArrowRightLeft,
  List,
  Package,
  Link2,
  MoreHorizontal,
  SlidersHorizontal,
  Users,
  Indent,
  Outdent,
  ToggleRight,
  Gauge,
  CalendarClock,
  Smartphone,
  Signal,
  BatteryFull,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DraggableAttributes } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getErrorMessage } from '@/utils/errorHandling';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { schedulingService } from '@/modules/scheduling';
import {
  canMoveCompartment,
  moveCompartment as moveCompartmentInTree,
  orderedCompartmentIds,
  orderedCompartments as buildOrderedCompartments,
  reorderCompartment,
} from '@/modules/scheduling/utils/compartmentTree';
import { EquipmentCheckForm } from '@/pages/scheduling/EquipmentCheckForm';
import { DialogPortal } from '@/components/DialogPortal';
import { DialogPanel } from '@/components/ux/DialogPanel';
import InventoryItemPicker from '@/modules/scheduling/components/InventoryItemPicker';
import CatalogQuickAdd from '@/modules/scheduling/components/CatalogQuickAdd';
import InventoryMatchModal from '@/modules/scheduling/components/InventoryMatchModal';
import type { CatalogAddPayload } from '@/modules/scheduling/components/CatalogQuickAdd';
import { useAuthStore } from '@/stores/authStore';
import { blankToNull, numberOrNull } from '@/utils/formValues';
import { parseCsvRecords, csvValue } from '@/utils/csv';
import { storedInsideOptions } from './equipmentCheckHierarchy';
import type {
  EquipmentCheckTemplate,
  EquipmentCheckTemplateCreate,
  CheckTemplateCompartmentCreate,
  CheckTemplateCompartment,
  CheckTemplateItemCreate,
  CheckTemplateItem,
  CheckType,
  TemplateType,
  LinkCoverage,
} from '@/modules/scheduling/types/equipmentCheck';
import {
  TEMPLATE_TYPE_LABELS,
  CONTAINER_TYPE_PRESETS,
  CHECK_TYPE_STORES,
  containerTypeLabel,
  isPresetContainerType,
  normalizeCheckType,
} from '@/modules/scheduling/types/equipmentCheck';

// ============================================================================
// Constants (static preset data extracted to equipmentCheckPresets.ts)
// ============================================================================

import {
  CHECK_TYPES,
  CHECK_TYPE_HELP,
  LEVEL_UNIT_PRESETS,
  POSITIONS,
  APPARATUS_TYPES,
  VEHICLE_PRESETS,
  EQUIPMENT_PRESETS,
} from './equipmentCheckPresets';
import { useOverlaySurface } from '../../hooks/useOverlaySurface';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/** Sentinel anchor for blockers that live in the details drawer, not on a row. */
const DETAILS_ANCHOR = '__details__';

/**
 * The four answerable types, as the row's segmented control presents them.
 *
 * Ordered by how often a checklist uses them rather than by
 * `CANONICAL_CHECK_TYPES`' declaration order, and labelled in the crew's words:
 * a firefighter is asked whether a thing *works*, not whether its "function"
 * check passed.
 */
const CANVAS_CHECK_TYPES = [
  { value: 'function', label: 'Works', Icon: ToggleRight },
  { value: 'count', label: 'Count', Icon: Hash },
  { value: 'level', label: 'Level', Icon: Gauge },
  { value: 'expiry', label: 'Date', Icon: CalendarClock },
] as const satisfies ReadonlyArray<{ value: CheckType; label: string; Icon: typeof ToggleRight }>;

const inputClass = 'form-input';

const selectClass = 'form-input';

const labelClass = 'form-label';

const checkboxClass = 'form-checkbox';

const mobileMenuItemClass =
  'text-theme-text-primary hover:bg-theme-surface-secondary flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left text-sm';
const mobileDestructiveMenuItemClass = `${mobileMenuItemClass} text-red-600 dark:text-red-400`;

/** Native details/summary preserves keyboard disclosure behavior without making
 * the row permanently carry every secondary action. */
const RowActionMenu: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details
    className="relative flex-shrink-0"
    onClick={(event) => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false;
    }}
    onChange={(event) => {
      if ((event.target as HTMLElement).matches('select')) event.currentTarget.open = false;
    }}
  >
    <summary
      className="text-theme-text-muted hover:bg-theme-surface-secondary flex min-h-[44px] min-w-[44px] cursor-pointer list-none items-center justify-center rounded-md sm:min-h-7 sm:min-w-7 [&::-webkit-details-marker]:hidden"
      aria-label={label}
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
    </summary>
    <div className="border-theme-surface-border bg-theme-surface absolute top-full right-0 z-30 mt-1 min-w-56 overflow-hidden rounded-lg border py-1 shadow-lg">
      {children}
    </div>
  </details>
);

// ============================================================================
// Item Form State
// ============================================================================

interface ItemFormState {
  /** Stable identity used while an item moves between arrays. */
  clientKey: string;
  id?: string;
  saveStatus?: 'saving' | 'failed';
  name: string;
  description: string;
  checkType: CheckType;
  isRequired: boolean;
  requiredQuantity: string;
  expectedQuantity: string;
  criticalMinimumQuantity: string;
  minLevel: string;
  levelUnit: string;
  serialNumber: string;
  lotNumber: string;
  inventoryItemId?: string;
  hasExpiration: boolean;
  expirationDate: string;
  expirationWarningDays: string;
  imageUrl: string;
}

let nextItemKey = 0;
const newItemKey = () => `local-item-${Date.now()}-${nextItemKey++}`;

function emptyItem(): ItemFormState {
  return {
    clientKey: newItemKey(),
    name: '',
    description: '',
    checkType: 'function',
    isRequired: true,
    requiredQuantity: '',
    expectedQuantity: '',
    criticalMinimumQuantity: '',
    minLevel: '',
    levelUnit: '',
    serialNumber: '',
    lotNumber: '',
    inventoryItemId: '',
    hasExpiration: false,
    expirationDate: '',
    expirationWarningDays: '30',
    imageUrl: '',
  };
}

/**
 * Map a saved item back into form state.
 *
 * Written out by hand at each of the three add paths before this existed, and
 * all three omitted `inventoryItemId` — harmless while no add path could set
 * one, and wrong the moment quick-add could: a freshly linked item would sit
 * there reading as unlinked until the page was reloaded.
 */
function itemFormFromResponse(created: CheckTemplateItem): ItemFormState {
  return {
    clientKey: newItemKey(),
    id: created.id,
    name: created.name,
    description: created.description ?? '',
    checkType: created.checkType,
    isRequired: created.isRequired,
    requiredQuantity: created.requiredQuantity != null ? String(created.requiredQuantity) : '',
    expectedQuantity: created.expectedQuantity != null ? String(created.expectedQuantity) : '',
    criticalMinimumQuantity: created.criticalMinimumQuantity != null ? String(created.criticalMinimumQuantity) : '',
    minLevel: created.minLevel != null ? String(created.minLevel) : '',
    levelUnit: created.levelUnit ?? '',
    serialNumber: created.serialNumber ?? '',
    lotNumber: created.lotNumber ?? '',
    inventoryItemId: created.inventoryItemId ?? '',
    hasExpiration: created.hasExpiration,
    expirationDate: created.expirationDate ?? '',
    expirationWarningDays: String(created.expirationWarningDays ?? 30),
    imageUrl: created.imageUrl ?? '',
  };
}

function itemCreateFromForm(item: ItemFormState, sortOrder: number, name = item.name): CheckTemplateItemCreate {
  return {
    name,
    description: item.description.trim() || undefined,
    sort_order: sortOrder,
    check_type: item.checkType,
    is_required: item.isRequired,
    required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
    expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
    critical_minimum_quantity: item.criticalMinimumQuantity ? Number(item.criticalMinimumQuantity) : undefined,
    min_level: item.minLevel ? Number(item.minLevel) : undefined,
    level_unit: item.levelUnit.trim() || undefined,
    serial_number: item.serialNumber.trim() || undefined,
    lot_number: item.lotNumber.trim() || undefined,
    inventory_item_id: item.inventoryItemId || undefined,
    image_url: item.imageUrl.trim() || undefined,
    has_expiration: item.hasExpiration,
    expiration_date: item.expirationDate.trim() || undefined,
    expiration_warning_days: item.expirationWarningDays ? Number(item.expirationWarningDays) : undefined,
  };
}

// ============================================================================
// Compartment Form State
// ============================================================================

interface CompartmentFormState {
  /** Stable identity for unsaved rows; array indexes break focus/expansion after reorder. */
  clientKey: string;
  id?: string;
  name: string;
  description: string;
  imageUrl: string;
  isHeader: boolean;
  containerType: string;
  /** Closed with a numbered tamper seal — see CheckTemplateCompartment.isSealed. */
  isSealed: boolean;
  parentCompartmentId: string;
  items: ItemFormState[];
}

let nextCompartmentKey = 0;
const newCompartmentKey = () => `local-compartment-${Date.now()}-${nextCompartmentKey++}`;

function emptyCompartment(): CompartmentFormState {
  return {
    clientKey: newCompartmentKey(),
    name: '',
    description: '',
    imageUrl: '',
    isHeader: false,
    containerType: 'compartment',
    isSealed: false,
    parentCompartmentId: '',
    items: [],
  };
}

function compartmentFormFromResponse(compartment: CheckTemplateCompartment): CompartmentFormState {
  return {
    clientKey: newCompartmentKey(),
    id: compartment.id,
    name: compartment.name,
    description: compartment.description ?? '',
    imageUrl: compartment.imageUrl ?? '',
    isHeader: compartment.isHeader ?? false,
    containerType: compartment.containerType ?? 'compartment',
    isSealed: compartment.isSealed ?? false,
    parentCompartmentId: compartment.parentCompartmentId ?? '',
    items: compartment.items.map(itemFormFromResponse),
  };
}

// ============================================================================
// Template Form State
// ============================================================================

interface TemplateFormState {
  name: string;
  description: string;
  checkTiming: 'start_of_shift' | 'end_of_shift';
  templateType: TemplateType;
  assignedPositions: string[];
  apparatusType: string;
  apparatusId: string;
  isActive: boolean;
}

function defaultTemplateForm(): TemplateFormState {
  return {
    name: '',
    description: '',
    checkTiming: 'start_of_shift',
    templateType: 'equipment',
    assignedPositions: [],
    apparatusType: '',
    apparatusId: '',
    isActive: false,
  };
}

// ============================================================================
// Sortable wrapper components (defined outside the main component so React
// sees a stable component type across re-renders — prevents input focus loss)
// ============================================================================

interface SortableItemWrapperProps {
  id: string;
  children: (opts: {
    listeners: Record<string, unknown> | undefined;
    setNodeRef: React.Ref<HTMLDivElement>;
    style: React.CSSProperties;
    attributes: DraggableAttributes;
  }) => React.ReactNode;
}

const SortableItemWrapper: React.FC<SortableItemWrapperProps> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({
        listeners: listeners ?? undefined,
        setNodeRef,
        style,
        attributes,
      })}
    </div>
  );
};

interface SortableCompartmentWrapperProps {
  id: string;
  disabled?: boolean;
  children: (opts: {
    listeners: Record<string, unknown> | undefined;
    setNodeRef: React.Ref<HTMLDivElement>;
    style: React.CSSProperties;
    attributes: DraggableAttributes;
  }) => React.ReactNode;
}

const SortableCompartmentWrapper: React.FC<SortableCompartmentWrapperProps> = ({ id, disabled = false, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <>
      {children({
        listeners: listeners ?? undefined,
        setNodeRef,
        style,
        attributes,
      })}
    </>
  );
};

// ============================================================================
// Component
// ============================================================================

const EquipmentCheckTemplateBuilder: React.FC = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const isEditing = Boolean(templateId);
  // Writing to the catalog is a separate grant from building checklists, so a
  // scheduling officer without it is offered linking but not creation —
  // showing the affordance anyway would just produce a 403 they cannot act on.
  const canManageInventory = useAuthStore((s) => s.checkPermission)('inventory.manage');

  // State
  const [form, setForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [compartments, setCompartments] = useState<CompartmentFormState[]>([]);
  const compartmentsRef = useRef(compartments);
  compartmentsRef.current = compartments;
  const itemMoveQueue = useRef<Promise<void>>(Promise.resolve());
  // Two guards, not one: adding a compartment and adding a section header are
  // separate buttons, and a shared flag would gray out one because the other
  // is mid-flight.
  const { busy: addingCompartment, run: runAddCompartment } = useSubmitGuard();
  const { busy: addingSection, run: runAddSection } = useSubmitGuard();
  const [expandedCompartments, setExpandedCompartments] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Template metadata moved off the canvas into a right-side drawer: the
  // checklist is what the author came to build, and the metadata is answered
  // once. The blocker panel is what re-opens it when something is missing.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rail, setRail] = useState<'blockers' | 'crew'>('blockers');
  // One composer per location replaces the old quick-add / bulk-paste mode
  // toggle: the number of lines decides which behaviour applies.
  const [composeValues, setComposeValues] = useState<Record<string, string>>({});
  const [composeTypes, setComposeTypes] = useState<Record<string, CheckType>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [mobileEditor, setMobileEditor] = useState<{ compartmentKey: string; itemKey: string } | null>(null);
  const isLaptop = useMediaQuery('(min-width: 640px)');
  // The rail is a second flex line, not a column, until the canvas and it both
  // fit: 420px + 320px + a 24px gap, inside the page gutters and the side nav.
  // Below that it would sit after the whole checklist, which is no more
  // reachable than the modal it replaced — so below it, it is the modal.
  const isWideCanvas = useMediaQuery('(min-width: 1152px)');
  const [mobileSelectionLocations, setMobileSelectionLocations] = useState<Set<string>>(new Set());
  const [mobileAddLocations, setMobileAddLocations] = useState<Set<string>>(new Set());
  const [highlightedItemKeys, setHighlightedItemKeys] = useState<Set<string>>(new Set());

  // Bulk selection: per-compartment set of selected item indices
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(0);
  // The sticky top bar wraps to two or three rows depending on width and
  // translated copy, so the rail's own sticky offset is measured rather than
  // guessed — a stale constant parks the rail's tab strip underneath it.
  const topBarRef = useRef<HTMLDivElement>(null);
  /** Where the sticky top bar ends: its own height plus the inset it sits at. */
  const [topBarHeight, setTopBarHeight] = useState(0);

  // Compartment keys whose storage-type selector is in free-text ("Custom…")
  // mode, so the text input stays visible even while the value is still blank.
  const [customContainerKeys, setCustomContainerKeys] = useState<Set<string>>(new Set());

  // Inline editing: which item key is being renamed inline
  const [inlineEditKey, setInlineEditKey] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Auto-save debounce timer for item edits
  // Keyed by item id, not a single shared timer: a bulk action schedules one
  // save per selected row, and a shared timer made each row cancel the one
  // before it.
  const autoSavePendingRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }>
  >(new Map());
  const autoSaveInFlightRef = useRef<Set<Promise<void>>>(new Set());
  const autoSaveErrorRef = useRef(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apparatus options for the dropdown
  const [apparatusOptions, setApparatusOptions] = useState<
    Array<{ id?: string; name: string; unit_number?: string; apparatus_type: string }>
  >([]);

  useEffect(() => {
    const loadApparatusOptions = async () => {
      try {
        const result = await schedulingService.getApparatusOptions();
        setApparatusOptions(result.options);
      } catch {
        // Non-critical — dropdown will just be empty
      }
    };
    void loadApparatusOptions();
  }, []);

  // ---------------------------------------------------------------------------
  // Load existing template
  // ---------------------------------------------------------------------------

  const loadTemplate = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data: EquipmentCheckTemplate = await schedulingService.getEquipmentCheckTemplate(id);
      setForm({
        name: data.name,
        description: data.description ?? '',
        checkTiming: data.checkTiming,
        templateType: data.templateType ?? 'equipment',
        assignedPositions: data.assignedPositions ?? [],
        apparatusType: data.apparatusType ?? '',
        apparatusId: data.apparatusId ?? '',
        isActive: data.isActive,
      });

      const expanded = new Set<string>();
      const mapped: CompartmentFormState[] = (data.compartments ?? []).map((c) => {
        if (c.id) expanded.add(c.id);
        return {
          clientKey: newCompartmentKey(),
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          imageUrl: c.imageUrl ?? '',
          isHeader: c.isHeader ?? false,
          containerType: c.containerType ?? 'compartment',
          isSealed: c.isSealed ?? false,
          parentCompartmentId: c.parentCompartmentId ?? '',
          items: (c.items ?? []).map((item) => ({
            clientKey: newItemKey(),
            id: item.id,
            name: item.name,
            description: item.description ?? '',
            checkType: item.checkType,
            isRequired: item.isRequired,
            requiredQuantity: item.requiredQuantity != null ? String(Number(item.requiredQuantity)) : '',
            expectedQuantity: item.expectedQuantity != null ? String(Number(item.expectedQuantity)) : '',
            criticalMinimumQuantity:
              item.criticalMinimumQuantity != null ? String(Number(item.criticalMinimumQuantity)) : '',
            minLevel: item.minLevel != null ? String(Number(item.minLevel)) : '',
            levelUnit: item.levelUnit ?? '',
            serialNumber: item.serialNumber ?? '',
            lotNumber: item.lotNumber ?? '',
            inventoryItemId: item.inventoryItemId ?? '',
            hasExpiration: item.hasExpiration,
            expirationDate: item.expirationDate ?? '',
            expirationWarningDays: String(item.expirationWarningDays ?? 30),
            imageUrl: item.imageUrl ?? '',
          })),
        };
      });
      setCompartments(mapped);
      setExpandedCompartments(expanded);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load template'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (templateId) {
      void loadTemplate(templateId);
    }
  }, [templateId, loadTemplate]);

  // ---------------------------------------------------------------------------
  // Unsaved changes warning (browser close + React Router navigation)
  // ---------------------------------------------------------------------------

  useUnsavedChanges({
    hasChanges: isDirty,
    message: 'You have unsaved template changes. Are you sure you want to leave?',
  });

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Template metadata helpers
  // ---------------------------------------------------------------------------

  const updateForm = (patch: Partial<TemplateFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    markDirty();
  };

  const ensureDraftBeforeStructureEdit = useCallback((): Promise<void> => {
    if (!form.isActive || !templateId) return Promise.resolve();
    // The structural endpoint performs the database transition atomically with
    // its mutation. Reflect that contract immediately so navigation warns that
    // the edited checklist must be reviewed and published again.
    setForm((current) => ({ ...current, isActive: false }));
    markDirty();
    return Promise.resolve();
  }, [form.isActive, markDirty, templateId]);

  const togglePosition = (pos: string) => {
    setForm((prev) => {
      const current = prev.assignedPositions;
      const next = current.includes(pos) ? current.filter((p) => p !== pos) : [...current, pos];
      return { ...prev, assignedPositions: next };
    });
  };

  // ---------------------------------------------------------------------------
  // Compartment helpers
  // ---------------------------------------------------------------------------

  const toggleCompartmentExpanded = (key: string) => {
    setExpandedCompartments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  /**
   * Open whichever surface adds an item to this location.
   *
   * The composer is laptop-only and the sheet is phone-only, so "add an item
   * here" is two different elements depending on the width. Both the row's own
   * button and the blocker that names the empty location route through here so
   * they cannot drift apart.
   */
  const openAddSurface = (key: string) => {
    setExpandedCompartments((prev) => new Set(prev).add(key));
    if (!isLaptop) {
      setMobileAddLocations((previous) => new Set(previous).add(key));
      return;
    }
    window.setTimeout(() => document.getElementById(`compose-${key}`)?.focus(), 0);
  };

  const addCompartment = (parentCompartmentId = '') =>
    runAddCompartment(async () => {
      if (!templateId) {
        // For new templates not yet saved, add locally
        const comp = emptyCompartment();
        comp.parentCompartmentId = parentCompartmentId;
        setCompartments((prev) => [...prev, comp]);
        setExpandedCompartments((prev) => new Set(prev).add(comp.clientKey));
        return;
      }

      try {
        const payload: CheckTemplateCompartmentCreate = {
          name: 'New Compartment',
          sort_order: compartments.length,
          container_type: 'compartment',
          ...(parentCompartmentId ? { parent_compartment_id: parentCompartmentId } : {}),
        };
        await ensureDraftBeforeStructureEdit();
        const created = await schedulingService.addCompartment(templateId, payload);
        const comp: CompartmentFormState = {
          clientKey: newCompartmentKey(),
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          imageUrl: created.imageUrl ?? '',
          isHeader: false,
          containerType: created.containerType ?? 'compartment',
          isSealed: created.isSealed ?? false,
          parentCompartmentId: created.parentCompartmentId ?? '',
          items: [],
        };
        setCompartments((prev) => [...prev, comp]);
        setExpandedCompartments((prev) => new Set(prev).add(created.id));
        toast.success('Compartment added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add compartment'));
      }
    });

  const addSectionHeader = () =>
    runAddSection(async () => {
      if (!templateId) {
        const comp: CompartmentFormState = {
          ...emptyCompartment(),
          name: 'Section Header',
          isHeader: true,
        };
        setCompartments((prev) => [...prev, comp]);
        return;
      }

      try {
        const payload: CheckTemplateCompartmentCreate = {
          name: 'Section Header',
          sort_order: compartments.length,
          is_header: true,
        };
        await ensureDraftBeforeStructureEdit();
        const created = await schedulingService.addCompartment(templateId, payload);
        const comp: CompartmentFormState = {
          clientKey: newCompartmentKey(),
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          imageUrl: created.imageUrl ?? '',
          isHeader: true,
          containerType: created.containerType ?? 'compartment',
          isSealed: created.isSealed ?? false,
          parentCompartmentId: created.parentCompartmentId ?? '',
          items: [],
        };
        setCompartments((prev) => [...prev, comp]);
        toast.success('Section header added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add section header'));
      }
    });

  const updateCompartmentField = (idx: number, patch: Partial<CompartmentFormState>) => {
    setCompartments((prev) => {
      const next = [...prev];
      const existing = next[idx];
      if (!existing) return prev;
      next[idx] = { ...existing, ...patch };
      return next;
    });
    markDirty();
  };

  const deleteCompartment = async (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return;

    const itemCount = comp.items.length;
    const label = comp.name || 'Untitled Compartment';
    const msg =
      itemCount > 0
        ? `Delete "${label}" and its ${itemCount} item${itemCount !== 1 ? 's' : ''}? This cannot be undone.`
        : `Delete "${label}"? This cannot be undone.`;
    if (!(await confirm({ title: 'Delete compartment', message: msg, confirmLabel: 'Delete', cancelLabel: 'Keep it' })))
      return;

    if (comp.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.deleteCompartment(comp.id);
        toast.success('Compartment deleted');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to delete compartment'));
        return;
      }
    }
    setCompartments((prev) => prev.filter((_, i) => i !== idx));
    markDirty();
  };

  const duplicateCompartment = async (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return;

    let copy: CompartmentFormState = {
      clientKey: newCompartmentKey(),
      name: `${comp.name} (copy)`,
      description: comp.description,
      imageUrl: comp.imageUrl,
      isHeader: comp.isHeader,
      containerType: comp.containerType,
      isSealed: comp.isSealed,
      parentCompartmentId: comp.parentCompartmentId,
      items: comp.items.map(({ id: _discardId, ...rest }) => ({ ...rest })),
    };
    if (comp.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        copy = compartmentFormFromResponse(await schedulingService.cloneCompartment(comp.id, idx + 1));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to duplicate compartment'));
        return;
      }
    }
    setCompartments((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setExpandedCompartments((prev) => new Set(prev).add(copy.clientKey));
    toast.success(comp.id ? `“${copy.name}” added` : 'Draft compartment duplicated');
    if (!comp.id) markDirty();
  };

  // ---------------------------------------------------------------------------
  // Item helpers
  // ---------------------------------------------------------------------------

  const addHeader = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;

    if (comp.id) {
      try {
        const payload: CheckTemplateItemCreate = {
          name: 'Section Header',
          sort_order: comp.items.length,
          check_type: 'header',
          is_required: false,
        };
        await ensureDraftBeforeStructureEdit();
        const created = await schedulingService.addCheckItem(comp.id, payload);
        const item: ItemFormState = {
          clientKey: newItemKey(),
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          checkType: 'header',
          isRequired: false,
          requiredQuantity: '',
          expectedQuantity: '',
          criticalMinimumQuantity: '',
          minLevel: '',
          levelUnit: '',
          serialNumber: '',
          lotNumber: '',
          hasExpiration: false,
          expirationDate: '',
          expirationWarningDays: '30',
          imageUrl: '',
        };
        updateCompartmentField(compartmentIdx, { items: [...comp.items, item] });
        toast.success('Header added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add header'));
      }
    } else {
      updateCompartmentField(compartmentIdx, {
        items: [...comp.items, { ...emptyItem(), name: 'Section Header', checkType: 'header', isRequired: false }],
      });
    }
  };

  const updateItemField = (compartmentIdx: number, itemIdx: number, patch: Partial<ItemFormState>) => {
    setCompartments((prev) => {
      const next = [...prev];
      const comp = next[compartmentIdx];
      if (!comp) return prev;
      const items = [...comp.items];
      const existing = items[itemIdx];
      if (!existing) return prev;
      items[itemIdx] = { ...existing, ...patch };
      next[compartmentIdx] = { ...comp, items };
      return next;
    });
    markDirty();
  };

  const deleteItem = async (compartmentIdx: number, itemIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const item = comp.items[itemIdx];
    if (!item) return;

    const label = item.name || 'Untitled Item';
    if (
      !(await confirm({
        title: 'Delete item',
        message: `Delete "${label}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;

    if (item.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.deleteCheckItem(item.id);
        toast.success('Item deleted');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to delete item'));
        return;
      }
    }

    const updatedItems = comp.items.filter((_, i) => i !== itemIdx);
    updateCompartmentField(compartmentIdx, { items: updatedItems });
  };

  const duplicateItem = async (compartmentIdx: number, itemIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const item = comp.items[itemIdx];
    if (!item) return;

    let copy: ItemFormState;
    if (comp.id && item.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        const created = await schedulingService.addCheckItem(
          comp.id,
          itemCreateFromForm(item, itemIdx + 1, `${item.name} (copy)`)
        );
        copy = itemFormFromResponse(created);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to duplicate item'));
        return;
      }
    } else {
      const { id: _discardId, ...rest } = item;
      copy = { ...rest, clientKey: newItemKey(), name: `${item.name} (copy)` };
    }
    const updatedItems = [...comp.items];
    updatedItems.splice(itemIdx + 1, 0, copy);
    setCompartments((prev) => {
      const next = [...prev];
      const current = next[compartmentIdx];
      if (!current) return prev;
      const items = [...current.items];
      items.splice(itemIdx + 1, 0, copy);
      next[compartmentIdx] = { ...current, items };
      return next;
    });
    if (comp.id && item.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.reorderItems(
          comp.id,
          updatedItems.map((entry) => entry.id).filter((id): id is string => Boolean(id))
        );
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Item was copied, but its order could not be saved'));
        return;
      }
    }
    toast.success(item.id ? `“${copy.name}” added` : 'Draft item duplicated');
  };

  // ---------------------------------------------------------------------------
  // Move item up/down within a compartment
  // ---------------------------------------------------------------------------

  const moveItem = async (compartmentIdx: number, itemIdx: number, direction: 'up' | 'down') => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const item = comp.items[itemIdx];
    if (!item) return;
    const newIdx = direction === 'up' ? itemIdx - 1 : itemIdx + 1;
    if (newIdx < 0 || newIdx >= comp.items.length) return;

    const applyMove = () =>
      setCompartments((prev) => {
        const next = [...prev];
        const currentCompIdx = next.findIndex((candidate) => candidate.clientKey === comp.clientKey);
        const c = next[currentCompIdx];
        if (!c) return prev;
        const currentItemIdx = c.items.findIndex((candidate) => candidate.clientKey === item.clientKey);
        const targetIdx = direction === 'up' ? currentItemIdx - 1 : currentItemIdx + 1;
        if (currentItemIdx < 0 || targetIdx < 0 || targetIdx >= c.items.length) return prev;
        const items = [...c.items];
        const [moved] = items.splice(currentItemIdx, 1);
        if (!moved) return prev;
        items.splice(targetIdx, 0, moved);
        next[currentCompIdx] = { ...c, items };
        return next;
      });

    if (isEditing && comp.id) {
      const reorderedItems = [...comp.items];
      const [movedItem] = reorderedItems.splice(itemIdx, 1);
      if (movedItem) reorderedItems.splice(newIdx, 0, movedItem);
      const savedIds = reorderedItems.map((item) => item.id).filter((id): id is string => Boolean(id));
      if (savedIds.length > 0) {
        try {
          await ensureDraftBeforeStructureEdit();
          await schedulingService.reorderItems(comp.id, savedIds);
        } catch {
          setExpandedItems((prev) => new Set(prev).add(item.id ?? item.clientKey));
          toast.error(`Could not reorder “${item.name || 'item'}.” Its original order was restored.`);
          return;
        }
      }
    }
    applyMove();
    markDirty();
  };

  const moveItemToCompartment = async (fromCompIdx: number, itemIdx: number, toCompIdx: number) => {
    if (fromCompIdx === toCompIdx) return;
    const fromComp = compartments[fromCompIdx];
    const toComp = compartments[toCompIdx];
    if (!fromComp || !toComp) return;

    const item = fromComp.items[itemIdx];
    if (!item) return;
    const itemKey = item.id ?? item.clientKey;
    const destinationKey = toComp.id ?? toComp.clientKey;

    const persistAndApply = async () => {
      const current = compartmentsRef.current;
      const currentSourceIdx = current.findIndex((candidate) =>
        candidate.items.some((candidateItem) => (candidateItem.id ?? candidateItem.clientKey) === itemKey)
      );
      const currentDestinationIdx = current.findIndex(
        (candidate) => (candidate.id ?? candidate.clientKey) === destinationKey
      );
      const currentSource = current[currentSourceIdx];
      const currentDestination = current[currentDestinationIdx];
      const currentItem = currentSource?.items.find((candidate) => (candidate.id ?? candidate.clientKey) === itemKey);
      if (!currentSource || !currentDestination || !currentItem || currentSourceIdx === currentDestinationIdx) return;

      if (isEditing && currentItem.id && currentDestination.id) {
        try {
          await ensureDraftBeforeStructureEdit();
          await schedulingService.updateCheckItem(currentItem.id, {
            compartment_id: currentDestination.id,
            sort_order: currentDestination.items.length,
          });
        } catch {
          setExpandedItems((prev) => new Set(prev).add(itemKey));
          window.setTimeout(() => document.getElementById(`item-row-${itemKey}`)?.focus());
          toast.error(`Could not move “${currentItem.name || 'item'}.” Its original location was restored.`);
          return;
        }
      }

      setCompartments((prev) => {
        const sourceIdx = prev.findIndex((candidate) =>
          candidate.items.some((candidateItem) => (candidateItem.id ?? candidateItem.clientKey) === itemKey)
        );
        const destinationIdx = prev.findIndex((candidate) => (candidate.id ?? candidate.clientKey) === destinationKey);
        const source = prev[sourceIdx];
        const destination = prev[destinationIdx];
        const movedItem = source?.items.find((candidate) => (candidate.id ?? candidate.clientKey) === itemKey);
        if (!source || !destination || !movedItem || sourceIdx === destinationIdx) return prev;

        const next = [...prev];
        next[sourceIdx] = {
          ...source,
          items: source.items.filter((candidate) => (candidate.id ?? candidate.clientKey) !== itemKey),
        };
        next[destinationIdx] = { ...destination, items: [...destination.items, movedItem] };
        return next;
      });
      // The queue must not calculate the next destination position until
      // React has committed this functional update and refreshed the snapshot.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      markDirty();
      toast.success(`Moved "${currentItem.name || 'item'}" to ${currentDestination.name || 'compartment'}`);
    };

    const queuedMove = itemMoveQueue.current.then(persistAndApply);
    itemMoveQueue.current = queuedMove.catch(() => undefined);
    await queuedMove;
  };

  // ---------------------------------------------------------------------------
  // Move compartment up/down
  // ---------------------------------------------------------------------------

  const moveCompartment = async (idx: number, direction: 'up' | 'down') => {
    const id = compartments[idx]?.id;
    // Unsaved records have no stable identity and therefore cannot be safely
    // represented in the reorder API. Save the template before reordering.
    if (!id) return;
    const reordered = moveCompartmentInTree(compartments, id, direction);
    if (isEditing && templateId) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.reorderCompartments(templateId, orderedCompartmentIds(reordered));
      } catch {
        toast.error('Could not reorder compartment. Its original order was restored.');
        return;
      }
    }
    setCompartments((prev) => moveCompartmentInTree(prev, id, direction));
    markDirty();
  };

  // ---------------------------------------------------------------------------
  // Bulk selection helpers
  // ---------------------------------------------------------------------------

  /**
   * The per-compartment key for expansion, selection and composer state.
   *
   * `clientKey`, not the array index: an index moves when a row above it does,
   * and `addCompartment` expands a new local compartment by its clientKey —
   * which an index-based key never matched, so a location added to an unsaved
   * template opened collapsed with its composer out of reach.
   */
  const getCompKey = (idx: number) => {
    const comp = compartments[idx];
    return comp ? (comp.id ?? comp.clientKey) : `comp-${idx}`;
  };

  const toggleItemSelection = (compartmentIdx: number, itemIdx: number) => {
    const key = getCompKey(compartmentIdx);
    setSelectedItems((prev) => {
      const current = new Set(prev[key] ?? []);
      if (current.has(itemIdx)) {
        current.delete(itemIdx);
      } else {
        current.add(itemIdx);
      }
      return { ...prev, [key]: current };
    });
  };

  const selectAllItems = (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const allIndices = new Set(comp.items.map((_, i) => i));
    setSelectedItems((prev) => ({ ...prev, [key]: allIndices }));
  };

  const deselectAllItems = (compartmentIdx: number) => {
    const key = getCompKey(compartmentIdx);
    setSelectedItems((prev) => ({ ...prev, [key]: new Set<number>() }));
  };

  const setMobileSelectionMode = (compartmentIdx: number, active: boolean) => {
    const key = getCompKey(compartmentIdx);
    setMobileSelectionLocations((previous) => {
      const next = new Set(previous);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!active) deselectAllItems(compartmentIdx);
  };

  const getSelectedCount = (compartmentIdx: number): number => {
    const key = getCompKey(compartmentIdx);
    return selectedItems[key]?.size ?? 0;
  };

  const bulkDeleteIdempotencyKeys = useRef<Record<string, { key: string; payload: string }>>({});

  const deleteSelectedItems = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const selected = selectedItems[key];
    if (!selected || selected.size === 0) return;

    const count = selected.size;
    if (
      !(await confirm({
        title: 'Delete selected items',
        message: `Delete ${count} selected item${count !== 1 ? 's' : ''}? This cannot be undone.`,
        confirmLabel: `Delete ${String(count)}`,
        cancelLabel: 'Keep them',
      }))
    )
      return;

    const itemIds = [...selected].map((itemIdx) => comp.items[itemIdx]?.id).filter((id): id is string => Boolean(id));
    if (!comp.id || itemIds.length !== count) {
      toast.error('Selected items must be saved before they can be deleted');
      return;
    }

    try {
      const payload = JSON.stringify(itemIds);
      const previousRequest = bulkDeleteIdempotencyKeys.current[key];
      const idempotencyKey = previousRequest?.payload === payload ? previousRequest.key : crypto.randomUUID();
      bulkDeleteIdempotencyKeys.current[key] = { key: idempotencyKey, payload };
      await ensureDraftBeforeStructureEdit();
      const result = await schedulingService.deleteCheckItemsBulk(comp.id, itemIds, idempotencyKey);
      const requestedIds = new Set(itemIds);
      const deletedIds = new Set(result.deletedItemIds.filter((itemId) => requestedIds.has(itemId)));
      const remainingItems = comp.items.filter((item) => !item.id || !deletedIds.has(item.id));
      updateCompartmentField(compartmentIdx, {
        items: remainingItems,
      });
      const undeletedIds = new Set(itemIds.filter((itemId) => !deletedIds.has(itemId)));
      setSelectedItems((prev) => ({
        ...prev,
        [key]: new Set(remainingItems.flatMap((item, index) => (item.id && undeletedIds.has(item.id) ? [index] : []))),
      }));
      const deletedCount = deletedIds.size;
      if (deletedCount !== itemIds.length) {
        toast.error(
          `${String(deletedCount)} item${deletedCount !== 1 ? 's were' : ' was'} deleted; ${String(itemIds.length - deletedCount)} could not be deleted`
        );
        return;
      }
      delete bulkDeleteIdempotencyKeys.current[key];
      toast.success(`Deleted ${deletedCount} item${deletedCount !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(getErrorMessage(err, `Could not delete ${count} item${count !== 1 ? 's' : ''}`));
    }
  };

  // ---------------------------------------------------------------------------
  // Quick-add: type a name + Enter to instantly add an item
  // ---------------------------------------------------------------------------

  const [quickAddValues, setQuickAddValues] = useState<Record<string, string>>({});
  const [bulkPasteMode, setBulkPasteMode] = useState<Record<string, boolean>>({});
  const [bulkPasteValues, setBulkPasteValues] = useState<Record<string, string>>({});
  const [showEquipmentPresets, setShowEquipmentPresets] = useState<Record<string, boolean>>({});
  const [bulkItemPending, setBulkItemPending] = useState<Record<string, boolean>>({});
  const bulkIdempotencyKeys = useRef<Record<string, { key: string; payload: string }>>({});
  const quickAddQueues = useRef<Record<string, Promise<void>>>({});
  const quickAddJobs = useRef<Record<string, QuickAddJob>>({});

  interface QuickAddJob {
    clientKey: string;
    compartmentId: string;
    compartmentKey: string;
    payload: CheckTemplateItemCreate;
    idempotencyKey: string;
  }

  const replaceQuickAddItem = (compartmentKey: string, clientKey: string, replacement: ItemFormState | null) => {
    setCompartments((previous) =>
      previous.map((compartment) => {
        if ((compartment.id ?? compartment.clientKey) !== compartmentKey) return compartment;
        return {
          ...compartment,
          items: replacement
            ? compartment.items.map((item) => (item.clientKey === clientKey ? replacement : item))
            : compartment.items.filter((item) => item.clientKey !== clientKey),
        };
      })
    );
  };

  const appendQuickAddItem = (compartmentKey: string, item: ItemFormState) => {
    setCompartments((previous) =>
      previous.map((compartment) =>
        (compartment.id ?? compartment.clientKey) === compartmentKey
          ? { ...compartment, items: [...compartment.items, item] }
          : compartment
      )
    );
    markDirty();
  };

  const runQuickAdd = (job: QuickAddJob) => {
    quickAddJobs.current[job.clientKey] = job;
    replaceQuickAddItem(job.compartmentKey, job.clientKey, {
      ...emptyItem(),
      name: job.payload.name,
      ...(job.payload.inventory_item_id ? { inventoryItemId: job.payload.inventory_item_id } : {}),
      ...(job.payload.check_type ? { checkType: job.payload.check_type as CheckType } : {}),
      ...(job.payload.has_expiration ? { hasExpiration: true } : {}),
      clientKey: job.clientKey,
      saveStatus: 'saving',
    });
    const previous = quickAddQueues.current[job.compartmentKey] ?? Promise.resolve();
    const request = previous.then(async () => {
      try {
        await ensureDraftBeforeStructureEdit();
        const result = await schedulingService.addCheckItemsBulk(job.compartmentId, [job.payload], job.idempotencyKey);
        const created = result.items[0];
        if (!created) throw new Error('The server did not return the saved item');
        replaceQuickAddItem(job.compartmentKey, job.clientKey, itemFormFromResponse(created));
        delete quickAddJobs.current[job.clientKey];
      } catch (err: unknown) {
        replaceQuickAddItem(job.compartmentKey, job.clientKey, {
          ...emptyItem(),
          name: job.payload.name,
          ...(job.payload.inventory_item_id ? { inventoryItemId: job.payload.inventory_item_id } : {}),
          ...(job.payload.check_type ? { checkType: job.payload.check_type as CheckType } : {}),
          ...(job.payload.has_expiration ? { hasExpiration: true } : {}),
          clientKey: job.clientKey,
          saveStatus: 'failed',
        });
        toast.error(getErrorMessage(err, `Failed to add ${job.payload.name}`));
      }
    });
    quickAddQueues.current[job.compartmentKey] = request;
    void request.finally(() => {
      if (quickAddQueues.current[job.compartmentKey] === request) {
        delete quickAddQueues.current[job.compartmentKey];
      }
    });
  };

  const handleQuickAdd = (compartmentIdx: number, payload: CatalogAddPayload) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const name = payload.name.trim();
    if (!name) return;

    setQuickAddValues((prev) => ({ ...prev, [key]: '' }));

    const highlight = (clientKey: string) => {
      setHighlightedItemKeys((previous) => new Set(previous).add(clientKey));
      window.setTimeout(() => {
        document.getElementById(`item-row-${clientKey}`)?.scrollIntoView?.({ block: 'nearest' });
      });
      window.setTimeout(
        () =>
          setHighlightedItemKeys((previous) => {
            const next = new Set(previous);
            next.delete(clientKey);
            return next;
          }),
        1600
      );
    };

    if (comp.id) {
      const createPayload: CheckTemplateItemCreate = {
        name,
        sort_order: comp.items.length,
        // The catalog link travels with the item on the way in. Adding it
        // afterwards is the step that never happened.
        ...(payload.inventoryItemId ? { inventory_item_id: payload.inventoryItemId } : {}),
        ...(payload.checkType ? { check_type: payload.checkType } : {}),
        ...(payload.hasExpiration ? { has_expiration: true } : {}),
      };
      const clientKey = crypto.randomUUID();
      const job: QuickAddJob = {
        clientKey,
        compartmentId: comp.id,
        compartmentKey: key,
        payload: createPayload,
        idempotencyKey: crypto.randomUUID(),
      };
      appendQuickAddItem(key, {
        ...emptyItem(),
        name,
        ...(payload.inventoryItemId ? { inventoryItemId: payload.inventoryItemId } : {}),
        ...(payload.checkType ? { checkType: payload.checkType } : {}),
        ...(payload.hasExpiration ? { hasExpiration: true } : {}),
        clientKey,
        saveStatus: 'saving',
      });
      highlight(clientKey);
      runQuickAdd(job);
    } else {
      const item = {
        ...emptyItem(),
        name,
        ...(payload.inventoryItemId ? { inventoryItemId: payload.inventoryItemId } : {}),
        ...(payload.checkType ? { checkType: payload.checkType } : {}),
        ...(payload.hasExpiration ? { hasExpiration: true } : {}),
      };
      updateCompartmentField(compartmentIdx, {
        items: [...comp.items, item],
      });
      highlight(item.clientKey);
    }
  };

  /**
   * Add a parsed list of names to one location in a single request.
   *
   * `source` distinguishes the two composers that feed it — the phone add
   * sheet's textarea and the canvas composer — so the right one is cleared and
   * the idempotency key of a retried paste stays stable per composer.
   */
  const handleBulkPaste = async (
    compartmentIdx: number,
    options: { source: 'sheet' | 'compose'; checkType?: CheckType } = { source: 'sheet' }
  ) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const raw = options.source === 'compose' ? (composeValues[key] ?? '') : (bulkPasteValues[key] ?? '');
    const text = raw.trim();
    if (!text) return;

    const names = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    // `function` is the stored default, so sending it would be noise on the
    // wire and a difference from the single-add path for no gain.
    const checkType = options.checkType && options.checkType !== 'function' ? options.checkType : undefined;

    if (comp.id) {
      setBulkItemPending((prev) => ({ ...prev, [key]: true }));
      try {
        const payload = names.map((name) => (checkType ? { name, check_type: checkType } : { name }));
        const requestKey = `paste:${key}`;
        const payloadFingerprint = JSON.stringify(payload);
        const previousRequest = bulkIdempotencyKeys.current[requestKey];
        const idempotencyKey =
          previousRequest?.payload === payloadFingerprint ? previousRequest.key : crypto.randomUUID();
        bulkIdempotencyKeys.current[requestKey] = { key: idempotencyKey, payload: payloadFingerprint };
        await ensureDraftBeforeStructureEdit();
        const result = await schedulingService.addCheckItemsBulk(comp.id, payload, idempotencyKey);
        delete bulkIdempotencyKeys.current[requestKey];
        const newItems = result.items.map(itemFormFromResponse);
        updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
        toast.success(`Added ${result.createdCount} item${result.createdCount !== 1 ? 's' : ''}`);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add items'));
        return;
      } finally {
        setBulkItemPending((prev) => ({ ...prev, [key]: false }));
      }
    } else {
      const newItems = names.map((n) => ({ ...emptyItem(), name: n, ...(checkType ? { checkType } : {}) }));
      updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
    }

    if (options.source === 'compose') {
      setComposeValues((prev) => ({ ...prev, [key]: '' }));
      setComposeTypes((prev) => ({ ...prev, [key]: 'function' }));
    } else {
      setBulkPasteValues((prev) => ({ ...prev, [key]: '' }));
      setBulkPasteMode((prev) => ({ ...prev, [key]: false }));
    }
    if (!comp.id) toast.success(`Added ${names.length} item${names.length !== 1 ? 's' : ''}`);
  };

  const addEquipmentPreset = async (compartmentIdx: number, presetKey: string) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const preset = EQUIPMENT_PRESETS[presetKey];
    if (!preset) return;

    const key = getCompKey(compartmentIdx);

    if (comp.id) {
      setBulkItemPending((prev) => ({ ...prev, [key]: true }));
      try {
        const items: CheckTemplateItemCreate[] = [
          {
            name: preset.label,
            check_type: 'header',
            is_required: false,
          },
          ...preset.items.map((presetItem) => ({
            name: presetItem.name,
            check_type: presetItem.checkType,
          })),
        ];
        const requestKey = `preset:${key}:${presetKey}`;
        const payloadFingerprint = JSON.stringify(items);
        const previousRequest = bulkIdempotencyKeys.current[requestKey];
        const idempotencyKey =
          previousRequest?.payload === payloadFingerprint ? previousRequest.key : crypto.randomUUID();
        bulkIdempotencyKeys.current[requestKey] = { key: idempotencyKey, payload: payloadFingerprint };
        await ensureDraftBeforeStructureEdit();
        const result = await schedulingService.addCheckItemsBulk(comp.id, items, idempotencyKey);
        delete bulkIdempotencyKeys.current[requestKey];
        const newItems = result.items.map(itemFormFromResponse);
        updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
        toast.success(`Added ${preset.label} (${result.createdCount} items)`);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add preset items'));
        return;
      } finally {
        setBulkItemPending((prev) => ({ ...prev, [key]: false }));
      }
    } else {
      const headerItem: ItemFormState = {
        ...emptyItem(),
        name: preset.label,
        checkType: 'header',
        isRequired: false,
      };
      const newItems = preset.items.map((pi) => ({
        ...emptyItem(),
        name: pi.name,
        checkType: pi.checkType,
      }));
      updateCompartmentField(compartmentIdx, {
        items: [...comp.items, headerItem, ...newItems],
      });
    }

    setShowEquipmentPresets((prev) => ({ ...prev, [key]: false }));
    if (!comp.id) toast.success(`Added ${preset.label} (${preset.items.length + 1} items)`);
  };

  // ---------------------------------------------------------------------------
  // Bulk edit: change check type or toggle required for selected items
  // ---------------------------------------------------------------------------

  const bulkSetCheckType = (compartmentIdx: number, checkType: CheckType) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const selected = selectedItems[key];
    if (!selected || selected.size === 0) return;

    setCompartments((prev) => {
      const next = [...prev];
      const c = next[compartmentIdx];
      if (!c) return prev;
      const items = c.items.map((item, i) => {
        if (!selected.has(i)) return item;
        return { ...item, checkType };
      });
      next[compartmentIdx] = { ...c, items };
      return next;
    });

    // Auto-save persisted items
    if (isEditing) {
      for (const itemIdx of selected) {
        const item = comp.items[itemIdx];
        if (item?.id) {
          scheduleAutoSaveItem(item.id, { check_type: checkType });
        }
      }
    }
    markDirty();
    toast.success(
      `Set ${selected.size} item${selected.size !== 1 ? 's' : ''} to ${CHECK_TYPES.find((ct) => ct.value === checkType)?.label ?? checkType}`
    );
  };

  const bulkToggleRequired = (compartmentIdx: number, required: boolean) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const selected = selectedItems[key];
    if (!selected || selected.size === 0) return;

    setCompartments((prev) => {
      const next = [...prev];
      const c = next[compartmentIdx];
      if (!c) return prev;
      const items = c.items.map((item, i) => {
        if (!selected.has(i)) return item;
        return { ...item, isRequired: required };
      });
      next[compartmentIdx] = { ...c, items };
      return next;
    });

    if (isEditing) {
      for (const itemIdx of selected) {
        const item = comp.items[itemIdx];
        if (item?.id) {
          scheduleAutoSaveItem(item.id, { is_required: required });
        }
      }
    }
    markDirty();
    toast.success(
      `Set ${selected.size} item${selected.size !== 1 ? 's' : ''} to ${required ? 'required' : 'optional'}`
    );
  };

  // ---------------------------------------------------------------------------
  // Inline rename helpers
  // ---------------------------------------------------------------------------

  const startInlineEdit = (itemKey: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setInlineEditKey(itemKey);
    setInlineEditValue(currentName);
    setTimeout(() => inlineInputRef.current?.select(), 0);
  };

  const commitInlineEdit = (compartmentIdx: number, itemIdx: number) => {
    if (inlineEditKey === null) return;
    const trimmed = inlineEditValue.trim();
    if (trimmed) {
      updateItemField(compartmentIdx, itemIdx, { name: trimmed });
    }
    setInlineEditKey(null);
    setInlineEditValue('');
  };

  const cancelInlineEdit = () => {
    setInlineEditKey(null);
    setInlineEditValue('');
  };

  // ---------------------------------------------------------------------------
  // Auto-save: debounced save of a single item when in edit mode
  // ---------------------------------------------------------------------------

  const scheduleAutoSaveItem = useCallback(
    (itemId: string, patch: Record<string, unknown>) => {
      if (!isEditing || !itemId) return;

      const pending = autoSavePendingRef.current.get(itemId);
      if (pending) clearTimeout(pending.timer);
      // Merge rather than replace, so two edits to different fields of the same
      // row inside the debounce window both survive.
      const merged = { ...(pending?.patch ?? {}), ...patch };

      if (autoSaveFadeRef.current) {
        clearTimeout(autoSaveFadeRef.current);
      }
      if (autoSavePendingRef.current.size === 0 && autoSaveInFlightRef.current.size === 0) {
        autoSaveErrorRef.current = false;
      }
      setAutoSaveStatus('saving');

      const timer = setTimeout(() => {
        autoSavePendingRef.current.delete(itemId);
        const request: Promise<void> = ensureDraftBeforeStructureEdit()
          .then(() => schedulingService.updateCheckItem(itemId, merged))
          .then(() => undefined)
          .catch(() => {
            autoSaveErrorRef.current = true;
          })
          .finally(() => {
            autoSaveInFlightRef.current.delete(request);
            // Report only once the whole batch has settled; a per-item "saved"
            // would flicker through every row a bulk action touched.
            if (autoSaveInFlightRef.current.size === 0 && autoSavePendingRef.current.size === 0) {
              const failed = autoSaveErrorRef.current;
              setAutoSaveStatus(failed ? 'error' : 'saved');
              autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), failed ? 4000 : 2000);
            }
          });
        autoSaveInFlightRef.current.add(request);
      }, 1500);

      autoSavePendingRef.current.set(itemId, { timer, patch: merged });
    },
    [ensureDraftBeforeStructureEdit, isEditing]
  );

  // Enhanced updateItemField that triggers auto-save for persisted items
  const updateItemFieldWithAutoSave = (compartmentIdx: number, itemIdx: number, patch: Partial<ItemFormState>) => {
    updateItemField(compartmentIdx, itemIdx, patch);

    const comp = compartments[compartmentIdx];
    const item = comp?.items[itemIdx];
    if (item?.id) {
      // Update path: a cleared field must travel as an explicit null. Omitting
      // it means "leave alone" to the backend's exclude_unset dump, which is
      // why unlinking an inventory item or wiping an expiration date used to
      // report success and change nothing. `name` and `expiration_warning_days`
      // stay `|| undefined` — they are NOT NULL columns with no cleared state.
      const apiPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) apiPatch.name = patch.name || undefined;
      if (patch.description !== undefined) apiPatch.description = blankToNull(patch.description);
      if (patch.checkType !== undefined) apiPatch.check_type = patch.checkType;
      if (patch.isRequired !== undefined) apiPatch.is_required = patch.isRequired;
      if (patch.requiredQuantity !== undefined) apiPatch.required_quantity = numberOrNull(patch.requiredQuantity);
      if (patch.expectedQuantity !== undefined) apiPatch.expected_quantity = numberOrNull(patch.expectedQuantity);
      if (patch.criticalMinimumQuantity !== undefined)
        apiPatch.critical_minimum_quantity = numberOrNull(patch.criticalMinimumQuantity);
      if (patch.minLevel !== undefined) apiPatch.min_level = numberOrNull(patch.minLevel);
      if (patch.levelUnit !== undefined) apiPatch.level_unit = blankToNull(patch.levelUnit);
      if (patch.serialNumber !== undefined) apiPatch.serial_number = blankToNull(patch.serialNumber);
      if (patch.lotNumber !== undefined) apiPatch.lot_number = blankToNull(patch.lotNumber);
      if (patch.inventoryItemId !== undefined) apiPatch.inventory_item_id = blankToNull(patch.inventoryItemId);
      if (patch.hasExpiration !== undefined) apiPatch.has_expiration = patch.hasExpiration;
      if (patch.expirationDate !== undefined) apiPatch.expiration_date = blankToNull(patch.expirationDate);
      if (patch.expirationWarningDays !== undefined)
        apiPatch.expiration_warning_days = patch.expirationWarningDays
          ? Number(patch.expirationWarningDays)
          : undefined;
      if (patch.imageUrl !== undefined) apiPatch.image_url = blankToNull(patch.imageUrl);

      if (Object.keys(apiPatch).length > 0) {
        scheduleAutoSaveItem(item.id, apiPatch);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async (publish: boolean) => {
    for (const { timer } of autoSavePendingRef.current.values()) clearTimeout(timer);
    autoSavePendingRef.current.clear();
    if (autoSaveInFlightRef.current.size > 0) await Promise.all([...autoSaveInFlightRef.current]);
    // Drafts deliberately bypass readiness checks; publication never does.
    // Keep the blocking rules aligned with the backend instead of putting them
    // in the overridable warning dialog below.
    if (publish && !publishReady) return;
    const warnings: string[] = [];
    for (const comp of compartments) {
      if (comp.isHeader) continue;
      for (const item of comp.items) {
        if (item.hasExpiration && !item.expirationDate.trim()) {
          warnings.push(`"${item.name || 'Untitled'}" has expiration enabled but no date set.`);
        }
        if (
          item.checkType === 'count' &&
          item.criticalMinimumQuantity &&
          item.expectedQuantity &&
          Number(item.criticalMinimumQuantity) >= Number(item.expectedQuantity)
        ) {
          warnings.push(`"${item.name || 'Untitled'}" has critical minimum >= expected quantity.`);
        }
        if (item.checkType === 'expiry' && !item.serialNumber && !item.lotNumber) {
          warnings.push(`"${item.name || 'Untitled'}" is a date/lot check but has no serial or lot number.`);
        }
      }
    }
    if (publish && warnings.length > 0) {
      const proceed = await confirm({
        title: 'Save with warnings?',
        message: `${warnings.join('\n\n')}\n\nYou can save anyway and fix these later.`,
        confirmLabel: 'Save anyway',
        cancelLabel: 'Go back',
        variant: 'warning',
      });
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const compartmentPayloads: CheckTemplateCompartmentCreate[] = compartments
        .filter((c) => !c.id) // Only include unsaved compartments in create payload
        .map((c, idx) => ({
          name: c.name,
          description: c.description.trim() || undefined,
          sort_order: idx,
          image_url: c.imageUrl.trim() || undefined,
          is_header: c.isHeader || undefined,
          container_type: c.containerType || undefined,
          is_sealed: c.isSealed,
          parent_compartment_id: c.parentCompartmentId || undefined,
          items: c.items.map((item, itemIdx) => ({
            name: item.name,
            description: item.description.trim() || undefined,
            sort_order: itemIdx,
            check_type: item.checkType,
            is_required: item.isRequired,
            required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
            expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
            critical_minimum_quantity: item.criticalMinimumQuantity ? Number(item.criticalMinimumQuantity) : undefined,
            min_level: item.minLevel ? Number(item.minLevel) : undefined,
            level_unit: item.levelUnit.trim() || undefined,
            serial_number: item.serialNumber.trim() || undefined,
            lot_number: item.lotNumber.trim() || undefined,
            inventory_item_id: item.inventoryItemId || undefined,
            image_url: item.imageUrl.trim() || undefined,
            has_expiration: item.hasExpiration,
            expiration_date: item.expirationDate.trim() || undefined,
            expiration_warning_days: item.expirationWarningDays ? Number(item.expirationWarningDays) : undefined,
          })),
        }));

      if (isEditing && templateId) {
        await schedulingService.updateEquipmentCheckTemplate(templateId, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          check_timing: form.checkTiming,
          template_type: form.templateType,
          assigned_positions: form.assignedPositions.length > 0 ? form.assignedPositions : undefined,
          apparatus_type: form.apparatusType || undefined,
          apparatus_id: form.apparatusId || undefined,
          is_active: false,
        });

        // Save any new compartments that haven't been persisted yet
        for (const payload of compartmentPayloads) {
          await ensureDraftBeforeStructureEdit();
          await schedulingService.addCompartment(templateId, payload);
        }

        // Update existing compartments and items in parallel
        const updatePromises: Promise<unknown>[] = [];
        for (const comp of compartments) {
          if (comp.id) {
            updatePromises.push(
              schedulingService.updateCompartment(comp.id, {
                name: comp.name,
                description: comp.description.trim() || undefined,
                image_url: comp.imageUrl.trim() || undefined,
                is_header: comp.isHeader,
                container_type: comp.containerType || undefined,
                is_sealed: comp.isSealed,
                parent_compartment_id: comp.parentCompartmentId || undefined,
              })
            );

            for (const item of comp.items) {
              if (item.id) {
                updatePromises.push(
                  schedulingService.updateCheckItem(item.id, {
                    name: item.name,
                    description: item.description.trim() || undefined,
                    check_type: item.checkType,
                    is_required: item.isRequired,
                    required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
                    expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
                    critical_minimum_quantity: item.criticalMinimumQuantity
                      ? Number(item.criticalMinimumQuantity)
                      : undefined,
                    min_level: item.minLevel ? Number(item.minLevel) : undefined,
                    level_unit: item.levelUnit.trim() || undefined,
                    serial_number: item.serialNumber.trim() || undefined,
                    lot_number: item.lotNumber.trim() || undefined,
                    inventory_item_id: item.inventoryItemId || undefined,
                    image_url: item.imageUrl.trim() || undefined,
                    has_expiration: item.hasExpiration,
                    expiration_date: item.expirationDate.trim() || undefined,
                    expiration_warning_days: item.expirationWarningDays
                      ? Number(item.expirationWarningDays)
                      : undefined,
                  })
                );
              }
            }
          }
        }
        await Promise.all(updatePromises);

        if (publish) {
          await schedulingService.updateEquipmentCheckTemplate(templateId, { is_active: true });
        }
        setForm((current) => ({ ...current, isActive: publish }));
        setIsDirty(false);
        toast.success(publish ? 'Template published' : 'Draft saved');
      } else {
        const createPayload: EquipmentCheckTemplateCreate = {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          check_timing: form.checkTiming,
          template_type: form.templateType,
          assigned_positions: form.assignedPositions.length > 0 ? form.assignedPositions : undefined,
          apparatus_type: form.apparatusType || undefined,
          apparatus_id: form.apparatusId || undefined,
          is_active: publish,
          compartments: compartments.map((c, idx) => ({
            name: c.name,
            description: c.description.trim() || undefined,
            sort_order: idx,
            image_url: c.imageUrl.trim() || undefined,
            is_header: c.isHeader || undefined,
            container_type: c.containerType || undefined,
            is_sealed: c.isSealed,
            parent_compartment_id: c.parentCompartmentId || undefined,
            items: c.items.map((item, itemIdx) => ({
              name: item.name,
              description: item.description.trim() || undefined,
              sort_order: itemIdx,
              check_type: item.checkType,
              is_required: item.isRequired,
              required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
              expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
              critical_minimum_quantity: item.criticalMinimumQuantity
                ? Number(item.criticalMinimumQuantity)
                : undefined,
              min_level: item.minLevel ? Number(item.minLevel) : undefined,
              level_unit: item.levelUnit.trim() || undefined,
              serial_number: item.serialNumber.trim() || undefined,
              lot_number: item.lotNumber.trim() || undefined,
              inventory_item_id: item.inventoryItemId || undefined,
              image_url: item.imageUrl.trim() || undefined,
              has_expiration: item.hasExpiration,
              expiration_date: item.expirationDate.trim() || undefined,
              expiration_warning_days: item.expirationWarningDays ? Number(item.expirationWarningDays) : undefined,
            })),
          })),
        };
        const created = await schedulingService.createEquipmentCheckTemplate(createPayload);
        setIsDirty(false);
        toast.success(publish ? 'Template published' : 'Draft saved');
        // Navigate to edit mode so subsequent saves work as updates
        void navigate(`/scheduling/equipment-check-templates/${created.id}`, { replace: true });
        return;
      }

      // Re-fetch the template to sync local state with server
      if (isEditing && templateId) {
        void loadTemplate(templateId);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save template'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Vehicle Preset Loader
  // ---------------------------------------------------------------------------

  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [showChangelog, setShowChangelog] = useState(false);
  const [showInventoryMatch, setShowInventoryMatch] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<
    Array<{
      id: string;
      userName: string;
      action: string;
      entityType: string;
      entityName?: string;
      changes?: Record<string, unknown>;
      createdAt?: string;
    }>
  >([]);
  const [changelogTotal, setChangelogTotal] = useState(0);
  const [changelogLoading, setChangelogLoading] = useState(false);

  const loadChangelog = useCallback(async () => {
    if (!templateId) return;
    setChangelogLoading(true);
    try {
      const result = await schedulingService.getTemplateChangelog(templateId, { limit: 50 });
      setChangelogEntries(result.items);
      setChangelogTotal(result.total);
    } catch {
      toast.error('Failed to load change log');
    } finally {
      setChangelogLoading(false);
    }
  }, [templateId]);

  const loadVehiclePreset = async (presetKey: string) => {
    const preset = VEHICLE_PRESETS[presetKey];
    if (!preset) return;

    const newCompartments: CompartmentFormState[] = preset.compartments.map((comp) => ({
      clientKey: newCompartmentKey(),
      name: comp.name,
      description: '',
      imageUrl: '',
      isHeader: false,
      containerType: 'compartment',
      // A vehicle preset describes compartments, not sealed kits; a department
      // that carries a sealed bag marks it after loading the preset.
      isSealed: false,
      parentCompartmentId: '',
      items: comp.items.map((item) => ({
        ...emptyItem(),
        name: item.name,
        description: item.description ?? '',
        checkType: item.checkType,
      })),
    }));

    if (compartments.length > 0) {
      if (
        !(await confirm({
          title: 'Replace this template\u2019s contents?',
          message: 'Loading a preset discards every compartment and item currently on this template.',
          confirmLabel: 'Load preset',
          cancelLabel: 'Keep what I have',
          variant: 'warning',
        }))
      )
        return;
    }

    setCompartments(newCompartments);
    setShowPresetPicker(false);
    // Expand all new compartments
    const expanded = new Set<string>();
    newCompartments.forEach((c) => expanded.add(c.id ?? c.clientKey));
    setExpandedCompartments(expanded);
    toast.success(`Loaded ${preset.label} vehicle check preset`);
  };

  // ---------------------------------------------------------------------------
  // Clone template
  // ---------------------------------------------------------------------------

  const handleClone = async () => {
    if (!templateId) return;
    setCloning(true);
    try {
      const cloned = await schedulingService.cloneEquipmentCheckTemplate(templateId, '');
      setIsDirty(false);
      toast.success('Template cloned');
      void navigate(`/scheduling/equipment-check-templates/${cloned.id}`, { replace: true });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to clone template'));
    } finally {
      setCloning(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Template Export / Import
  // ---------------------------------------------------------------------------

  const exportTemplateJson = () => {
    const data = {
      name: form.name,
      description: form.description,
      checkTiming: form.checkTiming,
      templateType: form.templateType,
      apparatusType: form.apparatusType,
      compartments: compartments.map((c) => ({
        name: c.name,
        description: c.description,
        isHeader: c.isHeader || undefined,
        containerType: c.containerType || undefined,
        isSealed: c.isSealed,
        items: c.items.map((item) => ({
          name: item.name,
          description: item.description,
          checkType: item.checkType,
          isRequired: item.isRequired,
          requiredQuantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
          criticalMinimumQuantity: item.criticalMinimumQuantity ? Number(item.criticalMinimumQuantity) : undefined,
          minLevel: item.minLevel ? Number(item.minLevel) : undefined,
          levelUnit: item.levelUnit || undefined,
          serialNumber: item.serialNumber || undefined,
          lotNumber: item.lotNumber || undefined,
          hasExpiration: item.hasExpiration,
          expirationDate: item.expirationDate || undefined,
          expirationWarningDays: item.expirationWarningDays ? Number(item.expirationWarningDays) : 30,
          imageUrl: item.imageUrl || undefined,
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(form.name || 'template').replace(/\s+/g, '_').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template exported');
  };

  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportTemplate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as {
          name?: string;
          description?: string;
          checkTiming?: string;
          templateType?: string;
          apparatusType?: string;
          compartments?: Array<{
            name: string;
            description?: string;
            isHeader?: boolean;
            containerType?: string;
            isSealed?: boolean;
            items?: Array<Record<string, unknown>>;
          }>;
        };

        if (!data.compartments || !Array.isArray(data.compartments)) {
          toast.error('Invalid template file: missing compartments');
          return;
        }

        if (compartments.length > 0) {
          if (
            !(await confirm({
              title: 'Replace this template\u2019s contents?',
              message: 'Importing discards every compartment and item currently on this template.',
              confirmLabel: 'Import',
              cancelLabel: 'Keep what I have',
              variant: 'warning',
            }))
          )
            return;
        }

        if (data.name)
          setForm((prev) => ({
            ...prev,
            name: data.name ?? prev.name,
            description: data.description ?? prev.description,
          }));

        const imported: CompartmentFormState[] = data.compartments.map((c) => ({
          clientKey: newCompartmentKey(),
          name: c.name || 'Untitled',
          description: c.description ?? '',
          imageUrl: '',
          isHeader: Boolean(c.isHeader),
          containerType: c.containerType || 'compartment',
          isSealed: Boolean(c.isSealed),
          parentCompartmentId: '',
          items: (c.items ?? []).map((item) => ({
            ...emptyItem(),
            name: (item.name as string) || '',
            description: (item.description as string) ?? '',
            checkType: normalizeCheckType(item.checkType as string),
            isRequired: Boolean(item.isRequired),
            requiredQuantity: item.requiredQuantity != null ? String(Number(item.requiredQuantity)) : '',
            expectedQuantity: item.expectedQuantity != null ? String(Number(item.expectedQuantity)) : '',
            criticalMinimumQuantity:
              item.criticalMinimumQuantity != null ? String(Number(item.criticalMinimumQuantity)) : '',
            minLevel: item.minLevel != null ? String(Number(item.minLevel)) : '',
            levelUnit: (item.levelUnit as string) ?? '',
            serialNumber: (item.serialNumber as string) ?? '',
            lotNumber: (item.lotNumber as string) ?? '',
            hasExpiration: Boolean(item.hasExpiration),
            expirationDate: (item.expirationDate as string) ?? '',
            expirationWarningDays:
              item.expirationWarningDays != null ? String(Number(item.expirationWarningDays)) : '30',
            imageUrl: (item.imageUrl as string) ?? '',
          })),
        }));

        setCompartments(imported);
        const expanded = new Set<string>();
        imported.forEach((c) => expanded.add(c.id ?? c.clientKey));
        setExpandedCompartments(expanded);
        markDirty();
        toast.success(`Imported ${imported.length} compartment(s)`);
      } catch {
        toast.error('Failed to parse template file');
      }
    };
    reader.readAsText(file);
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const csvImportRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<
    | {
        compartment: string;
        name: string;
        checkType: string;
        expectedQty: string;
        criticalMin: string;
        levelUnit: string;
      }[]
    | null
  >(null);
  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(showChangelog || Boolean(csvPreview) || showPreview || drawerOpen);

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        // Header-driven rather than positional: a department that reorders
        // columns or adds one is not writing a broken file, and the old
        // fixed-index reader silently mapped whatever landed in slot 3 to the
        // quantity.
        const { rows: records } = parseCsvRecords(text);
        if (records.length === 0) {
          toast.error('CSV file must have a header row and at least one data row');
          return;
        }

        const rows = records.map((record) => ({
          compartment: csvValue(record, 'compartment', 'container', 'location'),
          name: csvValue(record, 'name', 'item', 'item name'),
          checkType: csvValue(record, 'check type', 'type') || 'function',
          expectedQty: csvValue(record, 'expected qty', 'expected quantity', 'quantity', 'qty', 'par'),
          criticalMin: csvValue(record, 'critical min', 'critical minimum', 'minimum'),
          levelUnit: csvValue(record, 'level unit', 'unit'),
        }));

        if (rows.every((r) => !r.name)) {
          toast.error('CSV must have a "Name" column identifying each item');
          return;
        }

        setCsvPreview(rows);
      } catch {
        toast.error('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
    if (csvImportRef.current) csvImportRef.current.value = '';
  };

  /** Back out of the builder, checking first if there is unsaved work. */
  const handleLeave = async () => {
    if (
      isDirty &&
      !(await confirm({
        title: 'Leave without saving?',
        message: 'This template has changes that have not been saved. Leaving now discards them.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Stay here',
        variant: 'warning',
      }))
    )
      return;
    void navigate(-1);
  };

  const applyCsvImport = async () => {
    if (!csvPreview) return;

    if (compartments.length > 0) {
      if (
        !(await confirm({
          title: 'Replace this template\u2019s contents?',
          message: 'Importing this CSV discards every compartment and item currently on this template.',
          confirmLabel: 'Import CSV',
          cancelLabel: 'Keep what I have',
          variant: 'warning',
        }))
      )
        return;
    }

    const compMap = new Map<string, ItemFormState[]>();
    for (const row of csvPreview) {
      const compName = row.compartment || 'Uncategorized';
      if (!compMap.has(compName)) compMap.set(compName, []);
      // A department's existing CSV still says "pass_fail" or "present".
      // Accept the old vocabulary and normalize it, rather than rejecting a
      // file that was valid last week.
      const checkType = normalizeCheckType(row.checkType);
      compMap.get(compName)?.push({
        ...emptyItem(),
        name: row.name,
        checkType,
        expectedQuantity: row.expectedQty,
        requiredQuantity: row.expectedQty,
        criticalMinimumQuantity: row.criticalMin,
        levelUnit: row.levelUnit,
      });
    }

    const imported: CompartmentFormState[] = Array.from(compMap.entries()).map(([name, items]) => ({
      clientKey: newCompartmentKey(),
      name,
      description: '',
      imageUrl: '',
      isHeader: false,
      containerType: 'compartment',
      isSealed: false,
      parentCompartmentId: '',
      items,
    }));

    setCompartments(imported);
    const expanded = new Set<string>();
    imported.forEach((c) => expanded.add(c.id ?? c.clientKey));
    setExpandedCompartments(expanded);
    setCsvPreview(null);
    setIsDirty(true);
    toast.success(`Imported ${imported.length} compartment(s) with ${csvPreview.length} item(s) from CSV`);
    // Imported rows are names on a page, not catalog links. Saying so here is
    // what stops a template looking finished while tracking nothing — the
    // "linked" count in the toolbar is the follow-up.
    if (templateId) {
      toast('Save, then use “Link to inventory” to connect these to your catalog', { icon: '🔗' });
    }
  };

  // ---------------------------------------------------------------------------
  // Collapse / expand all compartments
  // ---------------------------------------------------------------------------

  const expandAllCompartments = () => {
    const all = new Set<string>();
    compartments.forEach((c) => all.add(c.id ?? c.clientKey));
    setExpandedCompartments(all);
  };

  const collapseAllCompartments = () => {
    setExpandedCompartments(new Set());
  };

  const toggleItemExpanded = (itemKey: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Preview: build a mock EquipmentCheckTemplate from current form state
  // ---------------------------------------------------------------------------

  const buildPreviewTemplate = useCallback((): EquipmentCheckTemplate => {
    return {
      id: templateId ?? 'preview',
      organizationId: '',
      name: form.name || 'Untitled Template',
      ...(form.description ? { description: form.description } : {}),
      checkTiming: form.checkTiming,
      templateType: form.templateType,
      ...(form.assignedPositions.length > 0 ? { assignedPositions: form.assignedPositions } : {}),
      ...(form.apparatusType ? { apparatusType: form.apparatusType } : {}),
      ...(form.apparatusId ? { apparatusId: form.apparatusId } : {}),
      isActive: form.isActive,
      sortOrder: 0,
      contentRevision: 0,
      compartments: compartments.map((c, cIdx) => ({
        id: c.id ?? `preview-comp-${c.clientKey}`,
        templateId: templateId ?? 'preview',
        name: c.name || 'Untitled Compartment',
        ...(c.description ? { description: c.description } : {}),
        sortOrder: cIdx,
        ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
        ...(c.isHeader ? { isHeader: true } : {}),
        containerType: c.containerType || 'compartment',
        isSealed: c.isSealed,
        ...(c.parentCompartmentId ? { parentCompartmentId: c.parentCompartmentId } : {}),
        items: c.items.map((item, iIdx): CheckTemplateItem => ({
          id: item.id ?? `preview-item-${item.clientKey}`,
          compartmentId: c.id ?? `preview-comp-${c.clientKey}`,
          name: item.name || 'Untitled Item',
          ...(item.description ? { description: item.description } : {}),
          sortOrder: iIdx,
          checkType: item.checkType,
          isRequired: item.isRequired,
          ...(item.requiredQuantity ? { requiredQuantity: Number(item.requiredQuantity) } : {}),
          ...(item.expectedQuantity ? { expectedQuantity: Number(item.expectedQuantity) } : {}),
          ...(item.criticalMinimumQuantity ? { criticalMinimumQuantity: Number(item.criticalMinimumQuantity) } : {}),
          ...(item.minLevel ? { minLevel: Number(item.minLevel) } : {}),
          ...(item.levelUnit ? { levelUnit: item.levelUnit } : {}),
          ...(item.serialNumber ? { serialNumber: item.serialNumber } : {}),
          ...(item.lotNumber ? { lotNumber: item.lotNumber } : {}),
          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
          hasExpiration: item.hasExpiration,
          ...(item.expirationDate ? { expirationDate: item.expirationDate } : {}),
          expirationWarningDays: item.expirationWarningDays ? Number(item.expirationWarningDays) : 30,
        })),
      })),
    };
  }, [form, compartments, templateId]);

  /**
   * A fingerprint of what the crew preview *asks*, not what it says.
   *
   * The docked preview never unmounts while the canvas is edited, so
   * `EquipmentCheckForm` keeps the answers a viewer typed into it. Keyed on
   * this, it resets when an item is added, removed, reordered or given a
   * different check type — and keeps them while a name or a threshold is
   * being typed, which is the edit an author makes while watching it.
   */
  const previewStructureKey = useMemo(
    () =>
      compartments
        .map((c) => `${c.clientKey}:${c.items.map((i) => `${i.clientKey}.${i.checkType}`).join(',')}`)
        .join('|'),
    [compartments]
  );

  // ---------------------------------------------------------------------------
  // Template stats
  // ---------------------------------------------------------------------------

  const stats = useMemo(() => {
    const realCompartments = compartments.filter((c) => !c.isHeader);
    const allItems = realCompartments.flatMap((c) => c.items);
    return {
      compartmentCount: realCompartments.length,
      totalItems: allItems.length,
      requiredItems: allItems.filter((i) => i.isRequired).length,
    };
  }, [compartments]);

  useEffect(() => {
    const bar = topBarRef.current;
    if (!bar) return;
    const updateHeight = () => {
      // Between 640px and 767px the rail renders while the bar is itself
      // pushed down by the fixed mobile header, so the bar's height alone is
      // not where it ends. Its resolved sticky `top` is exactly that inset.
      const stickyTop = Number.parseFloat(window.getComputedStyle(bar).top);
      setTopBarHeight(bar.getBoundingClientRect().height + (Number.isFinite(stickyTop) ? stickyTop : 0));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bar);
    // The inset is a breakpoint, not a size, so crossing 768px can leave the
    // bar's own box unchanged; listen for the resize as well.
    window.addEventListener('resize', updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
    // Loading swaps the whole editor for a spinner, so the bar this observed is
    // gone by the time a template has loaded; re-attach to the new one.
  }, [loading]);

  useEffect(() => {
    const bar = actionBarRef.current;
    if (!bar) {
      setActionBarHeight(0);
      return;
    }
    const updateHeight = () => setActionBarHeight(bar.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bar);
    return () => observer.disconnect();
    // The bar's presence depends on the breakpoint as well as the item count,
    // so a resize across it must re-attach the observer.
  }, [stats.totalItems, isLaptop]);

  /**
   * How much of this template is wired to the inventory catalog.
   *
   * Derived from what is on screen rather than fetched, so it stays honest
   * while the template is being edited — adding an unlinked item should move
   * the number immediately, not after a save and a reload. Mirrors the
   * backend's rule: a header is a caption and an unnamed row cannot be matched
   * against anything, so neither counts against coverage.
   */
  const coverage = useMemo<LinkCoverage>(() => {
    const items = compartments
      .filter((c) => !c.isHeader)
      .flatMap((c) => c.items)
      .filter((i) => i.checkType !== 'header' && i.name.trim());
    const linked = items.filter((i) => Boolean(i.inventoryItemId)).length;
    return { linkable: items.length, linked, unlinked: items.length - linked };
  }, [compartments]);

  // ---------------------------------------------------------------------------
  // Drag & Drop
  // ---------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const compartmentKey = useCallback((comp: CompartmentFormState, _flatIdx: number) => comp.id ?? comp.clientKey, []);

  // Canonical depth-first display order is shared with reorder persistence.
  const orderedCompartments = useMemo(
    () =>
      buildOrderedCompartments(compartments).map(({ node, depth }) => ({
        comp: node,
        idx: compartments.indexOf(node),
        depth,
      })),
    [compartments]
  );

  // Only persisted records are draggable: backing-array positions are not
  // identities, and cannot produce a safe ordered_ids API payload.
  const compartmentIds = useMemo(
    () => orderedCompartments.flatMap(({ comp }) => (comp.id ? [comp.id] : [])),
    [orderedCompartments]
  );

  const compartmentPath = useCallback(
    (targetIdx: number) => {
      const names: string[] = [];
      const visited = new Set<number>();
      let currentIdx: number | undefined = targetIdx;
      while (currentIdx !== undefined && !visited.has(currentIdx)) {
        visited.add(currentIdx);
        const current: CompartmentFormState | undefined = compartments[currentIdx];
        if (!current) break;
        names.unshift(current.name.trim() || `Untitled ${containerTypeLabel(current.containerType)}`);
        currentIdx = current.parentCompartmentId
          ? compartments.findIndex((candidate) => candidate.id === current.parentCompartmentId)
          : undefined;
        if (currentIdx === -1) currentIdx = undefined;
      }
      return names.join(' / ');
    },
    [compartments]
  );

  /**
   * Nesting by indent/outdent rather than by a "stored inside" select.
   *
   * The select asked the author to name a parent out of a flat list of every
   * other location; the two buttons ask the same question of the row directly
   * above, which is where the answer already is on screen. The underlying
   * `parentCompartmentId` is unchanged either way — as is its persistence,
   * which rides the next save like every other compartment field.
   */
  const indentTargetId = useCallback(
    (comp: CompartmentFormState): string | undefined => {
      if (comp.isHeader) return undefined;
      const position = orderedCompartments.findIndex(({ comp: candidate }) => candidate.clientKey === comp.clientKey);
      if (position < 0) return undefined;
      const depth = orderedCompartments[position]?.depth ?? 0;
      for (let cursor = position - 1; cursor >= 0; cursor -= 1) {
        const entry = orderedCompartments[cursor];
        if (!entry || entry.depth < depth) return undefined;
        if (entry.depth !== depth) continue;
        // A section header is a caption in the list, not a container.
        if (entry.comp.isHeader) return undefined;
        // Only a persisted row can be named as a parent: the id is the link.
        return entry.comp.id;
      }
      return undefined;
    },
    [orderedCompartments]
  );

  const canIndentCompartment = (comp: CompartmentFormState) => {
    const target = indentTargetId(comp);
    if (!target) return false;
    return storedInsideOptions(compartments, comp).some((option) => option.id === target);
  };

  const indentCompartment = (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return;
    const target = indentTargetId(comp);
    if (!target || !canIndentCompartment(comp)) return;
    updateCompartmentField(idx, { parentCompartmentId: target });
  };

  const outdentCompartment = (idx: number) => {
    const comp = compartments[idx];
    if (!comp?.parentCompartmentId) return;
    const parent = compartments.find((candidate) => candidate.id === comp.parentCompartmentId);
    updateCompartmentField(idx, { parentCompartmentId: parent?.parentCompartmentId ?? '' });
  };

  const handleCompartmentDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // reorderCompartment rejects cross-parent drops. Dragging a parent moves
    // its subtree because the returned array is canonical depth-first order.
    const reordered = reorderCompartment(compartments, activeId, overId);
    if (isEditing && templateId) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.reorderCompartments(templateId, orderedCompartmentIds(reordered));
      } catch {
        toast.error('Could not reorder compartment. Its original order was restored.');
        return;
      }
    }
    setCompartments((prev) => reorderCompartment(prev, activeId, overId));
    markDirty();
  };

  const handleItemDragEnd = async (compIdx: number, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const comp = compartments[compIdx];
    if (!comp) return;

    const itemIds = comp.items.map((item) => item.id ?? item.clientKey);
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedItems = [...comp.items];
    const [movedItem] = reorderedItems.splice(oldIndex, 1);
    if (!movedItem) return;
    reorderedItems.splice(newIndex, 0, movedItem);
    if (isEditing && comp.id) {
      const savedIds = reorderedItems.map((item) => item.id).filter((id): id is string => Boolean(id));
      if (savedIds.length > 0) {
        try {
          await ensureDraftBeforeStructureEdit();
          await schedulingService.reorderItems(comp.id, savedIds);
        } catch {
          setExpandedItems((prev) => new Set(prev).add(movedItem.id ?? movedItem.clientKey));
          toast.error(`Could not reorder “${movedItem.name || 'item'}.” Its original order was restored.`);
          return;
        }
      }
    }
    setCompartments((prev) => {
      const next = [...prev];
      const currentCompIdx = next.findIndex((candidate) => candidate.clientKey === comp.clientKey);
      const c = next[currentCompIdx];
      if (!c) return prev;
      const currentOldIndex = c.items.findIndex((candidate) => (candidate.id ?? candidate.clientKey) === active.id);
      const currentNewIndex = c.items.findIndex((candidate) => (candidate.id ?? candidate.clientKey) === over.id);
      if (currentOldIndex < 0 || currentNewIndex < 0) return prev;
      const items = [...c.items];
      const [moved] = items.splice(currentOldIndex, 1);
      if (!moved) return prev;
      items.splice(currentNewIndex, 0, moved);
      next[currentCompIdx] = { ...c, items };
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Item Row
  // ---------------------------------------------------------------------------

  const renderItemEditorFields = (compIdx: number, itemIdx: number, item: ItemFormState, isHeader: boolean) => (
    <div className="space-y-3">
      <h3 className="text-theme-text-primary text-sm font-semibold sm:hidden">Essentials</h3>
      {/* Name + Description */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{isHeader ? 'Header Title' : 'Name'}</label>
          <input
            type="text"
            className={inputClass}
            placeholder={isHeader ? 'e.g. Medical Supplies' : 'Item name'}
            value={item.name}
            onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { name: e.target.value })}
          />
        </div>
        <div className="hidden sm:block">
          <label className={labelClass}>{isHeader ? 'Subtitle' : 'Description'}</label>
          <input
            type="text"
            className={inputClass}
            placeholder={isHeader ? 'Optional subtitle shown below the header' : 'Optional description'}
            value={item.description}
            onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { description: e.target.value })}
          />
        </div>
      </div>

      {!isHeader && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Check Type */}
            <div>
              <label className={labelClass}>Check Type</label>
              <select
                className={selectClass}
                value={item.checkType}
                onChange={(e) =>
                  updateItemFieldWithAutoSave(compIdx, itemIdx, {
                    checkType: e.target.value as ItemFormState['checkType'],
                  })
                }
              >
                {CHECK_TYPES.map((ct) => (
                  <option key={ct.value} value={ct.value}>
                    {ct.label}
                    {CHECK_TYPE_STORES[ct.value as keyof typeof CHECK_TYPE_STORES]
                      ? ` — ${CHECK_TYPE_STORES[ct.value as keyof typeof CHECK_TYPE_STORES]}`
                      : ''}
                  </option>
                ))}
              </select>
              {CHECK_TYPE_HELP[item.checkType] && (
                <p className="text-theme-text-muted mt-1 text-[10px] leading-tight">
                  {CHECK_TYPE_HELP[item.checkType]}
                </p>
              )}
            </div>

            {/* Required */}
            <div className="flex items-end pb-2">
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={item.isRequired}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { isRequired: e.target.checked })}
                />
                Required
              </label>
            </div>

            {(item.checkType === 'count' || item.checkType === 'level' || item.checkType === 'expiry') && (
              <h3 className="text-theme-text-primary border-theme-surface-border border-t pt-4 text-sm font-semibold sm:hidden">
                Check settings
              </h3>
            )}

            {/* Conditional: Quantity */}
            {item.checkType === 'count' && (
              <>
                <div>
                  <label className={labelClass}>Expected Qty</label>
                  <p className="text-theme-text-secondary mb-1 text-xs">How many should be on the apparatus</p>
                  <input
                    type="number"
                    className={inputClass}
                    min="0"
                    placeholder="0"
                    value={item.expectedQuantity}
                    onChange={(e) =>
                      updateItemFieldWithAutoSave(compIdx, itemIdx, { expectedQuantity: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Min to Pass</label>
                  <p className="text-theme-text-secondary mb-1 text-xs">Below this count = auto-fail</p>
                  <input
                    type="number"
                    className={inputClass}
                    min="0"
                    placeholder="0"
                    value={item.requiredQuantity}
                    onChange={(e) =>
                      updateItemFieldWithAutoSave(compIdx, itemIdx, { requiredQuantity: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-red-500" />
                    Critical Min
                  </label>
                  <p className="text-theme-text-secondary mb-1 text-xs">Below this = urgent alert to leadership</p>
                  <input
                    type="number"
                    className={inputClass}
                    min="0"
                    placeholder="0"
                    value={item.criticalMinimumQuantity}
                    onChange={(e) =>
                      updateItemFieldWithAutoSave(compIdx, itemIdx, { criticalMinimumQuantity: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {/* Conditional: Level */}
            {item.checkType === 'level' && (
              <>
                <div>
                  <label className={labelClass}>Min Level</label>
                  <input
                    type="number"
                    className={inputClass}
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={item.minLevel}
                    onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { minLevel: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Unit</label>
                  <div className="flex gap-1.5">
                    <select
                      className={selectClass}
                      value={
                        LEVEL_UNIT_PRESETS.includes(item.levelUnit as (typeof LEVEL_UNIT_PRESETS)[number])
                          ? item.levelUnit
                          : '__custom__'
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== '__custom__') {
                          updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: val });
                        }
                      }}
                    >
                      {LEVEL_UNIT_PRESETS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                    {!LEVEL_UNIT_PRESETS.includes(item.levelUnit as (typeof LEVEL_UNIT_PRESETS)[number]) && (
                      <input
                        type="text"
                        className={inputClass}
                        placeholder="Custom unit"
                        value={item.levelUnit}
                        onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: e.target.value })}
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Conditional: Serial/Lot */}
            {(item.checkType === 'expiry' || item.checkType === 'count') && (
              <>
                <div>
                  <label className={labelClass}>Serial #</label>
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    type="text"
                    className={inputClass}
                    placeholder="Serial number"
                    value={item.serialNumber}
                    onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { serialNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Lot #</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Lot number"
                    value={item.lotNumber}
                    onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { lotNumber: e.target.value })}
                  />
                </div>
              </>
            )}

            {/* Image URL */}
            <div className="hidden sm:block">
              <label className={labelClass}>
                <Image className="mr-1 inline h-3.5 w-3.5" />
                Image URL
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="https://..."
                value={item.imageUrl}
                onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { imageUrl: e.target.value })}
              />
            </div>
          </div>

          <h3 className="text-theme-text-primary border-theme-surface-border border-t pt-4 text-sm font-semibold sm:hidden">
            Inventory and expiration
          </h3>

          {/* Inventory link — connects to the catalog for ready-stock + swaps */}
          <div>
            <label className={labelClass}>
              <Package className="mr-1 inline h-3.5 w-3.5" />
              Linked Inventory Item
            </label>
            <InventoryItemPicker
              value={item.inventoryItemId || undefined}
              onChange={(id) => updateItemFieldWithAutoSave(compIdx, itemIdx, { inventoryItemId: id ?? '' })}
            />
            <p className="text-theme-text-muted mt-1 text-[11px]">
              Link to track replacement stock and enable lot swaps during checks.
            </p>
          </div>

          {/* Expiration row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={item.hasExpiration}
                onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { hasExpiration: e.target.checked })}
              />
              <AlertTriangle className="h-3.5 w-3.5" />
              Has Expiration
            </label>
            {item.hasExpiration && (
              <>
                <div>
                  <label className={labelClass}>Expiration Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={item.expirationDate}
                    onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Warning Days</label>
                  <input
                    type="number"
                    className={inputClass}
                    min="0"
                    placeholder="30"
                    value={item.expirationWarningDays}
                    onChange={(e) =>
                      updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationWarningDays: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          </div>

          <details className="border-theme-surface-border border-t pt-1 sm:hidden">
            <summary className="text-theme-text-primary flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Optional details
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="space-y-3 pb-2">
              <div>
                <label className={labelClass}>Description</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Optional description"
                  value={item.description}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { description: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>
                  <Image className="mr-1 inline h-3.5 w-3.5" />
                  Image URL
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="https://..."
                  value={item.imageUrl}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { imageUrl: e.target.value })}
                />
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );

  /**
   * One item, edited in place.
   *
   * Everything a crew member will be asked — the name, the kind of answer, and
   * the one number that answer is graded against — is on the row itself. The
   * disclosure below it holds only what a template rarely sets (description,
   * serial and lot, image, critical minimum, the catalog link) so that opening
   * it is never a prerequisite for a complete item.
   */
  const renderItem = (
    compIdx: number,
    itemIdx: number,
    item: ItemFormState,
    dragHandleProps?: Record<string, unknown>,
    totalItems?: number
  ) => {
    const itemKey = item.id ?? item.clientKey;
    const anchorId = `item-row-${itemKey}`;
    const isItemExpanded = expandedItems.has(itemKey);
    const checkTypeLabel = CHECK_TYPES.find((ct) => ct.value === item.checkType)?.label ?? item.checkType;
    const compKey = getCompKey(compIdx);
    const isSelected = selectedItems[compKey]?.has(itemIdx) ?? false;
    const isMobileSelectionMode = !isLaptop && mobileSelectionLocations.has(compKey);
    const isInlineEditing = inlineEditKey === itemKey;
    const itemCount = totalItems ?? compartments[compIdx]?.items.length ?? 0;

    const isHeader = item.checkType === 'header';
    const isStructural = isHeader || item.checkType === 'text';
    const isFlagged = blockerAnchorIds.has(anchorId);

    if (item.saveStatus) {
      return (
        <div
          key={itemKey}
          className="border-theme-surface-border bg-theme-surface flex min-h-12 items-center gap-3 rounded-md border px-3 py-2"
          aria-label={`${item.name} ${item.saveStatus === 'saving' ? 'Saving' : 'Not saved'}`}
        >
          {item.saveStatus === 'saving' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          )}
          <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
          <span
            className={`text-xs ${item.saveStatus === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted'}`}
          >
            {item.saveStatus === 'saving' ? 'Saving…' : 'Not saved'}
          </span>
          {item.saveStatus === 'failed' && item.clientKey && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                onClick={() => {
                  const job = quickAddJobs.current[item.clientKey ?? ''];
                  if (job) runQuickAdd(job);
                }}
              >
                Retry
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                onClick={() => {
                  delete quickAddJobs.current[item.clientKey ?? ''];
                  replaceQuickAddItem(compKey, item.clientKey ?? '', null);
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      );
    }

    const itemActionsMenu = (
      <RowActionMenu label={`Actions for ${item.name.trim() || 'item'}`}>
        <button
          type="button"
          className={mobileMenuItemClass}
          onClick={(e) => {
            if (isLaptop) {
              window.setTimeout(() => document.getElementById(`item-name-${itemKey}`)?.focus(), 0);
              return;
            }
            startInlineEdit(itemKey, item.name, e);
          }}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" /> Rename
        </button>
        <button
          type="button"
          className={mobileMenuItemClass}
          disabled={itemIdx === 0}
          onClick={() => void moveItem(compIdx, itemIdx, 'up')}
        >
          <ChevronUp className="h-4 w-4" aria-hidden="true" /> Move up
        </button>
        <button
          type="button"
          className={mobileMenuItemClass}
          disabled={itemIdx === itemCount - 1}
          onClick={() => void moveItem(compIdx, itemIdx, 'down')}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" /> Move down
        </button>
        <button type="button" className={mobileMenuItemClass} onClick={() => void duplicateItem(compIdx, itemIdx)}>
          <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate
        </button>
        {compartments.filter(
          (candidate, candidateIdx) =>
            !candidate.isHeader && candidateIdx !== compIdx && (!isEditing || !item.id || Boolean(candidate.id))
        ).length > 0 && (
          <label className={`${mobileMenuItemClass} flex-col items-stretch gap-1`}>
            <span className="flex items-center gap-3">
              <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Move to compartment
            </span>
            <select
              className="form-input min-h-[44px] text-sm"
              value={compIdx}
              aria-label={`Move ${item.name || 'item'} to compartment; current destination ${compartmentPath(compIdx)}`}
              onChange={(e) => void moveItemToCompartment(compIdx, itemIdx, Number(e.target.value))}
            >
              <option value={compIdx} disabled>
                Current: {compartmentPath(compIdx)}
              </option>
              {compartments.map((candidate, candidateIdx) =>
                !candidate.isHeader && candidateIdx !== compIdx && (!isEditing || !item.id || Boolean(candidate.id)) ? (
                  <option key={candidate.id ?? candidateIdx} value={candidateIdx}>
                    {compartmentPath(candidateIdx)}
                  </option>
                ) : null
              )}
            </select>
          </label>
        )}
        <button
          type="button"
          className={mobileDestructiveMenuItemClass}
          onClick={() => void deleteItem(compIdx, itemIdx)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
        </button>
      </RowActionMenu>
    );

    // Phones keep the compact row and the full-height editor sheet: the canvas
    // row below puts four controls side by side, which is a laptop and tablet
    // affordance and cannot be tapped accurately at 375px.
    if (!isLaptop) {
      return (
        <div
          key={itemKey}
          id={anchorId}
          tabIndex={-1}
          className={`rounded-md border transition-colors ${
            highlightedItemKeys.has(item.clientKey)
              ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20'
              : isSelected
                ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/10'
                : isFlagged
                  ? 'border-amber-500/50 bg-amber-500/[0.06]'
                  : 'border-theme-surface-border bg-theme-surface'
          }`}
        >
          <div className="flex items-center gap-1.5 px-2">
            {isMobileSelectionMode && (
              <button
                type="button"
                className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center"
                onClick={() => toggleItemSelection(compIdx, itemIdx)}
                aria-label={`${item.name.trim() || 'Item'} selection checkbox`}
              >
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                ) : (
                  <Square className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}
            {isInlineEditing ? (
              <input
                ref={inlineInputRef}
                type="text"
                className="text-theme-text-primary focus:ring-theme-focus-ring min-h-[44px] min-w-0 flex-1 rounded-sm border-b border-blue-400 bg-transparent px-1 text-sm font-medium outline-none focus:ring-2"
                value={inlineEditValue}
                onChange={(e) => setInlineEditValue(e.target.value)}
                onBlur={() => commitInlineEdit(compIdx, itemIdx)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitInlineEdit(compIdx, itemIdx);
                  if (e.key === 'Escape') cancelInlineEdit();
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={`min-h-[44px] min-w-0 flex-1 py-2 text-left text-sm ${isHeader ? 'text-theme-text-primary font-bold' : item.name.trim() ? 'text-theme-text-primary font-medium' : 'text-theme-text-muted italic'}`}
                onClick={() => {
                  if (isMobileSelectionMode) {
                    toggleItemSelection(compIdx, itemIdx);
                  } else {
                    setMobileEditor({
                      compartmentKey: compartments[compIdx]?.clientKey ?? '',
                      itemKey: item.clientKey,
                    });
                  }
                }}
                aria-label={
                  isMobileSelectionMode
                    ? `${isSelected ? 'Deselect' : 'Select'} ${item.name.trim() || 'item'}`
                    : `Edit ${item.name.trim() || 'item'}`
                }
              >
                <span className="block truncate">
                  {item.name.trim() || (isHeader ? 'Untitled Header' : 'Untitled Item')}
                </span>
                <span className="text-theme-text-muted mt-0.5 block truncate text-xs font-normal">
                  {checkTypeLabel}
                  {item.checkType === 'count' && item.expectedQuantity ? ` · Par ${item.expectedQuantity}` : ''}
                  {item.checkType === 'level' && item.minLevel
                    ? ` · Minimum ${item.minLevel}${item.levelUnit ? ` ${item.levelUnit}` : ''}`
                    : ''}
                  {item.isRequired ? ' · Required' : ''}
                  {item.hasExpiration ? ' · Expiration tracked' : ''}
                </span>
              </button>
            )}
            {itemActionsMenu}
          </div>
        </div>
      );
    }

    const settingLabelClass = 'text-theme-text-muted text-[11px] whitespace-nowrap';
    const numberInputClass =
      'border-theme-input-border bg-theme-input-bg text-theme-text-primary focus:border-blue-400 rounded-md border px-1.5 py-1 text-center text-[13px] tabular-nums outline-none';

    return (
      <div
        key={itemKey}
        id={anchorId}
        tabIndex={-1}
        className={`border-theme-surface-border/40 border-b last:border-b-0 ${
          highlightedItemKeys.has(item.clientKey)
            ? 'bg-blue-50 dark:bg-blue-900/20'
            : isSelected
              ? 'bg-blue-50/50 dark:bg-blue-900/10'
              : isFlagged
                ? 'rounded-sm border-l-[3px] border-l-amber-500 bg-amber-500/[0.06] pl-2'
                : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 py-1.5">
          <button
            type="button"
            className="text-theme-text-muted/60 hover:text-theme-text-muted flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Drag ${item.name.trim() || 'item'} to reorder`}
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex-shrink-0 p-0.5"
            onClick={() => toggleItemSelection(compIdx, itemIdx)}
            aria-label={`${item.name.trim() || 'Item'} selection checkbox`}
          >
            {isSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            ) : (
              <Square className="text-theme-text-muted/60 hover:text-theme-text-muted h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          {isStructural && <Type className="text-theme-text-muted h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}

          <input
            id={`item-name-${itemKey}`}
            type="text"
            aria-label={isHeader ? 'Header title' : 'Item name'}
            className={`text-theme-text-primary placeholder:text-theme-text-muted box-border min-w-[132px] shrink grow-0 basis-[200px] rounded-md border bg-transparent px-1.5 py-1.5 text-sm outline-none focus:border-blue-400 2xl:basis-[240px] ${
              item.name.trim()
                ? 'hover:border-theme-surface-border border-transparent'
                : 'bg-theme-input-bg border-amber-500'
            } ${isStructural ? 'font-bold' : 'font-medium'}`}
            placeholder={isHeader ? 'Name this section…' : 'Name this item…'}
            value={item.name}
            onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { name: e.target.value })}
          />

          {isStructural ? (
            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-[11px] font-medium">
              {isHeader ? 'Section header' : 'Instruction'}
            </span>
          ) : (
            <div
              role="group"
              aria-label={`Check type for ${item.name.trim() || 'item'}`}
              className="bg-theme-surface-secondary grid min-w-[150px] shrink grow-0 basis-[168px] grid-cols-4 gap-0.5 rounded-lg p-0.5 2xl:basis-[220px]"
            >
              {CANVAS_CHECK_TYPES.map(({ value, label, Icon }) => {
                const active = item.checkType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateItemFieldWithAutoSave(compIdx, itemIdx, { checkType: value })}
                    title={CHECK_TYPE_HELP[value]}
                    className={`flex min-h-7 items-center justify-center gap-1 rounded-md text-[11px] transition-colors ${
                      active
                        ? 'bg-theme-surface text-theme-text-primary font-semibold shadow-sm'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    <Icon className="hidden h-3.5 w-3.5 2xl:block" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* One group so the row wraps as a unit — splitting it would leave a
              lone delete icon dangling on a line of its own. */}
          <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
            {item.checkType === 'count' && (
              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <span className={settingLabelClass}>Par</span>
                <input
                  type="number"
                  min="0"
                  id={`item-par-${itemKey}`}
                  aria-label={`Par quantity for ${item.name.trim() || 'item'}`}
                  className={`${numberInputClass} w-14`}
                  value={item.expectedQuantity}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expectedQuantity: e.target.value })}
                />
                <span className={settingLabelClass}>min</span>
                <input
                  type="number"
                  min="0"
                  aria-label={`Minimum quantity for ${item.name.trim() || 'item'}`}
                  className={`${numberInputClass} w-14`}
                  value={item.requiredQuantity}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { requiredQuantity: e.target.value })}
                />
              </div>
            )}
            {item.checkType === 'level' && (
              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <span
                  className={
                    item.minLevel.trim()
                      ? settingLabelClass
                      : 'text-[11px] font-semibold text-amber-700 dark:text-amber-400'
                  }
                >
                  Min needed
                </span>
                <input
                  type="number"
                  min="0"
                  id={`item-min-level-${itemKey}`}
                  aria-label={`Minimum level for ${item.name.trim() || 'item'}`}
                  className={`${numberInputClass} w-16 ${item.minLevel.trim() ? '' : 'border-amber-500'}`}
                  value={item.minLevel}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { minLevel: e.target.value })}
                />
                <select
                  aria-label={`Level unit for ${item.name.trim() || 'item'}`}
                  className="border-theme-input-border bg-theme-input-bg text-theme-text-secondary rounded-md border px-1 py-1 text-[11px]"
                  value={item.levelUnit}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: e.target.value })}
                >
                  <option value="">unit</option>
                  {LEVEL_UNIT_PRESETS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {item.checkType === 'expiry' && (
              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <span className={settingLabelClass}>Warn</span>
                <input
                  type="number"
                  min="0"
                  aria-label={`Expiration warning days for ${item.name.trim() || 'item'}`}
                  className={`${numberInputClass} w-14`}
                  value={item.expirationWarningDays}
                  onChange={(e) =>
                    updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationWarningDays: e.target.value })
                  }
                />
                <span className={settingLabelClass}>days ahead</span>
              </div>
            )}

            {!isStructural && (
              <button
                type="button"
                aria-pressed={item.isRequired}
                onClick={() => updateItemFieldWithAutoSave(compIdx, itemIdx, { isRequired: !item.isRequired })}
                className={`min-h-6.5 min-w-[68px] shrink-0 rounded-full border px-2 text-[11px] transition-colors ${
                  item.isRequired
                    ? 'border-red-600/30 bg-red-600/[0.08] font-semibold text-red-700 dark:text-red-400'
                    : 'border-theme-surface-border bg-theme-surface text-theme-text-muted'
                }`}
              >
                {item.isRequired ? 'Required' : 'Optional'}
              </button>
            )}

            {!isStructural && (
              <button
                type="button"
                onClick={() => toggleItemExpanded(itemKey)}
                title={
                  item.inventoryItemId
                    ? 'Linked to inventory — open item settings to change it'
                    : 'Not linked to inventory'
                }
                aria-label={`${item.inventoryItemId ? 'Linked to inventory' : 'Not linked to inventory'} — ${item.name.trim() || 'item'}`}
                className={`flex min-h-6.5 w-[30px] shrink-0 items-center justify-center rounded-md border ${
                  item.inventoryItemId
                    ? 'border-theme-surface-border bg-theme-surface text-green-700 dark:text-green-400'
                    : 'border-theme-surface-border text-theme-text-muted/70 border-dashed'
                }`}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleItemExpanded(itemKey)}
              aria-expanded={isItemExpanded}
              aria-label={`${isItemExpanded ? 'Hide' : 'Show'} more settings for ${item.name.trim() || 'item'}`}
              className="text-theme-text-muted/70 hover:text-theme-text-primary shrink-0 p-0.5"
            >
              {isItemExpanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void deleteItem(compIdx, itemIdx)}
              aria-label={`Delete ${item.name || 'item'}`}
              className="text-theme-text-muted/70 shrink-0 p-0.5 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {itemActionsMenu}
          </div>
        </div>

        {isItemExpanded && (
          <div className="border-theme-surface-border bg-theme-surface-secondary/40 mb-2 rounded-md border px-3 py-3">
            {renderItemEditorFields(compIdx, itemIdx, item, isHeader)}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Compartment Card
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Render: Sortable Item Wrapper
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Render: Compartment
  // ---------------------------------------------------------------------------

  /**
   * One row of the canvas: a section heading, or a location and its items.
   *
   * Sections, locations and items are all rows in the same list, in the order
   * a crew walks them. Nesting is shown by indentation and an "inside <parent>"
   * label rather than by a select that asks the author to re-name a parent
   * already on screen two rows up.
   */
  const renderCompartment = (
    comp: CompartmentFormState,
    idx: number,
    dragHandleProps?: Record<string, unknown>,
    sortableRef?: React.Ref<HTMLDivElement>,
    sortableStyle?: React.CSSProperties,
    sortableAttributes?: DraggableAttributes,
    depth = 0
  ) => {
    const key = comp.id ?? comp.clientKey;
    const anchorId = `comp-row-${comp.id ?? comp.clientKey}`;
    const isExpanded = expandedCompartments.has(key);
    const typeLabel = containerTypeLabel(comp.containerType);
    const parentName = comp.parentCompartmentId
      ? compartments.find((c) => c.id === comp.parentCompartmentId)?.name
      : undefined;
    const isFlagged = blockerAnchorIds.has(anchorId);
    const indentPadding = depth > 0 ? { paddingLeft: 16 + depth * 18 } : undefined;

    if (comp.isHeader) {
      // Sections are siblings rather than parents in the data model, so a
      // section's scope is everything between it and the next section.
      const order = orderedCompartments;
      const position = order.findIndex(({ comp: candidate }) => candidate.clientKey === comp.clientKey);
      let childCount = 0;
      for (let cursor = position + 1; cursor >= 0 && cursor < order.length; cursor += 1) {
        const entry = order[cursor];
        if (!entry || entry.comp.isHeader) break;
        childCount += 1;
      }
      return (
        <div
          key={key}
          id={anchorId}
          ref={sortableRef}
          style={sortableStyle}
          {...(sortableAttributes ?? {})}
          className={`bg-theme-surface-secondary border-theme-surface-border flex items-center gap-2.5 border-b px-4 py-2.5 ${
            isFlagged ? 'border-l-[3px] border-l-amber-500 bg-amber-500/[0.06]' : ''
          }`}
        >
          <button
            type="button"
            className="text-theme-text-muted/70 hover:text-theme-text-muted flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing disabled:cursor-not-allowed"
            aria-label={comp.id ? 'Drag to reorder section among siblings' : 'Save before dragging this section'}
            disabled={!comp.id}
            title={!comp.id ? 'Save before dragging unsaved records' : 'Reorder among sibling sections'}
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Type className="text-theme-text-muted h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <input
            id={`comp-name-${key}`}
            type="text"
            aria-label="Section heading"
            className="text-theme-text-secondary placeholder:text-theme-text-muted min-w-[140px] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[11px] font-bold tracking-[0.1em] uppercase outline-none focus:border-blue-400"
            placeholder="Section heading…"
            value={comp.name}
            onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
          />
          <span className="text-theme-text-muted flex-shrink-0 text-[11px]">
            {childCount} location{childCount !== 1 ? 's' : ''}
          </span>
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => void moveCompartment(idx, 'up')}
              disabled={!canMoveCompartment(compartments, comp.id, 'up')}
              className="text-theme-text-muted/70 hover:text-theme-text-primary mobile-touch-target rounded p-1 disabled:opacity-30 sm:min-h-0 sm:min-w-0"
              aria-label="Move section up"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void moveCompartment(idx, 'down')}
              disabled={!canMoveCompartment(compartments, comp.id, 'down')}
              className="text-theme-text-muted/70 hover:text-theme-text-primary mobile-touch-target rounded p-1 disabled:opacity-30 sm:min-h-0 sm:min-w-0"
              aria-label="Move section down"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void deleteCompartment(idx)}
              className="text-theme-text-muted/70 mobile-touch-target rounded p-1 hover:text-red-600 sm:min-h-0 sm:min-w-0"
              aria-label="Delete section header"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      );
    }

    const requiredCount = comp.items.filter((i) => i.isRequired).length;
    const answerableCount = comp.items.filter(
      (item) => item.checkType !== 'header' && item.checkType !== 'text'
    ).length;
    const isEmpty = answerableCount === 0;
    const inCustomContainer = customContainerKeys.has(key) || !isPresetContainerType(comp.containerType);
    const composeValue = composeValues[key] ?? '';
    const composeLines = composeValue
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const composeType = composeTypes[key] ?? 'function';
    const selectedCount = getSelectedCount(idx);

    return (
      <div key={key} ref={sortableRef} style={sortableStyle} {...(sortableAttributes ?? {})}>
        {/* Location row */}
        <div
          id={anchorId}
          tabIndex={-1}
          style={indentPadding}
          className={`border-theme-surface-border relative flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b px-4 py-3 ${
            isEmpty || isFlagged ? 'border-l-[3px] border-l-amber-500 bg-amber-500/[0.06]' : ''
          }`}
        >
          {depth > 0 && (
            <span
              aria-hidden="true"
              className="bg-theme-surface-border absolute top-0 bottom-0 w-0.5"
              style={{ left: 12 + depth * 18 - 22 }}
            />
          )}
          <button
            type="button"
            className="text-theme-text-muted/70 hover:text-theme-text-muted flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing disabled:cursor-not-allowed"
            aria-label={
              comp.id ? 'Drag to reorder compartment among siblings' : 'Save before dragging this compartment'
            }
            disabled={!comp.id}
            title={!comp.id ? 'Save before dragging unsaved records' : 'Reorder among sibling compartments'}
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => toggleCompartmentExpanded(key)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${comp.name || `Untitled ${typeLabel}`}`}
            className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target flex-shrink-0 p-0.5 sm:min-h-0 sm:min-w-0"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <Package
            className={`h-4 w-4 flex-shrink-0 ${depth > 0 ? 'text-violet-600 dark:text-violet-400' : 'text-blue-700 dark:text-blue-400'}`}
            aria-hidden="true"
          />

          <input
            id={`comp-name-${key}`}
            type="text"
            aria-label="Location name"
            className={`text-theme-text-primary placeholder:text-theme-text-muted min-w-0 grow basis-[200px] rounded-md border bg-transparent px-1.5 py-1 font-semibold outline-none focus:border-blue-400 sm:min-w-[112px] sm:basis-[112px] ${
              depth > 0 ? 'text-sm' : 'text-[15px]'
            } ${comp.name.trim() ? 'hover:border-theme-surface-border border-transparent' : 'bg-theme-input-bg border-amber-500'}`}
            placeholder={`Name this ${typeLabel.toLowerCase()}…`}
            value={comp.name}
            onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
          />

          {parentName && (
            <span className="text-theme-text-muted max-w-[160px] flex-shrink truncate text-[11px]">
              inside {parentName}
            </span>
          )}

          <select
            aria-label="Storage type"
            className="border-theme-surface-border bg-theme-surface text-theme-text-muted flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px]"
            value={inCustomContainer ? '__custom__' : comp.containerType || 'compartment'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') {
                setCustomContainerKeys((prev) => new Set(prev).add(key));
                updateCompartmentField(idx, { containerType: '' });
              } else {
                setCustomContainerKeys((prev) => {
                  const next = new Set(prev);
                  next.delete(key);
                  return next;
                });
                updateCompartmentField(idx, { containerType: v });
              }
            }}
          >
            {CONTAINER_TYPE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>

          {inCustomContainer && (
            <input
              type="text"
              className="border-theme-input-border bg-theme-input-bg text-theme-text-primary w-32 flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] outline-none focus:border-blue-400"
              placeholder="e.g. Trauma Kit"
              aria-label="Custom storage type label"
              value={comp.containerType}
              onChange={(e) => updateCompartmentField(idx, { containerType: e.target.value })}
            />
          )}

          {/* A sealed container's contents cannot change while it sits shut, so
              the long explanation belongs on hover rather than on the row. */}
          <label
            className="text-theme-text-muted flex flex-shrink-0 items-center gap-1.5 text-[11px]"
            title="A crew that finds the seal intact and matching the last count clears every presence and quantity check inside in one tap. Expiry dates and readings still have to be checked."
          >
            <input
              type="checkbox"
              className="form-checkbox h-3.5 w-3.5"
              checked={comp.isSealed}
              onChange={(e) => updateCompartmentField(idx, { isSealed: e.target.checked })}
            />
            Sealed
          </label>

          {!isLaptop && isExpanded && (
            <button
              type="button"
              aria-label={`Add item to ${comp.name || 'location'}`}
              className="flex min-h-[44px] shrink-0 items-center gap-1 px-2 text-sm font-semibold text-blue-600 dark:text-blue-400"
              onClick={() => setMobileAddLocations((previous) => new Set(previous).add(key))}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add
            </button>
          )}

          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
            {isEmpty ? (
              <>
                <span className="flex-shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Add at least one item to publish
                </span>
                <button
                  type="button"
                  onClick={() => openAddSurface(key)}
                  className="flex min-h-7.5 flex-shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add items
                </button>
              </>
            ) : (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {comp.items.length} item{comp.items.length !== 1 ? 's' : ''}
              </span>
            )}
            {requiredCount > 0 && (
              <span className="flex-shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                {requiredCount} req
              </span>
            )}

            <div className="hidden flex-shrink-0 items-center gap-0.5 sm:flex">
              <button
                type="button"
                onClick={() => indentCompartment(idx)}
                disabled={!canIndentCompartment(comp)}
                className="text-theme-text-muted/70 hover:text-theme-text-primary mobile-touch-target rounded p-1 disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                aria-label={`Nest ${comp.name || 'location'} inside the location above`}
                title="Nest inside the location above"
              >
                <Indent className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => outdentCompartment(idx)}
                disabled={!comp.parentCompartmentId}
                className="text-theme-text-muted/70 hover:text-theme-text-primary mobile-touch-target rounded p-1 disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                aria-label={`Move ${comp.name || 'location'} out one level`}
                title="Move out one level"
              >
                <Outdent className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void deleteCompartment(idx)}
                className="text-theme-text-muted/70 mobile-touch-target rounded p-1 hover:text-red-600 sm:min-h-0 sm:min-w-0"
                aria-label={`Delete ${comp.name || 'compartment'}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <RowActionMenu label={`Actions for ${comp.name || 'compartment'}`}>
              <button
                type="button"
                className={mobileMenuItemClass}
                onClick={() => {
                  setExpandedCompartments((previous) => new Set(previous).add(key));
                  window.setTimeout(() => document.getElementById(`comp-name-${key}`)?.focus());
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" /> Rename
              </button>
              <button type="button" className={mobileMenuItemClass} onClick={() => void duplicateCompartment(idx)}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate
              </button>
              <button
                type="button"
                className={mobileMenuItemClass}
                disabled={!canMoveCompartment(compartments, comp.id, 'up')}
                onClick={() => void moveCompartment(idx, 'up')}
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" /> Move up
              </button>
              <button
                type="button"
                className={mobileMenuItemClass}
                disabled={!canMoveCompartment(compartments, comp.id, 'down')}
                onClick={() => void moveCompartment(idx, 'down')}
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" /> Move down
              </button>
              {comp.id && (
                <button type="button" className={mobileMenuItemClass} onClick={() => void addCompartment(comp.id)}>
                  <Package className="h-4 w-4" aria-hidden="true" /> Add a location inside
                </button>
              )}
              {comp.items.length > 0 && (
                <button
                  type="button"
                  title="Select all items"
                  className={mobileMenuItemClass}
                  onClick={() => selectAllItems(idx)}
                >
                  <CheckSquare className="h-4 w-4" aria-hidden="true" /> Select all items
                </button>
              )}
              <button type="button" className={mobileMenuItemClass} onClick={() => void addHeader(idx)}>
                <Type className="h-4 w-4" aria-hidden="true" /> Add a header row
              </button>
              <button
                type="button"
                className={mobileMenuItemClass}
                onClick={() => {
                  const compKey = getCompKey(idx);
                  setShowEquipmentPresets((prev) => ({ ...prev, [compKey]: !prev[compKey] }));
                }}
              >
                <Package className="h-4 w-4" aria-hidden="true" /> Add a kit
              </button>
              {/* The row carries the name and the storage controls, but the
                  model still has a description and an image, and the expanded
                  body this replaced was the only place to type them. Without
                  these two they are readable in an export and unreachable in
                  the UI. */}
              <label className={`${mobileMenuItemClass} flex-col items-stretch gap-1`}>
                <span className="flex items-center gap-3">
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Description
                </span>
                <input
                  type="text"
                  className="form-input min-h-[44px] text-sm"
                  placeholder="Optional description"
                  aria-label={`Description for ${comp.name || 'location'}`}
                  value={comp.description}
                  onChange={(e) => updateCompartmentField(idx, { description: e.target.value })}
                />
              </label>
              <label className={`${mobileMenuItemClass} flex-col items-stretch gap-1`}>
                <span className="flex items-center gap-3">
                  <Image className="h-4 w-4" aria-hidden="true" /> Image URL
                </span>
                <input
                  type="text"
                  className="form-input min-h-[44px] text-sm"
                  placeholder="https://..."
                  aria-label={`Image URL for ${comp.name || 'location'}`}
                  value={comp.imageUrl}
                  onChange={(e) => updateCompartmentField(idx, { imageUrl: e.target.value })}
                />
              </label>
              <label className={`${mobileMenuItemClass} flex-col items-stretch gap-1`}>
                <span className="flex items-center gap-3">
                  <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Stored inside
                </span>
                <select
                  className="form-input min-h-[44px] text-sm"
                  value={comp.parentCompartmentId}
                  aria-label={`Move ${comp.name || 'compartment'} to compartment; current destination ${comp.parentCompartmentId ? compartmentPath(compartments.findIndex((entry) => entry.id === comp.parentCompartmentId)) : 'Top level'}`}
                  onChange={(e) => updateCompartmentField(idx, { parentCompartmentId: e.target.value })}
                >
                  <option value="">Top level{!comp.parentCompartmentId ? ' (current)' : ''}</option>
                  {storedInsideOptions(compartments, comp).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {comp.parentCompartmentId === option.id ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={mobileDestructiveMenuItemClass}
                onClick={() => void deleteCompartment(idx)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </button>
            </RowActionMenu>
          </div>
        </div>

        {/* Items and the add composer */}
        {isExpanded && (
          <div
            className="border-theme-surface-border flex flex-col border-b px-4 py-1 pl-8"
            style={depth > 0 ? { paddingLeft: 32 + depth * 18 } : undefined}
          >
            {(showEquipmentPresets[key] ?? false) && (
              <div className="my-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-theme-text-primary text-xs font-medium">Add equipment kit:</p>
                  <button
                    type="button"
                    onClick={() => setShowEquipmentPresets((prev) => ({ ...prev, [key]: false }))}
                    className="text-theme-text-muted hover:text-theme-text-primary p-0.5"
                    aria-label="Close equipment kits"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                  {Object.entries(EQUIPMENT_PRESETS).map(([presetKey, preset]) => (
                    <button
                      key={presetKey}
                      type="button"
                      onClick={() => void addEquipmentPreset(idx, presetKey)}
                      disabled={bulkItemPending[key] ?? false}
                      className="btn-secondary px-2 py-1.5 text-left text-xs hover:border-green-500/40 hover:bg-green-500/10"
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="text-theme-text-muted block text-[10px]">{preset.items.length} items</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedCount > 0 && (
              <div className="my-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-2.5 py-1.5">
                <span className="text-xs font-medium text-blue-700 dark:text-blue-400">{selectedCount} selected</span>
                <select
                  className="form-input min-h-8 w-auto py-1 text-xs"
                  aria-label="Set type for selected items"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) bulkSetCheckType(idx, e.target.value as CheckType);
                  }}
                >
                  <option value="" disabled>
                    Set type…
                  </option>
                  {CHECK_TYPES.map((ct) => (
                    <option key={ct.value} value={ct.value}>
                      {ct.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const selected = selectedItems[key];
                    const allRequired = selected && [...selected].every((i) => comp.items[i]?.isRequired);
                    bulkToggleRequired(idx, !allRequired);
                  }}
                  className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-600 dark:border-blue-700 dark:text-blue-400"
                >
                  {(() => {
                    const selected = selectedItems[key];
                    const allRequired = selected && [...selected].every((i) => comp.items[i]?.isRequired);
                    return allRequired ? 'Set Optional' : 'Set Required';
                  })()}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSelectedItems(idx)}
                  className="flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 dark:border-red-700 dark:text-red-400"
                  aria-label="Delete selected items"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" /> Delete
                </button>
                <button
                  type="button"
                  onClick={() => deselectAllItems(idx)}
                  className="text-theme-text-muted hover:text-theme-text-primary rounded-md px-2 py-1 text-xs"
                >
                  Clear
                </button>
              </div>
            )}

            {!isLaptop && comp.items.length > 0 && (
              <button
                type="button"
                className="min-h-[44px] self-start px-2 text-sm font-medium text-blue-600 dark:text-blue-400"
                onClick={() => setMobileSelectionMode(idx, !mobileSelectionLocations.has(key))}
              >
                {mobileSelectionLocations.has(key) ? 'Done' : 'Select items'}
              </button>
            )}

            {!isLaptop && mobileAddLocations.has(key) && (
              <div className="border-theme-surface-border bg-theme-surface-secondary/30 my-2 rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-theme-text-primary text-sm font-semibold">Add item</p>
                    <p className="text-theme-text-muted text-xs">
                      Choose a result to link inventory, or add your text as a checklist task.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="min-h-[44px] min-w-[44px]"
                    aria-label="Close add item"
                    onClick={() =>
                      setMobileAddLocations((previous) => {
                        const next = new Set(previous);
                        next.delete(key);
                        return next;
                      })
                    }
                  >
                    <X className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {bulkPasteMode[key] ? (
                  <div className="space-y-2">
                    <textarea
                      className="form-input text-sm"
                      rows={5}
                      aria-label="Item names, one per line"
                      placeholder="Paste item names, one per line"
                      value={bulkPasteValues[key] ?? ''}
                      onChange={(event) =>
                        setBulkPasteValues((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                    />
                    <div className="flex justify-between gap-2">
                      <button
                        type="button"
                        className="min-h-[44px] px-2 text-sm font-medium"
                        onClick={() => setBulkPasteMode((previous) => ({ ...previous, [key]: false }))}
                      >
                        Back to single add
                      </button>
                      <button
                        type="button"
                        className="min-h-[44px] rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
                        disabled={!bulkPasteValues[key]?.trim() || bulkItemPending[key]}
                        onClick={() => void handleBulkPaste(idx)}
                      >
                        Add all
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <CatalogQuickAdd
                      value={quickAddValues[key] ?? ''}
                      onChange={(value) => setQuickAddValues((previous) => ({ ...previous, [key]: value }))}
                      onAdd={(payload) => handleQuickAdd(idx, payload)}
                      canCreateInventory={canManageInventory}
                      autoFocus
                      placeholder="Add or search items…"
                    />
                    <button
                      type="button"
                      className="text-theme-text-muted mt-3 flex min-h-[44px] items-center gap-1 text-xs font-medium"
                      onClick={() => setBulkPasteMode((previous) => ({ ...previous, [key]: true }))}
                    >
                      <List className="h-3.5 w-3.5" aria-hidden="true" /> Add several
                    </button>
                  </>
                )}
              </div>
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => void handleItemDragEnd(idx, e)}
            >
              <SortableContext
                items={comp.items.map((item) => item.id ?? item.clientKey)}
                strategy={verticalListSortingStrategy}
              >
                {comp.items.map((item, itemIdx) => (
                  <SortableItemWrapper key={item.id ?? item.clientKey} id={item.id ?? item.clientKey}>
                    {({ listeners: itemListeners }) => renderItem(idx, itemIdx, item, itemListeners, comp.items.length)}
                  </SortableItemWrapper>
                ))}
              </SortableContext>
            </DndContext>

            {/* The composer. One line and Enter adds one item; two or more
                lines is a paste, and the preview below says what will be
                created before anything is. No mode to choose — the text
                decides, because a mode toggle is a question the author
                already answered by typing. */}
            {!isLaptop && (
              <div
                data-testid={`mobile-add-action-${key}`}
                className="bg-theme-surface sticky bottom-0 z-20 -mx-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              >
                <button
                  type="button"
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 font-semibold text-white shadow-lg"
                  onClick={() => setMobileAddLocations((previous) => new Set(previous).add(key))}
                >
                  <Plus className="h-5 w-5" aria-hidden="true" /> Add item
                </button>
              </div>
            )}

            {isLaptop && (
              <div className="flex items-start gap-2.5 pt-2 pb-3">
                <Plus className="text-theme-text-muted mt-2.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <textarea
                    id={`compose-${key}`}
                    aria-label={`Add items to ${comp.name || 'this location'}`}
                    rows={Math.max(1, Math.min(6, composeValue.split('\n').length))}
                    placeholder="Type an item and press Enter — or paste a whole list, one per line"
                    className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder:text-theme-text-muted w-full resize-none rounded-lg border border-dashed px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-solid focus:border-blue-400"
                    value={composeValue}
                    disabled={bulkItemPending[key] ?? false}
                    onChange={(e) => setComposeValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setComposeValues((prev) => ({ ...prev, [key]: '' }));
                        return;
                      }
                      if (e.key !== 'Enter' || e.shiftKey) return;
                      // Enter commits a single typed line and keeps focus for the
                      // next one; a multi-line value belongs to the paste preview,
                      // where the author still has to confirm.
                      if (composeLines.length > 1) return;
                      e.preventDefault();
                      const name = composeValue.trim();
                      if (!name) return;
                      setComposeValues((prev) => ({ ...prev, [key]: '' }));
                      void handleQuickAdd(idx, { name });
                    }}
                  />
                  {composeLines.length > 1 && (
                    <div className="mt-2 rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2.5">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                          {composeLines.length} items ready to add
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted text-[11px]">Set all to</span>
                          <select
                            aria-label="Check type for pasted items"
                            className="border-theme-input-border bg-theme-input-bg text-theme-text-secondary rounded-md border px-1.5 py-1 text-[11px]"
                            value={composeType}
                            onChange={(e) =>
                              setComposeTypes((prev) => ({ ...prev, [key]: e.target.value as CheckType }))
                            }
                          >
                            {CANVAS_CHECK_TYPES.map(({ value, label }) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={bulkItemPending[key] ?? false}
                            onClick={() => void handleBulkPaste(idx, { source: 'compose', checkType: composeType })}
                            className="flex min-h-7 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            {(bulkItemPending[key] ?? false) && <Loader2 className="h-3 w-3 animate-spin" />}
                            {(bulkItemPending[key] ?? false) ? 'Adding…' : 'Add all'}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {composeLines.slice(0, 14).map((name, chipIdx) => (
                          <span
                            key={`${name}-${String(chipIdx)}`}
                            className="bg-theme-surface border-theme-surface-border text-theme-text-secondary rounded-full border px-2 py-0.5 text-xs"
                          >
                            {name}
                          </span>
                        ))}
                        {composeLines.length > 14 && (
                          <span className="text-theme-text-muted px-1 py-0.5 text-xs">
                            +{composeLines.length - 14} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Sortable Compartment Wrapper
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Render: Main
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Sidebar content (template metadata)
  // ---------------------------------------------------------------------------

  /**
   * Template metadata, in a drawer.
   *
   * Who runs the checklist, when, and on what — answered once, then never
   * looked at again while the actual work (the items) is done. The chip strip
   * under the title reports what it holds so it does not have to be opened to
   * be read.
   */
  const renderDetailsDrawer = () => (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[4px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-details-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) setDrawerOpen(false);
        }}
      >
        <DialogPanel
          onClose={() => setDrawerOpen(false)}
          className="bg-theme-surface border-theme-surface-border animate-slide-in-right h-full w-[440px] max-w-[92vw] overflow-y-auto rounded-none border-0 border-l px-5 py-5 shadow-2xl"
        >
          <div className="mb-1 flex items-start justify-between gap-3">
            <h2 id="template-details-title" className="text-theme-text-primary text-[17px] font-bold">
              Template details
            </h2>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target flex items-center justify-center rounded-md sm:min-h-0 sm:min-w-0 sm:p-1.5"
              aria-label="Close template details"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
          <p className="text-theme-text-muted mb-4 text-xs">
            Who runs this checklist, when, and on what. Nothing here changes the items.
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass} htmlFor="template-name-drawer">
                Name <span className="text-red-600">*</span>
              </label>
              <input
                id="template-name-drawer"
                type="text"
                className={inputClass}
                placeholder="e.g. Engine Daily Check"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="template-description">
                Description
              </label>
              <textarea
                id="template-description"
                className={inputClass}
                rows={2}
                placeholder="Describe what this template covers..."
                value={form.description}
                onChange={(e) => updateForm({ description: e.target.value })}
              />
            </div>

            <div>
              <label className={labelClass}>
                <Clock className="mr-1 inline h-3.5 w-3.5" />
                When should crews complete it?
              </label>
              <div className="bg-theme-surface-secondary grid grid-cols-2 gap-1 rounded-lg p-1">
                {(
                  [
                    ['start_of_shift', 'Start of shift'],
                    ['end_of_shift', 'End of shift'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateForm({ checkTiming: value })}
                    className={`min-h-10 rounded-md px-2 text-[13px] transition-colors ${form.checkTiming === value ? 'bg-theme-surface text-theme-text-primary font-semibold shadow-sm ring-1 ring-blue-500/20' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                    aria-pressed={form.checkTiming === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="equipment-check-template-type">
                Template Type
              </label>
              <select
                id="equipment-check-template-type"
                className={selectClass}
                value={form.templateType}
                onChange={(e) => updateForm({ templateType: e.target.value as TemplateType })}
              >
                {(Object.entries(TEMPLATE_TYPE_LABELS) as [TemplateType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Who completes it?</label>
              <p className="text-theme-text-muted -mt-1 mb-2 text-[11px]">
                Leave blank to make it available to the whole crew.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {POSITIONS.map((pos) => (
                  <label
                    key={pos}
                    className={`flex min-h-8.5 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] capitalize transition-colors ${form.assignedPositions.includes(pos) ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary'}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={form.assignedPositions.includes(pos)}
                      onChange={() => togglePosition(pos)}
                    />
                    {form.assignedPositions.includes(pos) && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {pos}
                  </label>
                ))}
              </div>
            </div>

            <div className="border-theme-surface-border border-t pt-4">
              <label className={labelClass} htmlFor="template-apparatus-type">
                Where will it be used?
              </label>
              <div className="flex gap-2">
                <select
                  id="template-apparatus-type"
                  className={`${selectClass} min-w-0 flex-1`}
                  value={form.apparatusType}
                  onChange={(e) => updateForm({ apparatusType: e.target.value })}
                >
                  <option value="">-- Select Type --</option>
                  {APPARATUS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Specific Apparatus"
                  className={`${selectClass} min-w-0 flex-1`}
                  value={form.apparatusId}
                  onChange={(e) => updateForm({ apparatusId: e.target.value })}
                >
                  <option value="">All of type (default)</option>
                  {apparatusOptions
                    .filter((a) => !form.apparatusType || a.apparatus_type === form.apparatusType)
                    .filter((a) => a.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.unit_number ? `${a.unit_number} — ${a.name}` : a.name}
                      </option>
                    ))}
                </select>
              </div>
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave as &quot;All of type&quot; to use this template as the default for all{' '}
                {form.apparatusType || 'apparatus'} units
              </p>
            </div>

            <div className="border-theme-surface-border flex flex-col gap-2 border-t pt-4">
              <span className="text-theme-text-muted text-[11px] font-bold tracking-[0.08em] uppercase">
                Template tools
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportTemplateJson}
                  disabled={compartments.length === 0}
                  className="btn-secondary flex min-h-9 items-center gap-1.5 px-3 text-[13px] disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" /> Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="btn-secondary flex min-h-9 items-center gap-1.5 px-3 text-[13px]"
                >
                  <Upload className="h-3.5 w-3.5" /> Import JSON
                </button>
                {isEditing && templateId && (
                  <button
                    type="button"
                    onClick={() => void handleClone()}
                    disabled={cloning}
                    className="btn-secondary flex min-h-9 items-center gap-1.5 px-3 text-[13px] disabled:opacity-50"
                  >
                    {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}{' '}
                    Clone
                  </button>
                )}
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </DialogPortal>
  );

  const setupReady = Boolean(form.name.trim() && form.checkTiming && form.templateType);
  const structureReady = compartments.some((comp) => !comp.isHeader);
  const operationalCompartments = compartments.filter((comp) => !comp.isHeader);
  const blockingItems = compartments
    .flatMap((comp) => comp.items)
    .filter(
      (item) =>
        !item.name.trim() ||
        (item.checkType === 'count' && item.requiredQuantity.trim() === '' && item.expectedQuantity.trim() === '') ||
        (item.checkType === 'level' && item.minLevel.trim() === '')
    ).length;
  const locationsReady =
    structureReady &&
    compartments.every((comp) => comp.name.trim()) &&
    operationalCompartments.every((comp) =>
      comp.items.some((item) => item.checkType !== 'header' && item.checkType !== 'text')
    );
  const publishReady = setupReady && locationsReady && blockingItems === 0;

  /**
   * The publish gate, restated as a to-do list.
   *
   * Derived from the same predicates as `publishReady` above rather than from
   * a parallel set, so the panel and the disabled Publish button cannot
   * disagree about why. Each entry carries the DOM id of the row that causes
   * it: naming the blocker is only half the job when the checklist is four
   * hundred rows long.
   */
  const blockers: Array<{
    id: string;
    title: string;
    locator: string;
    icon: 'alert' | 'gauge' | 'package' | 'sliders';
    anchorId: string;
    /** Compartment to expand before jumping, when the row is inside one. */
    expandKey?: string;
    /** The field the author has to change — not merely the row it sits in. */
    focusId?: string;
    /**
     * Below 640px an item's settings live only in the editor sheet, so the
     * compact row holds no field to focus. Opening that sheet is the phone
     * equivalent of putting the cursor in the offending input.
     */
    editorTarget?: { compartmentKey: string; itemKey: string };
    /** A location with nothing in it: the fix is adding, not focusing a field. */
    addKey?: string;
  }> = [];
  if (!setupReady) {
    blockers.push({
      id: 'setup',
      title: 'Template details are incomplete',
      locator: 'A name, a timing and a template type are needed',
      icon: 'sliders',
      anchorId: DETAILS_ANCHOR,
    });
  }
  if (!structureReady) {
    blockers.push({
      id: 'structure',
      title: 'The checklist has no locations',
      locator: 'Add a location, load a preset, or import a spreadsheet',
      icon: 'package',
      anchorId: 'checklist-canvas',
    });
  }
  for (const [compIdx, comp] of compartments.entries()) {
    const compAnchor = `comp-row-${comp.id ?? comp.clientKey}`;
    const compLabel = comp.name.trim() || `Untitled ${containerTypeLabel(comp.containerType)}`;
    if (!comp.name.trim()) {
      blockers.push({
        id: `comp-name-${comp.clientKey}`,
        title: comp.isHeader ? 'A section has no heading' : 'A location has no name',
        locator: comp.isHeader ? 'Name it or delete it' : `Position ${String(compIdx + 1)} in the checklist`,
        icon: 'package',
        anchorId: compAnchor,
        focusId: `comp-name-${comp.id ?? comp.clientKey}`,
      });
    }
    if (!comp.isHeader && !comp.items.some((item) => item.checkType !== 'header' && item.checkType !== 'text')) {
      blockers.push({
        id: `comp-empty-${comp.clientKey}`,
        title: `${compLabel} is empty`,
        locator: 'Add an item or delete the location',
        icon: 'package',
        anchorId: compAnchor,
        addKey: comp.id ?? comp.clientKey,
      });
    }
    for (const [itemIdx, item] of comp.items.entries()) {
      const itemAnchor = `item-row-${item.id ?? item.clientKey}`;
      if (!item.name.trim()) {
        blockers.push({
          id: `item-name-${item.clientKey}`,
          title: 'One item has no name',
          locator: `${compLabel} · row ${String(itemIdx + 1)}`,
          icon: 'alert',
          anchorId: itemAnchor,
          expandKey: comp.id ?? comp.clientKey,
          focusId: `item-name-${item.id ?? item.clientKey}`,
          editorTarget: { compartmentKey: comp.clientKey, itemKey: item.clientKey },
        });
        continue;
      }
      if (item.checkType === 'count' && !item.requiredQuantity.trim() && !item.expectedQuantity.trim()) {
        blockers.push({
          id: `item-count-${item.clientKey}`,
          title: `${item.name.trim()} needs a quantity`,
          locator: 'A count check needs a par or a minimum to compare against',
          icon: 'alert',
          anchorId: itemAnchor,
          expandKey: comp.id ?? comp.clientKey,
          focusId: `item-par-${item.id ?? item.clientKey}`,
          editorTarget: { compartmentKey: comp.clientKey, itemKey: item.clientKey },
        });
      }
      if (item.checkType === 'level' && !item.minLevel.trim()) {
        blockers.push({
          id: `item-level-${item.clientKey}`,
          title: `${item.name.trim()} needs a minimum`,
          locator: "A level check can't pass or fail without one",
          icon: 'gauge',
          anchorId: itemAnchor,
          expandKey: comp.id ?? comp.clientKey,
          focusId: `item-min-level-${item.id ?? item.clientKey}`,
          editorTarget: { compartmentKey: comp.clientKey, itemKey: item.clientKey },
        });
      }
    }
  }
  const blockerAnchorIds = new Set(blockers.map((blocker) => blocker.anchorId));

  /**
   * Jump from a blocker to the row that causes it.
   *
   * Focus, not just scroll: the author's next act is to type into the field
   * that is empty, and a scrolled-to row still costs them a click to find it.
   * `prefers-reduced-motion` turns the smooth scroll off rather than the jump.
   */
  const goToBlocker = (
    anchorId: string,
    expandKey?: string,
    focusId?: string,
    editorTarget?: { compartmentKey: string; itemKey: string },
    addKey?: string
  ) => {
    if (anchorId === DETAILS_ANCHOR) {
      setDrawerOpen(true);
      return;
    }
    // An empty location has no field that is wrong; what is missing is an item.
    if (addKey) {
      document.getElementById(anchorId)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
      openAddSurface(addKey);
      return;
    }
    // The phone row is a summary, not a form: every item field it could focus
    // is inside the editor sheet, so scrolling to the row would leave the
    // author looking at the problem with no way to fix it.
    if (!isLaptop && editorTarget) {
      setMobileEditor(editorTarget);
      return;
    }
    // A row inside a collapsed location is not in the DOM to scroll to, so the
    // jump has to open it first — and then wait a frame for it to render.
    if (expandKey && !expandedCompartments.has(expandKey)) {
      setExpandedCompartments((prev) => new Set(prev).add(expandKey));
      window.setTimeout(() => goToBlocker(anchorId, undefined, focusId, editorTarget, addKey), 0);
      return;
    }
    const row = document.getElementById(anchorId);
    if (!row) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    // The blocker named a field; falling back to the row's first control would
    // put the cursor in the item name, which is the one part already correct.
    const field =
      (focusId ? document.getElementById(focusId) : null) ?? row.querySelector<HTMLElement>('input, select, textarea');
    (field ?? row).focus({ preventScroll: true });
  };
  const mobileSelection = compartments
    .map((compartment, index) => ({ index, key: getCompKey(index), compartment }))
    .find(({ key }) => mobileSelectionLocations.has(key));
  const mobileSelectedCount = mobileSelection ? (selectedItems[mobileSelection.key]?.size ?? 0) : 0;

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div style={actionBarHeight > 0 ? { paddingBottom: actionBarHeight } : undefined}>
      {/* Sticky top bar. Bleeds past the page gutters so it reads as a bar
          rather than a card, and sits below the fixed mobile header. */}
      <div
        ref={topBarRef}
        /* `mobile-header-inset` parks it below the fixed mobile header, which
           only exists under 768px — hence the md override back to the top. */
        className="bg-theme-surface/95 border-theme-surface-border mobile-header-inset sticky z-30 border-b backdrop-blur md:top-0"
        style={{
          marginInline: 'calc(var(--page-gutter-inline) * -1)',
          marginTop: 'calc(var(--page-gutter-block) * -1)',
        }}
      >
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => void handleLeave()}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary flex-shrink-0 rounded-md p-2 transition-colors"
            title="Back to templates"
            aria-label="Back to templates"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <input
            type="text"
            aria-label="Template name"
            placeholder="e.g. Engine Daily Check"
            className="text-theme-text-primary placeholder:text-theme-text-muted hover:border-theme-surface-border focus:bg-theme-input-bg w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xl font-bold outline-none focus:border-blue-400 sm:w-auto sm:max-w-[420px] sm:min-w-[200px] sm:flex-1"
            value={form.name}
            onChange={(e) => updateForm({ name: e.target.value })}
          />

          <span
            aria-label="Template status"
            className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              form.isActive
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            {form.isActive ? 'Published' : 'Draft'}
          </span>

          <span className="flex flex-shrink-0 items-center gap-1.5 text-xs" aria-live="polite">
            {autoSaveStatus === 'saving' || saving ? (
              <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
              </span>
            ) : autoSaveStatus === 'error' ? (
              <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Save failed
              </span>
            ) : autoSaveStatus === 'saved' ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Saved just now
              </span>
            ) : null}
          </span>

          <div className="flex-1" />

          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Details"
              className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-sm font-medium"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </button>

            <details className="relative">
              <summary
                aria-label="Tools"
                className="btn-secondary hover:bg-theme-surface-secondary flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Tools</span>
              </summary>
              <div className="bg-theme-surface border-theme-surface-border absolute right-0 z-50 mt-1 w-56 rounded-lg border p-1.5 shadow-xl">
                {isEditing && templateId && (
                  <button
                    type="button"
                    onClick={() => void handleClone()}
                    disabled={cloning}
                    className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm disabled:opacity-50"
                  >
                    {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Clone
                    checklist
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportTemplateJson}
                  disabled={compartments.length === 0}
                  className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm disabled:opacity-40"
                >
                  <Download className="h-4 w-4" /> Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm"
                >
                  <Upload className="h-4 w-4" /> Import JSON
                </button>
                <button
                  type="button"
                  onClick={() => csvImportRef.current?.click()}
                  className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm"
                >
                  <Upload className="h-4 w-4" /> Import spreadsheet
                </button>
                <a
                  href={schedulingService.getCsvSampleUrl()}
                  download
                  className="hover:bg-theme-surface-secondary flex min-h-10 items-center gap-2 rounded-md px-3 text-sm"
                >
                  <Download className="h-4 w-4" /> Download CSV sample
                </a>
                {templateId && coverage && coverage.linkable > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInventoryMatch(true)}
                    className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm"
                  >
                    <Link2 className="h-4 w-4" /> Link to inventory ({coverage.linked}/{coverage.linkable})
                  </button>
                )}
                {templateId && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowChangelog(true);
                      void loadChangelog();
                    }}
                    className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm"
                  >
                    <Clock className="h-4 w-4" /> Change history
                  </button>
                )}
                {!isWideCanvas && (
                  <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    disabled={compartments.length === 0}
                    className="hover:bg-theme-surface-secondary flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm disabled:opacity-40"
                  >
                    <Eye className="h-4 w-4" /> Preview
                  </button>
                )}
              </div>
            </details>

            <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportTemplate} />
            <input ref={csvImportRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />

            {/* Item edits autosave; the template's own fields do not, so the
                explicit draft save stays. */}
            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={saving}
              aria-label={saving ? 'Saving draft' : 'Save draft'}
              className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-sm font-medium"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save draft'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={saving || !publishReady}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Publish
            </button>
            {blockers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!isWideCanvas) {
                    const first = blockers[0];
                    if (first)
                      goToBlocker(first.anchorId, first.expandKey, first.focusId, first.editorTarget, first.addKey);
                    return;
                  }
                  setRail('blockers');
                  document.getElementById('publish-blockers')?.scrollIntoView({ block: 'nearest' });
                }}
                className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
              >
                {blockers.length} to fix
              </button>
            )}
          </div>
        </div>

        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2 px-4 pb-2.5 sm:px-6">
          <span className="text-theme-text-muted mr-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
            Applies to
          </span>
          {(
            [
              {
                key: 'timing',
                Icon: Clock,
                label: form.checkTiming === 'end_of_shift' ? 'End of shift' : 'Start of shift',
                set: true,
                capitalize: false,
              },
              {
                key: 'scope',
                Icon: Truck,
                label: `${TEMPLATE_TYPE_LABELS[form.templateType]}${
                  form.apparatusType
                    ? ` · ${
                        form.apparatusId
                          ? (apparatusOptions.find((a) => a.id === form.apparatusId)?.name ?? 'one unit')
                          : `all ${form.apparatusType}s`
                      }`
                    : ''
                }`,
                set: true,
                capitalize: false,
              },
              {
                key: 'positions',
                Icon: Users,
                label: form.assignedPositions.length > 0 ? form.assignedPositions.join(', ') : 'Whole crew',
                set: form.assignedPositions.length > 0,
                capitalize: true,
              },
              {
                key: 'description',
                Icon: Type,
                label: form.description.trim() || '+ Description',
                set: Boolean(form.description.trim()),
                capitalize: false,
              },
            ] as const
          ).map(({ key, Icon, label, set, capitalize }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={`flex min-h-[30px] max-w-[280px] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors ${
                set
                  ? 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover font-medium'
                  : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover border-dashed'
              }`}
            >
              {set && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className={`truncate ${capitalize ? 'capitalize' : ''}`}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-6 pt-5 pb-6">
        {/* Canvas */}
        <div id="checklist-canvas" className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-theme-text-primary text-base font-bold">Checklist</h2>
              <span className="text-theme-text-muted text-xs">
                {stats.compartmentCount} location{stats.compartmentCount !== 1 ? 's' : ''} · {stats.totalItems} item
                {stats.totalItems !== 1 ? 's' : ''} · {stats.requiredItems} required
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {compartments.length > 1 && (
                <button
                  type="button"
                  onClick={
                    expandedCompartments.size === compartments.length ? collapseAllCompartments : expandAllCompartments
                  }
                  className="btn-secondary flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  {expandedCompartments.size === compartments.length ? 'Collapse all' : 'Expand all'}
                </button>
              )}
              {(form.templateType === 'vehicle' || form.templateType === 'combined') && (
                <button
                  type="button"
                  onClick={() => setShowPresetPicker(!showPresetPicker)}
                  className="flex min-h-8 items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
                >
                  <Truck className="h-3.5 w-3.5" />
                  Vehicle preset
                </button>
              )}
              <button
                type="button"
                disabled={addingSection}
                onClick={() => void addSectionHeader()}
                className="btn-secondary flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium disabled:opacity-50"
              >
                <Type className="h-3.5 w-3.5" />
                Section
              </button>
              <button
                type="button"
                disabled={addingCompartment}
                onClick={() => void addCompartment()}
                className="btn-secondary flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium disabled:opacity-50"
              >
                <Package className="h-3.5 w-3.5" />
                Location
              </button>
              <button
                type="button"
                onClick={() => csvImportRef.current?.click()}
                className="btn-secondary flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
            </div>
          </div>

          {showPresetPicker && (
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
              <p className="text-theme-text-primary mb-3 text-sm font-medium">
                Choose a pre-built vehicle check template:
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {Object.entries(VEHICLE_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void loadVehiclePreset(key)}
                    className="btn-secondary px-3 text-left text-sm hover:border-orange-500/40 hover:bg-orange-500/10"
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="text-theme-text-muted mt-0.5 block text-xs">
                      {preset.compartments.length} sections,{' '}
                      {preset.compartments.reduce((sum, c) => sum + c.items.length, 0)} items
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {compartments.length === 0 ? (
            <div className="card overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/[0.06] via-transparent to-transparent p-5 shadow-sm sm:p-8">
              <div className="mx-auto max-w-2xl text-center">
                <h3 className="text-theme-text-primary text-lg font-semibold">How would you like to start?</h3>
                <p className="text-theme-text-muted mt-1 text-sm">
                  You can change every detail later. Choose the quickest starting point for this checklist.
                </p>
              </div>
              <div
                className={`mx-auto mt-5 grid max-w-4xl gap-3 ${form.templateType === 'vehicle' || form.templateType === 'combined' ? 'sm:grid-cols-3' : 'sm:max-w-2xl sm:grid-cols-2'}`}
              >
                {(form.templateType === 'vehicle' || form.templateType === 'combined') && (
                  <button
                    type="button"
                    onClick={() => setShowPresetPicker(true)}
                    className="group border-theme-surface-border bg-theme-surface rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-orange-500/50 hover:shadow-md"
                  >
                    <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600">
                      <Truck className="h-5 w-5" />
                    </span>
                    <span className="text-theme-text-primary block text-sm font-semibold">Use a vehicle layout</span>
                    <span className="text-theme-text-muted mt-1 block text-xs">
                      Start with common apparatus locations and inspection items.
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => csvImportRef.current?.click()}
                  className="group border-theme-surface-border bg-theme-surface rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md"
                >
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Import a list</span>
                  <span className="text-theme-text-muted mt-1 block text-xs">
                    Bring in the spreadsheet or checklist you already use.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void addCompartment()}
                  className="group border-theme-surface-border bg-theme-surface rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md"
                >
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Build from scratch</span>
                  <span className="text-theme-text-muted mt-1 block text-xs">
                    Add the first location and begin typing items immediately.
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* Deliberately not `overflow-hidden`: the catalog results list is
               absolutely positioned below its input and a clip here cuts it in
               half whatever z-index it carries. */
            <div className="card rounded-xl">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => void handleCompartmentDragEnd(event)}
              >
                <SortableContext items={compartmentIds} strategy={verticalListSortingStrategy}>
                  {orderedCompartments.map(({ comp, idx, depth }) => {
                    const id = compartmentKey(comp, idx);
                    return (
                      <SortableCompartmentWrapper key={id} id={id} disabled={!comp.id}>
                        {({ listeners: compListeners, setNodeRef, style, attributes }) =>
                          renderCompartment(comp, idx, compListeners, setNodeRef, style, attributes, depth)
                        }
                      </SortableCompartmentWrapper>
                    );
                  })}
                </SortableContext>
              </DndContext>
            </div>
          )}

          {compartments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-0.5">
              <button
                type="button"
                disabled={addingCompartment}
                onClick={() => void addCompartment()}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
              >
                <Package className="h-3.5 w-3.5" /> Add location
              </button>
              <button
                type="button"
                disabled={addingSection}
                onClick={() => void addSectionHeader()}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
              >
                <Type className="h-3.5 w-3.5" /> Add section
              </button>
              <button
                type="button"
                onClick={() => csvImportRef.current?.click()}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-[13px] font-medium transition-colors"
              >
                <Upload className="h-3.5 w-3.5" /> Import spreadsheet
              </button>
            </div>
          )}
        </div>

        {/* Right rail — only where there is room for it beside the canvas. */}
        {isWideCanvas && (
          <div
            className="sticky flex max-w-[344px] min-w-[300px] flex-[1_1_320px] scrollbar-thin flex-col gap-3 overflow-y-auto"
            style={{ top: topBarHeight + 12, maxHeight: `calc(100dvh - ${String(topBarHeight + 24)}px)` }}
          >
            <div className="bg-theme-surface-border grid grid-cols-2 gap-0.5 rounded-lg p-0.5">
              {[
                { value: 'blockers' as const, label: 'Before publishing', Icon: AlertTriangle },
                { value: 'crew' as const, label: 'Crew view', Icon: Smartphone },
              ].map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRail(value)}
                  aria-pressed={rail === value}
                  className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-colors ${
                    rail === value
                      ? 'bg-theme-surface text-theme-text-primary shadow-sm'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            {rail === 'blockers' ? (
              <div className="card p-4" id="publish-blockers">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-theme-text-primary text-sm font-bold">
                    {blockers.length === 0
                      ? 'Ready to publish'
                      : `${blockers.length} thing${blockers.length === 1 ? '' : 's'} to fix`}
                  </h3>
                  <span className="text-theme-text-muted text-[11px]">Draft saves anyway</span>
                </div>
                {blockers.length > 0 && (
                  <p className="text-theme-text-muted mb-3 text-xs">Each one jumps to the row it belongs to.</p>
                )}
                <div className="flex flex-col gap-2">
                  {blockers.map((blocker) => {
                    const BlockerIcon =
                      blocker.icon === 'gauge'
                        ? Gauge
                        : blocker.icon === 'package'
                          ? Package
                          : blocker.icon === 'sliders'
                            ? SlidersHorizontal
                            : AlertTriangle;
                    return (
                      <button
                        key={blocker.id}
                        type="button"
                        onClick={() =>
                          goToBlocker(
                            blocker.anchorId,
                            blocker.expandKey,
                            blocker.focusId,
                            blocker.editorTarget,
                            blocker.addKey
                          )
                        }
                        className="flex items-start gap-2.5 rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-2.5 text-left transition-colors hover:bg-amber-500/[0.14]"
                      >
                        <BlockerIcon
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="text-theme-text-primary block text-[13px] font-semibold">
                            {blocker.title}
                          </span>
                          <span className="text-theme-text-muted block text-xs">{blocker.locator}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-theme-surface-border mt-3.5 flex flex-col gap-1.5 border-t pt-3">
                  <span className="text-theme-text-secondary flex items-center gap-2 text-[13px]">
                    {setupReady ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
                    ) : (
                      <Circle className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                    )}
                    Name, timing and crew set
                  </span>
                  <span className="text-theme-text-secondary flex items-center gap-2 text-[13px]">
                    {locationsReady ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
                    ) : (
                      <Circle className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                    )}
                    {stats.compartmentCount} location{stats.compartmentCount !== 1 ? 's' : ''},{' '}
                    {compartments.filter((c) => !c.isHeader && c.items.length > 0).length} with items
                  </span>
                  <span className="text-theme-text-secondary flex flex-wrap items-center gap-2 text-[13px]">
                    <Link2 className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                    {coverage.linked} of {coverage.linkable} items linked to inventory
                    {templateId && coverage.unlinked > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowInventoryMatch(true)}
                        className="text-blue-700 underline dark:text-blue-400"
                      >
                        link the rest
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <div className="card p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-theme-text-primary text-sm font-bold">What the crew sees</h3>
                  <span className="text-theme-text-muted text-[11px]">Updates as you edit</span>
                </div>
                <div className="bg-theme-bg mx-auto w-[300px] overflow-hidden rounded-[34px] border-[6px] border-gray-800 shadow-xl dark:border-gray-600">
                  <div className="flex h-[22px] items-end justify-center bg-gray-800 dark:bg-gray-600">
                    <div className="h-3.5 w-24 rounded-b-[14px] bg-gray-800 dark:bg-gray-600" />
                  </div>
                  <div className="text-theme-text-muted flex items-center justify-between px-4 py-0.5 text-[10px]">
                    <span>9:41</span>
                    <span className="flex items-center gap-1">
                      <Signal className="h-2.5 w-2.5" aria-hidden="true" />
                      <BatteryFull className="h-2.5 w-2.5" aria-hidden="true" />
                    </span>
                  </div>
                  <div className="bg-theme-bg h-[430px] overflow-y-auto px-1 pb-4" aria-label="Crew preview">
                    {compartments.length === 0 ? (
                      <p className="text-theme-text-muted px-3 py-6 text-center text-xs">
                        Add a location to see what the crew will get.
                      </p>
                    ) : (
                      <EquipmentCheckForm
                        key={previewStructureKey}
                        shiftId="preview"
                        template={buildPreviewTemplate()}
                        previewMode
                      />
                    )}
                  </div>
                  <div className="bg-theme-bg flex justify-center py-1.5">
                    <div className="h-1 w-28 rounded-full bg-gray-800/25 dark:bg-gray-400/30" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {drawerOpen && renderDetailsDrawer()}

      {/* The phone action bar keeps only the current state and its next action;
          on laptop and wider the canvas header carries the counts and the top
          bar carries the save state. ResizeObserver above makes page clearance
          follow the bar when translated copy, zoom, validation, or safe-area
          padding changes its real height. */}
      {stats.totalItems > 0 && !isLaptop && (
        <div
          ref={actionBarRef}
          className="border-theme-surface-border bg-theme-surface/95 action-bar-safe fixed right-0 bottom-0 left-0 z-40 border-t px-4 backdrop-blur-sm"
          aria-label="Checklist action bar"
        >
          <div className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-theme-text-secondary min-w-0 text-sm font-medium wrap-break-word" aria-live="polite">
              {mobileSelection
                ? `${String(mobileSelectedCount)} selected`
                : autoSaveStatus === 'saving' || saving
                  ? 'Saving…'
                  : blockingItems > 0
                    ? `${String(blockingItems)} item${blockingItems === 1 ? '' : 's'} need attention`
                    : `${String(stats.totalItems)} item${stats.totalItems === 1 ? '' : 's'} · ${autoSaveStatus === 'error' ? 'Save failed' : autoSaveStatus === 'saved' ? 'Saved' : isEditing ? 'Saved' : 'Draft'}`}
            </span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm font-semibold">
              {mobileSelection ? (
                <>
                  <select
                    aria-label="Set type for selected items"
                    className="text-theme-accent-blue min-h-11 max-w-20 bg-transparent"
                    value=""
                    disabled={mobileSelectedCount === 0}
                    onChange={(event) => {
                      if (event.target.value) bulkSetCheckType(mobileSelection.index, event.target.value as CheckType);
                    }}
                  >
                    <option value="" disabled>
                      Type
                    </option>
                    {CHECK_TYPES.map((checkType) => (
                      <option key={checkType.value} value={checkType.value}>
                        {checkType.label}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="text-theme-accent-blue min-h-11 disabled:opacity-40"
                    disabled={mobileSelectedCount === 0}
                    onClick={() => {
                      const selected = selectedItems[mobileSelection.key];
                      const allRequired =
                        !!selected &&
                        [...selected].every((index) => mobileSelection.compartment.items[index]?.isRequired);
                      bulkToggleRequired(mobileSelection.index, !allRequired);
                    }}
                  >
                    {(() => {
                      const selected = selectedItems[mobileSelection.key];
                      const allRequired =
                        !!selected &&
                        selected.size > 0 &&
                        [...selected].every((index) => mobileSelection.compartment.items[index]?.isRequired);
                      return allRequired ? 'Optional' : 'Required';
                    })()}
                  </button>
                  <span aria-hidden="true">·</span>
                  <select
                    aria-label="Move selected items"
                    className="text-theme-accent-blue max-w-24 bg-transparent"
                    value=""
                    disabled={mobileSelectedCount === 0}
                    onChange={(event) => {
                      const destination = Number(event.target.value);
                      const selected = [...(selectedItems[mobileSelection.key] ?? [])].sort((a, b) => b - a);
                      for (const itemIndex of selected)
                        void moveItemToCompartment(mobileSelection.index, itemIndex, destination);
                      setMobileSelectionMode(mobileSelection.index, false);
                    }}
                  >
                    <option value="" disabled>
                      Move
                    </option>
                    {compartments.map((compartment, index) =>
                      index !== mobileSelection.index && !compartment.isHeader ? (
                        <option key={compartment.clientKey} value={index}>
                          {compartment.name || 'Untitled location'}
                        </option>
                      ) : null
                    )}
                  </select>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="min-h-11 text-red-600 disabled:opacity-40"
                    disabled={mobileSelectedCount === 0}
                    onClick={() => void deleteSelectedItems(mobileSelection.index)}
                  >
                    Delete
                  </button>
                </>
              ) : autoSaveStatus === 'saving' || saving ? (
                <button
                  type="button"
                  className="text-theme-accent-blue min-h-11"
                  onClick={() => inlineInputRef.current?.blur()}
                >
                  Done
                </button>
              ) : blockingItems > 0 ? (
                <button type="button" className="text-theme-accent-blue min-h-11" onClick={() => setShowPreview(true)}>
                  Review
                </button>
              ) : (
                <button
                  type="button"
                  className="text-theme-accent-blue min-h-11"
                  onClick={() => void addCompartment()}
                  disabled={addingCompartment}
                >
                  Add
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk catalog linking — rescues checklists written before the link existed */}
      {templateId && (
        <InventoryMatchModal
          templateId={templateId}
          isOpen={showInventoryMatch}
          onClose={() => setShowInventoryMatch(false)}
          onLinked={() => void loadTemplate(templateId)}
        />
      )}

      {/* Change Log Modal (admin only) */}
      {showChangelog && (
        <div className="modal-overlay z-50 flex items-center justify-center p-4">
          <div className="modal-panel-scroll bg-theme-surface w-full max-w-2xl overflow-hidden rounded-lg shadow-xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-theme-text-primary text-lg font-semibold">
                Change History{' '}
                {changelogTotal > 0 && (
                  <span className="text-theme-text-secondary text-sm font-normal">({changelogTotal} entries)</span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setShowChangelog(false)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60dvh] overflow-auto px-6 py-4">
              {changelogLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : changelogEntries.length === 0 ? (
                <p className="text-theme-text-secondary py-8 text-center text-sm">No changes recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {changelogEntries.map((entry) => {
                    const actionColors: Record<string, string> = {
                      add: 'text-green-600',
                      update: 'text-blue-600',
                      delete: 'text-red-600',
                      swap: 'text-violet-600',
                    };
                    const actionLabels: Record<string, string> = {
                      add: 'Added',
                      update: 'Updated',
                      delete: 'Removed',
                      // A swap is logged by the check screen, not typed here —
                      // labelling it "Updated" would hide where it came from.
                      swap: 'Swapped fresh stock onto',
                    };
                    return (
                      <div key={entry.id} className="border-theme-surface-border rounded-md border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm">
                            <span className="text-theme-text-primary font-medium">{entry.userName}</span>{' '}
                            <span className={actionColors[entry.action] ?? 'text-theme-text-secondary'}>
                              {actionLabels[entry.action] ?? entry.action}
                            </span>{' '}
                            <span className="text-theme-text-secondary">{entry.entityType}</span>
                            {entry.entityName && (
                              <span className="text-theme-text-primary font-medium">
                                {' '}
                                &quot;{entry.entityName}&quot;
                              </span>
                            )}
                          </div>
                          {entry.createdAt && (
                            <span className="text-theme-text-muted shrink-0 text-xs">
                              {formatDateTime(entry.createdAt, tz)}
                            </span>
                          )}
                        </div>
                        {entry.changes && Object.keys(entry.changes).length > 0 && (
                          <div className="text-theme-text-secondary mt-2 text-xs">
                            {Object.entries(entry.changes).map(([key, val]) => (
                              <span key={key} className="mr-3 inline-block">
                                <span className="font-medium">{key.replace(/_/g, ' ')}:</span>{' '}
                                {val == null
                                  ? '—'
                                  : typeof val === 'string'
                                    ? val
                                    : typeof val === 'number' || typeof val === 'boolean'
                                      ? String(val)
                                      : JSON.stringify(val)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-theme-surface-border flex justify-end border-t px-6 py-3">
              <button
                type="button"
                onClick={() => setShowChangelog(false)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Preview Confirmation Modal */}
      {csvPreview && (
        <div className="modal-overlay z-50 flex items-center justify-center p-4">
          <div className="modal-panel-scroll bg-theme-surface w-full max-w-2xl overflow-hidden rounded-lg shadow-xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-theme-text-primary text-lg font-semibold">
                CSV Import Preview — {csvPreview.length} item(s)
              </h3>
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60dvh] overflow-auto px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border text-theme-text-secondary border-b text-left">
                    <th className="pr-3 pb-2">Compartment</th>
                    <th className="pr-3 pb-2">Item</th>
                    <th className="pr-3 pb-2">Type</th>
                    <th className="pr-3 pb-2">Expected</th>
                    <th className="pb-2">Critical Min</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.map((row, i) => (
                    <tr key={i} className="border-theme-surface-border/50 border-b">
                      <td className="text-theme-text-secondary py-1.5 pr-3">{row.compartment}</td>
                      <td className="text-theme-text-primary py-1.5 pr-3">{row.name}</td>
                      <td className="py-1.5 pr-3">{row.checkType}</td>
                      <td className="py-1.5 pr-3">{row.expectedQty || '—'}</td>
                      <td className="py-1.5">{row.criticalMin || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-theme-surface-border flex justify-end gap-3 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void applyCsvImport()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Import {csvPreview.length} Items
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLaptop &&
        mobileEditor &&
        (() => {
          const compIdx = compartments.findIndex(
            (compartment) => compartment.clientKey === mobileEditor.compartmentKey
          );
          const comp = compartments[compIdx];
          const itemIdx = comp?.items.findIndex((entry) => entry.clientKey === mobileEditor.itemKey) ?? -1;
          const item = comp?.items[itemIdx];
          if (!comp || !item || itemIdx < 0) return null;
          const itemNumber = itemIdx + 1;
          const closeEditor = () => {
            const itemKey = item.id ?? item.clientKey;
            setMobileEditor(null);
            window.setTimeout(() => document.getElementById(`item-row-${itemKey}`)?.focus(), 0);
          };
          const goToItem = (nextIndex: number) => {
            const nextItem = comp.items[nextIndex];
            if (nextItem) setMobileEditor({ compartmentKey: comp.clientKey, itemKey: nextItem.clientKey });
          };

          return (
            <DialogPortal>
              <div
                className="bg-theme-surface-modal fixed inset-0 z-50"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-item-editor-title"
              >
                <DialogPanel
                  onClose={closeEditor}
                  className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0"
                >
                  <header className="modal-header-sticky flex shrink-0 items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={closeEditor}
                      className="text-theme-text-primary -ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md"
                      aria-label={`Close editor and return to ${item.name || 'item'}`}
                    >
                      <ChevronRight className="h-5 w-5 rotate-180" aria-hidden="true" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-theme-text-muted truncate text-xs">{compartmentPath(compIdx)}</p>
                        <p className="text-theme-text-muted shrink-0 text-xs">
                          Item {itemNumber}/{comp.items.length}
                        </p>
                      </div>
                      <h2
                        id="mobile-item-editor-title"
                        className="text-theme-text-primary truncate text-lg font-semibold"
                      >
                        {item.name.trim() || 'Untitled item'}
                      </h2>
                    </div>
                  </header>
                  <div className="modal-content px-4 py-5">
                    <section aria-label="Item editor fields">
                      {renderItemEditorFields(compIdx, itemIdx, item, item.checkType === 'header')}
                    </section>
                  </div>
                  <footer className="modal-footer-sticky grid shrink-0 grid-cols-3 items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      className="btn-secondary min-h-[44px]"
                      disabled={itemIdx === 0}
                      onClick={() => goToItem(itemIdx - 1)}
                    >
                      Previous
                    </button>
                    <button type="button" className="btn-primary min-h-[44px]" onClick={closeEditor}>
                      Done
                    </button>
                    <button
                      type="button"
                      className="btn-secondary min-h-[44px]"
                      disabled={itemIdx === comp.items.length - 1}
                      onClick={() => goToItem(itemIdx + 1)}
                    >
                      Next
                    </button>
                  </footer>
                </DialogPanel>
              </div>
            </DialogPortal>
          );
        })()}

      {/* Preview Modal — mobile device frame */}
      {showPreview && (
        <div className="modal-overlay z-50 flex items-center justify-center p-4">
          <div className="modal-panel-scroll relative flex flex-col items-center gap-3">
            {/* Close button remains fully inside the scroll clipping box */}
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="bg-theme-surface text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary absolute top-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-colors"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Phone frame */}
            <div
              className="bg-theme-bg text-theme-text-primary relative w-[375px] max-w-[90vw] overflow-hidden rounded-[2.5rem] border-[6px] border-gray-800 shadow-2xl dark:border-gray-600"
              aria-label="Mobile checklist preview"
            >
              {/* Phone notch */}
              <div className="relative flex h-7 items-end justify-center bg-gray-800 dark:bg-gray-600">
                <div className="h-5 w-28 rounded-b-2xl bg-gray-800 dark:bg-gray-600" />
              </div>

              {/* Phone status bar */}
              <div className="bg-theme-bg text-theme-text-muted flex items-center justify-between px-6 py-1 text-[10px]">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <div className="border-theme-text-muted relative h-2.5 w-6 rounded-sm border">
                    <div className="bg-theme-text-muted absolute inset-0.5 rounded-[1px]" style={{ width: '75%' }} />
                  </div>
                </div>
              </div>

              {/* Scrollable content area */}
              <div className="bg-theme-bg overflow-y-auto" style={{ height: 'min(70vh, 640px)' }}>
                <div className="px-1 pb-4">
                  <div className="mx-3 mt-2 mb-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400">
                      Preview — inputs are interactive but nothing will be submitted.
                    </p>
                  </div>
                  <EquipmentCheckForm shiftId="preview" template={buildPreviewTemplate()} previewMode />
                </div>
              </div>

              {/* Phone home indicator bar */}
              <div className="bg-theme-bg flex justify-center py-2">
                <div className="h-1 w-32 rounded-full bg-gray-800/30 dark:bg-gray-400/30" />
              </div>
            </div>

            {/* Label */}
            <p className="text-center text-xs text-gray-400">
              Mobile preview — most members will complete checks on their phone
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EquipmentCheckTemplateBuilder;
