import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import DashboardStatCard from '../components/dashboard/DashboardStatCard';
import DashboardNeedsYou from '../components/dashboard/DashboardNeedsYou';
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
  Clock,
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
import { adminHoursEntryService } from '../modules/admin-hours/services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { getProgressBarColor, getEventTypeLabel, getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { requirementTarget } from '../utils/pipelineProgress';
import { useTimezone } from '../hooks/useTimezone';
import {
  addCalendarDays,
  formatCalendarDate,
  formatDate,
  formatDateCustom,
  formatTime,
  formatTimeOfDay,
  getTodayLocalDate,
  toLocalDateString,
  toLocalISODate,
} from '../utils/dateFormatting';
import { useAuthStore } from '../stores/authStore';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { ProgramEnrollment, MemberProgramProgress } from '../types/training';
import type { NotificationLogRecord } from '../services/api';
import type { ShiftRecord } from '../modules/scheduling/services/api';
import type { EventListItem } from '../types/event';
import { dashboardService } from '../services/api';
import { POSITION_LABELS } from '../constants/enums';
import { useNotificationCountStore } from '../hooks/useNotificationCount';

/**
 * Main Dashboard Component — "station board"
 *
 * Two answers, in this order: what needs me, and what am I doing this week.
 * Everything the member is on the hook for collects in one "Needs you" panel;
 * shifts, open slots and events merge into one seven-day list rather than
 * three parallel ones. Organization-wide reporting lives behind the
 * Organization tab so
 * it does not outrank a member's own work.
 */
const INSTALL_BANNER_DISMISSED_KEY = 'installBannerDismissed';

/** Days the "Next 7 Days" list covers, counting today as day one. */
const TIMELINE_DAYS = 7;

/** Rows the seven-day list renders before deferring to the full schedule. */
const TIMELINE_ROWS_SHOWN = 6;

