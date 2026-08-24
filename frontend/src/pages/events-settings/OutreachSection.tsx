import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { OutreachEventTypeConfig, OutreachRole } from '../../types/event';
import type { OutreachSectionProps } from './types';

const OutreachSection: React.FC<OutreachSectionProps> = ({
  settings,
  saving,
  onAddType,
  onRemoveType,
  newTypeLabel,
  onNewTypeLabelChange,
  onAddRole,
  onRemoveRole,
  newRoleLabel,
  onNewRoleLabelChange,
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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

      <div className="border-theme-surface-border border-t pt-6">
        <h3 className="text-theme-text-primary text-lg font-semibold">Outreach Roles</h3>
        <p className="text-theme-text-muted mt-1 mb-4 text-sm">
          The jobs members sign up for at a community event. These are deliberately not the riding positions used on a
          duty shift — nobody is taking a seat on an engine at a school visit, and &quot;Driver&quot; tells a member
          nothing about what they would be doing.
        </p>

        <div className="mb-4 space-y-2">
          {settings.outreach_roles.map((role: OutreachRole) => (
            <div
              key={role.value}
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-theme-text-primary text-sm font-medium">{role.label}</span>
                <span className="text-theme-text-muted font-mono text-xs">{role.value}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveRole(role.value)}
                disabled={saving}
                className="text-theme-text-muted text-sm transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title={`Remove "${role.label}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {settings.outreach_roles.length === 0 && (
            <p className="text-theme-text-muted py-4 text-center text-sm italic">
              No outreach roles configured. Signup sheets cannot be opened until there is at least one.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-outreach-role" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Role Name
            </label>
            <input
              id="new-outreach-role"
              type="text"
              value={newRoleLabel}
              onChange={(e) => onNewRoleLabelChange(e.target.value)}
              placeholder="e.g., Smoke Trailer Operator"
              className="form-input placeholder-theme-text-muted text-sm"
            />
          </div>
          <button
            type="button"
            onClick={onAddRole}
            disabled={saving || !newRoleLabel.trim()}
            className="btn-primary flex items-center gap-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default OutreachSection;
