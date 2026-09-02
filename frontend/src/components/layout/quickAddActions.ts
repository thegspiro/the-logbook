/**
 * The Quick Add registry — what a member can start from the phone bottom bar.
 *
 * Every entry targets a screen that already exists and is already phone-shaped.
 * Quick Add is a shortcut to those screens, not a second way to enter the same
 * data: nothing here opens a form Quick Add owns, so there is no shape for the
 * two paths to drift apart into.
 *
 * The gate shape (`permission` / `anyPermission` / `requiresModule`) matches
 * CommandPalette's deliberately. Quick Add is the fourth navigation surface in
 * the app, and the first three shipped the same gate mistake at once — see the
 * docstring on `navGateIntegrity.test.ts`, which now covers this file too.
 *
 * A gate here must be a SUBSET of the gate on the route it targets.
 * `checkPermission` is exact match plus module wildcard, so `inventory.manage`
 * does not imply `inventory.view`: a superset gate is a row that promises a
 * page the router then refuses, and Access Denied reached from a control the
 * app itself put in front of the member is worse than no control.
 */

import {
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Clock,
  GraduationCap,
  type LucideIcon,
  PackagePlus,
  QrCode,
  ScanLine,
  Truck,
  UserPlus,
} from 'lucide-react';

export interface QuickAddAction {
  /** Stable id, used by tests and as the React key. */
  id: string;
  /** The verb the member is looking for, not the name of the screen. */
  label: string;
  /** One line saying what happens next, so a wrong tap is avoidable. */
  description: string;
  path: string;
  icon: LucideIcon;
  /** Grouping header in the sheet. */
  section: 'Log something' | 'Check in' | 'Department';
  /** Required permission (exact match plus module wildcard). */
  permission?: string;
  /** Any one of these grants access (OR logic), mirroring the route's own. */
  anyPermission?: string[];
  /** Hidden unless the organization has this module enabled. */
  requiresModule?: string;
}

/**
 * Ordered by how often a member reaches for it in the field, not by module.
 * The sheet renders them in this order within each section.
 */
export const QUICK_ADD_ACTIONS: QuickAddAction[] = [
  // -- Log something ------------------------------------------------------
  {
    id: 'log-training',
    label: 'Log training hours',
    description: 'Self-report a drill or course you completed',
    path: '/training/submit',
    icon: GraduationCap,
    section: 'Log something',
    requiresModule: 'training',
  },
  {
    id: 'start-rig-check',
    label: 'Start a rig check',
    description: 'Open your apparatus and equipment checklists',
    path: '/inventory/checklists/my',
    icon: Truck,
    section: 'Log something',
    requiresModule: 'inventory',
  },
  {
    id: 'add-action-item',
    label: 'Add an action item',
    description: 'Note a follow-up so it is not lost',
    path: '/action-items',
    icon: ClipboardList,
    section: 'Log something',
  },
  {
    id: 'log-shift-report',
    label: 'Log a shift report',
    description: 'Record a trainee shift on their behalf',
    path: '/training/log-shift',
    icon: ClipboardCheck,
    section: 'Log something',
    requiresModule: 'training',
    permission: 'training.manage',
  },

  // -- Check in -----------------------------------------------------------
  {
    id: 'clock-in',
    label: 'Clock in',
    description: 'Start or stop the clock on administrative hours',
    path: '/admin-hours',
    icon: Clock,
    section: 'Check in',
  },
  {
    id: 'shift-check-in',
    label: 'Check into a shift',
    description: 'Sign on or off the shift you are covering',
    path: '/scheduling/checkin',
    icon: QrCode,
    section: 'Check in',
    requiresModule: 'scheduling',
  },
  {
    id: 'scan-member',
    label: 'Scan a member ID',
    description: 'Look someone up from their card or badge',
    path: '/members/scan',
    icon: ScanLine,
    section: 'Check in',
    anyPermission: ['users.view', 'members.manage'],
  },

  // -- Department ---------------------------------------------------------
  {
    id: 'request-equipment',
    label: 'Request equipment',
    description: 'Ask for gear the department holds',
    path: '/inventory/admin/requests',
    icon: PackagePlus,
    section: 'Department',
    requiresModule: 'inventory',
    permission: 'inventory.manage',
  },
  {
    id: 'create-event',
    label: 'Create an event',
    description: 'Schedule a drill, meeting or detail',
    // The hub path, not the /events/new redirect that lands on it: the
    // destination and the gate this row advertises should be the same fact.
    path: '/events/admin?tab=create',
    icon: CalendarPlus,
    section: 'Department',
    permission: 'events.manage',
  },
  {
    id: 'add-member',
    label: 'Add a member',
    description: 'Create a record for a new member',
    path: '/members/admin?tab=add',
    icon: UserPlus,
    section: 'Department',
    permission: 'members.manage',
  },
];

/** The sections, in render order. */
export const QUICK_ADD_SECTIONS: QuickAddAction['section'][] = ['Log something', 'Check in', 'Department'];

/**
 * The actions this viewer may actually open.
 *
 * `isModuleOn` is permissive while the organization's module config is
 * unconfigured or still loading, matching every other navigation surface — the
 * bar renders immediately and fills in rather than flashing rows away.
 */
export function availableQuickAddActions(
  isModuleOn: (key: string) => boolean,
  checkPermission: (permission: string) => boolean
): QuickAddAction[] {
  return QUICK_ADD_ACTIONS.filter((action) => {
    if (action.requiresModule && !isModuleOn(action.requiresModule)) return false;
    if (action.permission && !checkPermission(action.permission)) return false;
    if (action.anyPermission && !action.anyPermission.some((permission) => checkPermission(permission))) return false;
    return true;
  });
}
