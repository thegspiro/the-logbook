import React from 'react';
import { FileText } from 'lucide-react';
import type { EventTemplate } from '../../types/event';
import { EventType as EventTypeEnum } from '../../constants/enums';

interface EventTemplatePickerProps {
  templates: EventTemplate[];
  value: string;
  onChange: (templateId: string) => void;
  /** What picking one does, under the picker. */
  hint: string;
  /** Mark Training templates, where the list mixes types. */
  markTraining?: boolean | undefined;
}

/**
 * "Start from a Template", above an event form. A pick replaces what is
 * typed, so the host remounts its form with the template's values; the picker
 * itself stays mounted, keeping focus on it.
 */
export const EventTemplatePicker: React.FC<EventTemplatePickerProps> = ({
  templates,
  value,
  onChange,
  hint,
  markTraining = false,
}) => (
  <div className="card mb-6 p-6">
    <div className="mb-3 flex items-center space-x-2">
      <FileText className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
      <h2 className="text-theme-text-primary text-lg font-semibold">Start from a Template</h2>
    </div>
    <p id="event-template-hint" className="text-theme-text-muted mb-3 text-sm">
      {hint}
    </p>
    <select
      aria-label="Start from a template"
      aria-describedby="event-template-hint"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="form-input px-3 text-sm focus:ring-red-500 sm:w-96"
    >
      <option value="">— No template —</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.description ? ` — ${t.description}` : ''}
          {markTraining && t.event_type === EventTypeEnum.TRAINING ? ' (Training)' : ''}
        </option>
      ))}
    </select>
  </div>
);
