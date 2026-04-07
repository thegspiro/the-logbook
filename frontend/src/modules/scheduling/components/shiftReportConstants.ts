export const DEFAULT_SKILLS = [
  'SCBA donning/doffing', 'Hose deployment', 'Ladder operations',
  'Search and rescue', 'Ventilation', 'Pump operations',
  'Patient assessment', 'CPR/AED', 'Vitals monitoring',
  'Radio communications', 'Scene size-up', 'Apparatus check-off',
];

export const DEFAULT_CALL_TYPE_OPTIONS = [
  'Structure Fire', 'Vehicle Fire', 'Brush/Wildland',
  'EMS/Medical', 'Motor Vehicle Accident', 'Hazmat',
  'Rescue/Extrication', 'Alarm Investigation', 'Public Assist', 'Other',
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
