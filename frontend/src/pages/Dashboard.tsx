import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { formatRelativeTime } from "../hooks/useRelativeTime";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "../components/PullToRefreshIndicator";
import DashboardStatCard from "../components/dashboard/DashboardStatCard";
import DashboardCardHeader from "../components/dashboard/DashboardCardHeader";
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
  UserPlus,
  Loader2,
  CreditCard,
  X,
  CheckCheck,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  trainingProgramService,
  trainingModuleConfigService,
  notificationsService,
  messagesService,
  organizationService,
  inventoryService,
  eventService,
} from "../services/api";
import type {
  AdminSummary,
  InboxMessage,
  InventorySummary,
  LowStockAlert,
} from "../services/api";
import { schedulingService } from "../modules/scheduling/services/api";
import { adminHoursEntryService } from "../modules/admin-hours/services/api";
import { getErrorMessage } from "../utils/errorHandling";
import { getProgressBarColor, getEventTypeLabel, getRSVPStatusLabel, getRSVPStatusColor } from "../utils/eventHelpers";
import { useTimezone } from "../hooks/useTimezone";
import {
  formatDate,
  formatDateCustom,
  formatNumber,
  formatTime,
  formatShortDateTime,
  getTodayLocalDate,
  toLocalDateString,
} from "../utils/dateFormatting";
import { useAuthStore } from "../stores/authStore";
import { usePWAInstall } from "../hooks/usePWAInstall";
import type {
  ProgramEnrollment,
  MemberProgramProgress,
} from "../types/training";
import type { NotificationLogRecord } from "../services/api";
import type { ShiftRecord } from "../modules/scheduling/services/api";
import type { EventListItem } from "../types/event";
import { dashboardService } from "../services/api";
import { POSITION_LABELS } from "../constants/enums";
import { useNotificationCountStore } from "../hooks/useNotificationCount";

