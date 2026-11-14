/**
 * A person's periods of service — several when they left and rejoined — and
 * the titles held in each. Saved as one replacement, with an edit kind.
 */
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import type { EditKind, HistoricalMemberFullView, HistoryTitle, ServicePeriodWrite } from '../types';
import { EditKindChoice } from './EditKindChoice';
import { PartialDateInput } from './PartialDateInput';
import { TitlePicker } from './TitlePicker';

interface ServicePeriodsEditorProps {
  person: HistoricalMemberFullView;
  titles: HistoryTitle[];
  onTitleAdded: (title: HistoryTitle) => void;
  onSaved: (person: HistoricalMemberFullView) => void;
  onCancel: () => void;
}

const blankPeriod = (): ServicePeriodWrite => ({
  start_date: null,
  start_precision: 'year',
  start_circa: false,
  end_date: null,
  end_precision: 'year',
  end_circa: false,
  is_ongoing: false,
  notes: null,
  title_ids: [],
});

export const ServicePeriodsEditor: React.FC<ServicePeriodsEditorProps> = ({
  person,
  titles,
  onTitleAdded,
  onSaved,
  onCancel,
}) => {
  const [periods, setPeriods] = useState<ServicePeriodWrite[]>(() =>
    person.service_periods.map((p) => ({
      start_date: p.start_date,
      start_precision: p.start_precision,
      start_circa: p.start_circa,
      end_date: p.end_date,
      end_precision: p.end_precision,
      end_circa: p.end_circa,
      is_ongoing: p.is_ongoing,
      notes: p.notes,
      title_ids: p.titles.map((t) => t.id),
    }))
  );
  const [editKind, setEditKind] = useState<EditKind>('substantial');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (index: number, change: Partial<ServicePeriodWrite>) =>
    setPeriods((current) => current.map((p, i) => (i === index ? { ...p, ...change } : p)));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await historyService.replacePeriods(
        person.id,
        periods.map((p) => ({ ...p, notes: p.notes?.trim() || null })),
        editKind,
        editNote.trim() || undefined
      );
      toast.success('Service saved');
      onSaved(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the service periods'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {periods.length === 0 && <p className="text-theme-text-secondary text-sm">No periods of service recorded yet.</p>}
      {periods.map((period, index) => (
        <fieldset key={index} className="card-secondary space-y-3 rounded-md p-3">
          <legend className="text-theme-text-primary font-medium">Period {index + 1}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <PartialDateInput
              label="Joined"
              value={period.start_date}
              precision={period.start_precision}
              circa={period.start_circa}
              onChange={(next) =>
                update(index, { start_date: next.value, start_precision: next.precision, start_circa: next.circa })
              }
            />
            <div>
              <PartialDateInput
                label="Left"
                value={period.end_date}
                precision={period.end_precision}
                circa={period.end_circa}
                disabled={period.is_ongoing}
                onChange={(next) =>
                  update(index, { end_date: next.value, end_precision: next.precision, end_circa: next.circa })
                }
              />
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={period.is_ongoing}
                  onChange={(e) => update(index, { is_ongoing: e.target.checked, end_date: null })}
                />
                <span className="text-theme-text-primary">Still serving</span>
              </label>
            </div>
          </div>
          <TitlePicker
            label="Titles held"
            titles={titles}
            selectedIds={period.title_ids}
            onChange={(ids) => update(index, { title_ids: ids })}
            onTitleAdded={onTitleAdded}
          />
          <label className="block">
            <span className="form-label">Notes</span>
            <textarea
              value={period.notes ?? ''}
              onChange={(e) => update(index, { notes: e.target.value })}
              rows={2}
              className="form-input"
            />
          </label>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1 rounded-md"
            onClick={() => setPeriods((current) => current.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove period
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn-secondary btn-sm inline-flex items-center gap-1 rounded-md"
        onClick={() => setPeriods((current) => [...current, blankPeriod()])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add a period of service
      </button>
      <EditKindChoice
        kind={editKind}
        note={editNote}
        onKindChange={setEditKind}
        onNoteChange={setEditNote}
        isPublic={person.publication_level === 'public'}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary rounded-md px-4 py-2"
          disabled={saving}
          onClick={() => void save()}
        >
          Save service
        </button>
        <button type="button" className="btn-secondary rounded-md px-4 py-2" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};
