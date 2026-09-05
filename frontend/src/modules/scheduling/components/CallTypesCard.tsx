/**
 * Call Types Card
 *
 * Edits the department's own call-type list — the rows an officer tallies
 * against when closing a shift out in count-only mode.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 * - **Retire, don't delete.** A slug is the stored value on every call ever
 *   filed under it, so deleting a type in use leaves that history pointing at
 *   something nothing can label. Delete is therefore offered only for a type
 *   with nothing on record; everything else retires, which takes it off the
 *   close-out list and leaves its reports intact.
 * - **Saving materialises the built-in defaults.** An org that has never
 *   configured types is served the built-in nine, so the draft starts as those
 *   nine and the first save writes them out as the department's own. That is
 *   what makes them renamable — until then "EMS" is a constant in the backend,
 *   not a row anybody can edit.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { CallTypeOption } from '../types';
import { useConfirm } from '../../../contexts/ConfirmContext';

// Matches CallTypeOption.slug on the backend: `^[a-z0-9_]+$`, max 50.
const SLUG_MAX = 50;
// Mirrors the schema's cap on the stored list.
const MAX_TYPES = 50;

/** Derive a permanent slug from a display label. */
const slugifyCallType = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, '');

/** Append a numeric suffix until the slug is free, staying inside SLUG_MAX. */
const uniqueSlug = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/_+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return '';
};

interface CallTypesCardProps {
  /** The department's list as the server resolves it (built-ins included). */
  types: CallTypeOption[];
  /** Calls on record per slug. A slug absent here has none. */
  usage: Record<string, number>;
  /** Current call-tracking mode, so the card can say when it is inert. */
  mode: string;
  saving: boolean;
  onSave: (types: CallTypeOption[]) => Promise<void>;
}

export const CallTypesCard: React.FC<CallTypesCardProps> = ({ types, usage, mode, saving, onSave }) => {
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState<CallTypeOption[]>(types);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const serverKey = useMemo(() => JSON.stringify(types), [types]);
  const seededRef = useRef<string | null>(null);

  // Re-seed only when the server's list actually differs from what was seeded.
  // Every toggle in this panel saves the whole settings object and hands back a
  // fresh array, so re-seeding on identity would wipe half-finished edits the
  // moment somebody flipped an unrelated switch.
  useEffect(() => {
    if (seededRef.current === serverKey) return;
    seededRef.current = serverKey;
    setDraft(types.map((t) => ({ ...t })));
    setError(null);
  }, [serverKey, types]);

  const dirty = JSON.stringify(draft) !== serverKey;
  const activeCount = draft.filter((t) => t.active).length;

  const patch = useCallback((slug: string, changes: Partial<CallTypeOption>) => {
    setDraft((prev) => prev.map((t) => (t.slug === slug ? { ...t, ...changes } : t)));
    setError(null);
  }, []);

  const move = (index: number, delta: number) => {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return prev;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  };

  const addType = () => {
    const label = newLabel.trim();
    if (!label) return;
    if (draft.length >= MAX_TYPES) {
      setError(`A department can have at most ${MAX_TYPES} call types.`);
      return;
    }
    const base = slugifyCallType(label);
    if (!base) {
      setError('Give the call type a name containing letters or numbers.');
      return;
    }
    const slug = uniqueSlug(base, new Set(draft.map((t) => t.slug)));
    if (!slug) {
      setError('Could not derive a unique identifier for that name. Try a different one.');
      return;
    }
    setDraft((prev) => [...prev, { slug, label, active: true }]);
    setNewLabel('');
    setError(null);
  };

  const removeType = async (type: CallTypeOption) => {
    const ok = await confirm({
      title: `Delete "${type.label}"?`,
      message: `No calls are filed under this type, so deleting it loses nothing. Officers will no longer see it at close-out.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setDraft((prev) => prev.filter((t) => t.slug !== type.slug));
    setError(null);
  };

  const handleSave = async () => {
    const cleaned = draft.map((t) => ({ ...t, label: t.label.trim() }));
    if (cleaned.some((t) => !t.label)) {
      setError('Every call type needs a name.');
      return;
    }
    if (cleaned.length === 0) {
      // An empty stored list reads as "never configured" and the backend
      // serves the built-in nine again, so this would not do what it looks
      // like it does.
      setError('Keep at least one call type. To stop asking for a breakdown, turn every type off instead.');
      return;
    }
    setError(null);
    await onSave(cleaned);
  };

  const reset = () => {
    setDraft(types.map((t) => ({ ...t })));
    setError(null);
  };

  return (
    <div className="card-secondary p-5">
      <h3 className="text-theme-text-primary text-base font-semibold">Call types</h3>
      <p className="text-theme-text-muted mt-1 text-sm">
        The rows an officer tallies against when closing a shift out. Rename them to match how your department reports;
        anything not broken down is recorded as &ldquo;Not categorised&rdquo;.
      </p>

      {mode !== 'count_only' && (
        <div className="alert-info mt-3 text-sm">
          These take effect when <strong>Record a call count at close-out</strong> is on. It is currently off, so
          close-out logs calls one at a time instead.
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {draft.map((type, index) => {
          const used = usage[type.slug] ?? 0;
          return (
            <li
              key={type.slug}
              className="border-theme-surface-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 sm:flex-nowrap"
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  className="btn-icon-sm"
                  aria-label={`Move ${type.label} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="btn-icon-sm"
                  aria-label={`Move ${type.label} down`}
                  disabled={index === draft.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <input
                  className="form-input-sm w-full"
                  value={type.label}
                  aria-label={`Name for ${type.slug}`}
                  maxLength={100}
                  onChange={(e) => patch(type.slug, { label: e.target.value })}
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  <span className="font-mono">{type.slug}</span>
                  {' · '}
                  {used > 0 ? `${used} call${used === 1 ? '' : 's'} on record` : 'no calls on record'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={type.active}
                  aria-label={`Offer ${type.label} at close-out`}
                  onClick={() => patch(type.slug, { active: !type.active })}
                  className={`toggle-track-sm ${type.active ? 'bg-violet-600' : 'bg-theme-surface-border'}`}
                >
                  <span className={`toggle-knob-sm ${type.active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <button
                  type="button"
                  className="btn-icon-sm text-red-700 disabled:opacity-40 dark:text-red-400"
                  aria-label={`Delete ${type.label}`}
                  disabled={used > 0}
                  title={
                    used > 0
                      ? 'This type has calls filed under it. Turn it off to retire it instead — deleting it would leave those calls unlabelled.'
                      : 'Delete this type'
                  }
                  onClick={() => {
                    void removeType(type);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-theme-text-muted mt-2 text-xs">
        {activeCount === 0
          ? 'No types are on — close-out will ask for a total only.'
          : `Officers see ${activeCount} type${activeCount === 1 ? '' : 's'} at close-out, plus "Not categorised".`}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="form-label-sm">Add a call type</span>
          <input
            className="form-input-sm w-full"
            value={newLabel}
            maxLength={100}
            placeholder="e.g. Water Rescue"
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addType();
              }
            }}
          />
        </label>
        <button type="button" className="btn-secondary btn-sm" onClick={addType} disabled={!newLabel.trim()}>
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {error && (
        <div role="alert" className="alert-danger mt-3 text-sm">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={reset} disabled={!dirty || saving}>
          Reset
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={!dirty || saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? 'Saving…' : 'Save call types'}
        </button>
      </div>
    </div>
  );
};

export default CallTypesCard;
