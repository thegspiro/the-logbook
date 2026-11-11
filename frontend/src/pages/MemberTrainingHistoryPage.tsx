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
import { EmptyState, PromptDialog } from '../components/ux';
import { EditTrainingRecordModal } from '../components/training/EditTrainingRecordModal';
import { MemberRequirementsSection } from '../components/training/MemberRequirementsSection';
import { useAuthStore } from '../stores/authStore';
import { Ban, GraduationCap, Download, Paperclip, Pencil, Upload, X } from 'lucide-react';
import { formatDate } from '../utils/dateFormatting';
import { isCertificationExpired, isCertificationExpiringSoon } from '../utils/certificationExpiry';
import { formatHours, sumHoursToQuarter } from '../utils/hoursFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import {
  getTrainingPeriodWindow,
  isDateInTrainingPeriod,
  TRAINING_PERIOD_LABELS,
  TrainingExportPeriod,
} from '../utils/trainingPeriods';
import { useTimezone } from '../hooks/useTimezone';
import type { TrainingRecord } from '../types/training';
import type { UserWithRoles } from '../types/role';
import { useDialog } from '../hooks/useDialog';
import { getTrainingStatusLabel } from '../utils/trainingColors';
import { TRAINING_TYPE_LABELS } from '../constants/enums';
import { StatGrid } from '../components/ux/StatGrid';

/**
 * Imported course names often end with their code — "CAPCE HIPAA Awareness
 * (3088740)" — and repeating it beside the name added nothing.
 */
const showCourseCode = (name: string | undefined, code: string | undefined): code is string =>
  !!code && !(name ?? '').includes(code);

const formatHoursLabel = (hours: number | null | undefined): string => {
  const text = formatHours(hours);
  return `${text} ${text === '1' ? 'hr' : 'hrs'}`;
};

type FilterStatus = 'all' | 'completed' | 'scheduled' | 'in_progress' | 'expired' | 'expiring_soon';
type SortField = 'date' | 'course' | 'hours' | 'status';
type SortOrder = 'asc' | 'desc';

