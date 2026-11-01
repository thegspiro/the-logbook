/**
 * Shift Evaluation page
 *
 * One member's evaluation for one shift, opened from the Shift Completion
 * Report. A page of its own rather than a panel in the report, so a shift
 * with two trainees does not stack two long forms into one screen; the strip
 * at the top moves between the shift's evaluations.
 *
 * URL: /scheduling/shift-reports/:shiftId/evaluations/:memberId/:scopeKey
 *
 * The server decides who may open it (the shift's officer or training.manage)
 * and whether the evaluation is still called for; this page shows what it
 * answers. Drafts save as the officer goes, so a locked phone loses nothing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Check, Loader2, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { ShiftEvaluationFields } from '../../components/training/ShiftEvaluationFields';
import { AUTO_SAVE_INTERVAL_MS } from '../../constants/config';
import { useTimezone } from '../../hooks/useTimezone';
import { shiftEvaluationService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type {
  ShiftEvaluationFormResponse,
  ShiftEvaluationRoster,
  ShiftEvaluationSaveBody,
  ShiftEvaluationStatistic,
} from '../../types/training';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  parseCount,
  shiftEvaluationPagePath,
  shiftEvaluationProblems,
  type ShiftEvaluationDraft,
} from '../../utils/shiftEvaluations';

const emptyDraft: ShiftEvaluationDraft = { header_values: {}, statistics: {}, responses: {}, closing_comments: '' };

/** The draft a loaded form starts from: the saved answers, or the shift's suggestions. */
function draftFrom(form: ShiftEvaluationFormResponse): ShiftEvaluationDraft {
  const saved = form.evaluation;
  if (saved) {
    const statistics: ShiftEvaluationDraft['statistics'] = {};
    Object.entries(saved.statistics).forEach(([key, value]) => {
      statistics[key as ShiftEvaluationStatistic] = String(value);
    });
    return {
      header_values: { ...saved.header_values },
      statistics,
      responses: { ...saved.responses },
      closing_comments: saved.closing_comments ?? '',
    };
  }
  const statistics: ShiftEvaluationDraft['statistics'] = {};
  form.template.statistics.forEach((stat) => {
    const suggested = form.prefill_statistics[stat];
    if (suggested !== undefined) statistics[stat] = String(suggested);
  });
  // A choice field named for the platoon starts on the shift's own platoon.
  const header_values: Record<string, string> = {};
  form.template.header_fields.forEach((field) => {
    if (field.type === 'choice' && form.platoon && field.options.includes(form.platoon)) {
      header_values[field.key ?? ''] = form.platoon;
    }
  });
  return { header_values, statistics, responses: {}, closing_comments: '' };
}

function bodyFrom(draft: ShiftEvaluationDraft, submit: boolean, templateId: string | null): ShiftEvaluationSaveBody {
  const statistics: ShiftEvaluationSaveBody['statistics'] = {};
  (Object.keys(draft.statistics) as ShiftEvaluationStatistic[]).forEach((stat) => {
    const count = parseCount(draft.statistics[stat]);
    if (count !== undefined) statistics[stat] = count;
  });
  return {
    template_id: templateId || undefined,
    header_values: draft.header_values,
    statistics,
    responses: Object.fromEntries(
      Object.entries(draft.responses).map(([key, answer]) => [
        key,
        { rating: answer.rating, not_applicable: answer.not_applicable, comment: answer.comment?.trim() || null },
      ])
    ),
    closing_comments: draft.closing_comments.trim() || null,
    submit,
  };
}

