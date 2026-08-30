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
  PanelLeftClose,
  PanelLeftOpen,
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

const inputClass = 'form-input';

const selectClass = 'form-input';

const labelClass = 'form-label';

const checkboxClass = 'form-checkbox';

const mobileMenuItemClass =
  'text-theme-text-primary hover:bg-theme-surface-secondary flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left text-sm';
const mobileDestructiveMenuItemClass = `${mobileMenuItemClass} text-red-600 dark:text-red-400`;

/** Native details/summary preserves keyboard disclosure behavior without making
 * the compact row permanently carry every secondary action. */
const MobileActionMenu: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details
    className="relative flex-shrink-0 sm:hidden"
    onClick={(event) => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false;
    }}
    onChange={(event) => {
      if ((event.target as HTMLElement).matches('select')) event.currentTarget.open = false;
    }}
  >
    <summary
      className="text-theme-text-muted hover:bg-theme-surface-secondary flex min-h-[44px] min-w-[44px] cursor-pointer list-none items-center justify-center rounded-md [&::-webkit-details-marker]:hidden"
      aria-label={label}
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
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
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (isEditing) return false;
    if (typeof window === 'undefined') return true;
    // On a phone the setup card otherwise consumes the entire first screen and
    // hides the actual checklist-building choices below the fold.
    return !window.matchMedia('(max-width: 1023px)').matches;
  });
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const isLaptop = useMediaQuery('(min-width: 640px)');
  const [mobileSelectionLocations, setMobileSelectionLocations] = useState<Set<string>>(new Set());

  // Bulk selection: per-compartment set of selected item indices
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});

  // Compartment keys whose storage-type selector is in free-text ("Custom…")
  // mode, so the text input stays visible even while the value is still blank.
  const [customContainerKeys, setCustomContainerKeys] = useState<Set<string>>(new Set());

  // Inline editing: which item key is being renamed inline
  const [inlineEditKey, setInlineEditKey] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Auto-save debounce timer for item edits
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSavePromiseRef = useRef<Promise<void> | null>(null);
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

    if (isEditing && item.id && toComp.id) {
      try {
        await ensureDraftBeforeStructureEdit();
        await schedulingService.updateCheckItem(item.id, {
          compartment_id: toComp.id,
          sort_order: toComp.items.length,
        });
      } catch {
        const itemKey = item.id ?? item.clientKey;
        setExpandedItems((prev) => new Set(prev).add(itemKey));
        window.setTimeout(() => document.getElementById(`item-row-${itemKey}`)?.focus());
        toast.error(`Could not move “${item.name || 'item'}.” Its original location was restored.`);
        return;
      }
    }

    setCompartments((prev) => {
      const next = [...prev];
      const currentSourceIdx = next.findIndex((candidate) => candidate.clientKey === fromComp.clientKey);
      const currentDestinationIdx = next.findIndex((candidate) => candidate.clientKey === toComp.clientKey);
      const src = next[currentSourceIdx];
      const dst = next[currentDestinationIdx];
      if (!src || !dst) return prev;
      const currentItemIdx = src.items.findIndex((candidate) => candidate.clientKey === item.clientKey);
      if (currentItemIdx < 0) return prev;
      const srcItems = src.items.filter((candidate) => candidate.clientKey !== item.clientKey);
      const dstItems = [...dst.items, item];
      next[currentSourceIdx] = { ...src, items: srcItems };
      next[currentDestinationIdx] = { ...dst, items: dstItems };
      return next;
    });
    markDirty();
    toast.success(`Moved "${item.name || 'item'}" to ${toComp.name || 'compartment'}`);
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

  const getCompKey = (idx: number) => compartments[idx]?.id ?? `comp-${idx}`;

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
      const deletedIds = new Set(result.deletedItemIds);
      updateCompartmentField(compartmentIdx, {
        items: comp.items.filter((item) => !item.id || !deletedIds.has(item.id)),
      });
      setSelectedItems((prev) => ({ ...prev, [key]: new Set<number>() }));
      delete bulkDeleteIdempotencyKeys.current[key];
      const deletedCount = deletedIds.size;
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
      previous.map((compartment, index) => {
        if ((compartment.id ?? `comp-${index}`) !== compartmentKey) return compartment;
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
      previous.map((compartment, index) =>
        (compartment.id ?? `comp-${index}`) === compartmentKey
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
      runQuickAdd(job);
    } else {
      updateCompartmentField(compartmentIdx, {
        items: [
          ...comp.items,
          {
            ...emptyItem(),
            name,
            ...(payload.inventoryItemId ? { inventoryItemId: payload.inventoryItemId } : {}),
            ...(payload.checkType ? { checkType: payload.checkType } : {}),
            ...(payload.hasExpiration ? { hasExpiration: true } : {}),
          },
        ],
      });
    }
  };

  const handleBulkPaste = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const text = (bulkPasteValues[key] ?? '').trim();
    if (!text) return;

    const names = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    if (comp.id) {
      setBulkItemPending((prev) => ({ ...prev, [key]: true }));
      try {
        const payload = names.map((name) => ({ name }));
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
      const newItems = names.map((n) => ({ ...emptyItem(), name: n }));
      updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
    }

    setBulkPasteValues((prev) => ({ ...prev, [key]: '' }));
    setBulkPasteMode((prev) => ({ ...prev, [key]: false }));
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

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (autoSaveFadeRef.current) {
        clearTimeout(autoSaveFadeRef.current);
      }
      setAutoSaveStatus('saving');
      autoSaveTimerRef.current = setTimeout(() => {
        autoSavePromiseRef.current = ensureDraftBeforeStructureEdit()
          .then(() => schedulingService.updateCheckItem(itemId, patch))
          .then(() => {
            setAutoSaveStatus('saved');
            autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
          })
          .catch(() => {
            setAutoSaveStatus('error');
            autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 4000);
          })
          .finally(() => {
            autoSavePromiseRef.current = null;
          });
      }, 1500);
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
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (autoSavePromiseRef.current) await autoSavePromiseRef.current;
    // Drafts deliberately bypass readiness checks; publication never does.
    const warnings: string[] = [];
    for (const comp of compartments) {
      if (!comp.name.trim()) {
        warnings.push('One or more compartments have no name.');
        break;
      }
    }
    for (const comp of compartments) {
      if (comp.isHeader) continue;
      if (comp.items.length === 0) {
        warnings.push(`Compartment "${comp.name || 'Untitled'}" has no items.`);
        break;
      }
      for (const item of comp.items) {
        if (!item.name.trim()) {
          warnings.push(`One or more items in "${comp.name || 'Untitled'}" have no name.`);
          break;
        }
        if (item.hasExpiration && !item.expirationDate.trim()) {
          warnings.push(`"${item.name || 'Untitled'}" has expiration enabled but no date set.`);
        }
        if (item.checkType === 'count' && !item.requiredQuantity && !item.expectedQuantity) {
          warnings.push(`"${item.name || 'Untitled'}" is a quantity check but has no expected quantity.`);
        }
        if (
          item.checkType === 'count' &&
          item.criticalMinimumQuantity &&
          item.expectedQuantity &&
          Number(item.criticalMinimumQuantity) >= Number(item.expectedQuantity)
        ) {
          warnings.push(`"${item.name || 'Untitled'}" has critical minimum >= expected quantity.`);
        }
        if (item.checkType === 'level' && !item.minLevel) {
          warnings.push(`"${item.name || 'Untitled'}" is a level check but has no minimum level set.`);
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
    newCompartments.forEach((_, i) => expanded.add(`comp-${i}`));
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
        imported.forEach((_, i) => expanded.add(`comp-${i}`));
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
  useOverlaySurface(showChangelog || Boolean(csvPreview) || showPreview);

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
    imported.forEach((_, i) => expanded.add(`comp-${i}`));
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
    compartments.forEach((c, i) => all.add(c.id ?? `comp-${i}`));
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
        id: c.id ?? `preview-comp-${cIdx}`,
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
          id: item.id ?? `preview-item-${cIdx}-${iIdx}`,
          compartmentId: c.id ?? `preview-comp-${cIdx}`,
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

  // ---------------------------------------------------------------------------
  // Template stats
  // ---------------------------------------------------------------------------

  const stats = useMemo(() => {
    const realCompartments = compartments.filter((c) => !c.isHeader);
    const allItems = realCompartments.flatMap((c) => c.items);
    const totalItems = allItems.length;
    const requiredItems = allItems.filter((i) => i.isRequired).length;
    const withExpiration = allItems.filter((i) => i.hasExpiration).length;
    const namedItems = allItems.filter((i) => i.name.trim()).length;
    const namedCompartments = realCompartments.filter((c) => c.name.trim()).length;
    return {
      compartmentCount: realCompartments.length,
      totalItems,
      requiredItems,
      withExpiration,
      completeness: totalItems > 0 ? Math.round((namedItems / totalItems) * 100) : 100,
      namedCompartments,
    };
  }, [compartments]);

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
  // Compartment status helpers
  // ---------------------------------------------------------------------------

  const getCompartmentStatus = (comp: CompartmentFormState): 'complete' | 'warning' | 'empty' => {
    if (comp.items.length === 0) return 'empty';
    const allNamed = comp.items.every((i) => i.name.trim());
    return allNamed ? 'complete' : 'warning';
  };

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

  const renderItem = (
    compIdx: number,
    itemIdx: number,
    item: ItemFormState,
    dragHandleProps?: Record<string, unknown>,
    totalItems?: number
  ) => {
    const itemKey = item.id ?? item.clientKey;
    const isItemExpanded = expandedItems.has(itemKey);
    const checkTypeLabel = CHECK_TYPES.find((ct) => ct.value === item.checkType)?.label ?? item.checkType;
    const compKey = getCompKey(compIdx);
    const isSelected = selectedItems[compKey]?.has(itemIdx) ?? false;
    const isMobileSelectionMode = !isLaptop && mobileSelectionLocations.has(compKey);
    const isInlineEditing = inlineEditKey === itemKey;
    const itemCount = totalItems ?? compartments[compIdx]?.items.length ?? 0;

    const isHeader = item.checkType === 'header';

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

    return (
      <div
        key={itemKey}
        id={`item-row-${itemKey}`}
        tabIndex={-1}
        className={`rounded-md border transition-colors ${
          isSelected
            ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/10'
            : isHeader
              ? 'border-theme-surface-border bg-theme-surface'
              : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        {/* Compact row — always visible */}
        <div className="group/item hover:bg-theme-surface-secondary/50 flex items-center gap-1.5 px-2 transition-colors sm:px-3 sm:py-2">
          {/* Bulk selection checkbox */}
          {(isLaptop || isMobileSelectionMode) && (
            <button
              type="button"
              className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center sm:min-h-0 sm:min-w-0 sm:p-0.5"
              onClick={() => toggleItemSelection(compIdx, itemIdx)}
              aria-label={`${item.name.trim() || 'Item'} selection checkbox`}
            >
              {isSelected ? (
                <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              ) : (
                <Square className="text-theme-text-muted hover:text-theme-text-secondary h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          <button
            type="button"
            className="text-theme-text-muted hidden flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing sm:block"
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to reorder"
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {isHeader && <Type className="text-theme-text-muted hidden h-3.5 w-3.5 flex-shrink-0 sm:block" />}

          {/* Inline editable name */}
          {isInlineEditing ? (
            <input
              ref={inlineInputRef}
              type="text"
              className="text-theme-text-primary focus:ring-theme-focus-ring min-w-0 flex-1 rounded-sm border-b border-blue-400 bg-transparent px-1 text-sm font-medium outline-none focus:ring-2"
              value={inlineEditValue}
              onChange={(e) => setInlineEditValue(e.target.value)}
              onBlur={() => commitInlineEdit(compIdx, itemIdx)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitInlineEdit(compIdx, itemIdx);
                if (e.key === 'Escape') cancelInlineEdit();
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={`min-h-[44px] min-w-0 flex-1 py-2 text-left text-sm sm:flex sm:min-h-0 sm:items-center sm:gap-1.5 sm:py-0 ${isHeader ? 'text-theme-text-primary font-bold' : item.name.trim() ? 'text-theme-text-primary font-medium' : 'text-theme-text-muted italic'}`}
              onDoubleClick={(e) => startInlineEdit(itemKey, item.name, e)}
              onClick={() =>
                isMobileSelectionMode ? toggleItemSelection(compIdx, itemIdx) : toggleItemExpanded(itemKey)
              }
              aria-expanded={isMobileSelectionMode ? undefined : isItemExpanded}
              aria-label={
                isMobileSelectionMode
                  ? `${isSelected ? 'Deselect' : 'Select'} ${item.name.trim() || 'item'}`
                  : `${isItemExpanded ? 'Collapse' : 'Expand'} ${item.name.trim() || 'item'}`
              }
            >
              <span className="block truncate">
                {item.name.trim() || (isHeader ? 'Untitled Header' : 'Untitled Item')}
              </span>
              <span className="text-theme-text-muted mt-0.5 block truncate text-xs font-normal sm:hidden">
                {checkTypeLabel}
                {item.checkType === 'count' && item.expectedQuantity ? ` · Par ${item.expectedQuantity}` : ''}
                {item.checkType === 'level' && item.minLevel
                  ? ` · Minimum ${item.minLevel}${item.levelUnit ? ` ${item.levelUnit}` : ''}`
                  : ''}
                {item.isRequired ? ' · Required' : ''}
                {item.hasExpiration ? ' · Expiration tracked' : ''}
              </span>
              {!isMobileSelectionMode &&
                (isItemExpanded ? (
                  <ChevronDown
                    className="text-theme-text-muted hidden h-3.5 w-3.5 shrink-0 sm:block"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="text-theme-text-muted hidden h-3.5 w-3.5 shrink-0 sm:block"
                    aria-hidden="true"
                  />
                ))}
            </button>
          )}

          <button
            type="button"
            className="text-theme-text-muted hidden flex-shrink-0 p-0.5 transition-opacity hover:text-blue-600 sm:block sm:opacity-0 sm:group-hover/item:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              startInlineEdit(itemKey, item.name, e);
            }}
            aria-label={`Rename ${item.name.trim() || 'item'}`}
          >
            <Pencil className="h-3 w-3" />
          </button>

          {/* Badges */}
          <div className="hidden flex-shrink-0 items-center gap-1.5 sm:flex">
            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
              {checkTypeLabel}
            </span>
            {item.isRequired && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                Req
              </span>
            )}
            {item.hasExpiration && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
          </div>

          {/* Actions — stop propagation so clicking them doesn't toggle expansion */}
          <div className="hidden flex-shrink-0 items-center gap-0.5 sm:flex" onClick={(e) => e.stopPropagation()}>
            {/* Move up/down buttons */}
            <button
              type="button"
              onClick={() => void moveItem(compIdx, itemIdx, 'up')}
              disabled={itemIdx === 0}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Move ${item.name || 'item'} up`}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void moveItem(compIdx, itemIdx, 'down')}
              disabled={itemIdx === itemCount - 1}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Move ${item.name || 'item'} down`}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void duplicateItem(compIdx, itemIdx)}
              className="text-theme-text-muted rounded p-1 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
              aria-label={`Duplicate ${item.name || 'item'}`}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {compartments.some(
              (candidate, candidateIdx) =>
                candidateIdx !== compIdx && !candidate.isHeader && (!isEditing || !item.id || Boolean(candidate.id))
            ) && (
              <div className="text-theme-text-muted relative rounded p-1 transition-colors hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/20">
                <ArrowRightLeft className="pointer-events-none h-3.5 w-3.5" aria-hidden="true" />
                <select
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  value=""
                  onChange={(e) => {
                    const targetIdx = Number(e.target.value);
                    if (!Number.isNaN(targetIdx)) {
                      void moveItemToCompartment(compIdx, itemIdx, targetIdx);
                    }
                    e.target.value = '';
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Move ${item.name || 'item'} to another compartment`}
                >
                  <option value="" disabled>
                    Move to…
                  </option>
                  {compartments.map((c, ci) =>
                    ci !== compIdx && !c.isHeader && (!isEditing || !item.id || Boolean(c.id)) ? (
                      <option key={ci} value={ci}>
                        {compartmentPath(ci)}
                      </option>
                    ) : null
                  )}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => void deleteItem(compIdx, itemIdx)}
              className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label={`Delete ${item.name || 'item'}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <MobileActionMenu label={`Actions for ${item.name.trim() || 'item'}`}>
            <button
              type="button"
              className={mobileMenuItemClass}
              onClick={(e) => startInlineEdit(itemKey, item.name, e)}
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
                    !candidate.isHeader &&
                    candidateIdx !== compIdx &&
                    (!isEditing || !item.id || Boolean(candidate.id)) ? (
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
          </MobileActionMenu>
        </div>

        {/* Expanded form — visible on click */}
        {isItemExpanded && (
          <div className="border-theme-surface-border space-y-3 border-t px-3 py-3">
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
              <div>
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
                        onChange={(e) =>
                          updateItemFieldWithAutoSave(compIdx, itemIdx, { isRequired: e.target.checked })
                        }
                      />
                      Required
                    </label>
                  </div>

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
                        <p className="text-theme-text-secondary mb-1 text-xs">
                          Below this = urgent alert to leadership
                        </p>
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
                              onChange={(e) =>
                                updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: e.target.value })
                              }
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
                          onChange={(e) =>
                            updateItemFieldWithAutoSave(compIdx, itemIdx, { serialNumber: e.target.value })
                          }
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
                      onChange={(e) =>
                        updateItemFieldWithAutoSave(compIdx, itemIdx, { hasExpiration: e.target.checked })
                      }
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
                          onChange={(e) =>
                            updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationDate: e.target.value })
                          }
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
              </>
            )}
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

  const renderCompartment = (
    comp: CompartmentFormState,
    idx: number,
    dragHandleProps?: Record<string, unknown>,
    sortableRef?: React.Ref<HTMLDivElement>,
    sortableStyle?: React.CSSProperties,
    sortableAttributes?: DraggableAttributes,
    depth = 0
  ) => {
    const key = comp.id ?? `comp-${idx}`;
    const isExpanded = expandedCompartments.has(key);
    const typeLabel = containerTypeLabel(comp.containerType);
    const parentName = comp.parentCompartmentId
      ? compartments.find((c) => c.id === comp.parentCompartmentId)?.name
      : undefined;
    // Section header compartment — simplified visual divider
    if (comp.isHeader) {
      return (
        <div key={key} ref={sortableRef} style={sortableStyle} {...(sortableAttributes ?? {})} className="card">
          <div className="flex items-center gap-1.5 px-2 py-3 sm:gap-2 sm:px-4">
            <button
              type="button"
              className="text-theme-text-muted hidden flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing sm:block"
              aria-label={comp.id ? 'Drag to reorder section among siblings' : 'Save before dragging this section'}
              disabled={!comp.id}
              title={!comp.id ? 'Save before dragging unsaved records' : 'Reorder among sibling sections'}
              {...(dragHandleProps ?? {})}
            >
              <GripVertical className="h-5 w-5" />
            </button>

            <Type className="text-theme-text-muted h-4 w-4 flex-shrink-0" />

            <input
              type="text"
              className="text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring min-w-0 flex-1 rounded-sm border-none bg-transparent text-sm font-bold outline-none placeholder:font-normal focus:ring-2"
              placeholder="Section heading..."
              value={comp.name}
              onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
            />

            <span className="bg-theme-surface-secondary text-theme-text-muted flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
              Section
            </span>

            <div className="hidden flex-shrink-0 items-center gap-0.5 sm:flex">
              <button
                type="button"
                onClick={() => void moveCompartment(idx, 'up')}
                disabled={!canMoveCompartment(compartments, comp.id, 'up')}
                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Move section up"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void moveCompartment(idx, 'down')}
                disabled={!canMoveCompartment(compartments, comp.id, 'down')}
                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Move section down"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void deleteCompartment(idx)}
                className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label="Delete section header"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <MobileActionMenu label={`Actions for ${comp.name || 'section'}`}>
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
              <button
                type="button"
                className={mobileDestructiveMenuItemClass}
                onClick={() => void deleteCompartment(idx)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </button>
            </MobileActionMenu>
          </div>
          {comp.description && (
            <div className="-mt-1 px-4 pb-2">
              <p className="text-theme-text-muted text-xs">{comp.description}</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={key}
        ref={sortableRef}
        style={sortableStyle}
        {...(sortableAttributes ?? {})}
        /* Deliberately not `overflow-hidden`: the quick-add bar is the last
           thing in the body and its results dropdown is absolutely positioned
           below it, so a clip here cut the first result in half and hid the
           rest whatever z-index it carried. Every child sits on the same
           surface colour as the card, so the rounded corners stay clean
           without one — the header just rounds its own top corners. */
        className="card border-l-4 border-l-blue-500/50"
      >
        {/* Compartment header */}
        <div className="bg-theme-surface flex items-center gap-1.5 rounded-t-lg px-2 py-3 sm:gap-2 sm:px-4">
          <button
            type="button"
            className="text-theme-text-muted hidden flex-shrink-0 cursor-grab touch-none p-0.5 active:cursor-grabbing sm:block"
            aria-label={
              comp.id ? 'Drag to reorder compartment among siblings' : 'Save before dragging this compartment'
            }
            disabled={!comp.id}
            title={!comp.id ? 'Save before dragging unsaved records' : 'Reorder among sibling compartments'}
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => toggleCompartmentExpanded(key)}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left sm:min-h-0"
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronUp className="text-theme-text-muted h-4 w-4 flex-shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="text-theme-text-muted h-4 w-4 flex-shrink-0" aria-hidden="true" />
            )}
            {depth > 0 && <Package className="text-theme-text-muted h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
            <span className="text-theme-text-primary truncate font-medium">{comp.name || `Untitled ${typeLabel}`}</span>
            <span className="bg-theme-surface-secondary text-theme-text-muted flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
              {typeLabel}
            </span>
            {parentName && (
              <span className="text-theme-text-muted hidden flex-shrink-0 truncate text-[10px] md:inline">
                in {parentName}
              </span>
            )}
          </button>

          {/* Status badges */}
          <div className="hidden flex-shrink-0 items-center gap-1.5 sm:flex">
            {(() => {
              const status = getCompartmentStatus(comp);
              return (
                <>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      status === 'complete'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {status === 'complete' && <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />}
                    {status === 'warning' && <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />}
                    {status === 'empty' && <Circle className="h-2.5 w-2.5" aria-hidden="true" />}
                    {comp.items.length} item{comp.items.length !== 1 ? 's' : ''}
                  </span>
                  {comp.items.filter((i) => i.isRequired).length > 0 && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                      {comp.items.filter((i) => i.isRequired).length} req
                    </span>
                  )}
                </>
              );
            })()}
          </div>

          {/* Move up/down + delete */}
          <div className="hidden flex-shrink-0 items-center gap-0.5 sm:flex">
            <button
              type="button"
              onClick={() => void moveCompartment(idx, 'up')}
              disabled={!canMoveCompartment(compartments, comp.id, 'up')}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Move ${comp.name || 'compartment'} up`}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void moveCompartment(idx, 'down')}
              disabled={!canMoveCompartment(compartments, comp.id, 'down')}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Move ${comp.name || 'compartment'} down`}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void duplicateCompartment(idx)}
              className="text-theme-text-muted rounded p-1 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
              aria-label={`Duplicate ${comp.name || 'compartment'}`}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void deleteCompartment(idx)}
              className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label={`Delete ${comp.name || 'compartment'}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <MobileActionMenu label={`Actions for ${comp.name || 'compartment'}`}>
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
            <button type="button" className={mobileMenuItemClass} onClick={() => void duplicateCompartment(idx)}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate
            </button>
            <label className={`${mobileMenuItemClass} flex-col items-stretch gap-1`}>
              <span className="flex items-center gap-3">
                <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Move to compartment
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
          </MobileActionMenu>
        </div>

        {/* Compartment body */}
        {isExpanded && (
          <div className="border-theme-surface-border space-y-4 border-t px-4 py-4">
            {/* Compartment fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`comp-name-${key}`} className={labelClass}>
                  {typeLabel} Name
                </label>
                <input
                  id={`comp-name-${key}`}
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Driver Side, Trauma Bag, IV Pack"
                  value={comp.name}
                  onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`comp-desc-${key}`} className={labelClass}>
                  Description
                </label>
                <input
                  id={`comp-desc-${key}`}
                  type="text"
                  className={inputClass}
                  placeholder="Optional description"
                  value={comp.description}
                  onChange={(e) => updateCompartmentField(idx, { description: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Storage type: presets + a free-text "Custom…" option so each
                  department can describe how their equipment is stored. */}
              {(() => {
                const inCustom = customContainerKeys.has(key) || !isPresetContainerType(comp.containerType);
                return (
                  <div>
                    <label className={labelClass}>
                      <Package className="mr-1 inline h-3.5 w-3.5" />
                      Storage Type
                    </label>
                    <select
                      className={selectClass}
                      aria-label="Storage type"
                      value={inCustom ? '__custom__' : comp.containerType || 'compartment'}
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
                    {inCustom && (
                      <input
                        type="text"
                        className={`${inputClass} mt-2`}
                        placeholder="e.g. Trauma Kit, Top Shelf, Red Bag"
                        aria-label="Custom storage type label"
                        value={comp.containerType}
                        onChange={(e) => updateCompartmentField(idx, { containerType: e.target.value })}
                      />
                    )}
                  </div>
                );
              })()}
              <div>
                <label className={labelClass}>Reparent: stored inside</label>
                <select
                  className={selectClass}
                  value={comp.parentCompartmentId}
                  onChange={(e) => updateCompartmentField(idx, { parentCompartmentId: e.target.value })}
                >
                  <option value="">Nothing (top-level)</option>
                  {storedInsideOptions(compartments, comp).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* A sealed container's contents cannot change while it sits
                  shut, so a crew that finds the seal intact and matching the
                  last count does not need to open it. Only dates and pressures
                  still need eyes on — those move on their own. */}
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="form-checkbox mt-0.5"
                    checked={comp.isSealed}
                    onChange={(e) => updateCompartmentField(idx, { isSealed: e.target.checked })}
                  />
                  <span>
                    <span className="text-theme-text-primary block text-sm font-medium">Closed with a tamper seal</span>
                    <span className="text-theme-text-muted block text-xs">
                      A crew that finds the seal intact and matching the last count clears every presence and quantity
                      check inside in one tap. Expiry dates and readings still have to be checked.
                    </span>
                  </span>
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>
                  <Image className="mr-1 inline h-3.5 w-3.5" />
                  Image URL
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="https://..."
                  value={comp.imageUrl}
                  onChange={(e) => updateCompartmentField(idx, { imageUrl: e.target.value })}
                />
              </div>
            </div>

            {/* Items */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex min-h-[44px] items-center gap-3">
                    <h4 className="text-theme-text-primary text-sm font-semibold">
                      {mobileSelectionLocations.has(getCompKey(idx)) ? 'Select items' : 'Items to check'}
                    </h4>
                    {comp.items.length > 0 && !isLaptop && (
                      <button
                        type="button"
                        className="ml-auto min-h-[44px] px-2 text-sm font-medium text-blue-600 sm:hidden dark:text-blue-400"
                        onClick={() => setMobileSelectionMode(idx, !mobileSelectionLocations.has(getCompKey(idx)))}
                      >
                        {mobileSelectionLocations.has(getCompKey(idx)) ? 'Done' : 'Select items'}
                      </button>
                    )}
                  </div>
                  <p className="text-theme-text-muted text-xs">Add equipment or a plain-language task for the crew.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {comp.id && (
                    <button
                      type="button"
                      onClick={() => void addCompartment(comp.id)}
                      className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-medium"
                    >
                      <Package className="h-3.5 w-3.5" /> Add inside this location
                    </button>
                  )}
                  {/* Bulk selection controls */}
                  {comp.items.length > 0 && (
                    <div className="hidden flex-wrap items-center gap-1 sm:flex">
                      {getSelectedCount(idx) > 0 ? (
                        <>
                          <span className="mr-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                            {getSelectedCount(idx)} selected
                          </span>
                          {/* Bulk edit: set check type */}
                          <select
                            className="form-input border-blue-300 px-2 py-1 text-xs font-medium text-blue-600 dark:border-blue-700 dark:text-blue-400"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                bulkSetCheckType(idx, e.target.value as CheckType);
                              }
                            }}
                          >
                            <option value="" disabled>
                              Set type...
                            </option>
                            {CHECK_TYPES.map((ct) => (
                              <option key={ct.value} value={ct.value}>
                                {ct.label}
                              </option>
                            ))}
                          </select>
                          {/* Bulk edit: toggle required */}
                          <button
                            type="button"
                            onClick={() => {
                              const compKey = getCompKey(idx);
                              const selected = selectedItems[compKey];
                              const allRequired = selected && [...selected].every((i) => comp.items[i]?.isRequired);
                              bulkToggleRequired(idx, !allRequired);
                            }}
                            className="flex items-center gap-1 rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                            title="Toggle required status for selected items"
                          >
                            {(() => {
                              const compKey = getCompKey(idx);
                              const selected = selectedItems[compKey];
                              const allRequired = selected && [...selected].every((i) => comp.items[i]?.isRequired);
                              return allRequired ? 'Set Optional' : 'Set Required';
                            })()}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteSelectedItems(idx)}
                            className="flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                            aria-label="Delete selected items"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => deselectAllItems(idx)}
                            className="text-theme-text-muted hover:text-theme-text-primary rounded-md px-2 py-1 text-xs transition-colors"
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectAllItems(idx)}
                          className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
                          title="Select all items"
                        >
                          <CheckSquare className="h-3 w-3" />
                          Select all
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const compKey = getCompKey(idx);
                      setShowEquipmentPresets((prev) => ({ ...prev, [compKey]: !prev[compKey] }));
                    }}
                    className="flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-500/20 dark:text-green-400"
                    title="Add a pre-built equipment kit"
                  >
                    <Package className="h-3.5 w-3.5" />
                    Add Kit
                  </button>
                  <button
                    type="button"
                    onClick={() => void addHeader(idx)}
                    className="border-theme-surface-border text-theme-text-muted hover:border-theme-text-primary hover:text-theme-text-primary flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-colors"
                  >
                    <Type className="h-3.5 w-3.5" />
                    Header
                  </button>
                </div>
              </div>

              {/* Equipment Preset Picker */}
              {(showEquipmentPresets[getCompKey(idx)] ?? false) && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-theme-text-primary text-xs font-medium">Add equipment kit:</p>
                    <button
                      type="button"
                      onClick={() => setShowEquipmentPresets((prev) => ({ ...prev, [getCompKey(idx)]: false }))}
                      className="text-theme-text-muted hover:text-theme-text-primary p-0.5"
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
                        disabled={bulkItemPending[getCompKey(idx)] ?? false}
                        className="btn-secondary px-2 py-1.5 text-left text-xs hover:border-green-500/40 hover:bg-green-500/10"
                      >
                        <span className="font-medium">{preset.label}</span>
                        <span className="text-theme-text-muted block text-[10px]">{preset.items.length} items</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {comp.items.length === 0 && (
                <p className="text-theme-text-muted py-2 text-sm italic">
                  No items yet. Type a name below and press Enter, or use &ldquo;Add Kit&rdquo; for pre-built groups.
                </p>
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
                      {({ listeners: itemListeners }) =>
                        renderItem(idx, itemIdx, item, itemListeners, comp.items.length)
                      }
                    </SortableItemWrapper>
                  ))}
                </SortableContext>
              </DndContext>

              {/* Quick-add bar */}
              {(() => {
                const compKey = getCompKey(idx);
                const isBulkPaste = bulkPasteMode[compKey] ?? false;

                return (
                  <div className="border-theme-surface-border bg-theme-surface-secondary/30 mt-2 rounded-md border border-dashed p-2">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-theme-text-muted text-[10px] font-medium tracking-wide uppercase">
                        {isBulkPaste ? 'Bulk Add' : 'Quick Add'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setBulkPasteMode((prev) => ({ ...prev, [compKey]: !isBulkPaste }))}
                        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                          isBulkPaste
                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-theme-text-muted hover:text-theme-text-secondary'
                        }`}
                        title={isBulkPaste ? 'Switch to single add' : 'Switch to bulk paste (one item per line)'}
                      >
                        <List className="h-3 w-3" />
                        {isBulkPaste ? 'Single' : 'Bulk'}
                      </button>
                    </div>
                    {isBulkPaste ? (
                      <div className="space-y-1.5">
                        <textarea
                          className="form-input text-sm"
                          rows={4}
                          placeholder="Paste item names here, one per line&#10;e.g.&#10;Flashlight&#10;Radio&#10;First aid kit"
                          value={bulkPasteValues[compKey] ?? ''}
                          onChange={(e) => setBulkPasteValues((prev) => ({ ...prev, [compKey]: e.target.value }))}
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-theme-text-muted text-[10px]">
                            {(() => {
                              const lines = (bulkPasteValues[compKey] ?? '').split('\n').filter((l) => l.trim()).length;
                              return lines > 0 ? `${lines} item${lines !== 1 ? 's' : ''} to add` : 'Paste a list';
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleBulkPaste(idx)}
                            disabled={
                              (bulkPasteValues[compKey] ?? '').trim().length === 0 ||
                              (bulkItemPending[compKey] ?? false)
                            }
                            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                          >
                            {(bulkItemPending[compKey] ?? false) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                            {(bulkItemPending[compKey] ?? false) ? 'Adding…' : 'Add All'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <CatalogQuickAdd
                        value={quickAddValues[compKey] ?? ''}
                        onChange={(v) => setQuickAddValues((prev) => ({ ...prev, [compKey]: v }))}
                        onAdd={(payload) => handleQuickAdd(idx, payload)}
                        canCreateInventory={canManageInventory}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
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

  const renderSidebar = () => (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className={labelClass}>
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          className={inputClass}
          placeholder="e.g. Engine Daily Check"
          value={form.name}
          onChange={(e) => updateForm({ name: e.target.value })}
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          className={inputClass}
          rows={2}
          placeholder="Describe what this template covers..."
          value={form.description}
          onChange={(e) => updateForm({ description: e.target.value })}
        />
      </div>

      {/* Check Timing */}
      <div className="border-theme-surface-border border-t pt-4">
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
              className={`min-h-9 rounded-md px-2 text-xs font-medium transition-colors ${form.checkTiming === value ? 'bg-theme-surface text-theme-text-primary shadow-sm ring-1 ring-blue-500/20' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
              aria-pressed={form.checkTiming === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Template Type */}
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

      {/* Assigned Positions */}
      <div>
        <label className={labelClass}>Who completes it?</label>
        <p className="text-theme-text-muted -mt-1 mb-2 text-[11px]">
          Leave blank to make it available to the whole crew.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {POSITIONS.map((pos) => (
            <label
              key={pos}
              className={`flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs capitalize transition-colors ${form.assignedPositions.includes(pos) ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary'}`}
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

      {/* Apparatus Type */}
      <div className="border-theme-surface-border border-t pt-4">
        <label className={labelClass}>Where will it be used?</label>
        <select
          className={selectClass}
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
      </div>

      {/* Specific Apparatus */}
      <div>
        <label className={labelClass}>Specific Apparatus</label>
        <select
          className={selectClass}
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
        <p className="text-theme-text-muted mt-1 text-xs">
          Leave as &quot;All of type&quot; to use this template as the default for all{' '}
          {form.apparatusType || 'apparatus'} units
        </p>
      </div>
    </div>
  );

  const setupReady = Boolean(form.name.trim() && form.checkTiming && form.templateType);
  const structureReady = compartments.some((comp) => !comp.isHeader);
  const itemsReady = stats.totalItems > 0;
  const blockingItems = compartments
    .flatMap((comp) => comp.items)
    .filter(
      (item) =>
        !item.name.trim() ||
        (item.checkType === 'count' && !item.requiredQuantity && !item.expectedQuantity) ||
        (item.checkType === 'level' && !item.minLevel)
    ).length;
  const locationsReady =
    structureReady && compartments.every((comp) => comp.name.trim() && (comp.isHeader || comp.items.length > 0));
  const publishReady = setupReady && locationsReady && blockingItems === 0;

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="pb-16">
      {/* Header */}
      <div className="mx-auto mb-3 flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void handleLeave()}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface flex-shrink-0 rounded-md p-2 transition-colors"
            title="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-theme-text-primary truncate text-2xl font-bold">
            {isEditing ? `Edit: ${form.name || 'Template'}` : 'New Equipment Check Template'}
          </h1>
          <span
            aria-label="Template status"
            className={`rounded-full px-2 py-1 text-xs font-semibold ${
              form.isActive
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            {form.isActive ? 'Published' : 'Draft'}
          </span>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <details className="relative">
            <summary className="btn-secondary hover:bg-theme-surface-secondary flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium sm:min-h-10">
              <MoreHorizontal className="h-4 w-4" />
              Tools
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
            </div>
          </details>
          <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportTemplate} />
          <input ref={csvImportRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
          {templateId && coverage && coverage.linkable > 0 && (
            <button
              type="button"
              onClick={() => setShowInventoryMatch(true)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                coverage.unlinked > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400'
                  : 'border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary'
              }`}
              title={
                coverage.unlinked > 0
                  ? `${coverage.unlinked} item(s) are not linked to inventory, so their expiration and stock are not tracked`
                  : 'Every item is linked to inventory'
              }
            >
              <Link2 className="h-4 w-4" />
              <span className="hidden sm:inline">
                {coverage.linked}/{coverage.linkable} linked
              </span>
              <span className="sm:hidden">
                {coverage.linked}/{coverage.linkable}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            disabled={compartments.length === 0}
            className="btn-secondary hover:bg-theme-surface-secondary flex min-h-11 items-center gap-2 px-3 text-sm font-medium sm:min-h-10"
          >
            <Eye className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Preview</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={saving}
            className="btn-secondary flex min-h-11 items-center gap-2 px-3 text-sm font-medium sm:min-h-10"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={saving || !publishReady}
            className="flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10"
          >
            <CheckCircle2 className="h-4 w-4" /> Publish
          </button>
        </div>
      </div>

      <div className="mx-auto mb-5 grid max-w-7xl grid-cols-3 overflow-hidden rounded-xl border border-blue-500/15 bg-blue-500/5">
        {[
          { number: 1, label: 'Set up', detail: setupReady ? 'Basics ready' : 'Name and assign', ready: setupReady },
          {
            number: 2,
            label: 'Build',
            detail: structureReady ? `${stats.compartmentCount} locations` : 'Add locations',
            ready: structureReady,
          },
          {
            number: 3,
            label: 'Review',
            detail: itemsReady ? `${stats.totalItems} items` : 'Preview checklist',
            ready: itemsReady,
          },
        ].map((step, index) => (
          <div
            key={step.label}
            className={`flex items-center gap-2 px-3 py-2.5 sm:px-4 ${index > 0 ? 'border-l border-blue-500/15' : ''}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.ready ? 'bg-green-500 text-white' : index === 0 || (index === 1 && setupReady) || (index === 2 && structureReady) ? 'bg-blue-600 text-white' : 'bg-theme-surface text-theme-text-muted border-theme-surface-border border'}`}
            >
              {step.ready ? <CheckCircle2 className="h-4 w-4" /> : step.number}
            </span>
            <span className="min-w-0">
              <span className="text-theme-text-primary block text-xs font-semibold sm:text-sm">{step.label}</span>
              <span className="text-theme-text-muted hidden truncate text-xs sm:block">{step.detail}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="card mx-auto mb-5 max-w-7xl p-4" aria-label="Template readiness">
        <h2 className="text-theme-text-primary mb-2 text-sm font-semibold">Template readiness</h2>
        <div className="text-theme-text-secondary grid gap-1 text-sm sm:grid-cols-3">
          <span>{setupReady ? '✓' : '!'} Setup</span>
          <span>{locationsReady ? '✓' : '!'} Locations</span>
          <span>{blockingItems === 0 ? '✓ Items configured' : `! ${blockingItems} items need configuration`}</span>
        </div>
        {!publishReady && (
          <p className="text-theme-text-muted mt-2 text-xs">
            Save this work as a draft. Publish becomes available after every blocking issue is fixed.
          </p>
        )}
      </div>

      {/* Sidebar + Main content */}
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Sidebar — Template details */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-all duration-200 ${sidebarOpen ? 'block w-full lg:w-72' : 'hidden lg:block lg:w-0'}`}
        >
          <div className="card w-full p-4 lg:sticky lg:top-4 lg:w-72">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-theme-text-primary text-sm font-semibold">Checklist setup</h2>
                <p className="text-theme-text-muted text-[11px]">Name it, schedule it, and choose who sees it.</p>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-theme-text-muted hover:text-theme-text-primary rounded p-1 transition-colors lg:hidden"
                title="Close sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            {renderSidebar()}
          </div>
        </div>

        {/* Main — Compartments */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Sidebar toggle (when collapsed) + section header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface flex min-h-10 items-center gap-2 rounded-md border px-2.5 transition-colors"
                  title="Show template details"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  <span className="text-xs font-medium lg:hidden">Setup</span>
                </button>
              )}
              <div>
                <h2 className="text-theme-text-primary text-lg font-semibold">Locations &amp; groups</h2>
                <p className="text-theme-text-muted text-xs">
                  Organize the checklist the way equipment is stored on the apparatus.
                </p>
              </div>
              {compartments.length > 1 && (
                <button
                  type="button"
                  onClick={
                    expandedCompartments.size === compartments.length ? collapseAllCompartments : expandAllCompartments
                  }
                  className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 text-xs transition-colors"
                  title={expandedCompartments.size === compartments.length ? 'Collapse all' : 'Expand all'}
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  {expandedCompartments.size === compartments.length ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(form.templateType === 'vehicle' || form.templateType === 'combined') && (
                <button
                  type="button"
                  onClick={() => setShowPresetPicker(!showPresetPicker)}
                  className="flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
                >
                  <Truck className="h-4 w-4" />
                  Load Vehicle Preset
                </button>
              )}
              <button
                type="button"
                disabled={addingSection}
                onClick={() => void addSectionHeader()}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary hover:text-theme-text-primary flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Type className="h-4 w-4" />
                Add Section
              </button>
              <button
                type="button"
                disabled={addingCompartment}
                onClick={() => void addCompartment()}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Add Location
              </button>
            </div>
          </div>

          {/* Vehicle Preset Picker */}
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

          {compartments.length === 0 && (
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
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleCompartmentDragEnd(event)}
          >
            <SortableContext items={compartmentIds} strategy={verticalListSortingStrategy}>
              {orderedCompartments.map(({ comp, idx, depth }) => {
                const id = compartmentKey(comp, idx);
                return (
                  <div
                    key={id}
                    style={depth > 0 ? { marginLeft: depth * 20 } : undefined}
                    className={depth > 0 ? 'border-theme-surface-border/60 border-l-2 pl-2' : undefined}
                  >
                    <SortableCompartmentWrapper id={id} disabled={!comp.id}>
                      {({ listeners: compListeners, setNodeRef, style, attributes }) =>
                        renderCompartment(comp, idx, compListeners, setNodeRef, style, attributes, depth)
                      }
                    </SortableCompartmentWrapper>
                  </div>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Sticky footer stats bar */}
      {stats.totalItems > 0 && (
        <div className="border-theme-surface-border bg-theme-surface/95 pb-safe fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-0">
            <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {stats.compartmentCount} compartment{stats.compartmentCount !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {stats.totalItems} item{stats.totalItems !== 1 ? 's' : ''}
              </span>
              {stats.requiredItems > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <AlertTriangle className="h-3 w-3" />
                  {stats.requiredItems} required
                </span>
              )}
              {stats.withExpiration > 0 && (
                <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                  <Clock className="h-3 w-3" />
                  {stats.withExpiration} with expiration
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {autoSaveStatus === 'saving' && (
                <span className="flex animate-pulse items-center gap-1 text-xs text-blue-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {autoSaveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Saved
                </span>
              )}
              {autoSaveStatus === 'error' && (
                <span className="flex items-center gap-1 text-xs text-red-500">
                  <AlertTriangle className="h-3 w-3" />
                  Save failed
                </span>
              )}
              {!isEditing && <span className="text-theme-text-muted flex items-center gap-1 text-xs">Draft</span>}
              {stats.completeness < 100 && (
                <span className="text-xs text-yellow-600 dark:text-yellow-400">{stats.completeness}% items named</span>
              )}
              <div className="bg-theme-surface-border h-1.5 w-20 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full transition-all ${stats.completeness === 100 ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${stats.completeness}%` }}
                />
              </div>
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
            <div className="bg-theme-surface relative w-[375px] max-w-[90vw] overflow-hidden rounded-[2.5rem] border-[6px] border-gray-800 shadow-2xl dark:border-gray-600">
              {/* Phone notch */}
              <div className="relative flex h-7 items-end justify-center bg-gray-800 dark:bg-gray-600">
                <div className="h-5 w-28 rounded-b-2xl bg-gray-800 dark:bg-gray-600" />
              </div>

              {/* Phone status bar */}
              <div className="bg-theme-surface text-theme-text-muted flex items-center justify-between px-6 py-1 text-[10px]">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <div className="border-theme-text-muted relative h-2.5 w-6 rounded-sm border">
                    <div className="bg-theme-text-muted absolute inset-0.5 rounded-[1px]" style={{ width: '75%' }} />
                  </div>
                </div>
              </div>

              {/* Scrollable content area */}
              <div className="bg-theme-surface overflow-y-auto" style={{ height: 'min(70vh, 640px)' }}>
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
              <div className="bg-theme-surface flex justify-center py-2">
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
