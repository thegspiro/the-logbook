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
import { BarChart3, Clock, SlidersHorizontal } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { EquipmentCheckTemplateList } from '../components/EquipmentCheckTemplateList';
import { Breadcrumbs } from '../../../components/ux';

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
    anyPermission: ['scheduling.manage', 'inventory.check_view', 'inventory.manage'],
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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* This page carries no back link of its own, and it is reached from two
          different hubs — Inventory Administration, and the Scheduling
          Administration card for the checklists a crew runs on shift. The trail
          is the only route back up either way. */}
      <Breadcrumbs />

      <header className="mb-6">
        <h1 className="text-theme-text-primary text-2xl font-bold">Equipment Checklists</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          The lists a crew walks over an apparatus. A shift template can name which of these its shifts carry; otherwise
          a shift uses the ones written for its vehicle.
        </p>
      </header>

      <nav aria-label="Related checklist screens" className="hscroll mb-6 flex gap-2">
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
      </nav>

      <EquipmentCheckTemplateList />
    </div>
  );
};

export default ChecklistsAdminPage;
