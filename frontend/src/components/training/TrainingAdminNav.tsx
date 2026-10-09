import React, { useRef } from 'react';
import type { TrainingAdminArea, TrainingAdminAreaId } from './trainingAdminAreas';
import { TRAINING_ADMIN_AREAS, areaPanelId, areaTabId, tabId, tabPanelId } from './trainingAdminAreas';

/**
 * Training Administration's two-level navigation, drawn as area cards above a
 * card holding the area's destinations.
 *
 * Every area is on screen at once, each with a line saying what it holds, and
 * the strip under the destinations names the open page and what it is for.
 * The previous design hid half the sections behind "More" and labelled the
 * rest with words ("Setup") that did not say what was inside them.
 *
 * Both levels are tablists with roving focus. The panels they control are
 * rendered by the page, under the ids `areaPanelId` / `tabPanelId` return
 * (declared beside the areas so the page and this nav share one definition).
 */

interface TrainingAdminNavProps {
  activeArea: TrainingAdminArea;
  activeTab: string;
  onAreaChange: (area: TrainingAdminAreaId) => void;
  onTabChange: (tab: string) => void;
  /** Open attention items per destination id, from the hub summary. */
  attentionCounts: Record<string, number>;
}

const CountBadge: React.FC<{ count: number; inverted: boolean }> = ({ count, inverted }) => (
  <span
    className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold ${
      inverted ? 'bg-white text-red-800' : 'bg-red-800 text-white'
    }`}
  >
    {count}
    <span className="sr-only"> need attention</span>
  </span>
);

/**
 * Arrow, Home and End movement for a tablist, activating as focus moves.
 *
 * `focusedId` is the tab the keystroke came from, not the selected one:
 * browser back/forward changes the selection without moving focus, and stepping
 * from the selection would skip the tab the user was actually on.
 */
function handleRovingKeyDown<T extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  ids: T[],
  focusedId: T,
  activate: (id: T) => void,
  refs: React.RefObject<Record<string, HTMLButtonElement | null>>
) {
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
  activate(nextId);
  refs.current[nextId]?.focus();
}

export const TrainingAdminNav: React.FC<TrainingAdminNavProps> = ({
  activeArea,
  activeTab,
  onAreaChange,
  onTabChange,
  attentionCounts,
}) => {
  const areaRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const destinationRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const areaIds = TRAINING_ADMIN_AREAS.map((area) => area.id);
  const destinationIds = activeArea.destinations.map((destination) => destination.id);
  const activeDestination =
    activeArea.destinations.find((destination) => destination.id === activeTab) ?? activeArea.destinations[0];
  const ActiveIcon = activeDestination?.icon;

  const areaCount = (area: TrainingAdminArea) =>
    area.destinations.reduce((total, destination) => total + (attentionCounts[destination.id] ?? 0), 0);

  return (
    <div className="@container flex flex-col gap-4">
      {/* Seven columns only once the hub's own column has room for seven
          readable cards — a container query, because the sidebar decides that
          width as much as the viewport does. Below that the grid wraps rather
          than scrolling, so no area is ever off screen. Descriptions are dropped on a phone, where the open area's
          destinations and the strip beneath them carry that information. */}
      <div
        className="grid grid-cols-2 gap-2 sm:gap-3 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-7"
        role="tablist"
        aria-label="Training admin areas"
      >
        {TRAINING_ADMIN_AREAS.map((area) => {
          const Icon = area.icon;
          const isActive = area.id === activeArea.id;
          const count = areaCount(area);
          return (
            <button
              key={area.id}
              id={areaTabId(area.id)}
              ref={(element) => {
                areaRefs.current[area.id] = element;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={areaPanelId(area.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onAreaChange(area.id)}
              onKeyDown={(event) => handleRovingKeyDown(event, areaIds, area.id, onAreaChange, areaRefs)}
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
                <span className="min-w-0 flex-1 text-sm leading-tight font-semibold sm:hidden">{area.label}</span>
                {count > 0 && <CountBadge count={count} inverted={isActive} />}
              </span>
              <span className="hidden text-sm leading-tight font-semibold sm:block">{area.label}</span>
              <span
                className={`hidden text-xs leading-snug sm:block ${isActive ? 'text-white' : 'text-theme-text-muted'}`}
              >
                {area.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        {/* Declared an intentional scroll region so the mobile pass stops
            reading off-screen destinations as an overflow bug. No tabIndex: a
            tablist using roving tabindex stays out of the tab order (ARIA
            APG), and arrowing through its tabs scrolls the far end into view. */}
        <div
          className="border-theme-surface-border hscroll flex gap-1 border-b px-2"
          role="tablist"
          aria-label={`${activeArea.label} pages`}
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
                onKeyDown={(event) =>
                  handleRovingKeyDown(event, destinationIds, destination.id, onTabChange, destinationRefs)
                }
                className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                  isActive
                    ? 'text-theme-text-primary border-red-800'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {destination.label}
                {count > 0 && <CountBadge count={count} inverted={false} />}
              </button>
            );
          })}
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
              {activeDestination.hint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainingAdminNav;
