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
import { meetingsService } from '../../../services/api';
import type { ActionItemSummary } from '../../../services/api';
import type { ActionItemAssignee } from '../../minutes/types/minutes';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';

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
}

export const MeetingActionItemDialog: React.FC<MeetingActionItemDialogProps> = ({
  item,
  assignees,
  onClose,
  onSaved,
}) => {
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('0');
  const [status, setStatus] = useState('open');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
  }, [item]);

  // The picker lists active members only. An item already assigned to someone
  // who has since left keeps them as an option, or opening the form and saving
  // it unchanged would silently unassign the item.
  const options =
    item?.assignee_id && !assignees.some((a) => a.id === item.assignee_id)
      ? [{ id: item.assignee_id, name: item.assignee_name ?? 'Former member' }, ...assignees]
      : assignees;

  const save = async () => {
    if (!item) return;
    if (!description.trim()) {
      toast.error('Describe the action item');
      return;
    }
    setSaving(true);
    try {
      await meetingsService.updateActionItem(item.id, {
        description: description.trim(),
        assigned_to: blankToNull(assignee),
        due_date: blankToNull(dueDate),
        priority: Number(priority),
        status,
        completion_notes: blankToNull(notes),
      });
      toast.success('Action item updated');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the action item'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={item !== null}
      onClose={onClose}
      title="Edit meeting action item"
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {item && (
        <div className="space-y-4">
          {item.source_title && <p className="text-theme-text-muted text-xs">From {item.source_title}</p>}
          <div>
            <label htmlFor="meeting-item-description" className="form-label">
              Description
            </label>
            <textarea
              id="meeting-item-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="meeting-item-assignee" className="form-label">
                Assigned to
              </label>
              <select
                id="meeting-item-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="form-input"
              >
                <option value="">Unassigned</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="meeting-item-due" className="form-label">
                Due date
              </label>
              <input
                id="meeting-item-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="form-input"
              />
            </div>
            <div>
              <label htmlFor="meeting-item-priority" className="form-label">
                Priority
              </label>
              <select
                id="meeting-item-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="form-input"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="meeting-item-status" className="form-label">
                Status
              </label>
              <select
                id="meeting-item-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="form-input"
              >
                {MEETING_ITEM_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="meeting-item-notes" className="form-label">
              Completion notes
            </label>
            <textarea
              id="meeting-item-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input"
            />
          </div>
        </div>
      )}
    </Modal>
  );
};
