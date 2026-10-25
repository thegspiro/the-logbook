/**
 * Equipment Checklists — admin index.
 *
 * The checklist list had no page of its own. It was reachable only embedded in
 * *Scheduling's* settings panel, which is where it stopped making sense once
 * checklists became an Inventory feature: an officer looking for them had to
 * go to the shift module to find them, and the Inventory admin hub's own
 * Checklists card pointed at the fleet board instead.
 *
 * This is that missing home. It hosts the list and points on to the two
 * surfaces built on it — reports and the supply worklist — so the whole
 * authoring side has one place to start from.
 */

import React from 'react';
import { Link } from 'react-router';
import { BarChart3, ClipboardList, Clock, Link2, SlidersHorizontal, Truck } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { EquipmentCheckTemplateList } from '../components/EquipmentCheckTemplateList';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';

interface RelatedLink {
  label: string;
  description: string;
  path: string;
  icon: React.ElementType;
  /**
   * The permissions that open the target route — any one of them suffices,
   * mirroring its `ProtectedRoute` gate.
   *
   * Required, not optional. Holding this page's own `inventory.check_manage`
   * does not imply any of these: authoring a checklist, reading its results
   * and managing stock are separate grants, and the seeded President position
   * holds the first without the second. While the field was optional, two of
   * the three cards below declared nothing and were shown to people the
   * destination then refused.
   */
  anyPermission: string[];
}

const RELATED: RelatedLink[] = [
  // The Inventory Administration card for this page promises "fleet readiness
  // and the check log", and this was the only screen on the authoring side
  // with no way to either — the officer who had just published a checklist
  // had to leave through the navigation to see whether crews were running it.
  {
    label: 'Fleet readiness',
    description: 'Each apparatus, its last check, and anything it is due or owes',
    path: '/inventory/checklists',
    icon: Truck,
    anyPermission: ['inventory.check_view', 'scheduling.manage'],
  },
  {
    label: 'Check log',
    description: 'Every expected check, including the ones that did not happen',
    path: '/inventory/checklists/log',
    icon: ClipboardList,
    anyPermission: ['inventory.check_submit', 'inventory.check_view', 'scheduling.manage'],
  },
  {
    label: 'Check reports',
    description: 'Compliance, failures and item trends across completed checks',
    path: '/inventory/admin/checklists/reports',
    icon: BarChart3,
    // Reading results is a separate grant from authoring a checklist, and this
    // page runs on the authoring one — the seeded President position holds
    // check_manage without check_view, so this card was a refusal for them.
    anyPermission: ['inventory.check_view'],
  },
  {
    label: 'Expiring on apparatus',
    description: 'What is running out on the trucks, and the stock behind it',
    path: '/inventory/admin/checklists/supply',
    icon: Clock,
    // Tracks the route, which tracks what the worklist's endpoint accepts.
    // `scheduling.manage` is not among them.
    anyPermission: ['inventory.check_view', 'inventory.manage'],
  },
  {
    label: 'Catalog links',
    description: 'Checklist lines not yet connected to inventory, matched once across every template',
    path: '/inventory/admin/checklists/catalog-links',
    icon: Link2,
    // The report and the link step both run on the authoring grant.
    anyPermission: ['inventory.check_manage'],
  },
  {
    label: 'Checklist settings',
    description: 'When crews are prompted, and how long they have to check in',
    path: '/inventory/admin/checklists/settings',
    icon: SlidersHorizontal,
    // Stored in org.settings, so writing them needs the department-settings
    // grant rather than the checklist one this page runs on. Hidden rather
    // than shown-and-refused: an officer who can build a checklist may well
    // not be able to change these.
    anyPermission: ['settings.manage', 'organization.update_settings'],
  },
];

export const ChecklistsAdminPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const related = RELATED.filter((link) => link.anyPermission.some((p) => checkPermission(p)));

  return (
    <div className="max-w-6xl py-6">
      {/* No back link or trail of its own: it is drawn inside Inventory
          Administration's header (InventoryAdminLayout), whose trail and area
          cards are the way back up. A viewer the header refuses still gets the
          trail, from the layout. */}
      <header className="mb-6">
        <h2 className="text-theme-text-primary text-2xl font-bold">Equipment Checklists</h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          The lists a crew walks over an apparatus. A shift template can name which of these its shifts carry; otherwise
          a shift uses the ones written for its vehicle.
        </p>
      </header>

      {/* Five links do not fit across a 320px phone. The row scrolls, the cue
          shows that it does, and the marker tells the mobile reflow pass the
          overflow is deliberate. The scrolling row is itself the navigation
          landmark: the reflow pass needs the label on the scroll region, and
          a separate <nav> around it carried the same name a second time. */}
      <div className="mb-6">
        <ScrollCueRow
          className="flex gap-2"
          data-mobile-scroll-region
          role="navigation"
          aria-label="Related checklist screens"
        >
          {related.map(({ label, description, path, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              title={description}
              className="btn-secondary btn-auto mobile-touch-target inline-flex shrink-0 items-center gap-2 px-3 text-sm font-medium"
            >
              <Icon className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </ScrollCueRow>
      </div>

      <EquipmentCheckTemplateList />
    </div>
  );
};

export default ChecklistsAdminPage;
