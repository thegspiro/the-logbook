/**
 * The scheduling administration hub's card registry.
 *
 * Every card is a navigation control, and a navigation control that offers a
 * page the viewer's permissions will not open is worse than no control: the
 * officer gets Access Denied from something the app itself put in front of
 * them. So each card carries the gate of the route it targets, and
 * `schedulingHubCards.test.ts` resolves that route's real gate out of the route
 * source and fails if the two ever drift.
 *
 * A gate here must be a SUBSET of the gate on the route it targets.
 * `checkPermission` is exact match plus module wildcard, so `scheduling.manage`
 * implies neither `inventory.check_manage` nor `settings.manage`. Two of these
 * cards point into Inventory, whose grants a scheduling officer does not hold
 * by virtue of running the schedule — they are gated on Inventory's own. Every
 * other card, and the hub's own route, is `scheduling.manage`.
 *
 * Narrower than the route is always safe — it hides a card. Wider is the bug.
 *
 * Shape deliberately mirrors `modules/inventory/pages/inventoryHubCards.ts`, so
 * the two hubs read alike and the same test helper checks both.
 */

import {
  BarChart3,
  Bell,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  LayoutTemplate,
  type LucideIcon,
  Repeat,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Users,
} from 'lucide-react';

/**
 * Section headings, in render order.
 *
 * Grouped by what the officer is doing rather than by which screen the setting
 * used to be a tab on — "Before the shift" is one job whether the thing being
 * edited is a pattern, a template or the crew size a shift defaults to.
 */
export const SCHEDULING_HUB_SECTIONS = [
  'Before the shift',
  'On the shift',
  'People & eligibility',
  'Reporting',
  'Department settings',
] as const;
export type SchedulingHubSection = (typeof SCHEDULING_HUB_SECTIONS)[number];

/** Icon tint. A union rather than a class string so Tailwind's scanner sees
 *  every literal in one place (`SchedulingAdminHub`'s TONE_CLASSES map). */
export type SchedulingHubTone = 'blue' | 'purple' | 'orange' | 'cyan' | 'green' | 'indigo' | 'amber' | 'sky' | 'slate';

export interface SchedulingHubCard {
  /** Stable id — React key, and how the hub attaches live counts. */
  id: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  section: SchedulingHubSection;
  tone: SchedulingHubTone;
  /** Required permission (exact match plus module wildcard). */
  permission?: string;
  /** Any one of these grants access (OR), mirroring the route's own. */
  anyPermission?: string[];
  /** Hidden unless the organization has this module enabled. */
  requiresModule?: string;
}

export const SCHEDULING_HUB_CARDS: SchedulingHubCard[] = [
  // ── Before the shift ───────────────────────────────────────────────────
  {
    id: 'templates',
    label: 'Shift Templates',
    description: 'The shapes a shift comes in — hours, crew seats and vehicle',
    path: '/scheduling/admin/templates',
    icon: ClipboardList,
    section: 'Before the shift',
    tone: 'blue',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'patterns',
    label: 'Shift Patterns',
    description: 'Repeating rotations, and generating a stretch of calendar from them',
    path: '/scheduling/admin/patterns',
    icon: Repeat,
    section: 'Before the shift',
    tone: 'purple',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },

  // ── On the shift ───────────────────────────────────────────────────────
  //
  // Both point into Inventory. Checklists are Inventory's, and so are the
  // settings that govern when a crew is prompted to run one — but the crew
  // being prompted is on a shift, so this is where a scheduling officer looks
  // for them. Gated on Inventory's own grants, which are not implied by
  // scheduling.manage.
  {
    id: 'equipment-checklists',
    label: 'Equipment Checklists',
    description: 'The start- and end-of-shift checklists crews run, managed in Inventory',
    path: '/inventory/admin/checklists',
    icon: ClipboardCheck,
    section: 'On the shift',
    tone: 'sky',
    permission: 'inventory.check_manage',
    requiresModule: 'inventory',
  },
  {
    id: 'checklist-settings',
    label: 'Checklist Timing',
    description: 'How early and how late a member may check in for a shift',
    path: '/inventory/admin/checklists/settings',
    icon: SlidersHorizontal,
    section: 'On the shift',
    tone: 'cyan',
    anyPermission: ['settings.manage', 'organization.update_settings'],
    requiresModule: 'inventory',
  },

  // ── People & eligibility ───────────────────────────────────────────────
  {
    id: 'positions',
    label: 'Who Can Fill What',
    description: 'Every member against the positions they are cleared for, and why',
    path: '/scheduling/admin/positions',
    icon: ShieldCheck,
    section: 'People & eligibility',
    tone: 'green',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'platoons',
    label: 'Platoons',
    description: 'Every platoon and its members, with bulk assignment',
    path: '/scheduling/admin/platoons',
    icon: Users,
    section: 'People & eligibility',
    tone: 'indigo',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'settings-eligibility',
    label: 'Eligibility Rules',
    description: 'Who may sign themselves up, and how late they may do it',
    path: '/scheduling/admin/settings/eligibility',
    icon: Shield,
    section: 'People & eligibility',
    tone: 'amber',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },

  // ── Reporting ──────────────────────────────────────────────────────────
  {
    id: 'reports',
    label: 'Scheduling Reports',
    description: 'Member hours, coverage, call volume and availability',
    path: '/scheduling/admin/reports',
    icon: BarChart3,
    section: 'Reporting',
    tone: 'orange',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'settings-shift-reports',
    label: 'Shift Report Options',
    description: 'What the end-of-shift report asks for, and who reviews it',
    path: '/scheduling/admin/settings/shift-reports',
    icon: FileBarChart,
    section: 'Reporting',
    tone: 'slate',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },

  // ── Department settings ────────────────────────────────────────────────
  {
    id: 'settings-general',
    label: 'General',
    description: 'Shift defaults, overtime advisory, and close-out rules',
    path: '/scheduling/admin/settings/general',
    icon: LayoutTemplate,
    section: 'Department settings',
    tone: 'blue',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'settings-apparatus',
    label: 'Apparatus Defaults',
    description: 'Default crew and minimum staffing per apparatus and resource type',
    path: '/scheduling/admin/settings/apparatus',
    icon: Truck,
    section: 'Department settings',
    tone: 'purple',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
  {
    id: 'settings-notifications',
    label: 'Notifications',
    description: 'Shift reminders, assignment alerts and drop notices',
    path: '/scheduling/admin/settings/notifications',
    icon: Bell,
    section: 'Department settings',
    tone: 'amber',
    permission: 'scheduling.manage',
    requiresModule: 'scheduling',
  },
];
