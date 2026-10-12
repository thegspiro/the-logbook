/**
 * Training Administration's navigation: seven areas, each a short list of
 * destinations, every destination with a one-line hint.
 *
 * The hub used to file its thirty-one destinations under six sections, three
 * of them behind a "More" menu, and the section names did not say what was in
 * them — "Setup" held requirements next to import history and the headline
 * metrics, and skill evaluations sat under Setup while skills testing had a
 * section of its own. The areas below group by the officer's task instead.
 *
 * URLs stay `?page=<area>&tab=<destination>`. Destination ids are unique across
 * the hub, which is what lets every older link keep resolving: `?page=setup`
 * and `?page=skills-testing` no longer name an area, and a bare `?tab=` never
 * did, so both are resolved by the destination alone. Links elsewhere in the
 * app (dashboard widgets, onboarding steps, the backend's attention queue)
 * still use the older section ids and must keep working unchanged.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Award,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileCheck2,
  FileSpreadsheet,
  FileStack,
  FileText,
  Gauge,
  GraduationCap,
  Grid3x3,
  History,
  Inbox,
  LayoutDashboard,
  Library,
  LineChart,
  ListChecks,
  PencilRuler,
  PenLine,
  Plug,
  Repeat,
  Route,
  SearchCheck,
  Shield,
  SlidersHorizontal,
  Target,
  Telescope,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AdminAttentionItem } from '../../types/adminHub';

export type TrainingAdminAreaId =
  'dashboard' | 'records' | 'curriculum' | 'evaluations' | 'enhancements' | 'compliance' | 'settings';

export interface TrainingAdminDestination {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export interface TrainingAdminArea {
  id: TrainingAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  destinations: TrainingAdminDestination[];
}

export const TRAINING_ADMIN_AREAS: TrainingAdminArea[] = [
  {
    // Id kept from the section this replaces, so `?page=dashboard` links resolve as-is.
    id: 'dashboard',
    label: 'Overview',
    description: 'Where the department stands today',
    icon: LayoutDashboard,
    destinations: [
      { id: 'overview', label: 'Dashboard', hint: 'Compliance, hours and what needs you', icon: Gauge },
      { id: 'compliance', label: 'Compliance Matrix', hint: 'Every member against every requirement', icon: Grid3x3 },
      { id: 'expiring-certs', label: 'Expiring Certs', hint: 'Certifications about to lapse', icon: CalendarClock },
      { id: 'waivers', label: 'Training Waivers', hint: 'Leave and exemptions from requirements', icon: FileCheck2 },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    description: 'Training that happened, and approving it',
    icon: ClipboardList,
    destinations: [
      { id: 'submissions', label: 'Submissions to Review', hint: 'Member-submitted training to approve', icon: Inbox },
      { id: 'sessions', label: 'Sessions', hint: 'Scheduled classes and their attendance', icon: CalendarDays },
      { id: 'cohorts', label: 'Course Cohorts', hint: 'Groups taking a course together', icon: Users },
      { id: 'shift-reports', label: 'Shift Reports', hint: 'Training logged on shift', icon: FileText },
      { id: 'member-status', label: 'Monthly Status', hint: 'Who has met this month’s hours', icon: BarChart3 },
    ],
  },
  {
    id: 'curriculum',
    label: 'Curriculum',
    description: 'What members must complete, and the courses that count',
    icon: BookOpen,
    destinations: [
      {
        id: 'requirements',
        label: 'Requirements',
        hint: 'Hours, certifications and courses members owe',
        icon: ListChecks,
      },
      { id: 'courses', label: 'Course Library', hint: 'Courses the department teaches or accepts', icon: Library },
      { id: 'pipelines', label: 'Programs', hint: 'Step-by-step paths toward a role', icon: Route },
    ],
  },
  {
    id: 'evaluations',
    label: 'Evaluations',
    description: 'Skill sign-offs and knowledge tests',
    icon: ClipboardCheck,
    destinations: [
      { id: 'skill-evaluations', label: 'Skill Evaluations', hint: 'Practical sign-off checklists', icon: Award },
      { id: 'knowledge-tests', label: 'Knowledge Tests', hint: 'Written tests and their questions', icon: Brain },
      { id: 'templates', label: 'Skills Test Templates', hint: 'Station sheets for skills testing', icon: FileStack },
      { id: 'tests', label: 'Skills Test Records', hint: 'Results of the tests conducted', icon: ClipboardCheck },
    ],
  },
  {
    // Id kept from the section this replaces, so `?page=enhancements` links resolve as-is.
    id: 'enhancements',
    label: 'Program Management',
    description: 'Recertification, instructors and how well training works',
    icon: TrendingUp,
    destinations: [
      {
        id: 'recertification',
        label: 'Recertification',
        hint: 'Renewal pathways for each certification',
        icon: Repeat,
      },
      { id: 'competency', label: 'Competency', hint: 'Skill proficiency over time', icon: Target },
      { id: 'instructors', label: 'Instructors', hint: 'Who may teach and evaluate what', icon: GraduationCap },
      { id: 'effectiveness', label: 'Effectiveness', hint: 'Course evaluations and outcomes', icon: LineChart },
      { id: 'multi-agency', label: 'Multi-Agency', hint: 'Joint training with partner agencies', icon: Building2 },
      { id: 'reports', label: 'Reports', hint: 'Training reports and analytics', icon: FileBarChart },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance Reporting',
    description: 'ISO, NFPA 1401 and the annual attestation',
    icon: Shield,
    destinations: [
      { id: 'annual-report', label: 'Annual Report', hint: 'Year-end compliance summary', icon: FileSpreadsheet },
      { id: 'iso-readiness', label: 'ISO Readiness', hint: 'Scoring against ISO training credit', icon: BadgeCheck },
      { id: 'record-completeness', label: 'Record Quality', hint: 'NFPA 1401 record completeness', icon: SearchCheck },
      { id: 'attestations', label: 'Attestations', hint: 'Formal officer sign-off', icon: PenLine },
      { id: 'forecast', label: 'Forecast', hint: 'Who is heading out of compliance', icon: Telescope },
    ],
  },
  {
    id: 'settings',
    label: 'Settings & Data',
    description: 'How training is recorded, imported and summarised',
    icon: SlidersHorizontal,
    destinations: [
      {
        id: 'manual-entry',
        label: 'Manual Entry Rules',
        hint: 'What members may record themselves',
        icon: PencilRuler,
      },
      { id: 'integrations', label: 'Integrations', hint: 'Connections to outside training systems', icon: Plug },
      { id: 'import', label: 'Import History', hint: 'Bulk imports of past training records', icon: History },
      { id: 'metrics', label: 'Headline Metrics', hint: 'The figures shown at the top of this page', icon: Activity },
    ],
  },
];

/** Element ids shared by the nav's tabs and the panels the page renders for them. */
export const areaTabId = (area: string) => `training-admin-area-tab-${area}`;
export const areaPanelId = (area: string) => `training-admin-area-panel-${area}`;
export const tabId = (area: string, tab: string) => `training-admin-tab-${area}-${tab}`;
export const tabPanelId = (area: string, tab: string) => `training-admin-tabpanel-${area}-${tab}`;

