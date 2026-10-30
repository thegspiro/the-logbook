/**
 * Saved Reports Page (RPT2-29-2)
 *
 * Lists the department's saved reports, runs one on demand, and — for
 * `reports.manage` holders — creates, edits, schedules and deletes them.
 *
 * Scheduling is live: the backend's daily `saved_report_delivery` task emails
 * a summary and a link on each report's next send date. Two rules are the
 * backend's to decide, not this page's (CLAUDE.md pitfall #29):
 *
 * - which report types the viewer may save or run — the type list is
 *   `/reports/available`, which already leaves out the member-data reports
 *   the viewer lacks the permission for (RPT-3);
 * - who a member-data report may be emailed to — the PII gate refuses, with
 *   the addresses named, any recipient who is not an active member holding
 *   that permission. This page shows the server's message as it is.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DialogPanel } from '../../../components/ux/DialogPanel';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatDateTime } from '../../../utils/dateFormatting';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useReportsStore } from '../store/reportsStore';
import { SavedReportFrequency, SavedReportPeriod } from '../types';
import type { SavedReportConfig, SavedReportCreate, SavedReportUpdate } from '../types';

const PERIOD_LABELS: Record<SavedReportPeriod, string> = {
  last_30_days: 'Last 30 days',
  previous_month: 'Previous month',
  previous_quarter: 'Previous quarter',
  year_to_date: 'Year to date',
  previous_year: 'Previous year',
};

const FREQUENCY_LABELS: Record<SavedReportFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function scheduleSummary(report: SavedReportConfig): string {
  if (!report.is_scheduled || !report.schedule_frequency) return 'Not scheduled';
  const day = report.schedule_day ?? 1;
  switch (report.schedule_frequency) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return `Every ${WEEKDAYS[day - 1] ?? 'Monday'}`;
    case 'monthly':
      return `Monthly on day ${day}`;
    case 'quarterly':
      return `Quarterly on day ${day} (Jan, Apr, Jul, Oct)`;
    default:
      return 'Scheduled';
  }
}

function periodOf(report: SavedReportConfig): SavedReportPeriod | '' {
  const period = report.filters?.['period'];
  return typeof period === 'string' && period in PERIOD_LABELS ? (period as SavedReportPeriod) : '';
}

interface FormState {
  name: string;
  description: string;
  reportType: string;
  period: SavedReportPeriod | '';
  isScheduled: boolean;
  frequency: SavedReportFrequency;
  day: string;
  recipients: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  reportType: '',
  period: '',
  isScheduled: false,
  frequency: SavedReportFrequency.WEEKLY,
  day: '1',
  recipients: '',
};

/**
 * The day select only offers 1–7 for weekly and 1–31 otherwise, and a select
 * whose value matches no option shows its first one. A day left over from
 * another frequency (monthly on the 15th, switched to weekly) therefore read
 * "Monday" on screen while 15 was sent — and refused by validate_schedule.
 */
function dayValidFor(frequency: SavedReportFrequency, day: string): string {
  const n = Number(day);
  const max = frequency === SavedReportFrequency.WEEKLY ? WEEKDAYS.length : 31;
  return Number.isInteger(n) && n >= 1 && n <= max ? String(n) : '1';
}

function formFrom(report: SavedReportConfig): FormState {
  const frequency = report.schedule_frequency ?? SavedReportFrequency.WEEKLY;
  return {
    name: report.name,
    description: report.description ?? '',
    reportType: report.report_type,
    period: periodOf(report),
    isScheduled: report.is_scheduled,
    frequency,
    day: dayValidFor(frequency, String(report.schedule_day ?? 1)),
    recipients: (report.email_recipients ?? []).join(', '),
  };
}

function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

