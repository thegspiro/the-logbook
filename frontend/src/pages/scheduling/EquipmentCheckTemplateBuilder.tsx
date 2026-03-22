/**
 * Equipment Check Template Builder
 *
 * Admin page for creating and editing equipment check templates with
 * compartments and items. Supports nested compartments, multiple check
 * types, expiration tracking, and drag-handle placeholders for reordering.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DraggableAttributes } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getErrorMessage } from '@/utils/errorHandling';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { schedulingService } from '@/modules/scheduling';
import { EquipmentCheckForm } from '@/pages/scheduling/EquipmentCheckForm';
import type {
  EquipmentCheckTemplate,
  EquipmentCheckTemplateCreate,
  CheckTemplateCompartmentCreate,
  CheckTemplateItemCreate,
  CheckTemplateItem,
  CheckType,
  TemplateType,
} from '@/modules/scheduling/types/equipmentCheck';
import {
  TEMPLATE_TYPE_LABELS,
} from '@/modules/scheduling/types/equipmentCheck';

// ============================================================================
// Constants
// ============================================================================

const POSITIONS = [
  'officer',
  'driver',
  'firefighter',
  'ems',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
] as const;

const APPARATUS_TYPES = [
  'engine',
  'ladder',
  'ambulance',
  'rescue',
  'tanker',
  'brush',
  'tower',
  'hazmat',
  'boat',
  'chief',
  'utility',
] as const;

const CHECK_TYPES = [
  { value: 'pass_fail', label: 'Pass / Fail' },
  { value: 'present', label: 'Present' },
  { value: 'functional', label: 'Functional' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'level', label: 'Level' },
  { value: 'date_lot', label: 'Date / Lot' },
  { value: 'reading', label: 'Reading' },
] as const;

const LEVEL_UNIT_PRESETS = [
  'psi',
  '%',
  'gallons',
  'liters',
  'inches',
  'feet',
  'bar',
  'mmHg',
  'quarts',
] as const;

const CHECK_TYPE_HELP: Record<string, string> = {
  pass_fail: 'Simple pass or fail check. Good for binary inspections like "lights working" or "no visible damage".',
  present: 'Verify the item is present. Use for mandatory equipment that must be on the apparatus.',
  functional: 'Test that the item works correctly. Similar to pass/fail but implies active testing.',
  quantity: 'Count items and compare against a required minimum. Shows fields for required and expected quantities.',
  level: 'Read a gauge or measure a level (e.g., fuel, pressure, fluid). Shows min level and unit fields.',
  date_lot: 'Track serial/lot numbers and verify against expected values. Good for medical supplies and dated items.',
  reading: 'Record a numeric reading without a pass/fail threshold. Good for odometer, hour meters, etc.',
};

// Pre-built vehicle check compartment templates by apparatus type
interface VehiclePreset {
  label: string;
  compartments: { name: string; items: { name: string; checkType: CheckType }[] }[];
}

const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
  engine: {
    label: 'Engine / Pumper',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren', checkType: 'functional' },
          { name: 'Horn', checkType: 'functional' },
          { name: 'Mirrors', checkType: 'functional' },
          { name: 'Windshield wipers / washer', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body damage / fluid leaks', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Power steering fluid', checkType: 'level' },
          { name: 'Belts & hoses condition', checkType: 'pass_fail' },
          { name: 'Battery condition & connections', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Pump Panel',
        items: [
          { name: 'Pump engages properly', checkType: 'functional' },
          { name: 'Gauges operational', checkType: 'functional' },
          { name: 'Primer works', checkType: 'functional' },
          { name: 'Pump panel lights', checkType: 'functional' },
          { name: 'Drain valves closed', checkType: 'pass_fail' },
          { name: 'Tank water level', checkType: 'level' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'functional' },
          { name: 'Parking brake', checkType: 'functional' },
          { name: 'Transmission (all gears)', checkType: 'functional' },
          { name: 'Steering responsiveness', checkType: 'functional' },
        ],
      },
      {
        name: 'Safety & Cab Interior',
        items: [
          { name: 'Seat belts', checkType: 'functional' },
          { name: 'SCBA mounted & secured', checkType: 'present' },
          { name: 'Radio(s) operational', checkType: 'functional' },
          { name: 'MDT / computer operational', checkType: 'functional' },
          { name: 'Cab clean & organized', checkType: 'pass_fail' },
        ],
      },
    ],
  },
  ladder: {
    label: 'Ladder / Tower',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren', checkType: 'functional' },
          { name: 'Horn', checkType: 'functional' },
          { name: 'Mirrors', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body damage / fluid leaks', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Belts & hoses condition', checkType: 'pass_fail' },
          { name: 'Battery condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Aerial Device',
        items: [
          { name: 'Aerial extends & retracts', checkType: 'functional' },
          { name: 'Aerial rotation', checkType: 'functional' },
          { name: 'Outriggers / stabilizers deploy', checkType: 'functional' },
          { name: 'Aerial hydraulic fluid level', checkType: 'level' },
          { name: 'Aerial lights / spotlight', checkType: 'functional' },
          { name: 'Rungs & rail condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'functional' },
          { name: 'Parking brake', checkType: 'functional' },
          { name: 'Transmission', checkType: 'functional' },
          { name: 'Steering responsiveness', checkType: 'functional' },
        ],
      },
    ],
  },
  ambulance: {
    label: 'Ambulance / Rescue',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren', checkType: 'functional' },
          { name: 'Horn', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body damage / fluid leaks', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Patient Compartment',
        items: [
          { name: 'Stretcher locks & operation', checkType: 'functional' },
          { name: 'O2 system / regulators', checkType: 'functional' },
          { name: 'Suction unit', checkType: 'functional' },
          { name: 'Climate control (heat/AC)', checkType: 'functional' },
          { name: 'Patient compartment lights', checkType: 'functional' },
          { name: 'Sharps container level', checkType: 'pass_fail' },
          { name: 'Compartment clean & sanitized', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'functional' },
          { name: 'Parking brake', checkType: 'functional' },
          { name: 'Transmission', checkType: 'functional' },
          { name: 'Steering responsiveness', checkType: 'functional' },
        ],
      },
    ],
  },
  generic: {
    label: 'Generic Vehicle',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren / horn', checkType: 'functional' },
          { name: 'Mirrors', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body damage / fluid leaks', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'functional' },
          { name: 'Parking brake', checkType: 'functional' },
          { name: 'Transmission', checkType: 'functional' },
          { name: 'Steering responsiveness', checkType: 'functional' },
        ],
      },
    ],
  },
};

const inputClass = 'form-input';

const selectClass = 'form-input';

const labelClass = 'form-label';

const checkboxClass =
  'h-4 w-4 rounded border-theme-surface-border text-blue-600 focus:ring-blue-500';

// ============================================================================
// Item Form State
// ============================================================================

interface ItemFormState {
  id?: string;
  name: string;
  description: string;
  checkType: CheckType;
  isRequired: boolean;
  requiredQuantity: string;
  expectedQuantity: string;
  minLevel: string;
  levelUnit: string;
  serialNumber: string;
  lotNumber: string;
  hasExpiration: boolean;
  expirationDate: string;
  expirationWarningDays: string;
  imageUrl: string;
}

function emptyItem(): ItemFormState {
  return {
    name: '',
    description: '',
    checkType: 'pass_fail',
    isRequired: true,
    requiredQuantity: '',
    expectedQuantity: '',
    minLevel: '',
    levelUnit: '',
    serialNumber: '',
    lotNumber: '',
    hasExpiration: false,
    expirationDate: '',
    expirationWarningDays: '30',
    imageUrl: '',
  };
}

// ============================================================================
// Compartment Form State
// ============================================================================

interface CompartmentFormState {
  id?: string;
  name: string;
  description: string;
  imageUrl: string;
  parentCompartmentId: string;
  items: ItemFormState[];
}

function emptyCompartment(): CompartmentFormState {
  return {
    name: '',
    description: '',
    imageUrl: '',
    parentCompartmentId: '',
    items: [],
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
    isActive: true,
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

const SortableItemWrapper: React.FC<SortableItemWrapperProps> = ({
  id,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({
        listeners: (listeners ?? undefined) as Record<string, unknown> | undefined,
        setNodeRef,
        style,
        attributes,
      })}
    </div>
  );
};

interface SortableCompartmentWrapperProps {
  id: string;
  children: (opts: {
    listeners: Record<string, unknown> | undefined;
    setNodeRef: React.Ref<HTMLDivElement>;
    style: React.CSSProperties;
    attributes: DraggableAttributes;
  }) => React.ReactNode;
}

const SortableCompartmentWrapper: React.FC<SortableCompartmentWrapperProps> = ({
  id,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <>{children({
      listeners: (listeners ?? undefined) as Record<string, unknown> | undefined,
      setNodeRef,
      style,
      attributes,
    })}</>
  );
};

// ============================================================================
// Component
// ============================================================================

const EquipmentCheckTemplateBuilder: React.FC = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(templateId);

  // State
  const [form, setForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [compartments, setCompartments] = useState<CompartmentFormState[]>([]);
  const [expandedCompartments, setExpandedCompartments] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isEditing);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Bulk selection: per-compartment set of selected item indices
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});

  // Inline editing: which item key is being renamed inline
  const [inlineEditKey, setInlineEditKey] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Auto-save debounce timer for item edits
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          imageUrl: c.imageUrl ?? '',
          parentCompartmentId: c.parentCompartmentId ?? '',
          items: (c.items ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description ?? '',
            checkType: item.checkType,
            isRequired: item.isRequired,
            requiredQuantity: item.requiredQuantity != null ? String(item.requiredQuantity) : '',
            expectedQuantity: item.expectedQuantity != null ? String(item.expectedQuantity) : '',
            minLevel: item.minLevel != null ? String(item.minLevel) : '',
            levelUnit: item.levelUnit ?? '',
            serialNumber: item.serialNumber ?? '',
            lotNumber: item.lotNumber ?? '',
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

  const togglePosition = (pos: string) => {
    setForm((prev) => {
      const current = prev.assignedPositions;
      const next = current.includes(pos)
        ? current.filter((p) => p !== pos)
        : [...current, pos];
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

  const addCompartment = async () => {
    if (!templateId) {
      // For new templates not yet saved, add locally
      const key = `new-${Date.now()}`;
      const comp = emptyCompartment();
      setCompartments((prev) => [...prev, comp]);
      setExpandedCompartments((prev) => new Set(prev).add(key));
      return;
    }

    try {
      const payload: CheckTemplateCompartmentCreate = {
        name: 'New Compartment',
        sort_order: compartments.length,
      };
      const created = await schedulingService.addCompartment(templateId, payload);
      const comp: CompartmentFormState = {
        id: created.id,
        name: created.name,
        description: created.description ?? '',
        imageUrl: created.imageUrl ?? '',
        parentCompartmentId: created.parentCompartmentId ?? '',
        items: [],
      };
      setCompartments((prev) => [...prev, comp]);
      setExpandedCompartments((prev) => new Set(prev).add(created.id));
      toast.success('Compartment added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add compartment'));
    }
  };

  const updateCompartmentField = (
    idx: number,
    patch: Partial<CompartmentFormState>,
  ) => {
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
    const msg = itemCount > 0
      ? `Delete "${label}" and its ${itemCount} item${itemCount !== 1 ? 's' : ''}? This cannot be undone.`
      : `Delete "${label}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;

    if (comp.id) {
      try {
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

  const duplicateCompartment = (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return;

    const copy: CompartmentFormState = {
      name: `${comp.name} (copy)`,
      description: comp.description,
      imageUrl: comp.imageUrl,
      parentCompartmentId: comp.parentCompartmentId,
      items: comp.items.map(({ id: _discardId, ...rest }) => ({ ...rest })),
    };
    setCompartments((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    const newKey = `comp-${Date.now()}`;
    setExpandedCompartments((prev) => new Set(prev).add(newKey));
    toast.success('Compartment duplicated');
    markDirty();
  };

  // ---------------------------------------------------------------------------
  // Item helpers
  // ---------------------------------------------------------------------------

  const addItem = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;

    if (comp.id) {
      try {
        const payload: CheckTemplateItemCreate = {
          name: 'New Item',
          sort_order: comp.items.length,
        };
        const created = await schedulingService.addCheckItem(comp.id, payload);
        const item: ItemFormState = {
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          checkType: created.checkType,
          isRequired: created.isRequired,
          requiredQuantity: created.requiredQuantity != null ? String(created.requiredQuantity) : '',
          expectedQuantity: created.expectedQuantity != null ? String(created.expectedQuantity) : '',
          minLevel: created.minLevel != null ? String(created.minLevel) : '',
          levelUnit: created.levelUnit ?? '',
          serialNumber: created.serialNumber ?? '',
          lotNumber: created.lotNumber ?? '',
          hasExpiration: created.hasExpiration,
          expirationDate: created.expirationDate ?? '',
          expirationWarningDays: String(created.expirationWarningDays ?? 30),
          imageUrl: created.imageUrl ?? '',
        };
        updateCompartmentField(compartmentIdx, { items: [...comp.items, item] });
        toast.success('Item added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add item'));
      }
    } else {
      // Unsaved compartment — add locally
      updateCompartmentField(compartmentIdx, {
        items: [...comp.items, emptyItem()],
      });
    }
  };

  const updateItemField = (
    compartmentIdx: number,
    itemIdx: number,
    patch: Partial<ItemFormState>,
  ) => {
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
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

    if (item.id) {
      try {
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

  const duplicateItem = (compartmentIdx: number, itemIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const item = comp.items[itemIdx];
    if (!item) return;

    const { id: _discardId, ...rest } = item;
    const copy: ItemFormState = {
      ...rest,
      name: `${item.name} (copy)`,
    };
    const updatedItems = [...comp.items];
    updatedItems.splice(itemIdx + 1, 0, copy);
    updateCompartmentField(compartmentIdx, { items: updatedItems });
    toast.success('Item duplicated');
  };

  // ---------------------------------------------------------------------------
  // Move item up/down within a compartment
  // ---------------------------------------------------------------------------

  const moveItem = (compartmentIdx: number, itemIdx: number, direction: 'up' | 'down') => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const newIdx = direction === 'up' ? itemIdx - 1 : itemIdx + 1;
    if (newIdx < 0 || newIdx >= comp.items.length) return;

    setCompartments((prev) => {
      const next = [...prev];
      const c = next[compartmentIdx];
      if (!c) return prev;
      const items = [...c.items];
      const [moved] = items.splice(itemIdx, 1);
      if (!moved) return prev;
      items.splice(newIdx, 0, moved);
      next[compartmentIdx] = { ...c, items };
      return next;
    });

    if (isEditing && comp.id) {
      const reorderedItems = [...comp.items];
      const [movedItem] = reorderedItems.splice(itemIdx, 1);
      if (movedItem) reorderedItems.splice(newIdx, 0, movedItem);
      const savedIds = reorderedItems.map((item) => item.id).filter((id): id is string => Boolean(id));
      if (savedIds.length > 0) {
        void schedulingService
          .reorderItems(comp.id, savedIds)
          .catch(() => toast.error('Failed to save item order'));
      }
    }
    markDirty();
  };

  // ---------------------------------------------------------------------------
  // Move compartment up/down
  // ---------------------------------------------------------------------------

  const moveCompartment = (idx: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= compartments.length) return;

    setCompartments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      if (!moved) return prev;
      next.splice(newIdx, 0, moved);
      return next;
    });

    if (isEditing && templateId) {
      const ids = compartments.map((c, i) => c.id ?? `comp-${i}`);
      const [movedId] = ids.splice(idx, 1);
      if (movedId) ids.splice(newIdx, 0, movedId);
      const savedIds = ids.filter((id) => !id.startsWith('comp-'));
      if (savedIds.length > 0) {
        void schedulingService
          .reorderCompartments(templateId, savedIds)
          .catch(() => toast.error('Failed to save compartment order'));
      }
    }
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

  const getSelectedCount = (compartmentIdx: number): number => {
    const key = getCompKey(compartmentIdx);
    return selectedItems[key]?.size ?? 0;
  };

  const deleteSelectedItems = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const selected = selectedItems[key];
    if (!selected || selected.size === 0) return;

    const count = selected.size;
    if (!window.confirm(`Delete ${count} selected item${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;

    const toDelete = [...selected].sort((a, b) => b - a);
    const deletePromises: Promise<void>[] = [];
    for (const itemIdx of toDelete) {
      const item = comp.items[itemIdx];
      if (item?.id) {
        deletePromises.push(
          schedulingService.deleteCheckItem(item.id).catch((err: unknown) => {
            toast.error(getErrorMessage(err, `Failed to delete ${item.name || 'item'}`));
          }),
        );
      }
    }
    await Promise.all(deletePromises);

    const remaining = comp.items.filter((_, i) => !selected.has(i));
    updateCompartmentField(compartmentIdx, { items: remaining });
    setSelectedItems((prev) => ({ ...prev, [key]: new Set<number>() }));
    toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
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
      autoSaveTimerRef.current = setTimeout(() => {
        void schedulingService.updateCheckItem(itemId, patch).catch(() => {
          // Silent — user can still manually save
        });
      }, 1500);
    },
    [isEditing],
  );

  // Enhanced updateItemField that triggers auto-save for persisted items
  const updateItemFieldWithAutoSave = (
    compartmentIdx: number,
    itemIdx: number,
    patch: Partial<ItemFormState>,
  ) => {
    updateItemField(compartmentIdx, itemIdx, patch);

    const comp = compartments[compartmentIdx];
    const item = comp?.items[itemIdx];
    if (item?.id) {
      const apiPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) apiPatch.name = patch.name || undefined;
      if (patch.description !== undefined) apiPatch.description = patch.description.trim() || undefined;
      if (patch.checkType !== undefined) apiPatch.check_type = patch.checkType;
      if (patch.isRequired !== undefined) apiPatch.is_required = patch.isRequired;
      if (patch.requiredQuantity !== undefined) apiPatch.required_quantity = patch.requiredQuantity ? Number(patch.requiredQuantity) : undefined;
      if (patch.expectedQuantity !== undefined) apiPatch.expected_quantity = patch.expectedQuantity ? Number(patch.expectedQuantity) : undefined;
      if (patch.minLevel !== undefined) apiPatch.min_level = patch.minLevel ? Number(patch.minLevel) : undefined;
      if (patch.levelUnit !== undefined) apiPatch.level_unit = patch.levelUnit.trim() || undefined;
      if (patch.serialNumber !== undefined) apiPatch.serial_number = patch.serialNumber.trim() || undefined;
      if (patch.lotNumber !== undefined) apiPatch.lot_number = patch.lotNumber.trim() || undefined;
      if (patch.hasExpiration !== undefined) apiPatch.has_expiration = patch.hasExpiration;
      if (patch.expirationDate !== undefined) apiPatch.expiration_date = patch.expirationDate.trim() || undefined;
      if (patch.expirationWarningDays !== undefined) apiPatch.expiration_warning_days = patch.expirationWarningDays ? Number(patch.expirationWarningDays) : undefined;
      if (patch.imageUrl !== undefined) apiPatch.image_url = patch.imageUrl.trim() || undefined;

      if (Object.keys(apiPatch).length > 0) {
        scheduleAutoSaveItem(item.id, apiPatch);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Template name is required');
      return;
    }

    // Validate compartments and items
    const warnings: string[] = [];
    for (const comp of compartments) {
      if (!comp.name.trim()) {
        warnings.push('One or more compartments have no name.');
        break;
      }
    }
    for (const comp of compartments) {
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
          break;
        }
      }
    }
    if (warnings.length > 0) {
      const proceed = window.confirm(
        `Save with warnings?\n\n${warnings.join('\n')}\n\nContinue anyway?`,
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const compartmentPayloads: CheckTemplateCompartmentCreate[] = compartments
        .filter((c) => !c.id) // Only include unsaved compartments in create payload
        .map((c, idx) => ({
          name: c.name || 'Untitled Compartment',
          description: c.description.trim() || undefined,
          sort_order: idx,
          image_url: c.imageUrl.trim() || undefined,
          parent_compartment_id: c.parentCompartmentId || undefined,
          items: c.items.map((item, itemIdx) => ({
            name: item.name || 'Untitled Item',
            description: item.description.trim() || undefined,
            sort_order: itemIdx,
            check_type: item.checkType,
            is_required: item.isRequired,
            required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
            expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
            min_level: item.minLevel ? Number(item.minLevel) : undefined,
            level_unit: item.levelUnit.trim() || undefined,
            serial_number: item.serialNumber.trim() || undefined,
            lot_number: item.lotNumber.trim() || undefined,
            image_url: item.imageUrl.trim() || undefined,
            has_expiration: item.hasExpiration,
            expiration_date: item.expirationDate.trim() || undefined,
            expiration_warning_days: item.expirationWarningDays
              ? Number(item.expirationWarningDays)
              : undefined,
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
          is_active: form.isActive,
        });

        // Save any new compartments that haven't been persisted yet
        for (const payload of compartmentPayloads) {
          await schedulingService.addCompartment(templateId, payload);
        }

        // Update existing compartments and items in parallel
        const updatePromises: Promise<unknown>[] = [];
        for (const comp of compartments) {
          if (comp.id) {
            updatePromises.push(
              schedulingService.updateCompartment(comp.id, {
                name: comp.name || undefined,
                description: comp.description.trim() || undefined,
                image_url: comp.imageUrl.trim() || undefined,
                parent_compartment_id: comp.parentCompartmentId || undefined,
              }),
            );

            for (const item of comp.items) {
              if (item.id) {
                updatePromises.push(
                  schedulingService.updateCheckItem(item.id, {
                    name: item.name || undefined,
                    description: item.description.trim() || undefined,
                    check_type: item.checkType,
                    is_required: item.isRequired,
                    required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
                    expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
                    min_level: item.minLevel ? Number(item.minLevel) : undefined,
                    level_unit: item.levelUnit.trim() || undefined,
                    serial_number: item.serialNumber.trim() || undefined,
                    lot_number: item.lotNumber.trim() || undefined,
                    image_url: item.imageUrl.trim() || undefined,
                    has_expiration: item.hasExpiration,
                    expiration_date: item.expirationDate.trim() || undefined,
                    expiration_warning_days: item.expirationWarningDays
                      ? Number(item.expirationWarningDays)
                      : undefined,
                  }),
                );
              }
            }
          }
        }
        await Promise.all(updatePromises);

        setIsDirty(false);
        toast.success('Template updated');
      } else {
        const createPayload: EquipmentCheckTemplateCreate = {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          check_timing: form.checkTiming,
          template_type: form.templateType,
          assigned_positions: form.assignedPositions.length > 0 ? form.assignedPositions : undefined,
          apparatus_type: form.apparatusType || undefined,
          apparatus_id: form.apparatusId || undefined,
          is_active: form.isActive,
          compartments: compartments.map((c, idx) => ({
            name: c.name || 'Untitled Compartment',
            description: c.description.trim() || undefined,
            sort_order: idx,
            image_url: c.imageUrl.trim() || undefined,
            parent_compartment_id: c.parentCompartmentId || undefined,
            items: c.items.map((item, itemIdx) => ({
              name: item.name || 'Untitled Item',
              description: item.description.trim() || undefined,
              sort_order: itemIdx,
              check_type: item.checkType,
              is_required: item.isRequired,
              required_quantity: item.requiredQuantity ? Number(item.requiredQuantity) : undefined,
              expected_quantity: item.expectedQuantity ? Number(item.expectedQuantity) : undefined,
              min_level: item.minLevel ? Number(item.minLevel) : undefined,
              level_unit: item.levelUnit.trim() || undefined,
              serial_number: item.serialNumber.trim() || undefined,
              lot_number: item.lotNumber.trim() || undefined,
              image_url: item.imageUrl.trim() || undefined,
              has_expiration: item.hasExpiration,
              expiration_date: item.expirationDate.trim() || undefined,
              expiration_warning_days: item.expirationWarningDays
                ? Number(item.expirationWarningDays)
                : undefined,
            })),
          })),
        };
        const created = await schedulingService.createEquipmentCheckTemplate(createPayload);
        setIsDirty(false);
        toast.success('Template created');
        // Navigate to edit mode so subsequent saves work as updates
        navigate(`/scheduling/equipment-check-templates/${created.id}`, { replace: true });
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

  const loadVehiclePreset = (presetKey: string) => {
    const preset = VEHICLE_PRESETS[presetKey];
    if (!preset) return;

    const newCompartments: CompartmentFormState[] = preset.compartments.map(
      (comp) => ({
        name: comp.name,
        description: '',
        imageUrl: '',
        parentCompartmentId: '',
        items: comp.items.map((item) => ({
          ...emptyItem(),
          name: item.name,
          checkType: item.checkType,
        })),
      }),
    );

    if (compartments.length > 0) {
      if (
        !window.confirm(
          'Loading a preset will replace all existing compartments. Continue?',
        )
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
      navigate(`/scheduling/equipment-check-templates/${cloned.id}`, { replace: true });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to clone template'));
    } finally {
      setCloning(false);
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
      compartments: compartments.map((c, cIdx) => ({
        id: c.id ?? `preview-comp-${cIdx}`,
        templateId: templateId ?? 'preview',
        name: c.name || 'Untitled Compartment',
        ...(c.description ? { description: c.description } : {}),
        sortOrder: cIdx,
        ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
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
    const allItems = compartments.flatMap((c) => c.items);
    const totalItems = allItems.length;
    const requiredItems = allItems.filter((i) => i.isRequired).length;
    const withExpiration = allItems.filter((i) => i.hasExpiration).length;
    const namedItems = allItems.filter((i) => i.name.trim()).length;
    const namedCompartments = compartments.filter((c) => c.name.trim()).length;
    return {
      compartmentCount: compartments.length,
      totalItems,
      requiredItems,
      withExpiration,
      completeness: totalItems > 0 ? Math.round((namedItems / totalItems) * 100) : 100,
      namedCompartments,
    };
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const compartmentIds = useMemo(
    () => compartments.map((c, i) => c.id ?? `comp-${i}`),
    [compartments],
  );

  const handleCompartmentDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = compartmentIds.indexOf(String(active.id));
    const newIndex = compartmentIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    setCompartments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      if (!moved) return prev;
      next.splice(newIndex, 0, moved);
      return next;
    });

    // Persist reorder if template is saved
    if (isEditing && templateId) {
      const reorderedIds = [...compartmentIds];
      const [movedId] = reorderedIds.splice(oldIndex, 1);
      if (movedId) reorderedIds.splice(newIndex, 0, movedId);
      const savedIds = reorderedIds.filter(
        (id) => !id.startsWith('comp-'),
      );
      if (savedIds.length > 0) {
        void schedulingService
          .reorderCompartments(templateId, savedIds)
          .catch(() => {
            toast.error('Failed to save compartment order');
          });
      }
    }
  };

  const handleItemDragEnd = (compIdx: number, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const comp = compartments[compIdx];
    if (!comp) return;

    const itemIds = comp.items.map(
      (item, i) => item.id ?? `item-${compIdx}-${i}`,
    );
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    setCompartments((prev) => {
      const next = [...prev];
      const c = next[compIdx];
      if (!c) return prev;
      const items = [...c.items];
      const [moved] = items.splice(oldIndex, 1);
      if (!moved) return prev;
      items.splice(newIndex, 0, moved);
      next[compIdx] = { ...c, items };
      return next;
    });

    // Persist item order if compartment is saved
    if (isEditing && comp.id) {
      const reorderedItems = [...comp.items];
      const [movedItem] = reorderedItems.splice(oldIndex, 1);
      if (movedItem) reorderedItems.splice(newIndex, 0, movedItem);
      const savedIds = reorderedItems.map((item) => item.id).filter((id): id is string => Boolean(id));
      if (savedIds.length > 0) {
        void schedulingService
          .reorderItems(comp.id, savedIds)
          .catch(() => toast.error('Failed to save item order'));
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-theme-text-muted" />
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
    totalItems?: number,
  ) => {
    const itemKey = item.id ?? `item-${compIdx}-${itemIdx}`;
    const isItemExpanded = expandedItems.has(itemKey);
    const checkTypeLabel = CHECK_TYPES.find((ct) => ct.value === item.checkType)?.label ?? item.checkType;
    const compKey = getCompKey(compIdx);
    const isSelected = selectedItems[compKey]?.has(itemIdx) ?? false;
    const isInlineEditing = inlineEditKey === itemKey;
    const itemCount = totalItems ?? compartments[compIdx]?.items.length ?? 0;

    return (
      <div
        key={itemKey}
        className={`rounded-md border overflow-hidden transition-colors ${
          isSelected
            ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
            : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        {/* Compact row — always visible */}
        <div
          className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-theme-surface-secondary/50 transition-colors"
          onClick={() => toggleItemExpanded(itemKey)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleItemExpanded(itemKey); }}
        >
          {/* Bulk selection checkbox */}
          <button
            type="button"
            className="p-0.5 flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); toggleItemSelection(compIdx, itemIdx); }}
            title={isSelected ? 'Deselect item' : 'Select item'}
          >
            {isSelected ? (
              <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Square className="h-4 w-4 text-theme-text-muted hover:text-theme-text-secondary" />
            )}
          </button>

          <button
            type="button"
            className="p-0.5 text-theme-text-muted cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to reorder"
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {isItemExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-theme-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-theme-text-muted flex-shrink-0" />
          )}

          {/* Inline editable name */}
          {isInlineEditing ? (
            <input
              ref={inlineInputRef}
              type="text"
              className="flex-1 text-sm font-medium text-theme-text-primary bg-transparent border-b border-blue-400 outline-none min-w-0 px-1"
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
            <span
              className={`flex-1 text-sm truncate ${item.name.trim() ? 'text-theme-text-primary font-medium' : 'text-theme-text-muted italic'}`}
              onDoubleClick={(e) => startInlineEdit(itemKey, item.name, e)}
              title="Double-click to rename"
            >
              {item.name.trim() || 'Untitled Item'}
            </span>
          )}

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="rounded-full bg-theme-surface-secondary px-2 py-0.5 text-[10px] font-medium text-theme-text-muted">
              {checkTypeLabel}
            </span>
            {item.isRequired && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                Req
              </span>
            )}
            {item.hasExpiration && (
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
            )}
          </div>

          {/* Actions — stop propagation so clicking them doesn't toggle expansion */}
          <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* Move up/down buttons */}
            <button
              type="button"
              onClick={() => moveItem(compIdx, itemIdx, 'up')}
              disabled={itemIdx === 0}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
              aria-label="Move item up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveItem(compIdx, itemIdx, 'down')}
              disabled={itemIdx === itemCount - 1}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
              aria-label="Move item down"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => duplicateItem(compIdx, itemIdx)}
              className="p-1 text-theme-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              title="Duplicate item"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteItem(compIdx, itemIdx)}
              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              title="Delete item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Expanded form — visible on click */}
        {isItemExpanded && (
          <div className="border-t border-theme-surface-border px-3 py-3 space-y-3">
            {/* Name + Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Item name"
                  value={item.name}
                  onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { name: e.target.value })}
                />
              </div>
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
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    </option>
                  ))}
                </select>
                {CHECK_TYPE_HELP[item.checkType] && (
                  <p className="mt-1 text-[10px] text-theme-text-muted leading-tight">
                    {CHECK_TYPE_HELP[item.checkType]}
                  </p>
                )}
              </div>

              {/* Required */}
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={item.isRequired}
                    onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { isRequired: e.target.checked })}
                  />
                  Required
                </label>
              </div>

              {/* Conditional: Quantity */}
              {item.checkType === 'quantity' && (
                <>
                  <div>
                    <label className={labelClass}>Required Qty</label>
                    <input type="number" className={inputClass} min="0" placeholder="0" value={item.requiredQuantity} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { requiredQuantity: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Expected Qty</label>
                    <input type="number" className={inputClass} min="0" placeholder="0" value={item.expectedQuantity} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expectedQuantity: e.target.value })} />
                  </div>
                </>
              )}

              {/* Conditional: Level */}
              {item.checkType === 'level' && (
                <>
                  <div>
                    <label className={labelClass}>Min Level</label>
                    <input type="number" className={inputClass} min="0" step="0.1" placeholder="0" value={item.minLevel} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { minLevel: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Unit</label>
                    <div className="flex gap-1.5">
                      <select
                        className={selectClass}
                        value={LEVEL_UNIT_PRESETS.includes(item.levelUnit as typeof LEVEL_UNIT_PRESETS[number]) ? item.levelUnit : '__custom__'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '__custom__') {
                            updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: val });
                          }
                        }}
                      >
                        {LEVEL_UNIT_PRESETS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                        <option value="__custom__">Custom...</option>
                      </select>
                      {!LEVEL_UNIT_PRESETS.includes(item.levelUnit as typeof LEVEL_UNIT_PRESETS[number]) && (
                        <input type="text" className={inputClass} placeholder="Custom unit" value={item.levelUnit} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { levelUnit: e.target.value })} />
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Conditional: Serial/Lot */}
              {(item.checkType === 'date_lot' || item.checkType === 'quantity') && (
                <>
                  <div>
                    <label className={labelClass}>Serial #</label>
                    <input type="text" className={inputClass} placeholder="Serial number" value={item.serialNumber} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { serialNumber: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Lot #</label>
                    <input type="text" className={inputClass} placeholder="Lot number" value={item.lotNumber} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { lotNumber: e.target.value })} />
                  </div>
                </>
              )}

              {/* Image URL */}
              <div>
                <label className={labelClass}>
                  <Image className="inline h-3.5 w-3.5 mr-1" />
                  Image URL
                </label>
                <input type="text" className={inputClass} placeholder="https://..." value={item.imageUrl} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { imageUrl: e.target.value })} />
              </div>
            </div>

            {/* Expiration row */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <input type="checkbox" className={checkboxClass} checked={item.hasExpiration} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { hasExpiration: e.target.checked })} />
                <AlertTriangle className="h-3.5 w-3.5" />
                Has Expiration
              </label>
              {item.hasExpiration && (
                <>
                  <div>
                    <label className={labelClass}>Expiration Date</label>
                    <input type="date" className={inputClass} value={item.expirationDate} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationDate: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Warning Days</label>
                    <input type="number" className={inputClass} min="0" placeholder="30" value={item.expirationWarningDays} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expirationWarningDays: e.target.value })} />
                  </div>
                </>
              )}
            </div>
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
  ) => {
    const key = comp.id ?? `comp-${idx}`;
    const isExpanded = expandedCompartments.has(key);

    return (
      <div
        key={key}
        ref={sortableRef}
        style={sortableStyle}
        {...(sortableAttributes ?? {})}
        className="rounded-lg border border-theme-surface-border bg-theme-surface overflow-hidden"
      >
        {/* Compartment header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-theme-surface">
          <button
            type="button"
            className="p-0.5 text-theme-text-muted cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
            aria-label="Drag to reorder compartment"
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => toggleCompartmentExpanded(key)}
            className="flex items-center gap-2 flex-1 text-left min-w-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-theme-text-muted flex-shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-theme-text-muted flex-shrink-0" />
            )}
            <span className="font-medium text-theme-text-primary truncate">
              {comp.name || 'Untitled Compartment'}
            </span>
          </button>

          {/* Status badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {(() => {
              const status = getCompartmentStatus(comp);
              return (
                <>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    status === 'complete'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : status === 'warning'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {status === 'complete' && <CheckCircle2 className="h-2.5 w-2.5" />}
                    {status === 'warning' && <AlertTriangle className="h-2.5 w-2.5" />}
                    {status === 'empty' && <Circle className="h-2.5 w-2.5" />}
                    {comp.items.length} item{comp.items.length !== 1 ? 's' : ''}
                  </span>
                  {comp.items.filter((i) => i.isRequired).length > 0 && (
                    <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                      {comp.items.filter((i) => i.isRequired).length} req
                    </span>
                  )}
                </>
              );
            })()}
          </div>

          {/* Move up/down + delete */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => moveCompartment(idx, 'up')}
              disabled={idx === 0}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move compartment up"
              aria-label="Move compartment up"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveCompartment(idx, 'down')}
              disabled={idx === compartments.length - 1}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move compartment down"
              aria-label="Move compartment down"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => duplicateCompartment(idx)}
              className="p-1 text-theme-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              title="Duplicate compartment"
              aria-label="Duplicate compartment"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void deleteCompartment(idx)}
              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              title="Delete compartment"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Compartment body */}
        {isExpanded && (
          <div className="border-t border-theme-surface-border px-4 py-4 space-y-4">
            {/* Compartment fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Compartment Name</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Driver Side, Cab, Hose Bed"
                  value={comp.name}
                  onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Optional description"
                  value={comp.description}
                  onChange={(e) => updateCompartmentField(idx, { description: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>
                  <Image className="inline h-3.5 w-3.5 mr-1" />
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
              <div>
                <label className={labelClass}>Parent Compartment</label>
                <select
                  className={selectClass}
                  value={comp.parentCompartmentId}
                  onChange={(e) =>
                    updateCompartmentField(idx, { parentCompartmentId: e.target.value })
                  }
                >
                  <option value="">None (top-level)</option>
                  {compartments
                    .filter((_, cIdx) => cIdx !== idx)
                    .map((other, oIdx) => {
                      const otherId = other.id ?? `comp-${oIdx >= idx ? oIdx + 1 : oIdx}`;
                      return (
                        <option key={otherId} value={other.id ?? ''}>
                          {other.name || 'Untitled Compartment'}
                        </option>
                      );
                    })}
                </select>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-sm font-semibold text-theme-text-primary">Check Items</h4>
                <div className="flex items-center gap-2">
                  {/* Bulk selection controls */}
                  {comp.items.length > 0 && (
                    <div className="flex items-center gap-1">
                      {getSelectedCount(idx) > 0 ? (
                        <>
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium mr-1">
                            {getSelectedCount(idx)} selected
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteSelectedItems(idx)}
                            className="flex items-center gap-1 rounded-md border border-red-300 dark:border-red-700 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Delete selected items"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => deselectAllItems(idx)}
                            className="rounded-md px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectAllItems(idx)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
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
                    onClick={() => void addItem(idx)}
                    className="flex items-center gap-1 rounded-md border border-theme-surface-border px-3 py-1.5 text-xs font-medium text-theme-text-secondary hover:border-blue-500 hover:text-blue-600 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Item
                  </button>
                </div>
              </div>

              {comp.items.length === 0 && (
                <p className="text-sm text-theme-text-muted italic py-2">
                  No items yet. Click &ldquo;Add Item&rdquo; to start building this compartment&apos;s checklist.
                </p>
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => handleItemDragEnd(idx, e)}
              >
                <SortableContext
                  items={comp.items.map(
                    (item, i) => item.id ?? `item-${idx}-${i}`,
                  )}
                  strategy={verticalListSortingStrategy}
                >
                  {comp.items.map((item, itemIdx) => (
                    <SortableItemWrapper
                      key={item.id ?? `item-${idx}-${itemIdx}`}
                      id={item.id ?? `item-${idx}-${itemIdx}`}
                    >
                      {({ listeners: itemListeners }) =>
                        renderItem(idx, itemIdx, item, itemListeners, comp.items.length)
                      }
                    </SortableItemWrapper>
                  ))}
                </SortableContext>
              </DndContext>
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
        <input type="text" className={inputClass} placeholder="e.g. Engine Daily Check" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
      </div>

      {/* Description */}
      <div>
        <label className={labelClass}>Description</label>
        <textarea className={inputClass} rows={2} placeholder="Describe what this template covers..." value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
      </div>

      {/* Check Timing */}
      <div>
        <label className={labelClass}>
          <Clock className="inline h-3.5 w-3.5 mr-1" />
          Check Timing
        </label>
        <select className={selectClass} value={form.checkTiming} onChange={(e) => updateForm({ checkTiming: e.target.value as TemplateFormState['checkTiming'] })}>
          <option value="start_of_shift">Start of Shift</option>
          <option value="end_of_shift">End of Shift</option>
        </select>
      </div>

      {/* Template Type */}
      <div>
        <label className={labelClass}>Template Type</label>
        <select className={selectClass} value={form.templateType} onChange={(e) => updateForm({ templateType: e.target.value as TemplateType })}>
          {(Object.entries(TEMPLATE_TYPE_LABELS) as [TemplateType, string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Assigned Positions */}
      <div>
        <label className={labelClass}>Assigned Positions</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {POSITIONS.map((pos) => (
            <label key={pos} className="flex items-center gap-1.5 text-xs text-theme-text-secondary capitalize">
              <input type="checkbox" className={checkboxClass} checked={form.assignedPositions.includes(pos)} onChange={() => togglePosition(pos)} />
              {pos}
            </label>
          ))}
        </div>
      </div>

      {/* Apparatus Type */}
      <div>
        <label className={labelClass}>Apparatus Type</label>
        <select className={selectClass} value={form.apparatusType} onChange={(e) => updateForm({ apparatusType: e.target.value })}>
          <option value="">-- Select Type --</option>
          {APPARATUS_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Apparatus ID */}
      <div>
        <label className={labelClass}>Specific Apparatus ID</label>
        <input type="text" className={inputClass} placeholder="Leave blank for all of type" value={form.apparatusId} onChange={(e) => updateForm({ apparatusId: e.target.value })} />
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
          <input type="checkbox" className={checkboxClass} checked={form.isActive} onChange={(e) => updateForm({ isActive: e.target.checked })} />
          Active
        </label>
        <span className="text-[10px] text-theme-text-muted">
          Inactive = hidden from shift checklists
        </span>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="pb-16">
      {/* Header */}
      <div className="mx-auto max-w-7xl flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (isDirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
              navigate(-1);
            }}
            className="p-2 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors flex-shrink-0"
            title="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-theme-text-primary truncate">
            {isEditing ? `Edit: ${form.name || 'Template'}` : 'New Equipment Check Template'}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isEditing && templateId && (
            <button
              type="button"
              onClick={() => void handleClone()}
              disabled={cloning}
              className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary disabled:opacity-50 transition-colors"
              title="Clone this template"
            >
              {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">Clone</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            disabled={compartments.length === 0}
            className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary disabled:opacity-50 transition-colors"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">Preview</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Sidebar + Main content */}
      <div className="mx-auto max-w-7xl flex gap-6">
        {/* Sidebar — Template details */}
        <div className={`flex-shrink-0 transition-all duration-200 ${sidebarOpen ? 'w-72' : 'w-0'} overflow-hidden`}>
          <div className="w-72 rounded-lg border border-theme-surface-border bg-theme-surface p-4 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide">Template Details</h2>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-theme-text-muted hover:text-theme-text-primary rounded transition-colors lg:hidden"
                title="Close sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            {renderSidebar()}
          </div>
        </div>

        {/* Main — Compartments */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Sidebar toggle (when collapsed) + section header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="p-1.5 rounded-md border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors"
                  title="Show template details"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              )}
              <h2 className="text-lg font-semibold text-theme-text-primary">Compartments</h2>
              {compartments.length > 1 && (
                <button
                  type="button"
                  onClick={expandedCompartments.size === compartments.length ? collapseAllCompartments : expandAllCompartments}
                  className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  title={expandedCompartments.size === compartments.length ? 'Collapse all' : 'Expand all'}
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  {expandedCompartments.size === compartments.length ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(form.templateType === 'vehicle' || form.templateType === 'combined') && (
                <button
                  type="button"
                  onClick={() => setShowPresetPicker(!showPresetPicker)}
                  className="flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-700 dark:text-orange-400 hover:bg-orange-500/20 transition-colors"
                >
                  <Truck className="h-4 w-4" />
                  Load Vehicle Preset
                </button>
              )}
              <button
                type="button"
                onClick={() => void addCompartment()}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Compartment
              </button>
            </div>
          </div>

          {/* Vehicle Preset Picker */}
          {showPresetPicker && (
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
              <p className="text-sm font-medium text-theme-text-primary mb-3">
                Choose a pre-built vehicle check template:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(VEHICLE_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => loadVehiclePreset(key)}
                    className="rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary hover:border-orange-500/40 hover:bg-orange-500/10 transition-colors text-left"
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="block text-xs text-theme-text-muted mt-0.5">
                      {preset.compartments.length} sections, {preset.compartments.reduce((sum, c) => sum + c.items.length, 0)} items
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {compartments.length === 0 && (
            <div className="rounded-lg border border-dashed border-theme-surface-border bg-theme-surface p-8 text-center">
              <p className="text-sm text-theme-text-muted">
                No compartments yet.
                {form.templateType === 'vehicle' || form.templateType === 'combined'
                  ? ' Use "Load Vehicle Preset" above or add compartments manually.'
                  : ' Add compartments to organize equipment check items by location on the apparatus.'}
              </p>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCompartmentDragEnd}>
            <SortableContext items={compartmentIds} strategy={verticalListSortingStrategy}>
              {compartments.map((comp, idx) => (
                <SortableCompartmentWrapper key={comp.id ?? `comp-${idx}`} id={comp.id ?? `comp-${idx}`}>
                  {({ listeners: compListeners, setNodeRef, style, attributes }) =>
                    renderCompartment(comp, idx, compListeners, setNodeRef, style, attributes)
                  }
                </SortableCompartmentWrapper>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Sticky footer stats bar */}
      {stats.totalItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-theme-surface-border bg-theme-surface/95 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-theme-text-muted">
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
              {stats.completeness < 100 && (
                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                  {stats.completeness}% items named
                </span>
              )}
              <div className="w-20 h-1.5 rounded-full bg-theme-surface-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${stats.completeness === 100 ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${stats.completeness}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-theme-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-theme-surface-border px-4 py-3">
              <h2 className="text-lg font-semibold text-theme-text-primary">Check Preview</h2>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="rounded-lg p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  This is a preview of how the check will appear to members during their shift.
                  Inputs are interactive for demonstration but nothing will be submitted.
                </p>
              </div>
              <EquipmentCheckForm shiftId="preview" template={buildPreviewTemplate()} previewMode />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EquipmentCheckTemplateBuilder;
