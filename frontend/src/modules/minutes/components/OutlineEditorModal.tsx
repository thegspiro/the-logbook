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
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
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

  useEffect(() => {
    if (!isOpen) return;
    const source = outline ?? copyFrom;
    setName(outline ? outline.name : copyFrom ? `${copyFrom.name} (copy)` : '');
    setDescription(source?.description ?? '');
    setMeetingType(source?.meeting_type ?? 'business');
    setIsDefault(outline ? outline.is_default : false);
    setSubtitle(source?.header_config?.subtitle ?? '');
    setNotice(source?.footer_config?.confidentiality_notice ?? '');
    setRows(
      source
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
          ])
    );
    setError(null);
  }, [isOpen, outline, copyFrom]);

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

  const addRow = () =>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the outline a name.');
      return;
    }
    if (rows.length === 0) {
      setError('An outline needs at least one section.');
      return;
    }
    if (rows.some((r) => !r.title.trim())) {
      setError('Every section needs a title.');
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
    setSaving(true);
    setError(null);
    try {
      if (outline) await minutesService.updateOutline(outline.id, payload);
      else await minutesService.createOutline(payload);
      await onSaved();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save the outline'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={outline ? 'Edit outline' : copyFrom ? 'Duplicate outline' : 'New outline'}
      size="xl"
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save outline'}
          </button>
        </>
      }
    >
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="outline-name" className="form-label">
            Name
          </label>
          <input
            id="outline-name"
            type="text"
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="outline-type" className="form-label">
            Kind of meeting
          </label>
          <select
            id="outline-type"
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as MeetingType)}
            className="form-input"
          >
            {MEETING_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="outline-description" className="form-label">
            Description
          </label>
          <input
            id="outline-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="outline-subtitle" className="form-label">
            Heading under the department name
          </label>
          <input
            id="outline-subtitle"
            type="text"
            maxLength={300}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Official Meeting Minutes"
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="outline-notice" className="form-label">
            Footer notice
          </label>
          <input
            id="outline-notice"
            type="text"
            maxLength={500}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            className="form-input"
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span className="text-theme-text-primary">
            Use this for new minutes of this kind of meeting (replaces the current default)
          </span>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="form-label">Order of business</legend>
        <ol className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.rowId} className="border-theme-surface-border rounded-md border p-2">
              <div className="flex items-start gap-2">
                <span className="text-theme-text-muted mt-2 w-6 shrink-0 text-right font-mono text-xs">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <label htmlFor={`section-title-${row.rowId}`} className="sr-only">
                      Section {index + 1} title
                    </label>
                    <input
                      id={`section-title-${row.rowId}`}
                      type="text"
                      maxLength={200}
                      value={row.title}
                      onChange={(e) => setRow(row.rowId, { title: e.target.value })}
                      placeholder="Section title"
                      className="form-input"
                    />
                  </div>
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
                    <div>
                      <label htmlFor={`section-motion-${row.rowId}`} className="form-label">
                        Wording of the motion
                      </label>
                      <input
                        id={`section-motion-${row.rowId}`}
                        type="text"
                        maxLength={2000}
                        value={row.motion_text ?? ''}
                        onChange={(e) => setRow(row.rowId, { motion_text: e.target.value })}
                        placeholder="Motion to adjourn the meeting."
                        className="form-input"
                      />
                      <p className="text-theme-text-muted mt-1 text-xs">
                        The secretary can reword it on the minutes before recording the motion.
                      </p>
                    </div>
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
                    className="btn-icon text-red-600 hover:text-red-700"
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