export const SavedReportsPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission)('reports.manage');
  const {
    availableReports,
    savedReports,
    savedReportsLoading,
    generatingReportType,
    fetchAvailableReports,
    fetchSavedReports,
    createSavedReport,
    updateSavedReport,
    deleteSavedReport,
    runSavedReport,
  } = useReportsStore();

  const [editing, setEditing] = useState<SavedReportConfig | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void fetchAvailableReports();
    void fetchSavedReports();
  }, [fetchAvailableReports, fetchSavedReports]);

  // The types this viewer may run: /reports/available already leaves out the
  // member-data reports their permissions do not cover.
  const titles = useMemo(() => new Map(availableReports.map((r) => [r.id, r.title])), [availableReports]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, reportType: availableReports[0]?.id ?? '' });
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (report: SavedReportConfig) => {
    setEditing(report);
    setForm(formFrom(report));
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => setIsFormOpen(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.reportType) {
      setFormError('Give the report a name and choose a report type.');
      return;
    }
    const filters: Record<string, unknown> = { ...(editing?.filters ?? {}) };
    delete filters['period'];
    if (form.period) filters['period'] = form.period;
    const recipients = parseRecipients(form.recipients);
    const day = form.frequency === SavedReportFrequency.DAILY ? null : Number(form.day);

    setIsSaving(true);
    setFormError(null);
    try {
      if (editing) {
        // Every field the form owns, with blanks as explicit nulls (Pitfall #1).
        const payload: SavedReportUpdate = {
          name: form.name.trim(),
          description: blankToNull(form.description),
          filters,
          is_scheduled: form.isScheduled,
          schedule_frequency: form.isScheduled ? form.frequency : null,
          schedule_day: form.isScheduled ? day : null,
          email_recipients: recipients,
        };
        await updateSavedReport(editing.id, payload);
        toast.success('Saved report updated');
      } else {
        const payload: SavedReportCreate = {
          name: form.name.trim(),
          report_type: form.reportType,
          filters,
          is_scheduled: form.isScheduled,
          email_recipients: recipients,
        };
        const description = form.description.trim() || undefined;
        if (description) payload.description = description;
        if (form.isScheduled) {
          payload.schedule_frequency = form.frequency;
          if (day !== null) payload.schedule_day = day;
        }
        await createSavedReport(payload);
        toast.success('Report saved');
      }
      setIsFormOpen(false);
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Could not save the report.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async (report: SavedReportConfig) => {
    try {
      await runSavedReport(report);
      // The Reports page shows the active report in its results dialog.
      void navigate('/reports');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not run the report.'));
    }
  };

  const handleDelete = async (report: SavedReportConfig) => {
    const ok = await confirm({
      title: 'Delete saved report?',
      message: report.is_scheduled
        ? `"${report.name}" will be deleted and its scheduled emails will stop.`
        : `"${report.name}" will be deleted.`,
      confirmLabel: 'Delete report',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await deleteSavedReport(report.id);
      toast.success('Saved report deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the report.'));
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/reports"
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
        <div className="page-header mb-6 gap-3 sm:items-start">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-3xl font-bold">Saved Reports</h1>
            <p className="text-theme-text-secondary mt-1">
              Reports saved with their settings. A scheduled report is emailed as a summary with a link back here; the
              full report opens with your own access applied.
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New saved report
            </button>
          )}
        </div>

        {savedReportsLoading && savedReports.length === 0 ? (
          <p className="text-theme-text-secondary text-sm">Loading saved reports…</p>
        ) : savedReports.length === 0 ? (
          <EmptyState
            title="No saved reports yet"
            description={
              canManage
                ? 'Save a report to run it again with one tap, or schedule it to be emailed.'
                : 'Nobody in your department has saved a report yet.'
            }
          />
        ) : (
          <ul className="card-grid">
            {savedReports.map((report) => {
              const title = titles.get(report.report_type);
              const period = periodOf(report);
              return (
                <li key={report.id} className="card flex flex-col gap-3 p-4">
                  <div>
                    <h2 className="text-theme-text-primary text-lg font-semibold">{report.name}</h2>
                    <p className="text-theme-text-secondary text-sm">
                      {title ?? 'A report you do not have access to run'}
                      {period ? ` · ${PERIOD_LABELS[period]}` : ''}
                    </p>
                    {report.description && (
                      <p className="text-theme-text-secondary mt-1 text-sm">{report.description}</p>
                    )}
                  </div>
                  <dl className="text-theme-text-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="flex items-center gap-1">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      Schedule
                    </dt>
                    <dd className="text-theme-text-primary">{scheduleSummary(report)}</dd>
                    {report.is_scheduled && (
                      <>
                        <dt>Next email</dt>
                        <dd className="text-theme-text-primary">
                          {report.next_run_at ? formatCalendarDate(report.next_run_at) : '—'}
                        </dd>
                        <dt>Recipients</dt>
                        <dd className="text-theme-text-primary">{(report.email_recipients ?? []).length}</dd>
                      </>
                    )}
                    <dt>Last run</dt>
                    <dd className="text-theme-text-primary">
                      {report.last_run_at ? formatDateTime(report.last_run_at, tz) : 'Never'}
                    </dd>
                  </dl>
                  <div className="mt-auto flex flex-wrap gap-2">
                    {title && (
                      <button
                        type="button"
                        onClick={() => void handleRun(report)}
                        disabled={generatingReportType !== null}
                        aria-label={`Run ${report.name}`}
                        className="btn-primary inline-flex items-center gap-1"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        {generatingReportType === report.report_type ? 'Running…' : 'Run'}
                      </button>
                    )}
                    {canManage && title && (
                      <button
                        type="button"
                        onClick={() => openEdit(report)}
                        aria-label={`Edit ${report.name}`}
                        className="btn-secondary inline-flex items-center gap-1"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Edit
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(report)}
                        aria-label={`Delete ${report.name}`}
                        className="btn-icon text-theme-text-secondary hover:text-theme-text-primary"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isFormOpen && (
        <div className="modal-overlay z-50 flex items-center justify-center p-4">
          <DialogPanel
            onClose={closeForm}
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-report-form-title"
            className="modal-panel-scroll w-full max-w-lg"
          >
            <div className="modal-body space-y-4">
              <h2 id="saved-report-form-title" className="text-theme-text-primary text-lg font-semibold">
                {editing ? 'Edit saved report' : 'New saved report'}
              </h2>
              <div>
                <label htmlFor="saved-report-name" className="form-label">
                  Name
                </label>
                <input
                  id="saved-report-name"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  maxLength={255}
                />
              </div>
              <div>
                <label htmlFor="saved-report-description" className="form-label">
                  Description (optional)
                </label>
                <input
                  id="saved-report-description"
                  className="form-input"
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="saved-report-type" className="form-label">
                  Report
                </label>
                <select
                  id="saved-report-type"
                  className="form-input"
                  value={form.reportType}
                  disabled={editing !== null}
                  onChange={(e) => update('reportType', e.target.value)}
                >
                  {availableReports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="saved-report-period" className="form-label">
                  Reporting period
                </label>
                <select
                  id="saved-report-period"
                  className="form-input"
                  value={form.period}
                  onChange={(e) => update('period', e.target.value as SavedReportPeriod | '')}
                >
                  <option value="">The report&apos;s default</option>
                  {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="text-theme-text-secondary mt-1 text-xs">
                  Worked out on the day the report runs, so a monthly email covers the month just ended.
                </p>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={form.isScheduled}
                  onChange={(e) => update('isScheduled', e.target.checked)}
                />
                <span className="text-theme-text-primary text-sm">Email this report on a schedule</span>
              </label>

              {form.isScheduled && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="saved-report-frequency" className="form-label">
                        How often
                      </label>
                      <select
                        id="saved-report-frequency"
                        className="form-input"
                        value={form.frequency}
                        onChange={(e) => {
                          const frequency = e.target.value as SavedReportFrequency;
                          setForm((prev) => ({ ...prev, frequency, day: dayValidFor(frequency, prev.day) }));
                        }}
                      >
                        {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {form.frequency !== SavedReportFrequency.DAILY && (
                      <div>
                        <label htmlFor="saved-report-day" className="form-label">
                          {form.frequency === SavedReportFrequency.WEEKLY ? 'Day of the week' : 'Day of the month'}
                        </label>
                        <select
                          id="saved-report-day"
                          className="form-input"
                          value={form.day}
                          onChange={(e) => update('day', e.target.value)}
                        >
                          {form.frequency === SavedReportFrequency.WEEKLY
                            ? WEEKDAYS.map((name, i) => (
                                <option key={name} value={String(i + 1)}>
                                  {name}
                                </option>
                              ))
                            : Array.from({ length: 31 }, (_, i) => (
                                <option key={i + 1} value={String(i + 1)}>
                                  {i + 1}
                                </option>
                              ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor="saved-report-recipients" className="form-label">
                      Email to
                    </label>
                    <textarea
                      id="saved-report-recipients"
                      className="form-input"
                      rows={3}
                      value={form.recipients}
                      onChange={(e) => update('recipients', e.target.value)}
                      placeholder="chief@department.org, training@department.org"
                    />
                    <p className="text-theme-text-secondary mt-1 text-xs">
                      Up to 25 addresses. A report that lists member data can only be emailed to members who are allowed
                      to see that data; the email itself carries totals, never member details.
                    </p>
                  </div>
                </div>
              )}

              {formError && (
                <p className="alert-danger text-theme-text-primary text-sm" role="alert">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeForm} className="btn-secondary">
                  Cancel
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={isSaving} className="btn-primary">
                  {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Save report'}
                </button>
              </div>
            </div>
          </DialogPanel>
        </div>
      )}
    </div>
  );
};

export default SavedReportsPage;
