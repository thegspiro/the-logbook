/**
 * The Members administration hub's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the hub into the main bundle.
 *
 * The hub draws them two levels deep, the way Training, Events, Inventory and
 * Scheduling Administration do: area cards above a strip of the chosen area's
 * pages. The URL stays `?tab=<page>` — page ids are unique across the hub, so
 * the area is derived from the page and every existing link resolves
 * unchanged.
 */

import type { LucideIcon } from 'lucide-react';
import { BadgeCheck, ClipboardList, Settings, Upload, UserPlus, Users } from 'lucide-react';
import type { AdminHubCardTab } from '../components/admin/AdminHubCardTabs';

export type MembersAdminTab = 'manage' | 'add' | 'import' | 'qualifications' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Adding and
 * importing are their own permission: members.manage lets an officer edit the
 * roster, users.create is what puts a new person on it.
 *
 * users.create, not members.create, despite the latter's name _(2026-09-06)_.
 * Both tabs submit through `userService.createMember`, which posts to
 * `POST /users`, and that endpoint requires `users.create`. `members.create`
 * reads like the right grant and is not: nothing that creates a member
 * enforces it — it gates the prospect pipeline (`POST /prospects` and
 * `/prospects/check-existing`), and its registry description said "Create new
 * members", which is what led these tabs to it. The two grants are held by the
 * same seeded positions, so this corrects the name rather than anyone's access.
 */
export const MEMBERS_ADMIN_TABS: (AdminHubCardTab<MembersAdminTab> & { permission?: string })[] = [
  {
    id: 'manage',
    label: 'Member Management',
    description: 'Edit members, assign roles and reset passwords',
    icon: Users,
  },
  {
    id: 'add',
    label: 'Add Member',
    description: 'Put one new person on the roster',
    icon: UserPlus,
    permission: 'users.create',
  },
  {
    id: 'import',
    label: 'Import Members',
    description: 'Add many members at once from a CSV file',
    icon: Upload,
    permission: 'users.create',
  },
  // members.manage, which reaching this hub already requires: the endpoint
  // writes qualifications onto existing members, it creates nobody.
  {
    id: 'qualifications',
    label: 'Import Qualifications',
    description: 'Licences and cards members already hold, from a CSV file',
    icon: BadgeCheck,
  },
  { id: 'settings', label: 'Settings', description: 'Roster settings and headline metrics', icon: Settings },
];

export type MembersAdminAreaId = 'roster' | 'add_import' | 'settings';

type MembersAdminDestination = (typeof MEMBERS_ADMIN_TABS)[number];

export interface MembersAdminArea {
  id: MembersAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** The area's pages, in strip order. */
  destinations: MembersAdminDestination[];
}

const tabById = (id: MembersAdminTab): MembersAdminDestination => {
  const tab = MEMBERS_ADMIN_TABS.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Unknown members admin tab: ${id}`);
  return tab;
};

/**
 * Every tab belongs to exactly one area — `membersAdminTabs.test.ts` holds
 * that — so a tab added above without a home here fails a test rather than
 * disappearing from the hub.
 */
export const MEMBERS_ADMIN_AREAS: MembersAdminArea[] = [
  {
    id: 'roster',
    label: 'Roster',
    description: 'Edit members, assign roles and reset passwords',
    icon: ClipboardList,
    destinations: [tabById('manage')],
  },
  {
    id: 'add_import',
    label: 'Add & Import',
    description: 'New members, and qualifications from a file',
    icon: UserPlus,
    destinations: [tabById('add'), tabById('import'), tabById('qualifications')],
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Roster settings and headline metrics',
    icon: Settings,
    destinations: [tabById('settings')],
  },
];

/**
 * The hub as this member sees it: pages behind a grant they do not hold are
 * left out, and an area left with no page goes with them. Add & Import keeps
 * Import Qualifications for everyone, since it writes onto existing members
 * and needs nothing beyond the hub's own `members.manage`.
 */
export const membersAdminAreasFor = (hasPermission: (permission: string) => boolean): MembersAdminArea[] =>
  MEMBERS_ADMIN_AREAS.map((area) => ({
    ...area,
    destinations: area.destinations.filter((tab) => !tab.permission || hasPermission(tab.permission)),
  })).filter((area) => area.destinations.length > 0);

const DEFAULT_TAB: MembersAdminTab = 'manage';

export interface MembersAdminLocation {
  area: MembersAdminArea;
  tab: MembersAdminTab;
}

/**
 * Resolve `?tab=` against the pages this member can open. A tab they cannot
 * open — a bookmarked `?tab=add` without `users.create` — falls back to Member
 * Management rather than selecting a page whose body may not render.
 */
export const resolveMembersAdminLocation = (
  tabParam: string | null,
  areas: MembersAdminArea[]
): MembersAdminLocation => {
  const holding = (tab: string | null) =>
    areas.find((area) => area.destinations.some((destination) => destination.id === tab));
  const area = holding(tabParam) ?? holding(DEFAULT_TAB) ?? areas[0];
  if (!area) throw new Error('Members admin hub has no areas');
  const tab = area.destinations.find((destination) => destination.id === tabParam)?.id ?? DEFAULT_TAB;
  return { area, tab };
};

/** Element ids shared by the nav's tabs and the panels the hub renders for them. */
export const MEMBERS_ADMIN_AREA_ID_PREFIX = 'members-admin-area';
export const membersAdminTabId = (tab: string) => `members-admin-tab-${tab}`;
export const membersAdminTabPanelId = (tab: string) => `members-admin-tabpanel-${tab}`;
