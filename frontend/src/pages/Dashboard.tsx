import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Bell,
  Calendar,
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
  Activity,
  Megaphone,
  Pin,
  Eye,
  Rocket,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  trainingProgramService,
  trainingModuleConfigService,
  schedulingService,
  notificationsService,
  messagesService,
  organizationService,
} from '../services/api';
import type { InboxMessage } from '../services/api';
import { getProgressBarColor } from '../utils/eventHelpers';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime, getTodayLocalDate, toLocalDateString } from '../utils/dateFormatting';
import { useAuthStore } from '../stores/authStore';
import type { ProgramEnrollment, MemberProgramProgress } from '../types/training';
import type { NotificationLogRecord, ShiftRecord } from '../services/api';
import { dashboardService } from '../services/api';

/**
 * Main Dashboard Component
 *
 * Member-focused landing page showing notifications, upcoming shifts,
 * training progress, and recorded hours.
 */
interface AdminSummaryData {
  active_members: number;
  inactive_members: number;
  total_members: number;
  training_completion_pct: number;
  upcoming_events_count: number;
  overdue_action_items: number;
  open_action_items: number;
  recent_training_hours: number;
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  const [departmentName, setDepartmentName] = useState('Fire Department');

  // Admin summary (only loaded for users with settings.manage)
  const isAdmin = checkPermission('settings.manage');
  const [adminSummary, setAdminSummary] = useState<AdminSummaryData | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(isAdmin);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationLogRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  // Shifts
  const [upcomingShifts, setUpcomingShifts] = useState<ShiftRecord[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);

  // Hours
  const [hours, setHours] = useState({ training: 0, standby: 0, administrative: 0 });
  const [loadingHours, setLoadingHours] = useState(true);

