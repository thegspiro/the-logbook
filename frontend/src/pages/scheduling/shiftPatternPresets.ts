/**
 * Shift Pattern Presets
 *
 * Types and constant definitions for common fire department shift patterns.
 * Separated from the component file to satisfy the react-refresh/only-export-components rule.
 */

/** A single day entry in a cycle: "on" | "off" | "day" | "night" */
export type CycleEntry = 'on' | 'off' | 'day' | 'night';

export interface PresetPatternDef {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** The backend pattern_type to use when creating this pattern. */
  patternType: 'platoon';
  /** For simple on/off patterns (no cycle_pattern). */
  daysOn?: number;
  /** For simple on/off patterns (no cycle_pattern). */
  daysOff?: number;
  /** Total rotation cycle length. */
  cycleDays: number;
  /** Advanced cycle definition. When present, overrides daysOn/daysOff. */
  cyclePattern?: CycleEntry[];
  /** Whether this pattern has day/night distinction. */
  hasDayNight: boolean;
  /** Category for grouping. */
  category: 'simple' | 'complex' | 'rotating';
}

export const PRESET_PATTERNS: PresetPatternDef[] = [
  {
    id: '24-48',
    name: '24-Hour On / 48-Hour Off',
    shortName: '24/48',
    description: 'On duty for 24 consecutive hours, followed by 48 hours off duty.',
    patternType: 'platoon',
    daysOn: 1,
    daysOff: 2,
    cycleDays: 3,
    hasDayNight: false,
    category: 'simple',
  },
  {
    id: '48-96',
    name: '48-Hour On / 96-Hour Off',
    shortName: '48/96',
    description: 'On duty for 48 consecutive hours, followed by 96 hours off duty.',
    patternType: 'platoon',
    daysOn: 2,
    daysOff: 4,
    cycleDays: 6,
    hasDayNight: false,
    category: 'simple',
  },
  {
    id: '12-hour',
    name: '12-Hour Shifts (4 On / 4 Off)',
    shortName: '12hr 4/4',
    description: '4 consecutive 12-hour shifts, followed by 4 days off.',
    patternType: 'platoon',
    daysOn: 4,
    daysOff: 4,
    cycleDays: 8,
    hasDayNight: false,
    category: 'simple',
  },
  {
    id: 'kelly',
    name: 'Kelly Schedule',
    shortName: 'Kelly',
    description: '24 hours on, 24 off, 24 on, 24 off, 24 on, followed by 96 hours (4 days) off.',
    patternType: 'platoon',
    cycleDays: 9,
    cyclePattern: ['on', 'off', 'on', 'off', 'on', 'off', 'off', 'off', 'off'],
    hasDayNight: false,
    category: 'complex',
  },
  {
    id: 'california-swing',
    name: 'California Swing Shift',
    shortName: 'CA Swing',
    description: '24 hours on, 24 hours off for 5 consecutive days, followed by 96 hours off.',
    patternType: 'platoon',
    cycleDays: 9,
    cyclePattern: ['on', 'off', 'on', 'off', 'on', 'off', 'off', 'off', 'off'],
    hasDayNight: false,
    category: 'complex',
  },
  {
    id: '6-day',
    name: '6-Day Schedule',
    shortName: '6-Day',
    description: '2 day shifts, 2 night shifts, followed by 2 days off.',
    patternType: 'platoon',
    cycleDays: 6,
    cyclePattern: ['day', 'day', 'night', 'night', 'off', 'off'],
    hasDayNight: true,
    category: 'rotating',
  },
  {
    id: '9-day',
    name: '9-Day Schedule',
    shortName: '9-Day',
    description: '3 day shifts, 3 night shifts, followed by 3 days off.',
    patternType: 'platoon',
    cycleDays: 9,
    cyclePattern: ['day', 'day', 'day', 'night', 'night', 'night', 'off', 'off', 'off'],
    hasDayNight: true,
    category: 'rotating',
  },
  {
    id: '21-day',
    name: '21-Day Schedule',
    shortName: '21-Day',
    description: '4 consecutive days on, 3 days off. Teams rotate between day, swing, and night over 21 days.',
    patternType: 'platoon',
    cycleDays: 21,
    cyclePattern: [
      'day', 'day', 'day', 'day', 'off', 'off', 'off',
      'day', 'day', 'day', 'day', 'off', 'off', 'off',
      'night', 'night', 'night', 'night', 'off', 'off', 'off',
    ],
    hasDayNight: true,
    category: 'rotating',
  },
  {
    id: '10h-14h',
    name: '10-Hour / 14-Hour Schedule',
    shortName: '10h/14h',
    description: '7 ten-hour day shifts and 7 fourteen-hour night shifts in a 28-day period.',
    patternType: 'platoon',
    cycleDays: 28,
    cyclePattern: [
      'day', 'day', 'day', 'day', 'day', 'day', 'day',
      'off', 'off', 'off', 'off', 'off', 'off', 'off',
      'night', 'night', 'night', 'night', 'night', 'night', 'night',
      'off', 'off', 'off', 'off', 'off', 'off', 'off',
    ],
    hasDayNight: true,
    category: 'rotating',
  },
  {
    id: 'forward-rotating',
    name: 'Forward Rotating Shift',
    shortName: 'Fwd Rot.',
    description: 'Shifts rotate forward: 4 day shifts, 4 off, 4 night shifts, 4 off over a 16-day cycle.',
    patternType: 'platoon',
    cycleDays: 16,
    cyclePattern: [
      'day', 'day', 'day', 'day', 'off', 'off', 'off', 'off',
      'night', 'night', 'night', 'night', 'off', 'off', 'off', 'off',
    ],
    hasDayNight: true,
    category: 'rotating',
  },
];
