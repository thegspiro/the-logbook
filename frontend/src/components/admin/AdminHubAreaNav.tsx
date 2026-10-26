import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import AdminHubCardTabs from './AdminHubCardTabs';
import { ScrollCueRow } from '../ux/ScrollCueRow';

/**
 * An administration hub's two-level navigation: area cards above a card
 * holding the chosen area's pages, with a strip naming the open page and what
 * it is for.
 *
 * Every area is on screen at once, each with a line saying what it holds, so
 * an officer looking for the CSV import or the payment queue does not have to
 * open sections to find out. The area cards are the shared `AdminHubCardTabs`;
 * the page strip under them is the second level. Both are tablists with roving
 * focus, for hubs whose pages are tabs of one route (Training, Events, Members,
 * the Department Store). Scheduling and Inventory draw link strips of their
 * own instead, because each of their pages is a route.
 *
 * The page renders the panels these tabs control. The area cards' panel ids
 * follow `AdminHubCardTabs` (`${idPrefix}-panel-${area}`); the page tabs'
 * come from `tabPanelId`, which the hub shares with its own panels so the two
 * cannot disagree.
 */

export interface AdminHubAreaNavDestination<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export interface AdminHubAreaNavArea<A extends string, D> {
  id: A;
  label: string;
  description: string;
  icon: LucideIcon;
  destinations: D[];
}

interface AdminHubAreaNavProps<A extends string, T extends string, D extends AdminHubAreaNavDestination<T>> {
  /** The areas this viewer sees, already filtered by the hub. */
  areas: AdminHubAreaNavArea<A, D>[];
  activeArea: AdminHubAreaNavArea<A, D>;
  activeTab: T;
  onAreaChange: (area: A) => void;
  onTabChange: (tab: T) => void;
  /** Open attention items per page id, from the hub summary. */
  attentionCounts: Record<string, number>;
  /** The line under the strip saying what a page is for. */
  hintOf: (destination: D) => string;
  /** Names the area tablist ("Training admin areas"). */
  label: string;
  /** Prefix for the area cards' ids, unique on the page. */
  idPrefix: string;
  /** Element id of a page tab, and of the panel the hub renders for it. */
  tabId: (area: A, tab: T) => string;
  tabPanelId: (area: A, tab: T) => string;
}

const CountBadge: React.FC<{ count: number }> = ({ count }) => (
  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-800 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
    {count}
    <span className="sr-only"> need attention</span>
  </span>
);

export function AdminHubAreaNav<A extends string, T extends string, D extends AdminHubAreaNavDestination<T>>({
  areas,
  activeArea,
  activeTab,
  onAreaChange,
  onTabChange,
  attentionCounts,
  hintOf,
  label,
  idPrefix,
  tabId,
  tabPanelId,
}: AdminHubAreaNavProps<A, T, D>) {
  const destinationRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const destinationIds = activeArea.destinations.map((destination) => destination.id);
  const activeDestination =
    activeArea.destinations.find((destination) => destination.id === activeTab) ?? activeArea.destinations[0];
  const ActiveIcon = activeDestination?.icon;

  const areaCount = (area: AdminHubAreaNavArea<A, D>) =>
    area.destinations.reduce((total, destination) => total + (attentionCounts[destination.id] ?? 0), 0);

  /**
   * `focusedId` is the tab the keystroke came from, not the selected one:
   * browser back/forward changes the selection without moving focus, and
   * stepping from the selection would skip the tab the user was actually on.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, focusedId: T) => {
    const focusedIndex = destinationIds.indexOf(focusedId);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (focusedIndex + 1) % destinationIds.length;
    if (event.key === 'ArrowLeft') nextIndex = (focusedIndex - 1 + destinationIds.length) % destinationIds.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = destinationIds.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextId = destinationIds[nextIndex];
    if (nextId === undefined) return;
    onTabChange(nextId);
    destinationRefs.current[nextId]?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminHubCardTabs<A>
        tabs={areas.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          count: areaCount(area),
        }))}
        activeTab={activeArea.id}
        onTabChange={onAreaChange}
        label={label}
        idPrefix={idPrefix}
        // The strip under the pages already says where the user is.
        showActiveDescription={false}
      />

      <div className="card overflow-hidden">
        {/* Declared an intentional scroll region so the mobile pass stops
            reading off-screen pages as an overflow bug. No tabIndex: a tablist
            using roving tabindex stays out of the tab order (ARIA APG), and
            arrowing through its tabs scrolls the far end into view. The border
            sits on a wrapper so the edge fade does not erase it. */}
        <div className="border-theme-surface-border border-b">
          <ScrollCueRow
            className="flex gap-1 px-2"
            role="tablist"
            aria-label={`${activeArea.label} pages`}
            revealKey={`${activeArea.id}-${activeTab}`}
            data-mobile-scroll-region
          >
            {activeArea.destinations.map((destination) => {
              const Icon = destination.icon;
              const isActive = destination.id === activeTab;
              const count = attentionCounts[destination.id] ?? 0;
              return (
                <button
                  key={destination.id}
                  id={tabId(activeArea.id, destination.id)}
                  ref={(element) => {
                    destinationRefs.current[destination.id] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={tabPanelId(activeArea.id, destination.id)}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onTabChange(destination.id)}
                  onKeyDown={(event) => handleKeyDown(event, destination.id)}
                  className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                    isActive
                      ? 'text-theme-text-primary border-red-800'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {destination.label}
                  {count > 0 && <CountBadge count={count} />}
                </button>
              );
            })}
          </ScrollCueRow>
        </div>

        {/* Says where the officer is and what the page is for. The live region
            announces that on a change without reading out the page body. */}
        {activeDestination && (
          <div
            className="bg-theme-surface-secondary flex items-center gap-3 px-4 py-3"
            aria-live="polite"
            aria-atomic="true"
          >
            {ActiveIcon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-800">
                <ActiveIcon className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
            )}
            <p className="text-theme-text-muted min-w-0 text-sm">
              <span className="block text-xs">{activeArea.label}</span>
              <span className="text-theme-text-primary font-semibold">{activeDestination.label}</span>
              <span aria-hidden="true"> — </span>
              <span className="sr-only">: </span>
              {hintOf(activeDestination)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminHubAreaNav;
