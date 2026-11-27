/**
 * EventDetailTabs
 *
 * Groups the event page's cards into sections, one shown at a time, so a
 * manager is not scrolling past staffing and outreach cards to reach the
 * attendance list.
 *
 * Every panel stays mounted, and an inactive one is only hidden. Two reasons:
 * a form somebody is half-way through must survive a look at another tab, and
 * most of the cards decide for themselves whether they have anything to draw,
 * so the only reliable way to know a section is empty is to let its cards
 * render and see that none did. A section with nothing in it gets no tab, and
 * a page with one section gets no tab bar at all, which is what a member sees
 * on an ordinary event.
 *
 * The selected section is mirrored into `?tab=`, so it survives a refresh and
 * can be linked to, as ApparatusDetailPage's is.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTablist } from '../../hooks/useTablist';

export interface EventDetailTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface EventDetailTabsProps {
  tabs: EventDetailTab[];
}

export const EventDetailTabs: React.FC<EventDetailTabsProps> = ({ tabs }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tablist = useTablist();
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  // Until the panels have rendered once, every section is assumed to have
  // content: hiding a tab that is about to fill would flash it in.
  const [filledIds, setFilledIds] = useState<string[] | null>(null);

  // The ids as one string: `tabs` is a new array on every render of the page,
  // and the observer below should be rebuilt only when the sections change.
  const tabIdsKey = tabs.map((tab) => tab.id).join('|');
  const measure = useCallback(() => {
    const filled = tabIdsKey.split('|').filter((id) => (panelRefs.current.get(id)?.childElementCount ?? 0) > 0);
    setFilledIds((prev) => (prev && prev.join('|') === filled.join('|') ? prev : filled));
  }, [tabIdsKey]);

  useLayoutEffect(() => {
    measure();
    const observer = new MutationObserver(measure);
    for (const panel of panelRefs.current.values()) {
      observer.observe(panel, { childList: true });
    }
    return () => observer.disconnect();
  }, [measure]);

  const visibleTabs = filledIds === null ? tabs : tabs.filter((tab) => filledIds.includes(tab.id));
  const requested = searchParams.get('tab');
  const activeId = visibleTabs.find((tab) => tab.id === requested)?.id ?? visibleTabs[0]?.id ?? tabs[0]?.id;

  const setTab = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      {visibleTabs.length > 1 && (
        <div className="tab-scroll mb-6" role="tablist" aria-label="Event sections" {...tablist}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`event-tab-${tab.id}`}
              aria-selected={activeId === tab.id}
              aria-controls={`event-panel-${tab.id}`}
              onClick={() => setTab(tab.id)}
              className={`flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                activeId === tab.id
                  ? 'text-theme-text-primary border-red-800'
                  : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={(node) => {
            if (node) panelRefs.current.set(tab.id, node);
            else panelRefs.current.delete(tab.id);
          }}
          id={`event-panel-${tab.id}`}
          role={visibleTabs.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={visibleTabs.length > 1 ? `event-tab-${tab.id}` : undefined}
          hidden={activeId !== tab.id}
          className="space-y-6"
        >
          {tab.content}
        </div>
      ))}
    </>
  );
};
