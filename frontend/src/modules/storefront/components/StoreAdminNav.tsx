import React, { useRef } from 'react';
import AdminHubCardTabs from '../../../components/admin/AdminHubCardTabs';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import {
  STORE_ADMIN_AREA_ID_PREFIX,
  storeAdminTabId,
  storeAdminTabPanelId,
  type StoreAdminArea,
  type StoreAdminAreaId,
  type StoreAdminTab,
} from '../pages/storeAdminTabs';

/**
 * The Department Store console's two-level navigation, drawn the way Training,
 * Events, Members, Inventory and Scheduling Administration draw theirs: area
 * cards above a card holding the area's pages, with a strip naming the open
 * page and what it is for.
 *
 * This mirrors `StoreAdminNav`: the pages are tabs of one route rather than
 * routes of their own, so both levels are tablists with roving focus. The
 * panels they control are rendered by the page, under the ids
 * `storeAdminTabPanelId` returns.
 */

interface StoreAdminNavProps {
  areas: StoreAdminArea[];
  activeArea: StoreAdminArea;
  activeTab: StoreAdminTab;
  onAreaChange: (area: StoreAdminAreaId) => void;
  onTabChange: (tab: StoreAdminTab) => void;
  /** Open attention items per tab id, from the hub summary. */
  attentionCounts: Record<string, number>;
}

const CountBadge: React.FC<{ count: number }> = ({ count }) => (
  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-800 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
    {count}
    <span className="sr-only"> need attention</span>
  </span>
);

export const StoreAdminNav: React.FC<StoreAdminNavProps> = ({
  areas,
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

  const areaCount = (area: StoreAdminArea) =>
    area.destinations.reduce((total, destination) => total + (attentionCounts[destination.id] ?? 0), 0);

  /**
   * `focusedId` is the tab the keystroke came from, not the selected one:
   * browser back/forward changes the selection without moving focus, and
   * stepping from the selection would skip the tab the user was actually on.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, focusedId: StoreAdminTab) => {
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
      <AdminHubCardTabs<StoreAdminAreaId>
        tabs={areas.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          count: areaCount(area),
        }))}
        activeTab={activeArea.id}
        onTabChange={onAreaChange}
        label="Store admin areas"
        idPrefix={STORE_ADMIN_AREA_ID_PREFIX}
        // The strip under the pages already says where the user is.
        showActiveDescription={false}
      />

      <div className="card overflow-hidden">
        {/* An intentional scroll region on a phone, declared so the mobile
            pass does not read off-screen pages as an overflow bug. The border
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
                  id={storeAdminTabId(destination.id)}
                  ref={(element) => {
                    destinationRefs.current[destination.id] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={storeAdminTabPanelId(destination.id)}
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

        {/* Says where the store manager is and what the page is for. The live
            region announces that on a change without reading out the body. */}
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
              {activeDestination.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoreAdminNav;
