/**
 * Members Admin Hub
 *
 * Consolidated admin page for member management, rendered in the shared
 * administration frame: header, four headline metrics, the "Needs attention"
 * queue, then the tab bar and the tab's own body.
 *
 * Requires: members.manage permission
 */

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ScanLine, Upload, UserPlus } from 'lucide-react';
import { AdminHubFrame, AdminMetricsSettings } from '../components/admin';
import type { AdminHubAction, AdminHubTab } from '../components/admin';
import { useAuthStore } from '../stores/authStore';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const MembersAdminPage = lazyWithRetry(() => import('./MembersAdminPage'));
const AddMember = lazyWithRetry(() => import('./AddMember'));
const ImportMembers = lazyWithRetry(() => import('./ImportMembers'));

type AdminTab = 'manage' | 'add' | 'import' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Adding and
 * importing are their own permission: members.manage lets an officer edit the
 * roster, members.create is what puts a new person on it.
 */
const ALL_TABS: (AdminHubTab<AdminTab> & { permission?: string })[] = [
  { id: 'manage', label: 'Member Management' },
  { id: 'add', label: 'Add Member', permission: 'members.create' },
  { id: 'import', label: 'Import Members', permission: 'members.create' },
  { id: 'settings', label: 'Settings' },
];

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

export const MembersAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canCreate = checkPermission('members.create');
  const tabs = ALL_TABS.filter((tab) => !tab.permission || canCreate);
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(
    tabParam && ALL_TABS.some((t) => t.id === tabParam) ? tabParam : 'manage'
  );
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);

  useEffect(() => {
    if (tabParam && ALL_TABS.some((t) => t.id === tabParam)) {
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
    { key: 'scan', label: 'Scan a member ID', icon: ScanLine, onClick: () => void navigate('/members/scan') },
  ];
  if (canCreate) {
    actions.push({
      key: 'import',
      label: 'Import members',
      icon: Upload,
      onClick: () => handleTabChange('import'),
    });
  }

  return (
    <AdminHubFrame<AdminTab>
      moduleKey="members"
      title="Members Administration"
      description="Manage members, roles, and member onboarding"
      actions={actions}
      primaryAction={
        canCreate
          ? {
              key: 'add',
              label: 'Add Member',
              icon: UserPlus,
              onClick: () => handleTabChange('add'),
            }
          : undefined
      }
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      refreshToken={frameToken}
    >
      {/* Tab Content - each child handles its own layout */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'manage' && <MembersAdminPage />}
        {activeTab === 'add' && canCreate && <AddMember />}
        {activeTab === 'import' && canCreate && <ImportMembers />}
        {activeTab === 'settings' && (
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <AdminMetricsSettings
              moduleKey="members"
              moduleLabel="Members"
              permission="members.manage"
              onSaved={() => setFrameToken((token) => token + 1)}
            />
          </div>
        )}
      </Suspense>
    </AdminHubFrame>
  );
};

export default MembersAdminHub;
