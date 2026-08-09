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
import { useParams } from 'react-router';
import toast from 'react-hot-toast';
import { trainingService, userService } from '../services/api';
import { reportExportService, documentService } from '../services/trainingServices';
import type { TrainingAttachment } from '../services/trainingServices';
import { Breadcrumbs } from '../components/ux/Breadcrumbs';
import { EmptyState } from '../components/ux';
import { GraduationCap, Download, Paperclip, Upload, X } from 'lucide-react';
import { formatDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { getTrainingPeriodWindow, TRAINING_PERIOD_LABELS, TrainingExportPeriod } from '../utils/trainingPeriods';
import { useTimezone } from '../hooks/useTimezone';
import type { TrainingRecord } from '../types/training';
import type { UserWithRoles } from '../types/role';

type FilterStatus = 'all' | 'completed' | 'scheduled' | 'in_progress' | 'expired' | 'expiring_soon';
type SortField = 'date' | 'course' | 'hours' | 'status';
type SortOrder = 'asc' | 'desc';

const RecordAttachmentsModal: React.FC<{
  recordId: string;
  courseName: string;
  onClose: () => void;
}> = ({ recordId, courseName, onClose }) => {
  const [attachments, setAttachments] = useState<TrainingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await documentService.getRecordAttachments(recordId);
        if (active) setAttachments(res.attachments);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Failed to load attachments'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [recordId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const res = await documentService.uploadAttachment(recordId, file);
      setAttachments(res.attachments);
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to upload attachment'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-theme-surface w-full max-w-lg rounded-lg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
            <Paperclip className="h-5 w-5" /> Attachments
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-theme-text-muted hover:text-theme-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-theme-text-muted mb-4 text-sm">{courseName}</p>

        {loading ? (
          <p className="text-theme-text-muted py-2 text-sm">Loading…</p>
        ) : attachments.length === 0 ? (
          <p className="text-theme-text-muted py-2 text-sm">No attachments yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {attachments.map((a) => (
              <li
                key={a.index}
                className="border-theme-surface-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <span className="text-theme-text-primary truncate text-sm">
                  {a.file_name || `Attachment ${a.index + 1}`}
                </span>
                <a
                  href={documentService.getAttachmentDownloadUrl(recordId, a.index)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-sm text-red-600 hover:text-red-500"
                >
                  <Download className="h-4 w-4" /> Download
                </a>
              </li>
            ))}
          </ul>
        )}

        <label className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium">
          <Upload className="h-4 w-4" />
          <span>{uploading ? 'Uploading…' : 'Upload certificate'}</span>
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void handleUpload(e)}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx"
          />
        </label>
      </div>
    </div>
  );
};

