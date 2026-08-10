import React, { useCallback, useState } from 'react';
import type { Candidate } from '../../types/election';

interface MergeWriteInsModalProps {
  candidates: Candidate[];
  merging: boolean;
  error: string | null;
  onSubmit: (sourceIds: string[], targetId: string) => void;
  onClose: () => void;
}

/**
 * Consolidate write-in spelling variants ("Bob Baker" / "bob baker") under
 * one candidate before results are certified. Only write-ins can be merge
 * sources; votes are never mutated — results simply count merged variants
 * under the target. The merge is audited.
 */
const MergeWriteInsModal: React.FC<MergeWriteInsModalProps> = ({ candidates, merging, error, onSubmit, onClose }) => {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState('');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const writeIns = candidates.filter((c) => c.is_write_in && !c.merged_into_candidate_id);
  const targets = candidates.filter((c) => !c.merged_into_candidate_id && !selectedSources.has(c.id));

  const toggleSource = (id: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (targetId === id) setTargetId('');
  };

  const canSubmit = selectedSources.size > 0 && targetId !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-write-ins-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="merge-write-ins-title" className="text-theme-text-primary text-lg font-medium">
            Merge Write-In Variants
          </h3>
        </div>

        <div className="modal-body px-6 py-4">
          <p className="text-theme-text-secondary mb-4 text-sm">
            Select the misspelled write-in entries, then the candidate they should count for. Vote records are never
            modified — results simply count the variants under the chosen candidate. The merge is audited.
          </p>

          {error && (
            <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <p className="text-theme-text-secondary mb-2 text-sm font-medium">Variants to merge (write-ins only)</p>
          {writeIns.length === 0 ? (
            <p className="text-theme-text-muted mb-4 text-sm">No write-in candidates.</p>
          ) : (
            <div className="mb-4 space-y-2">
              {writeIns.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedSources.has(c.id)}
                    onChange={() => toggleSource(c.id)}
                    className="form-checkbox"
                  />
                  <span className="text-theme-text-primary text-sm">
                    {c.name}
                    {c.position && <span className="text-theme-text-muted ml-1 text-xs">({c.position})</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          <label htmlFor="merge-target" className="text-theme-text-secondary block text-sm font-medium">
            Count their votes for
          </label>
          <select
            id="merge-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="form-input mt-1"
          >
            <option value="">Select a candidate…</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.position ? ` (${c.position})` : ''}
              </option>
            ))}
          </select>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={merging}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(Array.from(selectedSources), targetId)}
              disabled={merging || !canSubmit}
              className="btn-primary rounded-md disabled:opacity-50"
            >
              {merging ? 'Merging…' : `Merge ${selectedSources.size} Variant${selectedSources.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MergeWriteInsModal;
