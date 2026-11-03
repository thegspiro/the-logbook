/**
 * The steps between an empty Templates & periods page and the first drafted
 * evaluation, each marked done from what the department already has.
 *
 * A first-time chief otherwise meets two empty lists and has to discover the
 * rest — that evaluators need a grant, that only a published form can be
 * drafted from — by being refused. The checklist disappears once every step
 * is done, so a department that is up and running never sees it.
 *
 * Once a form is published and a period is open, it also asks the server who
 * drafting the period would leave out and why — the same preview "Draft a
 * review period" shows — so a member with no fitting form turns up here
 * rather than halfway through a bulk draft.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle } from 'lucide-react';
import { Collapsible } from '../../../../components/ux/Collapsible';
import { useAuthStore } from '../../../../stores/authStore';
import { evaluationsService } from '../../services/evaluationsApi';
import {
  EvaluationTemplateKind,
  type BulkDraftPreview,
  type EvaluationPeriod,
  type EvaluationTemplateSummary,
  type PersonRef,
} from '../../types/evaluations';

/** The bulk preview's reason for a member who already has an evaluation — not a gap to fix. */
const ALREADY_DRAFTED = 'Already has an evaluation';

interface EvaluationSetupChecklistProps {
  templates: EvaluationTemplateSummary[];
  periods: EvaluationPeriod[];
  canConfigure: boolean;
  canManage: boolean;
  canOpenConductList: boolean;
  onNewTemplate: () => void;
  onNewPeriod: () => void;
}

interface Step {
  id: string;
  title: string;
  done: boolean;
  detail: React.ReactNode;
  action?: React.ReactNode | undefined;
}

export const EvaluationSetupChecklist: React.FC<EvaluationSetupChecklistProps> = ({
  templates,
  periods,
  canConfigure,
  canManage,
  canOpenConductList,
  onNewTemplate,
  onNewPeriod,
}) => {
  const myId = useAuthStore((state) => state.user?.id);
  const canManageRoles = useAuthStore((state) => state.checkPermission('positions.manage_permissions'));
  const [evaluators, setEvaluators] = useState<PersonRef[] | null>(null);
  const [preview, setPreview] = useState<BulkDraftPreview | null>(null);

  const published = templates.filter((t) => t.is_active && t.published_version !== null);
  const openPeriod = periods.find((p) => !p.is_closed);
  const templateDone = published.length > 0;
  const periodDone = openPeriod !== undefined;
  const draftedDone = periods.some((p) => p.evaluations_count > 0);
  // Only the chief holds evaluations.conduct on install, so until somebody
  // else does, every evaluation falls to them.
  const conductDone = evaluators !== null && evaluators.some((e) => e.id !== myId);
  const previewKind = published.some((t) => t.kind === EvaluationTemplateKind.ANNUAL)
    ? EvaluationTemplateKind.ANNUAL
    : EvaluationTemplateKind.INTERIM;
  const allDone = templateDone && periodDone && conductDone && draftedDone;

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    evaluationsService
      .draftOptions()
      .then((options) => {
        if (!cancelled) setEvaluators(options.evaluators);
      })
      .catch(() => {
        // The step then reads as not yet confirmed; nothing else depends on it.
        if (!cancelled) setEvaluators(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const previewPeriodId = canManage && templateDone ? openPeriod?.id : undefined;
  useEffect(() => {
    if (!previewPeriodId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    evaluationsService
      .bulkPreview(previewPeriodId, previewKind)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewPeriodId, previewKind]);

  if (allDone) return null;

  const gaps = (preview?.rows ?? []).filter((row) => row.skip_reason && !row.skip_reason.startsWith(ALREADY_DRAFTED));
  const gapsByReason = new Map<string, string[]>();
  for (const row of gaps) {
    const reason = row.skip_reason ?? '';
    gapsByReason.set(reason, [...(gapsByReason.get(reason) ?? []), row.member.name]);
  }
  const unassigned = (preview?.rows ?? []).filter((row) => !row.skip_reason && !row.evaluator);

  const steps: Step[] = [
    {
      id: 'template',
      title: 'Publish an evaluation form',
      done: templateDone,
      detail: templateDone
        ? `${published.length} published.`
        : 'Start from a ready-made form and change its wording, or build your own. Only a published form can be used.',
      action:
        !templateDone && canConfigure ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onNewTemplate}>
            New template
          </button>
        ) : undefined,
    },
    {
      id: 'period',
      title: 'Open a review period',
      done: periodDone,
      detail: periodDone
        ? `${openPeriod?.name ?? ''} is open.`
        : 'The dates the evaluations cover, such as January 1 to December 31.',
      action:
        !periodDone && canManage ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onNewPeriod}>
            New review period
          </button>
        ) : undefined,
    },
    {
      id: 'conduct',
      title: 'Choose who conducts evaluations',
      done: conductDone,
      detail: conductDone
        ? `${evaluators?.length ?? 0} members can conduct evaluations.`
        : 'Give the Conduct evaluations permission to the positions that evaluate, such as Captain or Lieutenant. Until then, every evaluation falls to you.',
      action:
        !conductDone && canManageRoles ? (
          <Link to="/settings/roles" className="btn-secondary btn-sm">
            Role Management
          </Link>
        ) : undefined,
    },
    {
      id: 'draft',
      title: 'Draft the evaluations',
      done: draftedDone,
      detail: draftedDone
        ? 'Evaluations are under way.'
        : 'Draft one member at a time, or a whole review period at once. Members are emailed when their part opens.',
      action:
        !draftedDone && canOpenConductList && templateDone && periodDone ? (
          <Link to="/reports/evaluations/conduct" className="btn-secondary btn-sm">
            Go to drafting
          </Link>
        ) : undefined,
    },
  ];

  return (
    <section aria-labelledby="setup-checklist-heading" className="card mb-8 p-4 sm:p-6">
      <h2 id="setup-checklist-heading" className="text-theme-text-primary text-lg font-semibold">
        Getting started
      </h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        {steps.filter((s) => s.done).length} of {steps.length} done. This goes away once evaluations are under way.
      </p>
      <ol className="mt-4 space-y-4">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
            ) : (
              <Circle className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary font-medium">
                {step.title}
                <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
              </p>
              <p className="text-theme-text-secondary text-sm">{step.detail}</p>
            </div>
            {step.action && <div className="shrink-0">{step.action}</div>}
          </li>
        ))}
      </ol>

      {(gaps.length > 0 || unassigned.length > 0) && (
        <div className="alert-warning mt-5">
          <p className="text-theme-alert-warning-title text-sm font-medium">
            Before you draft {preview?.period.name ?? 'this period'}
          </p>
          <ul className="text-theme-alert-warning-text mt-2 space-y-2 text-sm">
            {[...gapsByReason.entries()].map(([reason, names]) => (
              <li key={reason}>
                <Collapsible
                  title={`${names.length} member${names.length === 1 ? '' : 's'} would be left out: ${reason}`}
                >
                  <p>{names.join(', ')}</p>
                </Collapsible>
              </li>
            ))}
            {unassigned.length > 0 && (
              <li>
                {unassigned.length} member{unassigned.length === 1 ? ' has' : 's have'} no supervisor who can conduct
                evaluations, so drafting will ask you to choose their evaluator.
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
};

export default EvaluationSetupChecklist;