export const MemberTrainingHistoryPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
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

  // Export
  const [exportPeriod, setExportPeriod] = useState<TrainingExportPeriod>(TrainingExportPeriod.YEAR);
  const [exporting, setExporting] = useState(false);

  // Attachments
  const [attachmentRecord, setAttachmentRecord] = useState<TrainingRecord | null>(null);

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!userId) return;
    try {
      setExporting(true);
      const window = getTrainingPeriodWindow(exportPeriod, tz);
      const blob = await reportExportService.exportReport({
        report_type: 'individual',
        format,
        user_id: userId,
        start_date: window.start_date,
        end_date: window.end_date,
      });
      const memberName = user?.full_name || user?.username || 'member';
      const safeName = memberName.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_${safeName}_${exportPeriod}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to export training record'));
    } finally {
      setExporting(false);
    }
  };

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
        return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
      case 'in_progress':
        return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
      case 'scheduled':
        return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'failed':
        return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400';
      case 'cancelled':
        return 'bg-theme-surface-secondary text-theme-text-muted';
      default:
        return 'bg-theme-surface-secondary text-theme-text-secondary';
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
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-primary">Loading training history...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error || 'Failed to load training history'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Breadcrumbs
            items={[
              { label: 'Members', path: '/members' },
              { label: user.full_name || user.username, path: `/members/${userId}` },
              { label: 'Training History' },
            ]}
          />

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-theme-text-primary text-3xl font-bold">Training History</h1>
              <p className="text-theme-text-muted mt-1">{user.full_name || user.username}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <select
                aria-label="Export period"
                value={exportPeriod}
                onChange={(e) => setExportPeriod(e.target.value as TrainingExportPeriod)}
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary rounded-lg border px-3 py-2 text-sm"
              >
                {Object.values(TrainingExportPeriod).map((p) => (
                  <option key={p} value={p}>
                    {TRAINING_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleExport('csv')}
                disabled={exporting}
                className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                CSV
              </button>
              <button
                onClick={() => void handleExport('pdf')}
                disabled={exporting}
                className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                PDF
              </button>
              <button
                onClick={() =>
                  window.open(
                    `/training/print/member?id=${userId}&name=${encodeURIComponent(user.full_name || user.username)}`,
                    '_blank'
                  )
                }
                className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
              >
                Print Record
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
          <StatCard label="Total Records" value={stats.total} />
          <StatCard label="Completed" value={stats.completed} color="green" />
          <StatCard label="Total Hours" value={stats.totalHours} color="blue" />
          <StatCard label="Scheduled" value={stats.scheduled} color="yellow" />
          <StatCard label="Expiring Soon" value={stats.expiringSoon} color="orange" />
          <StatCard label="Expired" value={stats.expired} color="red" />
        </div>

        {/* Filters */}
        <div className="card mb-6 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="min-w-[200px] flex-1">
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                type="text"
                aria-label="Search courses..."
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
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
                const [field = 'date', order = 'asc'] = e.target.value.split('-');
                setSortField(field as SortField);
                setSortOrder(order as SortOrder);
              }}
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
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
        <div className="card overflow-hidden">
          {filteredTrainings.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No training records found"
              description={
                searchQuery || filterStatus !== 'all'
                  ? 'Try adjusting your search or filters.'
                  : 'No training has been recorded for this member yet.'
              }
              actions={
                searchQuery || filterStatus !== 'all'
                  ? [
                      {
                        label: 'Clear filters',
                        onClick: () => {
                          setSearchQuery('');
                          setFilterStatus('all');
                        },
                        variant: 'secondary',
                      },
                    ]
                  : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="divide-theme-surface-border min-w-full divide-y">
                <thead className="bg-theme-surface-secondary">
                  <tr>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Course
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Date
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Hours
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Expires
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Files
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {filteredTrainings.map((training) => (
                    <tr key={training.id} className="hover:bg-theme-surface-hover transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-theme-text-primary font-medium">{training.course_name}</div>
                          {training.course_code && (
                            <div className="text-theme-text-muted text-sm">{training.course_code}</div>
                          )}
                          {training.certification_number && (
                            <div className="text-theme-text-muted mt-1 text-xs">
                              Cert #: {training.certification_number}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="text-theme-text-secondary px-6 py-4 text-sm capitalize">
                        {training.training_type?.replace('_', ' ') || '-'}
                      </td>
                      <td className="text-theme-text-secondary px-6 py-4 text-sm">
                        {formatDate(training.completion_date || training.scheduled_date, tz)}
                      </td>
                      <td className="text-theme-text-secondary px-6 py-4 text-sm">{training.hours_completed || 0}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={
                            isExpired(training)
                              ? 'text-red-700 dark:text-red-400'
                              : isExpiringSoon(training)
                                ? 'text-yellow-700 dark:text-yellow-400'
                                : 'text-theme-text-secondary'
                          }
                        >
                          {formatDate(training.expiration_date, tz)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(
                              training.status
                            )}`}
                          >
                            {training.status.replace('_', ' ')}
                          </span>
                          {isExpired(training) && (
                            <span className="inline-flex w-fit rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                              expired
                            </span>
                          )}
                          {!isExpired(training) && isExpiringSoon(training) && (
                            <span className="inline-flex w-fit rounded-full bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                              expiring soon
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setAttachmentRecord(training)}
                          className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1.5 text-sm print:hidden"
                        >
                          <Paperclip className="h-4 w-4" />
                          Files
                        </button>
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
          <div className="text-theme-text-muted mt-4 text-right text-sm">
            Showing {filteredTrainings.length} of {trainings.length} records
          </div>
        )}
      </div>

      {attachmentRecord && (
        <RecordAttachmentsModal
          recordId={attachmentRecord.id}
          courseName={attachmentRecord.course_name}
          onClose={() => setAttachmentRecord(null)}
        />
      )}
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
    green: 'text-green-700 dark:text-green-400',
    blue: 'text-blue-700 dark:text-blue-400',
    yellow: 'text-yellow-700 dark:text-yellow-400',
    orange: 'text-orange-700 dark:text-orange-400',
    red: 'text-red-700 dark:text-red-400',
  };

  return (
    <div className="card p-4">
      <p className="text-theme-text-muted text-xs font-medium uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ? colorClasses[color] : 'text-theme-text-primary'}`}>{value}</p>
    </div>
  );
};

export default MemberTrainingHistoryPage;
