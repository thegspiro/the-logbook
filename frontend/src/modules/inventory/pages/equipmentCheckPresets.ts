/**
 * Static preset data for the Equipment Check Template Builder.
 *
 * Extracted to keep the builder component focused on UI logic while these
 * ~570 lines of fire-service domain constants live in their own module.
 */

import type { CheckType } from '@/modules/inventory/types/equipmentCheck';

// ============================================================================
// Check-type metadata
// ============================================================================

// What the admin picks from. Four answer shapes, then the two structural rows.
// The order is the design's: level, function, count, expiry.
export const CHECK_TYPES = [
  { value: 'level', label: 'Level' },
  { value: 'function', label: 'Function' },
  { value: 'count', label: 'Count' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'text', label: 'Statement' },
  { value: 'header', label: 'Section Header' },
] as const;

export const CHECK_TYPE_HELP: Record<string, string> = {
  level:
    'A reading against a threshold — O2, fuel, coolant, battery volts. The number is kept, so the trend over shifts stays visible. Under the threshold fails the item and opens a swap task.',
  function:
    'Something switched on and watched — suction, lights and siren, radio, monitor. Write the test on the item so two people run it the same way. A fail always takes a note and a photo, neither of which blocks the walk.',
  count:
    'A par level to match. One tap confirms par; the stepper is for when it does not. Short of par becomes a restock line, not a failure.',
  expiry:
    'A date already on record, shown and confirmed rather than retyped, so the check is a glance at the vial. Inside the pull window the line stays amber on every shift until it is replaced.',
  text: 'Read-only statement or instruction. Displayed as informational text — no action required from the member.',
  header: 'Visual section divider to group items. Not a checkable item — just a label to help members navigate.',
};

export const LEVEL_UNIT_PRESETS = ['psi', '%', 'gallons', 'liters', 'inches', 'feet', 'bar', 'mmHg', 'quarts'] as const;

// ============================================================================
// Positions & apparatus types
// ============================================================================

export const POSITIONS = [
  'officer',
  'driver',
  'firefighter',
  'ems',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
] as const;

