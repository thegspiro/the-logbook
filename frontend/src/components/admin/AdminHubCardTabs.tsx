import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * An administration hub's sections drawn as cards: icon, name, a line saying
 * what the section holds, and a red count when the hub's attention queue has
 * open items there.
 *
 * A row of bare underline tabs says what a section is called, not what is in
 * it, and an officer looking for the CSV import or the payment queue had to
 * open tabs to find out. Every card is on screen at once — the grid wraps
 * rather than scrolling — so nothing is hidden behind an overflow menu.
 *
 * It is a tablist with roving focus. A card's accessible name is its label
 * alone; the description and count are its accessible description, so a
 * screen reader announces "Payments, tab, selected" before the detail, and the
 * name stays what the officer would say out loud. A panel should be labelled
 * by `${idPrefix}-tab-${id}-label`, not by the card: naming follows only one
 * aria-labelledby hop, so a panel labelled by the card would take the card's
 * whole text — label, description and count — as its name.
 */

export interface AdminHubCardTab<K extends string = string> {
  id: K;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Open attention items in this section; nothing is drawn for 0. */
  count?: number | undefined;
}

interface AdminHubCardTabsProps<K extends string> {
  tabs: AdminHubCardTab<K>[];
  activeTab: K;
  onTabChange: (tab: K) => void;
  /** Names the tablist ("Training admin areas"). */
  label: string;
  /** Prefix for element ids, unique on the page. */
  idPrefix: string;
  /**
   * Whether the caller keeps a (hidden) panel in the document for every card.
   * When it does, every card points at its panel; when only the selected
   * panel is rendered, only the selected card does, because `aria-controls`
   * naming an id that is not in the document is worse than naming none.
   */
  panelsAlwaysRendered?: boolean;
}

/**
 * Column counts by number of cards, at the widest step. Spelled out so
 * Tailwind sees each class literally. Every step is a container query: the
 * hub's own column, not the viewport, decides how many readable cards fit,
 * and the sidebar changes that as much as the screen does.
 */
const WIDE_COLUMNS: Record<number, string> = {
  2: '@xl:grid-cols-2',
  3: '@xl:grid-cols-3',
  4: '@3xl:grid-cols-4',
  5: '@3xl:grid-cols-3 @5xl:grid-cols-5',
  6: '@3xl:grid-cols-3 @5xl:grid-cols-6',
  7: '@3xl:grid-cols-4 @5xl:grid-cols-7',
};

export function AdminHubCardTabs<K extends string>({
  tabs,
  activeTab,
  onTabChange,
  label,
  idPrefix,
  panelsAlwaysRendered = false,
}: AdminHubCardTabsProps<K>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids = tabs.map((tab) => tab.id);

  /**
   * `focusedId` is the card the keystroke came from, not the selected one:
   * browser back/forward changes the selection without moving focus, and
   * stepping from the selection would skip the card the user was actually on.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, focusedId: K) => {
    const focusedIndex = ids.indexOf(focusedId);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (focusedIndex + 1) % ids.length;
    if (event.key === 'ArrowLeft') nextIndex = (focusedIndex - 1 + ids.length) % ids.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ids.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextId = ids[nextIndex];
    if (nextId === undefined) return;
    onTabChange(nextId);
    refs.current[nextId]?.focus();
  };

  return (
    <div className="@container">
      <div
        className={`grid grid-cols-2 gap-2 sm:gap-3 ${WIDE_COLUMNS[tabs.length] ?? '@3xl:grid-cols-4'}`}
        role="tablist"
        aria-label={label}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          const count = tab.count ?? 0;
          // Ids follow `${idPrefix}-tab-${id}` / `${idPrefix}-panel-${id}`; the
          // caller renders the panel under the second.
          const tabId = `${idPrefix}-tab-${tab.id}`;
          return (
            <button
              key={tab.id}
              id={tabId}
              ref={(element) => {
                refs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={isActive || panelsAlwaysRendered ? `${idPrefix}-panel-${tab.id}` : undefined}
              aria-labelledby={`${tabId}-label`}
              aria-describedby={`${tabId}-description`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              className={`focus:ring-theme-focus-ring flex min-h-11 items-center gap-2 rounded-lg border p-2.5 text-left transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden sm:flex-col sm:items-start sm:p-3 ${
                isActive
                  ? 'border-red-800 bg-red-800 text-white shadow-md'
                  : 'border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover shadow-sm'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isActive ? 'bg-white/15' : 'bg-theme-surface-secondary'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-theme-accent-red'}`} aria-hidden="true" />
                </span>
                {/* The label sits beside the icon on a phone and under it from
                    sm up; it is rendered once and moved, so the accessible name
                    never reads it twice. */}
                <span id={`${tabId}-label`} className="min-w-0 flex-1 text-sm leading-tight font-semibold sm:hidden">
                  {tab.label}
                </span>
                {count > 0 && (
                  <span
                    className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold ${
                      isActive ? 'bg-white text-red-800' : 'bg-red-800 text-white'
                    }`}
                    aria-hidden="true"
                  >
                    {count}
                  </span>
                )}
              </span>
              <span className="hidden text-sm leading-tight font-semibold sm:block" aria-hidden="true">
                {tab.label}
              </span>
              <span
                id={`${tabId}-description`}
                className={`hidden text-xs leading-snug sm:block ${isActive ? 'text-white' : 'text-theme-text-muted'}`}
              >
                {tab.description}
                {count > 0 && <span className="sr-only">. {count} need attention</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AdminHubCardTabs;
