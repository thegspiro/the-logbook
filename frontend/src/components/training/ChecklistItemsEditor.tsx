/**
 * Editor for the steps of a CHECKLIST requirement.
 *
 * Replaces the one-item-per-line textarea the three requirement forms each had
 * a copy of. A textarea could only ever carry the step's text; a step now also
 * carries whether the member sees it, so a department can track "background
 * check returned" on the same requirement as "gear issued" without showing the
 * recruit the first one.
 *
 * Steps keep their `id` across edits so an officer renaming or reordering a
 * step does not wipe the sign-off already recorded against it. A step typed in
 * here has no id until it is saved — the server assigns one.
 */

import React from 'react';
import { Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { ChecklistItem } from '../../types/training';
import { emptyChecklistItem } from '../../utils/checklistItems';

interface Props {
  idPrefix: string;
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export const ChecklistItemsEditor: React.FC<Props> = ({ idPrefix, items, onChange }) => {
  const update = (index: number, patch: Partial<ChecklistItem>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div>
      <span className="text-theme-text-muted mb-1 block text-xs font-medium">Checklist steps</span>
      <p className="text-theme-text-muted mb-2 text-xs">
        Each step is signed off on its own, so the member watches the requirement fill up rather than waiting for one
        all-or-nothing tick. Turn off the eye to keep a step off the member&apos;s view — it still has to be done, and
        it still counts toward their progress.
      </p>

      {items.length === 0 ? (
        <p className="text-theme-text-muted py-2 text-center text-xs">No steps yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={item.id || `new-${index}`} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move step ${index + 1} up`}
                  className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
                >
                  <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <input
                type="text"
                id={`${idPrefix}-step-${index}`}
                value={item.text}
                onChange={(e) => update(index, { text: e.target.value })}
                placeholder="e.g., Station tour completed"
                className="form-input-sm flex-1"
                aria-label={`Checklist step ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => update(index, { member_visible: !item.member_visible })}
                title={
                  item.member_visible
                    ? 'The member can see this step — click to make it officer-only'
                    : 'Officer-only — click to show it to the member'
                }
                aria-label={
                  item.member_visible
                    ? `Hide step ${index + 1} from the member`
                    : `Show step ${index + 1} to the member`
                }
                aria-pressed={!item.member_visible}
                className={`mobile-touch-target rounded-md border px-2 py-1 text-xs ${
                  item.member_visible
                    ? 'border-theme-surface-border text-theme-text-muted'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                }`}
              >
                {item.member_visible ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove step ${index + 1}`}
                className="text-theme-text-muted p-1 hover:text-red-700 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange([...items, emptyChecklistItem()])}
        className="mt-2 inline-flex items-center gap-1 text-xs text-red-700 hover:underline dark:text-red-400"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add step
      </button>
    </div>
  );
};