export const APPARATUS_TYPES = [
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

// ============================================================================
// Vehicle presets — pre-built compartment templates by apparatus type
// ============================================================================

/**
 * One line in a preset checklist.
 *
 * `description` is the test written on the item — "Run 10 seconds · must pull
 * 300 mmHg". A Function item without one asks the crew to judge "does it work"
 * with no shared definition of works, which is how two people run the same
 * check two ways.
 */
export interface PresetItem {
  name: string;
  checkType: CheckType;
  description?: string;
}

export interface VehiclePreset {
  label: string;
  compartments: { name: string; items: PresetItem[] }[];
}

export const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
  engine: {
    label: 'Engine / Pumper',
    compartments: [
      {
        name: 'Cab & Exterior',
        items: [
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Windshield wipers / washer',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Power steering fluid', checkType: 'level' },
          {
            name: 'Belts & hoses condition',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Battery condition & connections',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Pump Panel',
        items: [
          { name: 'Pump engages properly', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Gauges operational', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Primer works', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Pump panel lights', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Drain valves closed', checkType: 'function', description: 'Confirm the item passes inspection.' },
          { name: 'Tank water level', checkType: 'level' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Transmission (all gears)',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
        ],
      },
      {
        name: 'Safety & Cab Interior',
        items: [
          { name: 'Seat belts', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'SCBA mounted & secured', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Radio(s) operational', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'MDT / computer operational',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Cab clean & organized', checkType: 'function', description: 'Confirm the item passes inspection.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          {
            name: 'Belts & hoses condition',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Aerial Device',
        items: [
          {
            name: 'Aerial extends & retracts',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Aerial rotation', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Outriggers / stabilizers deploy',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Aerial hydraulic fluid level', checkType: 'level' },
          {
            name: 'Aerial lights / spotlight',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Rungs & rail condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Transmission', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Patient Compartment',
        items: [
          {
            name: 'Stretcher locks & operation',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'O2 system / regulators', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Suction unit', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Climate control (heat/AC)',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          {
            name: 'Patient compartment lights',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Sharps container level', checkType: 'function', description: 'Confirm the item passes inspection.' },
          {
            name: 'Compartment clean & sanitized',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Transmission', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren / horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
          {
            name: 'Belts & hoses condition',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Water Tank & Pump',
        items: [
          { name: 'Tank water level', checkType: 'level' },
          { name: 'Pump engages properly', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Pump gauges operational', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Dump valves / portable tank connections',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Foam concentrate level', checkType: 'level' },
          {
            name: 'Drain & fill valves closed',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Hose connections & fittings',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Transmission (all gears)',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren / horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Scene lighting / light tower',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Extrication Equipment',
        items: [
          { name: 'Hydraulic spreaders', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Hydraulic cutters', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Hydraulic rams', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Hydraulic power unit oil level', checkType: 'level' },
          {
            name: 'Hydraulic hoses & fittings',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          { name: 'Cribbing blocks', checkType: 'count' },
          {
            name: 'Step chocks / stabilization struts',
            checkType: 'function',
            description: 'Confirm the item is in place.',
          },
          {
            name: 'Hand tools (pry bars, axes, etc.)',
            checkType: 'function',
            description: 'Confirm the item is in place.',
          },
        ],
      },
      {
        name: 'Power Tools & Equipment',
        items: [
          { name: 'Generator starts & runs', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Generator fuel level', checkType: 'level' },
          {
            name: 'Reciprocating / circular saw',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Ventilation fan (PPV)', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Air bags / lifting equipment', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Rope & rigging gear', checkType: 'function', description: 'Confirm the item is in place.' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Transmission', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren / horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body / skid plate damage',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          { name: '4WD / AWD engagement', checkType: 'function', description: 'Switch it on and confirm it works.' },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Water Tank & Pump',
        items: [
          { name: 'Tank water level', checkType: 'level' },
          { name: 'Pump engages / prime', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Booster reel hose condition',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Nozzle(s) present & operational',
            checkType: 'function',
            description: 'Confirm the item is in place.',
          },
          {
            name: 'Foam system (if equipped)',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
        ],
      },
      {
        name: 'Wildland Equipment',
        items: [
          { name: 'Hand tools (Pulaski, McLeod, shovel)', checkType: 'count' },
          { name: 'Drip torches', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Fire shelters', checkType: 'count' },
          { name: 'Portable radio(s)', checkType: 'count' },
          { name: 'Chain saw & fuel', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Hull integrity / damage',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          { name: 'Navigation lights', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Emergency strobe / blue light',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          {
            name: 'Trailer lights & tongue hitch',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Drain plug installed', checkType: 'function', description: 'Confirm the item is in place.' },
        ],
      },
      {
        name: 'Engine & Motor',
        items: [
          { name: 'Engine oil level', checkType: 'level' },
          { name: 'Fuel level', checkType: 'level' },
          { name: 'Engine starts & runs', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Steering & throttle response',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Kill switch / lanyard', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Propeller condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Safety Equipment',
        items: [
          { name: 'PFDs / life jackets', checkType: 'count' },
          { name: 'Throw bag / ring buoy', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'First aid kit', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Fire extinguisher', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Anchor & line', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Paddle / oar', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'VHF marine radio', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren / horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Command & Communication',
        items: [
          { name: 'Mobile radio(s)', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'MDT / laptop & charger', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Accountability system / tags', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Command board / ICS forms', checkType: 'function', description: 'Confirm the item is in place.' },
          { name: 'Vest (IC, Safety, etc.)', checkType: 'function', description: 'Confirm the item is in place.' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Transmission', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
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
          {
            name: 'Lights & emergency warning system',
            checkType: 'function',
            description: 'Switch it on and confirm it works.',
          },
          { name: 'Siren / horn', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Mirrors', checkType: 'function', description: 'Switch it on and confirm it works.' },
          {
            name: 'Tire condition & pressure',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
          {
            name: 'Body damage / fluid leaks',
            checkType: 'function',
            description: 'Confirm the item passes inspection.',
          },
        ],
      },
      {
        name: 'Engine Compartment',
        items: [
          { name: 'Oil level', checkType: 'level' },
          { name: 'Coolant level', checkType: 'level' },
          { name: 'Battery condition', checkType: 'function', description: 'Confirm the item passes inspection.' },
        ],
      },
      {
        name: 'Brakes & Drivetrain',
        items: [
          { name: 'Service brakes', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Parking brake', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Transmission', checkType: 'function', description: 'Switch it on and confirm it works.' },
          { name: 'Steering responsiveness', checkType: 'function', description: 'Switch it on and confirm it works.' },
        ],
      },
    ],
  },
};

// ============================================================================
// Equipment kit presets — quick-add groups of related items
// ============================================================================

export interface EquipmentPreset {
  label: string;
  items: PresetItem[];
}

export const EQUIPMENT_PRESETS: Record<string, EquipmentPreset> = {
  scba: {
    label: 'SCBA Kit',
    items: [
      { name: 'SCBA pack & harness', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'SCBA mask (face piece)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'SCBA cylinder pressure', checkType: 'level' },
      { name: 'SCBA regulator', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'PASS device activates', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Spare SCBA cylinder', checkType: 'function', description: 'Confirm the item is in place.' },
    ],
  },
  aed: {
    label: 'AED / Defibrillator',
    items: [
      { name: 'AED unit powers on', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'AED pads (adult)', checkType: 'expiry' },
      { name: 'AED pads (pediatric)', checkType: 'expiry' },
      { name: 'AED battery level', checkType: 'level' },
    ],
  },
  vitals: {
    label: 'Basic Vitals Set',
    items: [
      { name: 'Blood pressure cuff (adult)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Blood pressure cuff (pediatric)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Stethoscope', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Pulse oximeter', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Glucometer & test strips', checkType: 'expiry' },
      { name: 'Thermometer', checkType: 'function', description: 'Switch it on and confirm it works.' },
    ],
  },
  airway: {
    label: 'Airway Management',
    items: [
      { name: 'BVM (adult)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'BVM (pediatric)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'OPA set', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'NPA set', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Suction unit', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Oxygen regulator', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Oxygen cylinder pressure', checkType: 'level' },
      { name: 'Non-rebreather masks', checkType: 'count' },
      { name: 'Nasal cannulas', checkType: 'count' },
    ],
  },
  ppe: {
    label: 'PPE / Turnout Gear',
    items: [
      { name: 'Helmet & face shield', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Turnout coat', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Turnout pants', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Boots', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Gloves (structural)', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Hood / balaclava', checkType: 'function', description: 'Confirm the item passes inspection.' },
    ],
  },
  hose: {
    label: 'Hose & Nozzles',
    items: [
      { name: 'Attack line (1.75")', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Supply line (5")', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Backup line (2.5")', checkType: 'function', description: 'Confirm the item passes inspection.' },
      { name: 'Nozzle (combination)', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Nozzle (smooth bore)', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Wye / gated valve', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Spanner wrenches', checkType: 'function', description: 'Confirm the item is in place.' },
    ],
  },
  firstaid: {
    label: 'First Aid / Trauma',
    items: [
      { name: 'Trauma shears', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Tourniquets', checkType: 'count' },
      { name: 'Hemostatic gauze', checkType: 'expiry' },
      { name: 'Chest seals', checkType: 'expiry' },
      { name: 'Gauze / bandages', checkType: 'count' },
      { name: 'Splint set', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Cervical collars', checkType: 'count' },
      { name: 'Backboard & straps', checkType: 'function', description: 'Confirm the item is in place.' },
    ],
  },
  lighting: {
    label: 'Lighting & Electrical',
    items: [
      { name: 'Scene lights', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Portable spotlight', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Flashlights', checkType: 'count' },
      { name: 'Light tower', checkType: 'function', description: 'Switch it on and confirm it works.' },
      { name: 'Extension cords', checkType: 'function', description: 'Confirm the item is in place.' },
      { name: 'Power strip / adapter', checkType: 'function', description: 'Confirm the item is in place.' },
    ],
  },
};
