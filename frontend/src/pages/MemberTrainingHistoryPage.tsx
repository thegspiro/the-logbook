/**
 * Member Training History Page
 *
 * Shows complete training history for a member with:
 * - All training records (past, current, scheduled)
 * - Filtering and sorting options
 * - Summary statistics
 * - Export functionality
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trainingService, userService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { TrainingRecord } from '../types/training';
import type { UserWithRoles } from '../types/role';

type FilterStatus = 'all' | 'completed' | 'scheduled' | 'in_progress' | 'expired' | 'expiring_soon';
type SortField = 'date' | 'course' | 'hours' | 'status';
type SortOrder = 'asc' | 'desc';

export const MemberTrainingHistoryPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();

  const [user, setUser] = useState<UserWithRoles | null>(null);
  const [trainings, setTrainings] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and sorting
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (userId) {
      void fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const fetchData = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError(null);

      const [userData, records] = await Promise.all([
        userService.getUserWithRoles(userId),
        trainingService.getRecords({ user_id: userId }),
      ]);

      setUser(userData);
      setTrainings(records);
    } catch (_err) {
      setError('Unable to load training history. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const isExpired = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    return new Date(record.expiration_date) < new Date();
  };

  const isExpiringSoon = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    const expDate = new Date(record.expiration_date);
    const now = new Date();
    const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry > 0 && daysUntilExpiry <= 90;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';
      case 'scheduled':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400';
    }
  };

  // Filter and sort training records
  const filteredTrainings = useMemo(() => {
    let result = [...trainings];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.course_name?.toLowerCase().includes(query) ||
          t.course_code?.toLowerCase().includes(query) ||
          t.instructor?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter((t) => {
        if (filterStatus === 'expired') return isExpired(t);
        if (filterStatus === 'expiring_soon') return isExpiringSoon(t) && !isExpired(t);
        return t.status === filterStatus;
      });
    }

    // Sort
    result.sort((a, b) => {
      let compareValue = 0;

      switch (sortField) {
        case 'date': {
          const dateA = new Date(a.completion_date || a.scheduled_date || 0);
          const dateB = new Date(b.completion_date || b.scheduled_date || 0);
          compareValue = dateB.getTime() - dateA.getTime();
          break;
        }
        case 'course':
          compareValue = (a.course_name ?? '').localeCompare(b.course_name ?? '');
          break;
        case 'hours':
          compareValue = (b.hours_completed || 0) - (a.hours_completed || 0);
          break;
        case 'status':
          compareValue = a.status.localeCompare(b.status);
          break;
      }

      return sortOrder === 'desc' ? compareValue : -compareValue;
    });

    return result;
  }, [trainings, filterStatus, sortField, sortOrder, searchQuery]);

  // Calculate statistics
  const stats = useMemo(() => {
    const completed = trainings.filter((t) => t.status === 'completed');
    const totalHours = completed.reduce((sum, t) => sum + (t.hours_completed || 0), 0);
    const expiringSoon = trainings.filter((t) => isExpiringSoon(t) && !isExpired(t));
    const expired = trainings.filter((t) => isExpired(t));
    const scheduled = trainings.filter((t) => t.status === 'scheduled');

    return {
      total: trainings.length,
      completed: completed.length,
      totalHours,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
      scheduled: scheduled.length,
    };
  }, [trainings]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-theme-text-primary">Loading training history...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
            <p className="text-sm text-red-400">{error || 'Failed to load training history'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/members/${userId}`)}
            className="text-sm text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center gap-1"
          >
            &larr; Back to Profile
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-theme-text-primary">
                Training History
              </h1>
              <p className="text-theme-text-muted mt-1">
                {user.full_name || user.username}
              </p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <StatCard label="Total Records" value={stats.total} />
          <StatCard label="Completed" value={stats.completed} color="green" />
          <StatCard label="Total Hours" value={stats.totalHours} color="blue" />
          <StatCard label="Scheduled" value={stats.scheduled} color="yellow" />
          <StatCard label="Expiring Soon" value={stats.expiringSoon} color="orange" />
          <StatCard label="Expired" value={stats.expired} color="red" />
        </div>

        {/* Filters */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="expiring_soon">Expiring Soon</option>
              <option value="expired">Expired</option>
            </select>

            {/* Sort */}
            <select
              value={`${sortField}-${sortOrder}`}
              onChange={(e) => {
                const [field, order = 'asc'] = e.target.value.split('-');
                setSortField(field as SortField);
                setSortOrder(order as SortOrder);
              }}
              className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="course-asc">Course A-Z</option>
              <option value="course-desc">Course Z-A</option>
              <option value="hours-desc">Most Hours</option>
              <option value="hours-asc">Least Hours</option>
            </select>
          </div>
        </div>

        {/* Training Records List */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
          {filteredTrainings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-theme-text-muted">No training records found.</p>
              {searchQuery || filterStatus !== 'all' ? (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('all');
                  }}
                  className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-theme-surface-border">
                <thead className="bg-theme-surface-secondary">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Course
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Hours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Expires
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {filteredTrainings.map((training) => (
                    <tr key={training.id} className="hover:bg-theme-surface-hover transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-theme-text-primary font-medium">{training.course_name}</div>
                          {training.course_code && (
                            <div className="text-theme-text-muted text-sm">{training.course_code}</div>
                          )}
                          {training.certification_number && (
                            <div className="text-theme-text-muted text-xs mt-1">
                              Cert #: {training.certification_number}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-theme-text-secondary text-sm capitalize">
                        {training.training_type?.replace('_', ' ') || '-'}
                      </td>
                      <td className="px-6 py-4 text-theme-text-secondary text-sm">
                        {formatDate(training.completion_date || training.scheduled_date, tz)}
                      </td>
                      <td className="px-6 py-4 text-theme-text-secondary text-sm">
                        {training.hours_completed || 0}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={
                            isExpired(training)
                              ? 'text-red-400'
                              : isExpiringSoon(training)
                              ? 'text-yellow-400'
                              : 'text-theme-text-secondary'
                          }
                        >
                          {formatDate(training.expiration_date, tz)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-medium w-fit ${getStatusColor(
                              training.status
                            )}`}
                          >
                            {training.status.replace('_', ' ')}
                          </span>
                          {isExpired(training) && (
                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium w-fit bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">
                              expired
                            </span>
                          )}
                          {!isExpired(training) && isExpiringSoon(training) && (
                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium w-fit bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                              expiring soon
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary */}
        {filteredTrainings.length > 0 && (
          <div className="mt-4 text-sm text-theme-text-muted text-right">
            Showing {filteredTrainings.length} of {trainings.length} records
          </div>
        )}
      </div>
    </div>
  );
};

// Stat Card Component
interface StatCardProps {
  label: string;
  value: number;
  color?: 'green' | 'blue' | 'yellow' | 'orange' | 'red';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color }) => {
  const colorClasses = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
  };

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
      <p className="text-theme-text-muted text-xs uppercase font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ? colorClasses[color] : 'text-theme-text-primary'}`}>
        {value}
      </p>
    </div>
  );
};

export default MemberTrainingHistoryPage;
