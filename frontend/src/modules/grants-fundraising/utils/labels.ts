/**
 * Display labels shared across the Grants & Fundraising pages.
 */

import { GrantCategory } from '../types';

export const GRANT_CATEGORY_LABELS: Record<GrantCategory, string> = {
  [GrantCategory.EQUIPMENT]: 'Equipment',
  [GrantCategory.STAFFING]: 'Staffing',
  [GrantCategory.TRAINING]: 'Training',
  [GrantCategory.PREVENTION]: 'Prevention',
  [GrantCategory.FACILITIES]: 'Facilities',
  [GrantCategory.VEHICLES]: 'Vehicles',
  [GrantCategory.WELLNESS]: 'Wellness',
  [GrantCategory.COMMUNITY]: 'Community',
  [GrantCategory.OTHER]: 'Other',
};
