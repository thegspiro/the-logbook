/**
 * A person's periods of service — several when they left and rejoined — and
 * the titles held in each, each with the dates it was held when known. Saved
 * as one replacement, with an edit kind.
 *
 * A title's own dates are what places it on a timeline: a period of service
 * often spans several titles, so the period's start says nothing about when a
 * chief's term began.
 */
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import type {
  EditKind,
  HeldTitleWrite,
  HistoricalMemberFullView,
  HistoryTitle,
  ServicePeriodWrite,
  TitleRef,
} from '../types';
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

/** A period as the editor holds it: every title with its dates. */
type PeriodDraft = ServicePeriodWrite & { titles: HeldTitleWrite[] };

const undatedTitle = (titleId: string): HeldTitleWrite => ({
  title_id: titleId,
  held_from_date: null,
  held_from_precision: 'year',
  held_from_circa: false,
  held_to_date: null,
  held_to_precision: 'year',
  held_to_circa: false,
});

const heldTitle = (title: TitleRef): HeldTitleWrite => ({
  title_id: title.id,
  held_from_date: title.held_from_date ?? null,
  held_from_precision: title.held_from_precision ?? 'year',
  held_from_circa: title.held_from_circa ?? false,
  held_to_date: title.held_to_date ?? null,
  held_to_precision: title.held_to_precision ?? 'year',
  held_to_circa: title.held_to_circa ?? false,
});

const blankPeriod = (): PeriodDraft => ({
  start_date: null,
  start_precision: 'year',
  start_circa: false,
  end_date: null,
  end_precision: 'year',
  end_circa: false,
  is_ongoing: false,
  notes: null,
  title_ids: [],
  titles: [],
});

export const ServicePeriodsEditor: React.FC<ServicePeriodsEditorProps> = ({
  person,
  titles,
  onTitleAdded,
  onSaved,
  onCancel,
}) => {
  const [periods, setPeriods] = useState<PeriodDraft[]>(() =>
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
      titles: p.titles.map(heldTitle),
    }))
  );
  const [editKind, setEditKind] = useState<EditKind>('substantial');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (index: number, change: Partial<PeriodDraft>) =>
    setPeriods((current) => current.map((p, i) => (i === index ? { ...p, ...change } : p)));

  /** The chosen titles changed: keep the dates of those still chosen. */
  const setTitles = (index: number, ids: string[]) =>
    setPeriods((current) =>
      current.map((p, i) =>
        i === index
          ? {
              ...p,
              title_ids: ids,
              titles: ids.map((id) => p.titles.find((t) => t.title_id === id) ?? undatedTitle(id)),
            }
          : p
      )
    );

  const updateTitle = (index: number, titleId: string, change: Partial<HeldTitleWrite>) =>
    setPeriods((current) =>
      current.map((p, i) =>
        i === index ? { ...p, titles: p.titles.map((t) => (t.title_id === titleId ? { ...t, ...change } : t)) } : p
      )
    );

  const titleName = (id: string) => titles.find((t) => t.id === id)?.name ?? 'Title';

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
            onChange={(ids) => setTitles(index, ids)}
            onTitleAdded={onTitleAdded}
          />
          {period.titles.length > 0 && (
            <div className="space-y-2">
              <p className="text-theme-text-secondary text-xs">
                When each title was held, if known. A title appears on the department timeline only with the date it
                began.
              </p>
              {period.titles.map((held) => (
                <fieldset key={held.title_id} className="grid gap-3 md:grid-cols-2">
                  <legend className="text-theme-text-primary text-sm font-medium">{titleName(held.title_id)}</legend>
                  <PartialDateInput
                    label={`${titleName(held.title_id)}: held from`}
                    value={held.held_from_date}
                    precision={held.held_from_precision}
                    circa={held.held_from_circa}
                    onChange={(next) =>
                      updateTitle(index, held.title_id, {
                        held_from_date: next.value,
                        held_from_precision: next.precision,
                        held_from_circa: next.circa,
                      })
                    }
                  />
                  <PartialDateInput
                    label={`${titleName(held.title_id)}: held to`}
                    value={held.held_to_date}
                    precision={held.held_to_precision}
                    circa={held.held_to_circa}
                    onChange={(next) =>
                      updateTitle(index, held.title_id, {
                        held_to_date: next.value,
                        held_to_precision: next.precision,
                        held_to_circa: next.circa,
                      })
                    }
                  />
                </fieldset>
              ))}
            </div>
          )}
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