const ShiftEvaluationPage: React.FC = () => {
  const { shiftId = '', memberId = '', scopeKey = '' } = useParams();
  const navigate = useNavigate();
  const tz = useTimezone();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [form, setForm] = useState<ShiftEvaluationFormResponse | null>(null);
  const [roster, setRoster] = useState<ShiftEvaluationRoster | null>(null);
  const [draft, setDraft] = useState<ShiftEvaluationDraft>(emptyDraft);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = useRef(false);

  const reportPath = `/scheduling?tab=shift-reports&shift=${encodeURIComponent(shiftId)}&view=create`;

  const load = useCallback(
    async (chosenTemplate?: string) => {
      const [loaded, shiftRoster] = await Promise.all([
        shiftEvaluationService.getForm(shiftId, memberId, scopeKey, chosenTemplate),
        shiftEvaluationService.getRoster(shiftId),
      ]);
      setForm(loaded);
      setRoster(shiftRoster);
      setDraft(draftFrom(loaded));
      setTemplateId(loaded.template_id);
      setSavedAt(loaded.evaluation?.updated_at ?? null);
      dirty.current = false;
    },
    [shiftId, memberId, scopeKey]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setShowErrors(false);
    load()
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'This evaluation could not be opened'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const save = useCallback(
    async (submit: boolean): Promise<boolean> => {
      if (!form) return false;
      setSaving(submit ? 'submit' : 'draft');
      try {
        const saved = await shiftEvaluationService.save(
          shiftId,
          memberId,
          scopeKey,
          bodyFrom(draft, submit, templateId)
        );
        dirty.current = false;
        setSavedAt(saved.updated_at);
        setForm({ ...form, evaluation: saved, template: saved.template, template_id: saved.template_id });
        return true;
      } catch (err: unknown) {
        toast.error(
          getErrorMessage(err, submit ? 'The evaluation could not be submitted' : 'The draft could not be saved')
        );
        return false;
      } finally {
        setSaving(null);
      }
    },
    [form, draft, templateId, shiftId, memberId, scopeKey]
  );

  // Autosave a draft that has changed, on the app's usual cadence. A
  // submitted evaluation is saved only on purpose, so an edit to it is never
  // committed by a timer.
  useEffect(() => {
    if (!form || form.evaluation?.status === 'submitted') return;
    const timer = window.setInterval(() => {
      if (dirty.current && !saving) void save(false);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [form, save, saving]);

  const change = (next: ShiftEvaluationDraft) => {
    dirty.current = true;
    setDraft(next);
  };

  const submit = async () => {
    if (!form) return;
    const problems = shiftEvaluationProblems(form.template, draft);
    if (problems.length > 0) {
      setShowErrors(true);
      toast.error(problems[0] ?? 'Finish the evaluation first');
      return;
    }
    if (await save(true)) {
      toast.success('Evaluation submitted');
      void navigate(reportPath);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16" aria-busy="true">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading evaluation" />
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Link
          to={reportPath}
          className="inline-flex items-center gap-1 text-sm font-medium text-red-800 dark:text-red-400"
        >
          <ArrowLeft className="h-4 w-4" /> Back to shift report
        </Link>
        <p role="alert" className="alert-danger text-theme-alert-danger-text">
          {loadError || 'This evaluation could not be opened'}
        </p>
      </div>
    );
  }

  const requirement = form.requirement;
  const isSelf = currentUserId === memberId;
  const submitted = form.evaluation?.status === 'submitted';
  const problems = showErrors ? shiftEvaluationProblems(form.template, draft) : [];
  const canSwitchTemplate = requirement.template_options.length > 1 && !submitted;
  const startTime = form.shift_start ? formatTime(form.shift_start, tz) : '';
  const endTime = form.shift_end ? formatTime(form.shift_end, tz) : '';

  return (
    <div className="pb-safe mx-auto max-w-4xl space-y-4 p-4">
      <Link
        to={reportPath}
        className="inline-flex items-center gap-1 text-sm font-medium text-red-800 dark:text-red-400"
      >
        <ArrowLeft className="h-4 w-4" /> Back to shift report
      </Link>

      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-theme-text-primary text-xl font-bold">
            {form.template.name} — {requirement.member_name}
          </h1>
          <p className="text-theme-text-secondary text-sm">
            {formatCalendarDate(form.shift_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            {startTime && ` · ${startTime}–${endTime}`}
            {form.unit_label && ` · ${form.unit_label}`}
            {form.platoon && ` · ${form.platoon} platoon`}
            {requirement.program_names.length > 0 && ` · ${requirement.program_names.join(', ')}`}
          </p>
        </div>
        <span
          className={`badge ${
            submitted
              ? 'bg-theme-alert-success-bg text-theme-alert-success-text'
              : 'bg-theme-alert-warning-bg text-theme-alert-warning-text'
          }`}
        >
          {submitted ? 'Submitted' : savedAt ? 'Draft saved' : 'Not saved yet'}
        </span>
      </header>

      {roster && roster.requirements.length > 1 && (
        <nav aria-label="Evaluations on this shift" className="card hscroll flex items-center gap-2 p-2">
          {roster.requirements.map((r) => {
            const current = r.member_id === memberId && r.scope_key === scopeKey;
            const done = r.evaluation?.status === 'submitted';
            return (
              <Link
                key={`${r.member_id}-${r.scope_key}`}
                to={shiftEvaluationPagePath(shiftId, r.member_id, r.scope_key)}
                aria-current={current ? 'page' : undefined}
                className={`touch-target-phone inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${
                  current
                    ? 'border-red-800 bg-red-800 text-white'
                    : 'border-theme-surface-border text-theme-text-secondary'
                }`}
              >
                {done && <Check className="h-3.5 w-3.5" aria-label="Submitted" />}
                {r.member_name}
                {r.program_names.length > 0 && <span className="font-normal">· {r.program_names.join(', ')}</span>}
              </Link>
            );
          })}
        </nav>
      )}

      {isSelf && (
        <p role="alert" className="alert-warning text-theme-alert-warning-text text-sm">
          This is your own evaluation. Another officer or a training officer must fill it out.
        </p>
      )}

      {canSwitchTemplate && (
        <div className="card p-4">
          <label htmlFor="se-template" className="form-label">
            Form
          </label>
          <select
            id="se-template"
            className="form-input"
            value={templateId ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              setTemplateId(next);
              void load(next).catch((err: unknown) =>
                toast.error(getErrorMessage(err, 'That form could not be opened'))
              );
            }}
          >
            {requirement.template_options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">
            This evaluation counts for {requirement.program_names.join(' and ')}. Choose which form to fill out.
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <div role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          <p className="font-semibold">Before submitting:</p>
          <ul className="ml-5 list-disc">
            {problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={isSelf} className="min-w-0">
        <ShiftEvaluationFields form={form.template} draft={draft} onChange={change} showErrors={showErrors} />
      </fieldset>

      <div className="surface-opaque border-theme-surface-border action-bar-safe sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border p-3 shadow-sm">
        <Link to={reportPath} className="btn-secondary inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to report
        </Link>
        <span className="flex-1" />
        {!submitted && (
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1"
            disabled={isSelf || saving !== null}
            onClick={() => {
              void save(false).then((ok) => ok && toast.success('Draft saved'));
            }}
          >
            {saving === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save draft
          </button>
        )}
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1"
          disabled={isSelf || saving !== null}
          onClick={() => void submit()}
        >
          {saving === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitted ? 'Save changes' : 'Submit evaluation'}
        </button>
      </div>
    </div>
  );
};

export default ShiftEvaluationPage;
