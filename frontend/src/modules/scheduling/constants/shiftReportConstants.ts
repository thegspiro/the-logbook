export const DEFAULT_SKILLS = [
  'SCBA donning/doffing',
  'Hose deployment',
  'Ladder operations',
  'Search and rescue',
  'Ventilation',
  'Pump operations',
  'Patient assessment',
  'CPR/AED',
  'Vitals monitoring',
  'Radio communications',
  'Scene size-up',
  'Apparatus check-off',
];

export const DEFAULT_CALL_TYPE_OPTIONS = [
  'Structure Fire',
  'Vehicle Fire',
  'Brush/Wildland',
  'EMS/Medical',
  'Motor Vehicle Accident',
  'Hazmat',
  'Rescue/Extrication',
  'Alarm Investigation',
  'Public Assist',
  'Other',
];

export const SKILL_SCORE_LABELS: Record<number, string> = {
  1: 'Needs work',
  2: 'Developing',
  3: 'Competent',
  4: 'Proficient',
  5: 'Excellent',
};

export const DEFAULT_COMPETENCY_LABELS: Record<string, string> = {
  '1': 'Unsatisfactory',
  '2': 'Developing',
  '3': 'Competent',
  '4': 'Proficient',
  '5': 'Exemplary',
};

export const REVIEW_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', label: 'Draft' },
  pending_review: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', label: 'Pending Review' },
  approved: { bg: 'bg-green-500/10', text: 'text-green-700 dark:text-green-400', label: 'Approved' },
  flagged: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', label: 'Flagged' },
};

export const SAMPLE_CALL_TYPES = [
  'Structure Fire',
  'Vehicle Fire',
  'Brush/Wildland',
  'EMS/Medical',
  'Motor Vehicle Accident',
  'Hazmat',
  'Rescue/Extrication',
  'Alarm Investigation',
  'Water Rescue',
  'Public Assist',
  'Other',
];

export const SAMPLE_SKILLS = [
  'SCBA donning/doffing',
  'Hose deployment',
  'Ladder operations',
  'Search and rescue',
  'Ventilation',
  'Radio communications',
  'Scene size-up',
  'Knot tying',
  'Forcible entry',
  'Patient assessment',
  'CPR/AED',
  'Vitals monitoring',
  'Apparatus check-off',
];

export const SAMPLE_TASKS = [
  'Apparatus check-off',
  'Station duties',
  'Equipment inventory',
  'Hydrant inspection',
  'Pre-plan review',
  'Map/district familiarization',
  'Training drill participation',
  'Report writing',
  'PPE inspection',
];

export const SAMPLE_APPARATUS_SKILLS: Record<string, string[]> = {
  engine: [
    'Pump operations',
    'Hose deployment',
    'Hydrant connection',
    'Drafting',
    'Foam operations',
    'Attack line advancement',
    'Water supply establishment',
    'Apparatus positioning',
  ],
  ladder: [
    'Aerial operations',
    'Ladder placement',
    'Ventilation (vertical)',
    'Roof operations',
    'Forcible entry',
    'Ground ladder deployment',
    'Elevated master stream',
    'Building size-up',
  ],
  ambulance: [
    'Patient assessment',
    'Vitals monitoring',
    'CPR/AED',
    'Airway management',
    'IV/IO access',
    'Splinting/immobilization',
    'Medication administration',
    'Patient packaging/transport',
    '12-lead ECG interpretation',
  ],
  rescue: [
    'Vehicle extrication',
    'Confined space entry',
    'Rope rescue (high/low angle)',
    'Structural collapse operations',
    'Trench rescue',
    'Water rescue',
    'Stabilization techniques',
    'Cribbing and shoring',
  ],
  tanker: [
    'Water shuttle operations',
    'Portable tank setup',
    'Drafting from portable tank',
    'Dump valve operations',
    'Tanker positioning',
    'Water supply calculation',
  ],
  hazmat: [
    'HazMat identification (placards/SDS)',
    'Level A/B suit donning',
    'Decontamination setup',
    'Air monitoring',
    'Containment/damming',
    'ERG reference and zone establishment',
  ],
  brush: [
    'Wildland fire line construction',
    'Pump and roll operations',
    'Foam application (Class A)',
    'Mop-up techniques',
    'Weather observation and reporting',
  ],
  chief: [
    'Incident command establishment',
    'Resource management',
    'Accountability tracking',
    'Strategic decision-making',
    'Interagency coordination',
  ],
  boat: [
    'Vessel operation and navigation',
    'Water rescue swimmer deployment',
    'Throw bag / reach techniques',
    'Towing and anchoring',
  ],
};

export const SAMPLE_APPARATUS_TASKS: Record<string, string[]> = {
  engine: [
    'Pump test / pressure check',
    'Hose load inspection',
    'Nozzle and appliance check',
    'Tank fill verification',
  ],
  ladder: [
    'Aerial function test',
    'Ground ladder inventory',
    'Hydraulic system check',
    'Outrigger/stabilizer inspection',
  ],
  ambulance: [
    'Medication expiration check',
    'Monitor/defibrillator test',
    'Oxygen supply verification',
    'Stretcher and restraint check',
    'BLS/ALS supply restock',
  ],
  rescue: [
    'Extrication tool function test',
    'Rope and harness inspection',
    'Air supply verification',
    'Cribbing inventory',
  ],
  tanker: ['Tank integrity check', 'Dump valve function test', 'Portable tank condition check'],
  hazmat: ['Detection equipment calibration', 'PPE suit integrity check', 'Decon supplies inventory'],
};

/**
 * The hours to credit **one** member for a shift.
 *
 * Not `shift.total_hours`: that is the sum of every attendee's minutes — crew
 * hours — so a three-person 12-hour shift carries 36. The batch form files one
 * report per crew member, and pre-filling each of them from the crew total
 * credited every rider with everybody's hours, into the requirement progress
 * and the state reports downstream of it.
 *
 * The shift's own span is the right default. Where it is unknown, 0 is returned
 * and the officer types the hours — the field is required, so an empty one is
 * refused rather than filed wrong.
 */
export function shiftHoursForOneMember(shift: { start_time?: string | null; end_time?: string | null }): number {
  if (!shift.start_time || !shift.end_time) return 0;
  const start = new Date(shift.start_time).getTime();
  const end = new Date(shift.end_time).getTime();
  if (!(end > start)) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}
