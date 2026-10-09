/**
 * Events Admin Hub
 *
 * Consolidated admin page for event coordinators, rendered in the shared
 * administration frame: header, four headline metrics, the "Needs attention"
 * queue, then the tab bar and the tab's own body.
 *
 * Requires: events.manage permission
 */

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarPlus, History, Inbox, Megaphone, Plus, QrCode, Settings } from 'lucide-react';
import { AdminHubFrame } from '../components/admin';
import type { AdminHubAction, AdminHubTab } from '../components/admin';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const EventCreatePage = lazyWithRetry(() => import('./EventCreatePage').then((m) => ({ default: m.EventCreatePage })));
const AnalyticsDashboardPage = lazyWithRetry(() => import('./AnalyticsDashboardPage'));
const CommunityEngagementTab = lazyWithRetry(() => import('./CommunityEngagementTab'));
const PastEventsTab = lazyWithRetry(() => import('./PastEventsTab'));
const EventRequestsTab = lazyWithRetry(() => import('./EventRequestsTab'));
const EventsSettingsTab = lazyWithRetry(() => import('./EventsSettingsTab'));

type AdminTab = 'create' | 'past_events' | 'requests' | 'analytics' | 'community' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Every tab is
 * described, so the frame draws them as cards that say what each one holds.
 */
const tabs: AdminHubTab<AdminTab>[] = [
  {
    id: 'create',
    label: 'Create Event',
    description: 'A one-off or recurring event, or one from a template',
    icon: CalendarPlus,
  },
  { id: 'past_events', label: 'Past Events', description: 'Events that have already happened', icon: History },
  { id: 'requests', label: 'Requests', description: 'Community requests for outreach events', icon: Inbox },
  { id: 'analytics', label: 'QR Code Analytics', description: 'Check-ins by QR code, device and error', icon: QrCode },
  {
    id: 'community',
    label: 'Community Engagement',
    description: 'How far public outreach events reach',
    icon: Megaphone,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Event types, categories, the request pipeline and metrics',
    icon: Settings,
  },
];

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

export const EventsAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(
    tabParam && tabs.some((t) => t.id === tabParam) ? tabParam : 'create'
  );
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);

  useEffect(() => {
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = useCallback(
    (tab: AdminTab) => {
      setActiveTab(tab);
      setSearchParams({ tab });
    },
    [setSearchParams]
  );

  const actions: AdminHubAction[] = [
    { key: 'qr', label: 'QR code analytics', icon: QrCode, onClick: () => handleTabChange('analytics') },
    { key: 'settings', label: 'Event settings', icon: Settings, onClick: () => handleTabChange('settings') },
  ];

  return (
    <AdminHubFrame<AdminTab>
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
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      refreshToken={frameToken}
    >
      {/* Tab content. The frame supplies the side gutter, so each tab sets
          only its own width and vertical spacing. */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'create' && <EventCreatePage />}
        {activeTab === 'past_events' && <PastEventsTab />}
        {activeTab === 'requests' && <EventRequestsTab />}
        {activeTab === 'analytics' && <AnalyticsDashboardPage embedded />}
        {activeTab === 'community' && <CommunityEngagementTab />}
        {activeTab === 'settings' && <EventsSettingsTab onMetricsSaved={() => setFrameToken((token) => token + 1)} />}
      </Suspense>
    </AdminHubFrame>
  );
};

export default EventsAdminHub;
