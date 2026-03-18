/**
 * Equipment Check Template Builder
 *
 * Admin page for creating and editing equipment check templates with
 * compartments and items. Supports nested compartments, multiple check
 * types, expiration tracking, and drag-handle placeholders for reordering.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { schedulingService } from '@/modules/scheduling';
import type {
  EquipmentCheckTemplate,
  EquipmentCheckTemplateCreate,
  CheckTemplateCompartmentCreate,
  CheckTemplateItemCreate,
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
  // Template metadata helpers
  // ---------------------------------------------------------------------------

  const updateForm = (patch: Partial<TemplateFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
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
  };

  const deleteCompartment = async (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return;

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
  };

  const deleteItem = async (compartmentIdx: number, itemIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const item = comp.items[itemIdx];
    if (!item) return;

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

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Template name is required');
      return;
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

        // Update existing compartments
        for (const comp of compartments) {
          if (comp.id) {
            await schedulingService.updateCompartment(comp.id, {
              name: comp.name || undefined,
              description: comp.description.trim() || undefined,
              image_url: comp.imageUrl.trim() || undefined,
              parent_compartment_id: comp.parentCompartmentId || undefined,
            });

            // Update existing items
            for (const item of comp.items) {
              if (item.id) {
                await schedulingService.updateCheckItem(item.id, {
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
                });
              }
            }
          }
        }

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
        await schedulingService.createEquipmentCheckTemplate(createPayload);
        toast.success('Template created');
      }

      navigate(-1);
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

    // No item reorder API endpoint exists yet — sort_order is saved on template save
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
  ) => (
    <div
      key={item.id ?? `item-${compIdx}-${itemIdx}`}
      className="rounded-md border border-theme-surface-border bg-theme-surface p-3 space-y-3"
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          type="button"
          className="mt-6 p-1 text-theme-text-muted cursor-grab active:cursor-grabbing touch-none"
          {...(dragHandleProps ?? {})}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {/* Name + Description */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Item name"
              value={item.name}
              onChange={(e) => updateItemField(compIdx, itemIdx, { name: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Optional description"
              value={item.description}
              onChange={(e) => updateItemField(compIdx, itemIdx, { description: e.target.value })}
            />
          </div>
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={() => void deleteItem(compIdx, itemIdx)}
          className="mt-6 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          title="Delete item"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Check Type */}
        <div>
          <label className={labelClass}>Check Type</label>
          <select
            className={selectClass}
            value={item.checkType}
            onChange={(e) =>
              updateItemField(compIdx, itemIdx, {
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
        </div>

        {/* Required */}
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={item.isRequired}
              onChange={(e) => updateItemField(compIdx, itemIdx, { isRequired: e.target.checked })}
            />
            Required
          </label>
        </div>

        {/* Required Quantity (conditional) */}
        {item.checkType === 'quantity' && (
          <>
            <div>
              <label className={labelClass}>Required Qty</label>
              <input
                type="number"
                className={inputClass}
                min="0"
                placeholder="0"
                value={item.requiredQuantity}
                onChange={(e) => updateItemField(compIdx, itemIdx, { requiredQuantity: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Expected Qty</label>
              <input
                type="number"
                className={inputClass}
                min="0"
                placeholder="0"
                value={item.expectedQuantity}
                onChange={(e) => updateItemField(compIdx, itemIdx, { expectedQuantity: e.target.value })}
              />
            </div>
          </>
        )}

        {/* Level fields (conditional) */}
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
                onChange={(e) => updateItemField(compIdx, itemIdx, { minLevel: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Unit</label>
              <input
                type="text"
                className={inputClass}
                placeholder="psi, %, gallons..."
                value={item.levelUnit}
                onChange={(e) => updateItemField(compIdx, itemIdx, { levelUnit: e.target.value })}
              />
            </div>
          </>
        )}

        {/* Serial / Lot Number (conditional) */}
        {(item.checkType === 'date_lot' || item.checkType === 'quantity') && (
          <>
            <div>
              <label className={labelClass}>Serial #</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Serial number"
                value={item.serialNumber}
                onChange={(e) => updateItemField(compIdx, itemIdx, { serialNumber: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Lot #</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Lot number"
                value={item.lotNumber}
                onChange={(e) => updateItemField(compIdx, itemIdx, { lotNumber: e.target.value })}
              />
            </div>
          </>
        )}

        {/* Image URL */}
        <div>
          <label className={labelClass}>
            <Image className="inline h-3.5 w-3.5 mr-1" />
            Image URL
          </label>
          <input
            type="text"
            className={inputClass}
            placeholder="https://..."
            value={item.imageUrl}
            onChange={(e) => updateItemField(compIdx, itemIdx, { imageUrl: e.target.value })}
          />
        </div>
      </div>

      {/* Expiration row */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={item.hasExpiration}
            onChange={(e) => updateItemField(compIdx, itemIdx, { hasExpiration: e.target.checked })}
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
                onChange={(e) => updateItemField(compIdx, itemIdx, { expirationDate: e.target.value })}
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
                  updateItemField(compIdx, itemIdx, { expirationWarningDays: e.target.value })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );

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
            {...(dragHandleProps ?? {})}
          >
            <GripVertical className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => toggleCompartmentExpanded(key)}
            className="flex items-center gap-2 flex-1 text-left"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-theme-text-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-theme-text-muted" />
            )}
            <span className="font-medium text-theme-text-primary">
              {comp.name || 'Untitled Compartment'}
            </span>
            <span className="text-xs text-theme-text-muted">
              ({comp.items.length} item{comp.items.length !== 1 ? 's' : ''})
            </span>
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
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-theme-text-primary">Check Items</h4>
                <button
                  type="button"
                  onClick={() => void addItem(idx)}
                  className="flex items-center gap-1 rounded-md border border-theme-surface-border px-3 py-1.5 text-xs font-medium text-theme-text-secondary hover:border-blue-500 hover:text-blue-600 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </button>
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
                        renderItem(idx, itemIdx, item, itemListeners)
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors"
            title="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            {isEditing ? `Edit: ${form.name || 'Template'}` : 'New Equipment Check Template'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Saving...' : 'Save Template'}
        </button>
      </div>

      {/* Template Metadata Card */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6 space-y-5">
        <h2 className="text-lg font-semibold text-theme-text-primary">Template Details</h2>

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
            rows={3}
            placeholder="Describe what this template covers..."
            value={form.description}
            onChange={(e) => updateForm({ description: e.target.value })}
          />
        </div>

        {/* Check Timing */}
        <div>
          <label className={labelClass}>
            <Clock className="inline h-3.5 w-3.5 mr-1" />
            Check Timing
          </label>
          <select
            className={selectClass}
            value={form.checkTiming}
            onChange={(e) =>
              updateForm({ checkTiming: e.target.value as TemplateFormState['checkTiming'] })
            }
          >
            <option value="start_of_shift">Start of Shift</option>
            <option value="end_of_shift">End of Shift</option>
          </select>
        </div>

        {/* Template Type */}
        <div>
          <label className={labelClass}>Template Type</label>
          <select
            className={selectClass}
            value={form.templateType}
            onChange={(e) =>
              updateForm({ templateType: e.target.value as TemplateType })
            }
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
          <label className={labelClass}>Assigned Positions</label>
          <div className="flex flex-wrap gap-3 mt-1">
            {POSITIONS.map((pos) => (
              <label
                key={pos}
                className="flex items-center gap-2 text-sm text-theme-text-secondary capitalize"
              >
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={form.assignedPositions.includes(pos)}
                  onChange={() => togglePosition(pos)}
                />
                {pos}
              </label>
            ))}
          </div>
        </div>

        {/* Apparatus Type */}
        <div>
          <label className={labelClass}>Apparatus Type</label>
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

        {/* Apparatus ID (specific apparatus) */}
        <div>
          <label className={labelClass}>Specific Apparatus ID</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Leave blank to apply to all of the selected type"
            value={form.apparatusId}
            onChange={(e) => updateForm({ apparatusId: e.target.value })}
          />
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={form.isActive}
              onChange={(e) => updateForm({ isActive: e.target.checked })}
            />
            Active
          </label>
          <span className="text-xs text-theme-text-muted">
            Inactive templates will not appear in shift checklists
          </span>
        </div>
      </div>

      {/* Compartments Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-theme-text-primary">Compartments</h2>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(VEHICLE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => loadVehiclePreset(key)}
                  className="rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary hover:border-orange-500/40 hover:bg-orange-500/10 transition-colors text-left"
                >
                  <span className="font-medium">{preset.label}</span>
                  <span className="block text-xs text-theme-text-muted mt-0.5">
                    {preset.compartments.length} sections,{' '}
                    {preset.compartments.reduce(
                      (sum, c) => sum + c.items.length,
                      0,
                    )}{' '}
                    items
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleCompartmentDragEnd}
        >
          <SortableContext
            items={compartmentIds}
            strategy={verticalListSortingStrategy}
          >
            {compartments.map((comp, idx) => (
              <SortableCompartmentWrapper
                key={comp.id ?? `comp-${idx}`}
                id={comp.id ?? `comp-${idx}`}
              >
                {({ listeners: compListeners, setNodeRef, style, attributes }) =>
                  renderCompartment(comp, idx, compListeners, setNodeRef, style, attributes)
                }
              </SortableCompartmentWrapper>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

export default EquipmentCheckTemplateBuilder;
