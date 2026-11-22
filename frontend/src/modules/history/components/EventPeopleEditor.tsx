/**
 * The past members who took part in an event, each with an optional role in
 * the Historian's own words ("commanded", "injured", "first on scene").
 */
import React from 'react';
import { X } from 'lucide-react';
import type { LinkedPerson } from '../utils/eventCatalogue';
import { PersonTagPicker } from './PersonTagPicker';

interface EventPeopleEditorProps {
  value: LinkedPerson[];
  onChange: (next: LinkedPerson[]) => void;
  disabled?: boolean;
}

export const EventPeopleEditor: React.FC<EventPeopleEditorProps> = ({ value, onChange, disabled = false }) => (
  <div className="space-y-3">
    {value.length > 0 && (
      <ul className="space-y-2" aria-label="People in this event">
        {value.map((person) => (
          <li key={person.member_id} className="flex flex-wrap items-end gap-2">
            <span className="text-theme-text-primary min-w-0 flex-[1_1_10rem] pb-2 text-sm font-medium">
              {person.display_name}
            </span>
            <label className="min-w-0 flex-[2_1_12rem]">
              <span className="form-label">Role</span>
              <input
                value={person.role}
                maxLength={100}
                placeholder="Optional"
                disabled={disabled}
                onChange={(e) =>
                  onChange(value.map((p) => (p.member_id === person.member_id ? { ...p, role: e.target.value } : p)))
                }
                className="form-input"
              />
            </label>
            <button
              type="button"
              className="btn-icon touch-target-phone"
              aria-label={`Remove ${person.display_name}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((p) => p.member_id !== person.member_id))}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    )}
    {/* The picker only adds: its own list of chosen people is hidden by
        passing none, so each person appears once, with their role, above. */}
    <PersonTagPicker
      value={[]}
      disabled={disabled}
      onChange={(picked) => {
        const added = picked.filter((p) => !value.some((v) => v.member_id === p.member_id));
        onChange([...value, ...added.map((p) => ({ member_id: p.member_id, display_name: p.display_name, role: '' }))]);
      }}
    />
  </div>
);
