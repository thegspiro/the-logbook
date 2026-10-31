/**
 * Evaluation template builder (`evaluations.configure`).
 *
 * Edits the template's draft. When only a published version exists, the
 * builder starts from a copy of it, and the first save opens the next
 * version's draft — the published one is frozen, because evaluations already
 * started point at it. Publishing is the server's decision: it returns every
 * reason a draft is not ready, and the page lists them as given rather than
 * re-checking the rules here (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Info, Save, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { SectionsEditor } from '../components/evaluations/SectionsEditor';
import { WorkflowEditor } from '../components/evaluations/WorkflowEditor';
import { evaluationTemplatesService } from '../services/evaluationsApi';
import {
  EvaluationTemplateKind,
  MEMBER_CLASS_OPTIONS,
  MEMBER_STATUS_OPTIONS,
  type BuilderOptions,
  type EvaluationDataSource,
  type EvaluationTemplateDetail,
  type TemplateDefinition,
  type TemplateWorkflow,
} from '../types/evaluations';
import { describeMatching } from '../utils/evaluationTemplate';

type Tab = 'sections' | 'workflow' | 'details';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sections', label: 'Sections & items' },
  { id: 'workflow', label: 'Workflow & deadlines' },
  { id: 'details', label: 'Details & matching' },
];

interface DetailsForm {
  name: string;
  description: string;
  member_class: string;
  member_status: string;
  is_active: boolean;
}

const detailsFrom = (template: EvaluationTemplateDetail): DetailsForm => ({
  name: template.name,
  description: template.description ?? '',
  member_class: template.member_class ?? '',
  member_status: template.member_status ?? '',
  is_active: template.is_active,
});

const EvaluationTemplateBuilderPage: React.FC = () => {
  const { templateId = '' } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const tz = useTimezone();

  const [template, setTemplate] = useState<EvaluationTemplateDetail | null>(null);
  const [dataSources, setDataSources] = useState<EvaluationDataSource[]>([]);
  const [options, setOptions] = useState<BuilderOptions>({ positions: [], ranks: [] });
  const [definition, setDefinition] = useState<TemplateDefinition | null>(null);
  const [workflow, setWorkflow] = useState<TemplateWorkflow | null>(null);
  const [details, setDetails] = useState<DetailsForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('sections');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);

  const adopt = useCallback((detail: EvaluationTemplateDetail) => {
    const working = detail.draft ?? detail.published;
    setTemplate(detail);
    setDefinition(working ? working.definition : null);
    setWorkflow(working ? working.workflow : null);
    setDetails(detailsFrom(detail));
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [detail, sources, builderOptions] = await Promise.all([
          evaluationTemplatesService.get(templateId),
          evaluationTemplatesService.dataSources(),
          evaluationTemplatesService.builderOptions(),
        ]);
        if (cancelled) return;
        adopt(detail);
        setDataSources(sources);
        setOptions(builderOptions);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load this template.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, adopt]);

  const editDefinition = (next: TemplateDefinition) => {
    setDefinition(next);
    setDirty(true);
    setPublishErrors([]);
  };

  const editWorkflow = (next: TemplateWorkflow) => {
    setWorkflow(next);
    setDirty(true);
    setPublishErrors([]);
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!definition || !workflow) return false;
    setBusy(true);
    try {
      adopt(await evaluationTemplatesService.saveDraft(templateId, definition, workflow));
      toast.success('Draft saved');
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the draft.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (dirty && !(await saveDraft())) return;
    const ok = await confirm({
      title: 'Publish this version?',
      message:
        'New evaluations will use this version. Evaluations already started keep the version they began on, and a published version cannot be edited — later changes become the next version.',
      confirmLabel: 'Publish',
      cancelLabel: 'Not yet',
      variant: 'info',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await evaluationTemplatesService.publish(templateId);
      if (result.published && result.template) {
        adopt(result.template);
        setPublishErrors([]);
        toast.success(`Published version ${result.template.published_version ?? ''}`);
      } else {
        setPublishErrors(result.errors);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not publish the template.'));
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async () => {
    const ok = await confirm({
      title: 'Discard unpublished changes?',
      message: `The draft is removed and the builder returns to published version ${template?.published_version ?? ''}.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      adopt(await evaluationTemplatesService.discardDraft(templateId));
      setPublishErrors([]);
      toast.success('Draft discarded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not discard the draft.'));
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!details) return;
    setBusy(true);
    try {
      const updated = await evaluationTemplatesService.update(templateId, {
        name: details.name.trim(),
        description: blankToNull(details.description),
        member_class: blankToNull(details.member_class),
        member_status: blankToNull(details.member_status),
        is_active: details.is_active,
      });
      setTemplate(updated);
      setDetails(detailsFrom(updated));
      toast.success('Details saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the details.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async () => {
    const ok = await confirm({
      title: 'Delete this template?',
      message: `"${template?.name ?? ''}" and all of its versions will be deleted. No evaluation has used it.`,
      confirmLabel: 'Delete template',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await evaluationTemplatesService.remove(templateId);
      toast.success('Template deleted');
      void navigate('/reports/evaluations');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the template.'));
    }
  };

  const versionNote = useMemo(() => {
    if (!template) return '';
    if (template.draft) {
      return template.published_version === null
        ? `Draft v${template.draft.version_number} — not yet published`
        : `Draft v${template.draft.version_number} — v${template.published_version} is in use`;
    }
    if (template.published) {
      return `Published v${template.published.version_number} on ${formatDateTime(template.published.published_at, tz)}. Saving starts the next version.`;
    }
    return '';
  }, [template, tz]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="alert-danger">
          <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
        </div>
        <Link to="/reports/evaluations" className="btn-secondary mt-4 inline-flex">
          Back to evaluations
        </Link>
      </div>
    );
  }

  if (!template || !definition || !workflow || !details) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-theme-text-secondary text-sm">Loading template…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/reports/evaluations"
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Evaluations
        </Link>
        <div className="page-header mb-4 gap-3 sm:items-start">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-3xl font-bold">{template.name}</h1>
            <p className="text-theme-text-secondary mt-1">
              {describeMatching(template.member_class, template.member_status)} ·{' '}
              {template.kind === EvaluationTemplateKind.INTERIM ? 'Check-in' : 'Annual evaluation'} · {versionNote}
            </p>
          </div>
          <div className="page-header-actions flex flex-wrap gap-2">
            {template.draft && template.published && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => void discardDraft()}
              >
                Discard changes
              </button>
            )}
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
              disabled={busy || !dirty}
              onClick={() => void saveDraft()}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save draft
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 text-sm"
              disabled={busy || (!template.draft && !dirty)}
              onClick={() => void publish()}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Publish
            </button>
          </div>
        </div>

        {dirty && (
          <p className="text-theme-text-muted mb-4 text-xs" role="status">
            Unsaved changes
          </p>
        )}

        {publishErrors.length > 0 && (
          <div className="alert-warning mb-6" role="alert">
            <p className="text-theme-alert-warning-title text-sm font-medium">This draft is not ready to publish:</p>
            <ul className="text-theme-alert-warning-text mt-2 list-disc space-y-1 pl-5 text-sm">
              {publishErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="tab-scroll mb-6" role="tablist" aria-label="Template builder">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={`${
                tab === entry.id
                  ? 'text-theme-text-primary border-red-800'
                  : 'text-theme-text-secondary border-transparent'
              } touch:min-h-11 -mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'sections' && (
            <SectionsEditor
              definition={definition}
              dataSources={dataSources}
              ranks={options.ranks}
              onChange={editDefinition}
            />
          )}
          {tab === 'workflow' && (
            <WorkflowEditor
              workflow={workflow}
              kind={template.kind}
              positions={options.positions}
              onChange={editWorkflow}
            />
          )}
          {tab === 'details' && (
            <form className="card max-w-3xl space-y-4 p-4 sm:p-6" onSubmit={(event) => void saveDetails(event)}>
              <div className="alert-info flex gap-3">
                <Info className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-theme-alert-info-text text-sm">
                  These details take effect immediately and are not part of the draft.
                </p>
              </div>
              <div>
                <label htmlFor="details-name" className="form-label">
                  Name
                </label>
                <input
                  id="details-name"
                  className="form-input"
                  required
                  maxLength={150}
                  value={details.name}
                  onChange={(e) => setDetails({ ...details, name: e.target.value })}
                />
              </div>
              <div className="form-grid-2 gap-4">
                <div>
                  <label htmlFor="details-class" className="form-label">
                    Member class
                  </label>
                  <select
                    id="details-class"
                    className="form-input"
                    value={details.member_class}
                    onChange={(e) => setDetails({ ...details, member_class: e.target.value })}
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
                  <label htmlFor="details-status" className="form-label">
                    Member status
                  </label>
                  <select
                    id="details-status"
                    className="form-input"
                    value={details.member_status}
                    onChange={(e) => setDetails({ ...details, member_status: e.target.value })}
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
              <div>
                <label htmlFor="details-description" className="form-label">
                  Description <span className="text-theme-text-muted font-normal">(optional)</span>
                </label>
                <textarea
                  id="details-description"
                  className="form-input"
                  rows={3}
                  maxLength={2000}
                  value={details.description}
                  onChange={(e) => setDetails({ ...details, description: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={details.is_active}
                  onChange={(e) => setDetails({ ...details, is_active: e.target.checked })}
                />
                <span className="text-theme-text-secondary">Active — offered when evaluations are drafted</span>
              </label>
              <div className="flex flex-wrap justify-between gap-2">
                {template.evaluations_count === 0 ? (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2 text-sm"
                    onClick={() => void deleteTemplate()}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete template
                  </button>
                ) : (
                  <span className="text-theme-text-muted text-xs">
                    Used by {template.evaluations_count} evaluation{template.evaluations_count === 1 ? '' : 's'}, so it
                    is kept with them. Retire it by unticking Active.
                  </span>
                )}
                <button type="submit" className="btn-primary text-sm" disabled={busy}>
                  Save details
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvaluationTemplateBuilderPage;
