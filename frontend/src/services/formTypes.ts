/**
 * Form type definitions used by the forms module (FormBuilder, FieldEditor, etc.)
 *
 * Extracted from inventoryService.ts where they were co-located due to
 * historical extraction overlap.
 */

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  form_id: string;
  label: string;
  field_type: string;
  placeholder?: string | undefined;
  help_text?: string | undefined;
  default_value?: string | undefined;
  required: boolean;
  min_length?: number | undefined;
  max_length?: number | undefined;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string | undefined;
  options?: FormFieldOption[] | undefined;
  condition_field_id?: string | undefined;
  condition_operator?: string | undefined;
  condition_value?: string | undefined;
  sort_order: number;
  width: string;
  created_at: string;
  updated_at: string;
}

export interface FormFieldCreate {
  label: string;
  field_type: string;
  placeholder?: string | undefined;
  help_text?: string | undefined;
  default_value?: string | undefined;
  required?: boolean;
  min_length?: number | undefined;
  max_length?: number | undefined;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string | undefined;
  options?: FormFieldOption[] | undefined;
  condition_field_id?: string | undefined;
  condition_operator?: string | undefined;
  condition_value?: string | undefined;
  sort_order?: number;
  width?: string;
}

export interface FormIntegration {
  id: string;
  form_id: string;
  organization_id: string;
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormIntegrationCreate {
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active?: boolean;
}

export interface MemberLookupResult {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  membership_number?: string;
  rank?: string;
  station?: string;
  email?: string;
}

export interface MemberLookupResponse {
  members: MemberLookupResult[];
  total: number;
}

export interface FormDef {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  category: string;
  status: string;
  allow_multiple_submissions: boolean;
  require_authentication: boolean;
  notify_on_submission: boolean;
  notification_emails?: string[];
  is_public: boolean;
  public_slug?: string;
  integration_type?: string;
  version: number;
  is_template: boolean;
  field_count?: number;
  submission_count?: number;
  created_at: string;
  updated_at: string;
  published_at?: string;
  created_by?: string;
}

export interface FormDetailDef extends FormDef {
  fields: FormField[];
  integrations: FormIntegration[];
}

export interface FormCreate {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  allow_multiple_submissions?: boolean | undefined;
  require_authentication?: boolean | undefined;
  notify_on_submission?: boolean | undefined;
  notification_emails?: string[] | undefined;
  is_public?: boolean | undefined;
  integration_type?: string | undefined;
  fields?: FormFieldCreate[] | undefined;
}

export interface FormUpdate {
  name?: string;
  description?: string;
  category?: string;
  status?: string;
  allow_multiple_submissions?: boolean;
  require_authentication?: boolean;
  notify_on_submission?: boolean;
  notification_emails?: string[];
  is_public?: boolean;
}

export interface FormsListResponse {
  forms: FormDef[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormSubmission {
  id: string;
  organization_id: string;
  form_id: string;
  submitted_by?: string;
  submitted_at: string;
  data: Record<string, unknown>;
  submitter_name?: string;
  submitter_email?: string;
  is_public_submission: boolean;
  integration_processed: boolean;
  integration_result?: Record<string, unknown>;
  created_at: string;
}

export interface SubmissionsListResponse {
  submissions: FormSubmission[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormsSummary {
  total_forms: number;
  published_forms: number;
  draft_forms: number;
  total_submissions: number;
  submissions_this_month: number;
  public_forms: number;
}

export interface PublicFormField {
  id: string;
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  options?: FormFieldOption[];
  condition_field_id?: string;
  condition_operator?: string;
  condition_value?: string;
  sort_order: number;
  width: string;
}

export interface PublicFormDef {
  id: string;
  name: string;
  description?: string;
  category: string;
  allow_multiple_submissions: boolean;
  fields: PublicFormField[];
  organization_name?: string;
}

export interface PublicFormSubmissionResponse {
  id: string;
  form_name: string;
  submitted_at: string;
  message: string;
}
