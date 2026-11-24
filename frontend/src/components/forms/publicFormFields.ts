/**
 * A form field as a no-sign-in page receives it, and its translation into the
 * shape `FieldRenderer` draws.
 *
 * Shared by the two pages a member of the public reaches through a personal
 * link: an applicant's follow-up form and a requester's outreach feedback.
 * Both serve the backend's `PublicFollowUpFormField`.
 */

import type { FieldDefinition } from './FieldRenderer';

export interface PublicFormField {
  id: string;
  label: string;
  field_type: string;
  placeholder?: string | null | undefined;
  help_text?: string | null | undefined;
  required: boolean;
  min_length?: number | null | undefined;
  max_length?: number | null | undefined;
  min_value?: number | null | undefined;
  max_value?: number | null | undefined;
  options?: { value: string; label: string }[] | null | undefined;
  condition_field_id?: string | null | undefined;
  condition_operator?: string | null | undefined;
  condition_value?: string | null | undefined;
  sort_order: number;
  width: string;
  is_sensitive: boolean;
}

export function toFieldDefinition(field: PublicFormField): FieldDefinition {
  return {
    id: field.id,
    label: field.label,
    field_type: field.field_type,
    placeholder: field.placeholder ?? undefined,
    help_text: field.help_text ?? undefined,
    required: field.required,
    min_length: field.min_length ?? undefined,
    max_length: field.max_length ?? undefined,
    min_value: field.min_value ?? undefined,
    max_value: field.max_value ?? undefined,
    options: field.options ?? undefined,
    condition_field_id: field.condition_field_id ?? undefined,
    condition_operator: field.condition_operator ?? undefined,
    condition_value: field.condition_value ?? undefined,
    sort_order: field.sort_order,
    width: field.width,
    is_sensitive: field.is_sensitive,
  };
}