/**
 * Main Dashboard Component
 *
 * Member-focused landing page showing notifications, upcoming shifts,
 * training progress, and recorded hours.
 */
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { user: currentUser, checkPermission } = useAuthStore();
  const [departmentName, setDepartmentName] = useState("Fire Department");
  const { canInstall, install } = usePWAInstall();
  const [dismissedInstall, setDismissedInstall] = useState(false);

  // Admin summary (only loaded for users with settings.manage)
  const isAdmin = checkPermission("settings.manage");
  const canManageMessages = isAdmin || checkPermission("notifications.manage");
  const isInventoryAdmin =
    isAdmin || checkPermission("inventory.manage");
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(isAdmin);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationLogRecord[]>(
    [],
  );
  const unreadCount = useNotificationCountStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationCountStore((s) => s.setUnreadCount);
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
  const [progressDetails, setProgressDetails] = useState<
    Map<string, MemberProgramProgress>
  >(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  // Inventory (admin summary)
  const [inventorySummary, setInventorySummary] =
    useState<InventorySummary | null>(null);
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
    const savedDepartmentName = sessionStorage.getItem("departmentName");
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    } else {
      dashboardService
        .getBranding()
        .then((data) => {
          if (data?.name) {
            setDepartmentName(data.name);
            sessionStorage.setItem("departmentName", data.name);
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
      console.error("Failed to load admin summary:", err);
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
      const [summary, alerts] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getLowStockItems(),
      ]);
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
      const [data, countData] = await Promise.all([
        notificationsService.getMyNotifications({ include_read: false, limit: 10 }),
        notificationsService.getMyUnreadCount(),
      ]);
      setNotifications(data.logs || []);
      setUnreadCount(countData.unread_count);
    } catch {
      // Notifications are non-critical
    } finally {
      setLoadingNotifications(false);
    }
  };

  const loadDeptMessages = async () => {
    try {
      const data = await messagesService.getInbox({ limit: 10 });
      setDeptMessages(data);
      setDeptMsgUnread(data.filter((m) => !m.is_read).length);
    } catch {
      // Messages are non-critical
    } finally {
      setLoadingMessages(false);
    }
  };

  const markMessageRead = async (msgId: string) => {
    try {
      await messagesService.markAsRead(msgId);
      setDeptMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, is_read: true } : m)),
      );
      setDeptMsgUnread((prev) => Math.max(0, prev - 1));
    } catch {
      toast.error("Failed to mark message as read");
    }
  };

  const acknowledgeMessage = async (msgId: string) => {
    try {
      await messagesService.acknowledge(msgId);
      setDeptMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, is_read: true, is_acknowledged: true } : m,
        ),
      );
      setDeptMsgUnread((prev) => Math.max(0, prev - 1));
      toast.success("Message acknowledged");
    } catch {
      toast.error("Failed to acknowledge message");
    }
  };

  const clearPersistentMessage = async (msgId: string) => {
    try {
      await messagesService.updateMessage(msgId, { is_active: false });
      setDeptMessages((prev) => prev.filter((m) => m.id !== msgId));
      toast.success("Persistent message cleared");
    } catch {
      toast.error("Failed to clear message");
    }
  };

  const loadMyShifts = async () => {
    try {
      const today = getTodayLocalDate(tz);
      const nextMonth = toLocalDateString(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        tz,
      );
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
      const nextMonth = toLocalDateString(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        tz,
      );
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
      toast.success("Signed up for shift");
      setSignupExpandedId(null);
      // Refresh both lists: the signed-up shift moves from open to my shifts
      void loadMyShifts();
      void loadOpenShifts();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to sign up for shift"));
    } finally {
      setSigningUpShiftId(null);
    }
  };

  const loadHours = async () => {
    try {
      const [schedulingSummary, trainingSummary, adminHoursSummary] =
        await Promise.all([
          schedulingService.getSummary().catch((err) => {
            console.error("Failed to load scheduling summary:", err);
            return null;
          }),
          trainingModuleConfigService.getMyTraining().catch((err) => {
            console.error("Failed to load training summary:", err);
            return null;
          }),
          adminHoursEntryService.getSummary().catch((err) => {
            console.error("Failed to load admin hours summary:", err);
            return null;
          }),
        ]);
      setHours({
        training: trainingSummary?.hours_summary?.total_hours ?? 0,
        standby: schedulingSummary?.total_hours_this_month || 0,
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
      const data = await trainingProgramService.getMyEnrollments("active");
      setEnrollments(data);

      const top3 = data.slice(0, 3);
      const results = await Promise.allSettled(
        top3.map((e) => trainingProgramService.getEnrollmentProgress(e.id)),
      );
      const details = new Map<string, MemberProgramProgress>();
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
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
      toast.error("Failed to mark notification as read");
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await notificationsService.markAllMyNotificationsRead();
      setNotifications([]);
      clearUnread();
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Failed to clear notifications");
    }
  };

  const dismissNotification = (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    void markNotificationRead(logId);
  };

  const formatShiftDate = (dateStr: string) => {
    return formatDateCustom(dateStr + "T00:00:00", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }, tz);
  };

  const formatShiftTime = (timeStr?: string) => {
    if (!timeStr) return "";
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

  const { pulling, refreshing, pullDistance } = usePullToRefresh({
    onRefresh: refreshDashboard,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <PullToRefreshIndicator
        pulling={pulling}
        refreshing={refreshing}
        pullDistance={pullDistance}
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {loadingNotifications || loadingMyShifts || loadingHours || loadingTraining
          ? "Loading dashboard content..."
          : "Dashboard content loaded."}
      </div>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full">
        {/* "Now" Header — answers: what's next, what needs me, what's expiring */}
        {(() => {
          const firstName = currentUser?.first_name?.trim();
          const greeting = firstName ? `Hi, ${firstName}` : `Welcome to ${departmentName}`;
          const nextEvent = upcomingEvents[0];
          const nextShift = myShifts[0];
          // Pick the soonest of next event / next shift as the "what's next" answer.
          const nextEventStart = nextEvent ? new Date(nextEvent.start_datetime).getTime() : Infinity;
          const nextShiftStart = nextShift
            ? new Date(`${nextShift.shift_date}T${nextShift.start_time || "00:00"}`).getTime()
            : Infinity;
          const showShiftFirst = nextShiftStart < nextEventStart;
          // Cert urgency: expired or expiring within 60 days.
          const urgentCerts = myCerts.filter(
            (c) => c.is_expired || (c.days_until_expiry !== null && c.days_until_expiry <= 60),
          );
          const overdueActionItems = adminSummary?.overdue_action_items ?? 0;
          return (
            <div className="mb-6 sm:mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-theme-text-primary mb-1">
                {greeting}
              </h2>
              <p className="text-theme-text-secondary text-sm sm:text-base mb-3">
                {formatDateCustom(new Date(), {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }, tz)}
                {" · "}
                {departmentName}
              </p>
              <div className="flex flex-wrap gap-2 text-xs sm:text-sm" aria-label="At a glance">
                {showShiftFirst && nextShift ? (
                  <button
                    onClick={() => navigate("/scheduling")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Next shift: {formatShiftDate(nextShift.shift_date)} {formatShiftTime(nextShift.start_time)}</span>
                  </button>
                ) : nextEvent ? (
                  <button
                    onClick={() => navigate(`/events/${nextEvent.id}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Next: {nextEvent.title} · {formatShortDateTime(nextEvent.start_datetime, tz)}</span>
                  </button>
                ) : (
                  !loadingUpcomingEvents && !loadingMyShifts && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-theme-surface-secondary border border-theme-surface-border text-theme-text-muted">
                      <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Nothing scheduled</span>
                    </span>
                  )
                )}
                {urgentCerts.length > 0 && (
                  <button
                    onClick={() => navigate("/training/my-training")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {urgentCerts.length} cert{urgentCerts.length === 1 ? "" : "s"}{" "}
                      {urgentCerts.some((c) => c.is_expired) ? "expired" : "expiring"}
                    </span>
                  </button>
                )}
                {unreadCount > 0 && (
                  <button
                    onClick={() => navigate("/notifications?tab=inbox")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{unreadCount} unread</span>
                  </button>
                )}
                {overdueActionItems > 0 && (
                  <button
                    onClick={() => navigate("/action-items")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
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
          const subtitle = expiredCount > 0
            ? `${expiredCount} expired${urgent.length > expiredCount ? `, ${urgent.length - expiredCount} expiring soon` : ""}`
            : `${urgent.length} expiring within 60 days`;
          return (
            <button
              onClick={() => navigate("/training/my-training")}
              className="w-full mb-6 sm:mb-8 bg-red-500/10 border-l-4 border-red-500 rounded-lg p-4 hover:bg-red-500/15 transition-colors text-left flex items-center gap-3 sm:gap-4"
              aria-label={`${urgent.length} of your certifications need attention`}
            >
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-theme-text-primary">
                  Action needed: {top.course_name}
                  {top.is_expired ? " is expired" :
                    top.days_until_expiry !== null ? ` expires in ${top.days_until_expiry} days` : " expires soon"}
                </h3>
                <p className="text-xs text-theme-text-muted mt-0.5">{subtitle}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-theme-text-muted shrink-0" aria-hidden="true" />
            </button>
          );
        })()}

        {/* Fat primary action: Log Training — most-used action, top placement */}
        <button
          onClick={() => navigate("/training/submit")}
          className="w-full mb-6 sm:mb-8 group bg-gradient-to-br from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 active:from-red-800 active:to-red-900 text-white rounded-xl shadow-md hover:shadow-lg transition-all p-5 sm:p-6 flex items-center gap-4 text-left focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          aria-label="Log a training session"
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-white/15 group-hover:bg-white/20 flex items-center justify-center shrink-0">
            <Plus className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg sm:text-xl font-bold leading-tight">Log Training</div>
            <div className="text-sm text-red-100 mt-0.5">
              Record a drill or session — pick course, hours, done.
            </div>
          </div>
          <ChevronRight className="w-6 h-6 opacity-80 group-hover:translate-x-0.5 transition-transform shrink-0" aria-hidden="true" />
        </button>

        {/* PWA Install Banner */}
        {canInstall && !dismissedInstall && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-center justify-between mb-6 sm:mb-8">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-blue-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-theme-text-primary">
                  Install The Logbook
                </p>
                <p className="text-xs text-theme-text-muted">
                  Add to your home screen for quick access
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDismissedInstall(true)}
                className="text-sm text-theme-text-muted hover:text-theme-text-primary px-3 py-2 rounded"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  void install();
                }}
                className="btn-info font-medium px-4 py-2 rounded-md text-sm"
              >
                Install
              </button>
            </div>
          </div>
        )}

        {/* Setup Prompt (shown to admins when setup is incomplete) */}
        {isAdmin &&
          setupProgress &&
          setupProgress.completed < setupProgress.total && (
            <button
              onClick={() => navigate("/setup")}
              className="w-full mb-6 sm:mb-8 bg-theme-surface border border-red-500/20 rounded-xl p-4 hover:border-red-500/40 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                  <Rocket className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-theme-text-primary">
                    Complete Department Setup
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    {setupProgress.completed} of {setupProgress.total} steps
                    complete
                  </p>
                  {/* Progress bar — mobile inline, desktop in separate column */}
                  <div
                    className="mt-2 sm:hidden w-full bg-theme-surface-secondary rounded-full h-2"
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
                <div className="hidden sm:flex items-center gap-3 shrink-0">
                  <div
                    className="w-24 bg-theme-surface-secondary rounded-full h-2"
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
                  <ChevronRight className="w-5 h-5 text-theme-text-muted group-hover:text-red-500 transition-colors" />
                </div>
              </div>
            </button>
          )}

        {/* Admin Department Summary (visible to Chiefs and admins) */}
        {isAdmin && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-500" aria-hidden="true" />
              Department Overview
            </h3>
            <div
              className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4"
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
                description="Scheduled"
                loading={loadingAdmin}
              />

              <DashboardStatCard
                label="Action Items"
                value={adminSummary?.open_action_items ?? 0}
                icon={(adminSummary?.overdue_action_items ?? 0) > 0 ? AlertTriangle : ClipboardList}
                iconColor={(adminSummary?.overdue_action_items ?? 0) > 0 ? "text-red-700 dark:text-red-400" : "text-yellow-700 dark:text-yellow-400"}
                description={
                  (adminSummary?.overdue_action_items ?? 0) > 0
                    ? `${adminSummary?.overdue_action_items} overdue`
                    : "All on track"
                }
                loading={loadingAdmin}
                onClick={() => navigate("/action-items")}
                ariaLabel={`Action Items: ${adminSummary?.open_action_items ?? 0} open${(adminSummary?.overdue_action_items ?? 0) > 0 ? `, ${adminSummary?.overdue_action_items} overdue` : ""}`}
              />

              <DashboardStatCard
                label="Admin Hours"
                value={adminSummary?.recent_admin_hours ?? 0}
                icon={ClipboardCheck}
                iconColor="text-indigo-700 dark:text-indigo-400"
                description={
                  (adminSummary?.pending_admin_hours_approvals ?? 0) > 0
                    ? `${adminSummary?.pending_admin_hours_approvals} pending approval`
                    : "Last 30 days"
                }
                loading={loadingAdmin}
                onClick={() => navigate("/admin-hours/manage")}
                ariaLabel={`Admin Hours: ${adminSummary?.recent_admin_hours ?? 0}${(adminSummary?.pending_admin_hours_approvals ?? 0) > 0 ? `, ${adminSummary?.pending_admin_hours_approvals} pending approval` : ""}`}
              />
            </div>
          </div>
        )}

        {/* Hours Summary Cards */}
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8"
          role="region"
          aria-label="Hours summary"
        >
          <DashboardStatCard
            label="Total Hours"
            value={totalHours}
            icon={Clock}
            iconColor="text-blue-700 dark:text-blue-400"
            description="This month"
            loading={loadingHours}
          />

          <DashboardStatCard
            label="Training"
            value={hours.training}
            icon={BookOpen}
            iconColor="text-green-700 dark:text-green-400"
            description="Training hours"
            loading={loadingHours}
            valueColor="text-green-700 dark:text-green-400"
          />

          <DashboardStatCard
            label="Standby"
            value={hours.standby}
            icon={Shield}
            iconColor="text-yellow-700 dark:text-yellow-400"
            description="Standby hours"
            loading={loadingHours}
            valueColor="text-yellow-700 dark:text-yellow-400"
          />

          <DashboardStatCard
            label="Administrative"
            value={hours.administrative}
            icon={Briefcase}
            iconColor="text-purple-700 dark:text-purple-400"
            description="Admin hours"
            loading={loadingHours}
            valueColor="text-purple-700 dark:text-purple-400"
            onClick={() => navigate("/admin-hours")}
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
              badge={deptMsgUnread > 0 ? {
                content: `${deptMsgUnread} new`,
                ariaLabel: `${deptMsgUnread} new messages`,
                color: "bg-amber-500 text-white",
              } : undefined}
            />
            <div className="space-y-3">
              {deptMessages.map((msg) => {
                const priorityStyles = {
                  urgent: "border-red-500/40 bg-red-500/10",
                  important: "border-amber-500/30 bg-amber-500/10",
                  normal: "border-theme-surface-border bg-theme-surface",
                };
                const priorityBadge = {
                  urgent: "bg-red-500 text-white",
                  important: "bg-amber-500 text-white",
                  normal: "",
                };
                return (
                  <div
                    key={msg.id}
                    className={`rounded-lg border p-4 transition-colors ${priorityStyles[msg.priority]} ${
                      !msg.is_read ? "ring-1 ring-amber-400/30" : ""
                    }`}
                    onClick={() => {
                      if (!msg.is_read && !msg.is_persistent)
                        void markMessageRead(msg.id);
                    }}
                    role={!msg.is_read && !msg.is_persistent ? "button" : undefined}
                    tabIndex={!msg.is_read && !msg.is_persistent ? 0 : undefined}
                    onKeyDown={!msg.is_read && !msg.is_persistent ? (e) => {
                      if (e.key === "Enter" || e.key === " ") void markMessageRead(msg.id);
                    } : undefined}
                    aria-label={!msg.is_read ? `${msg.title} — unread, ${msg.priority} priority` : undefined}
                  >
                    <div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {msg.is_pinned && (
                            <Pin className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                          )}
                          <h4 className="text-theme-text-primary font-semibold text-sm truncate">
                            {msg.title}
                          </h4>
                          {msg.priority !== "normal" && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium uppercase ${priorityBadge[msg.priority]}`}
                            >
                              {msg.priority}
                            </span>
                          )}
                          {msg.is_persistent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium uppercase bg-theme-surface-hover text-theme-text-muted flex items-center gap-0.5">
                              <Shield className="w-2.5 h-2.5" />
                              Persistent
                            </span>
                          )}
                          {!msg.is_read && (
                            <span className="w-2 h-2 bg-amber-400 rounded-full shrink-0" aria-hidden="true" />
                          )}
                        </div>
                        <p className="text-theme-text-secondary text-sm whitespace-pre-line line-clamp-3">
                          {msg.body}
                        </p>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2">
                          <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                            {msg.author_name && (
                              <span>From: {msg.author_name}</span>
                            )}
                            {msg.created_at && (
                              <span>{formatDate(msg.created_at, tz)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!msg.is_read && !msg.is_persistent && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void markMessageRead(msg.id);
                                }}
                                className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 p-2 -m-1 rounded"
                                title="Mark as read"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            {msg.is_persistent && canManageMessages && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void clearPersistentMessage(msg.id);
                                }}
                                className="text-xs px-3 py-2 text-theme-text-muted hover:text-red-800 dark:hover:text-red-400 hover:bg-red-500/10 rounded flex items-center gap-1 transition-colors"
                                title="Clear persistent message"
                              >
                                <X className="w-3 h-3" />
                                Clear
                              </button>
                            )}
                            {msg.requires_acknowledgment &&
                              !msg.is_acknowledged && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void acknowledgeMessage(msg.id);
                                  }}
                                  className="text-xs px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium"
                                >
                                  Acknowledge
                                </button>
                              )}
                            {msg.is_acknowledged && (
                              <span className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Acknowledged
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
          {/* Notifications */}
          <div className="card p-4 sm:p-6">
            <DashboardCardHeader
              icon={Bell}
              iconColor="text-red-700 dark:text-red-400"
              title="Notifications"
              badge={unreadCount > 0 ? {
                content: unreadCount,
                ariaLabel: `${unreadCount} unread`,
                color: "bg-red-500 text-white",
              } : undefined}
              onViewAll={() => navigate("/notifications?tab=inbox")}
              extraActions={
                unreadCount > 0 ? (
                  <button
                    onClick={() => void markAllNotificationsRead()}
                    className="text-theme-text-muted hover:text-theme-text-primary text-xs flex items-center space-x-1 transition-colors py-2 px-2 -mr-1 rounded"
                    title="Mark all as read"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                ) : undefined
              }
            />

            {loadingNotifications ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-14 bg-theme-surface-hover animate-pulse rounded-lg"
                  ></div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8 text-theme-text-muted text-sm">
                No notifications
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => {
                      void markNotificationRead(notification.id);
                      if (notification.action_url && notification.action_url.startsWith('/'))
                        navigate(notification.action_url);
                      else
                        navigate("/notifications?tab=inbox");
                    }}
                    className="w-full text-left p-2.5 sm:p-3 rounded-lg transition-colors bg-blue-500/10 border border-blue-500/20 text-theme-text-primary"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {notification.subject || "Notification"}
                        </p>
                        <p className="text-xs text-theme-text-muted mt-0.5 truncate">
                          {notification.message || ""}
                        </p>
                      </div>
                      <div className="flex items-center shrink-0">
                        <span
                          className="text-[11px] sm:text-xs text-theme-text-muted whitespace-nowrap"
                          title={formatDate(notification.sent_at, tz)}
                        >
                          {formatRelativeTime(notification.sent_at)}
                        </span>
                        <button
                          onClick={(e) => dismissNotification(e, notification.id)}
                          className="ml-1 p-2 -mr-1 rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                          title="Dismiss"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </button>
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
              onViewAll={() => navigate("/scheduling")}
            />

            {loadingMyShifts ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-14 bg-theme-surface-hover animate-pulse rounded-lg"
                  ></div>
                ))}
              </div>
            ) : myShifts.length === 0 ? (
              <div className="text-center py-8 text-theme-text-muted text-sm">
                No upcoming shifts scheduled
              </div>
            ) : (
              <div className="space-y-2">
                {myShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="p-3 bg-theme-surface-secondary rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center shrink-0">
                        <Calendar className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-theme-text-primary truncate">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {formatShiftTime(shift.start_time)}{" "}
                          - {formatShiftTime(shift.end_time)}
                        </p>
                        {shift.shift_officer_name && (
                          <p className="text-xs text-theme-text-muted mt-0.5 sm:hidden">
                            Officer: {shift.shift_officer_name}
                          </p>
                        )}
                      </div>
                      {shift.shift_officer_name && (
                        <span className="text-xs text-theme-text-muted hidden sm:inline shrink-0">
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
            onViewAll={() => navigate("/scheduling")}
          />

          {loadingOpenShifts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-theme-surface-hover animate-pulse rounded-lg"
                ></div>
              ))}
            </div>
          ) : openShifts.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted text-sm">
              No open shifts available
            </div>
          ) : (
            <div className="space-y-2">
              {openShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="p-3 bg-theme-surface-secondary rounded-lg"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center shrink-0">
                        <CalendarPlus className="w-5 h-5 text-green-700 dark:text-green-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-theme-text-primary truncate">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {formatShiftTime(shift.start_time)} -{" "}
                          {formatShiftTime(shift.end_time)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end space-x-3 shrink-0">
                      {shift.min_staffing != null && (
                        <span className="text-xs text-theme-text-muted">
                          {shift.attendee_count}/{shift.min_staffing} filled
                        </span>
                      )}
                      {signupExpandedId !== shift.id && (
                        <button
                          onClick={() => void handleExpandSignup(shift.id)}
                          className="btn-success flex font-medium items-center px-3 py-2 space-x-1 text-sm"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Sign Up</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {signupExpandedId === shift.id && (
                    <div className="mt-2 pt-2 border-t border-theme-surface-border">
                      {loadingEligibility ? (
                        <div className="flex items-center justify-center py-2" role="status" aria-live="polite">
                          <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                        </div>
                      ) : dashboardEligiblePositions.length === 0 ? (
                        <div className="flex items-center justify-between py-1">
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Not eligible for this shift.
                          </p>
                          <button onClick={() => setSignupExpandedId(null)}
                            className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                          >
                            Close
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <select
                            value={dashboardSignupPosition}
                            onChange={(e) => setDashboardSignupPosition(e.target.value)}
                            className="w-full sm:flex-1 bg-theme-input-bg border border-theme-input-border rounded-md px-2 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500"
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
                              className="btn-success disabled:cursor-not-allowed flex font-medium items-center px-3 py-2 space-x-1 text-sm shrink-0"
                            >
                              {signingUpShiftId === shift.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              <span>Confirm</span>
                            </button>
                            <button
                              onClick={() => setSignupExpandedId(null)}
                              className="text-sm text-theme-text-muted hover:text-theme-text-primary px-3 py-2"
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
            </div>
          )}
        </div>

        {/* Upcoming Events */}
        <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
          <DashboardCardHeader
            icon={Calendar}
            iconColor="text-purple-700 dark:text-purple-400"
            title="Upcoming Events"
            onViewAll={() => navigate("/events")}
          />

          {loadingUpcomingEvents ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-theme-surface-hover animate-pulse rounded-lg"
                ></div>
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted text-sm">
              No upcoming events
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingEvents.map((evt) => (
                <button
                  key={evt.id}
                  onClick={() => navigate(`/events/${evt.id}`)}
                  className="w-full p-3 bg-theme-surface-secondary rounded-lg hover:bg-theme-surface-hover transition-colors text-left"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center shrink-0">
                      <Calendar className="w-5 h-5 text-purple-700 dark:text-purple-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-theme-text-primary truncate">
                          {evt.title}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {evt.user_rsvp_status && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(evt.user_rsvp_status)}`}>
                              {getRSVPStatusLabel(evt.user_rsvp_status)}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-theme-text-muted hidden sm:block" />
                        </div>
                      </div>
                      <p className="text-xs text-theme-text-muted">
                        {formatShortDateTime(evt.start_datetime, tz)}
                        {" \u2022 "}
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
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4 sm:p-6 mb-6 sm:mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
              <Activity className="w-5 h-5" aria-hidden="true" />
              Recent Activity
            </h3>
            <button
              onClick={() => navigate("/notifications?tab=inbox")}
              className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 py-2 pl-2"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {loadingNotifications ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 bg-theme-surface-hover animate-pulse rounded-sm"
                ></div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-theme-text-muted text-center py-4">
              No recent activity
            </p>
          ) : (
            <div className="space-y-3">
              {notifications.slice(0, 8).map((notif, idx) => (
                <div key={notif.id ?? idx} className="flex items-start gap-3">
                  <div
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${notif.read ? "bg-theme-text-muted" : "bg-blue-500"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-theme-text-primary truncate">
                      {notif.subject || notif.message || "Notification"}
                    </p>
                    <p className="text-xs text-theme-text-muted">
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
              onViewAll={() => navigate(`/members/${currentUser.id}/id-card`)}
              className="flex items-center justify-between"
            />
            <p className="text-sm text-theme-text-muted mt-2">
              Show your digital member ID card with QR code and barcode for
              quick identification.
            </p>
            <button
              onClick={() => navigate(`/members/${currentUser.id}/id-card`)}
              className="btn-info mt-4 text-sm"
            >
              Open My ID Card
            </button>
          </div>
        )}

        {/* Quick Access: Meeting Minutes */}
        {checkPermission("meetings.manage") && (
          <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
            <DashboardCardHeader
              icon={ClipboardList}
              iconColor="text-cyan-500"
              title="Meeting Minutes"
              viewAllColor="text-cyan-700 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300"
              onViewAll={() => navigate("/minutes")}
              className="flex items-center justify-between"
            />
            <p className="text-sm text-theme-text-muted mt-2">
              Record, review, and publish meeting minutes. Track motions, votes,
              and action items.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mt-4">
              <button
                onClick={() => navigate("/minutes")}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm rounded-lg transition-colors text-center"
              >
                Record Minutes
              </button>
              <button
                onClick={() => navigate("/minutes")}
                className="px-4 py-2 border border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary text-sm rounded-lg transition-colors text-center"
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
              onViewAll={() => navigate("/training/my-training")}
            />

            <div className="space-y-3">
              {enrollments.slice(0, 3).map((enrollment) => {
                const progress = progressDetails.get(enrollment.id);
                const nextSteps = progress?.requirement_progress
                  .filter(
                    (rp) =>
                      rp.status === "not_started" ||
                      rp.status === "in_progress",
                  )
                  .slice(0, 2);
                const upcomingDeadline =
                  progress?.time_remaining_days !== null &&
                  progress?.time_remaining_days !== undefined &&
                  progress.time_remaining_days < 30;

                return (
                  <button
                    key={enrollment.id}
                    onClick={() => navigate("/training/my-training")}
                    className="w-full bg-theme-surface-secondary rounded-lg p-4 hover:bg-theme-surface-hover cursor-pointer transition-colors text-left"
                    aria-label={`${enrollment.program?.name || "Program"}: ${Math.round(enrollment.progress_percentage)}% complete`}
                  >
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                          <h4 className="text-theme-text-primary font-semibold truncate">
                            {enrollment.program?.name || "Program"}
                          </h4>
                          {upcomingDeadline && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-700 dark:text-red-400 text-xs rounded-sm flex items-center space-x-1 shrink-0">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Deadline Soon</span>
                            </span>
                          )}
                        </div>
                        {enrollment.program?.description && (
                          <p className="text-theme-text-secondary text-sm line-clamp-2">
                            {enrollment.program.description}
                          </p>
                        )}
                      </div>
                      <span className="text-2xl font-bold text-theme-text-primary shrink-0">
                        {Math.round(enrollment.progress_percentage)}%
                      </span>
                    </div>

                    <div
                      className="w-full bg-theme-surface-secondary rounded-full h-2 mb-3"
                      role="progressbar"
                      aria-valuenow={Math.round(enrollment.progress_percentage)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${enrollment.program?.name ?? "Program"} progress: ${Math.round(enrollment.progress_percentage)}%`}
                    >
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>

                    {progress && (
                      <div className="space-y-2">
                        {enrollment.status === "completed" ? (
                          <div className="flex items-center space-x-2 text-green-700 dark:text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Program Completed!</span>
                          </div>
                        ) : nextSteps && nextSteps.length > 0 ? (
                          <div>
                            <p className="text-theme-text-secondary text-xs mb-1">
                              Next Steps:
                            </p>
                            <div className="space-y-1">
                              {nextSteps.map((rp) => (
                                <div
                                  key={rp.id}
                                  className="flex items-start space-x-2 text-sm"
                                >
                                  <TrendingUp className="w-3 h-3 text-blue-700 dark:text-blue-400 mt-0.5 shrink-0" />
                                  <span className="text-theme-text-secondary">
                                    {rp.requirement?.name || "Requirement"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-theme-text-secondary text-sm">
                            All requirements in progress
                          </div>
                        )}

                        {progress.time_remaining_days !== null &&
                          progress.time_remaining_days !== undefined && (
                            <div
                              className={`text-xs ${
                                progress.time_remaining_days < 30
                                  ? "text-red-700 dark:text-red-400"
                                  : progress.time_remaining_days < 90
                                    ? "text-yellow-700 dark:text-yellow-400"
                                    : "text-theme-text-secondary"
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
                  onClick={() => navigate("/training/my-training")}
                  className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm px-2 py-1"
                >
                  View {enrollments.length - 3} more program
                  {enrollments.length - 3 !== 1 ? "s" : ""}
                </button>
              </div>
            )}
          </div>
        )}
        {/* Inventory Summary Widget */}
        {!loadingInventory &&
          inventorySummary &&
          inventorySummary.total_items > 0 && (
            <div className="card mb-6 p-4 sm:mb-8 sm:p-6">
              <DashboardCardHeader
                icon={Package}
                iconColor="text-emerald-500"
                title={isInventoryAdmin ? "Equipment & Inventory" : "My Equipment"}
                viewAllColor="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
                onViewAll={() => navigate("/inventory")}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted text-xs font-medium uppercase">
                    {isInventoryAdmin ? "Total Items" : "My Items"}
                  </p>
                  <p className="text-theme-text-primary text-xl font-bold mt-1">
                    {inventorySummary.total_items}
                  </p>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted text-xs font-medium uppercase">
                    {isInventoryAdmin ? "Total Value" : "My Value"}
                  </p>
                  <p className="text-emerald-700 dark:text-emerald-400 text-xl font-bold mt-1">
                    $
                    {formatNumber(inventorySummary.total_value, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </p>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted text-xs font-medium uppercase">
                    {isInventoryAdmin ? "Checked Out" : "My Checkouts"}
                  </p>
                  <p className="text-yellow-700 dark:text-yellow-400 text-xl font-bold mt-1">
                    {inventorySummary.active_checkouts}
                  </p>
                  {inventorySummary.overdue_checkouts > 0 && (
                    <p className="text-red-700 dark:text-red-400 text-xs">
                      {inventorySummary.overdue_checkouts} overdue
                    </p>
                  )}
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted text-xs font-medium uppercase">
                    Maintenance Due
                  </p>
                  <p className="text-orange-700 dark:text-orange-400 text-xl font-bold mt-1">
                    {inventorySummary.maintenance_due_count}
                  </p>
                </div>
              </div>

              {lowStockAlerts.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                      Low Stock
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lowStockAlerts.map((a) => (
                      <span
                        key={a.category_id}
                        className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-sm"
                      >
                        {a.category_name}: {a.current_stock} left
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mt-4">
                <button
                  onClick={() => navigate("/inventory/my-equipment")}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors text-center"
                >
                  My Equipment
                </button>
                {isInventoryAdmin && (
                  <button
                    onClick={() => navigate("/inventory/checkouts")}
                    className="px-4 py-2 border border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary text-sm rounded-lg transition-colors text-center"
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