const RecordAttachmentsModal: React.FC<{
  recordId: string;
  courseName: string;
  onClose: () => void;
}> = ({ recordId, courseName, onClose }) => {
  // Mounted only while open. useDialog rather than useOverlaySurface alone:
  // this dialog dismissed on a backdrop click and had no Escape handler, so
  // removing the former would have left the X button as the only way out.
  const dialogRef = useDialog<HTMLDivElement>({ onClose });

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
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-attachments-title"
    >
      <div
        ref={dialogRef}
        className="bg-theme-surface-modal modal-panel-scroll w-full max-w-lg rounded-lg p-6 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h3
            id="record-attachments-title"
            className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
          >
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

  // The period scopes the record list, the record and hour totals, and the
  // exports alike — a selector that changed only the export left "This Year"
  // sitting above a lifetime hour total.
  const [period, setPeriod] = useState<TrainingExportPeriod>(TrainingExportPeriod.YEAR);
  const [exporting, setExporting] = useState(false);

  // Attachments
  const [attachmentRecord, setAttachmentRecord] = useState<TrainingRecord | null>(null);

  // Officer corrections. The backend enforces training.manage; this only
  // decides whether to offer the buttons.
  const canManage = useAuthStore((state) => state.checkPermission('training.manage'));
  const [editRecord, setEditRecord] = useState<TrainingRecord | null>(null);
  const [voidTarget, setVoidTarget] = useState<TrainingRecord | null>(null);
  const [voiding, setVoiding] = useState(false);

  const handleVoid = async (reason: string) => {
    if (!voidTarget) return;
    try {
      setVoiding(true);
      await trainingService.voidRecord(voidTarget.id, reason);
      toast.success('Training record voided');
      setVoidTarget(null);
      void fetchData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to void training record'));
    } finally {
      setVoiding(false);
    }
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!userId) return;
    try {
      setExporting(true);
      const window = getTrainingPeriodWindow(period, tz);
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
      a.download = `training_${safeName}_${period}.${format}`;
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
      setError('Unable to load training history. Check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-800 dark:bg-green-500/20 dark:text-green-400';
      case 'in_progress':
        return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
      case 'scheduled':
        return 'bg-yellow-500/10 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'failed':
        return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400';
      case 'cancelled':
        return 'bg-theme-surface-secondary text-theme-text-muted';
      default:
        return 'bg-theme-surface-secondary text-theme-text-secondary';
    }
  };

  // Records dated inside the selected period. Only the period's start applies
  // here: the export window ends today, but an upcoming scheduled class still
  // belongs on the page under every period.
  const periodTrainings = useMemo(() => {
    const { start_date } = getTrainingPeriodWindow(period, tz);
    return trainings.filter((t) => isDateInTrainingPeriod(t.completion_date || t.scheduled_date, { start_date }));
  }, [trainings, period, tz]);

  // Expiry is a current state rather than an event in the period: a
  // certificate earned three years ago can expire this week. Those two status
  // filters therefore search every record, matching the Expiring Soon and
  // Expired cards, which count every record.
  const isExpiryFilter = filterStatus === 'expired' || filterStatus === 'expiring_soon';

  // Filter and sort training records
  const filteredTrainings = useMemo(() => {
    let result = [...(isExpiryFilter ? trainings : periodTrainings)];

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
        if (filterStatus === 'expired') return isCertificationExpired(t.expiration_date, tz);
        if (filterStatus === 'expiring_soon')
          return isCertificationExpiringSoon(t.expiration_date, tz) && !isCertificationExpired(t.expiration_date, tz);
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
  }, [trainings, periodTrainings, isExpiryFilter, filterStatus, sortField, sortOrder, searchQuery, tz]);

  // Record and hour totals follow the period; Scheduled, Expiring Soon and
  // Expired describe the member's standing today and count every record.
  const stats = useMemo(() => {
    const completed = periodTrainings.filter((t) => t.status === 'completed');
    const totalHours = sumHoursToQuarter(completed.map((t) => t.hours_completed));
    const expiringSoon = trainings.filter(
      (t) => isCertificationExpiringSoon(t.expiration_date, tz) && !isCertificationExpired(t.expiration_date, tz)
    );
    const expired = trainings.filter((t) => isCertificationExpired(t.expiration_date, tz));
    const scheduled = trainings.filter((t) => t.status === 'scheduled');

    return {
      total: periodTrainings.length,
      completed: completed.length,
      totalHours,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
      scheduled: scheduled.length,
    };
  }, [trainings, periodTrainings, tz]);

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
              // A third fallback, because the first two can both be empty — a
              // record still loading, or one carrying neither name — and an
              // empty label renders a link with no accessible name, which axe
              // reports as link-name and a screen reader announces as a bare URL.
              { label: user.full_name || user.username || 'Member', path: `/members/${userId}` },
              { label: 'Training History' },
            ]}
          />

          <div className="page-header gap-3 sm:items-center">
            <div className="page-header-title">
              <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">Training History</h1>
              <p className="text-theme-text-muted mt-1">{user.full_name || user.username}</p>
            </div>
            <div className="page-header-actions flex flex-wrap items-center gap-2 print:hidden">
              <select
                aria-label="Training period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as TrainingExportPeriod)}
                className="form-input px-3 text-sm"
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
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                onClick={() => void handleExport('pdf')}
                disabled={exporting}
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
              >
                <Download className="h-4 w-4" />
                Export PDF
              </button>
              <button
                onClick={() =>
                  window.open(
                    `/training/print/member?id=${userId}&name=${encodeURIComponent(user.full_name || user.username)}`,
                    '_blank'
                  )
                }
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
              >
                Print Record
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <StatGrid columns={6} gap={4} className="mb-6">
          <StatCard label="Total Records" value={stats.total} />
          <StatCard label="Completed" value={stats.completed} color="green" />
          <StatCard label="Total Hours" value={stats.totalHours} color="blue" />
          <StatCard label="Scheduled" value={stats.scheduled} color="yellow" />
          <StatCard label="Expiring Soon" value={stats.expiringSoon} color="orange" />
          <StatCard label="Expired" value={stats.expired} color="red" />
        </StatGrid>

        {/* The member's requirements, as on their own My Training page. The
            endpoint is training.manage only; a member reading their own
            history sees these on My Training instead. */}
        {canManage && userId && <MemberRequirementsSection userId={userId} timezone={tz} />}

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
              aria-label="Filter training records by status"
              className="form-input"
            >
              <option value="all">All Statuses</option>
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
              aria-label="Sort training records"
              className="form-input"
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
                  : trainings.length > 0
                    ? `No training is recorded for ${TRAINING_PERIOD_LABELS[period].toLowerCase()}. Choose a longer period to see earlier records.`
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
            // A list rather than a table: eight columns needed ~1000px, more
            // than this card ever gets beside the sidebar, so every screen got
            // the stacked fallback — eight label/value rows per course.
            <ul aria-label="Training records" className="divide-theme-surface-border divide-y">
              {filteredTrainings.map((training) => {
                const expired = isCertificationExpired(training.expiration_date, tz);
                const expiringSoon = !expired && isCertificationExpiringSoon(training.expiration_date, tz);
                return (
                  <li
                    key={training.id}
                    className="hover:bg-theme-surface-hover flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-start sm:gap-4 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-theme-text-primary font-medium break-words">
                        {training.course_name}
                        {showCourseCode(training.course_name, training.course_code) && (
                          <span className="text-theme-text-muted ml-2 text-sm font-normal">{training.course_code}</span>
                        )}
                      </p>
                      <p className="text-theme-text-secondary mt-0.5 text-sm">
                        {/* Each item stays on one line; the row wraps between
                            items, never inside "1 hr". */}
                        {[
                          (training.training_type &&
                            (TRAINING_TYPE_LABELS[training.training_type] ??
                              training.training_type.replace(/_/g, ' '))) ||
                            null,
                          formatDate(training.completion_date || training.scheduled_date, tz),
                          formatHoursLabel(training.hours_completed),
                          training.source_label || null,
                        ]
                          .filter(Boolean)
                          .map((item, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && ' · '}
                              <span className="whitespace-nowrap">{item}</span>
                            </React.Fragment>
                          ))}
                        {training.expiration_date && (
                          <>
                            {' · '}
                            <span
                              className={`whitespace-nowrap ${
                                expired
                                  ? 'text-red-700 dark:text-red-400'
                                  : expiringSoon
                                    ? 'text-yellow-700 dark:text-yellow-400'
                                    : ''
                              }`}
                            >
                              {expired ? 'Expired' : 'Expires'} {formatDate(training.expiration_date, tz)}
                            </span>
                          </>
                        )}
                      </p>
                      {training.certification_number && (
                        <p className="text-theme-text-muted mt-0.5 text-xs break-words">
                          Cert #: {training.certification_number}
                        </p>
                      )}
                      {training.voided_at && training.void_reason && (
                        <p className="text-theme-text-secondary mt-1 text-xs break-words whitespace-pre-line">
                          Reason: {training.void_reason}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0 sm:justify-end">
                      <div className="flex flex-wrap items-center gap-1">
                        {training.voided_at ? (
                          <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                            voided
                          </span>
                        ) : (
                          <>
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(
                                training.status
                              )}`}
                            >
                              {getTrainingStatusLabel(training.status)}
                            </span>
                            {expired && (
                              <span className="inline-flex rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                                expired
                              </span>
                            )}
                            {expiringSoon && (
                              <span className="inline-flex rounded-full bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                                expiring soon
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {/* One group, so a narrow screen moves the buttons to
                          their own row together instead of stranding one. */}
                      <div className="flex items-center print:hidden">
                        <button
                          onClick={() => setAttachmentRecord(training)}
                          aria-label={`Files for ${training.course_name}`}
                          className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 inline-flex min-h-9 items-center gap-1.5 px-2 text-sm print:hidden"
                        >
                          <Paperclip className="h-4 w-4" aria-hidden="true" />
                          Files
                        </button>
                        {/* A voided record is final: editing it could hand back
                          credit the department removed. */}
                        {canManage && !training.voided_at && (
                          <>
                            <button
                              onClick={() => setEditRecord(training)}
                              aria-label={`Edit ${training.course_name}`}
                              className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 inline-flex min-h-9 items-center gap-1.5 px-2 text-sm print:hidden"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              onClick={() => setVoidTarget(training)}
                              aria-label={`Void ${training.course_name}`}
                              className="touch:min-h-11 inline-flex min-h-9 items-center gap-1.5 px-2 text-sm text-amber-800 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200 print:hidden"
                            >
                              <Ban className="h-4 w-4" aria-hidden="true" />
                              Void
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Summary */}
        {filteredTrainings.length > 0 && (
          <div className="text-theme-text-muted mt-4 text-right text-sm">
            Showing {filteredTrainings.length} of {isExpiryFilter ? trainings.length : periodTrainings.length} records
            {!isExpiryFilter && period !== TrainingExportPeriod.LIFETIME && (
              <> ({TRAINING_PERIOD_LABELS[period].toLowerCase()})</>
            )}
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

      {editRecord && (
        <EditTrainingRecordModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSaved={() => {
            setEditRecord(null);
            void fetchData();
          }}
        />
      )}

      <PromptDialog
        isOpen={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onSubmit={(reason) => void handleVoid(reason)}
        title="Void training record"
        message={
          <>
            <p>
              <strong>{voidTarget?.course_name}</strong> will stop counting toward this member&apos;s hours and
              requirements. It stays in their history, marked voided.
            </p>
            <p className="mt-2">
              If it came from a training provider, later syncs and uploads of the same completion will not credit it
              again.
            </p>
          </>
        }
        label="Reason"
        hint="The member is emailed and can see this reason on the record."
        multiline
        required
        confirmLabel="Void record"
        cancelLabel="Keep it"
        confirmVariant="warning"
        loading={voiding}
      />
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
