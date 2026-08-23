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
import { Plus, QrCode, Settings } from 'lucide-react';
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

/** Settings is always last — the frame's rule, on every module. */
const tabs: AdminHubTab<AdminTab>[] = [
  { id: 'create', label: 'Create Event' },
  { id: 'past_events', label: 'Past Events' },
  { id: 'requests', label: 'Requests' },
  { id: 'analytics', label: 'QR Code Analytics' },
  { id: 'community', label: 'Community Engagement' },
  { id: 'settings', label: 'Settings' },
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
    { key: 'settings', label: 'Events settings', icon: Settings, onClick: () => handleTabChange('settings') },
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
    >
      {/* Tab Content - each child handles its own layout */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'create' && <EventCreatePage />}
        {activeTab === 'past_events' && <PastEventsTab />}
        {activeTab === 'requests' && <EventRequestsTab />}
        {activeTab === 'analytics' && <AnalyticsDashboardPage />}
        {activeTab === 'community' && <CommunityEngagementTab />}
        {activeTab === 'settings' && <EventsSettingsTab />}
      </Suspense>
    </AdminHubFrame>
  );
};

export default EventsAdminHub;