const DEFAULT_LOCATION = { area: 'dashboard', tab: 'overview' } as const;

/** Where the retired section ids land when the URL names no destination. */
const RETIRED_AREA_DEFAULTS: Record<string, TrainingAdminAreaId> = {
  setup: 'curriculum',
  'skills-testing': 'evaluations',
};

export interface TrainingAdminLocation {
  area: TrainingAdminAreaId;
  tab: string;
}

export const getTrainingAdminArea = (id: TrainingAdminAreaId): TrainingAdminArea => {
  const area = TRAINING_ADMIN_AREAS.find((candidate) => candidate.id === id);
  if (!area) throw new Error(`Unknown training admin area: ${id}`);
  return area;
};

const areaOfTab = (tab: string): TrainingAdminArea | undefined =>
  TRAINING_ADMIN_AREAS.find((area) => area.destinations.some((destination) => destination.id === tab));

const defaultTabOf = (area: TrainingAdminArea): string => area.destinations[0]?.id ?? DEFAULT_LOCATION.tab;

/**
 * Resolve the `page` / `tab` query parameters to an area and destination.
 *
 * A known destination wins over the page it is paired with: the destination
 * is unique, and the page may be a retired section id (`setup`) or absent
 * (the older flat `?tab=` links).
 */
export const resolveTrainingAdminLocation = (page: string | null, tab: string | null): TrainingAdminLocation => {
  const byPage = TRAINING_ADMIN_AREAS.find((area) => area.id === page);
  if (byPage && tab && byPage.destinations.some((destination) => destination.id === tab)) {
    return { area: byPage.id, tab };
  }

  const byTab = tab ? areaOfTab(tab) : undefined;
  if (byTab && tab) return { area: byTab.id, tab };

  const area =
    byPage ?? (page && RETIRED_AREA_DEFAULTS[page] ? getTrainingAdminArea(RETIRED_AREA_DEFAULTS[page]) : undefined);
  if (area) return { area: area.id, tab: defaultTabOf(area) };

  return { ...DEFAULT_LOCATION };
};

/**
 * Open attention counts per destination, read from the hub summary's queue.
 *
 * The backend already decides what needs attention and links each item to the
 * destination that resolves it; the badges re-use those links rather than
 * counting anything again, so a badge can never disagree with the queue above
 * it. An item whose link is not a destination of this hub is ignored.
 */
export const attentionCountsByTab = (items: AdminAttentionItem[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const queryIndex = item.href.indexOf('?');
    if (queryIndex === -1 || !item.href.startsWith('/training/admin')) continue;
    const params = new URLSearchParams(item.href.slice(queryIndex + 1));
    const { tab } = resolveTrainingAdminLocation(params.get('page'), params.get('tab'));
    if (!params.get('tab') || tab !== params.get('tab')) continue;
    counts[tab] = (counts[tab] ?? 0) + item.count;
  }
  return counts;
};
