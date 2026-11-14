/**
 * Create or edit an outline: the department's order of business.
 *
 * An outline is an ordered list of sections. New minutes start with its
 * sections in its order, and a section marked required must have text before
 * the minutes can be circulated. A section's key is fixed when it is added so
 * renaming it later does not detach it from text already written under it.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { FormField } from '../../../components/ux/FormField';
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { plainTextToHtml } from '../../../utils/richText';
import { MEETING_TYPE_OPTIONS } from '../utils/meetingTypes';
import { minutesService } from '../services/api';
import type { MeetingType, MinutesTemplate, TemplateSectionEntry } from '../types/minutes';
import { uniqueKey } from '../utils/outlineKeys';

interface Row extends TemplateSectionEntry {
  /** Stable React key, separate from the section key which is saved. */
  rowId: number;
}

interface OutlineEditorModalProps {
  isOpen: boolean;
  /** The outline being edited, or null to create one. */
  outline: MinutesTemplate | null;
  /** An outline to copy when creating ("Duplicate"). */
  copyFrom?: MinutesTemplate | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

let nextRowId = 1;

/** The outline's own fields; a section's title and motion are keyed `title-<rowId>` / `motion-<rowId>`. */
type OutlineField = 'name' | 'meetingType' | 'description' | 'subtitle' | 'notice' | 'isDefault' | 'sections';

/** TemplateCreate / TemplateUpdate, HeaderConfig and FooterConfig in schemas/minute.py (snake_case). */
const OUTLINE_FIELDS: Record<OutlineField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 200 },
  meetingType: { label: 'Kind of meeting', api: 'meeting_type' },
  description: { label: 'Description' },
  subtitle: { label: 'Heading under the department name', maxLength: 300, api: 'header_config.subtitle' },
  notice: { label: 'Footer notice', maxLength: 500, api: 'footer_config.confidentiality_notice' },
  isDefault: { label: 'Default outline', api: 'is_default' },
  sections: { label: 'Order of business' },
};

const OUTLINE_FIELD_IDS: Record<OutlineField, string> = {
  name: 'outline-name',
  meetingType: 'outline-type',
  description: 'outline-description',
  subtitle: 'outline-subtitle',
  notice: 'outline-notice',
  isDefault: 'outline-default',
  sections: 'outline-sections',
};

/** The payload key each form field is sent under; a refused one leaves its whole key out. */
const payloadKeyFor = (field: string): string => {
  if (field.startsWith('title-') || field.startsWith('motion-') || field === 'sections') return 'sections';
  if (field === 'subtitle') return 'header_config';
  if (field === 'notice') return 'footer_config';
  if (field === 'meetingType') return 'meeting_type';
  if (field === 'isDefault') return 'is_default';
  return field;
};

/** What the form holds, compared as text to tell whether closing would lose anything. */
const snapshot = (values: {
  name: string;
  description: string;
  meetingType: string;
  isDefault: boolean;
  subtitle: string;
  notice: string;
  rows: Row[];
}) => JSON.stringify({ ...values, rows: values.rows.map(({ rowId: _rowId, ...rest }) => rest) });

const toRows = (sections: TemplateSectionEntry[]): Row[] =>
  [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      ...s,
      // Starting text written before the editor existed is plain text; it opens
      // as paragraphs and is saved as rich text with its words unchanged.
      default_content: s.format === 'html' ? s.default_content : plainTextToHtml(s.default_content),
      format: 'html' as const,
      rowId: nextRowId++,
    }));

