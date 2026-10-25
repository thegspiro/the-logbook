/**
 * Events Admin Hub
 *
 * Consolidated admin page for event coordinators, rendered in the shared
 * administration frame: header, four headline metrics, the "Needs attention"
 * queue, then the area cards and page strip (`EventsAdminNav`) Training,
 * Inventory and Scheduling Administration also draw, and the page's own body.
 *
 * URL structure: /events/admin?tab=<page>. The area is derived from the page,
 * so no link needs to name it.
 *
 * Requires: events.manage permission
 */

import React, { Suspense, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, QrCode, Settings } from 'lucide-react';
import { AdminHubFrame } from '../components/admin';
import type { AdminHubAction } from '../components/admin';
import { attentionCountsForTabs } from '../components/admin/attentionCounts';
import EventsAdminNav from '../components/events/EventsAdminNav';
import type { AdminHubSummary } from '../types/adminHub';
import {
  EVENTS_ADMIN_AREA_ID_PREFIX,
  EVENTS_ADMIN_AREAS,
  eventsAdminTabId,
  eventsAdminTabPanelId,
  resolveEventsAdminLocation,
  type EventsAdminAreaId,
  type EventsAdminTab,
} from './eventsAdminTabs';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const HUB_PATH = '/events/admin';

const EventCreatePage = lazyWithRetry(() => import('./EventCreatePage').then((m) => ({ default: m.EventCreatePage })));
const AnalyticsDashboardPage = lazyWithRetry(() => import('./AnalyticsDashboardPage'));
const CommunityEngagementTab = lazyWithRetry(() => import('./CommunityEngagementTab'));
const PastEventsTab = lazyWithRetry(() => import('./PastEventsTab'));
const EventRequestsTab = lazyWithRetry(() => import('./EventRequestsTab'));
const EventsSettingsTab = lazyWithRetry(() => import('./EventsSettingsTab'));
const EventCardCheckinsTab = lazyWithRetry(() => import('./EventCardCheckinsTab'));

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

const TabContent: React.FC<{ tab: EventsAdminTab; onMetricsSaved: () => void }> = ({ tab, onMetricsSaved }) => {
  switch (tab) {
    case 'create':
      return <EventCreatePage />;
    case 'past_events':
      return <PastEventsTab />;
    case 'requests':
      return <EventRequestsTab />;
    case 'analytics':
      return <AnalyticsDashboardPage embedded />;
    case 'community':
      return <CommunityEngagementTab />;
    case 'card_checkins':
      return <EventCardCheckinsTab />;
    case 'settings':
      return <EventsSettingsTab onMetricsSaved={onMetricsSaved} />;
  }
};

export const EventsAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Derived from the URL on every render rather than mirrored into state, so
  // browser back/forward and in-app links can never leave the two disagreeing.
  const { area: activeArea, tab: activeTab } = resolveEventsAdminLocation(searchParams.get('tab'));
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({});

  const handleTabChange = useCallback(
    (tab: EventsAdminTab) => {
      setSearchParams({ tab });
    },
    [setSearchParams]
  );

  const handleAreaChange = (areaId: EventsAdminAreaId) => {
    const area = EVENTS_ADMIN_AREAS.find((candidate) => candidate.id === areaId);
    const landing = area?.destinations[0];
    if (landing) handleTabChange(landing.id);
  };

  const handleSummaryChange = (summary: AdminHubSummary | null) =>
    setAttentionCounts(attentionCountsForTabs(summary?.attention ?? [], HUB_PATH));

  const actions: AdminHubAction[] = [
    { key: 'qr', label: 'QR code analytics', icon: QrCode, onClick: () => handleTabChange('analytics') },
    { key: 'settings', label: 'Event settings', icon: Settings, onClick: () => handleTabChange('settings') },
  ];

  return (
    <AdminHubFrame
      moduleKey="events"
      title="Events Administration"
      description="Create and manage events, view analytics"
      actions={actions}
      primaryAction={{
        key: 'create',
        label: 'Create Event',
        icon: Plus,
        onClick: () => void navigate('/events/new'),
      }}
      nav={
        <EventsAdminNav
          areas={EVENTS_ADMIN_AREAS}
          activeArea={activeArea}
          activeTab={activeTab}
          onAreaChange={handleAreaChange}
          onTabChange={handleTabChange}
          attentionCounts={attentionCounts}
        />
      }
      refreshToken={frameToken}
      onSummaryChange={handleSummaryChange}
    >
      <div
        id={`${EVENTS_ADMIN_AREA_ID_PREFIX}-panel-${activeArea.id}`}
        role="tabpanel"
        aria-labelledby={`${EVENTS_ADMIN_AREA_ID_PREFIX}-tab-${activeArea.id}-label`}
        // The frame's header sits in a centred 7xl column and its body does
        // not, so the column is set here. Each tab keeps its own, narrower,
        // max width inside it, and the frame supplies the side gutter.
        className="mx-auto max-w-7xl"
      >
        {/*
          One panel per page of the area, not one for the selected page: every
          page tab advertises its panel through `aria-controls`, so each id must
          be in the document. Only the selected panel holds content — mounting
          all of them would have each page fetch its data on arrival.
        */}
        {activeArea.destinations.map((destination) => {
          const isActive = destination.id === activeTab;
          return (
            <div
              key={destination.id}
              id={eventsAdminTabPanelId(destination.id)}
              role="tabpanel"
              aria-labelledby={eventsAdminTabId(destination.id)}
              hidden={!isActive}
            >
              {isActive && (
                <Suspense fallback={<TabLoading />}>
                  <TabContent tab={destination.id} onMetricsSaved={() => setFrameToken((token) => token + 1)} />
                </Suspense>
              )}
            </div>
          );
        })}
      </div>
    </AdminHubFrame>
  );
};

export default EventsAdminHub;
