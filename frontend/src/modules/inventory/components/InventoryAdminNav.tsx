import React from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import AdminHubCardTabs from '../../../components/admin/AdminHubCardTabs';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import type { InventoryAdminAreaId, ResolvedInventoryAdminArea } from '../pages/inventoryAdminAreas';

/**
 * Inventory Administration's two-level navigation, drawn the way Training
 * Administration's is: area cards above a card holding the area's pages, with
 * a strip naming the open page and what it is for.
 *
 * The area cards are the shared `AdminHubCardTabs`. The pages under them are
 * links rather than tabs, because each is its own route — and some open a page
 * outside this header altogether (the kiosk, the NFC scanning tools, the
 * store's console), which a tab cannot honestly promise. Those carry an arrow
 * saying so.
 */

/** Matches the id prefix `InventoryAdminLayout` renders its panel under. */
export const INVENTORY_ADMIN_AREA_ID_PREFIX = 'inventory-admin-area';

interface InventoryAdminNavProps {
  areas: ResolvedInventoryAdminArea[];
  /** The area the URL is in. */
  activeAreaId: InventoryAdminAreaId;
  /**
   * The area whose pages are shown. Usually the URL's, but an area whose every
   * page opens outside the header (the store) cannot be navigated to, so
   * choosing it only selects it. Held by the layout, which labels its panel
   * by it.
   */
  selectedAreaId: InventoryAdminAreaId;
  onSelectArea: (area: InventoryAdminAreaId) => void;
  /** The page the URL is, or null for a path no destination names. */
  activeDestinationId: string | null;
  /** Open attention items per destination id. */
  attentionCounts: Record<string, number>;
}

const CountBadge: React.FC<{ count: number }> = ({ count }) => (
  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-800 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
    {count}
    <span className="sr-only"> need attention</span>
  </span>
);

export const InventoryAdminNav: React.FC<InventoryAdminNavProps> = ({
  areas,
  activeAreaId,
  activeDestinationId,
  selectedAreaId,
  onSelectArea,
  attentionCounts,
}) => {
  const navigate = useNavigate();

  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0];
  if (!selectedArea) return null;

  const activeDestination =
    selectedArea.id === activeAreaId
      ? selectedArea.destinations.find((destination) => destination.id === activeDestinationId)
      : undefined;
  const ActiveIcon = activeDestination?.icon;

  const areaCount = (area: ResolvedInventoryAdminArea) =>
    area.destinations.reduce((total, destination) => total + (attentionCounts[destination.id] ?? 0), 0);

  const handleAreaChange = (areaId: InventoryAdminAreaId) => {
    const area = areas.find((candidate) => candidate.id === areaId);
    const landing = area?.destinations.find((destination) => !destination.outside);
    if (landing) {
      void navigate(landing.path);
    } else {
      onSelectArea(areaId);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminHubCardTabs<InventoryAdminAreaId>
        tabs={areas.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          count: areaCount(area),
        }))}
        activeTab={selectedArea.id}
        onTabChange={handleAreaChange}
        label="Inventory admin areas"
        idPrefix={INVENTORY_ADMIN_AREA_ID_PREFIX}
        // The strip under the pages already says where the user is.
        showActiveDescription={false}
      />

      <div className="card overflow-hidden">
        {/* An intentional scroll region on a phone, declared so the mobile
            pass does not read off-screen pages as an overflow bug. The border
            sits on a wrapper so the edge fade does not erase it. */}
        <div className="border-theme-surface-border border-b">
          {/* The scroller itself carries the landmark and its name, as the
              mobile pass requires of a declared scroll region. */}
          <ScrollCueRow
            className="flex gap-1 px-2"
            role="navigation"
            aria-label={`${selectedArea.label} pages`}
            revealKey={`${selectedArea.id}-${activeDestinationId ?? ''}`}
            data-mobile-scroll-region
          >
            {selectedArea.destinations.map((destination) => {
              const Icon = destination.icon;
              const isActive = destination.id === activeDestination?.id;
              const count = attentionCounts[destination.id] ?? 0;
              return (
                <Link
                  key={destination.id}
                  to={destination.path}
                  aria-current={isActive ? 'page' : undefined}
                  title={destination.outside ? `${destination.label} opens its own page` : undefined}
                  className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                    isActive
                      ? 'text-theme-text-primary border-red-800'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {destination.label}
                  {destination.outside && (
                    <>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only"> (opens its own page)</span>
                    </>
                  )}
                  {count > 0 && <CountBadge count={count} />}
                </Link>
              );
            })}
          </ScrollCueRow>
        </div>

        {/* Says where the officer is and what the page is for. The live region
            announces that on a change without reading out the page body. */}
        <div
          className="bg-theme-surface-secondary flex items-center gap-3 px-4 py-3"
          aria-live="polite"
          aria-atomic="true"
        >
          {activeDestination && ActiveIcon ? (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-800">
                <ActiveIcon className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <p className="text-theme-text-muted min-w-0 text-sm">
                <span className="block text-xs">{selectedArea.label}</span>
                <span className="text-theme-text-primary font-semibold">{activeDestination.label}</span>
                <span aria-hidden="true"> — </span>
                <span className="sr-only">: </span>
                {activeDestination.hint}
              </p>
            </>
          ) : (
            <p className="text-theme-text-muted min-w-0 text-sm">
              <span className="text-theme-text-primary font-semibold">{selectedArea.label}</span>
              <span aria-hidden="true"> — </span>
              <span className="sr-only">: </span>
              {selectedArea.description}. Choose a page above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryAdminNav;
