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
import { BarChart3, Clock } from 'lucide-react';
import { EquipmentCheckTemplateList } from '../components/EquipmentCheckTemplateList';

const RELATED: { label: string; description: string; path: string; icon: React.ElementType }[] = [
  {
    label: 'Check reports',
    description: 'Compliance, failures and item trends across completed checks',
    path: '/inventory/admin/checklists/reports',
    icon: BarChart3,
  },
  {
    label: 'Expiring on apparatus',
    description: 'What is running out on the trucks, and the stock behind it',
    path: '/inventory/admin/checklists/supply',
    icon: Clock,
  },
];

export const ChecklistsAdminPage: React.FC = () => (
  <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <header className="mb-6">
      <h1 className="text-theme-text-primary text-2xl font-bold">Equipment Checklists</h1>
      <p className="text-theme-text-secondary mt-1 text-sm">
        The lists a crew walks over an apparatus. A shift template can name which of these its shifts carry; otherwise a
        shift uses the ones written for its vehicle.
      </p>
    </header>

    <nav aria-label="Related checklist screens" className="hscroll mb-6 flex gap-2">
      {RELATED.map(({ label, description, path, icon: Icon }) => (
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

export default ChecklistsAdminPage;
