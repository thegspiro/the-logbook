import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import DashboardStatCard from '../components/dashboard/DashboardStatCard';
import DashboardNeedsYou from '../components/dashboard/DashboardNeedsYou';
import DashboardOrientation from '../components/dashboard/DashboardOrientation';
import type { NeedsYouItem } from '../components/dashboard/DashboardNeedsYou';
import DashboardHoursCard from '../components/dashboard/DashboardHoursCard';
import type { HoursSegment } from '../components/dashboard/DashboardHoursCard';
import DashboardReadiness from '../components/dashboard/DashboardReadiness';
import SchedulingWidgets from '../components/dashboard/SchedulingWidgets';
import DashboardOrganizationWidgets from '../components/dashboard/DashboardOrganizationWidgets';
import { AssetWidgetRegistry } from '../components/dashboard/AssetWidgetRegistry';
import type { AssetWidgetData } from '../components/dashboard/AssetWidgetRegistry';
import ChiefOperationsDashboard from '../components/dashboard/ChiefOperationsDashboard';
import { canViewChiefDashboard } from '../components/dashboard/chiefWidgetRegistry';
import OrganizationSetupWidget from '../components/dashboard/OrganizationSetupWidget';
import { READINESS_WINDOW_DAYS, currentCredentials } from '../utils/readiness';
import type { ReadinessCert } from '../utils/readiness';
import { LinkifiedText } from '../components/ux';
import {
  Calendar,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  AlertTriangle,
  CheckCircle2,
  Megaphone,
  Pin,
  Plus,
  Share,
  Shield,
  Smartphone,
  Users,
  UserPlus,
  Loader2,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  trainingProgramService,
  trainingModuleConfigService,
  notificationsService,
  messagesService,
  organizationService,
  inventoryService,
  eventService,
  medicalScreeningService,
} from '../services/api';
import type { AdminSummary, OperationsDashboard, InboxMessage, MyComplianceSummary } from '../services/api';
import { schedulingService } from '../modules/scheduling/services/api';
import { memberSignupClosedReason } from '../modules/scheduling/utils/shiftBoard';
import { useSignupWindow } from '../modules/scheduling/hooks/useSignupWindow';
import { adminHoursEntryService } from '../modules/admin-hours/services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { getProgressBarColor, getEventTypeLabel, getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { requirementTarget } from '../utils/pipelineProgress';
import { formatHours } from '../utils/hoursFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useEnabledModules } from '../hooks/useEnabledModules';
import {
  addCalendarDays,
  formatCalendarDate,
  formatDate,
  formatDateCustom,
  formatTime,
  formatTimeOfDay,
  getTodayLocalDate,
  toLocalISODate,
} from '../utils/dateFormatting';
import { useAuthStore } from '../stores/authStore';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { ProgramEnrollment, MemberProgramProgress } from '../types/training';
import type { NotificationLogRecord } from '../services/api';
import type { ShiftRecord } from '../modules/scheduling/services/api';
import type { EventListItem } from '../types/event';
import { dashboardService } from '../services/api';
import { positionLabel } from '../modules/scheduling/utils/positionLabels';
import { useNotificationCountStore } from '../hooks/useNotificationCount';

/**
 * Main Dashboard Component — "station board"
 *
 * Two answers, in this order: what needs me, and what am I doing next.
 * Everything the member is on the hook for collects in one "Needs you" panel;
 * shifts, open slots and events merge into one thirty-day list rather than
 * three parallel ones. Organization-wide reporting lives behind the
 * Organization tab so
 * it does not outrank a member's own work.
 */
const INSTALL_BANNER_DISMISSED_KEY = 'installBannerDismissed';

/** Days the "Next 30 Days" list covers, counting today as day one. */
const TIMELINE_DAYS = 30;

/**
 * How far past the visible window the open-shift fetch reaches.
 *
 * The footer discloses how many open shifts lie beyond the window, and it can
 * only count what it was given: with the fetch window equal to the display
 * window that line is dead on every department, silently, because zero is
 * also what an empty schedule looks like. Reaching further is what leaves it
 * able to say there is more.
 *
 * Two consequences, both load-bearing. The count stops here, so the footer
 * names this horizon ("in the following month") rather than implying it
 * covers everything after the window — it does not. And the reach belongs to
 * that footer alone: every other count describing what is open reads
 * `openShiftsInWindow`, or it would quote the member a number matching
 * nothing the card shows.
 */
const TIMELINE_LOOKAHEAD_DAYS = 60;

/**
 * Ceilings for the two fetches that feed the list.
 *
 * Both sit far above what a month of either can hold. They are here to bound
 * a runaway response, not to trim the list — trimming is the window filter's
 * job, and a limit low enough to do that as well truncates the wrong end,
 * which is the bug this pair replaced: `limit: 5` applied before the filter.
 *
 * `/events` refuses anything above 500, so the event ceiling is that cap. The
 * pagination dependency behind `/scheduling/my-shifts` allows up to 1000, but
 * one member's own shifts inside a month cannot approach even 200 — asking
 * for the maximum would only make a runaway response larger.
 */
const EVENT_FETCH_LIMIT = 500;
const SHIFT_FETCH_LIMIT = 200;

/** Rows the list renders before deferring to the full schedule. */
const TIMELINE_ROWS_SHOWN = 6;

/**
 * Rows the list shows on a phone before collapsing the rest onto one
 * tap-through line. Six rows of shift detail push the three quick actions —
 * which sit below the list on a phone, in the thumb's reach — off the first
 * screen; two keep them on it, and the line names what is being held back.
 */
const TIMELINE_ROWS_SHOWN_MOBILE = 2;

/** Rows the department feed renders before deferring to the notification inbox. */
const FEED_ROWS_SHOWN = 5;

/** Programs the rail shows before deferring to My Training. */
const PROGRAMS_SHOWN = 2;

type TimelineKind = 'my-shift' | 'open-shift' | 'event';

interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  /** Calendar date "YYYY-MM-DD" the row is filed under. */
  dateOnly: string;
  /** Sort key only — never rendered, so local parsing is safe here. */
  sortAt: number;
  title: string;
  detail: string;
  shift?: ShiftRecord;
  event?: EventListItem;
}

interface FeedEntry {
  key: string;
  title: string;
  body: React.ReactNode;
  meta: string;
  sortAt: number;
  unread: boolean;
  onClick: () => void;
  message?: InboxMessage;
}

interface SectionErrorProps {
  message: string;
  /**
   * What this control retries, e.g. "schedule". Becomes "Retry schedule" as
   * the button's accessible name.
   *
   * When several sources fail at once the dashboard shows several of these,
   * and a screen reader walking the button list hears "Retry" every time --
   * the adjacent message is not part of the button's name, so there is
   * nothing to tell them apart by.
   */
  source: string;
  /**
   * True while the loaders behind this control are already running.
   *
   * Owned by the page, not by this component: a single failure can render two
   * of these -- a training-summary failure puts a control on both the hours
   * card and the readiness card, and both call loadHours. A guard held per
   * rendered control leaves those two able to start concurrent loads, which is
   * the race the guard exists to stop. The page keys it by loader instead.
   */
  busy: boolean;
  onRetry: () => void;
}

const SectionError: React.FC<SectionErrorProps> = ({ message, source, busy, onRetry }) => {
  return (
    <div role="alert" className="flex items-center gap-3 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {/* mobile-touch-target, not a hand-set height: at min-h-9 this rendered
          57x36 and broke /dashboard's zero-budget tap-target check, which is
          the one place a section error is guaranteed to appear. */}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        aria-label={`Retry ${source}`}
        className="btn-secondary mobile-touch-target shrink-0 px-3 py-1 text-xs font-semibold disabled:opacity-60"
      >
        {busy ? 'Retrying' : 'Retry'}
      </button>
    </div>
  );
};

