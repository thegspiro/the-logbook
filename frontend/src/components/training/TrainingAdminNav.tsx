import React, { useRef } from 'react';
import type { TrainingAdminArea, TrainingAdminAreaId } from './trainingAdminAreas';
import { TRAINING_ADMIN_AREAS, tabId, tabPanelId } from './trainingAdminAreas';
import AdminHubCardTabs from '../admin/AdminHubCardTabs';
import { ScrollCueRow } from '../ux/ScrollCueRow';

/**
 * Training Administration's two-level navigation, drawn as area cards above a
 * card holding the area's destinations.
 *
 * Every area is on screen at once, each with a line saying what it holds, and
 * the strip under the destinations names the open page and what it is for.
 * The previous design hid half the sections behind "More" and labelled the
 * rest with words ("Setup") that did not say what was inside them.
 *
 * The area cards are the shared `AdminHubCardTabs` every described hub uses;
 * the destination strip under them is Training's own second level. Both are
 * tablists with roving focus. The panels they control are rendered by the
 * page, under the ids `areaPanelId` / `tabPanelId` return (declared beside the
 * areas so the page and this nav share one definition).
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
  const destinationRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const destinationIds = activeArea.destinations.map((destination) => destination.id);
  const activeDestination =
    activeArea.destinations.find((destination) => destination.id === activeTab) ?? activeArea.destinations[0];
  const ActiveIcon = activeDestination?.icon;

  const areaCount = (area: TrainingAdminArea) =>
    area.destinations.reduce((total, destination) => total + (attentionCounts[destination.id] ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <AdminHubCardTabs<TrainingAdminAreaId>
        tabs={TRAINING_ADMIN_AREAS.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          count: areaCount(area),
        }))}
        activeTab={activeArea.id}
        onTabChange={onAreaChange}
        label="Training admin areas"
        // Matches `areaTabId` / `areaPanelId`, under which the page renders the area's panel.
        idPrefix="training-admin-area"
        // The strip under the destinations already says where the user is.
        showActiveDescription={false}
      />

      <div className="card overflow-hidden">
        {/* Declared an intentional scroll region so the mobile pass stops
            reading off-screen destinations as an overflow bug. No tabIndex: a
            tablist using roving tabindex stays out of the tab order (ARIA
            APG), and arrowing through its tabs scrolls the far end into view.
            The border sits on a wrapper so the edge fade does not erase it. */}
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
              {activeDestination.hint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainingAdminNav;
