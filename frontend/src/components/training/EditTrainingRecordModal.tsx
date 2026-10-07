import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { trainingService } from '../../services/api';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { blankToNull, numberOrNull } from '../../utils/formValues';
import { getErrorMessage } from '../../utils/errorHandling';
import type { TrainingRecord, TrainingRecordUpdate, TrainingType } from '../../types/training';

interface EditTrainingRecordModalProps {
  record: TrainingRecord;
  onClose: () => void;
  onSaved: () => void;
}

interface Fields {
  course_name: string;
  training_type: string;
  completion_date: string;
  hours_completed: string;
  credit_hours: string;
  expiration_date: string;
  certification_number: string;
  note: string;
}

const fieldsFor = (record: TrainingRecord): Fields => ({
  course_name: record.course_name,
  training_type: record.training_type,
  completion_date: record.completion_date ?? '',
  hours_completed: String(record.hours_completed ?? ''),
  credit_hours: record.credit_hours == null ? '' : String(record.credit_hours),
  expiration_date: record.expiration_date ?? '',
  certification_number: record.certification_number ?? '',
  note: '',
});

/**
 * An officer's correction to a member's training record. The member is told
 * what changed (bell and email), so the optional note is written to them.
 */
export const EditTrainingRecordModal: React.FC<EditTrainingRecordModalProps> = ({ record, onClose, onSaved }) => {
  // Mounted only while open, so the fields start from the record every time.
  const [fields, setFields] = useState<Fields>(() => fieldsFor(record));
  const [saving, setSaving] = useState(false);

  const set =
    (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const courseName = fields.course_name.trim();
    const hours = numberOrNull(fields.hours_completed);
    if (!courseName) {
      toast.error('Enter the course name');
      return;
    }
    if (!fields.completion_date) {
      toast.error('Enter the completion date');
      return;
    }
    // hours_completed is NOT NULL on the record, so a blank cannot clear it.
    if (hours === null || hours < 0) {
      toast.error('Enter the hours completed');
      return;
    }
    // Every field the form owns is sent on every save, with an explicit null
    // to clear an optional one: an omitted key means "leave this alone".
    const updates: TrainingRecordUpdate = {
      course_name: courseName,
      training_type: fields.training_type as TrainingType,
      completion_date: fields.completion_date,
      hours_completed: hours,
      credit_hours: numberOrNull(fields.credit_hours),
      expiration_date: blankToNull(fields.expiration_date),
      certification_number: blankToNull(fields.certification_number),
    };
    setSaving(true);
    try {
      await trainingService.updateRecord(record.id, updates, fields.note.trim() || undefined);
      toast.success('Training record updated');
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update training record'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit training record"
      titleId="edit-training-record-title"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="edit-record-course" className="form-label">
            Course name
          </label>
          <input
            id="edit-record-course"
            type="text"
            value={fields.course_name}
            onChange={set('course_name')}
            className="form-input"
            maxLength={255}
          />
        </div>
        <div>
          <label htmlFor="edit-record-type" className="form-label">
            Training type
          </label>
          <select
            id="edit-record-type"
            value={fields.training_type}
            onChange={set('training_type')}
            className="form-input"
          >
            {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-record-date" className="form-label">
            Completion date
          </label>
          <input
            id="edit-record-date"
            type="date"
            value={fields.completion_date}
            onChange={set('completion_date')}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="edit-record-hours" className="form-label">
            Hours completed
          </label>
          <input
            id="edit-record-hours"
            type="number"
            min={0}
            step={0.25}
            value={fields.hours_completed}
            onChange={set('hours_completed')}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="edit-record-credit" className="form-label">
            Credit hours
          </label>
          <input
            id="edit-record-credit"
            type="number"
            min={0}
            step={0.25}
            value={fields.credit_hours}
            onChange={set('credit_hours')}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="edit-record-expires" className="form-label">
            Expiration date
          </label>
          <input
            id="edit-record-expires"
            type="date"
            value={fields.expiration_date}
            onChange={set('expiration_date')}
            className="form-input"
          />
        </div>
        <div>
          <label htmlFor="edit-record-cert" className="form-label">
            Certification number
          </label>
          <input
            id="edit-record-cert"
            type="text"
            value={fields.certification_number}
            onChange={set('certification_number')}
            className="form-input"
            maxLength={100}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="edit-record-note" className="form-label">
            Note to the member (optional)
          </label>
          <textarea
            id="edit-record-note"
            rows={3}
            value={fields.note}
            onChange={set('note')}
            className="form-input"
            maxLength={1000}
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            The member is notified of what changed, with this note if you add one.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default EditTrainingRecordModal;
