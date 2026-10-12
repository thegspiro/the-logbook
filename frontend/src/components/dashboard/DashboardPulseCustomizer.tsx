import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PulseCardId, PulseCardPreference } from '../../services/communicationsServices';

export const PULSE_TITLE_MAX_LENGTH = 40;

export type PulseSaveScope = 'personal' | 'department';

interface DashboardPulseCustomizerProps {
  /** The complete layout in effect, including cards this member cannot see. */
  cards: PulseCardPreference[];
  /** Cards this member's permissions and the department's modules allow. */
  availableIds: ReadonlySet<PulseCardId>;
  builtInTitles: Record<PulseCardId, string>;
  hasPersonalLayout: boolean;
  hasDepartmentDefault: boolean;
  canSetDepartmentDefault: boolean;
  isSaving: boolean;
  onSave: (cards: PulseCardPreference[], scope: PulseSaveScope) => void;
  onReset: (scope: PulseSaveScope) => void;
  onClose: () => void;
}

/**
 * Show, hide, reorder and rename the Department pulse cards.
 *
 * Edits a draft and writes nothing until a Save button is pressed, so a title
 * half-typed is never sent. The draft is the complete layout: a card this
 * member cannot see keeps its entry and its place, so a department default
 * saved from here does not erase what an officer with wider access arranged.
 */
export default function DashboardPulseCustomizer({
  cards,
  availableIds,
  builtInTitles,
  hasPersonalLayout,
  hasDepartmentDefault,
  canSetDepartmentDefault,
  isSaving,
  onSave,
  onReset,
  onClose,
}: DashboardPulseCustomizerProps) {
  const [draft, setDraft] = useState<PulseCardPreference[]>(cards);

  const update = (id: PulseCardId, patch: Partial<PulseCardPreference>) =>
    setDraft((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));

  // Swaps with the nearest card the member can see, skipping any they cannot,
  // so a press always moves a card past a neighbour they would notice.
  const move = (id: PulseCardId, direction: -1 | 1) =>
    setDraft((current) => {
      const from = current.findIndex((card) => card.id === id);
      let to = from + direction;
      while (to >= 0 && to < current.length && !availableIds.has(current[to]?.id as PulseCardId)) to += direction;
      const moving = current[from];
      const neighbour = current[to];
      if (!moving || !neighbour) return current;
      const next = [...current];
      next[from] = neighbour;
      next[to] = moving;
      return next;
    });

  const shown = draft.filter((card) => availableIds.has(card.id));
  const firstId = shown[0]?.id;
  const lastId = shown[shown.length - 1]?.id;

  const finished = (): PulseCardPreference[] => draft.map((card) => ({ ...card, title: card.title?.trim() || null }));

  return (
    <section aria-labelledby="pulse-customize-title" className="card mb-3 space-y-3 p-4">
      <div>
        <h3 id="pulse-customize-title" className="text-theme-text-primary text-sm font-semibold">
          Customize Department pulse
        </h3>
        <p className="text-theme-text-muted mt-1 text-xs">
          Choose which cards appear, their order, and what each is called. Only cards you can access are listed.
        </p>
      </div>
      <ul className="divide-theme-surface-border divide-y">
        {shown.map((card) => {
          const builtIn = builtInTitles[card.id];
          return (
            <li key={card.id} className="flex flex-wrap items-center gap-3 py-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={card.visible}
                  onChange={(e) => update(card.id, { visible: e.target.checked })}
                  aria-label={`Show ${builtIn}`}
                />
                <span className="text-theme-text-secondary w-40 text-sm">{builtIn}</span>
              </label>
              <input
                type="text"
                className="form-input min-w-40 flex-1"
                value={card.title ?? ''}
                maxLength={PULSE_TITLE_MAX_LENGTH}
                placeholder={builtIn}
                onChange={(e) => update(card.id, { title: e.target.value })}
                aria-label={`Title for ${builtIn}`}
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => move(card.id, -1)}
                  disabled={card.id === firstId}
                  aria-label={`Move ${builtIn} up`}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => move(card.id, 1)}
                  disabled={card.id === lastId}
                  aria-label={`Move ${builtIn} down`}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary btn-md"
          disabled={isSaving}
          onClick={() => onSave(finished(), 'personal')}
        >
          Save for me
        </button>
        {canSetDepartmentDefault && (
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={isSaving}
            onClick={() => onSave(finished(), 'department')}
          >
            Save as department default
          </button>
        )}
        {hasPersonalLayout && (
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={isSaving}
            onClick={() => onReset('personal')}
          >
            {hasDepartmentDefault ? 'Use department layout' : 'Use built-in layout'}
          </button>
        )}
        {canSetDepartmentDefault && hasDepartmentDefault && (
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={isSaving}
            onClick={() => onReset('department')}
          >
            Clear department default
          </button>
        )}
        <button type="button" className="btn-secondary btn-md" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
