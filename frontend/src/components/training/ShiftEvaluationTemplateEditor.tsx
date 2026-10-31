/**
 * Editor for one shift evaluation template.
 *
 * Edits the whole form a preceptor or shift officer fills out: the rating
 * scale, which ratings need a comment, the header fields, the shift
 * statistics, and the sections of items. Saving sends the whole template; the
 * server settles its shape and mints keys for anything new.
 *
 * Sections, items and header fields keep their `key` across edits. A filled-out
 * evaluation records its ratings against those keys, so renaming or reordering
 * an item does not detach the ratings already given against it.
 */

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { POSITION_LABELS } from '../../constants/enums';
import { shiftEvaluationTemplateProblems } from '../../utils/shiftEvaluationTemplates';
import {
  ShiftEvaluationStatistic,
  type ShiftEvaluationHeaderField,
  type ShiftEvaluationTemplateItem,
  type ShiftEvaluationTemplateSection,
  type ShiftEvaluationTemplateWrite,
} from '../../types/training';

const STATISTIC_LABELS: Record<ShiftEvaluationStatistic, string> = {
  [ShiftEvaluationStatistic.CALLS]: 'Number of Calls',
  [ShiftEvaluationStatistic.TRANSPORTS]: 'Number of Transports',
  [ShiftEvaluationStatistic.REFUSALS]: 'Number of Refusals',
};

const STATISTIC_ORDER: ShiftEvaluationStatistic[] = [
  ShiftEvaluationStatistic.CALLS,
  ShiftEvaluationStatistic.TRANSPORTS,
  ShiftEvaluationStatistic.REFUSALS,
];

/** Swap an entry with its neighbour; out of range leaves the list as it was. */
function moved<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const a = list[index];
  const b = list[target];
  if (a === undefined || b === undefined) return list;
  const next = [...list];
  next[index] = b;
  next[target] = a;
  return next;
}

interface Props {
  initial: ShiftEvaluationTemplateWrite;
  /** Shown as the editor's heading, e.g. "New template" or the template's name. */
  heading: string;
  saving: boolean;
  onSave: (body: ShiftEvaluationTemplateWrite) => void;
  onCancel: () => void;
}

