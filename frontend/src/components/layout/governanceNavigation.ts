import { AlertTriangle, ClipboardList, Network, Scale, Vote } from 'lucide-react';
import type { SectionNavItem } from './sectionNavigation';
import { LEGAL_DOCUMENTS_PERMISSIONS } from '../../modules/governance/routes';

/**
 * The Governance destinations, in one list for the side navigation, the top
 * navigation and the section strip every Governance page draws at its top.
 * See `SectionNavItem` for the rule every gate here must keep.
 *
 * Neither the org chart nor Legal Documents is behind a module flag: every
 * deployment publishes /privacy and /terms, and the org chart is the one
 * governance screen written for the general membership, so the group is
 * unconditional rather than following elections or minutes.
 */
export function governanceNavItems(isModuleOn: (module: string) => boolean): SectionNavItem[] {
  return [
    { label: 'Org Chart', path: '/governance/org-chart', icon: Network },
    ...(isModuleOn('elections') ? [{ label: 'Elections', path: '/elections', icon: Vote }] : []),
    ...(isModuleOn('minutes')
      ? [
          { label: 'Minutes', path: '/minutes', icon: ClipboardList },
          { label: 'Action Items', path: '/action-items', icon: AlertTriangle },
        ]
      : []),
    {
      label: 'Legal Documents',
      path: '/governance/legal',
      icon: Scale,
      anyPermission: [...LEGAL_DOCUMENTS_PERMISSIONS],
    },
  ];
}
