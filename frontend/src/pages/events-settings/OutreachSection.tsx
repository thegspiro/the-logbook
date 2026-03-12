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
        <h3 className="text-lg font-semibold text-theme-text-primary">Outreach Event Types</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Types of public outreach events shown on the request form.
        </p>
      </div>

      <div className="space-y-2">
        {settings.outreach_event_types.map((ot: OutreachEventTypeConfig) => (
          <div
            key={ot.value}
            className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-theme-text-primary">{ot.label}</span>
              <span className="text-xs text-theme-text-muted font-mono">{ot.value}</span>
            </div>
            {ot.value !== 'other' && (
              <button
                type="button"
                onClick={() => onRemoveType(ot.value)}
                disabled={saving}
                className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                title={`Remove "${ot.label}"`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="new-outreach-label" className="block text-xs font-medium text-theme-text-muted mb-1">
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
          className="btn-primary flex font-medium gap-1.5 items-center text-sm"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
    </div>
  );
};

export default OutreachSection;
