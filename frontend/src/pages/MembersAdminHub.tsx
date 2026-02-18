/**
 * Members Admin Hub
 *
 * Consolidated admin page for member management.
 * Provides a tabbed interface to manage roles, add members, and import members.
 *
 * Requires: members.manage permission
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const MembersAdminPage = lazy(() => import('./MembersAdminPage'));
const AddMember = lazy(() => import('./AddMember'));
const ImportMembers = lazy(() => import('./ImportMembers'));

type AdminTab = 'manage' | 'add' | 'import';

const tabs: { id: AdminTab; label: string; permission?: string }[] = [
  { id: 'manage', label: 'Member Management' },
  { id: 'add', label: 'Add Member', permission: 'members.create' },
  { id: 'import', label: 'Import Members', permission: 'members.create' },
];

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

export const MembersAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabParam && tabs.some(t => t.id === tabParam) ? tabParam : 'manage');

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
          <h1 className="text-2xl font-bold text-theme-text-primary">Members Administration</h1>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage members, roles, and member onboarding
          </p>
        </div>

        <div className="border-b border-theme-surface-border">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Members admin tabs">
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
        {activeTab === 'manage' && <MembersAdminPage />}
        {activeTab === 'add' && <AddMember />}
        {activeTab === 'import' && <ImportMembers />}
      </Suspense>
    </div>
  );
};

export default MembersAdminHub;
