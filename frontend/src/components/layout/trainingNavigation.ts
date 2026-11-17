import { BookOpen, BookOpenCheck, CalendarX, ClipboardCheck, ClipboardList, GraduationCap, Layers } from 'lucide-react';
import type { SectionNavItem } from './sectionNavigation';
import type { AttendanceWaiverAttention } from '../../types/attendanceWaiver';

/**
 * The Training destinations, in one list for the side navigation, the top
 * navigation and the section strip every Training page draws at its top.
 * See `SectionNavItem` for the rule every gate here must keep.
 *
 * No row carries a permission: every one of these routes is gated on the
 * training module alone, which the navigation applies to the group as a whole.
 * Training Administration is not a section — it is reached from the
 * Administration group, as every other admin hub is.
 *
 * Skills Testing is dropped for a department that records practical skills on
 * shift reports instead; see `offersSkillsTesting`.
 *
 * Waiver Requests is offered to the members who decide session waiver
 * requests, which the server answers (`waivers`, from `useWaiverAttention`):
 * most decide by holding a chosen position or an office, not a permission the
 * menu could check. Its route has no permission gate, so no member who sees it
 * is refused; the count is the requests waiting on them now.
 */
export function trainingNavItems(
  showsSkillsTesting: boolean,
  waivers?: AttendanceWaiverAttention | null
): SectionNavItem[] {
  return [
    { label: 'My Training', path: '/training/my-training', icon: GraduationCap, aliases: ['/training'] },
    { label: 'Submit Training', path: '/training/submit', icon: ClipboardList },
    { label: 'Course Library', path: '/training/courses', icon: BookOpen },
    { label: 'Programs', path: '/training/programs', icon: Layers },
    ...(showsSkillsTesting
      ? [{ label: 'Skills Testing', path: '/training/skills-testing', icon: ClipboardCheck }]
      : []),
    { label: 'Knowledge Tests', path: '/training/knowledge-tests', icon: BookOpenCheck },
    ...(waivers?.decides
      ? [
          {
            label: 'Waiver Requests',
            path: '/attendance-waivers',
            icon: CalendarX,
            count: waivers.pending,
            countLabel: 'waiting on you',
          },
        ]
      : []),
  ];
}
