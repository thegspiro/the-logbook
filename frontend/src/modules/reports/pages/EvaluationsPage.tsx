/**
 * Member Evaluations — setup.
 *
 * Templates (`evaluations.configure`) and review periods
 * (`evaluations.manage`). Each grant may read the other's list: a period
 * manager needs to see which form each member will get, and a template
 * builder needs the periods its deadlines count from.
 *
 * Drafting, completing and signing evaluations happens on the Evaluations list.
 * Email notices are not yet built, and the page says so rather than presenting
 * the workflow as complete (CLAUDE.md pitfall #19).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, CalendarRange, ClipboardCheck, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { evaluationPeriodsService, evaluationTemplatesService } from '../services/evaluationsApi';
import {
  EvaluationTemplateKind,
  MEMBER_CLASS_OPTIONS,
  MEMBER_STATUS_OPTIONS,
  type EvaluationPeriod,
  type EvaluationTemplateSummary,
} from '../types/evaluations';
import { describeMatching } from '../utils/evaluationTemplate';

interface TemplateFormState {
  name: string;
  description: string;
  kind: EvaluationTemplateKind;
  member_class: string;
  member_status: string;
}

const EMPTY_TEMPLATE: TemplateFormState = {
  name: '',
  description: '',
  kind: EvaluationTemplateKind.ANNUAL,
  member_class: '',
  member_status: '',
};

interface PeriodFormState {
  id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  locked: boolean;
}

const EMPTY_PERIOD: PeriodFormState = { id: null, name: '', start_date: '', end_date: '', locked: false };

function templateStatus(template: EvaluationTemplateSummary): { label: string; className: string } {
  if (!template.is_active) return { label: 'Retired', className: 'bg-slate-500/15 text-theme-text-secondary' };
  if (template.published_version === null) {
    return { label: 'Draft — not published', className: 'bg-amber-500/20 text-amber-900 dark:text-amber-300' };
  }
  return {
    label: `Published v${template.published_version}`,
    className: 'bg-green-500/15 text-green-800 dark:text-green-300',
  };
}

const EvaluationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const canConfigure = useAuthStore((state) => state.checkPermission('evaluations.configure'));
  const canManage = useAuthStore((state) => state.checkPermission('evaluations.manage'));

  const [templates, setTemplates] = useState<EvaluationTemplateSummary[]>([]);
  const [periods, setPeriods] = useState<EvaluationPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState | null>(null);
  const [periodForm, setPeriodForm] = useState<PeriodFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [templateList, periodList] = await Promise.all([
        evaluationTemplatesService.list(),
        evaluationPeriodsService.list(),
      ]);
      setTemplates(templateList);
      setPeriods(periodList);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load evaluation setup.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateForm) return;
    setSaving(true);
    try {
      const created = await evaluationTemplatesService.create({
        name: templateForm.name.trim(),
        description: templateForm.description.trim() || undefined,
        kind: templateForm.kind,
        member_class: templateForm.member_class || undefined,
        member_status: templateForm.member_status || undefined,
      });
      toast.success('Template created');
      setTemplateForm(null);
      void navigate(`/reports/evaluations/templates/${created.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not create the template.'));
    } finally {
      setSaving(false);
    }
  };

  const submitPeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!periodForm) return;
    setSaving(true);
    try {
      if (periodForm.id) {
        await evaluationPeriodsService.update(periodForm.id, {
          name: periodForm.name.trim(),
          ...(periodForm.locked ? {} : { start_date: periodForm.start_date, end_date: periodForm.end_date }),
        });
        toast.success('Review period updated');
      } else {
        await evaluationPeriodsService.create({
          name: periodForm.name.trim(),
          start_date: periodForm.start_date,
          end_date: periodForm.end_date,
        });
        toast.success('Review period opened');
      }
      setPeriodForm(null);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the review period.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleClosed = async (period: EvaluationPeriod) => {
    try {
      await evaluationPeriodsService.update(period.id, { is_closed: !period.is_closed });
      toast.success(period.is_closed ? 'Review period reopened' : 'Review period closed');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the review period.'));
    }
  };

  const deletePeriod = async (period: EvaluationPeriod) => {
    const ok = await confirm({
      title: 'Delete review period?',
      message: `"${period.name}" will be deleted. Nothing has been drafted for it.`,
      confirmLabel: 'Delete period',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await evaluationPeriodsService.remove(period.id);
      toast.success('Review period deleted');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the review period.'));
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
            <h1 className="text-theme-text-primary text-3xl font-bold">Member Evaluations</h1>
            <p className="text-theme-text-secondary mt-1">
              Build the evaluation forms for each kind of member and open the review periods they are completed for.
            </p>
          </div>
        </div>

        <div className="alert-info mb-6 flex gap-3">
          <Info className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-info-text text-sm">
            <span className="text-theme-alert-info-title font-medium">Email notices are not yet available.</span>{' '}
            Evaluations are drafted, completed and signed from the{' '}
            <Link to="/reports/evaluations/conduct" className="underline">
              Evaluations
            </Link>{' '}
            list, and each finalized evaluation keeps its signed PDF. Email notices and deadline reminders arrive in a
            later update, so people are not yet told when a step is waiting on them.
          </p>
        </div>

        {loadError && (
          <div className="alert-danger mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        <section aria-labelledby="templates-heading" className="mb-10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="templates-heading"
              className="text-theme-text-primary flex items-center gap-2 text-xl font-semibold"
            >
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
              Templates
            </h2>
            {canConfigure && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 text-sm"
                onClick={() => setTemplateForm(EMPTY_TEMPLATE)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New template
              </button>
            )}
          </div>
          {loading && templates.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">Loading templates…</p>
          ) : templates.length === 0 && !loadError ? (
            <EmptyState
              title="No templates yet"
              description={
                canConfigure
                  ? 'Start with one template per member class, plus one for probationary members.'
                  : 'Nobody has built an evaluation template yet.'
              }
            />
          ) : (
            <ul className="card-grid">
              {templates.map((template) => {
                const status = templateStatus(template);
                return (
                  <li key={template.id} className="card flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-theme-text-primary text-lg font-semibold">{template.name}</h3>
                      <span className={`badge shrink-0 ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="text-theme-text-secondary text-sm">
                      {describeMatching(template.member_class, template.member_status)} ·{' '}
                      {template.kind === EvaluationTemplateKind.INTERIM ? 'Check-in' : 'Annual'}
                    </p>
                    {template.description && (
                      <p className="text-theme-text-secondary text-sm">{template.description}</p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                      <span className="text-theme-text-muted text-xs">
                        {template.has_draft && template.published_version !== null ? 'Unpublished changes · ' : ''}
                        {template.evaluations_count} evaluation{template.evaluations_count === 1 ? '' : 's'}
                      </span>
                      {canConfigure && (
                        <Link
                          to={`/reports/evaluations/templates/${template.id}`}
                          className="btn-secondary btn-sm inline-flex items-center gap-1"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Open builder
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="periods-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="periods-heading" className="text-theme-text-primary flex items-center gap-2 text-xl font-semibold">
              <CalendarRange className="h-5 w-5" aria-hidden="true" />
              Review periods
            </h2>
            {canManage && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 text-sm"
                onClick={() => setPeriodForm(EMPTY_PERIOD)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New review period
              </button>
            )}
          </div>
          {loading && periods.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">Loading review periods…</p>
          ) : periods.length === 0 && !loadError ? (
            <EmptyState
              title="No review periods yet"
              description={
                canManage
                  ? 'Open a period such as "2026 Annual Review" for the dates evaluations will cover.'
                  : 'No review period has been opened yet.'
              }
            />
          ) : (
            <div className="card overflow-hidden">
              <table className="rwd-table w-full text-sm">
                <thead className="bg-theme-surface-secondary text-theme-text-secondary text-left text-xs uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Period
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Dates
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Evaluations
                    </th>
                    {canManage && (
                      <th scope="col" className="px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {periods.map((period) => (
                    <tr key={period.id}>
                      <td data-label="Period" className="rwd-table-lead text-theme-text-primary px-4 py-3 font-medium">
                        {period.name}
                      </td>
                      <td data-label="Dates" className="text-theme-text-secondary px-4 py-3">
                        {formatCalendarDate(period.start_date)} – {formatCalendarDate(period.end_date)}
                      </td>
                      <td data-label="Status" className="px-4 py-3">
                        <span
                          className={`badge ${
                            period.is_closed
                              ? 'text-theme-text-secondary bg-slate-500/15'
                              : 'bg-green-500/15 text-green-800 dark:text-green-300'
                          }`}
                        >
                          {period.is_closed ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td data-label="Evaluations" className="text-theme-text-secondary px-4 py-3">
                        {period.evaluations_count}
                      </td>
                      {canManage && (
                        <td data-label="Actions" className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() =>
                                setPeriodForm({
                                  id: period.id,
                                  name: period.name,
                                  start_date: period.start_date,
                                  end_date: period.end_date,
                                  locked: period.evaluations_count > 0,
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => void toggleClosed(period)}
                            >
                              {period.is_closed ? 'Reopen' : 'Close'}
                            </button>
                            {period.evaluations_count === 0 && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                aria-label={`Delete ${period.name}`}
                                onClick={() => void deletePeriod(period)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={templateForm !== null}
        onClose={() => setTemplateForm(null)}
        title="New evaluation template"
        onSubmit={(event) => void submitTemplate(event)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setTemplateForm(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              Create and open builder
            </button>
          </div>
        }
      >
        {templateForm && (
          <div className="space-y-4">
            <div>
              <label htmlFor="template-name" className="form-label">
                Name
              </label>
              <input
                id="template-name"
                className="form-input"
                required
                maxLength={150}
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="template-kind" className="form-label">
                Kind
              </label>
              <select
                id="template-kind"
                className="form-input"
                value={templateForm.kind}
                onChange={(e) => setTemplateForm({ ...templateForm, kind: e.target.value as EvaluationTemplateKind })}
              >
                <option value={EvaluationTemplateKind.ANNUAL}>Annual evaluation (with signatures)</option>
                <option value={EvaluationTemplateKind.INTERIM}>Check-in (no signatures)</option>
              </select>
            </div>
            <div className="form-grid-2 gap-4">
              <div>
                <label htmlFor="template-class" className="form-label">
                  Member class
                </label>
                <select
                  id="template-class"
                  className="form-input"
                  value={templateForm.member_class}
                  onChange={(e) => setTemplateForm({ ...templateForm, member_class: e.target.value })}
                >
                  <option value="">Any class</option>
                  {MEMBER_CLASS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="template-status" className="form-label">
                  Member status
                </label>
                <select
                  id="template-status"
                  className="form-input"
                  value={templateForm.member_status}
                  onChange={(e) => setTemplateForm({ ...templateForm, member_status: e.target.value })}
                >
                  <option value="">Any status</option>
                  {MEMBER_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-theme-text-muted text-xs">
              When two templates fit a member, the more specific one is used — a Probationary template wins over a
              general Operational one.
            </p>
            <div>
              <label htmlFor="template-description" className="form-label">
                Description <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <textarea
                id="template-description"
                className="form-input"
                rows={2}
                maxLength={2000}
                value={templateForm.description}
                onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={periodForm !== null}
        onClose={() => setPeriodForm(null)}
        title={periodForm?.id ? 'Edit review period' : 'New review period'}
        onSubmit={(event) => void submitPeriod(event)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPeriodForm(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {periodForm?.id ? 'Save period' : 'Open period'}
            </button>
          </div>
        }
      >
        {periodForm && (
          <div className="space-y-4">
            <div>
              <label htmlFor="period-name" className="form-label">
                Name
              </label>
              <input
                id="period-name"
                className="form-input"
                required
                maxLength={150}
                placeholder="2026 Annual Review"
                value={periodForm.name}
                onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
              />
            </div>
            <div className="form-grid-2 gap-4">
              <div>
                <label htmlFor="period-start" className="form-label">
                  Starts
                </label>
                <input
                  id="period-start"
                  type="date"
                  className="form-input"
                  required
                  disabled={periodForm.locked}
                  value={periodForm.start_date}
                  onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="period-end" className="form-label">
                  Ends
                </label>
                <input
                  id="period-end"
                  type="date"
                  className="form-input"
                  required
                  disabled={periodForm.locked}
                  min={periodForm.start_date || undefined}
                  value={periodForm.end_date}
                  onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })}
                />
              </div>
            </div>
            {periodForm.locked && (
              <p className="text-theme-text-muted text-xs">
                Evaluations have been drafted for this period, so its dates are fixed.
              </p>
            )}
            <p className="text-theme-text-muted text-xs">
              Each member is evaluated only for the time they were serving: from the first full month after they joined,
              leaving out separations and approved leaves of absence.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default EvaluationsPage;