/**
 * Rows the seven-day list shows on a phone before collapsing the rest onto one
 * tap-through line. Six rows of shift detail push the three quick actions —
 * which sit below the week on a phone, in the thumb's reach — off the first
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

const TIMELINE_ACCENT: Record<TimelineKind, string> = {
  'my-shift': 'bg-theme-accent-blue',
  'open-shift': 'bg-theme-accent-green',
  event: 'bg-theme-accent-purple',
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
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
  const canViewLegacyAdmin = checkPermission('settings.manage');
  const canViewAssets = ['inventory.view', 'apparatus.view', 'facilities.view'].some(checkPermission);
  const canViewChiefOperations = canViewChiefDashboard(checkPermission);
  const canViewOrganization = canViewLegacyAdmin || canViewChiefOperations || canViewAssets;
  const canManageMessages = canViewOrganization || checkPermission('notifications.manage');
  const canManageAdminHours = checkPermission('admin_hours.manage');
  const canViewScheduling = checkPermission('scheduling.view');
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

  // Shifts (user's own upcoming shifts)
  const [myShifts, setMyShifts] = useState<ShiftRecord[]>([]);
  const [loadingMyShifts, setLoadingMyShifts] = useState(true);

  // Open shifts (available to sign up for)
  const [openShifts, setOpenShifts] = useState<ShiftRecord[]>([]);
  const [loadingOpenShifts, setLoadingOpenShifts] = useState(true);
  const [signingUpShiftId, setSigningUpShiftId] = useState<string | null>(null);
  const [signupExpandedId, setSignupExpandedId] = useState<string | null>(null);
  const [dashboardSignupPosition, setDashboardSignupPosition] = useState('firefighter');
  const [dashboardEligiblePositions, setDashboardEligiblePositions] = useState<string[]>([]);
  const [loadingEligibility, setLoadingEligibility] = useState(false);

  // Hours
  const [hours, setHours] = useState({
    training: 0,
    standby: 0,
    administrative: 0,
  });
  const [loadingHours, setLoadingHours] = useState(true);

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
  const [deptMsgUnread, setDeptMsgUnread] = useState(0);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  // Training
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  // Inventory
  const [myEquipment, setMyEquipment] = useState({ assigned: 0, checkedOut: 0, overdue: 0 });
  const [loadingMyEquipment, setLoadingMyEquipment] = useState(true);

  // Upcoming events
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [loadingUpcomingEvents, setLoadingUpcomingEvents] = useState(true);

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

  // Organization reporting is a separate view rather than a taller page, and the
  // selection is mirrored into ?tab= so a chief can bookmark it.
  // Continue accepting the former `overview` URL so existing bookmarks land on
  // the renamed view, while all new navigation writes the clearer URL.
  const organizationTabRequested = ['organization', 'overview'].includes(searchParams.get('tab') ?? '');
  const activeTab = canViewOrganization && organizationTabRequested ? 'organization' : 'department';
  const selectTab = (tab: 'department' | 'organization') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'organization') next.set('tab', 'organization');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextTab: 'department' | 'organization' | null = null;
    if (event.key === 'Home') nextTab = 'department';
    else if (event.key === 'End') nextTab = 'organization';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextTab = activeTab === 'department' ? 'organization' : 'department';
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

    void loadNotifications();
    void loadMyShifts();
    void loadOpenShifts();
    void loadDeptMessages();
    void loadHours();
    void loadMySeats();
    void loadMyScreenings();
    void loadTrainingProgress();
    void loadMyEquipment();
    void loadUpcomingEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Do not fetch department-wide reporting merely because a leader opened the
  // dashboard. The personal view is the default; organization data is loaded
  // only after that leader intentionally opens the Organization tab.
  useEffect(() => {
    if (activeTab === 'organization') {
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

  const loadMyEquipment = async () => {
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
    } catch {
      // Personal equipment is non-critical on the dashboard.
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

  const loadUpcomingEvents = async () => {
    try {
      const data = await eventService.getEvents({
        end_after: new Date().toISOString(),
        limit: 5,
      });
      // Sort by start date ascending and take first 5
      const sorted = data
        .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
        .slice(0, 5);
      setUpcomingEvents(sorted);
    } catch {
      // Upcoming events are non-critical
    } finally {
      setLoadingUpcomingEvents(false);
    }
  };

  const loadNotifications = async () => {
    try {
      // The unread count is maintained by useNotificationPoller (mounted
      // in AppLayout), so we only need to fetch the notification list here.
      const data = await notificationsService.getMyNotifications({
        include_read: false,
        limit: 10,
      });
      setNotifications(data.logs || []);
    } catch {
      // Notifications are non-critical
    } finally {
      setLoadingNotifications(false);
    }
  };

  const loadDeptMessages = async () => {
    try {
      // include_read: false keeps the load to what still needs attention —
      // resolved messages drop off on the next load, and already-read messages
      // can't page a persistent standing notice out of the 10-item window
      // (the backend exempts persistent messages from this filter, so they
      // stay until an admin clears them). Full history lives on /messages.
      //
      // The badge uses the dedicated unread-count endpoint (which counts across
      // ALL messages and treats ack-required messages as pending until
      // acknowledged) rather than the length of this capped 10-item preview.
      const [data, unread] = await Promise.all([
        messagesService.getInbox({ include_read: false, limit: 10 }),
        messagesService.getUnreadCount(),
      ]);
      setDeptMessages(data);
      setDeptMsgUnread(unread.unread_count);
    } catch {
      // Messages are non-critical
    } finally {
      setLoadingMessages(false);
    }
  };

  const markMessageRead = async (msgId: string) => {
    try {
      await messagesService.markAsRead(msgId);
      // Deliberately marked in place rather than removed: yanking the row the
      // member just clicked would pull the text out from under them. The
      // include_read: false load drops it on the next dashboard visit.
      // A message that requires acknowledgment stays "pending" until it is
      // acknowledged, so reading it must not drop the unread count.
      const msg = deptMessages.find((m) => m.id === msgId);
      setDeptMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_read: true } : m)));
      if (msg && !msg.requires_acknowledgment) {
        setDeptMsgUnread((prev) => Math.max(0, prev - 1));
      }
    } catch {
      toast.error('Failed to mark message as read');
    }
  };

  const acknowledgeMessage = async (msgId: string) => {
    setAcknowledgingId(msgId);
    try {
      await messagesService.acknowledge(msgId);
      setDeptMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_read: true, is_acknowledged: true } : m)));
      setDeptMsgUnread((prev) => Math.max(0, prev - 1));
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
      toast.success('Persistent message cleared');
    } catch {
      toast.error('Failed to clear message');
    }
  };

  const loadMyShifts = async () => {
    try {
      const today = getTodayLocalDate(tz);
      const nextMonth = toLocalDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), tz);
      const data = await schedulingService.getMyShifts({
        start_date: today,
        end_date: nextMonth,
        limit: 5,
      });
      setMyShifts(data.shifts || []);
    } catch {
      // Shifts are non-critical
    } finally {
      setLoadingMyShifts(false);
    }
  };

  const loadOpenShifts = async () => {
    try {
      const today = getTodayLocalDate(tz);
      const nextMonth = toLocalDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), tz);
      const data = await schedulingService.getOpenShifts({
        start_date: today,
        end_date: nextMonth,
      });
      setOpenShifts(data);
    } catch {
      // Open shifts are non-critical
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
    setSigningUpShiftId(shiftId);
    try {
      await schedulingService.signupForShift(shiftId, { position: dashboardSignupPosition });
      toast.success('Signed up for shift');
      setSignupExpandedId(null);
      // Refresh both lists: the signed-up shift moves from open to my shifts
      void loadMyShifts();
      void loadOpenShifts();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to sign up for shift'));
    } finally {
      setSigningUpShiftId(null);
    }
  };

  const loadMySeats = async () => {
    try {
      // No shift id: the positions the member may hold in general, not the
      // ones open on a particular shift.
      const data = await schedulingService.getEligiblePositions();
      // A member the department excludes from shift signup has no seats to
      // report, and "no seats" is not a readiness finding about them — the
      // verdict simply says nothing on the subject.
      setMySeats(data.is_excluded ? [] : data.positions);
    } catch {
      // Seat eligibility is non-critical; the verdict falls back to
      // certifications alone and says so.
    }
  };

  const loadMyScreenings = async () => {
    try {
      setMyScreenings(await medicalScreeningService.getMyCompliance());
    } catch {
      // Clear rather than keep the last good answer. A pull-to-refresh that
      // fails would otherwise leave stale counts on screen while the scope note
      // still claims screenings were checked — and a member who has since gone
      // overdue would keep reading "Clear to respond".
      setMyScreenings(null);
    }
  };

  const loadHours = async () => {
    try {
      // Month-to-date in the organization's timezone, not UTC — near midnight
      // a UTC-derived date lands in the wrong month for half the country.
      const today = getTodayLocalDate(tz);
      const monthStart = `${today.slice(0, 7)}-01`;
      const monthEnd = today;

      const [schedulingSummary, trainingSummary, adminHoursSummary] = await Promise.all([
        schedulingService.getSummary().catch((err) => {
          console.error('Failed to load scheduling summary:', err);
          return null;
        }),
        trainingModuleConfigService.getMyTraining().catch((err) => {
          console.error('Failed to load training summary:', err);
          return null;
        }),
        adminHoursEntryService.getSummary({ startDate: monthStart, endDate: monthEnd }).catch((err) => {
          console.error('Failed to load admin hours summary:', err);
          return null;
        }),
      ]);
      // All three are month-to-date, because the card says "My Hours, August"
      // and the total adds them together. Training and administrative hours
      // were previously lifetime figures — so the headline total summed two
      // lifetime numbers with one monthly one and meant nothing.
      setHours({
        training: trainingSummary?.hours_summary?.hours_this_month ?? 0,
        standby: schedulingSummary?.hours_worked_this_month || 0,
        administrative: adminHoursSummary?.totalHours ?? 0,
      });
      setMyCerts(trainingSummary?.certifications ?? []);
    } catch {
      // Hours are non-critical
    } finally {
      setLoadingHours(false);
    }
  };

  const loadTrainingProgress = async () => {
    try {
      const data = await trainingProgramService.getMyEnrollments('active');
      setEnrollments(data);

      const top3 = data.slice(0, 3);
      const results = await Promise.allSettled(top3.map((e) => trainingProgramService.getEnrollmentProgress(e.id)));
      const details = new Map<string, MemberProgramProgress>();
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const item = top3[i];
          if (item) details.set(item.id, result.value);
        }
      });
      setProgressDetails(details);
    } catch {
      // Training is non-critical on dashboard
    } finally {
      setLoadingTraining(false);
    }
  };

  const markNotificationRead = async (logId: string) => {
    try {
      await notificationsService.markMyNotificationRead(logId);
      setNotifications((prev) => prev.filter((n) => n.id !== logId));
      decrementUnread();
    } catch {
      toast.error('Failed to mark notification as read');
    }
  };

  const totalHours = hours.training + hours.standby + hours.administrative;
  const monthLabel = formatDateCustom(new Date(), { month: 'long' }, tz);

  // ── The seven-day list ────────────────────────────────────────────────────
  // My shifts, open slots and events are one question — "what am I doing this
  // week" — so they merge into one date-ordered list rather than three panels
  // the reader has to interleave by hand.
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
  // Counted from the whole week rather than the six rows the list renders: the
  // footer that discloses entries past the desktop cap is itself held back
  // while collapsed, so this line is the only thing left saying they exist.
  const timelineHiddenOnMobile = timelineCollapsedOnMobile ? timeline.slice(TIMELINE_ROWS_SHOWN_MOBILE) : [];
  const firstHiddenTimelineRow = timelineHiddenOnMobile[0];
  const laterOpenShifts = availableOpenShifts.filter((s) => s.shift_date > windowEnd).length;
  const shortStaffedOpenShifts = availableOpenShifts.filter(
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
          void navigate('/messages');
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

    return entries.sort((a, b) => b.sortAt - a.sortAt);
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

  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      loadNotifications(),
      loadMyShifts(),
      loadOpenShifts(),
      loadDeptMessages(),
      loadHours(),
      loadMySeats(),
      loadMyScreenings(),
      loadTrainingProgress(),
      loadMyEquipment(),
      loadUpcomingEvents(),
      ...(activeTab === 'organization' && canViewLegacyAdmin ? [loadAdminSummary(), loadSetupProgress()] : []),
      ...(activeTab === 'organization' && canViewChiefOperations ? [loadOperations()] : []),
      ...(activeTab === 'organization' && canViewAssets ? [loadAssetWidgets()] : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canViewAssets, canViewChiefOperations, canViewLegacyAdmin]);

  useRegisterPullToRefresh(refreshDashboard);

  const firstName = currentUser?.first_name?.trim();
  const greeting = firstName ? `Hi, ${firstName}` : `Welcome to ${departmentName}`;

  const renderTimelineRow = (entry: TimelineEntry, index: number) => {
    const shift = entry.shift;
    const evt = entry.event;
    const expanded = shift != null && signupExpandedId === shift.id;
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

          {entry.kind === 'open-shift' && shift && !expanded && (
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
            ) : (
              <button
                type="button"
                onClick={() => void navigate(`/events/${evt.id}`)}
                className="btn-secondary btn-auto inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold"
              >
                {evt.requires_rsvp ? 'RSVP' : 'Open'}
              </button>
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
                      {POSITION_LABELS[pos] ?? pos}
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
        {/* Header — who, when, and the one number a member checks daily */}
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
                    { id: 'department', label: 'My Department' },
                    { id: 'organization', label: 'Organization' },
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
            <span className="border-theme-surface-border bg-theme-surface text-theme-text-secondary inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px]">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                <span className="text-theme-text-primary font-bold tabular-nums">{totalHours}</span> hrs in {monthLabel}
              </span>
            </span>
          </div>
        </div>

        {activeTab === 'department' ? (
          <div
            id="dashboard-panel-department"
            role={canViewOrganization ? 'tabpanel' : undefined}
            aria-labelledby={canViewOrganization ? 'dashboard-tab-department' : undefined}
            className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6"
          >
            {/* ── Main column ── */}
            <div className="flex min-w-0 flex-col gap-5">
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
                      <span className="font-bold tabular-nums">{availableOpenShifts.length}</span> open
                      {shortStaffedOpenShifts > 0 && ` · ${shortStaffedOpenShifts} short-staffed`}
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
              <section className="card order-2 overflow-hidden" aria-labelledby="next-seven-days-heading">
                <div className="border-theme-surface-border flex items-center gap-3 border-b px-4 py-3.5 sm:px-5">
                  <Calendar className="text-theme-text-secondary h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  <h3 id="next-seven-days-heading" className="text-theme-text-primary text-base font-bold">
                    Next 7 Days
                  </h3>
                  <span className="text-theme-text-muted ml-auto hidden text-xs lg:inline">
                    Your shifts, drills and open slots in one list
                  </span>
                  <button
                    onClick={() => void navigate('/scheduling')}
                    className="text-theme-accent-red ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 py-2 pl-2 text-sm font-semibold lg:ml-4"
                  >
                    Full Schedule
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
                        {timeline.length === 0
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
                            later this month
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
                  <p className="text-theme-text-muted px-4 py-6 text-center text-sm">Nothing new</p>
                ) : (
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
                              row's navigation to /messages. */}
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
                                // navigate to /messages instead of opening the
                                // link (the anchor's guard covers clicks only).
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
              {!loadingTraining && enrollments.length > 0 && (
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
                            {nextStep ? (
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

                  {enrollments.length > PROGRAMS_SHOWN && (
                    <p className="text-theme-text-muted mt-3 text-xs">
                      {enrollments.length - PROGRAMS_SHOWN} more program
                      {enrollments.length - PROGRAMS_SHOWN === 1 ? '' : 's'}
                    </p>
                  )}
                </section>
              )}

              <DashboardHoursCard monthLabel={monthLabel} segments={hoursSegments} loading={loadingHours} />

              {/* Issued gear — compact in the rail; the full picture is in Organization */}
              {!loadingMyEquipment && (myEquipment.assigned > 0 || myEquipment.checkedOut > 0) && (
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
                        <dd className="font-bold text-red-700 tabular-nums dark:text-red-400">{myEquipment.overdue}</dd>
                      </div>
                    )}
                  </dl>
                </section>
              )}
            </div>
          </div>
        ) : (
          /* ── Organization: department-wide reporting, admins only ── */
          <div
            id="dashboard-panel-organization"
            role="tabpanel"
            aria-labelledby="dashboard-tab-organization"
            className="flex flex-col gap-6"
          >
            <div>
              <div className="mb-4">
                <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
                  <Shield className="h-5 w-5 text-red-500" aria-hidden="true" />
                  Organization
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
                        <p className="text-theme-text-primary font-semibold">Organization summary is unavailable</p>
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

                    <DashboardStatCard
                      label="Training Compliance"
                      value={`${adminSummary?.training_completion_pct ?? 0}%`}
                      icon={GraduationCap}
                      iconColor="text-green-700 dark:text-green-400"
                      description={`${adminSummary?.recent_training_hours ?? 0} hrs last 30 days`}
                      loading={loadingAdmin}
                    />

                    <DashboardStatCard
                      label="Upcoming Events"
                      value={adminSummary?.upcoming_events_count ?? 0}
                      icon={Calendar}
                      iconColor="text-purple-700 dark:text-purple-400"
                      description="Next 30 days"
                      loading={loadingAdmin}
                    />

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

                    <DashboardStatCard
                      label="Admin Hours"
                      value={adminSummary?.recent_admin_hours ?? 0}
                      icon={ClipboardCheck}
                      iconColor="text-indigo-700 dark:text-indigo-400"
                      description={
                        (adminSummary?.pending_admin_hours_approvals ?? 0) > 0
                          ? `${adminSummary?.pending_admin_hours_approvals} pending approval`
                          : 'Last 30 days'
                      }
                      loading={loadingAdmin}
                      {...(canManageAdminHours ? { onClick: () => void navigate('/admin-hours/manage') } : {})}
                      ariaLabel={`Admin Hours: ${adminSummary?.recent_admin_hours ?? 0}${(adminSummary?.pending_admin_hours_approvals ?? 0) > 0 ? `, ${adminSummary?.pending_admin_hours_approvals} pending approval` : ''}`}
                    />
                  </div>
                ))}
            </div>

            {canViewScheduling && <SchedulingWidgets timezone={tz} />}

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
