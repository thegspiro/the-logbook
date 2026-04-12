/**
 * Shared Tailwind class strings and option arrays for the facilities module.
 *
 * Section components (Inspections, Maintenance, Rooms, Systems, Contacts,
 * Compliance, Overview) all reuse these values so styling changes propagate
 * from a single source.
 */

export const inputCls =
  'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';

export const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

export const INSPECTION_TYPE_OPTIONS = [
  'fire', 'building_code', 'health', 'ada', 'environmental',
  'insurance', 'routine', 'other',
] as const;

export const COMPLIANCE_TYPE_OPTIONS = [
  'nfpa', 'osha', 'ada', 'building_code', 'fire_code',
  'environmental', 'insurance', 'other',
] as const;

export const CONTACT_TYPE_OPTIONS = [
  'utility', 'fire_alarm', 'security', 'elevator', 'hvac',
  'plumbing', 'electrical', 'locksmith', 'hazmat', 'other',
] as const;

export const ROOM_TYPE_OPTIONS = [
  'apparatus_bay', 'bunk_room', 'kitchen', 'bathroom', 'office',
  'training_room', 'storage', 'mechanical', 'lobby', 'common_area',
  'laundry', 'gym', 'decontamination', 'dispatch', 'other',
] as const;

export const ZONE_OPTIONS = ['hot', 'transition', 'cold', 'unclassified'] as const;

export const CONDITION_OPTIONS = ['excellent', 'good', 'fair', 'poor', 'critical'] as const;

export const CONDITION_COLORS: Record<string, string> = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  good: 'text-blue-600 dark:text-blue-400',
  fair: 'text-amber-600 dark:text-amber-400',
  poor: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
};
