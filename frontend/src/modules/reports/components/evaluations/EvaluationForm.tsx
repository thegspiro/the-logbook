/**
 * An evaluation part — the evaluator's or the member's self-evaluation —
 * rendered from its template, editable or read-only.
 *
 * Each item shows its figure and, where the template scores it, the rating
 * the figure suggests. Fields appear only when they apply: an example where
 * the chosen level requires one, a justification where the evaluator departs
 * from the suggested rating. Whether the part is complete is decided by the
 * server on submit, which lists what is missing.
 */
import React from 'react';
import type {
  DataEntry,
  EvaluationDataSource,
  EvaluationPartKind,
  ItemAnswer,
  PartContent,
  ScaleLevel,
  TemplateDefinition,
  TemplateItem,
} from '../../types/evaluations';
import { formatFigure, needsJustification, withAnswer } from '../../utils/evaluationRecord';

interface EvaluationFormProps {
  kind: EvaluationPartKind;
  definition: TemplateDefinition;
  content: PartContent;
  onChange?: ((content: PartContent) => void) | undefined;
  readOnly: boolean;
  data: Record<string, DataEntry> | null;
  sources: EvaluationDataSource[];
  suggested: Record<string, number>;
  overallLevels: ScaleLevel[];
}

const MEETS_LEVELS: ScaleLevel[] = [
  { value: 1, label: 'Meets', anchor: null },
  { value: 0, label: 'Does not meet', anchor: null },
];

function levelsFor(item: TemplateItem): ScaleLevel[] {
  return item.tool === 'meets' ? MEETS_LEVELS : item.levels;
}

const ReadOnlyText: React.FC<{ label: string; value: string | null | undefined }> = ({ label, value }) =>
  value ? (
    <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">
      <span className="text-theme-text-secondary">{label}: </span>
      {value}
    </p>
  ) : null;