export const ShiftEvaluationTemplateEditor: React.FC<Props> = ({ initial, heading, saving, onSave, onCancel }) => {
  const [body, setBody] = useState<ShiftEvaluationTemplateWrite>(initial);
  const [customSeat, setCustomSeat] = useState('');
  const [showProblems, setShowProblems] = useState(false);

  const patch = (changes: Partial<ShiftEvaluationTemplateWrite>) => setBody((prev) => ({ ...prev, ...changes }));

  const problems = shiftEvaluationTemplateProblems(body);

  // -- Scale -------------------------------------------------------------

  const setLevel = (index: number, changes: Partial<{ value: number; label: string }>) =>
    patch({ scale: body.scale.map((level, i) => (i === index ? { ...level, ...changes } : level)) });

  const addLevel = () => {
    const highest = body.scale.reduce((max, level) => Math.max(max, level.value), 0);
    patch({ scale: [...body.scale, { value: highest + 1, label: '' }] });
  };

  const removeLevel = (index: number) => {
    const removed = body.scale[index];
    const scale = body.scale.filter((_, i) => i !== index);
    patch({
      scale,
      // A threshold naming a rating that no longer exists would be refused.
      comment_required_at_or_below:
        removed && body.comment_required_at_or_below === removed.value ? null : body.comment_required_at_or_below,
    });
  };

  // -- Header fields -----------------------------------------------------

  const setField = (index: number, changes: Partial<ShiftEvaluationHeaderField>) =>
    patch({ header_fields: body.header_fields.map((field, i) => (i === index ? { ...field, ...changes } : field)) });

  // -- Sections and items ------------------------------------------------

  const setSection = (index: number, changes: Partial<ShiftEvaluationTemplateSection>) =>
    patch({ sections: body.sections.map((section, i) => (i === index ? { ...section, ...changes } : section)) });

  const setItem = (sectionIndex: number, itemIndex: number, changes: Partial<ShiftEvaluationTemplateItem>) => {
    const section = body.sections[sectionIndex];
    if (!section) return;
    setSection(sectionIndex, {
      items: section.items.map((item, i) => (i === itemIndex ? { ...item, ...changes } : item)),
    });
  };

  // -- Seats -------------------------------------------------------------

  const toggleSeat = (seat: string) =>
    patch({
      evaluated_seats: body.evaluated_seats.includes(seat)
        ? body.evaluated_seats.filter((s) => s !== seat)
        : [...body.evaluated_seats, seat],
    });

  const addCustomSeat = () => {
    const seat = customSeat.trim();
    if (!seat) return;
    if (!body.evaluated_seats.includes(seat)) patch({ evaluated_seats: [...body.evaluated_seats, seat] });
    setCustomSeat('');
  };

  const customSeats = body.evaluated_seats.filter((seat) => !(seat in POSITION_LABELS));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onSave(body);
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Evaluation template editor">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-theme-text-primary flex-1 text-lg font-semibold">{heading}</h3>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" />}
          Save template
        </button>
      </div>

      {showProblems && problems.length > 0 && (
        <div role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          <p className="font-medium">Fix these before saving:</p>
          <ul className="ml-5 list-disc">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Details */}
      <section className="card space-y-4 p-4">
        <h4 className="text-theme-text-primary font-semibold">Template details</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="et-name" className="form-label">
              Name
            </label>
            <input
              id="et-name"
              className="form-input text-sm"
              value={body.name}
              maxLength={200}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. EMT Shift Evaluation"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={body.is_active}
                onChange={(e) => patch({ is_active: e.target.checked })}
              />
              Active — offered when choosing a program&apos;s form
            </label>
          </div>
        </div>
        <div>
          <label htmlFor="et-description" className="form-label">
            Description
          </label>
          <textarea
            id="et-description"
            rows={2}
            className="form-input text-sm"
            value={body.description ?? ''}
            maxLength={2000}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </div>
      </section>

      {/* Scale */}
      <section className="card space-y-4 p-4">
        <h4 className="text-theme-text-primary font-semibold">Rating scale</h4>
        <div className="space-y-2">
          {body.scale.map((level, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                aria-label={`Rating ${index + 1} value`}
                className="form-input-sm w-20"
                value={Number.isNaN(level.value) ? '' : level.value}
                onChange={(e) => setLevel(index, { value: e.target.valueAsNumber })}
              />
              <input
                aria-label={`Rating ${index + 1} label`}
                className="form-input-sm flex-1"
                value={level.label}
                maxLength={100}
                onChange={(e) => setLevel(index, { label: e.target.value })}
              />
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove rating ${level.label || index + 1}`}
                disabled={body.scale.length <= 2}
                onClick={() => removeLevel(index)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary flex items-center gap-1 text-sm" onClick={addLevel}>
            <Plus className="h-4 w-4" /> Add rating
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={body.allow_not_applicable}
                onChange={(e) => patch({ allow_not_applicable: e.target.checked })}
              />
              Allow &quot;N/A&quot;
            </label>
            {body.allow_not_applicable && (
              <input
                aria-label="N/A label"
                className="form-input mt-2 text-sm"
                value={body.not_applicable_label}
                maxLength={100}
                onChange={(e) => patch({ not_applicable_label: e.target.value })}
              />
            )}
          </div>
          <div>
            <label htmlFor="et-threshold" className="form-label">
              Comment required at or below
            </label>
            <select
              id="et-threshold"
              className="form-input text-sm"
              value={body.comment_required_at_or_below ?? ''}
              onChange={(e) =>
                patch({ comment_required_at_or_below: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value="">Never required by rating</option>
              {body.scale
                .filter((level) => !Number.isNaN(level.value))
                .map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.value} – {level.label || 'Unlabelled'}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </section>

      {/* Header fields and statistics */}
      <section className="card space-y-4 p-4">
        <div>
          <h4 className="text-theme-text-primary font-semibold">Header fields</h4>
          <p className="text-theme-text-muted text-xs">
            Shift date, unit, staffing time, the member and the evaluator come from the shift. Add anything else the
            form asks for.
          </p>
        </div>
        {body.header_fields.map((field, index) => (
          <div
            key={field.key || `new-${index}`}
            className="border-theme-surface-border space-y-2 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Header field ${index + 1} label`}
                className="form-input-sm min-w-0 flex-1"
                value={field.label}
                maxLength={100}
                placeholder="e.g. Shift (A, B, C)"
                onChange={(e) => setField(index, { label: e.target.value })}
              />
              <select
                aria-label={`Header field ${index + 1} type`}
                className="form-input-sm w-auto"
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value === 'choice' ? 'choice' : 'text';
                  setField(index, { type, options: type === 'choice' && field.options.length === 0 ? ['', ''] : [] });
                }}
              >
                <option value="text">Text</option>
                <option value="choice">Pick one</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={field.required}
                  onChange={(e) => setField(index, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove header field ${field.label || index + 1}`}
                onClick={() => patch({ header_fields: body.header_fields.filter((_, i) => i !== index) })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {field.type === 'choice' && (
              <div className="flex flex-wrap items-center gap-2">
                {field.options.map((option, optionIndex) => (
                  <span key={optionIndex} className="flex items-center gap-1">
                    <input
                      aria-label={`${field.label || 'Field'} option ${optionIndex + 1}`}
                      className="form-input-sm w-24"
                      value={option}
                      maxLength={50}
                      onChange={(e) =>
                        setField(index, {
                          options: field.options.map((o, i) => (i === optionIndex ? e.target.value : o)),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove option ${option || optionIndex + 1}`}
                      onClick={() => setField(index, { options: field.options.filter((_, i) => i !== optionIndex) })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="text-sm font-medium text-red-800 hover:underline dark:text-red-400"
                  onClick={() => setField(index, { options: [...field.options, ''] })}
                >
                  + Option
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary flex items-center gap-1 text-sm"
          disabled={body.header_fields.length >= 10}
          onClick={() =>
            patch({ header_fields: [...body.header_fields, { label: '', type: 'text', options: [], required: false }] })
          }
        >
          <Plus className="h-4 w-4" /> Add field
        </button>

        <fieldset>
          <legend className="form-label">Shift statistics</legend>
          <div className="flex flex-wrap gap-4">
            {STATISTIC_ORDER.map((stat) => (
              <label key={stat} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={body.statistics.includes(stat)}
                  onChange={(e) =>
                    patch({
                      statistics: e.target.checked
                        ? STATISTIC_ORDER.filter((s) => s === stat || body.statistics.includes(s))
                        : body.statistics.filter((s) => s !== stat),
                    })
                  }
                />
                {STATISTIC_LABELS[stat]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {/* Sections */}
      <section className="card space-y-4 p-4">
        <h4 className="text-theme-text-primary font-semibold">Sections and items</h4>
        {body.sections.map((section, sectionIndex) => (
          <div
            key={section.key || `new-${sectionIndex}`}
            className="bg-theme-surface-secondary border-theme-surface-border space-y-3 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Section ${sectionIndex + 1} title`}
                className="form-input-sm min-w-0 flex-1 font-semibold"
                value={section.title}
                maxLength={150}
                placeholder="e.g. Clinical Performance"
                onChange={(e) => setSection(sectionIndex, { title: e.target.value })}
              />
              <input
                aria-label={`Section ${sectionIndex + 1} column heading`}
                className="form-input-sm w-32"
                value={section.column_heading}
                maxLength={60}
                title="Column heading on the printed form"
                onChange={(e) => setSection(sectionIndex, { column_heading: e.target.value })}
              />
              <button
                type="button"
                className="btn-icon"
                aria-label={`Move section ${section.title || sectionIndex + 1} up`}
                disabled={sectionIndex === 0}
                onClick={() => patch({ sections: moved(body.sections, sectionIndex, -1) })}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Move section ${section.title || sectionIndex + 1} down`}
                disabled={sectionIndex === body.sections.length - 1}
                onClick={() => patch({ sections: moved(body.sections, sectionIndex, 1) })}
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove section ${section.title || sectionIndex + 1}`}
                disabled={body.sections.length <= 1}
                onClick={() => patch({ sections: body.sections.filter((_, i) => i !== sectionIndex) })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {section.items.map((item, itemIndex) => (
              <div key={item.key || `new-${itemIndex}`} className="flex flex-wrap items-center gap-2">
                <span className="text-theme-text-muted w-6 text-right text-xs">{itemIndex + 1}.</span>
                <input
                  aria-label={`${section.title || 'Section'} item ${itemIndex + 1} name`}
                  className="form-input-sm min-w-0 flex-1"
                  value={item.label}
                  maxLength={200}
                  onChange={(e) => setItem(sectionIndex, itemIndex, { label: e.target.value })}
                />
                <input
                  aria-label={`${section.title || 'Section'} item ${itemIndex + 1} hint`}
                  className="form-input-sm min-w-0 flex-1"
                  value={item.description ?? ''}
                  maxLength={300}
                  placeholder="Hint (optional)"
                  onChange={(e) => setItem(sectionIndex, itemIndex, { description: e.target.value })}
                />
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={item.comment_always_required}
                    onChange={(e) => setItem(sectionIndex, itemIndex, { comment_always_required: e.target.checked })}
                  />
                  Always require comment
                </label>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move ${item.label || `item ${itemIndex + 1}`} up`}
                  disabled={itemIndex === 0}
                  onClick={() => setSection(sectionIndex, { items: moved(section.items, itemIndex, -1) })}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move ${item.label || `item ${itemIndex + 1}`} down`}
                  disabled={itemIndex === section.items.length - 1}
                  onClick={() => setSection(sectionIndex, { items: moved(section.items, itemIndex, 1) })}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Remove ${item.label || `item ${itemIndex + 1}`}`}
                  disabled={section.items.length <= 1}
                  onClick={() => setSection(sectionIndex, { items: section.items.filter((_, i) => i !== itemIndex) })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm font-medium text-red-800 hover:underline dark:text-red-400"
              onClick={() =>
                setSection(sectionIndex, {
                  items: [...section.items, { label: '', comment_always_required: false }],
                })
              }
            >
              + Add item
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary flex items-center gap-1 text-sm"
          disabled={body.sections.length >= 20}
          onClick={() =>
            patch({
              sections: [
                ...body.sections,
                { title: '', column_heading: 'Skill', items: [{ label: '', comment_always_required: false }] },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" /> Add section
        </button>
      </section>

      {/* Closing comments */}
      <section className="card space-y-4 p-4">
        <h4 className="text-theme-text-primary font-semibold">Closing comments</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="et-closing-label" className="form-label">
              Heading
            </label>
            <input
              id="et-closing-label"
              className="form-input text-sm"
              value={body.closing_comments_label ?? ''}
              maxLength={200}
              placeholder="Leave blank for no closing comments"
              onChange={(e) => patch({ closing_comments_label: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="et-closing-hint" className="form-label">
              Hint
            </label>
            <input
              id="et-closing-hint"
              className="form-input text-sm"
              value={body.closing_comments_hint ?? ''}
              maxLength={500}
              disabled={!(body.closing_comments_label ?? '').trim()}
              onChange={(e) => patch({ closing_comments_hint: e.target.value })}
            />
          </div>
        </div>
      </section>

      {/* Who */}
      <section className="card space-y-4 p-4">
        <h4 className="text-theme-text-primary font-semibold">Who fills it out, and who is evaluated</h4>
        <p className="text-theme-text-secondary text-sm">
          <span className="font-medium">Filled out by:</span> the shift officer.
        </p>
        <div>
          <p className="text-theme-text-secondary text-sm">
            <span className="font-medium">Evaluated:</span> members enrolled in a program that uses this form. If this
            is the department&apos;s general form, also members in no program who sat in one of these seats:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(POSITION_LABELS).map(([seat, label]) => (
              <button
                key={seat}
                type="button"
                aria-pressed={body.evaluated_seats.includes(seat)}
                onClick={() => toggleSeat(seat)}
                className={`touch-target-phone rounded-full border px-3 py-1 text-xs font-semibold ${
                  body.evaluated_seats.includes(seat)
                    ? 'border-red-800 bg-red-800 text-white'
                    : 'border-theme-surface-border text-theme-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
            {customSeats.map((seat) => (
              <button
                key={seat}
                type="button"
                aria-pressed="true"
                aria-label={`Remove seat ${seat}`}
                onClick={() => toggleSeat(seat)}
                className="touch-target-phone flex items-center gap-1 rounded-full border border-red-800 bg-red-800 px-3 py-1 text-xs font-semibold text-white"
              >
                {seat} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
          <div className="mt-2 flex max-w-sm items-center gap-2">
            <input
              aria-label="Another seat name"
              className="form-input-sm flex-1"
              value={customSeat}
              maxLength={100}
              placeholder="Another seat, e.g. Tiller"
              onChange={(e) => setCustomSeat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomSeat();
                }
              }}
            />
            <button type="button" className="btn-secondary text-sm" onClick={addCustomSeat}>
              Add seat
            </button>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" />}
          Save template
        </button>
      </div>
    </form>
  );
};

export default ShiftEvaluationTemplateEditor;
