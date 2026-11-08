/**
 * Edit a meeting action item (owner decision 2026-11-01: "show and manage
 * meeting action items").
 *
 * Every field `PATCH /meetings/action-items/{id}` accepts is on the form, and
 * every one is sent on save: the update is `exclude_unset`, so a field left out
 * would keep its old value behind a success toast (Pitfall #1). Clearing the
 * assignee, due date or notes sends `null`.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { meetingsService } from '../../../services/api';
import type { ActionItemSummary } from '../../../services/api';
import type { ActionItemAssignee } from '../../minutes/types/minutes';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

type ItemField = 'description' | 'assigned_to' | 'due_date' | 'priority' | 'status' | 'completion_notes';

/** ActionItemUpdate in schemas/meetings.py: snake_case, no max_length on these. */
const ITEM_FIELDS: Record<ItemField, ServerFieldSpec> = {
  description: { label: 'Description' },
  assigned_to: { label: 'Assigned to' },
  due_date: { label: 'Due date' },
  priority: { label: 'Priority' },
  status: { label: 'Status' },
  completion_notes: { label: 'Completion notes' },
};

/** In the order they appear, so the first failing one takes focus. */
const ITEM_FIELD_IDS: Record<ItemField, string> = {
  description: 'meeting-item-description',
  assigned_to: 'meeting-item-assignee',
  due_date: 'meeting-item-due',
  priority: 'meeting-item-priority',
  status: 'meeting-item-status',
  completion_notes: 'meeting-item-notes',
};

/** The statuses a meeting item stores (`ActionItemStatus` in models/meeting.py). */
const MEETING_ITEM_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/** `MeetingActionItem.priority`: 0 normal, 1 high, 2 urgent. */
const PRIORITIES = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Urgent' },
] as const;

interface MeetingActionItemDialogProps {
  item: ActionItemSummary | null;
  assignees: ActionItemAssignee[];
  onClose: () => void;
  onSaved: () => void;
  /** After a save that kept a refused field back: the dialog stays open, so refresh behind it. */
  onSavedExcept?: (() => void) | undefined;
}

export const MeetingActionItemDialog: React.FC<MeetingActionItemDialogProps> = ({
  item,
  assignees,
  onClose,
  onSaved,
  onSavedExcept,
}) => {
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('0');
  const [status, setStatus] = useState('open');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ItemField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState(false);
  const clearError = (field: ItemField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Re-seeded on each open, so an edit abandoned on one item never carries
  // into the next.
  useEffect(() => {
    if (!item) return;
    setDescription(item.description);
    setAssignee(item.assignee_id ?? '');
    setDueDate(item.due_date ?? '');
    setPriority(item.priority ?? '0');
    setStatus(item.status);
    setNotes(item.completion_notes ?? '');
    setErrors({});
    setFormError(null);
    setSavedExcept(false);
  }, [item]);

  // Anything changed from the stored item is unsaved work, so Escape, the X
  // and Cancel ask first (forms review F-6).
  const isDirty =
    item !== null &&
    (description !== item.description ||
      assignee !== (item.assignee_id ?? '') ||
      dueDate !== (item.due_date ?? '') ||
      priority !== (item.priority ?? '0') ||
      status !== item.status ||
      notes !== (item.completion_notes ?? ''));

  // Called here rather than passed to Modal as isDirty, so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const showErrors = (next: Partial<Record<ItemField, string>>) => {
    setErrors(next);
    const first = (Object.keys(ITEM_FIELD_IDS) as ItemField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(ITEM_FIELD_IDS[first])?.focus(), 0);
  };

  // The picker lists active members only. An item already assigned to someone
  // who has since left keeps them as an option, or opening the form and saving
  // it unchanged would silently unassign the item.
  const options =
    item?.assignee_id && !assignees.some((a) => a.id === item.assignee_id)
      ? [{ id: item.assignee_id, name: item.assignee_name ?? 'Former member' }, ...assignees]
      : assignees;

  /**
   * A single save (owner rule of 2026-11-05): a field this form or the server
   * refuses is left out, so the item keeps its stored value, the rest is
   * written, and the dialog stays open with the field flagged.
   */
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    let refused: Partial<Record<ItemField, string>> = {};
    if (!description.trim()) refused.description = 'Describe the action item.';
    const update: Record<ItemField, unknown> = {
      description: description.trim(),
      assigned_to: blankToNull(assignee),
      due_date: blankToNull(dueDate),
      priority: Number(priority),
      status,
      completion_notes: blankToNull(notes),
    };
    const without = () => {
      const rest: Partial<Record<ItemField, unknown>> = { ...update };
      for (const field of Object.keys(refused) as ItemField[]) delete rest[field];
      return rest;
    };
    setSaving(true);
    setFormError(null);
    setSavedExcept(false);
    try {
      try {
        await meetingsService.updateActionItem(item.id, without());
      } catch (err: unknown) {
        const mapped = mapServerFieldErrors(err, ITEM_FIELDS);
        if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) {
          if (mapped) showErrors({ ...refused, ...mapped.fieldErrors });
          throw err;
        }
        refused = { ...refused, ...mapped.fieldErrors };
        await meetingsService.updateActionItem(item.id, without());
      }
      if (Object.keys(refused).length > 0) {
        showErrors(refused);
        setSavedExcept(true);
        onSavedExcept?.();
        return;
      }
      toast.success('Action item updated');
      onSaved();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, ITEM_FIELDS);
      if (mapped?.unmatched.length) setFormError(mapped.unmatched.join(' '));
      else toast.error(getErrorMessage(err, 'Could not update the action item'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={item !== null}
      onClose={requestClose}
      title="Edit meeting action item"
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={requestClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            form="meeting-item-form"
            disabled={saving}
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {item && (
        <form id="meeting-item-form" noValidate onSubmit={(e) => void save(e)} className="space-y-4">
          {item.source_title && <p className="text-theme-text-muted text-xs">From {item.source_title}</p>}
          {savedExcept && (
            <p role="status" className="alert-warning text-theme-text-primary text-sm">
              Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
            </p>
          )}
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          <FormField label="Description" required error={errors.description} id="meeting-item-description">
            {(field) => (
              <textarea
                {...field}
                rows={3}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError('description');
                }}
                className="form-input"
              />
            )}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Assigned to" error={errors.assigned_to} id="meeting-item-assignee">
              {(field) => (
                <select
                  {...field}
                  value={assignee}
                  onChange={(e) => {
                    setAssignee(e.target.value);
                    clearError('assigned_to');
                  }}
                  className="form-input"
                >
                  <option value="">Unassigned</option>
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Due date" error={errors.due_date} id="meeting-item-due">
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    clearError('due_date');
                  }}
                  className="form-input"
                />
              )}
            </FormField>
            <FormField label="Priority" error={errors.priority} id="meeting-item-priority">
              {(field) => (
                <select
                  {...field}
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    clearError('priority');
                  }}
                  className="form-input"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Status" error={errors.status} id="meeting-item-status">
              {(field) => (
                <select
                  {...field}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    clearError('status');
                  }}
                  className="form-input"
                >
                  {MEETING_ITEM_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
          <FormField label="Completion notes" error={errors.completion_notes} id="meeting-item-notes">
            {(field) => (
              <textarea
                {...field}
                rows={3}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  clearError('completion_notes');
                }}
                className="form-input"
              />
            )}
          </FormField>
        </form>
      )}
    </Modal>
  );
};