  // Department Messages
  const [deptMessages, setDeptMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [deptMsgUnread, setDeptMsgUnread] = useState(0);

  // Training
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  // Setup checklist (admin-only)
  const [setupProgress, setSetupProgress] = useState<{ completed: number; total: number } | null>(null);

  useEffect(() => {
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    } else {
      dashboardService.getBranding().then((data) => {
        if (data?.name) {
          setDepartmentName(data.name);
          sessionStorage.setItem('departmentName', data.name);
        }
      }).catch(() => { /* keep default */ });
    }

    loadNotifications();
    loadUpcomingShifts();
    loadDeptMessages();
    if (isAdmin) {
      loadAdminSummary();
      loadSetupProgress();
    }
    loadHours();
    loadTrainingProgress();
  }, []);

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
      setSetupProgress({ completed: data.completed_count, total: data.total_count });
    } catch {
      // Non-critical
    }
  };

  const loadNotifications = async () => {
    try {
      const data = await notificationsService.getLogs({ limit: 5 });
      setNotifications(data.logs || []);
      setUnreadCount((data.logs || []).filter((n: NotificationLogRecord) => !n.read).length);
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
      setDeptMsgUnread(data.filter(m => !m.is_read).length);
    } catch {
      // Messages are non-critical
    } finally {
      setLoadingMessages(false);
    }
  };

  const markMessageRead = async (msgId: string) => {
    try {
      await messagesService.markAsRead(msgId);
      setDeptMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_read: true } : m));
      setDeptMsgUnread(prev => Math.max(0, prev - 1));
    } catch {
      toast.error('Failed to mark message as read');
    }
  };

  const acknowledgeMessage = async (msgId: string) => {
    try {
      await messagesService.acknowledge(msgId);
      setDeptMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_read: true, is_acknowledged: true } : m));
      setDeptMsgUnread(prev => Math.max(0, prev - 1));
      toast.success('Message acknowledged');
    } catch {
      toast.error('Failed to acknowledge message');
    }
  };

  const loadUpcomingShifts = async () => {
    try {
      const today = getTodayLocalDate(tz);
      const nextMonth = toLocalDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), tz);
      const data = await schedulingService.getMyShifts({ start_date: today, end_date: nextMonth, limit: 5 });
      setUpcomingShifts(data.shifts || []);
    } catch {
      // Shifts are non-critical
    } finally {
      setLoadingShifts(false);
    }
  };

  const loadHours = async () => {
    try {
      const [schedulingSummary, trainingSummary] = await Promise.all([
        schedulingService.getSummary().catch(() => null),
        trainingModuleConfigService.getMyTraining().catch(() => null),
      ]);
      setHours({
        training: trainingSummary?.hours_summary?.total_hours ?? 0,
        standby: schedulingSummary?.total_hours_this_month || 0,
        administrative: 0,
      });
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

      const details = new Map<string, MemberProgramProgress>();
      for (const enrollment of data.slice(0, 3)) {
        try {
          const progress = await trainingProgramService.getEnrollmentProgress(enrollment.id);
          details.set(enrollment.id, progress);
        } catch {
          // Continue loading other enrollments
        }
      }
      setProgressDetails(details);
    } catch {
      // Training is non-critical on dashboard
    } finally {
      setLoadingTraining(false);
    }
  };

  const markNotificationRead = async (logId: string) => {
    try {
      await notificationsService.markAsRead(logId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === logId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      toast.error('Failed to mark notification as read');
    }
  };

  const formatShiftDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  };

  const formatShiftTime = (dateStr: string, timeStr?: string) => {
    if (!timeStr) return '';
    return formatTime(dateStr + 'T' + timeStr, tz);
  };

  const totalHours = hours.training + hours.standby + hours.administrative;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full">
        {/* Welcome Header */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-theme-text-primary mb-1">
            Welcome to {departmentName}
          </h2>
          <p className="text-theme-text-secondary text-sm sm:text-base">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz })}
          </p>
        </div>

        {/* Setup Prompt (shown to admins when setup is incomplete) */}
        {isAdmin && setupProgress && setupProgress.completed < setupProgress.total && (
          <button
            onClick={() => navigate('/setup')}
            className="w-full mb-6 sm:mb-8 bg-theme-surface border border-red-500/20 rounded-xl p-4 hover:border-red-500/40 transition-colors text-left group"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Rocket className="w-5 h-5 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-theme-text-primary">Complete Department Setup</h3>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  {setupProgress.completed} of {setupProgress.total} steps complete
                </p>
                {/* Progress bar — mobile inline, desktop in separate column */}
                <div className="mt-2 sm:hidden w-full bg-theme-surface-secondary rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-red-500 transition-all"
                    style={{ width: `${Math.round((setupProgress.completed / setupProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                <div className="w-24 bg-theme-surface-secondary rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-red-500 transition-all"
                    style={{ width: `${Math.round((setupProgress.completed / setupProgress.total) * 100)}%` }}
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
              <Shield className="w-5 h-5 text-red-500" />
              Department Overview
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" role="region" aria-label="Department overview">
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-theme-text-secondary text-xs font-medium uppercase">Active Members</p>
                    {loadingAdmin ? (
                      <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                    ) : (
                      <p className="text-theme-text-primary text-2xl font-bold mt-1">{adminSummary?.active_members ?? 0}</p>
                    )}
                  </div>
                  <Users className="w-8 h-8 text-blue-400" />
                </div>
                <p className="text-theme-text-muted text-xs mt-2">{adminSummary?.total_members ?? 0} total</p>
              </div>

              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-theme-text-secondary text-xs font-medium uppercase">Training Compliance</p>
                    {loadingAdmin ? (
                      <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                    ) : (
                      <p className="text-theme-text-primary text-2xl font-bold mt-1">{adminSummary?.training_completion_pct ?? 0}%</p>
                    )}
                  </div>
                  <GraduationCap className="w-8 h-8 text-green-400" />
                </div>
                <p className="text-theme-text-muted text-xs mt-2">{adminSummary?.recent_training_hours ?? 0} hrs last 30 days</p>
              </div>

              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-theme-text-secondary text-xs font-medium uppercase">Upcoming Events</p>
                    {loadingAdmin ? (
                      <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                    ) : (
                      <p className="text-theme-text-primary text-2xl font-bold mt-1">{adminSummary?.upcoming_events_count ?? 0}</p>
                    )}
                  </div>
                  <Calendar className="w-8 h-8 text-purple-400" />
                </div>
                <p className="text-theme-text-muted text-xs mt-2">Scheduled</p>
              </div>

              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border cursor-pointer hover:border-red-500/50 transition-colors" onClick={() => navigate('/dashboard')}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-theme-text-secondary text-xs font-medium uppercase">Action Items</p>
                    {loadingAdmin ? (
                      <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                    ) : (
                      <p className="text-theme-text-primary text-2xl font-bold mt-1">{adminSummary?.open_action_items ?? 0}</p>
                    )}
                  </div>
                  {(adminSummary?.overdue_action_items ?? 0) > 0 ? (
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                  ) : (
                    <ClipboardList className="w-8 h-8 text-yellow-400" />
                  )}
                </div>
                <p className="text-theme-text-muted text-xs mt-2">
                  {(adminSummary?.overdue_action_items ?? 0) > 0
                    ? `${adminSummary?.overdue_action_items} overdue`
                    : 'All on track'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Hours Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8" role="region" aria-label="Hours summary">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Total Hours</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-theme-text-primary text-2xl font-bold mt-1">{totalHours}</p>
                )}
              </div>
              <Clock className="w-8 h-8 text-blue-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">This month</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Training</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-green-400 text-2xl font-bold mt-1">{hours.training}</p>
                )}
              </div>
              <BookOpen className="w-8 h-8 text-green-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Training hours</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Standby</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-yellow-400 text-2xl font-bold mt-1">{hours.standby}</p>
                )}
              </div>
              <Shield className="w-8 h-8 text-yellow-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Standby hours</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Administrative</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-slate-700/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-purple-400 text-2xl font-bold mt-1">{hours.administrative}</p>
                )}
              </div>
              <Briefcase className="w-8 h-8 text-purple-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Admin hours</p>
          </div>
        </div>

        {/* Department Messages — always visible, prominent */}
        {!loadingMessages && deptMessages.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <Megaphone className="w-5 h-5 text-amber-400" />
                <span>Department Messages</span>
                {deptMsgUnread > 0 && (
                  <span className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">{deptMsgUnread} new</span>
                )}
              </h3>
            </div>
            <div className="space-y-3">
              {deptMessages.map(msg => {
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
                    onClick={() => !msg.is_read && markMessageRead(msg.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {msg.is_pinned && <Pin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                          <h4 className="text-theme-text-primary font-semibold text-sm truncate">{msg.title}</h4>
                          {msg.priority !== 'normal' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${priorityBadge[msg.priority]}`}>
                              {msg.priority}
                            </span>
                          )}
                          {!msg.is_read && (
                            <span className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-theme-text-secondary text-sm whitespace-pre-line line-clamp-3">{msg.body}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-theme-text-muted">
                          {msg.author_name && <span>From: {msg.author_name}</span>}
                          {msg.created_at && <span>{formatDate(msg.created_at, tz)}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!msg.is_read && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markMessageRead(msg.id); }}
                            className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1"
                            title="Mark as read"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {msg.requires_acknowledgment && !msg.is_acknowledged && (
                          <button
                            onClick={(e) => { e.stopPropagation(); acknowledgeMessage(msg.id); }}
                            className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium"
                          >
                            Acknowledge
                          </button>
                        )}
                        {msg.is_acknowledged && (
                          <span className="text-xs text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Acknowledged
                          </span>
                        )}
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
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 sm:p-6 border border-theme-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <Bell className="w-5 h-5 text-red-400" />
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{unreadCount}</span>
                )}
              </h3>
              <button
                onClick={() => navigate('/notifications')}
                className="text-red-400 hover:text-red-300 text-sm flex items-center space-x-1"
              >
                <span>View All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loadingNotifications ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-slate-700/30 animate-pulse rounded-lg"></div>
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
                    onClick={() => !notification.read && markNotificationRead(notification.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      notification.read
                        ? 'bg-theme-surface-secondary text-theme-text-muted'
                        : 'bg-blue-500/10 border border-blue-500/20 text-theme-text-primary'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{notification.subject || 'Notification'}</p>
                        <p className="text-xs text-theme-text-muted mt-0.5 truncate">{notification.message || ''}</p>
                      </div>
                      <span className="text-xs text-theme-text-muted ml-2 whitespace-nowrap">
                        {formatDate(notification.sent_at, tz)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Shifts */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 sm:p-6 border border-theme-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-blue-400" />
                <span>Upcoming Shifts</span>
              </h3>
              <button
                onClick={() => navigate('/scheduling')}
                className="text-red-400 hover:text-red-300 text-sm flex items-center space-x-1"
              >
                <span>View Schedule</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loadingShifts ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-slate-700/30 animate-pulse rounded-lg"></div>
                ))}
              </div>
            ) : upcomingShifts.length === 0 ? (
              <div className="text-center py-8 text-theme-text-muted text-sm">
                No upcoming shifts scheduled
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between p-3 bg-theme-surface-secondary rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-theme-text-primary">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {formatShiftTime(shift.shift_date, shift.start_time)} - {formatShiftTime(shift.shift_date, shift.end_time)}
                        </p>
                      </div>
                    </div>
                    {shift.shift_officer_name && (
                      <span className="text-xs text-theme-text-muted">
                        Officer: {shift.shift_officer_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Access: Meeting Minutes */}
        {checkPermission('meetings.manage') && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 sm:p-6 border border-theme-surface-border mb-6 sm:mb-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <ClipboardList className="w-5 h-5 text-cyan-500" />
                <span>Meeting Minutes</span>
              </h3>
              <button
                onClick={() => navigate('/minutes')}
                className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center space-x-1"
              >
                <span>View All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-theme-text-muted mt-2">
              Record, review, and publish meeting minutes. Track motions, votes, and action items.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mt-4">
              <button
                onClick={() => navigate('/minutes')}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm rounded-lg transition-colors text-center"
              >
                Record Minutes
              </button>
              <button
                onClick={() => navigate('/minutes')}
                className="px-4 py-2 border border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary text-sm rounded-lg transition-colors text-center"
              >
                Review Pending
              </button>
            </div>
          </div>
        )}

        {/* Training Progress */}
        {!loadingTraining && enrollments.length > 0 && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 sm:p-6 border border-theme-surface-border mb-6 sm:mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <GraduationCap className="w-5 h-5 text-red-500" />
                <span>My Training Progress</span>
              </h3>
              <button
                onClick={() => navigate('/training/my-training')}
                className="text-red-400 hover:text-red-300 text-sm flex items-center space-x-1"
              >
                <span>View All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {enrollments.slice(0, 3).map((enrollment) => {
                const progress = progressDetails.get(enrollment.id);
                const nextSteps = progress?.requirement_progress
                  .filter(rp => rp.status === 'not_started' || rp.status === 'in_progress')
                  .slice(0, 2);
                const upcomingDeadline = progress?.time_remaining_days !== null &&
                                        progress?.time_remaining_days !== undefined &&
                                        progress.time_remaining_days < 30;

                return (
                  <button
                    key={enrollment.id}
                    onClick={() => navigate('/training/my-training')}
                    className="w-full bg-theme-surface-secondary rounded-lg p-4 hover:bg-theme-surface-hover cursor-pointer transition-colors text-left"
                    aria-label={`${enrollment.program?.name || 'Program'}: ${Math.round(enrollment.progress_percentage)}% complete`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-theme-text-primary font-semibold">{enrollment.program?.name || 'Program'}</h4>
                          {upcomingDeadline && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded flex items-center space-x-1">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Deadline Soon</span>
                            </span>
                          )}
                        </div>
                        {enrollment.program?.description && (
                          <p className="text-theme-text-secondary text-sm">{enrollment.program.description}</p>
                        )}
                      </div>
                      <span className="text-2xl font-bold text-theme-text-primary ml-4">
                        {Math.round(enrollment.progress_percentage)}%
                      </span>
                    </div>

                    <div className="w-full bg-slate-700 rounded-full h-2 mb-3">
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>

                    {progress && (
                      <div className="space-y-2">
                        {enrollment.status === 'completed' ? (
                          <div className="flex items-center space-x-2 text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Program Completed!</span>
                          </div>
                        ) : nextSteps && nextSteps.length > 0 ? (
                          <div>
                            <p className="text-theme-text-secondary text-xs mb-1">Next Steps:</p>
                            <div className="space-y-1">
                              {nextSteps.map((rp) => (
                                <div key={rp.id} className="flex items-start space-x-2 text-sm">
                                  <TrendingUp className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                                  <span className="text-theme-text-secondary">{rp.requirement?.name || 'Requirement'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-theme-text-secondary text-sm">All requirements in progress</div>
                        )}

                        {progress.time_remaining_days !== null && progress.time_remaining_days !== undefined && (
                          <div className={`text-xs ${
                            progress.time_remaining_days < 30 ? 'text-red-400' :
                            progress.time_remaining_days < 90 ? 'text-yellow-400' :
                            'text-theme-text-secondary'
                          }`}>
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
                  onClick={() => navigate('/training/my-training')}
                  className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                >
                  View {enrollments.length - 3} more program{enrollments.length - 3 !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
