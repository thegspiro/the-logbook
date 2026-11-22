/**
 * A truck's unit numbers over time — Engine 1 from 1924, Engine 3 from 1951 —
 * each with its own dates and, when known, its station.
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DesignationWrite, HistoryListEntry } from '../types';
import { blankDesignation } from '../utils/apparatusCatalogue';
import { ListEntrySelect } from './ListEntrySelect';
import { PartialDateInput } from './PartialDateInput';

interface DesignationsEditorProps {
  value: DesignationWrite[];
  onChange: (next: DesignationWrite[]) => void;
  stations: HistoryListEntry[];
  onStationAdded: (entry: HistoryListEntry) => void;
  disabled?: boolean;
}

export const DesignationsEditor: React.FC<DesignationsEditorProps> = ({
  value,
  onChange,
  stations,
  onStationAdded,
  disabled = false,
}) => {
  const update = (index: number, change: Partial<DesignationWrite>) =>
    onChange(value.map((d, i) => (i === index ? { ...d, ...change } : d)));

  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-theme-text-secondary text-sm">No unit numbers recorded yet.</p>}
      {value.map((designation, index) => (
        <fieldset key={index} className="card-secondary space-y-3 rounded-md p-3" disabled={disabled}>
          <legend className="text-theme-text-primary font-medium">Unit number {index + 1}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="form-label">Unit number</span>
              <input
                value={designation.designation}
                maxLength={100}
                placeholder="Engine 1"
                onChange={(e) => update(index, { designation: e.target.value })}
                className="form-input"
              />
            </label>
            <ListEntrySelect
              label="Station"
              path="stations"
              noun="station"
              entries={stations}
              value={designation.station_id ?? ''}
              onChange={(id) => update(index, { station_id: id || null })}
              onAdded={onStationAdded}
            />
            <PartialDateInput
              label="From"
              value={designation.start_date}
              precision={designation.start_precision}
              circa={designation.start_circa}
              onChange={(next) =>
                update(index, { start_date: next.value, start_precision: next.precision, start_circa: next.circa })
              }
            />
            <PartialDateInput
              label="To"
              value={designation.end_date}
              precision={designation.end_precision}
              circa={designation.end_circa}
              onChange={(next) =>
                update(index, { end_date: next.value, end_precision: next.precision, end_circa: next.circa })
              }
            />
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1 rounded-md"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove unit number
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn-secondary btn-sm inline-flex items-center gap-1 rounded-md"
        disabled={disabled}
        onClick={() => onChange([...value, blankDesignation()])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add a unit number
      </button>
    </div>
  );
};
