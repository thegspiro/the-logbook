import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import DashboardStatCard from '../components/dashboard/DashboardStatCard';
import DashboardCardHeader from '../components/dashboard/DashboardCardHeader';
import { LinkifiedText } from '../components/ux';
import {
  Bell,
  Calendar,
  CalendarPlus,
  Clock,
  GraduationCap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  BookOpen,
  Briefcase,
  Shield,
  Users,
  ClipboardList,
  ClipboardCheck,
  Activity,
  Megaphone,
  Pin,
  Eye,
  Rocket,
  Package,
  Smartphone,
  Share,
  UserPlus,
  Loader2,
  CreditCard,
  X,
  CheckCheck,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  trainingProgramService,
  trainingModuleConfigService,
  notificationsService,
  messagesService,
  organizationService,
  inventoryService,
  eventService,
} from '../services/api';
import type { AdminSummary, InboxMessage, InventorySummary, LowStockAlert } from '../services/api';
import { schedulingService } from '../modules/scheduling/services/api';
import { adminHoursEntryService } from '../modules/admin-hours/services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { getProgressBarColor, getEventTypeLabel, getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { requirementTarget, requirementAction } from '../utils/pipelineProgress';
import { useTimezone } from '../hooks/useTimezone';
import {
  formatDate,
  formatDateCustom,
  formatNumber,
  formatTime,
  formatShortDateTime,
  getTodayLocalDate,
  toLocalDateString,
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
 * Main Dashboard Component
 *
 * Member-focused landing page showing notifications, upcoming shifts,
 * training progress, and recorded hours.
 */
const INSTALL_BANNER_DISMISSED_KEY = 'installBannerDismissed';

/** How many open shifts the dashboard panel lists before deferring to the
 *  schedule. Matches the 5 that My Upcoming Shifts asks the API for, so the
 *  two panels beside each other are the same height. */
const OPEN_SHIFTS_SHOWN = 5;

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
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

  // Admin summary (only loaded for users with settings.manage)
  const isAdmin = checkPermission('settings.manage');
  const canManageMessages = isAdmin || checkPermission('notifications.manage');
  const isInventoryAdmin = isAdmin || checkPermission('inventory.manage');
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(isAdmin);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationLogRecord[]>([]);
  const unreadCount = useNotificationCountStore((s) => s.unreadCount);
  const decrementUnread = useNotificationCountStore((s) => s.decrement);
  const clearUnread = useNotificationCountStore((s) => s.clear);
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

  // Expiring certifications for the current user (for the cert-expiry banner)
  type MyCert = {
    id: string;
    course_name: string;
    expiration_date: string | null;
    is_expired: boolean;
    days_until_expiry: number | null;
  };
  const [myCerts, setMyCerts] = useState<MyCert[]>([]);

  // Department Messages
  const [deptMessages, setDeptMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [deptMsgUnread, setDeptMsgUnread] = useState(0);

  // Training
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  // Inventory (admin summary)
  const [inventorySummary, setInventorySummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);

  // Upcoming events
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [loadingUpcomingEvents, setLoadingUpcomingEvents] = useState(true);

  // Setup checklist (admin-only)
  const [setupProgress, setSetupProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

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
    if (isAdmin) {
      void loadAdminSummary();
      void loadSetupProgress();
    }
    void loadHours();
    void loadTrainingProgress();
    void loadInventorySummary();
    void loadUpcomingEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const loadAdminSummary = async () => {
    try {
      const data = await dashboardService.getAdminSummary();
      setAdminSummary(data);
    } catch (err) {
      console.error('Failed to load admin summary:', err);
    } finally {
      setLoadingAdmin(false);
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

  const loadInventorySummary = async () => {
    try {
      const [summary, alerts] = await Promise.all([inventoryService.getSummary(), inventoryService.getLowStockItems()]);
      setInventorySummary(summary);
      setLowStockAlerts(alerts);
    } catch {
      // Inventory is non-critical on dashboard
    } finally {
      setLoadingInventory(false);
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
      // The badge uses the dedicated unread-count endpoint (which counts
      // across ALL messages and treats ack-required messages as pending until
      // acknowledged) rather than the length of this capped 10-item preview.
      const [data, unread] = await Promise.all([
        messagesService.getInbox({ limit: 10 }),
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
    try {
      await messagesService.acknowledge(msgId);
      setDeptMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_read: true, is_acknowledged: true } : m)));
      setDeptMsgUnread((prev) => Math.max(0, prev - 1));
      toast.success('Message acknowledged');
    } catch {
      toast.error('Failed to acknowledge message');
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
      // Filter out shifts the user is already signed up for (defense-in-depth;
      // the backend also filters these, but guard against race conditions)
      const myShiftIds = new Set(myShifts.map((s) => s.id));
      setOpenShifts(data.filter((s) => !myShiftIds.has(s.id)));
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
      // All three are month-to-date, because the card above them says "This
      // month" and the total adds them together. Training and administrative
      // hours were previously lifetime figures — so the headline "Total
      // Hours / This month" summed two lifetime numbers with one monthly one
      // and meant nothing.
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

  const markAllNotificationsRead = async () => {
    try {
      await notificationsService.markAllMyNotificationsRead();
      setNotifications([]);
      clearUnread();
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to clear notifications');
    }
  };

  const dismissNotification = (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    void markNotificationRead(logId);
  };

  const formatShiftDate = (dateStr: string) => {
    return formatDateCustom(
      dateStr + 'T00:00:00',
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      },
      tz
    );
  };

  const formatShiftTime = (timeStr?: string) => {
    if (!timeStr) return '';
    return formatTime(timeStr, tz);
  };

  const totalHours = hours.training + hours.standby + hours.administrative;

  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      loadNotifications(),
      loadMyShifts(),
      loadOpenShifts(),
      loadDeptMessages(),
      loadHours(),
      loadTrainingProgress(),
      loadInventorySummary(),
      loadUpcomingEvents(),
      ...(isAdmin ? [loadAdminSummary(), loadSetupProgress()] : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useRegisterPullToRefresh(refreshDashboard);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {loadingNotifications || loadingMyShifts || loadingHours || loadingTraining
          ? 'Loading dashboard content...'
          : 'Dashboard content loaded.'}
      </div>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* "Now" Header — answers: what's next, what needs me, what's expiring */}
        {(() => {
          const firstName = currentUser?.first_name?.trim();
          const greeting = firstName ? `Hi, ${firstName}` : `Welcome to ${departmentName}`;
          const nextEvent = upcomingEvents[0];
          const nextShift = myShifts[0];
          // Pick the soonest of next event / next shift as the "what's next" answer.
          const nextEventStart = nextEvent ? new Date(nextEvent.start_datetime).getTime() : Infinity;
          const nextShiftStart = nextShift
            ? new Date(`${nextShift.shift_date}T${nextShift.start_time || '00:00'}`).getTime()
            : Infinity;
          const showShiftFirst = nextShiftStart < nextEventStart;
          // Cert urgency: expired or expiring within 60 days.
          const urgentCerts = myCerts.filter(
            (c) => c.is_expired || (c.days_until_expiry !== null && c.days_until_expiry <= 60)
          );
          const overdueActionItems = adminSummary?.overdue_action_items ?? 0;
          return (
            <div className="mb-6 sm:mb-8">
              <h2 className="text-theme-text-primary mb-1 text-2xl font-bold sm:text-3xl">{greeting}</h2>
              <p className="text-theme-text-secondary mb-3 text-sm sm:text-base">
                {formatDateCustom(
                  new Date(),
                  {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  },
                  tz
                )}
                {' · '}
                {departmentName}
              </p>
              <div className="flex flex-wrap gap-2 text-xs sm:text-sm" aria-label="At a glance">
                {showShiftFirst && nextShift ? (
                  <button
                    onClick={() => void navigate('/scheduling')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-blue-700 transition-colors hover:bg-blue-500/20 max-md:min-h-[44px] dark:text-blue-300"
                  >
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      Next shift: {formatShiftDate(nextShift.shift_date)} {formatShiftTime(nextShift.start_time)}
                    </span>
                  </button>
                ) : nextEvent ? (
                  <button
                    onClick={() => void navigate(`/events/${nextEvent.id}`)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-blue-700 transition-colors hover:bg-blue-500/20 max-md:min-h-[44px] dark:text-blue-300"
                  >
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      Next: {nextEvent.title} · {formatShortDateTime(nextEvent.start_datetime, tz)}
                    </span>
                  </button>
                ) : (
                  !loadingUpcomingEvents &&
                  !loadingMyShifts && (
                    <span className="bg-theme-surface-secondary border-theme-surface-border text-theme-text-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Nothing scheduled</span>
                    </span>
                  )
                )}
                {urgentCerts.length > 0 && (
                  <button
                    onClick={() => void navigate('/training/my-training')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-red-700 transition-colors hover:bg-red-500/20 max-md:min-h-[44px] dark:text-red-300"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {urgentCerts.length} cert{urgentCerts.length === 1 ? '' : 's'}{' '}
                      {urgentCerts.some((c) => c.is_expired) ? 'expired' : 'expiring'}
                    </span>
                  </button>
                )}
                {unreadCount > 0 && (
                  <button
                    onClick={() => void navigate('/notifications?tab=inbox')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-700 transition-colors hover:bg-amber-500/20 max-md:min-h-[44px] dark:text-amber-300"
                  >
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{unreadCount} unread</span>
                  </button>
                )}
                {overdueActionItems > 0 && (
                  <button
                    onClick={() => void navigate('/action-items')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-red-700 transition-colors hover:bg-red-500/20 max-md:min-h-[44px] dark:text-red-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{overdueActionItems} overdue</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Cert expiry banner — only if the current user has any cert expired or expiring within 60d */}
        {(() => {
          const urgent = myCerts
            .filter((c) => c.is_expired || (c.days_until_expiry !== null && c.days_until_expiry <= 60))
            .sort((a, b) => (a.days_until_expiry ?? -Infinity) - (b.days_until_expiry ?? -Infinity));
          const top = urgent[0];
          if (!top) return null;
          const expiredCount = urgent.filter((c) => c.is_expired).length;
          const subtitle =
            expiredCount > 0
              ? `${expiredCount} expired${urgent.length > expiredCount ? `, ${urgent.length - expiredCount} expiring soon` : ''}`
              : `${urgent.length} expiring within 60 days`;
          return (
            <button
              onClick={() => void navigate('/training/my-training')}
              className="mb-6 flex w-full items-center gap-3 rounded-lg border-l-4 border-red-500 bg-red-500/10 p-4 text-left transition-colors hover:bg-red-500/15 sm:mb-8 sm:gap-4"
              aria-label={`${urgent.length} of your certifications need attention`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/20">
                <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-theme-text-primary text-sm font-semibold">
                  Action needed: {top.course_name}
                  {top.is_expired
                    ? ' is expired'
                    : top.days_until_expiry !== null
                      ? ` expires in ${top.days_until_expiry} days`
                      : ' expires soon'}
                </h3>
                <p className="text-theme-text-muted mt-0.5 text-xs">{subtitle}</p>
              </div>
              <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
            </button>
          );
        })()}

        {/* Fat primary action: Log Training — most-used action, top placement */}
        <button
          onClick={() => void navigate('/training/submit')}
          className="group mb-6 flex w-full items-center gap-4 rounded-xl bg-gradient-to-br from-red-600 to-red-700 p-5 text-left text-white shadow-md transition-all hover:from-red-700 hover:to-red-800 hover:shadow-lg focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-hidden active:from-red-800 active:to-red-900 sm:mb-8 sm:p-6"
          aria-label="Log a training session"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 group-hover:bg-white/20 sm:h-16 sm:w-16">
            <Plus className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg leading-tight font-bold sm:text-xl">Log Training</div>
            <div className="mt-0.5 text-sm text-red-100">Record a drill or session — pick course, hours, done.</div>
          </div>
          <ChevronRight
            className="h-6 w-6 shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>

        {/* PWA Install Banner. Two variants: browsers that fire
            `beforeinstallprompt` get a one-tap Install button; iOS Safari has
            no such event, so it gets Share-sheet instructions instead. */}
        {(canInstall || needsManualInstall) && !dismissedInstall && (
          <div className="mb-6 flex flex-col gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />
              <div>
                <p className="text-theme-text-primary text-sm font-medium">Install The Logbook</p>
                {needsManualInstall ? (
                  <p className="text-theme-text-muted text-xs">
                    Tap the Share button <Share className="-mt-0.5 inline h-3.5 w-3.5" aria-hidden="true" /> in Safari,
                    then choose &ldquo;Add to Home Screen&rdquo;.
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

        {/* Setup Prompt (shown to admins when setup is incomplete) */}
        {isAdmin && setupProgress && setupProgress.completed < setupProgress.total && (
          <button
            onClick={() => void navigate('/setup')}
            className="bg-theme-surface group mb-6 w-full rounded-xl border border-red-500/20 p-4 text-left transition-colors hover:border-red-500/40 sm:mb-8"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                <Rocket className="h-5 w-5 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-theme-text-primary text-sm font-semibold">Complete Department Setup</h3>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  {setupProgress.completed} of {setupProgress.total} steps complete
                </p>
                {/* Progress bar — mobile inline, desktop in separate column */}
                <div
                  className="bg-theme-surface-secondary mt-2 h-2 w-full rounded-full sm:hidden"
                  role="progressbar"
                  aria-valuenow={setupProgress.completed}
                  aria-valuemin={0}
                  aria-valuemax={setupProgress.total}
                  aria-label={`Setup progress: ${setupProgress.completed} of ${setupProgress.total} steps complete`}
                >
                  <div
                    className="h-2 rounded-full bg-red-500 transition-all"
                    style={{
                      width: `${Math.round((setupProgress.completed / setupProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                <div
                  className="bg-theme-surface-secondary h-2 w-24 rounded-full"
                  role="progressbar"
                  aria-valuenow={setupProgress.completed}
                  aria-valuemin={0}
                  aria-valuemax={setupProgress.total}
                  aria-label={`Setup progress: ${setupProgress.completed} of ${setupProgress.total} steps complete`}
                >
                  <div
                    className="h-2 rounded-full bg-red-500 transition-all"
                    style={{
                      width: `${Math.round((setupProgress.completed / setupProgress.total) * 100)}%`,
                    }}
                  />
                </div>
                <ChevronRight className="text-theme-text-muted h-5 w-5 transition-colors group-hover:text-red-500" />
              </div>
            </div>
          </button>
        )}

        {/* Admin Department Summary (visible to Chiefs and admins) */}
        {isAdmin && (
          <div className="mb-8">
            <h3 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5 text-red-500" aria-hidden="true" />
              Department Overview
            </h3>
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
                onClick={() => void navigate('/admin-hours/manage')}
                ariaLabel={`Admin Hours: ${adminSummary?.recent_admin_hours ?? 0}${(adminSummary?.pending_admin_hours_approvals ?? 0) > 0 ? `, ${adminSummary?.pending_admin_hours_approvals} pending approval` : ''}`}
              />
            </div>
          </div>
        )}

        {/* Hours Summary Cards */}
        <div
          className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:gap-4 lg:grid-cols-4"
          role="region"
          aria-label="Hours summary"
        >
          <DashboardStatCard
            label="Total Hours"
            value={totalHours}
            icon={Clock}
            iconColor="text-blue-700 dark:text-blue-400"
            description="This month: training + standby + admin"
            loading={loadingHours}
          />

          <DashboardStatCard
            label="Training"
            value={hours.training}
            icon={BookOpen}
            iconColor="text-green-700 dark:text-green-400"
            description="Completed courses, this month"
            loading={loadingHours}
            valueColor="text-green-700 dark:text-green-400"
          />

          <DashboardStatCard
            label="Standby"
            value={hours.standby}
            icon={Shield}
            iconColor="text-yellow-700 dark:text-yellow-400"
            description="Shifts worked, this month"
            loading={loadingHours}
            valueColor="text-yellow-700 dark:text-yellow-400"
            onClick={() => void navigate('/scheduling?tab=my-shifts&view=past')}
            hoverClass="hover:border-yellow-500/40"
          />

          <DashboardStatCard
            label="Administrative"
            value={hours.administrative}
            icon={Briefcase}
            iconColor="text-purple-700 dark:text-purple-400"
            description="Clocked in, this month"
            loading={loadingHours}
            valueColor="text-purple-700 dark:text-purple-400"
            onClick={() => void navigate('/admin-hours')}
            hoverClass="hover:border-purple-500/40"
          />
        </div>

        {/* Department Messages — always visible, prominent */}
        {!loadingMessages && deptMessages.length > 0 && (
          <div className="mb-8">
            <DashboardCardHeader
              icon={Megaphone}
              iconColor="text-amber-700 dark:text-amber-400"
              title="Department Messages"
              badge={
                deptMsgUnread > 0
                  ? {
                      content: `${deptMsgUnread} new`,
                      ariaLabel: `${deptMsgUnread} new messages`,
                      color: 'bg-amber-500 text-white',
                    }
                  : undefined
              }
            />
            <div className="space-y-3">
              {deptMessages.map((msg) => {
                const priorityStyles = {
                  urgent: 'border-red-500/40 bg-red-500/10',
                  important: 'border-amber-500/30 bg-amber-500/10',
                  normal: 'border-theme-surface-border bg-theme-surface',
                };
                const priorityBadge = {
                  urgent: 'bg-red-500 text-white',
                  important: 'bg-amber-500 text-white',
                  normal: '',
                };
                return (
                  <div
                    key={msg.id}
                    className={`rounded-lg border p-4 transition-colors ${priorityStyles[msg.priority]} ${
                      !msg.is_read ? 'ring-1 ring-amber-400/30' : ''
                    }`}
                    onClick={() => {
                      if (!msg.is_read && !msg.is_persistent) void markMessageRead(msg.id);
                    }}
                    role={!msg.is_read && !msg.is_persistent ? 'button' : undefined}
                    tabIndex={!msg.is_read && !msg.is_persistent ? 0 : undefined}
                    onKeyDown={
                      !msg.is_read && !msg.is_persistent
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') void markMessageRead(msg.id);
                          }
                        : undefined
                    }
                    aria-label={!msg.is_read ? `${msg.title} — unread, ${msg.priority} priority` : undefined}
                  >
                    <div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {msg.is_pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />}
                          <h4 className="text-theme-text-primary truncate text-sm font-semibold">{msg.title}</h4>
                          {msg.priority !== 'normal' && (
                            <span
                              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${priorityBadge[msg.priority]}`}
                            >
                              {msg.priority}
                            </span>
                          )}
                          {msg.is_persistent && (
                            <span className="bg-theme-surface-hover text-theme-text-muted flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase">
                              <Shield className="h-2.5 w-2.5" />
                              Persistent
                            </span>
                          )}
                          {!msg.is_read && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                          )}
                        </div>
                        <p className="text-theme-text-secondary line-clamp-3 text-sm whitespace-pre-line">
                          <LinkifiedText text={msg.body} />
                        </p>
                        <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                          <div className="text-theme-text-muted flex items-center gap-3 text-xs">
                            {msg.author_name && <span>From: {msg.author_name}</span>}
                            {msg.created_at && <span>{formatDate(msg.created_at, tz)}</span>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!msg.is_read && !msg.is_persistent && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void markMessageRead(msg.id);
                                }}
                                className="text-theme-text-muted hover:text-theme-text-primary -m-1 flex items-center gap-1 rounded p-2 text-xs max-md:min-h-[44px]"
                                title="Mark as read"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            )}
                            {msg.is_persistent && canManageMessages && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void clearPersistentMessage(msg.id);
                                }}
                                className="text-theme-text-muted flex items-center gap-1 rounded px-3 py-2 text-xs transition-colors hover:bg-red-500/10 hover:text-red-800 dark:hover:text-red-400"
                                title="Clear persistent message"
                              >
                                <X className="h-3 w-3" />
                                Clear
                              </button>
                            )}
                            {msg.requires_acknowledgment && !msg.is_acknowledged && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void acknowledgeMessage(msg.id);
                                }}
                                className="rounded bg-amber-500 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600"
                              >
                                Acknowledge
                              </button>
                            )}
                            {msg.is_acknowledged && (
                              <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                                <CheckCircle2 className="h-3 w-3" /> Acknowledged
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 sm:mb-8 sm:gap-8 lg:grid-cols-2">
          {/* Notifications */}
          <div className="card p-4 sm:p-6">
            <DashboardCardHeader
              icon={Bell}
              iconColor="text-red-700 dark:text-red-400"
              title="Notifications"
              badge={
                unreadCount > 0
                  ? {
                      content: unreadCount,
                      ariaLabel: `${unreadCount} unread`,
                      color: 'bg-red-500 text-white',
                    }
                  : undefined
              }
              onViewAll={() => void navigate('/notifications?tab=inbox')}
              extraActions={
                unreadCount > 0 ? (
                  <button
                    onClick={() => void markAllNotificationsRead()}
                    className="text-theme-text-muted hover:text-theme-text-primary -mr-1 flex items-center space-x-1 rounded px-2 py-2 text-xs transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span>Clear All</span>
                  </button>
                ) : undefined
              }
            />

            {loadingNotifications ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-theme-surface-hover h-14 animate-pulse rounded-lg"></div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-theme-text-muted py-8 text-center text-sm">No notifications</div>
            ) : (
              <div className="space-y-2">
                {/*
                  The row and its Dismiss control are siblings, not nested
                  buttons. A <button> inside a <button> is invalid HTML: the
                  browser closes the outer element early, so the inner control
                  escapes the row and assistive technology is handed a broken
                  tree.
                */}
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="text-theme-text-primary flex items-start justify-between gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-2.5 transition-colors sm:p-3"
                  >
                    <button
                      onClick={() => {
                        void markNotificationRead(notification.id);
                        if (notification.action_url && notification.action_url.startsWith('/'))
                          void navigate(notification.action_url);
                        else void navigate('/notifications?tab=inbox');
                      }}
                      className="focus:ring-theme-focus-ring min-w-0 flex-1 rounded text-left focus:ring-2 focus:outline-hidden max-md:min-h-[44px]"
                    >
                      <p className="truncate text-sm font-medium">{notification.subject || 'Notification'}</p>
                      <p className="text-theme-text-muted mt-0.5 truncate text-xs">{notification.message || ''}</p>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <span
                        className="text-theme-text-muted text-[11px] whitespace-nowrap sm:text-xs"
                        title={formatDate(notification.sent_at, tz)}
                      >
                        {formatRelativeTime(notification.sent_at)}
                      </span>
                      <button
                        onClick={(e) => dismissNotification(e, notification.id)}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover max-md:mobile-touch-target -mr-1 ml-1 rounded p-2 transition-colors"
                        title="Dismiss"
                        aria-label={`Dismiss notification: ${notification.subject || 'Notification'}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* My Upcoming Shifts */}
          <div className="card p-4 sm:p-6">
            <DashboardCardHeader
              icon={Calendar}
              iconColor="text-blue-700 dark:text-blue-400"
              title="My Upcoming Shifts"
              viewAllLabel="View Schedule"
              onViewAll={() => void navigate('/scheduling')}
            />

            {loadingMyShifts ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-theme-surface-hover h-14 animate-pulse rounded-lg"></div>
                ))}
              </div>
            ) : myShifts.length === 0 ? (
              <div className="text-theme-text-muted py-8 text-center text-sm">No upcoming shifts scheduled</div>
            ) : (
              <div className="space-y-2">
                {myShifts.map((shift) => (
                  <div key={shift.id} className="bg-theme-surface-secondary rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20">
                        <Calendar className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary truncate text-sm font-medium">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {formatShiftTime(shift.start_time)} - {formatShiftTime(shift.end_time)}
                        </p>
                        {shift.shift_officer_name && (
                          <p className="text-theme-text-muted mt-0.5 text-xs sm:hidden">
                            Officer: {shift.shift_officer_name}
                          </p>
                        )}
                      </div>
                      {shift.shift_officer_name && (
                        <span className="text-theme-text-muted hidden shrink-0 text-xs sm:inline">
                          Officer: {shift.shift_officer_name}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Open Shifts */}
        <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
          <DashboardCardHeader
            icon={CalendarPlus}
            iconColor="text-green-700 dark:text-green-400"
            title="Open Shifts"
            viewAllLabel="View Schedule"
            viewAllColor="text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
            onViewAll={() => void navigate('/scheduling')}
          />

          {loadingOpenShifts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-theme-surface-hover h-14 animate-pulse rounded-lg"></div>
              ))}
            </div>
          ) : openShifts.length === 0 ? (
            <div className="text-theme-text-muted py-8 text-center text-sm">No open shifts available</div>
          ) : (
            <div className="space-y-2">
              {/* Capped like every sibling panel — My Upcoming Shifts asks the
                  API for 5, notifications show 8, upcoming events 5. This one
                  rendered a month of open shifts in full, which on a department
                  running two platoons is ~60 rows and turns the dashboard into
                  a single scrolling list with everything else pushed off the
                  bottom. "View Schedule" is the way to see them all. */}
              {openShifts.slice(0, OPEN_SHIFTS_SHOWN).map((shift) => (
                <div key={shift.id} className="bg-theme-surface-secondary rounded-lg p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center space-x-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/20">
                        <CalendarPlus className="h-5 w-5 text-green-700 dark:text-green-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-theme-text-primary truncate text-sm font-medium">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {formatShiftTime(shift.start_time)} - {formatShiftTime(shift.end_time)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end space-x-3">
                      {shift.min_staffing != null && (
                        <span className="text-theme-text-muted text-xs">
                          {shift.attendee_count}/{shift.min_staffing} filled
                        </span>
                      )}
                      {signupExpandedId !== shift.id && (
                        <button
                          onClick={() => void handleExpandSignup(shift.id)}
                          className="btn-success flex items-center space-x-1 px-3 py-2 text-sm font-medium"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>Sign Up</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {signupExpandedId === shift.id && (
                    <div className="border-theme-surface-border mt-2 border-t pt-2">
                      {loadingEligibility ? (
                        <div className="flex items-center justify-center py-2" role="status" aria-live="polite">
                          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
                        </div>
                      ) : dashboardEligiblePositions.length === 0 ? (
                        <div className="flex items-center justify-between py-1">
                          <p className="text-xs text-amber-600 dark:text-amber-400">Not eligible for this shift.</p>
                          <button
                            onClick={() => setSignupExpandedId(null)}
                            className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                          >
                            Close
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select
                            value={dashboardSignupPosition}
                            onChange={(e) => setDashboardSignupPosition(e.target.value)}
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
                </div>
              ))}
              {openShifts.length > OPEN_SHIFTS_SHOWN && (
                <p className="text-theme-text-muted pt-1 text-center text-xs">
                  {openShifts.length - OPEN_SHIFTS_SHOWN} more open shift
                  {openShifts.length - OPEN_SHIFTS_SHOWN === 1 ? '' : 's'} in the next 30 days
                </p>
              )}
            </div>
          )}
        </div>

        {/* Upcoming Events */}
        <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
          <DashboardCardHeader
            icon={Calendar}
            iconColor="text-purple-700 dark:text-purple-400"
            title="Upcoming Events"
            onViewAll={() => void navigate('/events')}
          />

          {loadingUpcomingEvents ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-theme-surface-hover h-14 animate-pulse rounded-lg"></div>
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <div className="text-theme-text-muted py-8 text-center text-sm">No upcoming events</div>
          ) : (
            <div className="space-y-2">
              {upcomingEvents.map((evt) => (
                <button
                  key={evt.id}
                  onClick={() => void navigate(`/events/${evt.id}`)}
                  className="bg-theme-surface-secondary hover:bg-theme-surface-hover w-full rounded-lg p-3 text-left transition-colors"
                >
                  <div className="flex min-w-0 items-center space-x-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                      <Calendar className="h-5 w-5 text-purple-700 dark:text-purple-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-theme-text-primary truncate text-sm font-medium">{evt.title}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          {evt.user_rsvp_status && (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getRSVPStatusColor(evt.user_rsvp_status)}`}
                            >
                              {getRSVPStatusLabel(evt.user_rsvp_status)}
                            </span>
                          )}
                          <ChevronRight className="text-theme-text-muted hidden h-4 w-4 sm:block" />
                        </div>
                      </div>
                      <p className="text-theme-text-muted text-xs">
                        {formatShortDateTime(evt.start_datetime, tz)}
                        {' \u2022 '}
                        {getEventTypeLabel(evt.event_type)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="bg-theme-surface border-theme-surface-border mb-6 rounded-lg border p-4 sm:mb-8 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
              <Activity className="h-5 w-5" aria-hidden="true" />
              Recent Activity
            </h3>
            <button
              onClick={() => void navigate('/notifications?tab=inbox')}
              className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 py-2 pl-2 text-xs max-md:min-h-[44px]"
            >
              View All <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {loadingNotifications ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-theme-surface-hover h-8 animate-pulse rounded-sm"></div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-center text-sm">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {notifications.slice(0, 8).map((notif, idx) => (
                <div key={notif.id ?? idx} className="flex items-start gap-3">
                  <div
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notif.read ? 'bg-theme-text-muted' : 'bg-blue-500'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary truncate text-sm">
                      {notif.subject || notif.message || 'Notification'}
                    </p>
                    <p className="text-theme-text-muted text-xs">
                      {formatRelativeTime(notif.sent_at || notif.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Access: My ID Card */}
        {currentUser?.id && (
          <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
            <DashboardCardHeader
              icon={CreditCard}
              iconColor="text-blue-500"
              title="My ID Card"
              viewAllLabel="View"
              viewAllColor="text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              onViewAll={() => void navigate(`/members/${currentUser.id}/id-card`)}
              className="flex items-center justify-between"
            />
            <p className="text-theme-text-muted mt-2 text-sm">
              Show your digital member ID card with QR code and barcode for quick identification.
            </p>
            <button
              onClick={() => void navigate(`/members/${currentUser.id}/id-card`)}
              className="btn-info mt-4 text-sm"
            >
              Open My ID Card
            </button>
          </div>
        )}

        {/* Quick Access: Meeting Minutes */}
        {checkPermission('meetings.manage') && (
          <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
            <DashboardCardHeader
              icon={ClipboardList}
              iconColor="text-cyan-500"
              title="Meeting Minutes"
              viewAllColor="text-cyan-700 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300"
              onViewAll={() => void navigate('/minutes')}
              className="flex items-center justify-between"
            />
            <p className="text-theme-text-muted mt-2 text-sm">
              Record, review, and publish meeting minutes. Track motions, votes, and action items.
            </p>
            <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
              <button
                onClick={() => void navigate('/minutes')}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-center text-sm text-white transition-colors hover:bg-cyan-700"
              >
                Record Minutes
              </button>
              <button
                onClick={() => void navigate('/minutes')}
                className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg border px-4 py-2 text-center text-sm transition-colors"
              >
                Review Pending
              </button>
            </div>
          </div>
        )}

        {/* Training Progress */}
        {!loadingTraining && enrollments.length > 0 && (
          <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
            <DashboardCardHeader
              icon={GraduationCap}
              iconColor="text-red-500"
              title="My Training Progress"
              onViewAll={() => void navigate('/training/my-training')}
            />

            <div className="space-y-3">
              {enrollments.slice(0, 3).map((enrollment) => {
                const progress = progressDetails.get(enrollment.id);
                // Guard the array itself, not just `progress`: an enrollment
                // whose progress payload omits requirement_progress would
                // otherwise throw inside render and take the entire dashboard
                // down to the ErrorBoundary.
                const nextSteps = progress?.requirement_progress
                  ?.filter((rp) => rp.status === 'not_started' || rp.status === 'in_progress')
                  .slice(0, 2);
                const upcomingDeadline =
                  progress?.time_remaining_days !== null &&
                  progress?.time_remaining_days !== undefined &&
                  progress.time_remaining_days < 30;

                return (
                  <button
                    key={enrollment.id}
                    onClick={() => void navigate(`/training/my-progress/${enrollment.id}`)}
                    className="bg-theme-surface-secondary hover:bg-theme-surface-hover w-full cursor-pointer rounded-lg p-4 text-left transition-colors"
                    aria-label={`${enrollment.program?.name || 'Program'}: ${Math.round(enrollment.progress_percentage)}% complete`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h4 className="text-theme-text-primary truncate font-semibold">
                            {enrollment.program?.name || 'Program'}
                          </h4>
                          {upcomingDeadline && (
                            <span className="flex shrink-0 items-center space-x-1 rounded-sm bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                              <AlertTriangle className="h-3 w-3" />
                              <span>Deadline Soon</span>
                            </span>
                          )}
                        </div>
                        {enrollment.program?.description && (
                          <p className="text-theme-text-secondary line-clamp-2 text-sm">
                            {enrollment.program.description}
                          </p>
                        )}
                      </div>
                      <span className="text-theme-text-primary shrink-0 text-2xl font-bold">
                        {Math.round(enrollment.progress_percentage)}%
                      </span>
                    </div>

                    <div
                      className="bg-theme-surface-secondary mb-3 h-2 w-full rounded-full"
                      role="progressbar"
                      aria-valuenow={Math.round(enrollment.progress_percentage)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${enrollment.program?.name ?? 'Program'} progress: ${Math.round(enrollment.progress_percentage)}%`}
                    >
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>

                    {progress && (
                      <div className="space-y-2">
                        {enrollment.status === 'completed' ? (
                          <div className="flex items-center space-x-2 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Program Completed!</span>
                          </div>
                        ) : nextSteps && nextSteps.length > 0 ? (
                          <div>
                            <p className="text-theme-text-secondary mb-1 text-xs">Next Steps:</p>
                            <div className="space-y-1">
                              {nextSteps.map((rp) => {
                                const target = requirementTarget(rp);
                                const action = requirementAction(rp);
                                return (
                                  <div key={rp.id} className="flex items-start space-x-2 text-sm">
                                    <TrendingUp className="mt-1 h-3 w-3 shrink-0 text-blue-700 dark:text-blue-400" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-theme-text-secondary min-w-0 truncate">
                                          {rp.requirement?.name || 'Requirement'}
                                        </span>
                                        {target && (
                                          <span className="text-theme-text-muted shrink-0 tabular-nums">{target}</span>
                                        )}
                                      </div>
                                      {action && <p className="text-theme-text-muted truncate text-xs">{action}</p>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-theme-text-secondary text-sm">All requirements in progress</div>
                        )}

                        {progress.time_remaining_days !== null && progress.time_remaining_days !== undefined && (
                          <div
                            className={`text-xs ${
                              progress.time_remaining_days < 30
                                ? 'text-red-700 dark:text-red-400'
                                : progress.time_remaining_days < 90
                                  ? 'text-yellow-700 dark:text-yellow-400'
                                  : 'text-theme-text-secondary'
                            }`}
                          >
                            {progress.time_remaining_days} days remaining
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {enrollments.length > 3 && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => void navigate('/training/my-training')}
                  className="px-2 py-1 text-sm text-red-700 hover:text-red-800 max-md:min-h-[44px] dark:text-red-400 dark:hover:text-red-300"
                >
                  View {enrollments.length - 3} more program
                  {enrollments.length - 3 !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}
        {/* Inventory Summary Widget */}
        {!loadingInventory && inventorySummary && inventorySummary.total_items > 0 && (
          <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
            <DashboardCardHeader
              icon={Package}
              iconColor="text-emerald-500"
              title={isInventoryAdmin ? 'Equipment & Inventory' : 'My Equipment'}
              viewAllColor="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
              onViewAll={() => void navigate('/inventory')}
            />

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                <p className="text-theme-text-muted text-xs font-medium uppercase">
                  {isInventoryAdmin ? 'Total Items' : 'My Items'}
                </p>
                <p className="text-theme-text-primary mt-1 text-xl font-bold">{inventorySummary.total_items}</p>
              </div>
              <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                <p className="text-theme-text-muted text-xs font-medium uppercase">
                  {isInventoryAdmin ? 'Total Value' : 'My Value'}
                </p>
                <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
                  $
                  {formatNumber(inventorySummary.total_value, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                <p className="text-theme-text-muted text-xs font-medium uppercase">
                  {isInventoryAdmin ? 'Checked Out' : 'My Checkouts'}
                </p>
                <p className="mt-1 text-xl font-bold text-yellow-700 dark:text-yellow-400">
                  {inventorySummary.active_checkouts}
                </p>
                {inventorySummary.overdue_checkouts > 0 && (
                  <p className="text-xs text-red-700 dark:text-red-400">{inventorySummary.overdue_checkouts} overdue</p>
                )}
              </div>
              <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                <p className="text-theme-text-muted text-xs font-medium uppercase">Maintenance Due</p>
                <p className="mt-1 text-xl font-bold text-orange-700 dark:text-orange-400">
                  {inventorySummary.maintenance_due_count}
                </p>
              </div>
            </div>

            {lowStockAlerts.length > 0 && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Low Stock</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {lowStockAlerts.map((a) => (
                    <span
                      key={a.category_id}
                      className="rounded-sm bg-yellow-500/10 px-2 py-1 text-xs text-yellow-600 dark:text-yellow-400"
                    >
                      {a.category_name}: {a.current_stock} left
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
              <button
                onClick={() => void navigate('/inventory/my-equipment')}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm text-white transition-colors hover:bg-emerald-700"
              >
                My Equipment
              </button>
              {isInventoryAdmin && (
                <button
                  onClick={() => void navigate('/inventory/checkouts')}
                  className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg border px-4 py-2 text-center text-sm transition-colors"
                >
                  View Checkouts
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
