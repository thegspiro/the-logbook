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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  trainingProgramService,
  schedulingService,
  notificationsService,
} from '../services/api';
import { getProgressBarColor } from '../utils/eventHelpers';
import type { ProgramEnrollment, MemberProgramProgress } from '../types/training';
import type { NotificationLogRecord, ShiftRecord } from '../services/api';

/**
 * Main Dashboard Component
 *
 * Member-focused landing page showing notifications, upcoming shifts,
 * training progress, and recorded hours.
 */
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [departmentName, setDepartmentName] = useState('Fire Department');

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

  // Training
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  useEffect(() => {
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    } else {
      import('axios').then(({ default: axios }) => {
        axios.get('/api/v1/auth/branding').then((response) => {
          if (response.data?.name) {
            setDepartmentName(response.data.name);
            sessionStorage.setItem('departmentName', response.data.name);
          }
        }).catch(() => { /* keep default */ });
      });
    }

    loadNotifications();
    loadUpcomingShifts();
    loadHours();
    loadTrainingProgress();
  }, []);

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

  const loadUpcomingShifts = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
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
      const summary = await schedulingService.getSummary();
      setHours({
        training: 0,
        standby: summary.total_hours_this_month || 0,
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
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  const totalHours = hours.training + hours.standby + hours.administrative;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* Welcome Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-theme-text-primary mb-1">
            Welcome to {departmentName}
          </h2>
          <p className="text-theme-text-secondary">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Hours Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8" role="region" aria-label="Hours summary">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Total Hours</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-theme-surface-hover/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-theme-text-primary text-2xl font-bold mt-1">{totalHours}</p>
                )}
              </div>
              <Clock className="w-8 h-8 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">This month</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Training</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-theme-surface-hover/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">{hours.training}</p>
                )}
              </div>
              <BookOpen className="w-8 h-8 text-green-700 dark:text-green-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Training hours</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Standby</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-theme-surface-hover/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-yellow-700 dark:text-yellow-400 text-2xl font-bold mt-1">{hours.standby}</p>
                )}
              </div>
              <Shield className="w-8 h-8 text-yellow-700 dark:text-yellow-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Standby hours</p>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-theme-text-secondary text-xs font-medium uppercase">Administrative</p>
                {loadingHours ? (
                  <div className="mt-1 h-8 w-14 bg-theme-surface-hover/50 animate-pulse rounded"></div>
                ) : (
                  <p className="text-purple-700 dark:text-purple-400 text-2xl font-bold mt-1">{hours.administrative}</p>
                )}
              </div>
              <Briefcase className="w-8 h-8 text-purple-700 dark:text-purple-400" aria-hidden="true" />
            </div>
            <p className="text-theme-text-muted text-xs mt-2">Admin hours</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Notifications */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <Bell className="w-5 h-5 text-red-700 dark:text-red-400" />
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{unreadCount}</span>
                )}
              </h3>
              <button
                onClick={() => navigate('/notifications')}
                className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm flex items-center space-x-1"
              >
                <span>View All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loadingNotifications ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-theme-surface-hover/30 animate-pulse rounded-lg"></div>
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
                        ? 'bg-theme-surface/30 text-theme-text-muted'
                        : 'bg-blue-500/10 border border-blue-500/20 text-theme-text-primary'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{notification.subject || 'Notification'}</p>
                        <p className="text-xs text-theme-text-muted mt-0.5 truncate">{notification.message || ''}</p>
                      </div>
                      <span className="text-xs text-theme-text-muted ml-2 whitespace-nowrap">
                        {new Date(notification.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Shifts */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                <span>Upcoming Shifts</span>
              </h3>
              <button
                onClick={() => navigate('/scheduling')}
                className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm flex items-center space-x-1"
              >
                <span>View Schedule</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loadingShifts ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-theme-surface-hover/30 animate-pulse rounded-lg"></div>
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
                    className="flex items-center justify-between p-3 bg-theme-surface/30 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-theme-text-primary">
                          {formatShiftDate(shift.shift_date)}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
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

        {/* Training Progress */}
        {!loadingTraining && enrollments.length > 0 && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
                <GraduationCap className="w-5 h-5 text-red-700 dark:text-red-500" />
                <span>My Training Progress</span>
              </h3>
              <button
                onClick={() => navigate('/training/my-training')}
                className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm flex items-center space-x-1"
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
                    className="w-full bg-theme-surface/50 rounded-lg p-4 hover:bg-theme-surface/70 cursor-pointer transition-colors text-left"
                    aria-label={`${enrollment.program?.name || 'Program'}: ${Math.round(enrollment.progress_percentage)}% complete`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-theme-text-primary font-semibold">{enrollment.program?.name || 'Program'}</h4>
                          {upcomingDeadline && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-700 dark:text-red-400 text-xs rounded flex items-center space-x-1">
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

                    <div className="w-full bg-theme-surface-hover rounded-full h-2 mb-3">
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>

                    {progress && (
                      <div className="space-y-2">
                        {enrollment.status === 'completed' ? (
                          <div className="flex items-center space-x-2 text-green-700 dark:text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Program Completed!</span>
                          </div>
                        ) : nextSteps && nextSteps.length > 0 ? (
                          <div>
                            <p className="text-theme-text-secondary text-xs mb-1">Next Steps:</p>
                            <div className="space-y-1">
                              {nextSteps.map((rp) => (
                                <div key={rp.id} className="flex items-start space-x-2 text-sm">
                                  <TrendingUp className="w-3 h-3 text-blue-700 dark:text-blue-400 mt-0.5 flex-shrink-0" />
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
                            progress.time_remaining_days < 30 ? 'text-red-700 dark:text-red-400' :
                            progress.time_remaining_days < 90 ? 'text-yellow-700 dark:text-yellow-400' :
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
                  className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm px-2 py-1"
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
