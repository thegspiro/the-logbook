/**
 * One item of an evaluation template: how it is answered, its scale and the
 * behavior that earns each level, and an optional data block whose scoring
 * rule suggests a level for the evaluator to accept or override.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import {
  EVALUATION_TOOL_LABELS,
  EvaluationTool,
  SCALE_TOOLS,
  SCORED_TOOLS,
  type EvaluationDataSource,
  type ScaleLevel,
  type ScoreBand,
  type TemplateItem,
} from '../../types/evaluations';
import { replaceAt, withTool } from '../../utils/evaluationTemplate';

interface ItemEditorProps {
  item: TemplateItem;
  index: number;
  count: number;
  dataSources: EvaluationDataSource[];
  onChange: (item: TemplateItem) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}

/** One option per line, trimmed, blanks and repeats dropped. */
const parseOptions = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, all) => line && all.indexOf(line) === i);

const sameOptions = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const numberOr = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return value.trim() === '' || Number.isNaN(parsed) ? fallback : parsed;
};

export const ItemEditor: React.FC<ItemEditorProps> = ({
  item,
  index,
  count,
  dataSources,
  onChange,
  onRemove,
  onMove,
}) => {
  const id = `item-${item.key}`;
  const isScale = SCALE_TOOLS.includes(item.tool);
  const isScored = SCORED_TOOLS.includes(item.tool);
  const source = dataSources.find((s) => s.key === item.data_block?.source);
  const bands = item.data_block?.scoring_rule?.bands ?? [];

  // The textarea keeps what the user typed — a trailing blank line after
  // Enter, a space mid-word — while the item always holds the parsed list.
  // It is re-seeded only when the list changes from outside (a reload).
  const [optionsText, setOptionsText] = useState(item.checklist_options.join('\n'));
  useEffect(() => {
    setOptionsText((text) =>
      sameOptions(parseOptions(text), item.checklist_options) ? text : item.checklist_options.join('\n')
    );
  }, [item.checklist_options]);

  const setLevel = (levelIndex: number, patch: Partial<ScaleLevel>) => {
    const current = item.levels[levelIndex];
    if (!current) return;
    onChange({ ...item, levels: replaceAt(item.levels, levelIndex, { ...current, ...patch }) });
  };

  const addLevel = () => {
    const last = item.levels[item.levels.length - 1];
    const value = last ? last.value + 1 : 1;
    if (value > 10) return;
    onChange({ ...item, levels: [...item.levels, { value, label: String(value), anchor: null }] });
  };

  const removeLastLevel = () => {
    const last = item.levels[item.levels.length - 1];
    if (!last || item.levels.length <= 2) return;
    onChange({
      ...item,
      levels: item.levels.slice(0, -1),
      require_example_for: item.require_example_for.filter((v) => v !== last.value),
      data_block: item.data_block?.scoring_rule
        ? {
            ...item.data_block,
            // A rule with no bands left is no rule; the backend refuses an
            // empty band list.
            scoring_rule: (() => {
              const remaining = bands.filter((band) => band.score !== last.value);
              return remaining.length ? { bands: remaining } : null;
            })(),
          }
        : item.data_block,
    });
  };

  const toggleExample = (value: number) => {
    const has = item.require_example_for.includes(value);
    onChange({
      ...item,
      require_example_for: has
        ? item.require_example_for.filter((v) => v !== value)
        : [...item.require_example_for, value].sort((a, b) => a - b),
    });
  };

  const setSource = (key: string) => {
    if (!key) {
      onChange({ ...item, data_block: null });
      return;
    }
    const next = dataSources.find((s) => s.key === key);
    const keepRule = next?.scoreable && isScale ? (item.data_block?.scoring_rule ?? null) : null;
    onChange({ ...item, data_block: { source: key, scoring_rule: keepRule } });
  };

  const setBands = (next: ScoreBand[]) => {
    if (!item.data_block) return;
    onChange({
      ...item,
      data_block: { ...item.data_block, scoring_rule: next.length ? { bands: next } : null },
    });
  };

  const addBand = () => {
    const last = bands[bands.length - 1];
    const min = last ? (last.max ?? last.min + 1) : 0;
    const score = item.levels[0]?.value ?? 1;
    setBands([
      ...bands.map((b, i) => (i === bands.length - 1 && b.max === null ? { ...b, max: min } : b)),
      { min, max: null, score },
    ]);
  };

  return (
    <div className="card-secondary space-y-4 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor={`${id}-label`} className="form-label">
            Item
          </label>
          <input
            id={`${id}-label`}
            className="form-input"
            maxLength={150}
            value={item.label}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
          />
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor={`${id}-tool`} className="form-label">
            Evaluation tool
          </label>
          <select
            id={`${id}-tool`}
            className="form-input"
            value={item.tool}
            onChange={(e) => onChange(withTool(item, e.target.value as EvaluationTool))}
          >
            {Object.values(EvaluationTool).map((tool) => (
              <option key={tool} value={tool}>
                {EVALUATION_TOOL_LABELS[tool]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1 self-end">
          <button
            type="button"
            className="btn-icon"
            aria-label={`Move ${item.label} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label={`Move ${item.label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon" aria-label={`Remove ${item.label}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-help`} className="form-label">
          Guidance for the evaluator <span className="text-theme-text-muted font-normal">(optional)</span>
        </label>
        <input
          id={`${id}-help`}
          className="form-input"
          maxLength={1000}
          value={item.help_text ?? ''}
          onChange={(e) => onChange({ ...item, help_text: e.target.value || null })}
        />
      </div>

      <div className="form-grid-3 gap-4">
        {isScored && (
          <div>
            <label htmlFor={`${id}-weight`} className="form-label">
              Weight in overall (%)
            </label>
            <input
              id={`${id}-weight`}
              type="number"
              min={0}
              max={100}
              className="form-input"
              value={item.weight}
              onChange={(e) => onChange({ ...item, weight: Math.max(0, Math.min(100, numberOr(e.target.value, 0))) })}
            />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-comment`} className="form-label">
            Evaluator comment
          </label>
          <select
            id={`${id}-comment`}
            className="form-input"
            value={item.comment}
            onChange={(e) => onChange({ ...item, comment: e.target.value as TemplateItem['comment'] })}
          >
            <option value="none">No comment box</option>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={item.include_in_self_evaluation}
              onChange={(e) => onChange({ ...item, include_in_self_evaluation: e.target.checked })}
            />
            <span className="text-theme-text-secondary">Member answers it in their self-evaluation</span>
          </label>
          {isScored && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={item.allow_na}
                onChange={(e) => onChange({ ...item, allow_na: e.target.checked })}
              />
              <span className="text-theme-text-secondary">Allow &ldquo;Not applicable&rdquo;</span>
            </label>
          )}
        </div>
      </div>

      {isScale && (
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">
            Scale levels
            {item.tool === EvaluationTool.LABELED_SCALE && (
              <span className="text-theme-text-muted ml-1 font-normal">— describe the behavior that earns each</span>
            )}
          </legend>
          <div className="space-y-2">
            {item.levels.map((level, levelIndex) => (
              <div
                key={level.value}
                className="grid grid-cols-[2.5rem_1fr] items-start gap-2 sm:grid-cols-[2.5rem_11rem_1fr_auto]"
              >
                <span className="text-theme-text-primary pt-2 text-center font-semibold">{level.value}</span>
                <input
                  aria-label={`Level ${level.value} label`}
                  className="form-input-sm"
                  maxLength={60}
                  value={level.label}
                  onChange={(e) => setLevel(levelIndex, { label: e.target.value })}
                />
                <input
                  aria-label={`Level ${level.value} behavior`}
                  className="form-input-sm col-span-2 sm:col-span-1"
                  maxLength={500}
                  placeholder="What a member at this level does"
                  value={level.anchor ?? ''}
                  onChange={(e) => setLevel(levelIndex, { anchor: e.target.value || null })}
                />
                <label className="text-theme-text-secondary col-span-2 flex items-center gap-1 text-xs sm:col-span-1 sm:pt-2">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={item.require_example_for.includes(level.value)}
                    onChange={() => toggleExample(level.value)}
                  />
                  Example required
                </label>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={addLevel}
              disabled={item.levels.length >= 10}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add level
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={removeLastLevel}
              disabled={item.levels.length <= 2}
            >
              Remove top level
            </button>
          </div>
        </fieldset>
      )}

      {item.tool === EvaluationTool.CHECKLIST && (
        <div>
          <label htmlFor={`${id}-options`} className="form-label">
            Checklist options <span className="text-theme-text-muted font-normal">(one per line)</span>
          </label>
          <textarea
            id={`${id}-options`}
            className="form-input"
            rows={4}
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              onChange({ ...item, checklist_options: parseOptions(e.target.value) });
            }}
          />
        </div>
      )}

      <div className="border-theme-surface-border border-t pt-4">
        <label htmlFor={`${id}-source`} className="form-label">
          Data shown with this item
        </label>
        <select
          id={`${id}-source`}
          className="form-input"
          value={item.data_block?.source ?? ''}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">None</option>
          {dataSources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {source && <p className="text-theme-text-muted mt-1 text-xs">{source.description}</p>}

        {source?.scoreable && isScale && (
          <fieldset className="mt-3">
            <legend className="text-theme-text-primary text-sm font-semibold">
              Scoring rule{' '}
              <span className="text-theme-text-muted font-normal">
                — suggests a level; the evaluator may change it with a written justification
              </span>
            </legend>
            {bands.length > 0 && (
              <div className="mt-2 space-y-2">
                {bands.map((band, bandIndex) => (
                  <div key={bandIndex} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-theme-text-secondary w-10">From</span>
                    <input
                      aria-label={`Band ${bandIndex + 1} from`}
                      type="number"
                      min={0}
                      className="form-input-sm w-24"
                      value={band.min}
                      onChange={(e) =>
                        setBands(replaceAt(bands, bandIndex, { ...band, min: numberOr(e.target.value, 0) }))
                      }
                    />
                    <span className="text-theme-text-secondary">up to</span>
                    <input
                      aria-label={`Band ${bandIndex + 1} up to`}
                      type="number"
                      min={0}
                      className="form-input-sm w-24"
                      placeholder="and above"
                      value={band.max ?? ''}
                      onChange={(e) =>
                        setBands(
                          replaceAt(bands, bandIndex, {
                            ...band,
                            max: e.target.value.trim() === '' ? null : numberOr(e.target.value, band.min),
                          })
                        )
                      }
                    />
                    <span className="text-theme-text-secondary">scores</span>
                    <select
                      aria-label={`Band ${bandIndex + 1} score`}
                      className="form-input-sm w-52"
                      value={band.score}
                      onChange={(e) =>
                        setBands(replaceAt(bands, bandIndex, { ...band, score: Number(e.target.value) }))
                      }
                    >
                      {item.levels.map((level) => (
                        <option key={level.value} value={level.value}>
                          {level.value} · {level.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-icon-sm"
                      aria-label={`Remove band ${bandIndex + 1}`}
                      onClick={() => setBands(bands.filter((_, i) => i !== bandIndex))}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn-secondary btn-sm mt-2" onClick={addBand}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add band
            </button>
            {source.unit === 'percent' && (
              <p className="text-theme-text-muted mt-1 text-xs">Values are percentages (0–100).</p>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
};
