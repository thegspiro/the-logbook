/**
 * The category form's fields, shared by the form that draws them and the tab
 * that saves them and maps a 422 back onto them.
 */

import type { ServerFieldSpec } from '@/utils/serverFieldErrors';

/** `AdminHoursCategoryCreate.name`'s max_length. */
export const CATEGORY_NAME_MAX_LENGTH = 200;

export type CategoryField =
  'name' | 'color' | 'description' | 'require_approval' | 'auto_approve_under_hours' | 'max_hours_per_session';

/** The fields as a 422 names them; admin-hours request schemas are snake_case. */
export const CATEGORY_SERVER_FIELDS: Record<CategoryField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: CATEGORY_NAME_MAX_LENGTH },
  color: { label: 'Color' },
  description: { label: 'Description' },
  require_approval: { label: 'Require approval' },
  auto_approve_under_hours: { label: 'Auto-approve under (hours)' },
  max_hours_per_session: { label: 'Max hours per session' },
};

/** The element each field's error moves focus to. */
export const CATEGORY_FIELD_IDS: Record<CategoryField, string> = {
  name: 'category-name',
  color: 'category-color',
  description: 'category-description',
  require_approval: 'category-require-approval',
  auto_approve_under_hours: 'category-auto-approve',
  max_hours_per_session: 'category-max-hours',
};
