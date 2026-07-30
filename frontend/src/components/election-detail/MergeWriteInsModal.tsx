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
const MergeWriteInsModal: React.FC<MergeWriteInsModalProps> = ({
  candidates,
  merging,
  error,
  onSubmit,
  onClose,
}) => {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState('');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const writeIns = candidates.filter(
    (c) => c.is_write_in && !c.merged_into_candidate_id,
  );
  const targets = candidates.filter(
    (c) => !c.merged_into_candidate_id && !selectedSources.has(c.id),
  );

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
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-write-ins-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="merge-write-ins-title" className="text-lg font-medium text-theme-text-primary">
            Merge Write-In Variants
          </h3>
        </div>

        <div className="px-6 py-4 modal-body">
          <p className="text-sm text-theme-text-secondary mb-4">
            Select the misspelled write-in entries, then the candidate they
            should count for. Vote records are never modified — results simply
            count the variants under the chosen candidate. The merge is audited.
          </p>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <p className="text-sm font-medium text-theme-text-secondary mb-2">
            Variants to merge (write-ins only)
          </p>
          {writeIns.length === 0 ? (
            <p className="text-sm text-theme-text-muted mb-4">No write-in candidates.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {writeIns.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedSources.has(c.id)}
                    onChange={() => toggleSource(c.id)}
                    className="form-checkbox"
                  />
                  <span className="text-sm text-theme-text-primary">
                    {c.name}
                    {c.position && (
                      <span className="text-xs text-theme-text-muted ml-1">({c.position})</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <label htmlFor="merge-target" className="block text-sm font-medium text-theme-text-secondary">
            Count their votes for
          </label>
          <select
            id="merge-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring"
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
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
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
