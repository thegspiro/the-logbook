import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ScrollCueRow } from '../ux/ScrollCueRow';

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
  /**
   * Whether to print the selected section's description under the row on a
   * phone, where the cards are chips with no room for one. Off for a caller
   * that already says where the user is (Training's "you are here" strip).
   */
  showActiveDescription?: boolean;
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
  showActiveDescription = true,
}: AdminHubCardTabsProps<K>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids = tabs.map((tab) => tab.id);
  const activeDescription = tabs.find((tab) => tab.id === activeTab);

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
      {/* A phone gets one row of chips that scrolls sideways, with a cue at
          whichever edge has more; from sm up the same buttons are a grid of
          cards. One set of buttons either way, so ids and roving focus never
          exist twice. The 4px inset keeps focus rings inside the scroller,
          which clips anything past its edge. */}
      <ScrollCueRow
        className={`-m-1 flex gap-2 p-1 sm:m-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:p-0 ${WIDE_COLUMNS[tabs.length] ?? '@3xl:grid-cols-4'}`}
        role="tablist"
        aria-label={label}
        revealKey={activeTab}
        data-mobile-scroll-region
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          const count = tab.count ?? 0;
          // Ids follow `${idPrefix}-tab-${id}` / `${idPrefix}-panel-${id}`; the
          // caller renders the panel under the second.
          const tabId = `${idPrefix}-tab-${tab.id}`;
          return (
            // The button holds the icon and label and nothing else; the
            // description and count sit beside it in the card. Visible text
            // inside a control that is not in its name fails WCAG 2.5.3
            // (Label in Name) — "click Catalog" has to match — and hiding that
            // text with aria-hidden does not help, since what is measured is
            // what is seen. The button's ::after spans the card, so the whole
            // card still takes the tap. Its visibility is its own, not
            // inherited: an admin hub draws these cards invisible until its
            // first summary settles (AdminHubFrame), and WebKit left the
            // pseudo-element hidden after the card became visible again, so
            // in Safari a tap on the description fell through to it.
            <div
              key={tab.id}
              role="presentation"
              className={`focus-within:ring-theme-focus-ring relative flex shrink-0 flex-col rounded-lg border transition-colors focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-(--ring-offset-bg) ${
                isActive
                  ? 'border-red-800 bg-red-800 text-white shadow-md'
                  : 'border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover shadow-sm'
              }`}
            >
              <button
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
                className={`flex min-h-11 items-center gap-2 p-2.5 text-left whitespace-nowrap after:visible after:absolute after:inset-0 after:rounded-lg focus:outline-hidden sm:flex-col sm:items-start sm:p-3 sm:pb-2 sm:whitespace-normal ${
                  count > 0 ? 'pr-11 sm:pr-3' : ''
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isActive ? 'bg-white/15' : 'bg-theme-surface-secondary'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-theme-accent-red'}`} aria-hidden="true" />
                </span>
                <span id={`${tabId}-label`} className="min-w-0 text-sm leading-tight font-semibold">
                  {tab.label}
                </span>
              </button>
              {count > 0 && (
                // Beside the label on a phone, level with the icon from sm up.
                <span
                  className={`pointer-events-none absolute top-1/2 right-2.5 inline-flex min-w-6 -translate-y-1/2 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold sm:top-5 sm:right-3 sm:translate-y-0 ${
                    isActive ? 'bg-white text-red-800' : 'bg-red-800 text-white'
                  }`}
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
              {/* Still the tab's description: aria-describedby reads hidden
                  content, so the count is announced here rather than as a bare
                  number. */}
              <span
                id={`${tabId}-description`}
                aria-hidden="true"
                className={`hidden px-3 pb-3 text-xs leading-snug sm:block ${isActive ? 'text-white' : 'text-theme-text-muted'}`}
              >
                {tab.description}
                {count > 0 && <span className="sr-only">. {count} need attention</span>}
              </span>
            </div>
          );
        })}
      </ScrollCueRow>
      {/* Hidden from assistive technology: the selected tab already carries
          this text as its accessible description. */}
      {showActiveDescription && activeDescription && (
        <p className="text-theme-text-muted mt-2 text-sm sm:hidden" aria-hidden="true">
          <span className="text-theme-text-primary font-semibold">{activeDescription.label}</span> —{' '}
          {activeDescription.description}
        </p>
      )}
    </div>
  );
}

export default AdminHubCardTabs;
