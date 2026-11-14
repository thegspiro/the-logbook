/**
 * Every save says whether it is a minor or a substantial change, and why.
 * A substantial change to a public record needs clearing again before the
 * public sees it; a minor one goes live and is recorded.
 */
import React from 'react';
import type { EditKind } from '../types';

interface EditKindChoiceProps {
  kind: EditKind;
  note: string;
  onKindChange: (kind: EditKind) => void;
  onNoteChange: (note: string) => void;
  isPublic: boolean;
}

export const EditKindChoice: React.FC<EditKindChoiceProps> = ({ kind, note, onKindChange, onNoteChange, isPublic }) => (
  <fieldset className="card-secondary rounded-md p-3">
    <legend className="form-label">What kind of change is this?</legend>
    <div className="flex flex-wrap gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="edit-kind" checked={kind === 'minor'} onChange={() => onKindChange('minor')} />
        <span className="text-theme-text-primary">Minor (spelling, formatting)</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="edit-kind"
          checked={kind === 'substantial'}
          onChange={() => onKindChange('substantial')}
        />
        <span className="text-theme-text-primary">Substantial (new facts, rewrites)</span>
      </label>
    </div>
    {isPublic && (
      <p className="text-theme-text-secondary mt-2 text-sm">
        {kind === 'substantial'
          ? 'The public keeps the last cleared version until this change is cleared.'
          : 'This change reaches the public copy straight away.'}
      </p>
    )}
    <label className="mt-2 block">
      <span className="form-label">Note for the change history (optional)</span>
      <input value={note} maxLength={2000} onChange={(e) => onNoteChange(e.target.value)} className="form-input" />
    </label>
  </fieldset>
);
