/**
 * Edit a meeting's agenda from the meetings list.
 *
 * The agenda is saved on the meeting. Minutes already drafted from it are not
 * changed by saving; the secretary reviews the difference with "Sync from
 * agenda" on the minutes.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { meetingsService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { AgendaItemsEditor } from './AgendaItemsEditor';
import type { AgendaItem, MeetingRecord } from '../../../services/api';

interface AgendaEditorDialogProps {
  meeting: MeetingRecord | null;
  hasMinutes: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export const AgendaEditorDialog: React.FC<AgendaEditorDialogProps> = ({ meeting, hasMinutes, onClose, onSaved }) => {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(meeting?.agenda_items ?? []);
  }, [meeting]);

  const valid = items.every((i) => i.title.trim() !== '');

  const save = async () => {
    if (!meeting || !valid) return;
    setSaving(true);
    try {
      await meetingsService.updateMeeting(meeting.id, {
        agenda_items: items.map((i) => ({ ...i, title: i.title.trim() })),
      });
      toast.success('Agenda saved');
      await onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the agenda'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={meeting !== null}
      onClose={onClose}
      title={meeting ? `Agenda: ${meeting.title}` : 'Agenda'}
      size="xl"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving || !valid} className="btn-primary">
            {saving ? 'Saving…' : 'Save agenda'}
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        Each item becomes a section of the minutes drafted from this meeting, in this order.
        {hasMinutes &&
          ' Minutes already drafted are not changed; use “Sync from agenda” on them to review the changes.'}{' '}
        Linked documents you cannot open are not shown here, and are kept when you save.
      </p>
      <AgendaItemsEditor idPrefix="agenda" items={items} onChange={setItems} disabled={saving} />
      {!valid && (
        <p className="text-theme-text-muted mt-2 text-sm" role="status">
          Every item needs a title.
        </p>
      )}
    </Modal>
  );
};

export default AgendaEditorDialog;
