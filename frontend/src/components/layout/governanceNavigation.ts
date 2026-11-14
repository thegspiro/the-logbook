import { AlertTriangle, CalendarX, ClipboardList, Network, Scale, Vote } from 'lucide-react';
import type { SectionNavItem } from './sectionNavigation';
import type { AttendanceWaiverAttention } from '../../types/attendanceWaiver';
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
 *
 * Waiver Requests (business meetings) is offered with the minutes module, to
 * the members who decide meeting waiver requests, which the server answers
 * (`meetingWaivers`, from `useWaiverAttention`): most decide by holding a
 * chosen position or an office, not a permission the menu could check. Its
 * route has no permission gate; the count is the requests waiting on them now.
 */
export function governanceNavItems(
  isModuleOn: (module: string) => boolean,
  meetingWaivers?: AttendanceWaiverAttention | null
): SectionNavItem[] {
  return [
    { label: 'Org Chart', path: '/governance/org-chart', icon: Network },
    ...(isModuleOn('elections') ? [{ label: 'Elections', path: '/elections', icon: Vote }] : []),
    ...(isModuleOn('minutes')
      ? [
          { label: 'Minutes', path: '/minutes', icon: ClipboardList },
          { label: 'Action Items', path: '/action-items', icon: AlertTriangle },
          ...(meetingWaivers?.decides
            ? [
                {
                  label: 'Waiver Requests',
                  path: '/meetings/waiver-requests',
                  icon: CalendarX,
                  count: meetingWaivers.pending,
                  countLabel: 'waiting on you',
                },
              ]
            : []),
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
