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
  Type,
  Pencil,
  Download,
  Upload,
  ArrowRightLeft,
  List,
  Package,
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
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
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
  { value: 'text', label: 'Text' },
  { value: 'header', label: 'Section Header' },
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
  quantity: 'Count items and compare against the expected quantity. Set the expected count, a minimum to pass, and an optional critical threshold that triggers urgent leadership alerts.',
  level: 'Read a gauge or measure a level (e.g., fuel, pressure, fluid). Shows min level and unit fields.',
  date_lot: 'Track serial/lot numbers and verify against expected values. Good for medical supplies and dated items.',
  reading: 'Record a numeric reading without a pass/fail threshold. Good for odometer, hour meters, etc.',
  text: 'Read-only statement or instruction. Displayed as informational text — no action required from the member.',
  header: 'Visual section divider to group items. Not a checkable item — just a label to help members navigate.',
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
  tanker: {
    label: 'Tanker / Water Tender',
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
          { name: 'Belts & hoses condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Water Tank & Pump',
        items: [
          { name: 'Tank water level', checkType: 'level' },
          { name: 'Pump engages properly', checkType: 'functional' },
          { name: 'Pump gauges operational', checkType: 'functional' },
          { name: 'Dump valves / portable tank connections', checkType: 'functional' },
          { name: 'Foam concentrate level', checkType: 'level' },
          { name: 'Drain & fill valves closed', checkType: 'pass_fail' },
          { name: 'Hose connections & fittings', checkType: 'pass_fail' },
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
    ],
  },
  rescue: {
    label: 'Rescue / Heavy Rescue',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren / horn', checkType: 'functional' },
          { name: 'Mirrors', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body damage / fluid leaks', checkType: 'pass_fail' },
          { name: 'Scene lighting / light tower', checkType: 'functional' },
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
        name: 'Extrication Equipment',
        items: [
          { name: 'Hydraulic spreaders', checkType: 'functional' },
          { name: 'Hydraulic cutters', checkType: 'functional' },
          { name: 'Hydraulic rams', checkType: 'functional' },
          { name: 'Hydraulic power unit oil level', checkType: 'level' },
          { name: 'Hydraulic hoses & fittings', checkType: 'pass_fail' },
          { name: 'Cribbing blocks', checkType: 'quantity' },
          { name: 'Step chocks / stabilization struts', checkType: 'present' },
          { name: 'Hand tools (pry bars, axes, etc.)', checkType: 'present' },
        ],
      },
      {
        name: 'Power Tools & Equipment',
        items: [
          { name: 'Generator starts & runs', checkType: 'functional' },
          { name: 'Generator fuel level', checkType: 'level' },
          { name: 'Reciprocating / circular saw', checkType: 'functional' },
          { name: 'Ventilation fan (PPV)', checkType: 'functional' },
          { name: 'Air bags / lifting equipment', checkType: 'present' },
          { name: 'Rope & rigging gear', checkType: 'present' },
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
  brush: {
    label: 'Brush / Wildland',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          { name: 'Lights & emergency warning system', checkType: 'functional' },
          { name: 'Siren / horn', checkType: 'functional' },
          { name: 'Tire condition & pressure', checkType: 'pass_fail' },
          { name: 'Body / skid plate damage', checkType: 'pass_fail' },
          { name: '4WD / AWD engagement', checkType: 'functional' },
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
        name: 'Water Tank & Pump',
        items: [
          { name: 'Tank water level', checkType: 'level' },
          { name: 'Pump engages / prime', checkType: 'functional' },
          { name: 'Booster reel hose condition', checkType: 'pass_fail' },
          { name: 'Nozzle(s) present & operational', checkType: 'present' },
          { name: 'Foam system (if equipped)', checkType: 'functional' },
        ],
      },
      {
        name: 'Wildland Equipment',
        items: [
          { name: 'Hand tools (Pulaski, McLeod, shovel)', checkType: 'quantity' },
          { name: 'Drip torches', checkType: 'present' },
          { name: 'Fire shelters', checkType: 'quantity' },
          { name: 'Portable radio(s)', checkType: 'quantity' },
          { name: 'Chain saw & fuel', checkType: 'functional' },
        ],
      },
    ],
  },
  boat: {
    label: 'Boat / Watercraft',
    compartments: [
      {
        name: 'Hull & Exterior',
        items: [
          { name: 'Hull integrity / damage', checkType: 'pass_fail' },
          { name: 'Navigation lights', checkType: 'functional' },
          { name: 'Emergency strobe / blue light', checkType: 'functional' },
          { name: 'Trailer lights & tongue hitch', checkType: 'functional' },
          { name: 'Drain plug installed', checkType: 'present' },
        ],
      },
      {
        name: 'Engine & Motor',
        items: [
          { name: 'Engine oil level', checkType: 'level' },
          { name: 'Fuel level', checkType: 'level' },
          { name: 'Engine starts & runs', checkType: 'functional' },
          { name: 'Steering & throttle response', checkType: 'functional' },
          { name: 'Kill switch / lanyard', checkType: 'present' },
          { name: 'Propeller condition', checkType: 'pass_fail' },
        ],
      },
      {
        name: 'Safety Equipment',
        items: [
          { name: 'PFDs / life jackets', checkType: 'quantity' },
          { name: 'Throw bag / ring buoy', checkType: 'present' },
          { name: 'First aid kit', checkType: 'present' },
          { name: 'Fire extinguisher', checkType: 'present' },
          { name: 'Anchor & line', checkType: 'present' },
          { name: 'Paddle / oar', checkType: 'present' },
          { name: 'VHF marine radio', checkType: 'functional' },
        ],
      },
    ],
  },
  utility: {
    label: 'Utility / Command',
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
        name: 'Command & Communication',
        items: [
          { name: 'Mobile radio(s)', checkType: 'functional' },
          { name: 'MDT / laptop & charger', checkType: 'functional' },
          { name: 'Accountability system / tags', checkType: 'present' },
          { name: 'Command board / ICS forms', checkType: 'present' },
          { name: 'Vest (IC, Safety, etc.)', checkType: 'present' },
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

// Pre-built equipment kit presets for quick-adding groups of related items
interface EquipmentPreset {
  label: string;
  items: { name: string; checkType: CheckType }[];
}

const EQUIPMENT_PRESETS: Record<string, EquipmentPreset> = {
  scba: {
    label: 'SCBA Kit',
    items: [
      { name: 'SCBA pack & harness', checkType: 'functional' },
      { name: 'SCBA mask (face piece)', checkType: 'present' },
      { name: 'SCBA cylinder pressure', checkType: 'level' },
      { name: 'SCBA regulator', checkType: 'functional' },
      { name: 'PASS device activates', checkType: 'functional' },
      { name: 'Spare SCBA cylinder', checkType: 'present' },
    ],
  },
  aed: {
    label: 'AED / Defibrillator',
    items: [
      { name: 'AED unit powers on', checkType: 'functional' },
      { name: 'AED pads (adult)', checkType: 'date_lot' },
      { name: 'AED pads (pediatric)', checkType: 'date_lot' },
      { name: 'AED battery level', checkType: 'level' },
    ],
  },
  vitals: {
    label: 'Basic Vitals Set',
    items: [
      { name: 'Blood pressure cuff (adult)', checkType: 'present' },
      { name: 'Blood pressure cuff (pediatric)', checkType: 'present' },
      { name: 'Stethoscope', checkType: 'present' },
      { name: 'Pulse oximeter', checkType: 'functional' },
      { name: 'Glucometer & test strips', checkType: 'date_lot' },
      { name: 'Thermometer', checkType: 'functional' },
    ],
  },
  airway: {
    label: 'Airway Management',
    items: [
      { name: 'BVM (adult)', checkType: 'present' },
      { name: 'BVM (pediatric)', checkType: 'present' },
      { name: 'OPA set', checkType: 'present' },
      { name: 'NPA set', checkType: 'present' },
      { name: 'Suction unit', checkType: 'functional' },
      { name: 'Oxygen regulator', checkType: 'functional' },
      { name: 'Oxygen cylinder pressure', checkType: 'level' },
      { name: 'Non-rebreather masks', checkType: 'quantity' },
      { name: 'Nasal cannulas', checkType: 'quantity' },
    ],
  },
  ppe: {
    label: 'PPE / Turnout Gear',
    items: [
      { name: 'Helmet & face shield', checkType: 'pass_fail' },
      { name: 'Turnout coat', checkType: 'pass_fail' },
      { name: 'Turnout pants', checkType: 'pass_fail' },
      { name: 'Boots', checkType: 'pass_fail' },
      { name: 'Gloves (structural)', checkType: 'pass_fail' },
      { name: 'Hood / balaclava', checkType: 'pass_fail' },
    ],
  },
  hose: {
    label: 'Hose & Nozzles',
    items: [
      { name: 'Attack line (1.75")', checkType: 'pass_fail' },
      { name: 'Supply line (5")', checkType: 'pass_fail' },
      { name: 'Backup line (2.5")', checkType: 'pass_fail' },
      { name: 'Nozzle (combination)', checkType: 'functional' },
      { name: 'Nozzle (smooth bore)', checkType: 'present' },
      { name: 'Wye / gated valve', checkType: 'present' },
      { name: 'Spanner wrenches', checkType: 'present' },
    ],
  },
  firstaid: {
    label: 'First Aid / Trauma',
    items: [
      { name: 'Trauma shears', checkType: 'present' },
      { name: 'Tourniquets', checkType: 'quantity' },
      { name: 'Hemostatic gauze', checkType: 'date_lot' },
      { name: 'Chest seals', checkType: 'date_lot' },
      { name: 'Gauze / bandages', checkType: 'quantity' },
      { name: 'Splint set', checkType: 'present' },
      { name: 'Cervical collars', checkType: 'quantity' },
      { name: 'Backboard & straps', checkType: 'present' },
    ],
  },
  lighting: {
    label: 'Lighting & Electrical',
    items: [
      { name: 'Scene lights', checkType: 'functional' },
      { name: 'Portable spotlight', checkType: 'functional' },
      { name: 'Flashlights', checkType: 'quantity' },
      { name: 'Light tower', checkType: 'functional' },
      { name: 'Extension cords', checkType: 'present' },
      { name: 'Power strip / adapter', checkType: 'present' },
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
  criticalMinimumQuantity: string;
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
}

// ============================================================================
// Compartment Form State
// ============================================================================

interface CompartmentFormState {
  id?: string;
  name: string;
  description: string;
  imageUrl: string;
  isHeader: boolean;
  parentCompartmentId: string;
  items: ItemFormState[];
}

function emptyCompartment(): CompartmentFormState {
  return {
    name: '',
    description: '',
    imageUrl: '',
    isHeader: false,
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
  const tz = useTimezone();
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
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apparatus options for the dropdown
  const [apparatusOptions, setApparatusOptions] = useState<Array<{ id?: string; name: string; unit_number?: string; apparatus_type: string }>>([]);

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
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          imageUrl: c.imageUrl ?? '',
          isHeader: c.isHeader ?? false,
          parentCompartmentId: c.parentCompartmentId ?? '',
          items: (c.items ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description ?? '',
            checkType: item.checkType,
            isRequired: item.isRequired,
            requiredQuantity: item.requiredQuantity != null ? String(Number(item.requiredQuantity)) : '',
            expectedQuantity: item.expectedQuantity != null ? String(Number(item.expectedQuantity)) : '',
            criticalMinimumQuantity: item.criticalMinimumQuantity != null ? String(Number(item.criticalMinimumQuantity)) : '',
            minLevel: item.minLevel != null ? String(Number(item.minLevel)) : '',
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
        isHeader: false,
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

  const addSectionHeader = async () => {
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
      const created = await schedulingService.addCompartment(templateId, payload);
      const comp: CompartmentFormState = {
        id: created.id,
        name: created.name,
        description: created.description ?? '',
        imageUrl: created.imageUrl ?? '',
        isHeader: true,
        parentCompartmentId: created.parentCompartmentId ?? '',
        items: [],
      };
      setCompartments((prev) => [...prev, comp]);
      toast.success('Section header added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add section header'));
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
      isHeader: comp.isHeader,
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
        const created = await schedulingService.addCheckItem(comp.id, payload);
        const item: ItemFormState = {
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
        items: [
          ...comp.items,
          { ...emptyItem(), name: 'Section Header', checkType: 'header', isRequired: false },
        ],
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

  const moveItemToCompartment = async (
    fromCompIdx: number,
    itemIdx: number,
    toCompIdx: number,
  ) => {
    if (fromCompIdx === toCompIdx) return;
    const fromComp = compartments[fromCompIdx];
    const toComp = compartments[toCompIdx];
    if (!fromComp || !toComp) return;

    const item = fromComp.items[itemIdx];
    if (!item) return;

    setCompartments((prev) => {
      const next = [...prev];
      const src = next[fromCompIdx];
      const dst = next[toCompIdx];
      if (!src || !dst) return prev;
      const srcItems = src.items.filter((_, i) => i !== itemIdx);
      const dstItems = [...dst.items, item];
      next[fromCompIdx] = { ...src, items: srcItems };
      next[toCompIdx] = { ...dst, items: dstItems };
      return next;
    });

    if (isEditing && item.id && toComp.id) {
      try {
        await schedulingService.updateCheckItem(item.id, {
          compartment_id: toComp.id,
          sort_order: toComp.items.length,
        });
      } catch {
        toast.error('Failed to move item on server');
      }
    }
    markDirty();
    toast.success(`Moved "${item.name || 'item'}" to ${toComp.name || 'compartment'}`);
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
  // Quick-add: type a name + Enter to instantly add an item
  // ---------------------------------------------------------------------------

  const [quickAddValues, setQuickAddValues] = useState<Record<string, string>>({});
  const [bulkPasteMode, setBulkPasteMode] = useState<Record<string, boolean>>({});
  const [bulkPasteValues, setBulkPasteValues] = useState<Record<string, string>>({});
  const [showEquipmentPresets, setShowEquipmentPresets] = useState<Record<string, boolean>>({});

  const handleQuickAdd = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const name = (quickAddValues[key] ?? '').trim();
    if (!name) return;

    if (comp.id) {
      try {
        const payload: CheckTemplateItemCreate = {
          name,
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
          criticalMinimumQuantity: created.criticalMinimumQuantity != null ? String(created.criticalMinimumQuantity) : '',
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
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add item'));
        return;
      }
    } else {
      updateCompartmentField(compartmentIdx, {
        items: [...comp.items, { ...emptyItem(), name }],
      });
    }
    setQuickAddValues((prev) => ({ ...prev, [key]: '' }));
  };

  const handleBulkPaste = async (compartmentIdx: number) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const key = getCompKey(compartmentIdx);
    const text = (bulkPasteValues[key] ?? '').trim();
    if (!text) return;

    const names = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (names.length === 0) return;

    if (comp.id) {
      try {
        const newItems: ItemFormState[] = [];
        for (let i = 0; i < names.length; i++) {
          const itemName = names[i];
          if (!itemName) continue;
          const payload: CheckTemplateItemCreate = {
            name: itemName,
            sort_order: comp.items.length + i,
          };
          const created = await schedulingService.addCheckItem(comp.id, payload);
          newItems.push({
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
            hasExpiration: created.hasExpiration,
            expirationDate: created.expirationDate ?? '',
            expirationWarningDays: String(created.expirationWarningDays ?? 30),
            imageUrl: created.imageUrl ?? '',
          });
        }
        updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add items'));
        return;
      }
    } else {
      const newItems = names.map((n) => ({ ...emptyItem(), name: n }));
      updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
    }

    setBulkPasteValues((prev) => ({ ...prev, [key]: '' }));
    setBulkPasteMode((prev) => ({ ...prev, [key]: false }));
    toast.success(`Added ${names.length} item${names.length !== 1 ? 's' : ''}`);
  };

  const addEquipmentPreset = async (compartmentIdx: number, presetKey: string) => {
    const comp = compartments[compartmentIdx];
    if (!comp) return;
    const preset = EQUIPMENT_PRESETS[presetKey];
    if (!preset) return;

    const key = getCompKey(compartmentIdx);

    if (comp.id) {
      try {
        const newItems: ItemFormState[] = [];
        // Add a header for the preset group
        const headerPayload: CheckTemplateItemCreate = {
          name: preset.label,
          sort_order: comp.items.length,
          check_type: 'header',
          is_required: false,
        };
        const headerCreated = await schedulingService.addCheckItem(comp.id, headerPayload);
        newItems.push({
          id: headerCreated.id,
          name: headerCreated.name,
          description: '',
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
        });

        for (let i = 0; i < preset.items.length; i++) {
          const presetItem = preset.items[i];
          if (!presetItem) continue;
          const payload: CheckTemplateItemCreate = {
            name: presetItem.name,
            sort_order: comp.items.length + 1 + i,
            check_type: presetItem.checkType,
          };
          const created = await schedulingService.addCheckItem(comp.id, payload);
          newItems.push({
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
            hasExpiration: created.hasExpiration,
            expirationDate: created.expirationDate ?? '',
            expirationWarningDays: String(created.expirationWarningDays ?? 30),
            imageUrl: created.imageUrl ?? '',
          });
        }
        updateCompartmentField(compartmentIdx, { items: [...comp.items, ...newItems] });
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add preset items'));
        return;
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
    toast.success(`Added ${preset.label} (${preset.items.length} items)`);
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
    toast.success(`Set ${selected.size} item${selected.size !== 1 ? 's' : ''} to ${CHECK_TYPES.find((ct) => ct.value === checkType)?.label ?? checkType}`);
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
    toast.success(`Set ${selected.size} item${selected.size !== 1 ? 's' : ''} to ${required ? 'required' : 'optional'}`);
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
        void schedulingService
          .updateCheckItem(itemId, patch)
          .then(() => {
            setAutoSaveStatus('saved');
            autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
          })
          .catch(() => {
            setAutoSaveStatus('error');
            autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 4000);
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
      if (patch.criticalMinimumQuantity !== undefined) apiPatch.critical_minimum_quantity = patch.criticalMinimumQuantity ? Number(patch.criticalMinimumQuantity) : undefined;
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
        }
        if (item.checkType === 'quantity' && !item.requiredQuantity && !item.expectedQuantity) {
          warnings.push(`"${item.name || 'Untitled'}" is a quantity check but has no expected quantity.`);
        }
        if (item.checkType === 'quantity' && item.criticalMinimumQuantity && item.expectedQuantity && Number(item.criticalMinimumQuantity) >= Number(item.expectedQuantity)) {
          warnings.push(`"${item.name || 'Untitled'}" has critical minimum >= expected quantity.`);
        }
        if (item.checkType === 'level' && !item.minLevel) {
          warnings.push(`"${item.name || 'Untitled'}" is a level check but has no minimum level set.`);
        }
        if (item.checkType === 'date_lot' && !item.serialNumber && !item.lotNumber) {
          warnings.push(`"${item.name || 'Untitled'}" is a date/lot check but has no serial or lot number.`);
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
          is_header: c.isHeader || undefined,
          parent_compartment_id: c.parentCompartmentId || undefined,
          items: c.items.map((item, itemIdx) => ({
            name: item.name || 'Untitled Item',
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
                is_header: comp.isHeader,
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
                    critical_minimum_quantity: item.criticalMinimumQuantity ? Number(item.criticalMinimumQuantity) : undefined,
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
              critical_minimum_quantity: item.criticalMinimumQuantity ? Number(item.criticalMinimumQuantity) : undefined,
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
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<Array<{ id: string; userName: string; action: string; entityType: string; entityName?: string; changes?: Record<string, unknown>; createdAt?: string }>>([]);
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

  const loadVehiclePreset = (presetKey: string) => {
    const preset = VEHICLE_PRESETS[presetKey];
    if (!preset) return;

    const newCompartments: CompartmentFormState[] = preset.compartments.map(
      (comp) => ({
        name: comp.name,
        description: '',
        imageUrl: '',
        isHeader: false,
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
    reader.onload = (ev) => {
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
            items?: Array<Record<string, unknown>>;
          }>;
        };

        if (!data.compartments || !Array.isArray(data.compartments)) {
          toast.error('Invalid template file: missing compartments');
          return;
        }

        if (compartments.length > 0) {
          if (!window.confirm('Importing will replace all current compartments. Continue?')) return;
        }

        if (data.name) setForm((prev) => ({ ...prev, name: data.name ?? prev.name, description: data.description ?? prev.description }));

        const imported: CompartmentFormState[] = data.compartments.map((c) => ({
          name: c.name || 'Untitled',
          description: c.description ?? '',
          imageUrl: '',
          isHeader: Boolean(c.isHeader),
          parentCompartmentId: '',
          items: (c.items ?? []).map((item) => ({
            ...emptyItem(),
            name: (item.name as string) || '',
            description: (item.description as string) ?? '',
            checkType: ((item.checkType as string) || 'pass_fail') as CheckType,
            isRequired: Boolean(item.isRequired),
            requiredQuantity: item.requiredQuantity != null ? String(Number(item.requiredQuantity)) : '',
            expectedQuantity: item.expectedQuantity != null ? String(Number(item.expectedQuantity)) : '',
            criticalMinimumQuantity: item.criticalMinimumQuantity != null ? String(Number(item.criticalMinimumQuantity)) : '',
            minLevel: item.minLevel != null ? String(Number(item.minLevel)) : '',
            levelUnit: (item.levelUnit as string) ?? '',
            serialNumber: (item.serialNumber as string) ?? '',
            lotNumber: (item.lotNumber as string) ?? '',
            hasExpiration: Boolean(item.hasExpiration),
            expirationDate: (item.expirationDate as string) ?? '',
            expirationWarningDays: item.expirationWarningDays != null ? String(Number(item.expirationWarningDays)) : '30',
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
  const [csvPreview, setCsvPreview] = useState<{ compartment: string; name: string; checkType: string; expectedQty: string; criticalMin: string; levelUnit: string }[] | null>(null);

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) {
          toast.error('CSV file must have a header row and at least one data row');
          return;
        }

        const rows = lines.slice(1).map((line) => {
          const cols = line.split(',').map((c) => c.trim());
          return {
            compartment: cols[0] ?? '',
            name: cols[1] ?? '',
            checkType: cols[2] ?? 'pass_fail',
            expectedQty: cols[3] ?? '',
            criticalMin: cols[4] ?? '',
            levelUnit: cols[5] ?? '',
          };
        });

        setCsvPreview(rows);
      } catch {
        toast.error('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
    if (csvImportRef.current) csvImportRef.current.value = '';
  };

  const applyCsvImport = () => {
    if (!csvPreview) return;

    if (compartments.length > 0) {
      if (!window.confirm('Importing CSV will replace all current compartments. Continue?')) return;
    }

    const compMap = new Map<string, ItemFormState[]>();
    for (const row of csvPreview) {
      const compName = row.compartment || 'Uncategorized';
      if (!compMap.has(compName)) compMap.set(compName, []);
      const validCheckTypes = ['pass_fail', 'present', 'functional', 'quantity', 'level', 'date_lot', 'reading', 'text', 'header'];
      const checkType = (validCheckTypes.includes(row.checkType) ? row.checkType : 'pass_fail') as CheckType;
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
      name,
      description: '',
      imageUrl: '',
      isHeader: false,
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
        ...(c.isHeader ? { isHeader: true } : {}),
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
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
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

    const isHeader = item.checkType === 'header';

    return (
      <div
        key={itemKey}
        className={`rounded-md border overflow-hidden transition-colors ${
          isSelected
            ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
            : isHeader
              ? 'border-theme-surface-border bg-theme-surface'
              : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        {/* Compact row — always visible */}
        <div
          className="group/item flex flex-wrap sm:flex-nowrap items-center gap-1.5 px-2 sm:px-3 py-2 cursor-pointer hover:bg-theme-surface-secondary/50 transition-colors"
          onClick={() => toggleItemExpanded(itemKey)}
        >
          {/* Bulk selection checkbox */}
          <button
            type="button"
            className="p-0.5 flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); toggleItemSelection(compIdx, itemIdx); }}
            aria-label={isSelected ? 'Deselect item' : 'Select item'}
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

          <button
            type="button"
            className="p-0.5 flex-shrink-0 text-theme-text-muted hover:text-theme-text-primary"
            onClick={(e) => { e.stopPropagation(); toggleItemExpanded(itemKey); }}
            aria-expanded={isItemExpanded}
            aria-label={`${isItemExpanded ? 'Collapse' : 'Expand'} ${item.name.trim() || 'item'}`}
          >
            {isItemExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          {isHeader && <Type className="h-3.5 w-3.5 text-theme-text-muted flex-shrink-0" />}

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
              className={`flex-1 text-sm truncate ${isHeader ? 'text-theme-text-primary font-bold' : item.name.trim() ? 'text-theme-text-primary font-medium' : 'text-theme-text-muted italic'}`}
              onDoubleClick={(e) => startInlineEdit(itemKey, item.name, e)}
              title="Double-click to rename"
            >
              {item.name.trim() || (isHeader ? 'Untitled Header' : 'Untitled Item')}
            </span>
          )}

          <button
            type="button"
            className="p-0.5 flex-shrink-0 text-theme-text-muted hover:text-blue-600 opacity-0 group-hover/item:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); startInlineEdit(itemKey, item.name, e); }}
            aria-label={`Rename ${item.name.trim() || 'item'}`}
          >
            <Pencil className="h-3 w-3" />
          </button>

          {/* Badges */}
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-theme-surface-secondary text-theme-text-muted">
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
          <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* Move up/down buttons */}
            <button
              type="button"
              onClick={() => moveItem(compIdx, itemIdx, 'up')}
              disabled={itemIdx === 0}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`Move ${item.name || 'item'} up`}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => moveItem(compIdx, itemIdx, 'down')}
              disabled={itemIdx === itemCount - 1}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`Move ${item.name || 'item'} down`}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => duplicateItem(compIdx, itemIdx)}
              className="p-1 text-theme-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              aria-label={`Duplicate ${item.name || 'item'}`}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {compartments.length > 1 && (
              <div className="relative p-1 text-theme-text-muted hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded transition-colors">
                <ArrowRightLeft className="h-3.5 w-3.5 pointer-events-none" aria-hidden="true" />
                <select
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
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
                  <option value="" disabled>Move to…</option>
                  {compartments.map((c, ci) => ci !== compIdx ? (
                    <option key={ci} value={ci}>{c.name || `Compartment ${ci + 1}`}</option>
                  ) : null)}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => void deleteItem(compIdx, itemIdx)}
              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              aria-label={`Delete ${item.name || 'item'}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Expanded form — visible on click */}
        {isItemExpanded && (
          <div className="border-t border-theme-surface-border px-3 py-3 space-y-3">
            {/* Name + Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            {!isHeader && (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    <label className={labelClass}>Expected Qty</label>
                    <p className="text-xs text-theme-text-secondary mb-1">How many should be on the apparatus</p>
                    <input type="number" className={inputClass} min="0" placeholder="0" value={item.expectedQuantity} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { expectedQuantity: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Min to Pass</label>
                    <p className="text-xs text-theme-text-secondary mb-1">Below this count = auto-fail</p>
                    <input type="number" className={inputClass} min="0" placeholder="0" value={item.requiredQuantity} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { requiredQuantity: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>
                      <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-red-500" />
                      Critical Min
                    </label>
                    <p className="text-xs text-theme-text-secondary mb-1">Below this = urgent alert to leadership</p>
                    <input type="number" className={inputClass} min="0" placeholder="0" value={item.criticalMinimumQuantity} onChange={(e) => updateItemFieldWithAutoSave(compIdx, itemIdx, { criticalMinimumQuantity: e.target.value })} />
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
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
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
            </>)}
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

    // Section header compartment — simplified visual divider
    if (comp.isHeader) {
      return (
        <div
          key={key}
          ref={sortableRef}
          style={sortableStyle}
          {...(sortableAttributes ?? {})}
          className="rounded-lg border border-theme-surface-border bg-theme-surface overflow-hidden"
        >
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-3">
            <button
              type="button"
              className="p-0.5 text-theme-text-muted cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
              aria-label="Drag to reorder section"
              {...(dragHandleProps ?? {})}
            >
              <GripVertical className="h-5 w-5" />
            </button>

            <Type className="h-4 w-4 text-theme-text-muted flex-shrink-0" />

            <input
              type="text"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-theme-text-primary font-bold text-sm placeholder:font-normal placeholder:text-theme-text-muted"
              placeholder="Section heading..."
              value={comp.name}
              onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
            />

            <span className="rounded-full bg-theme-surface-secondary px-2 py-0.5 text-[10px] font-medium text-theme-text-muted flex-shrink-0">
              Section
            </span>

            <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => moveCompartment(idx, 'up')}
                disabled={idx === 0}
                className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move section up"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => moveCompartment(idx, 'down')}
                disabled={idx === compartments.length - 1}
                className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move section down"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void deleteCompartment(idx)}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                aria-label="Delete section header"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {comp.description && (
            <div className="px-4 pb-2 -mt-1">
              <p className="text-xs text-theme-text-muted">{comp.description}</p>
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
        className="rounded-lg border border-theme-surface-border bg-theme-surface overflow-hidden"
      >
        {/* Compartment header */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-3 bg-theme-surface">
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
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
            )}
            <span className="font-medium text-theme-text-primary truncate">
              {comp.name || 'Untitled Compartment'}
            </span>
          </button>

          {/* Status badges */}
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
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
                    {status === 'complete' && <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />}
                    {status === 'warning' && <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />}
                    {status === 'empty' && <Circle className="h-2.5 w-2.5" aria-hidden="true" />}
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
          <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => moveCompartment(idx, 'up')}
              disabled={idx === 0}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`Move ${comp.name || 'compartment'} up`}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => moveCompartment(idx, 'down')}
              disabled={idx === compartments.length - 1}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={`Move ${comp.name || 'compartment'} down`}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => duplicateCompartment(idx)}
              className="p-1 text-theme-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              aria-label={`Duplicate ${comp.name || 'compartment'}`}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void deleteCompartment(idx)}
              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              aria-label={`Delete ${comp.name || 'compartment'}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Compartment body */}
        {isExpanded && (
          <div className="border-t border-theme-surface-border px-4 py-4 space-y-4">
            {/* Compartment fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor={`comp-name-${key}`} className={labelClass}>Compartment Name</label>
                <input
                  id={`comp-name-${key}`}
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Driver Side, Cab, Hose Bed"
                  value={comp.name}
                  onChange={(e) => updateCompartmentField(idx, { name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`comp-desc-${key}`} className={labelClass}>Description</label>
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
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Bulk selection controls */}
                  {comp.items.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {getSelectedCount(idx) > 0 ? (
                        <>
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium mr-1">
                            {getSelectedCount(idx)} selected
                          </span>
                          {/* Bulk edit: set check type */}
                          <select
                            className="rounded-md border border-blue-300 dark:border-blue-700 bg-theme-surface px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                bulkSetCheckType(idx, e.target.value as CheckType);
                              }
                            }}
                          >
                            <option value="" disabled>Set type...</option>
                            {CHECK_TYPES.map((ct) => (
                              <option key={ct.value} value={ct.value}>{ct.label}</option>
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
                            className="flex items-center gap-1 rounded-md border border-blue-300 dark:border-blue-700 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
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
                            className="flex items-center gap-1 rounded-md border border-red-300 dark:border-red-700 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            aria-label="Delete selected items"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
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
                    onClick={() => {
                      const compKey = getCompKey(idx);
                      setShowEquipmentPresets((prev) => ({ ...prev, [compKey]: !prev[compKey] }));
                    }}
                    className="flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                    title="Add a pre-built equipment kit"
                  >
                    <Package className="h-3.5 w-3.5" />
                    Add Kit
                  </button>
                  <button
                    type="button"
                    onClick={() => void addHeader(idx)}
                    className="flex items-center gap-1 rounded-md border border-dashed border-theme-surface-border px-3 py-1.5 text-xs font-medium text-theme-text-muted hover:border-theme-text-primary hover:text-theme-text-primary transition-colors"
                  >
                    <Type className="h-3.5 w-3.5" />
                    Header
                  </button>
                </div>
              </div>

              {/* Equipment Preset Picker */}
              {(showEquipmentPresets[getCompKey(idx)] ?? false) && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-theme-text-primary">Add equipment kit:</p>
                    <button
                      type="button"
                      onClick={() => setShowEquipmentPresets((prev) => ({ ...prev, [getCompKey(idx)]: false }))}
                      className="p-0.5 text-theme-text-muted hover:text-theme-text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {Object.entries(EQUIPMENT_PRESETS).map(([presetKey, preset]) => (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => void addEquipmentPreset(idx, presetKey)}
                        className="rounded-md border border-theme-surface-border bg-theme-surface px-2 py-1.5 text-xs text-theme-text-primary hover:border-green-500/40 hover:bg-green-500/10 transition-colors text-left"
                      >
                        <span className="font-medium">{preset.label}</span>
                        <span className="block text-[10px] text-theme-text-muted">
                          {preset.items.length} items
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {comp.items.length === 0 && (
                <p className="text-sm text-theme-text-muted italic py-2">
                  No items yet. Type a name below and press Enter, or use &ldquo;Add Kit&rdquo; for pre-built groups.
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

              {/* Quick-add bar */}
              {(() => {
                const compKey = getCompKey(idx);
                const isBulkPaste = bulkPasteMode[compKey] ?? false;

                return (
                  <div className="mt-2 rounded-md border border-dashed border-theme-surface-border bg-theme-surface-secondary/30 p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-medium text-theme-text-muted uppercase tracking-wide">
                        {isBulkPaste ? 'Bulk Add' : 'Quick Add'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setBulkPasteMode((prev) => ({ ...prev, [compKey]: !isBulkPaste }))}
                        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                          isBulkPaste
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
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
                          <span className="text-[10px] text-theme-text-muted">
                            {(() => {
                              const lines = (bulkPasteValues[compKey] ?? '').split('\n').filter((l) => l.trim()).length;
                              return lines > 0 ? `${lines} item${lines !== 1 ? 's' : ''} to add` : 'Paste a list';
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleBulkPaste(idx)}
                            disabled={(bulkPasteValues[compKey] ?? '').trim().length === 0}
                            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add All
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="form-input text-sm flex-1"
                          placeholder="Type item name and press Enter..."
                          value={quickAddValues[compKey] ?? ''}
                          onChange={(e) => setQuickAddValues((prev) => ({ ...prev, [compKey]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleQuickAdd(idx);
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleQuickAdd(idx)}
                          disabled={!(quickAddValues[compKey] ?? '').trim()}
                          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors flex-shrink-0"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      </div>
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
        <p className="mt-1 text-xs text-theme-text-muted">
          Leave as &quot;All of type&quot; to use this template as the default for all {form.apparatusType || 'apparatus'} units
        </p>
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
            onClick={exportTemplateJson}
            disabled={compartments.length === 0}
            className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary disabled:opacity-50 transition-colors"
            title="Export template as JSON"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              title="Import template from JSON"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Import JSON</span>
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportTemplate}
            />
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => csvImportRef.current?.click()}
              className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              title="Import items from CSV spreadsheet"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Import CSV</span>
            </button>
            <input
              ref={csvImportRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsvImport}
            />
          </div>
          <a
            href={schedulingService.getCsvSampleUrl()}
            download
            className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
            title="Download a sample CSV file for import"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">CSV Sample</span>
          </a>
          {templateId && (
            <button
              type="button"
              onClick={() => { setShowChangelog(true); void loadChangelog(); }}
              className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              title="View change history (admin only)"
            >
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
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
      <div className="mx-auto max-w-7xl flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Sidebar — Template details */}
        <div className={`flex-shrink-0 transition-all duration-200 ${sidebarOpen ? 'w-full lg:w-72' : 'w-0'} overflow-hidden`}>
          <div className="w-full lg:w-72 rounded-lg border border-theme-surface-border bg-theme-surface p-4 lg:sticky lg:top-4">
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
                onClick={() => void addSectionHeader()}
                className="flex items-center gap-1.5 rounded-md border border-dashed border-theme-surface-border px-3 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-secondary hover:text-theme-text-primary transition-colors"
              >
                <Type className="h-4 w-4" />
                Add Section
              </button>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
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
          <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0 px-4 py-2">
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
              {autoSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-xs text-blue-500 animate-pulse">
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

      {/* Change Log Modal (admin only) */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-theme-surface shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-theme-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Change History {changelogTotal > 0 && <span className="text-sm font-normal text-theme-text-secondary">({changelogTotal} entries)</span>}
              </h3>
              <button type="button" onClick={() => setShowChangelog(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto px-6 py-4">
              {changelogLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : changelogEntries.length === 0 ? (
                <p className="py-8 text-center text-sm text-theme-text-secondary">No changes recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {changelogEntries.map((entry) => {
                    const actionColors: Record<string, string> = { add: 'text-green-600', update: 'text-blue-600', delete: 'text-red-600' };
                    const actionLabels: Record<string, string> = { add: 'Added', update: 'Updated', delete: 'Removed' };
                    return (
                      <div key={entry.id} className="rounded-md border border-theme-surface-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm">
                            <span className="font-medium text-theme-text-primary">{entry.userName}</span>
                            {' '}
                            <span className={actionColors[entry.action] ?? 'text-theme-text-secondary'}>
                              {actionLabels[entry.action] ?? entry.action}
                            </span>
                            {' '}
                            <span className="text-theme-text-secondary">{entry.entityType}</span>
                            {entry.entityName && (
                              <span className="font-medium text-theme-text-primary"> &quot;{entry.entityName}&quot;</span>
                            )}
                          </div>
                          {entry.createdAt && (
                            <span className="shrink-0 text-xs text-theme-text-muted">
                              {formatDateTime(entry.createdAt, tz)}
                            </span>
                          )}
                        </div>
                        {entry.changes && Object.keys(entry.changes).length > 0 && (
                          <div className="mt-2 text-xs text-theme-text-secondary">
                            {Object.entries(entry.changes).map(([key, val]) => (
                              <span key={key} className="mr-3 inline-block">
                                <span className="font-medium">{key.replace(/_/g, ' ')}:</span>{' '}
                                {val == null ? '—' : typeof val === 'string' ? val : typeof val === 'number' || typeof val === 'boolean' ? String(val) : JSON.stringify(val)}
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
            <div className="flex justify-end border-t border-theme-surface-border px-6 py-3">
              <button
                type="button"
                onClick={() => setShowChangelog(false)}
                className="rounded-md border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Preview Confirmation Modal */}
      {csvPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-theme-surface shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-theme-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                CSV Import Preview — {csvPreview.length} item(s)
              </h3>
              <button type="button" onClick={() => setCsvPreview(null)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border text-left text-theme-text-secondary">
                    <th className="pb-2 pr-3">Compartment</th>
                    <th className="pb-2 pr-3">Item</th>
                    <th className="pb-2 pr-3">Type</th>
                    <th className="pb-2 pr-3">Expected</th>
                    <th className="pb-2">Critical Min</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.map((row, i) => (
                    <tr key={i} className="border-b border-theme-surface-border/50">
                      <td className="py-1.5 pr-3 text-theme-text-secondary">{row.compartment}</td>
                      <td className="py-1.5 pr-3 text-theme-text-primary">{row.name}</td>
                      <td className="py-1.5 pr-3">{row.checkType}</td>
                      <td className="py-1.5 pr-3">{row.expectedQty || '—'}</td>
                      <td className="py-1.5">{row.criticalMin || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3 border-t border-theme-surface-border px-6 py-4">
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                className="rounded-md border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyCsvImport}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Import {csvPreview.length} Items
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal — mobile device frame */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative flex flex-col items-center gap-3">
            {/* Close button outside the phone frame */}
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="absolute -top-2 -right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-theme-surface text-theme-text-muted shadow-lg hover:text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Phone frame */}
            <div className="relative w-[375px] max-w-[90vw] rounded-[2.5rem] border-[6px] border-gray-800 dark:border-gray-600 bg-theme-surface shadow-2xl overflow-hidden">
              {/* Phone notch */}
              <div className="relative h-7 bg-gray-800 dark:bg-gray-600 flex items-end justify-center">
                <div className="w-28 h-5 rounded-b-2xl bg-gray-800 dark:bg-gray-600" />
              </div>

              {/* Phone status bar */}
              <div className="flex items-center justify-between px-6 py-1 bg-theme-surface text-[10px] text-theme-text-muted">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <div className="w-6 h-2.5 rounded-sm border border-theme-text-muted relative">
                    <div className="absolute inset-0.5 bg-theme-text-muted rounded-[1px]" style={{ width: '75%' }} />
                  </div>
                </div>
              </div>

              {/* Scrollable content area */}
              <div className="overflow-y-auto bg-theme-surface" style={{ height: 'min(70vh, 640px)' }}>
                <div className="px-1 pb-4">
                  <div className="mb-3 mx-3 mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400">
                      Preview — inputs are interactive but nothing will be submitted.
                    </p>
                  </div>
                  <EquipmentCheckForm shiftId="preview" template={buildPreviewTemplate()} previewMode />
                </div>
              </div>

              {/* Phone home indicator bar */}
              <div className="flex justify-center py-2 bg-theme-surface">
                <div className="w-32 h-1 rounded-full bg-gray-800/30 dark:bg-gray-400/30" />
              </div>
            </div>

            {/* Label */}
            <p className="text-xs text-gray-400 text-center">
              Mobile preview — most members will complete checks on their phone
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EquipmentCheckTemplateBuilder;
