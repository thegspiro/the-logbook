/**
 * Governance — Organizational Chart Types
 *
 * Mirrors app/schemas/org_chart.py. Response fields are camelCase because the
 * backend serializes with `alias_generator=to_camel`.
 */

/** One person listed in a seat, already resolved to a name by the backend. */
export interface OrgChartHolder {
  /** Present whenever the person has a member record here. */
  userId?: string | null;
  name: string;
  /**
   * True for somebody the application supplied because the seat is linked to
   * their role, rather than somebody leadership typed in. An officer editing
   * the seat needs to know which names they cannot remove from this screen.
   */
  fromLink?: boolean;
}

/** One seat on the department's chain of command. */
export interface OrgChartNode {
  id: string;
  parentId?: string | null;
  title: string;
  /** What this seat is in charge of — the question the chart answers. */
  responsibility?: string | null;
  /**
   * Everybody in this seat: whoever the linked role supplies, then the people
   * leadership typed in. Empty means vacant.
   */
  holders: OrgChartHolder[];
  /** At most one of these is set — a seat links to a role or a rank, not both. */
  positionId?: string | null;
  rankCode?: string | null;
  /**
   * The role or rank this seat is linked to, resolved to its display name.
   * Null on an unlinked seat, and also when the linked role no longer exists —
   * at which point the seat falls back to its own list.
   */
  linkLabel?: string | null;
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
 * A role or rank a seat can be linked to.
 *
 * The current holders travel with the option so the editor can answer "who is
 * the Chief?" the instant the role is picked — that immediate confirmation is
 * the point of linking, and a second round trip would deliver it late enough
 * to be missed.
 */
export interface OrgChartLinkOption {
  /** `position:<id>` or `rank:<code>` — one namespaced value, so roles and
   *  ranks can share a single "which role is this?" list. */
  value: string;
  label: string;
  holders: OrgChartHolder[];
}

/** Split a link option's namespaced value back into the two API fields. */
export const parseLinkValue = (value: string): { positionId?: string; rankCode?: string } => {
  if (value.startsWith('position:')) return { positionId: value.slice('position:'.length) };
  if (value.startsWith('rank:')) return { rankCode: value.slice('rank:'.length) };
  return {};
};

/** The namespaced value for a seat's current link, or '' when it has none. */
export const linkValueOf = (node: { positionId?: string | null; rankCode?: string | null }): string => {
  if (node.positionId) return `position:${node.positionId}`;
  if (node.rankCode) return `rank:${node.rankCode}`;
  return '';
};

export interface OrgChart {
  /** Depth-first: each parent immediately before its children. */
  nodes: OrgChartNode[];
  canManage: boolean;
  /** The three lists below are populated only for a caller who can manage. */
  members: OrgChartMemberOption[];
  roles: OrgChartLinkOption[];
  ranks: OrgChartLinkOption[];
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
 * replace, so an omitted key leaves the typed people alone and `[]` removes
 * them. It never carries the linked role's holders; those are not the client's
 * to send.
 */
export interface OrgChartNodeUpdate {
  title?: string | undefined;
  responsibility?: string | null | undefined;
  holders?: OrgChartHolderInput[] | undefined;
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