export const EvaluationForm: React.FC<EvaluationFormProps> = ({
  kind,
  definition,
  content,
  onChange,
  readOnly,
  data,
  sources,
  suggested,
  overallLevels,
}) => {
  const evaluator = kind === 'evaluator';
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const update = (key: string, patch: Partial<ItemAnswer>) => {
    if (onChange) onChange(withAnswer(content, key, patch));
  };

  const renderItem = (item: TemplateItem) => {
    const answer = content.answers[item.key];
    const id = `${kind}-${item.key}`;
    const levels = levelsFor(item);
    const scored = item.tool === 'labeled_scale' || item.tool === 'numeric_scale' || item.tool === 'meets';
    const written = item.tool === 'narrative' || item.tool === 'goals';
    const source = item.data_block ? sourceByKey.get(item.data_block.source) : undefined;
    const figure = item.data_block && data ? data[item.data_block.source] : undefined;
    const suggestion = evaluator ? suggested[item.key] : undefined;
    const rating = answer?.rating ?? null;
    const exampleNeeded = rating !== null && item.require_example_for.includes(rating);
    const justify = evaluator && needsJustification(answer, suggestion);
    const ratingLabel = levels.find((l) => l.value === rating)?.label;

    return (
      <li key={item.key} className="border-theme-surface-border border-t pt-4 first:border-t-0 first:pt-0">
        <fieldset disabled={readOnly}>
          <legend className="text-theme-text-primary font-medium">{item.label}</legend>
          {item.help_text && <p className="text-theme-text-secondary mt-1 text-sm">{item.help_text}</p>}
          {source && (
            <p className="text-theme-text-secondary mt-1 text-sm">
              {source.label}:{' '}
              <span className="text-theme-text-primary font-medium">{formatFigure(figure, source.unit)}</span>
              {suggestion !== undefined && (
                <span className="badge ml-2 bg-blue-500/15 text-blue-900 dark:text-blue-200">
                  Suggested: {levels.find((l) => l.value === suggestion)?.label ?? suggestion}
                </span>
              )}
            </p>
          )}

          {scored &&
            (readOnly ? (
              <p className="text-theme-text-primary mt-2 text-sm font-medium">
                {answer?.na ? 'Not applicable' : (ratingLabel ?? 'Not rated')}
              </p>
            ) : (
              <div role="radiogroup" aria-label={`${item.label} rating`} className="mt-2 grid gap-2">
                {levels.map((level) => (
                  <label
                    key={level.value}
                    className="card-secondary touch:min-h-11 flex cursor-pointer items-start gap-2 p-2 text-sm"
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name={`${id}-rating`}
                      checked={rating === level.value && !answer?.na}
                      onChange={() => update(item.key, { rating: level.value, na: false })}
                    />
                    <span>
                      <span className="text-theme-text-primary font-medium">{level.label}</span>
                      {level.anchor && <span className="text-theme-text-secondary block">{level.anchor}</span>}
                    </span>
                  </label>
                ))}
                {item.allow_na && (
                  <label className="touch:min-h-11 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={Boolean(answer?.na)}
                      onChange={(e) => update(item.key, { na: e.target.checked, rating: null })}
                    />
                    Not applicable
                  </label>
                )}
              </div>
            ))}

          {item.tool === 'checklist' && (
            <div className="mt-2 grid gap-1">
              {item.checklist_options.map((option) => {
                const checked = answer?.checked?.includes(option) ?? false;
                return (
                  <label key={option} className="touch:min-h-11 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = answer?.checked ?? [];
                        update(item.key, {
                          checked: e.target.checked ? [...current, option] : current.filter((o) => o !== option),
                        });
                      }}
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}

          {written &&
            (readOnly ? (
              <ReadOnlyText label="Answer" value={answer?.text} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-text`} className="sr-only">
                  {item.label}
                </label>
                <textarea
                  id={`${id}-text`}
                  className="form-input min-h-24"
                  value={answer?.text ?? ''}
                  onChange={(e) => update(item.key, { text: e.target.value })}
                />
              </div>
            ))}

          {!written &&
            item.comment !== 'none' &&
            (readOnly ? (
              <ReadOnlyText label="Comment" value={answer?.comment} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-comment`} className="form-label">
                  Comment{item.comment === 'required' ? ' (required)' : ''}
                </label>
                <textarea
                  id={`${id}-comment`}
                  className="form-input"
                  value={answer?.comment ?? ''}
                  onChange={(e) => update(item.key, { comment: e.target.value })}
                />
              </div>
            ))}

          {exampleNeeded &&
            (readOnly ? (
              <ReadOnlyText label="Example" value={answer?.example} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-example`} className="form-label">
                  Describe a specific example (required at this level)
                </label>
                <textarea
                  id={`${id}-example`}
                  className="form-input"
                  value={answer?.example ?? ''}
                  onChange={(e) => update(item.key, { example: e.target.value })}
                />
              </div>
            ))}

          {(justify || (readOnly && answer?.justification)) &&
            (readOnly ? (
              <ReadOnlyText label="Why the rating differs from the figures" value={answer?.justification} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-justification`} className="form-label">
                  Why does your rating differ from the suggested one? (required)
                </label>
                <textarea
                  id={`${id}-justification`}
                  className="form-input"
                  value={answer?.justification ?? ''}
                  onChange={(e) => update(item.key, { justification: e.target.value })}
                />
              </div>
            ))}
        </fieldset>
      </li>
    );
  };

  const sections = definition.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => kind !== 'self_evaluation' || item.include_in_self_evaluation),
    }))
    .filter((section) => section.items.length > 0);
  const overallLabel = overallLevels.find((l) => l.value === content.overall_rating)?.label;

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`${kind}-${section.key}-title`} className="card p-4 sm:p-6">
          <h3 id={`${kind}-${section.key}-title`} className="text-theme-text-primary text-lg font-semibold">
            {section.title}
          </h3>
          {section.description && <p className="text-theme-text-secondary mt-1 text-sm">{section.description}</p>}
          <ul className="mt-4 space-y-4">{section.items.map(renderItem)}</ul>
        </section>
      ))}

      {evaluator && definition.overall_mode === 'evaluator' && (
        <section aria-labelledby={`${kind}-overall`} className="card p-4 sm:p-6">
          <h3 id={`${kind}-overall`} className="text-theme-text-primary text-lg font-semibold">
            Overall rating
          </h3>
          {readOnly ? (
            <p className="text-theme-text-primary mt-2 text-sm font-medium">{overallLabel ?? 'Not rated'}</p>
          ) : (
            <>
              <label htmlFor={`${kind}-overall-rating`} className="sr-only">
                Overall rating
              </label>
              <select
                id={`${kind}-overall-rating`}
                className="form-input mt-2"
                value={content.overall_rating ?? ''}
                onChange={(e) =>
                  onChange?.({ ...content, overall_rating: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Choose…</option>
                {overallLevels.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </section>
      )}

      <section aria-labelledby={`${kind}-summary`} className="card p-4 sm:p-6">
        <h3 id={`${kind}-summary`} className="text-theme-text-primary text-lg font-semibold">
          {evaluator ? 'Summary' : 'Anything else'}
        </h3>
        {readOnly ? (
          <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">
            {content.overall_comment || 'Nothing added.'}
          </p>
        ) : (
          <>
            <label htmlFor={`${kind}-overall-comment`} className="sr-only">
              {evaluator ? 'Summary' : 'Anything else'}
            </label>
            <textarea
              id={`${kind}-overall-comment`}
              className="form-input mt-2 min-h-24"
              value={content.overall_comment ?? ''}
              onChange={(e) => onChange?.({ ...content, overall_comment: e.target.value })}
            />
          </>
        )}
      </section>
    </div>
  );
};
