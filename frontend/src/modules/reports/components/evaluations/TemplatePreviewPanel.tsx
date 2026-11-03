/**
 * The builder's form as the evaluator or the member will see it, filled with
 * figures, before it is published.
 *
 * Publishing freezes a version, so a confusing item or a score band that
 * suggests the wrong rating would otherwise be found only once evaluations
 * were under way. The preview renders the form as it stands in the builder,
 * unsaved edits included, through the same `EvaluationForm` an evaluation
 * uses, and answers typed into it are kept nowhere.
 *
 * A real member's figures are offered only to a builder who also holds
 * `evaluations.view_all` (owner decision 2026-11-03); the server enforces it
 * and audits each such preview. Everyone else previews with sample figures.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationTemplatesService } from '../../services/evaluationsApi';
import {
  EvaluationPartKind,
  type PartContent,
  type PreviewOptions,
  type TemplateDefinition,
  type TemplatePreview,
} from '../../types/evaluations';
import { emptyContent } from '../../utils/evaluationRecord';
import { EvaluationForm } from './EvaluationForm';

interface TemplatePreviewPanelProps {
  definition: TemplateDefinition;
}

type PreviewPart = typeof EvaluationPartKind.EVALUATOR | typeof EvaluationPartKind.SELF_EVALUATION;

export const TemplatePreviewPanel: React.FC<TemplatePreviewPanelProps> = ({ definition }) => {
  const [options, setOptions] = useState<PreviewOptions | null>(null);
  const [memberId, setMemberId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [part, setPart] = useState<PreviewPart>(EvaluationPartKind.EVALUATOR);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [content, setContent] = useState<PartContent>(emptyContent());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    evaluationTemplatesService
      .previewOptions()
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
        // The latest period is what the next evaluations will most likely cover.
        setPeriodId(result.periods[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the preview options.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (forMember: string, forPeriod: string) => {
      setLoading(true);
      setError(null);
      try {
        setPreview(await evaluationTemplatesService.preview(definition, forMember, forPeriod));
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not preview the form.'));
      } finally {
        setLoading(false);
      }
    },
    [definition]
  );

  // Re-measured whenever who or when changes. Edits made on the other tabs
  // are picked up because the panel mounts afresh each time its tab opens.
  useEffect(() => {
    if (options === null) return;
    void run(memberId, periodId);
  }, [options, memberId, periodId, run]);

  const shown: TemplateDefinition = preview?.includes_officer_sections
    ? definition
    : { ...definition, sections: definition.sections.filter((section) => !section.officer_only) };
  const hiddenOfficerSections = definition.sections.length - shown.sections.length;

  return (
    <div className="space-y-6">
      <div className="card p-4 sm:p-6">
        <p className="text-theme-text-secondary text-sm">
          This is the form as it stands, including changes you have not saved. Nothing you enter here is kept.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="preview-member" className="form-label">
              Figures from
            </label>
            {options?.can_use_member_data ? (
              <select
                id="preview-member"
                className="form-input"
                value={memberId}
                onChange={(e) => {
                  setMemberId(e.target.value);
                  setContent(emptyContent());
                }}
              >
                <option value="">Sample figures</option>
                {options.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select id="preview-member" className="form-input" value="" disabled>
                  <option value="">Sample figures</option>
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Previewing with a member&apos;s figures needs the View all evaluations permission.
                </p>
              </>
            )}
          </div>
          <div>
            <label htmlFor="preview-period" className="form-label">
              Review period
            </label>
            <select
              id="preview-period"
              className="form-input"
              value={periodId}
              disabled={!options || options.periods.length === 0}
              onChange={(e) => setPeriodId(e.target.value)}
            >
              {options && options.periods.length === 0 && <option value="">This year so far</option>}
              {options?.periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                  {period.is_closed ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="preview-part" className="form-label">
              Show the form as
            </label>
            <select
              id="preview-part"
              className="form-input"
              value={part}
              onChange={(e) => {
                setPart(e.target.value as PreviewPart);
                setContent(emptyContent());
              }}
            >
              <option value={EvaluationPartKind.EVALUATOR}>The evaluator fills it in</option>
              <option value={EvaluationPartKind.SELF_EVALUATION}>The member&apos;s self-evaluation</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-theme-text-secondary text-sm" role="status">
            {loading
              ? 'Measuring…'
              : preview
                ? [
                    preview.sample ? 'Sample figures' : `${preview.member_name ?? ''}'s figures`,
                    preview.period_name ?? 'this year so far',
                    preview.coverage_start && preview.coverage_end
                      ? `measured ${formatCalendarDate(preview.coverage_start)} – ${formatCalendarDate(preview.coverage_end)}`
                      : `${formatCalendarDate(preview.period_start)} – ${formatCalendarDate(preview.period_end)}`,
                  ].join(' · ')
                : ''}
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1"
            disabled={loading || options === null}
            onClick={() => void run(memberId, periodId)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Measure again
          </button>
        </div>
        {preview?.note && <p className="text-theme-text-muted mt-2 text-sm">{preview.note}</p>}
        {hiddenOfficerSections > 0 && (
          <p className="text-theme-text-muted mt-2 text-sm">
            {hiddenOfficerSections === 1
              ? 'One officer-only section is'
              : `${hiddenOfficerSections} officer-only sections are`}{' '}
            hidden: this member does not hold one of the officer ranks.
          </p>
        )}
      </div>

      {error && (
        <div className="alert-danger">
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {preview && shown.sections.length === 0 && (
        <p className="text-theme-text-secondary text-sm">
          Add a section on the Sections &amp; items tab to see it here.
        </p>
      )}

      {preview && shown.sections.length > 0 && (
        <EvaluationForm
          kind={part}
          definition={shown}
          content={content}
          onChange={setContent}
          readOnly={false}
          data={preview.data}
          sources={preview.sources}
          suggested={preview.suggested_scores}
          overallLevels={preview.overall_levels}
        />
      )}
    </div>
  );
};

export default TemplatePreviewPanel;
