/**
 * Events Admin Hub
 *
 * Consolidated admin page for event coordinators.
 * Provides a tabbed interface to create events and view analytics.
 *
 * Requires: events.manage permission
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const EventCreatePage = lazy(() => import('./EventCreatePage').then(m => ({ default: m.EventCreatePage })));
const AnalyticsDashboardPage = lazy(() => import('./AnalyticsDashboardPage'));
const CommunityEngagementTab = lazy(() => import('./CommunityEngagementTab'));
const PastEventsTab = lazy(() => import('./PastEventsTab'));
const EventRequestsTab = lazy(() => import('./EventRequestsTab'));
const EventsSettingsTab = lazy(() => import('./EventsSettingsTab'));

type AdminTab = 'create' | 'past_events' | 'requests' | 'analytics' | 'community' | 'settings';

const tabs: { id: AdminTab; label: string }[] = [
  { id: 'create', label: 'Create Event' },
  { id: 'past_events', label: 'Past Events' },
  { id: 'requests', label: 'Requests' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'community', label: 'Community Engagement' },
  { id: 'settings', label: 'Settings' },
];

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

export const EventsAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabParam && tabs.some(t => t.id === tabParam) ? tabParam : 'create');

  useEffect(() => {
    if (tabParam && tabs.some(t => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div>
      {/* Header + Tab Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-text-primary">Events Administration</h1>
          <p className="mt-1 text-sm text-theme-text-muted">
            Create and manage events, view analytics
          </p>
        </div>

        <div className="border-b border-theme-surface-border">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Events admin tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  activeTab === tab.id
                    ? 'border-red-500 text-theme-text-primary'
                    : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
                }`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content - each child handles its own layout */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'create' && <EventCreatePage />}
        {activeTab === 'past_events' && <PastEventsTab />}
        {activeTab === 'requests' && <EventRequestsTab />}
        {activeTab === 'analytics' && <AnalyticsDashboardPage />}
        {activeTab === 'community' && <CommunityEngagementTab />}
        {activeTab === 'settings' && <EventsSettingsTab />}
      </Suspense>
    </div>
  );
};

export default EventsAdminHub;
