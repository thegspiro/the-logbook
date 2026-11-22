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

export interface CrrCatalogue {
  activity_types: CrrActivityType[];
  tags: CrrTag[];
}

export interface CrrActivityTypeUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}
