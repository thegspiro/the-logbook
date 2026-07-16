/**
 * Registry import picker — instead of importing an entire registry at once, this
 * previews the registry's requirements and lets the officer tick exactly which
 * ones to import. Requirements already in the library are shown as imported and
 * can't be re-selected.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, CheckCircle2, Circle, Download } from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';
import type { RegistryRequirementPreview } from '../types/training';

interface Props {
  registryKey: string;
  registryName: string;
  onClose: () => void;
  onImported: () => void;
}

function metaLine(item: RegistryRequirementPreview): string {
  const parts: string[] = [item.requirement_type.replace(/_/g, ' ')];
  if (item.required_hours) parts.push(`${item.required_hours} hrs`);
  if (item.frequency) parts.push(item.frequency);
  return parts.join(' · ');
}

const RegistryImportModal: React.FC<Props> = ({ registryKey, registryName, onClose, onImported }) => {
  const [items, setItems] = useState<RegistryRequirementPreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await trainingProgramService.previewRegistry(registryKey);
        if (cancelled) return;
        setItems(data);
        // Default selection: everything not already in the library.
        const preselect = data.flatMap((i) =>
          i.registry_code && !i.already_imported ? [i.registry_code] : [],
        );
        setSelected(new Set(preselect));
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load this registry.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [registryKey]);

  const selectable = useMemo(
    () => items.filter((i) => i.registry_code && !i.already_imported),
    [items],
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const allSelected = selectable.length > 0 && selected.size === selectable.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectable.flatMap((i) => (i.registry_code ? [i.registry_code] : []))));
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const result = await trainingProgramService.importRegistry(registryKey, {
        registryCodes: Array.from(selected),
      });
      if (result.errors && result.errors.length > 0) {
        toast.error(`Couldn't import ${registryName}: ${result.errors[0]}`);
      } else if (result.imported_count === 0) {
        toast(`Nothing imported from ${registryName}.`);
      } else {
        const cats = result.categories_created ?? 0;
        const catNote = cats > 0 ? ` (+${cats} section categor${cats === 1 ? 'y' : 'ies'})` : '';
        toast.success(
          `Imported ${result.imported_count} requirement${result.imported_count === 1 ? '' : 's'} from ${registryName}${catNote}`,
        );
      }
      onImported();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Import from ${registryName}`}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-theme-surface-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-theme-text-primary">Import from {registryName}</h2>
            <p className="text-theme-text-muted text-xs mt-0.5">Choose which requirements to add to your library.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-theme-text-muted hover:text-theme-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-theme-text-muted" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm">Loading registry…</span>
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>
          ) : (
            <>
              {items.some((i) => (i.sections?.length ?? 0) > 0) && (
                <p className="text-xs text-theme-text-muted mb-3 bg-theme-surface-secondary rounded-md p-2.5">
                  Some requirements track hours by section. Importing creates a training
                  category per section — tag your courses and sessions with those categories
                  and their hours will count toward the requirement.
                </p>
              )}
              {selectable.length > 0 && (
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="text-theme-text-muted">{selected.size} of {selectable.length} selected</span>
                  <button type="button" onClick={toggleAll} className="text-red-700 dark:text-red-400 hover:underline">
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                </div>
              )}
              <div className="border border-theme-surface-border rounded-lg divide-y divide-theme-surface-border">
                {items.map((item, idx) => {
                  const code = item.registry_code ?? `row-${idx}`;
                  const isSelected = !!item.registry_code && selected.has(item.registry_code);
                  const disabled = item.already_imported || !item.registry_code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => { if (item.registry_code && !disabled) toggle(item.registry_code); }}
                      disabled={disabled}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                        disabled ? 'cursor-not-allowed opacity-70' : isSelected ? 'bg-red-500/10' : 'hover:bg-theme-surface-hover'
                      }`}
                    >
                      {item.already_imported ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                      ) : isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-theme-text-muted mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-theme-text-primary truncate">{item.name}</span>
                          {item.already_imported && (
                            <span className="text-xs text-green-700 dark:text-green-400 shrink-0">Imported</span>
                          )}
                        </div>
                        <p className="text-xs text-theme-text-muted capitalize">{metaLine(item)}</p>
                        {item.sections && item.sections.length > 0 && (
                          <p className="text-xs text-theme-text-muted mt-0.5">
                            Counts hours by section: {item.sections.join(', ')}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-theme-surface-border flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleImport(); }}
            disabled={importing || selected.size === 0}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {importing ? 'Importing…' : `Import ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegistryImportModal;
