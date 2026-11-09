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
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { meetingsService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { AGENDA_ITEM_LIMITS, agendaErrorKey, agendaFieldId, type AgendaItemField } from '../utils/agendaItemFields';
import { AgendaItemsEditor } from './AgendaItemsEditor';
import type { AgendaItem, MeetingRecord } from '../../../services/api';

interface AgendaEditorDialogProps {
  meeting: MeetingRecord | null;
  hasMinutes: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const FIELD_LABELS: Record<AgendaItemField, string> = {
  title: 'Item title',
  presenter: 'Presented by',
  notes: 'Notes',
  motion_text: 'Motion wording',
};

/** One spec per item field, addressed as the API names it: `agenda_items.<n>.<field>`. */
function agendaFieldSpecs(items: AgendaItem[]): Record<string, ServerFieldSpec> {
  const specs: Record<string, ServerFieldSpec> = {};
  items.forEach((item, index) => {
    for (const field of Object.keys(AGENDA_ITEM_LIMITS) as AgendaItemField[]) {
      specs[agendaErrorKey(item.key, field)] = {
        label: FIELD_LABELS[field],
        maxLength: AGENDA_ITEM_LIMITS[field],
        api: `agenda_items.${index}.${field}`,
      };
    }
  });
  return specs;
}

export const AgendaEditorDialog: React.FC<AgendaEditorDialogProps> = ({ meeting, hasMinutes, onClose, onSaved }) => {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setItems(meeting?.agenda_items ?? []);
    setErrors({});
    setFormError(null);
  }, [meeting]);

  // Compared by value: the editor builds new item objects on every keystroke.
  const isDirty = meeting !== null && JSON.stringify(items) !== JSON.stringify(meeting.agenda_items ?? []);
  // Called here rather than given to Modal so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    for (const item of items) {
      const field = (Object.keys(AGENDA_ITEM_LIMITS) as AgendaItemField[]).find(
        (f) => next[agendaErrorKey(item.key, f)]
      );
      if (field) {
        window.setTimeout(() => document.getElementById(agendaFieldId('agenda', item.key, field))?.focus(), 0);
        return;
      }
    }
  };

  const changeItems = (next: AgendaItem[]) => {
    setItems(next);
    // An edited field's refusal no longer describes what is in it.
    setErrors((prev) => {
      const kept: Partial<Record<string, string>> = {};
      for (const item of next) {
        const before = items.find((i) => i.key === item.key);
        for (const field of Object.keys(AGENDA_ITEM_LIMITS) as AgendaItemField[]) {
          const key = agendaErrorKey(item.key, field);
          if (prev[key] && before && before[field] === item[field]) kept[key] = prev[key];
        }
      }
      return kept;
    });
  };

  // The agenda is one value on the meeting, so a refusal anywhere in it saves
  // none of it: the meeting keeps its stored agenda and the dialog stays open
  // with each refused field flagged (owner rule of 2026-11-05).
  const save = async () => {
    if (!meeting) return;
    const blank: Partial<Record<string, string>> = {};
    for (const item of items) {
      if (!item.title.trim()) blank[agendaErrorKey(item.key, 'title')] = 'Give this item a title.';
    }
    if (Object.keys(blank).length > 0) {
      showErrors(blank);
      return;
    }
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      await meetingsService.updateMeeting(meeting.id, {
        agenda_items: items.map((i) => ({ ...i, title: i.title.trim() })),
      });
      toast.success('Agenda saved');
      await onSaved();
      onClose();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, agendaFieldSpecs(items));
      if (mapped) {
        showErrors(mapped.fieldErrors);
        if (mapped.unmatched.length) setFormError(mapped.unmatched.join(' '));
      } else {
        toast.error(getErrorMessage(err, 'Failed to save the agenda'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={meeting !== null}
      onClose={requestClose}
      title={meeting ? `Agenda: ${meeting.title}` : 'Agenda'}
      size="xl"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
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
      {formError && (
        <p role="alert" className="alert-danger text-theme-text-primary mb-3 text-sm">
          {formError}
        </p>
      )}
      <AgendaItemsEditor idPrefix="agenda" items={items} onChange={changeItems} disabled={saving} errors={errors} />
    </Modal>
  );
};

export default AgendaEditorDialog;
