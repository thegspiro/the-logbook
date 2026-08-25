/**
 * Governance — Organizational Chart Types
 *
 * Mirrors app/schemas/org_chart.py. Response fields are camelCase because the
 * backend serializes with `alias_generator=to_camel`.
 */

/**
 * Where a seat's people come from.
 *
 * `manual` is leadership listing them outright — the only option for a holder
 * with no login. The other two follow the application's own record of who is
 * what, so the Chief's box tracks whoever currently holds the Chief's role
 * without anybody remembering to edit two screens after an election.
 */
export const OrgChartHolderSource = {
  MANUAL: 'manual',
  POSITION: 'position',
  RANK: 'rank',
} as const;
export type OrgChartHolderSource = (typeof OrgChartHolderSource)[keyof typeof OrgChartHolderSource];

/** One person listed in a seat, already resolved to a name by the backend. */
export interface OrgChartHolder {
  /** Present whenever the person has a member record here. */
  userId?: string | null;
  name: string;
}

/** One seat on the department's chain of command. */
export interface OrgChartNode {
  id: string;
  parentId?: string | null;
  title: string;
  /** What this seat is in charge of — the question the chart answers. */
  responsibility?: string | null;
  /** Everybody in this seat. Empty means vacant. */
  holders: OrgChartHolder[];
  holderSource: OrgChartHolderSource;
  positionId?: string | null;
  rankCode?: string | null;
  /**
   * The role or rank this seat follows, resolved to its display name. Null on
   * a manual seat, and also when the role it follows no longer exists — which
   * is exactly when the seat reads as vacant.
   */
  sourceLabel?: string | null;
  /**
   * The seat's own published contact details. Never a holder's personal email
   * or phone — those are governed by the org's contact-visibility setting and
   * the chart is read by the whole membership.
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

/**
 * A role or rank a seat can follow. `holderCount` is shown in the picker
 * because a seat pointed at a role nobody holds renders as vacant, and finding
 * that out after saving reads as the link being broken.
 */
export interface OrgChartPositionOption {
  id: string;
  name: string;
  holderCount: number;
}

export interface OrgChartRankOption {
  code: string;
  name: string;
  holderCount: number;
}

export interface OrgChart {
  /** Depth-first: each parent immediately before its children. */
  nodes: OrgChartNode[];
  canManage: boolean;
  /** The three lists below are populated only for a caller who can manage. */
  members: OrgChartMemberOption[];
  positions: OrgChartPositionOption[];
  ranks: OrgChartRankOption[];
}

/** One person as the editor submits them: a member, a typed name, or both. */
export interface OrgChartHolderInput {
  userId?: string | undefined;
  displayName?: string | undefined;
}

export interface OrgChartNodeCreate {
  title: string;
  parentId?: string | undefined;
  responsibility?: string | undefined;
  holders?: OrgChartHolderInput[] | undefined;
  holderSource?: OrgChartHolderSource | undefined;
  positionId?: string | undefined;
  rankCode?: string | undefined;
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
  isPublished?: boolean | undefined;
}

/**
 * Edit payload. Nulls are meaningful: the backend applies the body with
 * `exclude_unset`, so an omitted key leaves the column alone while an explicit
 * `null` clears it (pitfall #1, update direction).
 *
 * `holders` is the exception, and deliberately so — it is a whole-collection
 * replace, so an omitted key leaves the people alone and `[]` empties the seat.
 */
export interface OrgChartNodeUpdate {
  title?: string | undefined;
  responsibility?: string | null | undefined;
  holders?: OrgChartHolderInput[] | undefined;
  holderSource?: OrgChartHolderSource | undefined;
  positionId?: string | null | undefined;
  rankCode?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactPhone?: string | null | undefined;
  isPublished?: boolean | undefined;
}

export interface OrgChartNodeMove {
  /**
   * Required, and `null` makes the seat a root of the chart. Not optional:
   * omitting it would reach the backend as "promote to root" when the caller
   * meant "reorder where it already is", which silently detaches a subtree.
   */
  parentId: string | null;
  position: number;
}
