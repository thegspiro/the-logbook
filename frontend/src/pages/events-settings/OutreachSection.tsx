import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { OutreachEventTypeConfig } from '../../types/event';
import type { OutreachSectionProps } from './types';

const OutreachSection: React.FC<OutreachSectionProps> = ({
  settings,
  saving,
  onAddType,
  onRemoveType,
  newTypeLabel,
  onNewTypeLabelChange,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Outreach Event Types</h3>
        <p className="text-theme-text-muted mt-1 text-sm">Types of public outreach events shown on the request form.</p>
      </div>

      <div className="space-y-2">
        {settings.outreach_event_types.map((ot: OutreachEventTypeConfig) => (
          <div
            key={ot.value}
            className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-theme-text-primary text-sm font-medium">{ot.label}</span>
              <span className="text-theme-text-muted font-mono text-xs">{ot.value}</span>
            </div>
            {ot.value !== 'other' && (
              <button
                type="button"
                onClick={() => onRemoveType(ot.value)}
                disabled={saving}
                className="text-theme-text-muted text-sm transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title={`Remove "${ot.label}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="new-outreach-label" className="text-theme-text-muted mb-1 block text-xs font-medium">
            Type Name
          </label>
          <input
            id="new-outreach-label"
            type="text"
            value={newTypeLabel}
            onChange={(e) => onNewTypeLabelChange(e.target.value)}
            placeholder="e.g., School Visit"
            className="form-input placeholder-theme-text-muted text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onAddType}
          disabled={saving || !newTypeLabel.trim()}
          className="btn-primary flex items-center gap-1.5 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
};

export default OutreachSection;
