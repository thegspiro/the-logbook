/**
 * InventoryMatchModal
 *
 * Wires an existing checklist to the inventory catalog in one reviewed pass.
 *
 * The per-item picker is fine for the item you are already editing and
 * hopeless for the two hundred you are not — which is the state every
 * checklist written before the catalog link existed is in. This proposes a
 * match for each unlinked position and asks one person to read down the list
 * once.
 *
 * Only exact name matches arrive pre-selected. A strong match is still a
 * judgement call: "Oxygen Mask" scores high against both the adult and the
 * pediatric mask, and quietly picking one would put the wrong expiry on a
 * truck. Everything else is opt-in, one checkbox at a time.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Link2, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/Modal';
import { schedulingService } from '@/modules/scheduling';
import { getErrorMessage } from '@/utils/errorHandling';
import type { InventoryMatch, LinkCoverage } from '@/modules/scheduling/types/equipmentCheck';

interface InventoryMatchModalProps {
  templateId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Fired after a successful write so the builder can refresh its items. */
  onLinked: (coverage: LinkCoverage) => void;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: 'Exact name match',
  strong: 'Close match — check this one',
  weak: 'Possible match — check this one',
};

const CONFIDENCE_CLASS: Record<string, string> = {
  exact: 'bg-green-500/10 text-green-700 dark:text-green-400',
  strong: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  weak: 'bg-theme-surface-secondary text-theme-text-muted',
};

const InventoryMatchModal: React.FC<InventoryMatchModalProps> = ({ templateId, isOpen, onClose, onLinked }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<InventoryMatch[]>([]);
  const [coverage, setCoverage] = useState<LinkCoverage | null>(null);
  /** template item id -> chosen inventory item id. Absent means "leave it". */
  const [choices, setChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    void schedulingService
      .getInventoryMatches(templateId)
      .then((result) => {
        if (cancelled) return;
        setMatches(result.matches);
        setCoverage(result.coverage);
        const preselected: Record<string, string> = {};
        for (const match of result.matches) {
          const top = match.suggestions[0];
          if (top && top.confidence === 'exact') preselected[match.templateItemId] = top.id;
        }
        setChoices(preselected);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, 'Failed to load inventory matches'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, templateId]);

  const selectedCount = Object.keys(choices).length;
  const withSuggestions = useMemo(() => matches.filter((m) => m.suggestions.length > 0), [matches]);
  const withoutSuggestions = useMemo(() => matches.filter((m) => m.suggestions.length === 0), [matches]);
  const exactCount = useMemo(() => matches.filter((m) => m.suggestions[0]?.confidence === 'exact').length, [matches]);

  const choose = (templateItemId: string, inventoryItemId: string) => {
    setChoices((prev) => {
      const next = { ...prev };
      if (next[templateItemId] === inventoryItemId) {
        delete next[templateItemId];
      } else {
        next[templateItemId] = inventoryItemId;
      }
      return next;
    });
  };

  const apply = async () => {
    if (selectedCount === 0) return;
    setSaving(true);
    try {
      const result = await schedulingService.linkInventoryItems(templateId, choices);
      toast.success(`Linked ${result.linked} item${result.linked === 1 ? '' : 's'} to inventory`);
      onLinked(result.coverage);
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to link the selected items'));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-md border px-4 py-2 text-sm"
      >
        <X className="mr-1 inline h-3.5 w-3.5" />
        Cancel
      </button>
      <button
        type="button"
        onClick={() => void apply()}
        disabled={saving || selectedCount === 0}
        className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        Link {selectedCount} item{selectedCount === 1 ? '' : 's'}
      </button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Link items to inventory" size="lg" footer={footer}>
      <div className="modal-body space-y-4">
        {loading ? (
          <div className="text-theme-text-muted flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Matching this checklist against your inventory…
          </div>
        ) : (
          <>
            {coverage && (
              <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-3 text-sm">
                <p className="text-theme-text-primary font-medium">
                  {coverage.linked} of {coverage.linkable} items are linked to inventory
                </p>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  Expiration dates, lot numbers and restock alerts only work on linked items.
                </p>
              </div>
            )}

            {matches.length === 0 ? (
              <div className="py-8 text-center">
                <Check className="mx-auto mb-2 h-8 w-8 text-green-600 dark:text-green-400" />
                <p className="text-theme-text-primary text-sm font-medium">Everything is already linked.</p>
              </div>
            ) : (
              <>
                {exactCount > 0 && (
                  <p className="text-theme-text-secondary text-xs">
                    {exactCount} exact name {exactCount === 1 ? 'match is' : 'matches are'} selected for you. Anything
                    less certain is left for you to decide.
                  </p>
                )}

                <div className="space-y-2">
                  {withSuggestions.map((match) => (
                    <div key={match.templateItemId} className="border-theme-surface-border rounded-lg border p-3">
                      <p className="text-theme-text-primary text-sm font-medium">{match.itemName}</p>
                      <div className="mt-2 space-y-1">
                        {match.suggestions.map((suggestion) => {
                          const selected = choices[match.templateItemId] === suggestion.id;
                          return (
                            <button
                              key={suggestion.id}
                              type="button"
                              onClick={() => choose(match.templateItemId, suggestion.id)}
                              aria-pressed={selected}
                              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                                selected
                                  ? 'border-blue-500 bg-blue-500/10'
                                  : 'border-theme-surface-border hover:bg-theme-surface-secondary'
                              }`}
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-theme-surface-border'
                                }`}
                              >
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                              <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm">
                                {suggestion.name}
                              </span>
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  CONFIDENCE_CLASS[suggestion.confidence] ?? CONFIDENCE_CLASS.weak
                                }`}
                              >
                                {CONFIDENCE_LABEL[suggestion.confidence] ?? 'Possible match'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {withoutSuggestions.length > 0 && (
                  <div className="border-theme-surface-border rounded-lg border border-dashed p-3">
                    <p className="text-theme-text-secondary flex items-center gap-1.5 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {withoutSuggestions.length} item
                      {withoutSuggestions.length === 1 ? ' has' : 's have'} nothing like them in inventory
                    </p>
                    <p className="text-theme-text-muted mt-1 text-xs">
                      {withoutSuggestions.map((m) => m.itemName).join(', ')}
                    </p>
                    <p className="text-theme-text-muted mt-1.5 text-xs">
                      Add them to inventory first, or leave them as plain checklist items if they are not stock.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default InventoryMatchModal;
