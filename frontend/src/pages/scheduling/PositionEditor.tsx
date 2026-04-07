/**
 * Inline position editor -- renders a label that toggles to a select dropdown on click.
 *
 * Extracted from ShiftDetailPanel to share between the standard assignment row
 * and the crew board slot views.
 */

import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { POSITION_LABELS } from '../../constants/enums';

interface PositionEditorProps {
  assignmentId: string;
  currentPosition: string;
  /** Display label for the position (used in crew board mode where the slot label may differ) */
  displayLabel?: string;
  positionOptions: [string, string][];
  onSave: (assignmentId: string, newPosition: string, currentPosition: string) => void;
  editable: boolean;
  updatingPosition: boolean;
}

export const PositionEditor: React.FC<PositionEditorProps> = ({
  assignmentId,
  currentPosition,
  displayLabel,
  positionOptions,
  onSave,
  editable,
  updatingPosition,
}) => {
  const [isEditing, setIsEditing] = useState(false);

  if (editable && isEditing) {
    return (
      <select
        value={currentPosition}
        onChange={e => { onSave(assignmentId, e.target.value, currentPosition); setIsEditing(false); }}
        onBlur={() => { if (!updatingPosition) setIsEditing(false); }}
        disabled={updatingPosition}
        className="text-xs bg-theme-input-bg border border-theme-input-border rounded-sm px-1 py-0.5 text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
        autoFocus
      >
        {positionOptions.map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>
    );
  }

  const label = displayLabel || POSITION_LABELS[currentPosition] || currentPosition;

  return (
    <button
      type="button"
      className={`text-xs capitalize ${editable ? 'text-theme-text-muted hover:text-violet-500 transition-colors inline-flex items-center gap-0.5' : 'text-theme-text-muted'}`}
      onClick={editable ? () => setIsEditing(true) : undefined}
      disabled={!editable}
      title={editable ? 'Click to change position' : undefined}
    >
      {label}
      {editable && <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-50" />}
    </button>
  );
};
