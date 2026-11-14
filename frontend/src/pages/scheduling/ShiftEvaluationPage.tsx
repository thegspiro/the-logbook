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
 * The same page enters an outside preceptor's evaluation of a shift a member
 * logged on another agency's unit (ACFD, say), from the training officer's
 * list of outside shifts awaiting one:
 *
 * URL: /scheduling/outside-shifts/:entryId/evaluations/:scopeKey
 *
 * The preceptor has no account, so the training officer types the paper form
 * in and names the preceptor on it.
 *
 * The server decides who may open it (the shift's officer or training.manage;
 * training.manage alone for an outside shift) and whether the evaluation is
 * still called for; this page shows what it answers. Drafts save as the
 * officer goes: every 30 seconds while there are unsaved edits, and again when
 * the officer moves to another evaluation, leaves the page or puts the phone
 * away, so a locked phone loses nothing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Check, Loader2, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { ShiftEvaluationFields } from '../../components/training/ShiftEvaluationFields';
import { AUTO_SAVE_INTERVAL_MS } from '../../constants/config';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { shiftEvaluationService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type {
  ShiftEvaluationFormResponse,
  ShiftEvaluationRoster,
  ShiftEvaluationStatistic,
} from '../../types/training';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  OUTSIDE_SHIFT_EVALUATIONS_LIST_PATH,
  outsideShiftEvaluationPagePath,
  shiftEvaluationBody,
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

const ShiftEvaluationPage: React.FC = () => {
  const { shiftId = '', entryId = '', memberId: memberParam = '', scopeKey = '' } = useParams();
  // An outside shift's evaluation is addressed by the logged entry; the
  // member is whoever logged it, which the form names.
  const outside = entryId !== '';
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
  const [preceptorName, setPreceptorName] = useState('');
  const { confirm } = useConfirm();
  const dirty = useRef(false);
  // Bumped by every edit, so a save that finishes after another edit does not
  // mark that newer edit as saved.
  const editVersion = useRef(0);
  const inFlight = useRef(false);
  const problemsRef = useRef<HTMLDivElement>(null);
  // Read by save() when it starts rather than captured with it, so save keeps
  // one identity per evaluation and the autosave timer is not restarted by
  // every keystroke.
  const latest = useRef({ draft, templateId, preceptorName });
  latest.current = { draft, templateId, preceptorName };
  const routeKey = [outside ? 'outside' : 'shift', shiftId, entryId, memberParam, scopeKey].join('|');
  const currentRoute = useRef(routeKey);
  currentRoute.current = routeKey;

  const backPath = outside
    ? OUTSIDE_SHIFT_EVALUATIONS_LIST_PATH
    : `/scheduling?tab=shift-reports&shift=${encodeURIComponent(shiftId)}&view=create`;
  const backLabel = outside ? 'Back to outside shifts' : 'Back to shift report';

  const load = useCallback(
    async (chosenTemplate?: string) => {
      const [loaded, shiftRoster] = outside
        ? await Promise.all([
            shiftEvaluationService.getOutsideForm(entryId, scopeKey, chosenTemplate),
            shiftEvaluationService.getOutsideRoster(entryId),
          ])
        : await Promise.all([
            shiftEvaluationService.getForm(shiftId, memberParam, scopeKey, chosenTemplate),
            shiftEvaluationService.getRoster(shiftId),
          ]);
      setForm(loaded);
      setRoster(shiftRoster);
      setDraft(draftFrom(loaded));
      setPreceptorName(loaded.evaluation?.preceptor_name ?? '');
      setTemplateId(loaded.template_id);
      setSavedAt(loaded.evaluation?.updated_at ?? null);
      dirty.current = false;
    },
    [outside, entryId, shiftId, memberParam, scopeKey]
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
      // This evaluation's address, fixed when the save starts: the officer
      // may move to another crew member before it finishes.
      const savedRoute = [outside ? 'outside' : 'shift', shiftId, entryId, memberParam, scopeKey].join('|');
      const startedAt = editVersion.current;
      const { draft: body, templateId: chosen, preceptorName: preceptor } = latest.current;
      inFlight.current = true;
      setSaving(submit ? 'submit' : 'draft');
      try {
        const saved = outside
          ? await shiftEvaluationService.saveOutside(
              entryId,
              scopeKey,
              shiftEvaluationBody(body, submit, chosen, preceptor)
            )
          : await shiftEvaluationService.save(
              shiftId,
              memberParam,
              scopeKey,
              shiftEvaluationBody(body, submit, chosen, null)
            );
        // The page has moved on to another evaluation: this one is saved,
        // and none of it belongs on the screen now showing.
        if (currentRoute.current !== savedRoute) return true;
        if (editVersion.current === startedAt) dirty.current = false;
        setSavedAt(saved.updated_at);
        setForm((shown) =>
          shown ? { ...shown, evaluation: saved, template: saved.template, template_id: saved.template_id } : shown
        );
        return true;
      } catch (err: unknown) {
        toast.error(
          getErrorMessage(err, submit ? 'The evaluation could not be submitted' : 'The draft could not be saved')
        );
        return false;
      } finally {
        inFlight.current = false;
        setSaving(null);
      }
    },
    [outside, entryId, shiftId, memberParam, scopeKey]
  );

  // A draft the officer may save: not their own evaluation, and not one
  // already submitted, which is saved only on purpose so an edit to it is
  // never committed by a timer.
  const draftSavable =
    !!form && form.evaluation?.status !== 'submitted' && currentUserId !== form.requirement.member_id;
  const draftSavableRef = useRef(draftSavable);
  draftSavableRef.current = draftSavable;

  // Autosave on the app's usual cadence while there are unsaved edits.
  useEffect(() => {
    if (!draftSavable) return;
    const timer = window.setInterval(() => {
      if (dirty.current && !inFlight.current) void save(false);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [draftSavable, save]);

  // Save what is unsaved when the officer leaves this evaluation: another
  // crew member's chip, the back link, or closing the page. The cleanup runs
  // with this evaluation's own save, before the next one loads.
  useEffect(
    () => () => {
      if (dirty.current && draftSavableRef.current) void save(false);
    },
    [save]
  );

  // And when the phone is locked or the tab put away, which iOS may follow by
  // discarding the page without another chance.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && dirty.current && draftSavableRef.current && !inFlight.current) {
        void save(false);
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [save]);

  const markEdited = () => {
    dirty.current = true;
    editVersion.current += 1;
  };

  const change = (next: ShiftEvaluationDraft) => {
    markEdited();
    setDraft(next);
  };

  const switchTemplate = async (next: string) => {
    if (
      dirty.current &&
      !(await confirm({
        title: 'Switch to another form?',
        message: 'The answers on this form have not been saved and will be cleared.',
        confirmLabel: 'Switch form',
        cancelLabel: 'Keep this form',
      }))
    ) {
      return;
    }
    try {
      // The selector follows the form only once it has loaded, so a failed
      // switch leaves both on the form whose answers are on screen.
      await load(next);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'That form could not be opened'));
    }
  };

  const submit = async () => {
    if (!form) return;
    const problems = submitProblems();
    if (problems.length > 0) {
      setShowErrors(true);
      toast.error(problems[0] ?? 'Finish the evaluation first');
      // The list sits beside the Submit bar; bring it into view on a phone.
      window.setTimeout(() => problemsRef.current?.focus(), 0);
      return;
    }
    if (await save(true)) {
      toast.success('Evaluation submitted');
      void navigate(backPath);
    }
  };

  // The form's own checks, plus the preceptor's name on an outside shift,
  // which the server also refuses to submit without.
  function submitProblems(): string[] {
    if (!form) return [];
    const problems = shiftEvaluationProblems(form.template, draft);
    return outside && !preceptorName.trim() ? ['Enter the preceptor who evaluated the shift.', ...problems] : problems;
  }

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
          to={backPath}
          className="inline-flex items-center gap-1 text-sm font-medium text-red-800 dark:text-red-400"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        <p role="alert" className="alert-danger text-theme-alert-danger-text">
          {loadError || 'This evaluation could not be opened'}
        </p>
      </div>
    );
  }

  const requirement = form.requirement;
  const memberId = requirement.member_id;
  const isSelf = currentUserId === memberId;
  const submitted = form.evaluation?.status === 'submitted';
  const problems = showErrors ? submitProblems() : [];
  const canSwitchTemplate = requirement.template_options.length > 1 && !submitted;
  const startTime = form.shift_start ? formatTime(form.shift_start, tz) : '';
  const endTime = form.shift_end ? formatTime(form.shift_end, tz) : '';

  return (
    <div className="pb-safe mx-auto max-w-4xl space-y-4 p-4">
      <Link to={backPath} className="inline-flex items-center gap-1 text-sm font-medium text-red-800 dark:text-red-400">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
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
                to={
                  outside
                    ? outsideShiftEvaluationPagePath(entryId, r.scope_key)
                    : shiftEvaluationPagePath(shiftId, r.member_id, r.scope_key)
                }
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
              void switchTemplate(e.target.value);
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

      {outside && (
        <div className="card p-4">
          <label htmlFor="se-preceptor" className="form-label">
            Preceptor{' '}
            <span aria-hidden="true" className="text-red-700 dark:text-red-400">
              *
            </span>
          </label>
          <input
            id="se-preceptor"
            className="form-input"
            value={preceptorName}
            maxLength={200}
            autoComplete="off"
            disabled={isSelf}
            aria-required="true"
            aria-describedby="se-preceptor-hint"
            onChange={(e) => {
              markEdited();
              setPreceptorName(e.target.value);
            }}
          />
          <p id="se-preceptor-hint" className="text-theme-text-muted mt-1 text-xs">
            The {form.unit_label ? `${form.unit_label} ` : ''}preceptor who filled out the paper form. You are recorded
            as the person who entered it.
          </p>
        </div>
      )}

      <fieldset disabled={isSelf} className="min-w-0">
        <ShiftEvaluationFields form={form.template} draft={draft} onChange={change} showErrors={showErrors} />
      </fieldset>

      {problems.length > 0 && (
        <div ref={problemsRef} tabIndex={-1} role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          <p className="font-semibold">Before submitting:</p>
          <ul className="ml-5 list-disc">
            {problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="surface-opaque border-theme-surface-border action-bar-safe sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border p-3 shadow-sm">
        <Link to={backPath} className="btn-secondary inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> {outside ? 'Back' : 'Back to report'}
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