export const OutlineEditorModal: React.FC<OutlineEditorModalProps> = ({
  isOpen,
  outline,
  copyFrom = null,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [meetingType, setMeetingType] = useState<MeetingType>('business');
  const [isDefault, setIsDefault] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [notice, setNotice] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [savedExcept, setSavedExcept] = useState(false);
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const source = outline ?? copyFrom;
    const seeded = {
      name: outline ? outline.name : copyFrom ? `${copyFrom.name} (copy)` : '',
      description: source?.description ?? '',
      meetingType: source?.meeting_type ?? 'business',
      isDefault: outline ? outline.is_default : false,
      subtitle: source?.header_config?.subtitle ?? '',
      notice: source?.footer_config?.confidentiality_notice ?? '',
      rows: source
        ? toRows(source.sections)
        : toRows([
            { order: 0, key: 'call_to_order', title: 'Call to Order', default_content: '', required: true },
            {
              order: 1,
              key: 'adjournment',
              title: 'Adjournment',
              default_content: '',
              required: true,
              needs_motion: true,
              motion_text: 'Motion to adjourn the meeting.',
            },
          ]),
    };
    setName(seeded.name);
    setDescription(seeded.description);
    setMeetingType(seeded.meetingType);
    setIsDefault(seeded.isDefault);
    setSubtitle(seeded.subtitle);
    setNotice(seeded.notice);
    setRows(seeded.rows);
    setInitial(snapshot(seeded));
    setError(null);
    setErrors({});
    setSavedExcept(false);
  }, [isOpen, outline, copyFrom]);

  const isDirty =
    initial !== null && snapshot({ name, description, meetingType, isDefault, subtitle, notice, rows }) !== initial;
  // Called here rather than given to Modal so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const clearError = (field: string) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  /** Flags the refusals and focuses the first, in the order the form shows them. */
  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    const order = [
      ...(['name', 'meetingType', 'description', 'subtitle', 'notice', 'isDefault', 'sections'] as const).map(
        (f) => [f, OUTLINE_FIELD_IDS[f]] as const
      ),
      ...rows.flatMap((r) => [
        [`title-${r.rowId}`, `section-title-${r.rowId}`] as const,
        [`motion-${r.rowId}`, `section-motion-${r.rowId}`] as const,
      ]),
    ];
    const first = order.find(([field]) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(first[1])?.focus(), 0);
  };

  /** Server field specs for this outline's rows, addressed as the API names them. */
  const fieldSpecs = (): Record<string, ServerFieldSpec> => {
    const specs: Record<string, ServerFieldSpec> = { ...OUTLINE_FIELDS };
    rows.forEach((r, index) => {
      specs[`title-${r.rowId}`] = {
        label: `Section ${index + 1} title`,
        maxLength: 200,
        api: `sections.${index}.title`,
      };
      specs[`motion-${r.rowId}`] = {
        label: 'Wording of the motion',
        maxLength: 2000,
        api: `sections.${index}.motion_text`,
      };
    });
    return specs;
  };

  const setRow = (rowId: number, patch: Partial<TemplateSectionEntry>) =>
    setRows((current) => current.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const move = (index: number, delta: -1 | 1) =>
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const moved = next[index];
      const swapped = next[target];
      if (!moved || !swapped) return current;
      next[index] = swapped;
      next[target] = moved;
      return next;
    });

  const addRow = () => {
    clearError('sections');
    setRows((current) => [
      ...current,
      {
        rowId: nextRowId++,
        order: current.length,
        key: '',
        title: '',
        default_content: '',
        format: 'html',
        required: false,
        needs_motion: false,
        motion_text: '',
      },
    ]);
  };

  /**
   * A new outline is created only once nothing is refused. An edit is a single
   * save (owner rule of 2026-11-05): a refused field is left out so the outline
   * keeps its stored value, the rest is written, and the dialog stays open with
   * the field flagged.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let refused: Partial<Record<string, string>> = {};
    if (!name.trim()) refused.name = 'Give the outline a name.';
    if (rows.length === 0) refused.sections = 'An outline needs at least one section.';
    for (const r of rows) if (!r.title.trim()) refused[`title-${r.rowId}`] = 'Give this section a title.';
    if (!outline && Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    // Keys are assigned once, from the title, and kept: a section that already
    // has one keeps it through a rename.
    const taken = new Set(rows.map((r) => r.key).filter(Boolean));
    const sections: TemplateSectionEntry[] = rows.map((r, index) => {
      const key = r.key || uniqueKey(r.title, taken);
      taken.add(key);
      return {
        order: index,
        key,
        title: r.title.trim(),
        default_content: r.default_content,
        format: 'html',
        required: r.required,
        needs_motion: Boolean(r.needs_motion),
        // Wording is sent every save so unticking the box clears it.
        motion_text: r.needs_motion ? (r.motion_text ?? '').trim() : '',
      };
    });
    // Every field the form owns is sent, so a cleared description or notice is
    // cleared rather than silently kept.
    const payload = {
      name: name.trim(),
      description: blankToNull(description),
      meeting_type: meetingType,
      is_default: isDefault,
      sections,
      header_config: { ...(outline?.header_config ?? {}), subtitle: blankToNull(subtitle) },
      footer_config: {
        ...(outline?.footer_config ?? {}),
        confidentiality_notice: blankToNull(notice),
      },
    };
    const without = () => {
      const rest: Record<string, unknown> = { ...payload };
      for (const field of Object.keys(refused)) delete rest[payloadKeyFor(field)];
      return rest as Partial<typeof payload>;
    };
    setSaving(true);
    setError(null);
    setSavedExcept(false);
    try {
      if (outline) {
        try {
          await minutesService.updateOutline(outline.id, without());
        } catch (err: unknown) {
          const mapped = mapServerFieldErrors(err, fieldSpecs());
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await minutesService.updateOutline(outline.id, without());
        }
        if (Object.keys(refused).length > 0) {
          showErrors(refused);
          setSavedExcept(true);
          await onSaved();
          return;
        }
      } else {
        await minutesService.createOutline(payload);
      }
      await onSaved();
      onClose();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, fieldSpecs());
      if (mapped) {
        showErrors({ ...refused, ...mapped.fieldErrors });
        if (mapped.unmatched.length) setError(mapped.unmatched.join(' '));
      } else {
        setError(getErrorMessage(err, 'Failed to save the outline'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={outline ? 'Edit outline' : copyFrom ? 'Duplicate outline' : 'New outline'}
      size="xl"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save outline'}
          </button>
        </>
      }
    >
      {savedExcept && (
        <p role="status" className="alert-warning text-theme-text-primary mb-3 text-sm">
          Saved, except the fields flagged below, which keep their stored values. Fix them and save again.
        </p>
      )}
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Name"
          required
          id={OUTLINE_FIELD_IDS.name}
          error={errors.name}
          maxLength={200}
          count={name.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name');
              }}
              className="form-input"
            />
          )}
        </FormField>
        <FormField label="Kind of meeting" id={OUTLINE_FIELD_IDS.meetingType} error={errors.meetingType}>
          {(field) => (
            <select
              {...field}
              value={meetingType}
              onChange={(e) => {
                setMeetingType(e.target.value as MeetingType);
                clearError('meetingType');
              }}
              className="form-input"
            >
              {MEETING_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          className="sm:col-span-2"
          label="Description"
          id={OUTLINE_FIELD_IDS.description}
          error={errors.description}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearError('description');
              }}
              className="form-input"
            />
          )}
        </FormField>
        <FormField
          label="Heading under the department name"
          id={OUTLINE_FIELD_IDS.subtitle}
          error={errors.subtitle}
          maxLength={300}
          count={subtitle.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              value={subtitle}
              onChange={(e) => {
                setSubtitle(e.target.value);
                clearError('subtitle');
              }}
              placeholder="Official Meeting Minutes"
              className="form-input"
            />
          )}
        </FormField>
        <FormField
          label="Footer notice"
          id={OUTLINE_FIELD_IDS.notice}
          error={errors.notice}
          maxLength={500}
          count={notice.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              value={notice}
              onChange={(e) => {
                setNotice(e.target.value);
                clearError('notice');
              }}
              className="form-input"
            />
          )}
        </FormField>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            id={OUTLINE_FIELD_IDS.isDefault}
            type="checkbox"
            className="form-checkbox"
            checked={isDefault}
            onChange={(e) => {
              setIsDefault(e.target.checked);
              clearError('isDefault');
            }}
          />
          <span className="text-theme-text-primary">
            Use this for new minutes of this kind of meeting (replaces the current default)
          </span>
        </label>
        {errors.isDefault && <p className="text-sm text-red-800 sm:col-span-2 dark:text-red-300">{errors.isDefault}</p>}
      </div>

      <fieldset
        className="mt-4"
        id={OUTLINE_FIELD_IDS.sections}
        tabIndex={-1}
        aria-invalid={errors.sections ? true : undefined}
        aria-describedby={errors.sections ? 'outline-sections-error' : undefined}
      >
        <legend className="form-label">Order of business</legend>
        {errors.sections && (
          <p id="outline-sections-error" className="mb-2 text-sm text-red-800 dark:text-red-300">
            {errors.sections}
          </p>
        )}
        <ol className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.rowId} className="border-theme-surface-border rounded-md border p-2">
              <div className="flex items-start gap-2">
                <span className="text-theme-text-muted mt-2 w-6 shrink-0 text-right font-mono text-xs">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <FormField
                    label={`Section ${index + 1} title`}
                    labelClassName="sr-only"
                    required
                    id={`section-title-${row.rowId}`}
                    error={errors[`title-${row.rowId}`]}
                    maxLength={200}
                    count={row.title.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        value={row.title}
                        onChange={(e) => {
                          setRow(row.rowId, { title: e.target.value });
                          clearError(`title-${row.rowId}`);
                        }}
                        placeholder="Section title"
                        className="form-input"
                      />
                    )}
                  </FormField>
                  <div>
                    <RichTextEditor
                      id={`section-text-${row.rowId}`}
                      value={row.default_content}
                      onChange={(html) => setRow(row.rowId, { default_content: html })}
                      label={`Starting text for ${row.title || `section ${index + 1}`}`}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={row.required}
                      onChange={(e) => setRow(row.rowId, { required: e.target.checked })}
                    />
                    <span className="text-theme-text-secondary">
                      Required: needs text before the minutes can be circulated
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={Boolean(row.needs_motion)}
                      onChange={(e) => setRow(row.rowId, { needs_motion: e.target.checked })}
                    />
                    <span className="text-theme-text-secondary">
                      Needs a motion and a second. The motion is prepared with the minutes, as for adopting the previous
                      minutes or adjourning
                    </span>
                  </label>
                  {row.needs_motion && (
                    <FormField
                      label="Wording of the motion"
                      id={`section-motion-${row.rowId}`}
                      error={errors[`motion-${row.rowId}`]}
                      hint="The secretary can reword it on the minutes before recording the motion."
                      maxLength={2000}
                      count={(row.motion_text ?? '').length}
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="text"
                          value={row.motion_text ?? ''}
                          onChange={(e) => {
                            setRow(row.rowId, { motion_text: e.target.value });
                            clearError(`motion-${row.rowId}`);
                          }}
                          placeholder="Motion to adjourn the meeting."
                          className="form-input"
                        />
                      )}
                    </FormField>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="btn-icon"
                    aria-label={`Move ${row.title || `section ${index + 1}`} up`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    className="btn-icon"
                    aria-label={`Move ${row.title || `section ${index + 1}`} down`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((r) => r.rowId !== row.rowId))}
                    className="btn-icon text-red-800 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
                    aria-label={`Remove ${row.title || `section ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" onClick={addRow} className="btn-secondary mt-2 inline-flex items-center gap-1 text-sm">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add section
        </button>
      </fieldset>
    </Modal>
  );
};

export default OutlineEditorModal;
