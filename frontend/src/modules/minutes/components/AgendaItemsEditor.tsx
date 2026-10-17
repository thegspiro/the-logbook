/**
 * The items of a meeting's agenda, as a list the clerk edits in order.
 *
 * Each item becomes a section of the minutes drafted from the meeting, so an
 * item carries what the secretary should arrive at the section with: who
 * reports, notes to start from, the motion's wording when the item is moved
 * and seconded, and the library files that go with it. It holds the list only;
 * saving belongs to whoever mounts it (the new-meeting form, or the agenda
 * dialog on an existing meeting).
 */

import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { newAgendaItemKey } from '../utils/agendaItemKey';
import { AgendaDocumentPicker } from './AgendaDocumentPicker';
import type { AgendaItem } from '../../../services/api';

export const MAX_AGENDA_ITEMS = 60;
const MAX_ITEM_DOCUMENTS = 10;

interface AgendaItemsEditorProps {
  idPrefix: string;
  items: AgendaItem[];
  onChange: (items: AgendaItem[]) => void;
  disabled?: boolean;
}

export const AgendaItemsEditor: React.FC<AgendaItemsEditorProps> = ({ idPrefix, items, onChange, disabled }) => {
  const patch = (key: string, change: Partial<AgendaItem>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const move = (index: number, delta: -1 | 1) => {
    const next = [...items];
    const a = next[index];
    const b = next[index + delta];
    if (!a || !b) return;
    next[index] = b;
    next[index + delta] = a;
    onChange(next);
  };

  const add = () =>
    onChange([
      ...items,
      {
        key: newAgendaItemKey(new Set(items.map((i) => i.key))),
        title: '',
        presenter: '',
        notes: '',
        needs_motion: false,
        motion_text: '',
        documents: [],
      },
    ]);

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-theme-text-muted text-sm">
          No agenda items. Minutes drafted from this meeting start from your outline instead.
        </p>
      )}
      <ol className="space-y-3">
        {items.map((item, index) => {
          const base = `${idPrefix}-${item.key}`;
          return (
            <li key={item.key} className="border-theme-surface-border rounded-md border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
                <div>
                  <label htmlFor={`${base}-title`} className="form-label">
                    Item {index + 1}
                  </label>
                  <input
                    id={`${base}-title`}
                    type="text"
                    maxLength={200}
                    value={item.title}
                    disabled={disabled}
                    onChange={(e) => patch(item.key, { title: e.target.value })}
                    placeholder="Treasurer's report"
                    className="form-input"
                  />
                </div>
                <div>
                  <label htmlFor={`${base}-presenter`} className="form-label">
                    Presented by
                  </label>
                  <input
                    id={`${base}-presenter`}
                    type="text"
                    maxLength={200}
                    value={item.presenter}
                    disabled={disabled}
                    onChange={(e) => patch(item.key, { presenter: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move item ${index + 1} up`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move item ${index + 1} down`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon text-red-600 hover:text-red-700"
                    disabled={disabled}
                    onClick={() => onChange(items.filter((i) => i.key !== item.key))}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <label htmlFor={`${base}-notes`} className="form-label">
                  Notes to start the section from
                </label>
                <textarea
                  id={`${base}-notes`}
                  rows={2}
                  maxLength={2000}
                  value={item.notes}
                  disabled={disabled}
                  onChange={(e) => patch(item.key, { notes: e.target.value })}
                  className="form-input"
                />
              </div>

              <div className="mt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.needs_motion}
                    disabled={disabled}
                    onChange={(e) => patch(item.key, { needs_motion: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-theme-text-primary">Needs a motion and a second</span>
                </label>
                {item.needs_motion && (
                  <div className="mt-2">
                    <label htmlFor={`${base}-motion`} className="form-label">
                      Motion wording
                    </label>
                    <textarea
                      id={`${base}-motion`}
                      rows={2}
                      maxLength={2000}
                      value={item.motion_text}
                      disabled={disabled}
                      onChange={(e) => patch(item.key, { motion_text: e.target.value })}
                      className="form-input"
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {item.documents.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label={`Documents linked to item ${index + 1}`}>
                    {item.documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="bg-theme-surface-secondary text-theme-text-primary inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
                      >
                        {doc.name}
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => patch(item.key, { documents: item.documents.filter((d) => d.id !== doc.id) })}
                          className="touch:min-h-11 touch:min-w-11 inline-flex items-center justify-center"
                          aria-label={`Unlink ${doc.name}`}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!disabled && item.documents.length < MAX_ITEM_DOCUMENTS && (
                  <AgendaDocumentPicker
                    id={`${base}-doc`}
                    linked={new Set(item.documents.map((d) => d.id))}
                    onPick={(doc) => patch(item.key, { documents: [...item.documents, doc] })}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!disabled && items.length < MAX_AGENDA_ITEMS && (
        <button type="button" onClick={add} className="btn-secondary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add an item
        </button>
      )}
    </div>
  );
};

export default AgendaItemsEditor;
