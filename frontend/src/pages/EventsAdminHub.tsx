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

type AdminTab = 'create' | 'analytics' | 'community';

const tabs: { id: AdminTab; label: string }[] = [
  { id: 'create', label: 'Create Event' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'community', label: 'Community Engagement' },
];

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-slate-400">Loading...</div>
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
          <h1 className="text-2xl font-bold text-white">Events Administration</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create and manage events, view analytics
          </p>
        </div>

        <div className="border-b border-white/10">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Events admin tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  activeTab === tab.id
                    ? 'border-red-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-white/30'
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
        {activeTab === 'analytics' && <AnalyticsDashboardPage />}
        {activeTab === 'community' && <CommunityEngagementTab />}
      </Suspense>
    </div>
  );
};

export default EventsAdminHub;