const TIMELINE_ACCENT: Record<TimelineKind, string> = {
  'my-shift': 'bg-theme-accent-blue',
  'open-shift': 'bg-theme-accent-green',
  event: 'bg-theme-accent-purple',
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const signupWindow = useSignupWindow();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser, checkPermission } = useAuthStore();
  const [departmentName, setDepartmentName] = useState('Fire Department');
  const { canInstall, needsManualInstall, install } = usePWAInstall();
  // Persisted so the banner doesn't reappear on every dashboard visit — it is
  // purely informational, and on iOS there is no "installed" event to hide it.
  const [dismissedInstall, setDismissedInstall] = useState(
    () => localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY) === '1'
  );
  const dismissInstallBanner = () => {
    localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, '1');
    setDismissedInstall(true);
  };

  // The legacy summary retains its settings gate, while chief operations is
  // available through the data-source permissions declared in its registry.
  // Everyone — including those leaders — still lands on the personal view.
  //
  // Every gate here is a *manage* grant on purpose. `inventory.view`,
  // `apparatus.view`, `facilities.view` and `scheduling.view` are all baseline
  // member grants (see DEFAULT_POSITIONS["member"]), so gating on them showed
  // the My Department tab — department-wide staffing, fleet and facility
  // reporting — to every firefighter in the department. These mirror the
  // permissions the backend actually enforces on the widget endpoints, so the
  // tab never advertises a panel that would come back empty or 403.
  const canViewLegacyAdmin = checkPermission('settings.manage');
  const canViewAssets =
    canViewLegacyAdmin || ['inventory.manage', 'apparatus.manage', 'facilities.manage'].some(checkPermission);
  const canViewChiefOperations = canViewChiefDashboard(checkPermission);
  const canViewOrganization = canViewLegacyAdmin || canViewChiefOperations || canViewAssets;
  // Clearing a department-wide persistent message is a notifications action;
  // holding a fleet or facility grant is not authority to retract one.
  const canManageMessages = canViewLegacyAdmin || checkPermission('notifications.manage');
  const canManageAdminHours = checkPermission('admin_hours.manage');
  const canViewScheduling = checkPermission('scheduling.manage');
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(canViewLegacyAdmin);
  const [adminError, setAdminError] = useState(false);
  const [operations, setOperations] = useState<OperationsDashboard | null>(null);
  const [assetWidgets, setAssetWidgets] = useState<AssetWidgetData[]>([]);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationLogRecord[]>([]);
  const unreadCount = useNotificationCountStore((s) => s.unreadCount);
  const decrementUnread = useNotificationCountStore((s) => s.decrement);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [notificationsError, setNotificationsError] = useState(false);

  // Shifts (user's own upcoming shifts)
  const [myShifts, setMyShifts] = useState<ShiftRecord[]>([]);
  const [loadingMyShifts, setLoadingMyShifts] = useState(true);
  const [myShiftsError, setMyShiftsError] = useState(false);

  // Open shifts (available to sign up for)
  const [openShifts, setOpenShifts] = useState<ShiftRecord[]>([]);
  const [loadingOpenShifts, setLoadingOpenShifts] = useState(true);
  const [openShiftsError, setOpenShiftsError] = useState(false);
  const [signingUpShiftId, setSigningUpShiftId] = useState<string | null>(null);
  const [rsvpingEventId, setRsvpingEventId] = useState<string | null>(null);
  const [signupExpandedId, setSignupExpandedId] = useState<string | null>(null);
  const [dashboardSignupPosition, setDashboardSignupPosition] = useState('firefighter');
  const [dashboardEligiblePositions, setDashboardEligiblePositions] = useState<string[]>([]);
  const [loadingEligibility, setLoadingEligibility] = useState(false);

  // Hours
  const [hours, setHours] = useState<{
    training: number | null;
    standby: number | null;
    administrative: number | null;
  }>({
    training: null,
    standby: null,
    administrative: null,
  });
  const [loadingHours, setLoadingHours] = useState(true);
  const [hoursError, setHoursError] = useState(false);
  const [certificationsError, setCertificationsError] = useState(false);
  const [seatsError, setSeatsError] = useState(false);
  const [screeningsError, setScreeningsError] = useState(false);

  // Certifications for the current user. One source for both the readiness
  // verdict and the "Needs you" rows, so the summary and the detail below it
  // cannot disagree about what is expiring.
  const [myCerts, setMyCerts] = useState<ReadinessCert[]>([]);

  // Shift positions this member may hold, resolved by the backend from rank,
  // completed training and membership type. Distinct from the per-shift
  // eligibility fetched when a signup row is expanded.
  const [mySeats, setMySeats] = useState<string[]>([]);

  // The member's own screening compliance, as counts. Left null when the read
  // fails so the verdict states a narrower scope rather than implying
  // screenings were checked and passed.
  const [myScreenings, setMyScreenings] = useState<MyComplianceSummary | null>(null);

  // Department Messages
  const [deptMessages, setDeptMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  // Two independent requests sit behind the Updates card, so they get two
  // flags: retrying the pair when only the badge count failed re-runs a
  // healthy inbox request that can now stall or fail, turning one recoverable
  // failure into two.
  const [inboxError, setInboxError] = useState(false);
  const [unreadCountError, setUnreadCountError] = useState(false);
  const messagesError = inboxError || unreadCountError;
  const [deptMsgUnread, setDeptMsgUnread] = useState(0);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  // Training
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);
  const [trainingError, setTrainingError] = useState(false);

  // Inventory
  const [myEquipment, setMyEquipment] = useState({ assigned: 0, checkedOut: 0, overdue: 0 });
  const [loadingMyEquipment, setLoadingMyEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState(false);

  // Upcoming events
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [loadingUpcomingEvents, setLoadingUpcomingEvents] = useState(true);
  const [upcomingEventsError, setUpcomingEventsError] = useState(false);

  // Phones show the first two rows of the week and name the rest on one line.
  const [timelineExpandedOnMobile, setTimelineExpandedOnMobile] = useState(false);
  const firstCollapsedTimelineRowRef = useRef<HTMLLIElement>(null);
  const revealTimelineOnMobile = () => {
    setTimelineExpandedOnMobile(true);
    // After the commit that mounts the revealed rows, so there is something to
    // focus. Mirrors how the view tabs above move focus.
    window.requestAnimationFrame(() => firstCollapsedTimelineRowRef.current?.focus());
  };

  // Setup checklist (admin-only)
  const [setupProgress, setSetupProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  // Department-wide reporting is a separate view rather than a taller page, and
  // the selection is mirrored into ?tab= so a chief can bookmark it.
  // Continue accepting the former `organization` and `overview` URLs so existing
  // bookmarks land on the renamed view, while all new navigation writes the
  // clearer URL.
  const departmentTabRequested = ['department', 'organization', 'overview'].includes(searchParams.get('tab') ?? '');
  const activeTab = canViewOrganization && departmentTabRequested ? 'department' : 'personal';
  const selectTab = (tab: 'personal' | 'department') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'department') next.set('tab', 'department');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextTab: 'personal' | 'department' | null = null;
    if (event.key === 'Home') nextTab = 'personal';
    else if (event.key === 'End') nextTab = 'department';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextTab = activeTab === 'personal' ? 'department' : 'personal';
    }

    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`dashboard-tab-${nextTab}`)?.focus());
  };

  useEffect(() => {
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    } else {
      dashboardService
        .getBranding()
        .then((data) => {
          if (data?.name) {
            setDepartmentName(data.name);
            sessionStorage.setItem('departmentName', data.name);
          }
        })
        .catch(() => {
          /* keep default */
        });
    }

    // Registered under the same keys the retries use. The pull-to-refresh
    // gesture is live from mount and a member can sign up from a cached row,
    // so an unregistered first load is a read the guard cannot see: a gesture
    // starts a second request for the same source instead of joining this one,
    // and runFresh races this read instead of queueing behind it -- letting a
    // response that predates the signup land last and put the taken shift back.
    //
    // Messages load as one call but are keyed per subrequest, so the single
    // initial promise is registered under both keys. Splitting it into two
    // 'inbox'/'unread' calls would make each one a *retry*, which skips the
    // loading flag the Updates card is waiting on.
    const initialMessages = loadDeptMessages();
    void runRetry('messages:inbox', () => initialMessages);
    void runRetry('messages:unread', () => initialMessages);
    void runRetry('events', () => loadUpcomingEvents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Module-owned loaders, held until the module config lands.
  //
  // Each of these calls a router the module gate now refuses outright, so
  // firing them before the answer is known costs a 403 per disabled module on
  // every dashboard visit — and `classifyApiError` reports a 403 as
  // API_FORBIDDEN, so a department's deliberate configuration would read as a
  // fault in the error log, on the app's most-visited screen. Medical
  // Screening makes it concrete: it is opt-in, so every organization that has
  // not turned it on is in this case.
  //
  // The wait is what makes the guards inside the loaders meaningful.
  // `isModuleOn` answers permissively while the config is unknown — right for
  // a nav bar, which must render before the answer arrives, and wrong here,
  // where it would wave through the very request this exists to avoid. The
  // hook settles either way, so the cost is one tick.
  //
  // Each loader clears its own panel's loading flag on the way out, so a
  // disabled module shows that panel's empty state rather than a skeleton
  // that never resolves.
  useEffect(() => {
    if (modulesLoading) return;
    // Keyed for the same reason the first-load effect above is.
    void runRetry('notifications', () => loadNotifications());
    void runRetry('myShifts', () => loadMyShifts());
    void runRetry('openShifts', () => loadOpenShifts());
    void runRetry('seats', () => loadMySeats());
    void runRetry('screenings', () => loadMyScreenings());
    void runRetry('training', () => loadTrainingProgress());
    void runRetry('equipment', () => loadMyEquipment());
    void runRetry('hours', () => loadHours());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesLoading]);

  // Do not fetch department-wide reporting merely because a leader opened the
  // dashboard. The personal view is the default; department-wide data is loaded
  // only after that leader intentionally opens the My Department tab.
  useEffect(() => {
    if (activeTab === 'department') {
      if (canViewChiefOperations) void loadOperations();
      if (canViewAssets) void loadAssetWidgets();
      if (canViewLegacyAdmin) {
        void loadAdminSummary();
        void loadSetupProgress();
      }
    }
  }, [activeTab, canViewAssets, canViewChiefOperations, canViewLegacyAdmin]);

  const loadAdminSummary = async () => {
    setLoadingAdmin(true);
    setAdminError(false);
    try {
      const data = await dashboardService.getAdminSummary();
      setAdminSummary(data);
    } catch (err) {
      console.error('Failed to load admin summary:', err);
      setAdminError(true);
    } finally {
      setLoadingAdmin(false);
    }
  };

  const loadOperations = async () => {
    try {
      setOperations(await dashboardService.getOperations());
    } catch {
      setOperations(null);
    }
  };

  const loadAssetWidgets = async () => {
    try {
      setAssetWidgets(await dashboardService.getAssetWidgets());
    } catch {
      setAssetWidgets([]);
    }
  };

  const loadMyEquipment = async (isRetry = false) => {
    if (!isRetry) setLoadingMyEquipment(true);
    if (!isRetry) setEquipmentError(false);
    if (!isModuleOn('inventory')) {
      setLoadingMyEquipment(false);
      return;
    }
    if (!currentUser?.id) {
      setLoadingMyEquipment(false);
      return;
    }
    try {
      const data = await inventoryService.getUserInventory(currentUser.id);
      setMyEquipment({
        assigned:
          // Each permanent assignment is one physical unit — count rows, not
          // the response's quantity field, which historically carried the
          // catalog's on-hand stock and inflated this figure.
          data.permanent_assignments.length +
          data.issued_items.reduce((total, item) => total + item.quantity_issued, 0),
        checkedOut: data.active_checkouts.length,
        overdue: data.active_checkouts.filter((item) => item.is_overdue).length,
      });
      setEquipmentError(false);
    } catch {
      setEquipmentError(true);
    } finally {
      setLoadingMyEquipment(false);
    }
  };

  const loadSetupProgress = async () => {
    try {
      const data = await organizationService.getSetupChecklist();
      setSetupProgress({
        completed: data.completed_count,
        total: data.total_count,
      });
    } catch {
      // Non-critical
    }
  };

  const loadUpcomingEvents = async (isRetry = false) => {
    if (!isRetry) setLoadingUpcomingEvents(true);
    if (!isRetry) setUpcomingEventsError(false);
    try {
      // Bounded to the window the list renders, and to a limit that can hold
      // it. The old shape asked for the 5 soonest events of any future date
      // and truncated *before* the window filter ran, so five socials spread
      // across the next six months were enough to hide every drill in the
      // coming month behind them — on a card whose subtitle promises drills.
      //
      // The bound is a plain instant a day past the window rather than the
      // window's own last day resolved in the organization's timezone. That
      // is deliberate on both counts: it over-fetches by a day so no calendar
      // day near the edge can fall outside it whatever the offset, and it
      // keeps this loader free of reactive values, which is what lets the
      // mount effect below run once rather than on every timezone-carrying
      // render. The window filter, which does resolve the timezone, remains
      // the authority on what is actually shown.
      const data = await eventService.getEvents({
        end_after: new Date().toISOString(),
        start_before: new Date(Date.now() + (TIMELINE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
        limit: EVENT_FETCH_LIMIT,
      });
      const sorted = [...data].sort(
        (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
      );
      setUpcomingEvents(sorted);
      setUpcomingEventsError(false);
    } catch {
      setUpcomingEventsError(true);
    } finally {
      setLoadingUpcomingEvents(false);
    }
  };

  const loadNotifications = async (isRetry = false) => {
    // The Updates card's loading branch covers messages too, so raising this
    // on a retry replaces successfully loaded inbox rows with skeletons.
    if (!isRetry) setLoadingNotifications(true);
    if (!isRetry) setNotificationsError(false);
    if (!isModuleOn('notifications')) {
      setNotifications([]);
      setLoadingNotifications(false);
      return;
    }
    try {
      // The unread count is maintained by useNotificationPoller (mounted
      // in AppLayout), so we only need to fetch the notification list here.
      const data = await notificationsService.getMyNotifications({
        include_read: false,
        limit: 10,
      });
      setNotifications(data.logs || []);
      setNotificationsError(false);
    } catch {
      setNotificationsError(true);
    } finally {
      if (!isRetry) setLoadingNotifications(false);
    }
  };

  // Message rows the member has acted on, re-applied to every inbox response.
  //
  // markMessageRead and acknowledgeMessage deliberately leave the row on
  // screen -- see markMessageRead for why -- so a post-mutation refetch is not
  // available as the fix here the way it is for the shift, event, notification
  // and persistent-message paths: getInbox asks for include_read: false, so a
  // fresh read would drop the very row the design keeps. Without this overlay
  // an inbox read that started before the mutation restores the unread or
  // unacknowledged row when it lands, and for an acknowledgement that means
  // asking the member to acknowledge again something the server has recorded.
  //
  // Refs rather than state: this is applied at the point a response is stored,
  // and must not itself trigger a render.
  const locallyReadMessages = useRef(new Set<string>());
  const locallyAcknowledgedMessages = useRef(new Set<string>());

  const applyLocalMessageState = (list: InboxMessage[]): InboxMessage[] =>
    list.map((m) => {
      if (locallyAcknowledgedMessages.current.has(m.id)) return { ...m, is_read: true, is_acknowledged: true };
      if (locallyReadMessages.current.has(m.id)) return { ...m, is_read: true };
      return m;
    });

  // `only` retries a single subrequest. A retry also skips the loading flag,
  // for the reason given on loadMyShifts.
  const loadDeptMessages = async (only?: 'inbox' | 'unread' | 'both') => {
    // 'both' is a retry of both subrequests, distinct from undefined, which is
    // the initial load. Without that distinction retrying both raises
    // loadingMessages, and the Updates card's loading branch covers the
    // notification rows too -- so a card whose notifications loaded fine goes
    // to skeletons, indefinitely if either retry hangs.
    const isRetry = only !== undefined;
    if (!isRetry) setLoadingMessages(true);
    const wantInbox = only !== 'unread';
    const wantUnread = only !== 'inbox';
    // Not cleared eagerly on a retry: both flags are assigned from the settled
    // results below, so waiting costs nothing and keeps the banner up while the
    // request is still in flight.
    if (!isRetry && wantInbox) setInboxError(false);
    if (!isRetry && wantUnread) setUnreadCountError(false);
    // These endpoints are independent: a badge-count failure must not throw
    // away messages the member can still read (and vice versa).
    const [inboxResult, unreadResult] = await Promise.allSettled([
      wantInbox ? messagesService.getInbox({ include_read: false, limit: 10 }) : Promise.resolve(null),
      wantUnread ? messagesService.getUnreadCount() : Promise.resolve(null),
    ]);
    if (wantInbox) {
      if (inboxResult.status === 'fulfilled' && inboxResult.value)
        setDeptMessages(applyLocalMessageState(inboxResult.value));
      setInboxError(inboxResult.status === 'rejected');
    }
    if (wantUnread) {
      if (unreadResult.status === 'fulfilled' && unreadResult.value) setDeptMsgUnread(unreadResult.value.unread_count);
      setUnreadCountError(unreadResult.status === 'rejected');
    }
    if (!isRetry) setLoadingMessages(false);
  };

  // The retry the Updates card offers: whichever half actually failed.
  // Keyed per subrequest for the same reason the refresh is: whichever half is
  // already running, the other still gets its own turn.
  //
  // Called directly, never wrapped in a further runRetry('messages', ...). An
  // outer key coalesces on the error snapshot taken at the first press, so a
  // second press while that one is in flight returns the first promise and
  // never retries a half that has failed since.
  const retryDeptMessages = () =>
    Promise.all([
      ...(inboxError ? [runRetry('messages:inbox', () => loadDeptMessages('inbox'))] : []),
      ...(unreadCountError ? [runRetry('messages:unread', () => loadDeptMessages('unread'))] : []),
    ]);

  const markMessageRead = async (msgId: string) => {
    try {
      await messagesService.markAsRead(msgId);
      // Deliberately marked in place rather than removed: yanking the row the
      // member just clicked would pull the text out from under them. The
      // include_read: false load drops it on the next dashboard visit.
      // A message that requires acknowledgment stays "pending" until it is
      // acknowledged, so reading it must not drop the unread count.
      const msg = deptMessages.find((m) => m.id === msgId);
      locallyReadMessages.current.add(msgId);
      setDeptMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_read: true } : m)));
      if (msg && !msg.requires_acknowledgment) {
        setDeptMsgUnread((prev) => Math.max(0, prev - 1));
        // The overlay cannot carry a scalar, so the count is re-read from the
        // server instead: an older getUnreadCount lands with the pre-mutation
        // tally and puts the badge back up.
        void runFresh('messages:unread', () => loadDeptMessages('unread'));
      }
    } catch {
      toast.error('Failed to mark message as read');
    }
  };

  const acknowledgeMessage = async (msgId: string) => {
    setAcknowledgingId(msgId);
    try {
      await messagesService.acknowledge(msgId);
      locallyAcknowledgedMessages.current.add(msgId);
      setDeptMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_read: true, is_acknowledged: true } : m)));
      setDeptMsgUnread((prev) => Math.max(0, prev - 1));
      void runFresh('messages:unread', () => loadDeptMessages('unread'));
      toast.success('Message acknowledged');
    } catch {
      toast.error('Failed to acknowledge message');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const clearPersistentMessage = async (msgId: string) => {
    try {
      await messagesService.updateMessage(msgId, { is_active: false });
      setDeptMessages((prev) => prev.filter((m) => m.id !== msgId));
      // An inbox read that started before this one still carries the message,
      // so it puts the cleared row back when it lands. Queued behind it, like
      // the signup and RSVP paths, so the read that lands last is the one that
      // knows the message is inactive.
      void runFresh('messages:inbox', () => loadDeptMessages('inbox'));
      toast.success('Persistent message cleared');
    } catch {
      toast.error('Failed to clear message');
    }
  };

  // `isRetry` suppresses the loading flag, and every loader whose section
  // renders a skeleton takes it. On first load the skeleton is right: there is
  // nothing to show. On a retry the section is already populated and carrying
  // an error banner, so raising the flag swaps that for a skeleton and a
  // hanging request then hides the preserved rows indefinitely.
  const loadMyShifts = async (isRetry = false) => {
    if (!isRetry) setLoadingMyShifts(true);
    // Cleared up front only on first load. On a retry the error is what the
    // section is currently rendering, and dropping it before the replacement
    // arrives puts a confident wrong value on screen for as long as the retry
    // takes -- forever, if it hangs. The success path clears it instead.
    if (!isRetry) setMyShiftsError(false);
    if (!isModuleOn('scheduling')) {
      setMyShifts([]);
      setLoadingMyShifts(false);
      return;
    }
    try {
      const today = getTodayLocalDate(tz);
      const data = await schedulingService.getMyShifts({
        start_date: today,
        // A day of slack past the window, for the same reason the event fetch
        // takes it: the window filter is the authority on what is shown.
        end_date: addCalendarDays(today, TIMELINE_DAYS),
        limit: SHIFT_FETCH_LIMIT,
      });
      setMyShifts(data.shifts || []);
      setMyShiftsError(false);
    } catch {
      setMyShiftsError(true);
    } finally {
      setLoadingMyShifts(false);
    }
  };

  const loadOpenShifts = async (isRetry = false) => {
    if (!isRetry) setLoadingOpenShifts(true);
    if (!isRetry) setOpenShiftsError(false);
    if (!isModuleOn('scheduling')) {
      setOpenShifts([]);
      setLoadingOpenShifts(false);
      return;
    }
    try {
      const today = getTodayLocalDate(tz);
      const data = await schedulingService.getOpenShifts({
        start_date: today,
        // Past the visible window on purpose — see TIMELINE_LOOKAHEAD_DAYS.
        end_date: addCalendarDays(today, TIMELINE_LOOKAHEAD_DAYS),
      });
      setOpenShifts(data);
      setOpenShiftsError(false);
    } catch {
      setOpenShiftsError(true);
    } finally {
      setLoadingOpenShifts(false);
    }
  };

  const handleExpandSignup = async (shiftId: string) => {
    setSignupExpandedId(shiftId);
    setLoadingEligibility(true);
    try {
      const data = await schedulingService.getEligiblePositions(shiftId);
      setDashboardEligiblePositions(data.positions);
      const firstPos = data.positions[0];
      if (firstPos) {
        setDashboardSignupPosition(firstPos);
      }
    } catch {
      setDashboardEligiblePositions([]);
    } finally {
      setLoadingEligibility(false);
    }
  };

  const handleSignup = async (shiftId: string) => {
    const target = openShifts.find((s) => s.id === shiftId);
    const closed = target ? memberSignupClosedReason(target, signupWindow) : null;
    if (closed) {
      toast.error(`${closed} Ask a duty officer to add you.`);
      return;
    }
    setSigningUpShiftId(shiftId);
    try {
      await schedulingService.signupForShift(shiftId, { position: dashboardSignupPosition });
      toast.success('Signed up for shift');
      setSignupExpandedId(null);
      // Refresh both lists: the signed-up shift moves from open to my shifts.
      //
      // Through the same keyed guard as the Retry controls and the refresh
      // gesture. A member can sign up from a row that survived a failed load
      // while its Retry is still running; if this pair settled first, the older
      // retry would land last and put the shift they just took back on the open
      // list. Every non-initial call to these loaders goes through the guard,
      // which is what makes "last write wins" mean the newest request.
      // runFresh, not runRetry: this read must reflect the signup, so it
      // queues behind any read already in flight rather than joining one that
      // started before it.
      void runFresh('myShifts', () => loadMyShifts(true));
      void runFresh('openShifts', () => loadOpenShifts(true));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to sign up for shift'));
    } finally {
      setSigningUpShiftId(null);
    }
  };

  /**
   * Inline RSVP from the timeline, so an event reaches the same parity as an
   * open shift: respond where you are rather than navigating to the detail
   * page and back. Simpler than the shift case — there is no position to
   * choose, so there is no expand step.
   */
  const handleEventRSVP = async (eventId: string, status: 'going' | 'not_going') => {
    setRsvpingEventId(eventId);
    try {
      const saved = await eventService.createOrUpdateRSVP(eventId, { status, guest_count: 0 });
      // The server's status, not the requested one: a full event returns
      // `waitlisted`, and showing "Going" for a seat they did not get is worse
      // than showing nothing.
      const savedStatus = saved.status ?? status;
      setUpcomingEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, user_rsvp_status: savedStatus } : e)));
      if (savedStatus === 'waitlisted') {
        toast('This event is full — you have been added to the waitlist.', { icon: '⏳' });
      } else {
        toast.success(savedStatus === 'going' ? "You're going" : 'Response saved');
      }
      // The write above is local to the one row, so an events read that started
      // before this mutation still replaces the whole array when it lands and
      // takes the confirmed status with it -- the row offers RSVP buttons again
      // until something else refreshes. Queued through the same key as the
      // signup path, so this read lands after any older one.
      void runFresh('events', () => loadUpcomingEvents(true));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save your RSVP'));
    } finally {
      setRsvpingEventId(null);
    }
  };

  const loadMySeats = async (isRetry = false) => {
    if (!isRetry) setSeatsError(false);
    if (!isModuleOn('scheduling')) {
      setMySeats([]);
      return;
    }
    try {
      // No shift id: the positions the member may hold in general, not the
      // ones open on a particular shift.
      const data = await schedulingService.getEligiblePositions();
      // A member the department excludes from shift signup has no seats to
      // report, and "no seats" is not a readiness finding about them — the
      // verdict simply says nothing on the subject.
      setMySeats(data.is_excluded ? [] : data.positions);
      setSeatsError(false);
    } catch {
      setSeatsError(true);
      // Seat eligibility is non-critical; the verdict falls back to
      // certifications alone and says so.
    }
  };

  const loadMyScreenings = async (isRetry = false) => {
    if (!isRetry) setScreeningsError(false);
    if (!isModuleOn('medical_screening')) {
      setMyScreenings(null);
      return;
    }
    try {
      setMyScreenings(await medicalScreeningService.getMyCompliance());
      setScreeningsError(false);
    } catch {
      setScreeningsError(true);
      // Clear rather than keep the last good answer. A pull-to-refresh that
      // fails would otherwise leave stale counts on screen while the scope note
      // still claims screenings were checked — and a member who has since gone
      // overdue would keep reading "Clear to respond".
      setMyScreenings(null);
    }
  };

  const loadHours = async (isRetry = false) => {
    if (!isRetry) setLoadingHours(true);
    // The card's `totalUnverified` reads hoursError directly, and a retry does
    // not raise loadingHours, so clearing the flag up front puts the stale
    // partial sum back on screen as an exact total -- and leaves it there for
    // as long as the retry takes. `sourceFailed` sets the flag from the
    // settled result either way, so the retry path simply waits.
    if (!isRetry) setHoursError(false);
    if (!isRetry) setCertificationsError(false);
    try {
      // Month-to-date in the organization's timezone, not UTC — near midnight
      // a UTC-derived date lands in the wrong month for half the country.
      const today = getTodayLocalDate(tz);
      const monthStart = `${today.slice(0, 7)}-01`;
      const monthEnd = today;

      const canLoadScheduling = isModuleOn('scheduling') && checkPermission('scheduling.view');
      const canLoadTraining = isModuleOn('training') && checkPermission('training.view');
      // Admin Hours has no ModuleSettings flag and no member-facing permission
      // gate: /admin-hours, the sidebar entry that opens it and
      // GET /admin-hours/summary are all open to any authenticated member, and
      // the endpoint scopes anyone without admin_hours.manage to their own
      // entries. Gating this read on admin_hours.view -- a permission no
      // default position or rank grants -- therefore left every ordinary
      // member's Administrative row reading "Unavailable" forever, beside a
      // row that navigates to a page they can open, while their own figure was
      // one ungated request away. It is unconditional now, so there is no
      // canLoadAdminHours to consult below.

      // Only a source that was actually attempted can fail. A member without
      // training.view is not looking at a broken card, so a gated-off source
      // must leave this false -- flipping it would pin an error banner and a
      // Retry that re-runs the same gate and changes nothing.
      let schedulingFailed = false;
      let trainingFailed = false;
      let adminHoursFailed = false;
      const [schedulingSummary, trainingSummary, adminHoursSummary] = await Promise.all([
        canLoadScheduling
          ? schedulingService.getSummary().catch((err) => {
              console.error('Failed to load scheduling summary:', err);
              schedulingFailed = true;
              return null;
            })
          : Promise.resolve(null),
        canLoadTraining
          ? trainingModuleConfigService.getMyTraining().catch((err) => {
              console.error('Failed to load training summary:', err);
              trainingFailed = true;
              return null;
            })
          : Promise.resolve(null),
        adminHoursEntryService.getSummary({ startDate: monthStart, endDate: monthEnd }).catch((err) => {
          console.error('Failed to load admin hours summary:', err);
          adminHoursFailed = true;
          return null;
        }),
      ]);
      // Assigned from the settled result rather than only ever set to true:
      // a flag that a failure raises and only the eager pre-await reset clears
      // can never come down on a successful retry, which skips that reset.
      setHoursError(schedulingFailed || trainingFailed || adminHoursFailed);
      setCertificationsError(trainingFailed);
      // All three are month-to-date, because the card says "My Hours, August"
      // and the total adds them together. Training and administrative hours
      // were previously lifetime figures — so the headline total summed two
      // lifetime numbers with one monthly one and meant nothing.
      // Per source, and only where this call actually has an answer. The three
      // requests are independent, so rewriting all three from one call means a
      // retry that recovers scheduling while training transiently fails wipes
      // training's known figure -- recovery from one outage manufacturing a
      // second. A source that was not attempted, or that rejected, leaves the
      // last value it had.
      setHours((previous) => ({
        training:
          trainingFailed || !canLoadTraining
            ? previous.training
            : (trainingSummary?.hours_summary?.hours_this_month ?? null),
        standby:
          schedulingFailed || !canLoadScheduling
            ? previous.standby
            : (schedulingSummary?.hours_worked_this_month ?? null),
        administrative: adminHoursFailed ? previous.administrative : (adminHoursSummary?.totalHours ?? null),
      }));
      // Certifications are not a figure, they are an input to the readiness
      // verdict -- the thing that renders "Clear to respond". Preserving the
      // last good value is right for hours.training, which is only ever
      // displayed, and unsafe here: a credential that expired or was revoked
      // since the previous response would keep clearing the member while the
      // banner said only that readiness was not fully verified. So they are
      // cleared on failure, exactly as loadMyScreenings clears its own stale
      // input for the same reason.
      if (canLoadTraining) setMyCerts(trainingFailed ? [] : (trainingSummary?.certifications ?? []));
    } catch {
      // Hours are non-critical
    } finally {
      if (!isRetry) setLoadingHours(false);
    }
  };

  const loadTrainingProgress = async (isRetry = false) => {
    if (!isRetry) setLoadingTraining(true);
    if (!isRetry) setTrainingError(false);
    if (!isModuleOn('training')) {
      setEnrollments([]);
      setLoadingTraining(false);
      return;
    }
    try {
      const data = await trainingProgramService.getMyEnrollments('active');
      setEnrollments(data);

      // Only the rows the card renders. Asking about a fourth enrollment
      // nobody can see spends a request on it and, worse, lets its failure
      // raise "Training progress could not be verified" over two rows that
      // loaded fine — with a Retry that keeps querying the invisible one.
      const shown = data.slice(0, PROGRAMS_SHOWN);
      const results = await Promise.allSettled(shown.map((e) => trainingProgramService.getEnrollmentProgress(e.id)));
      // Merged into what is already known, not swapped for it. A retry reissues
      // every shown row, so replacing the map means one transient failure on a
      // row that had loaded drops its next requirement and deadline -- and the
      // row then claims "All requirements in progress", which is a statement,
      // not a gap. A rejection here leaves the previous answer standing.
      setProgressDetails((previous) => {
        const details = new Map(previous);
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            const item = shown[i];
            if (item) details.set(item.id, result.value);
          }
        });
        return details;
      });
      setTrainingError(results.some((result) => result.status === 'rejected'));
    } catch {
      setTrainingError(true);
    } finally {
      setLoadingTraining(false);
    }
  };

  const markNotificationRead = async (logId: string) => {
    try {
      await notificationsService.markMyNotificationRead(logId);
      setNotifications((prev) => prev.filter((n) => n.id !== logId));
      decrementUnread();
      // Same reason as clearPersistentMessage: a notifications read that
      // started before this one restores the row it just removed.
      void runFresh('notifications', () => loadNotifications(true));
    } catch {
      toast.error('Failed to mark notification as read');
    }
  };

  const monthLabel = formatDateCustom(new Date(), { month: 'long' }, tz);

  // ── The thirty-day list ───────────────────────────────────────────────────
  // My shifts, open slots and events are one question — "what am I doing next"
  // — so they merge into one date-ordered list rather than three panels the
  // reader has to interleave by hand.
  const windowStart = getTodayLocalDate(tz);
  const windowEnd = addCalendarDays(windowStart, TIMELINE_DAYS - 1);

  // Open slots the member is not already on. The backend excludes their own
  // shifts, but this is the defence-in-depth pass — and it has to happen here
  // rather than inside loadOpenShifts, where `myShifts` is read from a render
  // closure that is still empty because both lists are fetched concurrently.
  const availableOpenShifts = useMemo(() => {
    const mine = new Set(myShifts.map((s) => s.id));
    return openShifts.filter((s) => !mine.has(s.id));
  }, [myShifts, openShifts]);

  // The open shifts inside the window the card actually shows.
  //
  // `availableOpenShifts` reaches TIMELINE_LOOKAHEAD_DAYS out, and that reach
  // exists for one purpose: letting the footer say how many more lie beyond
  // the window. Any count that describes "what is open" to the member belongs
  // to the window instead — a quick action reporting a shift sixty days out
  // sends them to a schedule that is not showing it, and the number it quotes
  // matches nothing they can see.
  const openShiftsInWindow = useMemo(
    () => availableOpenShifts.filter((s) => s.shift_date <= windowEnd),
    [availableOpenShifts, windowEnd]
  );

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];

    // start_time is "HH:MM" on some shift payloads and a full UTC datetime on
    // others (my-shifts). formatTimeOfDay falls back to the raw string on
    // anything it cannot parse, which put bare ISO timestamps on the timeline.
    const formatShiftTime = (value: string | null | undefined) =>
      value && value.includes('T') ? formatTime(value, tz) : formatTimeOfDay(value);

    const shiftTimeRange = (shift: ShiftRecord) => {
      const start = formatShiftTime(shift.start_time);
      const end = formatShiftTime(shift.end_time);
      return end ? `${start}–${end}` : start;
    };

    const shiftSortAt = (shift: ShiftRecord) =>
      shift.start_time?.includes('T')
        ? new Date(shift.start_time).getTime()
        : new Date(`${shift.shift_date}T${shift.start_time || '00:00'}`).getTime();

    for (const shift of myShifts) {
      const details = [shiftTimeRange(shift)];
      if (shift.shift_officer_name) details.push(`Officer ${shift.shift_officer_name}`);
      // The my-shifts payload carries no attendee_count; interpolating it
      // unguarded printed "undefined of 4 filled" on the member's own rows.
      if (shift.min_staffing != null && shift.attendee_count != null)
        details.push(`${shift.attendee_count} of ${shift.min_staffing} filled`);
      entries.push({
        key: `my-${shift.id}`,
        kind: 'my-shift',
        dateOnly: shift.shift_date,
        sortAt: shiftSortAt(shift),
        title: shift.apparatus_name ? `Shift · ${shift.apparatus_name}` : 'Shift',
        detail: details.join(' · '),
        shift,
      });
    }

    for (const shift of availableOpenShifts) {
      const details = [shiftTimeRange(shift)];
      if (shift.min_staffing != null && shift.attendee_count != null)
        details.push(`${shift.attendee_count} of ${shift.min_staffing} filled`);
      entries.push({
        key: `open-${shift.id}`,
        kind: 'open-shift',
        dateOnly: shift.shift_date,
        sortAt: shiftSortAt(shift),
        title: shift.apparatus_name ? `Open Shift · ${shift.apparatus_name}` : 'Open Shift',
        detail: details.join(' · '),
        shift,
      });
    }

    for (const evt of upcomingEvents) {
      const details = [formatTime(evt.start_datetime, tz), getEventTypeLabel(evt.event_type)];
      if (evt.location_name || evt.location) details.push(evt.location_name || evt.location || '');
      entries.push({
        key: `event-${evt.id}`,
        kind: 'event',
        dateOnly: toLocalISODate(evt.start_datetime, tz),
        sortAt: new Date(evt.start_datetime).getTime(),
        title: evt.title,
        detail: details.filter(Boolean).join(' · '),
        event: evt,
      });
    }

    return entries
      .filter((e) => e.dateOnly >= windowStart && e.dateOnly <= windowEnd)
      .sort((a, b) => a.sortAt - b.sortAt);
  }, [myShifts, availableOpenShifts, upcomingEvents, tz, windowStart, windowEnd]);

  const visibleTimeline = timeline.slice(0, TIMELINE_ROWS_SHOWN);
  const timelineCollapsedOnMobile = !timelineExpandedOnMobile && timeline.length > TIMELINE_ROWS_SHOWN_MOBILE;
  // Counted from the whole window rather than the six rows the list renders: the
  // footer that discloses entries past the desktop cap is itself held back
  // while collapsed, so this line is the only thing left saying they exist.
  const timelineHiddenOnMobile = timelineCollapsedOnMobile ? timeline.slice(TIMELINE_ROWS_SHOWN_MOBILE) : [];
  const firstHiddenTimelineRow = timelineHiddenOnMobile[0];
  const laterOpenShifts = availableOpenShifts.filter((s) => s.shift_date > windowEnd).length;
  const shortStaffedOpenShifts = openShiftsInWindow.filter(
    (s) => s.min_staffing != null && s.attendee_count < s.min_staffing
  ).length;
  const timelineLoading = loadingMyShifts || loadingOpenShifts || loadingUpcomingEvents;

  // ── "Needs you" ───────────────────────────────────────────────────────────
  const urgentCerts = useMemo(
    () =>
      // currentCredentials first: my-training returns a history, so a renewed
      // certification still has its lapsed row in the list. Without this the
      // panel names an expiry the verdict above has already discounted.
      currentCredentials(myCerts)
        .filter((c) => c.is_expired || (c.days_until_expiry !== null && c.days_until_expiry <= READINESS_WINDOW_DAYS))
        .sort((a, b) => (a.days_until_expiry ?? -Infinity) - (b.days_until_expiry ?? -Infinity)),
    [myCerts]
  );

  const pendingAcknowledgements = useMemo(
    () => deptMessages.filter((m) => m.requires_acknowledgment && !m.is_acknowledged),
    [deptMessages]
  );

  const needsYouItems: NeedsYouItem[] = [];
  for (const cert of urgentCerts.slice(0, 2)) {
    needsYouItems.push({
      id: `cert-${cert.id}`,
      icon: GraduationCap,
      title: cert.is_expired
        ? `${cert.course_name} is expired`
        : cert.days_until_expiry !== null
          ? `${cert.course_name} expires in ${cert.days_until_expiry} days`
          : `${cert.course_name} expires soon`,
      detail: cert.expiration_date ? `Expires ${formatDate(cert.expiration_date, tz)}` : undefined,
      actionLabel: 'Start Renewal',
      onAction: () => void navigate('/training/my-training'),
      tone: needsYouItems.length === 0 ? 'primary' : 'neutral',
    });
  }
  for (const msg of pendingAcknowledgements) {
    needsYouItems.push({
      id: `msg-${msg.id}`,
      icon: Megaphone,
      title: msg.title,
      detail: [msg.author_name, msg.created_at ? formatDate(msg.created_at, tz) : ''].filter(Boolean).join(' · '),
      actionLabel: 'Acknowledge',
      onAction: () => void acknowledgeMessage(msg.id),
      tone: needsYouItems.length === 0 ? 'primary' : 'warning',
      busy: acknowledgingId === msg.id,
    });
  }
  // Department-wide action-item and setup totals belong in Organization. They
  // must not make the personal "Needs you" list look like an individual inbox.

  // ── Department feed ───────────────────────────────────────────────────────
  // Messages and notifications used to render as two panels off one list, and
  // a third "Recent Activity" panel restated the same notifications as dots.
  // One feed, newest first. Anything awaiting acknowledgement is excluded —
  // it is already stated above with the button that resolves it.
  const feed = useMemo<FeedEntry[]>(() => {
    const entries: FeedEntry[] = [];
    const ackPendingIds = new Set(pendingAcknowledgements.map((m) => m.id));

    for (const msg of deptMessages) {
      if (ackPendingIds.has(msg.id)) continue;
      entries.push({
        key: `msg-${msg.id}`,
        title: msg.title,
        body: <LinkifiedText text={msg.body} />,
        meta: [msg.author_name, msg.created_at ? formatDate(msg.created_at, tz) : ''].filter(Boolean).join(' · '),
        sortAt: msg.created_at ? new Date(msg.created_at).getTime() : 0,
        unread: !msg.is_read,
        onClick: () => {
          if (!msg.is_read && !msg.is_persistent) void markMessageRead(msg.id);
          // Deep-link to the message itself; its breadcrumb carries the member
          // on to the full inbox, which tapping the feed row used to be the
          // only way to reach.
          void navigate(`/messages/${msg.id}`);
        },
        message: msg,
      });
    }

    for (const notif of notifications) {
      entries.push({
        key: `notif-${notif.id}`,
        title: notif.subject || 'Notification',
        body: notif.message || '',
        meta: formatRelativeTime(notif.sent_at || notif.created_at),
        sortAt: notif.sent_at ? new Date(notif.sent_at).getTime() : 0,
        unread: !notif.read,
        onClick: () => {
          void markNotificationRead(notif.id);
          if (notif.action_url && notif.action_url.startsWith('/')) void navigate(notif.action_url);
          else void navigate('/notifications?tab=inbox');
        },
      });
    }

    // Standing items first, then newest.
    //
    // The inbox already arrives ordered pinned → persistent → newest, and
    // merging it with notifications under a plain recency sort threw both
    // away. Only FEED_ROWS_SHOWN rows render, so a pinned "Station 2 bay
    // doors out of service" sat below four routine notifications and a
    // standing order dropped off the board entirely — the pin icon rendered
    // beside it either way, which is the part that misleads: an officer who
    // pins a notice has no way to tell it did nothing.
    const standing = (entry: FeedEntry) => (entry.message?.is_pinned ? 2 : entry.message?.is_persistent ? 1 : 0);
    return entries.sort((a, b) => standing(b) - standing(a) || b.sortAt - a.sortAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptMessages, notifications, pendingAcknowledgements, tz]);

  const feedUnread = unreadCount + deptMsgUnread;

  const hoursSegments: HoursSegment[] = [
    { label: 'Training', value: hours.training, colorClass: 'bg-theme-accent-green' },
    {
      label: 'Standby',
      value: hours.standby,
      colorClass: 'bg-theme-accent-yellow',
      onClick: () => void navigate('/scheduling?tab=my-shifts&view=past'),
    },
    {
      label: 'Administrative',
      value: hours.administrative,
      colorClass: 'bg-theme-accent-purple',
      onClick: () => void navigate('/admin-hours'),
    },
  ];

  // Retries in flight, keyed by loader rather than by the control that started
  // them. Two controls can sit over one loader -- a training-summary failure
  // renders a Retry on both the hours card and the readiness card, and both
  // call loadHours -- so a per-control guard leaves them able to run
  // concurrently. If the later call settles first, the earlier one lands last
  // and restores the error over data that had just recovered.
  const retriesInFlight = useRef(new Map<string, Promise<unknown>>());
  const [busyLoaders, setBusyLoaders] = useState<ReadonlySet<string>>(new Set());

  // Registers `started` under `key` and clears it on settle -- but only if it
  // is still the entry registered, so a queued successor is not deleted by its
  // predecessor finishing.
  const track = useCallback((key: string, begin: () => Promise<unknown>): Promise<unknown> => {
    const started: Promise<unknown> = begin().finally(() => {
      if (retriesInFlight.current.get(key) === started) {
        retriesInFlight.current.delete(key);
        setBusyLoaders(new Set(retriesInFlight.current.keys()));
      }
    });
    retriesInFlight.current.set(key, started);
    setBusyLoaders(new Set(retriesInFlight.current.keys()));
    return started;
  }, []);

  const runRetry = useCallback(
    (key: string, run: () => Promise<unknown>): Promise<unknown> => {
      const existing = retriesInFlight.current.get(key);
      // Joined, not queued: a second press while the first is still running is
      // the same request, so it waits on the same promise instead of issuing
      // another. Sound only because these reads are idempotent -- see runFresh
      // for the case where they are not.
      if (existing) return existing;
      return track(key, run);
    },
    [track]
  );

  // Queued behind whatever is running, never joined to it.
  //
  // After a mutation, joining is wrong: a read that started before the change
  // answers from before it. Joining the post-signup refresh to a read already
  // in flight can therefore repopulate the shift the member just took, and
  // nothing later corrects it, because the guard counted that refresh as done.
  const runFresh = useCallback(
    (key: string, run: () => Promise<unknown>): Promise<unknown> => {
      const existing = retriesInFlight.current.get(key);
      // The predecessor's rejection is not this call's failure, so it is
      // swallowed here rather than skipping the fresh read.
      const after = existing
        ? existing.then(
            () => undefined,
            () => undefined
          )
        : Promise.resolve();
      return track(key, () => after.then(run));
    },
    [track]
  );

  // A control is inert only when *every* source it would retry is already
  // running -- not when any one of them is. Several controls here cover more
  // than one source, and `some` disabled the whole control for a source that
  // happened to be slow, blocking recovery of the other one: a hanging inbox
  // retry left the Updates button dead while the unread count was failing and
  // idle. Pressing a partially busy control is safe, because runRetry joins
  // the half already in flight and starts only the half that is not.
  const allBusy = useCallback(
    (...keys: string[]) => keys.length > 0 && keys.every((key) => busyLoaders.has(key)),
    [busyLoaders]
  );

  // Held in a ref and rewritten every render, then exposed through a stable
  // callback. useRegisterPullToRefresh wants one identity for the lifetime of
  // the page, and a useCallback with suppressed deps gives it that by freezing
  // the closure from first render -- when useEnabledModules() is still
  // answering permissively because the configuration has not landed. Pulling to
  // refresh then called gated endpoints for modules the organization has
  // disabled, took the 403, and raised an error the module-aware initial load
  // had correctly avoided. The ref keeps the identity stable and the body
  // current.
  const refreshImpl = useRef<() => Promise<void>>(async () => {});
  refreshImpl.current = async () => {
    // `true` throughout: a pull-to-refresh runs with the page already on
    // screen, so it is a refresh rather than a first load. Clearing the error
    // flags up front here would do what it did on the inline Retry -- a
    // refresh never raises loadingHours, so the hours card's "Total
    // unavailable" would revert to an exact stale partial total for the
    // duration of a slow refresh.
    // Through runRetry, not around it: the gesture is not blocked while a
    // section Retry is in flight, so calling the loaders directly would start a
    // second request for the same source. If the newer one settles first the
    // older lands last, restoring an error over data that had just recovered --
    // the same race the keyed guard was added to stop, arriving by a different
    // door. Sharing the keys makes a concurrent gesture join the retry instead.
    await Promise.all([
      // The two message subrequests are keyed apart, so a refresh that joins an
      // inbox-only retry still refreshes the unread count. Sharing one key made
      // the refresh return that partial promise and skip the other half,
      // leaving the badge stale.
      runRetry('messages:inbox', () => loadDeptMessages('inbox')),
      runRetry('messages:unread', () => loadDeptMessages('unread')),
      runRetry('events', () => loadUpcomingEvents(true)),
      // Module-owned loaders, held until the module config lands -- the same
      // condition the mount effect applies, for the same reason: isModuleOn
      // answers permissively while the configuration is unknown, so a refresh
      // inside that window fires every gated endpoint and takes a 403 per
      // disabled module, raising errors the module-aware first load avoids.
      //
      // Making this closure current rather than frozen was necessary and not
      // sufficient: *current* during that window is still permissive. The
      // window is short enough to miss locally and wide enough to hit on a
      // loaded CI runner, which is where it was caught.
      //
      // Skipping loses nothing: the mount effect runs exactly these the moment
      // modulesLoading flips.
      ...(modulesLoading
        ? []
        : [
            runRetry('hours', () => loadHours(true)),
            runRetry('notifications', () => loadNotifications(true)),
            runRetry('myShifts', () => loadMyShifts(true)),
            runRetry('openShifts', () => loadOpenShifts(true)),
            runRetry('seats', () => loadMySeats(true)),
            runRetry('screenings', () => loadMyScreenings(true)),
            runRetry('training', () => loadTrainingProgress(true)),
            runRetry('equipment', () => loadMyEquipment(true)),
          ]),
      ...(activeTab === 'department' && canViewLegacyAdmin ? [loadAdminSummary(), loadSetupProgress()] : []),
      ...(activeTab === 'department' && canViewChiefOperations ? [loadOperations()] : []),
      ...(activeTab === 'department' && canViewAssets ? [loadAssetWidgets()] : []),
    ]);
  };

  const refreshDashboard = useCallback(() => refreshImpl.current(), []);

  useRegisterPullToRefresh(refreshDashboard);

  const firstName = currentUser?.first_name?.trim();
  const greeting = firstName ? `Hi, ${firstName}` : `Welcome to ${departmentName}`;

  const renderTimelineRow = (entry: TimelineEntry, index: number) => {
    const shift = entry.shift;
    const evt = entry.event;
    const expanded = shift != null && signupExpandedId === shift.id;
    const signupClosedReason = shift ? memberSignupClosedReason(shift, signupWindow) : null;
    // Held back on phones only, and by CSS: the row stays in the markup, so a
    // rotation to landscape reveals it without the summary line below going
    // stale about what is hidden.
    const heldBackOnMobile = timelineCollapsedOnMobile && index >= TIMELINE_ROWS_SHOWN_MOBILE;

    return (
      <li
        key={entry.key}
        // The row the disclosure line names, focused when that line is tapped:
        // the line unmounts on activation, and without this focus falls to the
        // document body, leaving a keyboard or switch user to traverse the
        // whole dashboard again to reach the Sign Up they just revealed.
        ref={index === TIMELINE_ROWS_SHOWN_MOBILE ? firstCollapsedTimelineRowRef : undefined}
        tabIndex={index === TIMELINE_ROWS_SHOWN_MOBILE ? -1 : undefined}
        className={`border-theme-surface-hover focus:ring-theme-focus-ring border-t first:border-t-0 focus:ring-2 focus:outline-hidden focus:ring-inset ${
          heldBackOnMobile ? 'hidden sm:list-item' : ''
        }`}
      >
        <div
          className={`flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 ${
            entry.kind === 'open-shift' ? 'bg-theme-surface-secondary' : ''
          }`}
        >
          <div className="w-11 shrink-0 text-center sm:w-13">
            <div className="text-theme-text-muted text-[10px] font-bold tracking-[0.1em] uppercase sm:text-[11px]">
              {formatCalendarDate(entry.dateOnly, { weekday: 'short' })}
            </div>
            <div className="text-theme-text-primary text-lg font-bold tabular-nums sm:text-xl">
              {formatCalendarDate(entry.dateOnly, { day: 'numeric' })}
            </div>
          </div>
          <div className={`w-1 self-stretch rounded-full ${TIMELINE_ACCENT[entry.kind]}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-primary truncate text-[15px] font-semibold sm:text-base">{entry.title}</p>
            <p className="text-theme-text-muted truncate text-xs sm:text-sm">{entry.detail}</p>
          </div>

          {entry.kind === 'my-shift' && (
            <span className="bg-theme-accent-blue-muted text-theme-accent-blue shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
              Yours
            </span>
          )}

          {/* The row stays — the open list still returns a shift that has
              begun, and hiding one an officer is about to add somebody to is
              worse than showing it with the reason. */}
          {entry.kind === 'open-shift' && shift && !expanded && signupClosedReason && (
            <span className="text-theme-text-muted shrink-0 text-xs sm:text-sm">{signupClosedReason}</span>
          )}

          {entry.kind === 'open-shift' && shift && !expanded && !signupClosedReason && (
            <button
              type="button"
              onClick={() => void handleExpandSignup(shift.id)}
              className="btn-success btn-auto inline-flex min-h-[44px] shrink-0 items-center gap-1.5 px-4 text-sm font-semibold"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Up</span>
            </button>
          )}

          {entry.kind === 'event' &&
            evt &&
            (evt.user_rsvp_status ? (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${getRSVPStatusColor(evt.user_rsvp_status)}`}
              >
                {getRSVPStatusLabel(evt.user_rsvp_status)}
              </span>
            ) : evt.is_cancelled ||
              (evt.rsvp_deadline && new Date(evt.rsvp_deadline) <= new Date()) ||
              // This row only submits `going`, so an event that does not accept
              // it has nothing here that can succeed — the API rejects the
              // request deterministically against allowed_rsvp_statuses.
              !(evt.allowed_rsvp_statuses ?? ['going', 'not_going']).includes('going') ? (
              <button
                type="button"
                onClick={() => void navigate(`/events/${evt.id}`)}
                className="btn-secondary btn-auto inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold"
              >
                Open
              </button>
            ) : (
              /* Inline, matching the open-shift row above: a member answers
                 where they are instead of navigating to the detail page and
                 back. requires_rsvp is not consulted — it says a response is
                 expected, not that one is accepted. A passed rsvp_deadline is
                 consulted, above: the API rejects those, and a prominent
                 dashboard button that can never succeed is worse than a link. */
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleEventRSVP(evt.id, 'going')}
                  disabled={rsvpingEventId === evt.id}
                  className="btn-success btn-auto inline-flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {rsvpingEventId === evt.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>Going</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleEventRSVP(evt.id, 'not_going')}
                  disabled={rsvpingEventId === evt.id}
                  className="btn-secondary btn-auto inline-flex min-h-[44px] shrink-0 items-center px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Can&apos;t
                </button>
              </div>
            ))}
        </div>

        {expanded && shift && (
          <div className="border-theme-surface-border bg-theme-surface-secondary border-t px-4 py-3 sm:px-5">
            {loadingEligibility ? (
              <div className="flex items-center justify-center py-2" role="status" aria-live="polite">
                <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
              </div>
            ) : dashboardEligiblePositions.length === 0 ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-amber-600 dark:text-amber-400">Not eligible for this shift.</p>
                <button
                  onClick={() => setSignupExpandedId(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary px-2 py-2 text-xs"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={dashboardSignupPosition}
                  onChange={(e) => setDashboardSignupPosition(e.target.value)}
                  aria-label="Position for this shift"
                  className="form-input sm:flex-1"
                >
                  {dashboardEligiblePositions.map((pos) => (
                    <option key={pos} value={pos}>
                      {positionLabel(pos)}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleSignup(shift.id)}
                    disabled={signingUpShiftId === shift.id}
                    className="btn-success flex shrink-0 items-center space-x-1 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed"
                  >
                    {signingUpShiftId === shift.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span>Confirm</span>
                  </button>
                  <button
                    onClick={() => setSignupExpandedId(null)}
                    className="text-theme-text-muted hover:text-theme-text-primary px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {loadingNotifications || loadingMyShifts || loadingHours || loadingTraining
          ? 'Loading dashboard content...'
          : 'Dashboard content loaded.'}
      </div>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
        {/* Header — who and when. The month's hours are stated once, by the
            hours card, which carries the same total plus the split behind it
            and its own failure state; a second copy up here restated the
            figure with no way to see what it was made of. */}
        <div className="mb-5 sm:mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">{greeting}</h2>
              <p className="text-theme-text-muted mt-0.5 text-sm sm:text-base">
                {formatDateCustom(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }, tz)}
                <span className="hidden sm:inline">{' · ' + departmentName}</span>
              </p>
            </div>
            {canViewOrganization && (
              <div
                role="tablist"
                aria-label="Dashboard view"
                className="bg-theme-surface-hover order-3 inline-flex w-full gap-1 rounded-full p-1 sm:order-none sm:w-auto"
              >
                {(
                  [
                    { id: 'personal', label: 'Personal' },
                    { id: 'department', label: 'My Department' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`dashboard-tab-${tab.id}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls={`dashboard-panel-${tab.id}`}
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={handleTabKeyDown}
                    className={`focus:ring-theme-focus-ring min-h-[44px] flex-1 rounded-full px-4 text-sm font-semibold transition-colors focus:ring-2 focus:outline-hidden sm:flex-none ${
                      activeTab === tab.id
                        ? 'bg-theme-surface text-theme-text-primary shadow-sm'
                        : 'text-theme-text-secondary hover:text-theme-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {activeTab === 'personal' ? (
          <div
            id="dashboard-panel-personal"
            role={canViewOrganization ? 'tabpanel' : undefined}
            aria-labelledby={canViewOrganization ? 'dashboard-tab-personal' : undefined}
            className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6"
          >
            {/* ── Main column ── */}
            <div className="flex min-w-0 flex-col gap-5">
              {/* First thing a new member sees, because the dashboard is where
                  they land and nothing here pointed at the lessons before. */}
              <DashboardOrientation />
              <DashboardOrganizationWidgets />
              {/* Both carry the default flex order, so source order puts the
                  verdict above the panel it summarises — on phones too, where
                  the actions and timeline swap around them. */}
              <DashboardReadiness
                certs={myCerts}
                positions={mySeats}
                screenings={myScreenings}
                // A verdict driven only by screenings has nothing to say on
                // the training page. Send those members to the department feed,
                // where a screening notice would reach them, rather than to a
                // page that cannot explain what grounded them.
                onOpen={() => void navigate(myCerts.length > 0 ? '/training/my-training' : '/notifications?tab=inbox')}
              />
              {(certificationsError || seatsError || screeningsError) && (
                <div className="card">
                  <SectionError
                    message="Readiness could not be fully verified."
                    source="readiness"
                    // Mirrors the handler's conditions exactly. Listing every
                    // possible source unconditionally lets a slow hours retry
                    // disable this control even when readiness failed only on
                    // seats -- blocking recovery of a source the button would
                    // have been the one to retry.
                    busy={allBusy(
                      ...(certificationsError ? ['hours'] : []),
                      ...(seatsError ? ['seats'] : []),
                      ...(screeningsError ? ['screenings'] : [])
                    )}
                    onRetry={() => {
                      // Only the failed sources. Reloading the healthy ones
                      // disturbs the Hours card for a readiness failure, and a
                      // transient rejection from a request that had succeeded
                      // replaces good data with an unavailable state -- turning
                      // one recoverable failure into several.
                      //
                      // 'hours' is the same key the hours card's own control
                      // uses, which is what stops those two racing each other.
                      if (certificationsError) void runRetry('hours', () => loadHours(true));
                      if (seatsError) void runRetry('seats', () => loadMySeats(true));
                      if (screeningsError) void runRetry('screenings', () => loadMyScreenings(true));
                    }}
                  />
                </div>
              )}

              <DashboardNeedsYou items={needsYouItems} />

              {/* Three actions, not one. The page's own data says taking a
                  shift and clocking in are as common as logging training.
                  On a phone they sit *below* the week: at 2am the thumb
                  reaches the bottom third, and the week is what you read. */}
              <div className="order-3 grid grid-cols-2 gap-3 sm:order-1 sm:grid-cols-3">
                <button
                  onClick={() => void navigate('/training/submit')}
                  className="focus:ring-theme-focus-ring col-span-2 flex min-h-[72px] items-center gap-3.5 rounded-lg bg-red-800 px-4 py-4 text-left text-white shadow-sm transition-colors hover:bg-red-900 focus:ring-2 focus:ring-offset-2 focus:outline-hidden active:bg-red-900 sm:col-span-1 sm:min-h-[88px]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/20">
                    <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-bold">Log Training</span>
                    <span className="mt-0.5 block truncate text-[13px] text-red-100">Course, hours, done</span>
                  </span>
                </button>

                <button
                  onClick={() => void navigate('/scheduling')}
                  className="card focus:ring-theme-focus-ring flex min-h-[72px] items-center gap-2.5 px-3.5 py-4 text-left hover:shadow-md focus:ring-2 focus:outline-hidden sm:min-h-[88px] sm:gap-3.5 sm:px-4"
                >
                  <span className="bg-theme-accent-green-muted text-theme-accent-green flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-11 sm:w-11">
                    <CalendarPlus className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-theme-text-primary block text-[15px] font-bold sm:text-base">
                      Take a Shift
                    </span>
                    <span className="text-theme-text-muted mt-0.5 hidden truncate text-[13px] sm:block">
                      {openShiftsError ? (
                        'Open shifts unavailable'
                      ) : (
                        <>
                          <span className="font-bold tabular-nums">{openShiftsInWindow.length}</span> open
                          {shortStaffedOpenShifts > 0 && ` · ${shortStaffedOpenShifts} short-staffed`}
                        </>
                      )}
                    </span>
                  </span>
                </button>

                <button
                  onClick={() => void navigate('/admin-hours')}
                  className="card focus:ring-theme-focus-ring flex min-h-[72px] items-center gap-2.5 px-3.5 py-4 text-left hover:shadow-md focus:ring-2 focus:outline-hidden sm:min-h-[88px] sm:gap-3.5 sm:px-4"
                >
                  <span className="bg-theme-accent-purple-muted text-theme-accent-purple flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-11 sm:w-11">
                    <ClipboardCheck className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-theme-text-primary block text-[15px] font-bold sm:text-base">Clock In</span>
                    <span className="text-theme-text-muted mt-0.5 hidden truncate text-[13px] sm:block">
                      Administrative hours
                    </span>
                  </span>
                </button>
              </div>

              {/* One time list: my shifts, open slots and events, merged */}
              <section className="card order-2 overflow-hidden" aria-labelledby="next-thirty-days-heading">
                <div className="border-theme-surface-border flex items-center gap-3 border-b px-4 py-3.5 sm:px-5">
                  <Calendar className="text-theme-text-secondary h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  <h3 id="next-thirty-days-heading" className="text-theme-text-primary text-base font-bold">
                    Next 30 Days
                  </h3>
                  <span className="text-theme-text-muted ml-auto hidden text-xs lg:inline">
                    Your shifts, drills and open slots in one list
                  </span>
                  {/* "All Shifts", not "Full Schedule": this list carries
                      drills and events too, and /scheduling carries neither —
                      a label promising the whole schedule sends a member
                      looking for Thursday's drill somewhere it cannot be.
                      `view=month` because the list now spans thirty days, and
                      because the phone grid draws a month whatever the view
                      says while `week` fetches only seven days of data. */}
                  <button
                    onClick={() => void navigate('/scheduling?view=month')}
                    className="text-theme-accent-red ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 py-2 pl-2 text-sm font-semibold lg:ml-4"
                  >
                    All Shifts
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                {timelineLoading ? (
                  <div className="space-y-2 p-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-theme-surface-hover h-14 animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <>
                    {(myShiftsError || openShiftsError || upcomingEventsError) && (
                      <SectionError
                        message="Some schedule information could not be verified."
                        source="schedule"
                        busy={allBusy(
                          ...(myShiftsError ? ['myShifts'] : []),
                          ...(openShiftsError ? ['openShifts'] : []),
                          ...(upcomingEventsError ? ['events'] : [])
                        )}
                        onRetry={() => {
                          if (myShiftsError) void runRetry('myShifts', () => loadMyShifts(true));
                          if (openShiftsError) void runRetry('openShifts', () => loadOpenShifts(true));
                          if (upcomingEventsError) void runRetry('events', () => loadUpcomingEvents(true));
                        }}
                      />
                    )}
                    <ul>{visibleTimeline.map(renderTimelineRow)}</ul>

                    {firstHiddenTimelineRow && (
                      <button
                        type="button"
                        onClick={revealTimelineOnMobile}
                        className="border-theme-surface-border bg-theme-surface-secondary focus:ring-theme-focus-ring flex min-h-[44px] w-full items-center gap-2 border-t px-4 text-left focus:ring-2 focus:outline-hidden focus:ring-inset sm:hidden"
                      >
                        <span className="text-theme-text-secondary min-w-0 flex-1 truncate text-[13px]">
                          {formatCalendarDate(firstHiddenTimelineRow.dateOnly, { weekday: 'short', day: 'numeric' })} ·{' '}
                          {firstHiddenTimelineRow.title}
                          {timelineHiddenOnMobile.length > 1 && `, and ${timelineHiddenOnMobile.length - 1} more`}
                        </span>
                        <ChevronDown className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                      </button>
                    )}

                    {/* Held back while the week is collapsed: "Nothing else
                        through Aug 19" directly under a line promising two more
                        rows reads as a contradiction. */}
                    <div
                      data-testid="timeline-footer"
                      className={`border-theme-surface-border bg-theme-surface-secondary border-t px-4 py-2.5 sm:px-5 ${
                        timelineCollapsedOnMobile ? 'hidden sm:block' : ''
                      }`}
                    >
                      <p className="text-theme-text-muted text-[13px]">
                        {myShiftsError || openShiftsError || upcomingEventsError
                          ? timeline.length > visibleTimeline.length
                            ? `${timeline.length - visibleTimeline.length} more loaded item${timeline.length - visibleTimeline.length === 1 ? '' : 's'}`
                            : 'Showing available schedule information'
                          : timeline.length === 0
                            ? 'Nothing scheduled'
                            : timeline.length > visibleTimeline.length
                              ? `${timeline.length - visibleTimeline.length} more`
                              : 'Nothing else'}{' '}
                        through {formatCalendarDate(windowEnd, { month: 'short', day: 'numeric' })}
                        {laterOpenShifts > 0 && (
                          <>
                            {' · '}
                            <button
                              onClick={() => void navigate('/scheduling')}
                              className="text-theme-accent-red font-semibold"
                            >
                              {laterOpenShifts} more open shift{laterOpenShifts === 1 ? '' : 's'}
                            </button>{' '}
                            in the following month
                          </>
                        )}
                      </p>
                    </div>
                  </>
                )}
              </section>

              {/* PWA Install Banner. Two variants: browsers that fire
                  `beforeinstallprompt` get a one-tap Install button; iOS Safari
                  has no such event, so it gets Share-sheet instructions. */}
              {(canInstall || needsManualInstall) && !dismissedInstall && (
                <div className="order-4 flex flex-col gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />
                    <div>
                      <p className="text-theme-text-primary text-sm font-medium">Install The Logbook</p>
                      {needsManualInstall ? (
                        <p className="text-theme-text-muted text-xs">
                          Tap the Share button <Share className="-mt-0.5 inline h-3.5 w-3.5" aria-hidden="true" /> in
                          Safari, then choose &ldquo;Add to Home Screen&rdquo;.
                        </p>
                      ) : (
                        <p className="text-theme-text-muted text-xs">Add to your home screen for quick access</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={dismissInstallBanner}
                      className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target rounded px-3 text-sm"
                    >
                      Dismiss
                    </button>
                    {canInstall && (
                      <button
                        onClick={() => {
                          void install();
                        }}
                        className="btn-info mobile-touch-target rounded-md px-4 text-sm font-medium"
                      >
                        Install
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Rail ── */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* The member's own inbox activity; department-wide reporting is
                  deliberately kept in the Organization tab. */}
              <section className="card overflow-hidden" aria-labelledby="my-updates-heading">
                <div className="border-theme-surface-border flex items-center gap-2 border-b px-4 py-3">
                  <Megaphone className="text-theme-accent-yellow h-4 w-4 shrink-0" aria-hidden="true" />
                  <h3 id="my-updates-heading" className="text-theme-text-primary text-[15px] font-bold">
                    My Updates
                  </h3>
                  {feedUnread > 0 && (
                    <span
                      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white tabular-nums"
                      aria-label={`${feedUnread} unread`}
                    >
                      {feedUnread}
                    </span>
                  )}
                </div>

                {loadingMessages || loadingNotifications ? (
                  <div className="space-y-2 p-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-theme-surface-hover h-12 animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : feed.length === 0 ? (
                  messagesError || notificationsError ? (
                    <SectionError
                      message="Updates could not be fully verified."
                      source="updates"
                      busy={allBusy(
                        ...(inboxError ? ['messages:inbox'] : []),
                        ...(unreadCountError ? ['messages:unread'] : []),
                        ...(notificationsError ? ['notifications'] : [])
                      )}
                      onRetry={() => {
                        if (messagesError) void retryDeptMessages();
                        if (notificationsError) void runRetry('notifications', () => loadNotifications(true));
                      }}
                    />
                  ) : (
                    <p className="text-theme-text-muted px-4 py-6 text-center text-sm">Nothing new</p>
                  )
                ) : (
                  <>
                    {(messagesError || notificationsError) && (
                      <SectionError
                        message="Some updates could not be verified."
                        // The handler retries only what failed, so the name has
                        // to follow it: hard-coding one source tells a screen
                        // reader the button refreshes a healthy feed.
                        source={messagesError ? 'updates' : 'notifications'}
                        busy={allBusy(
                          ...(inboxError ? ['messages:inbox'] : []),
                          ...(unreadCountError ? ['messages:unread'] : []),
                          ...(notificationsError ? ['notifications'] : [])
                        )}
                        onRetry={() => {
                          if (messagesError) void retryDeptMessages();
                          if (notificationsError) void runRetry('notifications', () => loadNotifications(true));
                        }}
                      />
                    )}
                    <ul>
                      {feed.slice(0, FEED_ROWS_SHOWN).map((entry) => {
                        const msg = entry.message;
                        const rowClass =
                          'focus:ring-theme-focus-ring min-w-0 flex-1 cursor-pointer rounded text-left focus:ring-2 focus:outline-hidden';
                        const rowInner = (
                          <>
                            <span className="text-theme-text-primary flex items-center gap-1.5 text-sm font-semibold">
                              {msg?.is_pinned && (
                                <Pin className="text-theme-accent-yellow h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span className="truncate">{entry.title}</span>
                              {entry.unread && (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                                  role="img"
                                  aria-label="Unread"
                                />
                              )}
                              {msg?.is_persistent && (
                                <span className="bg-theme-surface-hover text-theme-text-muted shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase">
                                  Persistent
                                </span>
                              )}
                            </span>
                            <span className="text-theme-text-secondary mt-0.5 line-clamp-2 block text-[13px] whitespace-pre-line">
                              {entry.body}
                            </span>
                            <span className="text-theme-text-muted mt-1 block text-xs">{entry.meta}</span>
                          </>
                        );
                        return (
                          <li
                            key={entry.key}
                            className="border-theme-surface-hover flex items-start gap-2 border-t px-4 py-3 first:border-t-0"
                          >
                            {/* The row and its Clear control are siblings, not
                              nested buttons: a <button> inside a <button> is
                              invalid HTML, and the browser closes the outer
                              element early, handing assistive technology a
                              broken tree. For the same reason, message rows —
                              whose bodies go through LinkifiedText and can
                              contain <a> elements — render as div[role=button]
                              rather than <button>: an anchor inside a button is
                              equally invalid and split apart by the parser.
                              LinkifiedText stops click propagation on its
                              anchors, so following a link doesn't also fire the
                              row's navigation to the message. */}
                            {msg ? (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={entry.onClick}
                                onKeyDown={(e) => {
                                  // Only the row itself activates the row. A
                                  // linkified body can hold focusable anchors,
                                  // and Enter on one bubbles here — without this
                                  // guard the row would swallow the keypress and
                                  // navigate to the message instead of opening
                                  // the link (the anchor's guard covers clicks
                                  // only).
                                  if (e.target !== e.currentTarget) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    entry.onClick();
                                  }
                                }}
                                className={rowClass}
                              >
                                {rowInner}
                              </div>
                            ) : (
                              <button onClick={entry.onClick} className={rowClass}>
                                {rowInner}
                              </button>
                            )}
                            {msg?.is_persistent && canManageMessages && (
                              <button
                                onClick={() => void clearPersistentMessage(msg.id)}
                                className="text-theme-text-muted -mr-1 shrink-0 rounded p-2 transition-colors hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
                                title="Clear persistent message"
                                aria-label={`Clear persistent message: ${entry.title}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                <div className="border-theme-surface-border bg-theme-surface-secondary border-t px-4 py-2">
                  <button
                    onClick={() => void navigate('/notifications?tab=inbox')}
                    className="text-theme-accent-red inline-flex min-h-11 items-center gap-1 py-1 text-[13px] font-semibold"
                  >
                    Older Items
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </section>

              {/* Training progress */}
              {!loadingTraining && (trainingError || enrollments.length > 0) && (
                <section className="card p-4" aria-labelledby="training-progress-heading">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 id="training-progress-heading" className="text-theme-text-primary text-[15px] font-bold">
                      My Training
                    </h3>
                    <button
                      onClick={() => void navigate('/training/my-training')}
                      className="text-theme-accent-red inline-flex min-h-11 items-center gap-1 py-1 text-[13px] font-semibold"
                    >
                      View All
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  {trainingError && (
                    <SectionError
                      message="Training progress could not be verified."
                      source="training"
                      busy={allBusy('training')}
                      onRetry={() => void runRetry('training', () => loadTrainingProgress(true))}
                    />
                  )}

                  {enrollments.length > 0 && (
                    <div className="flex flex-col gap-4">
                      {enrollments.slice(0, PROGRAMS_SHOWN).map((enrollment) => {
                        const progress = progressDetails.get(enrollment.id);
                        // Guard the array itself, not just `progress`: an
                        // enrollment whose payload omits requirement_progress
                        // would otherwise throw inside render and take the
                        // whole dashboard down to the ErrorBoundary.
                        const nextStep = progress?.requirement_progress?.find(
                          (rp) => rp.status === 'not_started' || rp.status === 'in_progress'
                        );
                        const target = nextStep ? requirementTarget(nextStep) : null;
                        const daysLeft = progress?.time_remaining_days;
                        const pct = Math.round(enrollment.progress_percentage);

                        return (
                          <button
                            key={enrollment.id}
                            onClick={() => void navigate(`/training/my-progress/${enrollment.id}`)}
                            className="w-full text-left"
                            aria-label={`${enrollment.program?.name || 'Program'}: ${pct}% complete`}
                          >
                            <div className="mb-2 flex items-baseline justify-between gap-2">
                              <span className="text-theme-text-primary min-w-0 truncate text-sm font-bold">
                                {enrollment.program?.name || 'Program'}
                              </span>
                              <span className="text-theme-text-primary shrink-0 text-lg font-bold tabular-nums">
                                {pct}%
                              </span>
                            </div>
                            <div
                              className="bg-theme-surface-hover mb-2 h-2.5 w-full overflow-hidden rounded-full"
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${enrollment.program?.name ?? 'Program'} progress`}
                            >
                              <div
                                className={`h-2.5 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                                style={{ width: `${enrollment.progress_percentage}%` }}
                              />
                            </div>
                            <p className="text-theme-text-secondary text-[13px] leading-relaxed">
                              {/* Three states, not two. No `progress` entry means the
                                  detail request rejected and never loaded -- saying
                                  "All requirements in progress" there is an
                                  affirmative claim about this program that nothing
                                  supports, and the section warning above does not
                                  make it true. That sentence is reserved for a
                                  payload that actually arrived and had no next step. */}
                              {!progress ? (
                                'Progress unavailable.'
                              ) : nextStep ? (
                                <>
                                  Next requirement: {nextStep.requirement?.name || 'Requirement'}
                                  {target ? ` (${target})` : ''}.
                                </>
                              ) : (
                                'All requirements in progress.'
                              )}
                              {daysLeft !== null && daysLeft !== undefined && (
                                <>
                                  {' '}
                                  <span className={daysLeft < 30 ? 'font-bold text-red-700 dark:text-red-400' : ''}>
                                    {daysLeft} days
                                  </span>{' '}
                                  to complete.
                                </>
                              )}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {enrollments.length > PROGRAMS_SHOWN && (
                    <p className="text-theme-text-muted mt-3 text-xs">
                      {enrollments.length - PROGRAMS_SHOWN} more program
                      {enrollments.length - PROGRAMS_SHOWN === 1 ? '' : 's'}
                    </p>
                  )}
                </section>
              )}

              <div className="flex flex-col gap-2">
                <DashboardHoursCard
                  monthLabel={monthLabel}
                  segments={hoursSegments}
                  loading={loadingHours}
                  totalUnverified={hoursError}
                />
                {hoursError && !loadingHours && (
                  <div className="card">
                    <SectionError
                      message="Hours could not be fully verified."
                      source="hours"
                      busy={allBusy('hours')}
                      onRetry={() => void runRetry('hours', () => loadHours(true))}
                    />
                  </div>
                )}
              </div>

              {/* Issued gear — compact in the rail; the full picture is in Organization */}
              {!loadingMyEquipment && (equipmentError || myEquipment.assigned > 0 || myEquipment.checkedOut > 0) && (
                <section className="card p-4" aria-labelledby="my-equipment-heading">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 id="my-equipment-heading" className="text-theme-text-primary text-[15px] font-bold">
                      My Issued Gear
                    </h3>
                    <button
                      onClick={() => void navigate('/inventory/my-equipment')}
                      className="text-theme-accent-red inline-flex min-h-11 items-center gap-1 py-1 text-[13px] font-semibold"
                    >
                      View All
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {equipmentError && (
                    <SectionError
                      message="Issued gear could not be verified."
                      source="issued gear"
                      busy={allBusy('equipment')}
                      onRetry={() => void runRetry('equipment', () => loadMyEquipment(true))}
                    />
                  )}
                  {!equipmentError && (
                    <dl className="flex flex-col gap-1.5 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-theme-text-secondary">Assigned items</dt>
                        <dd className="text-theme-text-primary font-bold tabular-nums">{myEquipment.assigned}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-theme-text-secondary">Checked out</dt>
                        <dd className="text-theme-text-primary font-bold tabular-nums">{myEquipment.checkedOut}</dd>
                      </div>
                      {myEquipment.overdue > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-theme-text-secondary">Overdue</dt>
                          <dd className="font-bold text-red-700 tabular-nums dark:text-red-400">
                            {myEquipment.overdue}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                </section>
              )}
            </div>
          </div>
        ) : (
          /* ── Organization: department-wide reporting, admins only ── */
          <div
            id="dashboard-panel-department"
            role="tabpanel"
            aria-labelledby="dashboard-tab-department"
            className="flex flex-col gap-6"
          >
            {/* A plain div here left the stat row butted against the operations
                cards with no gap at all; the heading's own mb-4 was the only
                spacing in the block. */}
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
                  <Shield className="h-5 w-5 text-red-500" aria-hidden="true" />
                  My Department
                </h3>
                <p className="text-theme-text-muted mt-1 text-sm">
                  Department-wide staffing, compliance, events, action items, and operations.
                </p>
              </div>
              {operations && <ChiefOperationsDashboard data={operations} />}
              {canViewLegacyAdmin &&
                (adminError ? (
                  <div className="card border-red-500/30 p-5" role="alert">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-theme-text-primary font-semibold">Department summary is unavailable</p>
                        <p className="text-theme-text-muted mt-1 text-sm">
                          We could not load the department-wide metrics. Your personal dashboard is unaffected.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadAdminSummary()}
                        className="btn-primary min-h-[44px] px-4"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5"
                    role="region"
                    aria-label="Department overview"
                  >
                    <DashboardStatCard
                      label="Active Members"
                      value={adminSummary?.active_members ?? 0}
                      icon={Users}
                      iconColor="text-blue-700 dark:text-blue-400"
                      description={`${adminSummary?.total_members ?? 0} total`}
                      loading={loadingAdmin}
                    />

                    {/*
                      Null, not 0, is what says "this department does not run
                      Training" — a genuine 0% still gets its card. Kept
                      mounted while loading so the skeleton row does not
                      reflow once the summary lands.
                    */}
                    {(loadingAdmin || adminSummary?.training_completion_pct != null) && (
                      <DashboardStatCard
                        label="Training Compliance"
                        value={`${adminSummary?.training_completion_pct ?? 0}%`}
                        icon={GraduationCap}
                        iconColor="text-green-700 dark:text-green-400"
                        description={`${formatHours(adminSummary?.recent_training_hours)} hrs last 30 days`}
                        loading={loadingAdmin}
                      />
                    )}

                    <DashboardStatCard
                      label="Upcoming Events"
                      value={adminSummary?.upcoming_events_count ?? 0}
                      icon={Calendar}
                      iconColor="text-purple-700 dark:text-purple-400"
                      description="Next 30 days"
                      loading={loadingAdmin}
                    />

                    {(loadingAdmin || adminSummary?.open_action_items != null) && (
                      <DashboardStatCard
                        label="Action Items"
                        value={adminSummary?.open_action_items ?? 0}
                        icon={(adminSummary?.overdue_action_items ?? 0) > 0 ? AlertTriangle : ClipboardList}
                        iconColor={
                          (adminSummary?.overdue_action_items ?? 0) > 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-yellow-700 dark:text-yellow-400'
                        }
                        description={
                          (adminSummary?.overdue_action_items ?? 0) > 0
                            ? `${adminSummary?.overdue_action_items} overdue`
                            : 'All on track'
                        }
                        loading={loadingAdmin}
                        onClick={() => void navigate('/action-items')}
                        ariaLabel={`Action Items: ${adminSummary?.open_action_items ?? 0} open${(adminSummary?.overdue_action_items ?? 0) > 0 ? `, ${adminSummary?.overdue_action_items} overdue` : ''}`}
                      />
                    )}

                    <DashboardStatCard
                      label="Admin Hours"
                      value={formatHours(adminSummary?.recent_admin_hours)}
                      icon={ClipboardCheck}
                      iconColor="text-indigo-700 dark:text-indigo-400"
                      description={
                        (adminSummary?.pending_admin_hours_approvals ?? 0) > 0
                          ? `${adminSummary?.pending_admin_hours_approvals} pending approval`
                          : 'Last 30 days'
                      }
                      loading={loadingAdmin}
                      {...(canManageAdminHours ? { onClick: () => void navigate('/admin-hours/manage') } : {})}
                      ariaLabel={`Admin Hours: ${formatHours(adminSummary?.recent_admin_hours)}${(adminSummary?.pending_admin_hours_approvals ?? 0) > 0 ? `, ${adminSummary?.pending_admin_hours_approvals} pending approval` : ''}`}
                    />
                  </div>
                ))}
            </div>

            {/*
              The widget summary comes from /api/v1/scheduling, which the
              module gate refuses outright when Scheduling is off — so
              without this the department tab renders a card that can only
              fail. The permission says who may see the crew figures; the
              module flag says whether this department schedules here at all.
            */}
            {canViewScheduling && isModuleOn('scheduling') && <SchedulingWidgets timezone={tz} />}

            {canViewOrganization && setupProgress && (
              <OrganizationSetupWidget
                completed={setupProgress.completed}
                total={setupProgress.total}
                onOpen={() => void navigate('/setup')}
              />
            )}

            <AssetWidgetRegistry widgets={assetWidgets} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
