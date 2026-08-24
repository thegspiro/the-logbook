/**
 * Governance — Organizational Chart Types
 *
 * Mirrors app/schemas/org_chart.py. Response fields are camelCase because the
 * backend serializes with `alias_generator=to_camel`.
 */

/** One seat on the department's chain of command. */
export interface OrgChartNode {
  id: string;
  parentId?: string | null;
  title: string;
  /** What this seat is in charge of — the question the chart answers. */
  responsibility?: string | null;
  userId?: string | null;
  /** Typed override if present, otherwise the linked member's name. */
  holderName?: string | null;
  displayName?: string | null;
  /**
   * The seat's own published contact details. Never the holder's personal
   * email or phone — those are governed by the org's contact-visibility
   * setting and the chart is read by the whole membership.
   */
  contactEmail?: string | null;
  contactPhone?: string | null;
  sortOrder: number;
  isPublished: boolean;
  /** Distance from a root, so the page can indent without walking the list. */
  depth: number;
}

export interface OrgChartMemberOption {
  id: string;
  name: string;
}

export interface OrgChart {
  /** Depth-first: each parent immediately before its children. */
  nodes: OrgChartNode[];
  canManage: boolean;
  /** Populated only for a caller who can manage the chart. */
  members: OrgChartMemberOption[];
}

export interface OrgChartNodeCreate {
  title: string;
  parentId?: string | undefined;
  responsibility?: string | undefined;
  userId?: string | undefined;
  displayName?: string | undefined;
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
  isPublished?: boolean | undefined;
}

/**
 * Edit payload. Nulls are meaningful: the backend applies the body with
 * `exclude_unset`, so an omitted key leaves the column alone while an explicit
 * `null` clears it (pitfall #1, update direction).
 */
export interface OrgChartNodeUpdate {
  title?: string | undefined;
  responsibility?: string | null | undefined;
  userId?: string | null | undefined;
  displayName?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactPhone?: string | null | undefined;
  isPublished?: boolean | undefined;
}

export interface OrgChartNodeMove {
  /** `null` makes the seat a root of the chart. */
  parentId?: string | null | undefined;
  position: number;
}
