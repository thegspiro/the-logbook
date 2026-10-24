import type { SectionNavItem } from './sectionNavigation';
import { activeSection, visibleSectionNavItems } from './sectionNavigation';
import { Boxes, Building2, ClipboardCheck, Package, ShieldCheck, Stethoscope, Truck } from 'lucide-react';
import { APPARATUS_ENTRY_PERMISSIONS } from '../../modules/apparatus/routes';
import { FACILITY_ENTRY_PERMISSIONS } from '../../modules/facilities/routes';

/**
 * The Operations destinations, in one list for the side navigation, the top
 * navigation and the section strip every Operations page draws at its top.
 * See `SectionNavItem` for the rule every gate here must keep.
 */
export type OperationsNavItem = SectionNavItem;

/**
 * What opens the crew rows below to an administrative member.
 *
 * `inventory.check_submit` and `inventory.view` are on the default member
 * position, so no permission separates an administrative member from a rider
 * for these rows; a gate on them is a gate on nobody. An administrative member
 * therefore needs a grant a position has to be given on purpose, which is also
 * what an Apparatus Manager carries. Apparatus Inventory takes only the one
 * its route accepts: a row must never lead to the route's Access Denied.
 */
const MY_CHECKLISTS_ADMINISTRATIVE_GRANTS = ['inventory.check_view', 'inventory.check_manage', 'inventory.manage'];
const APPARATUS_INVENTORY_ADMINISTRATIVE_GRANTS = ['inventory.check_view'];

export function operationsNavItems(
  isModuleOn: (module: string) => boolean,
  isAdministrative = false
): OperationsNavItem[] {
  const inventory = isModuleOn('inventory');
  return [
    // My Issued Gear carries no gate: it is a member's own kit, plus the
    // request and return they raise against it. Inventory is the whole
    // department's catalogue and gates on `inventory.manage` — NOT on
    // `inventory.view`, which every seeded member holds and needs for the
    // request picker's item search.
    ...(inventory
      ? [
          { label: 'My Issued Gear', path: '/inventory/my-equipment', icon: Package },
          { label: 'Inventory', path: '/inventory', icon: Package, permission: 'inventory.manage' },
        ]
      : []),
    // Its own entry rather than a child of Inventory: the two are run by
    // different officers in departments that split the role.
    //
    // Deliberately NOT gated on the broad `inventory.view`, which both
    // rank-and-file seeded roles hold: this is the stock room, and the people
    // with a task on it are the ones who keep it stocked. A member restocking a
    // rig from what they used wants Apparatus Inventory below, not this.
    // `view_medical` alone, and not the manage grants beside it: the route
    // accepts only MEDICAL_VIEW_PERMISSIONS, and `checkPermission` gives no
    // manage-implies-view.
    ...(isModuleOn('medical_supplies')
      ? [
          {
            label: 'Medical Supplies',
            path: '/medical-supplies',
            icon: Stethoscope,
            permission: 'inventory.view_medical',
          },
        ]
      : []),
    ...(inventory
      ? [
          // No gate on purpose. Walking a truck is the one thing every member
          // does, the API narrows /my-checklists to the caller, and this row is
          // their only route to it.
          // For an administrative member the row is held back unless a grant
          // names them as someone who checks or manages the fleet; they do
          // not walk a truck, and the page would be empty for them.
          {
            label: 'My Checklists',
            path: '/inventory/checklists/my',
            icon: ClipboardCheck,
            ...(isAdministrative ? { anyPermission: MY_CHECKLISTS_ADMINISTRATIVE_GRANTS } : {}),
          },
          {
            label: 'Fleet Readiness',
            path: '/inventory/checklists',
            // Not ClipboardCheck, which "My Checklists" directly above already
            // uses: the collapsed rail shows icons only, and the two rows are
            // for different audiences — the checks you owe versus the state of
            // the fleet.
            icon: ShieldCheck,
            anyPermission: ['inventory.check_view', 'scheduling.manage'],
          },
          // The crew half of the medical shelf: "we just used two of these",
          // recorded without starting a whole checklist.
          {
            label: 'Apparatus Inventory',
            path: '/inventory/checklists/apparatus-inventory',
            // Not Truck, which Apparatus below uses: in the collapsed rail the
            // two would be indistinguishable, and this row is the stock on a
            // truck rather than the truck itself.
            icon: Boxes,
            anyPermission: isAdministrative
              ? APPARATUS_INVENTORY_ADMINISTRATIVE_GRANTS
              : ['inventory.check_submit', 'inventory.check_view', 'inventory.view'],
          },
        ]
      : []),
    // Only the module-on row is gated: its pages are the fleet maintenance
    // record and regular members no longer hold `apparatus.view`.
    // `/apparatus-basic` stays open to everyone — it is not the apparatus
    // module, it has no route gate, and it reads the auth-only scheduling
    // endpoints that departments without the module still need for staffing.
    isModuleOn('apparatus')
      ? { label: 'Apparatus', path: '/apparatus', icon: Truck, anyPermission: [...APPARATUS_ENTRY_PERMISSIONS] }
      : { label: 'Apparatus', path: '/apparatus-basic', icon: Truck },
    ...(isModuleOn('facilities')
      ? [
          {
            label: 'Facilities',
            path: '/facilities',
            icon: Building2,
            anyPermission: [...FACILITY_ENTRY_PERMISSIONS],
          },
        ]
      : []),
  ];
}

/** The rows a viewer's grants open. */
export const visibleOperationsNavItems = visibleSectionNavItems<OperationsNavItem>;

/** The section a URL belongs to; see `activeSection`. */
export const activeOperationsSection = activeSection<OperationsNavItem>;
