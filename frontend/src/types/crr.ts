/**
 * Community risk reduction (CRR): the department's activity catalogue
 * (GET /crr/catalogue). snake_case, as the backend's crr schemas send it.
 */

export const CrrTagKind = {
  RISK: 'risk',
  POPULATION: 'population',
} as const;
export type CrrTagKind = (typeof CrrTagKind)[keyof typeof CrrTagKind];

export interface CrrMeasure {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
}

export interface CrrActivityType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Seeded with the department's catalogue: retired, never deleted. */
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  measures: CrrMeasure[];
  tag_ids: string[];
  /** Null: credits the department's Public Education mapping instead. */
  admin_hours_category_id: string | null;
}

export interface CrrTag {
  id: string;
  kind: CrrTagKind;
  code: string;
  label: string;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface CrrOption {
  id: string;
  name: string;
}

export interface CrrCatalogue {
  activity_types: CrrActivityType[];
  tags: CrrTag[];
  admin_hours_categories: CrrOption[];
  resident_details_retention_months: number;
}

export interface CrrActivityTypeUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
  admin_hours_category_id?: string | null | undefined;
}

export interface CrrFormOptions {
  activity_types: CrrActivityType[];
  tags: CrrTag[];
  default_city: string | null;
  default_state: string | null;
  zip_lookup_enabled: boolean;
  members: CrrOption[];
  retention_months: number;
  can_view_contact: boolean;
}

export interface CrrActivity {
  id: string;
  activity_type_id: string;
  activity_type_name: string;
  event_id: string | null;
  event_title: string | null;
  occurred_at: string;
  zip_code: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  counts: { measure_id: string; label: string; quantity: number }[];
  tags: { id: string; label: string }[];
  members: { user_id: string; name: string; minutes: number }[];
  recorded_by_name: string | null;
  /** Said to everyone; the details themselves only to crr.view_contact holders. */
  has_resident_details: boolean;
  resident_details_cleared: boolean;
  street_address: string | null;
  resident_name: string | null;
  resident_phone: string | null;
  resident_email: string | null;
  notes: string | null;
  can_edit: boolean;
}

export interface CrrActivityList {
  items: CrrActivity[];
  total: number;
}

export interface CrrActivityCreate {
  activity_type_id: string;
  occurred_at: string;
  event_id?: string | undefined;
  counts: Record<string, number>;
  tag_ids?: string[] | undefined;
  zip_code?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  has_resident_details: boolean;
  street_address?: string | undefined;
  resident_name?: string | undefined;
  resident_phone?: string | undefined;
  resident_email?: string | undefined;
  notes?: string | undefined;
  members: Record<string, number>;
}

export interface CrrZipPlace {
  zip_code: string;
  city: string;
  state: string;
  county: string;
}
