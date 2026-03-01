/**
 * Admin Hours Management Page
 *
 * Thin orchestrator that manages active tab state, shows error toasts,
 * loads initial data on mount, and renders the tab bar with the active
 * tab component.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import CategoriesTab from '../components/CategoriesTab';
import ActiveSessionsTab from '../components/ActiveSessionsTab';
import PendingReviewTab from '../components/PendingReviewTab';
import AllEntriesTab from '../components/AllEntriesTab';
import SummaryTab from '../components/SummaryTab';
import toast from 'react-hot-toast';

type TabKey = 'categories' | 'active' | 'pending' | 'all' | 'summary';

const TAB_LABELS: Record<TabKey, string> = {
  categories: 'Categories',
  active: 'Active Sessions',
  pending: 'Pending Review',
  all: 'All Entries',
  summary: 'Summary',
};

const TAB_KEYS: readonly TabKey[] = ['categories', 'active', 'pending', 'all', 'summary'] as const;

const AdminHoursManagePage: React.FC = () => {
  const activeSessions = useAdminHoursStore((s) => s.activeSessions);
  const pendingCount = useAdminHoursStore((s) => s.pendingCount);
  const error = useAdminHoursStore((s) => s.error);
  const fetchCategories = useAdminHoursStore((s) => s.fetchCategories);
  const fetchPendingCount = useAdminHoursStore((s) => s.fetchPendingCount);
  const fetchActiveSessions = useAdminHoursStore((s) => s.fetchActiveSessions);
  const clearError = useAdminHoursStore((s) => s.clearError);

  const [activeTab, setActiveTab] = useState<TabKey>('categories');

  const loadData = useCallback(() => {
    void fetchCategories(true);
    void fetchPendingCount();
    void fetchActiveSessions();
  }, [fetchCategories, fetchPendingCount, fetchActiveSessions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">Admin Hours Management</h1>
        <p className="text-theme-text-secondary mt-1">Manage categories, review entries, and view summaries</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-theme-surface rounded-lg p-1">
        {TAB_KEYS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition relative ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {TAB_LABELS[tab]}
            {tab === 'active' && activeSessions.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none bg-blue-500 text-white rounded-full">
                {activeSessions.length}
              </span>
            )}
            {tab === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none bg-red-500 text-white rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active Tab Content */}
      {activeTab === 'categories' && <CategoriesTab onDataReload={loadData} />}
      {activeTab === 'active' && <ActiveSessionsTab />}
      {activeTab === 'pending' && <PendingReviewTab />}
      {activeTab === 'all' && <AllEntriesTab />}
      {activeTab === 'summary' && <SummaryTab />}
    </div>
  );
};

export default AdminHoursManagePage;
