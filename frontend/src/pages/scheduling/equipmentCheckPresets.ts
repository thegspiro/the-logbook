/**
 * Static preset data for the Equipment Check Template Builder.
 *
 * Extracted to keep the builder component focused on UI logic while these
 * ~570 lines of fire-service domain constants live in their own module.
 */

import type { CheckType } from '@/modules/scheduling/types/equipmentCheck';

// ============================================================================
// Check-type metadata
// ============================================================================

export const CHECK_TYPES = [
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

export const CHECK_TYPE_HELP: Record<string, string> = {
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

export const LEVEL_UNIT_PRESETS = [
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

export interface VehiclePreset {
  label: string;
  compartments: { name: string; items: { name: string; checkType: CheckType }[] }[];
}

export const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
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

// ============================================================================
// Equipment kit presets — quick-add groups of related items
// ============================================================================

export interface EquipmentPreset {
  label: string;
  items: { name: string; checkType: CheckType }[];
}

export const EQUIPMENT_PRESETS: Record<string, EquipmentPreset> = {
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
