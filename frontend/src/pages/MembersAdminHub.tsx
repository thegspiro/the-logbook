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
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CreditCard, ScanLine, Upload, UserPlus } from 'lucide-react';
import { AdminHubFrame, AdminMetricsSettings } from '../components/admin';
import type { AdminHubAction } from '../components/admin';
import { useAuthStore } from '../stores/authStore';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { NFC_ID_CARDS_INTEGRATION } from '../modules/membership/constants/idCards';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { MEMBERS_SETTINGS_SECTIONS } from './members/admin/settings/membersSettingsSections';
import { MEMBERS_ADMIN_TABS, type MembersAdminTab } from './membersAdminTabs';

const MembersAdminPage = lazyWithRetry(() => import('./MembersAdminPage'));
const AddMember = lazyWithRetry(() => import('./AddMember'));
const ImportMembers = lazyWithRetry(() => import('./ImportMembers'));
const QualificationImport = lazyWithRetry(() => import('./QualificationImport'));

type AdminTab = MembersAdminTab;

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

export const MembersAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canCreate = checkPermission('users.create');
  const canManageCards = checkPermission('members.manage_id_cards');
  const { isConnected } = useConnectedIntegrations({ enabled: canManageCards });
  const tabs = MEMBERS_ADMIN_TABS.filter((tab) => !tab.permission || canCreate);
  // Validated against the tabs this member can actually open, not the full
  // list. A bookmarked ?tab=add for someone without users.create would
  // otherwise select a tab that is neither in the bar nor allowed to render
  // its body, leaving the hub showing a header and nothing under it.
  const isOpenable = (tab: string | null): tab is AdminTab => tabs.some((t) => t.id === tab);
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<AdminTab>(isOpenable(tabParam) ? tabParam : 'manage');
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);

  useEffect(() => {
    setActiveTab(isOpenable(tabParam) ? tabParam : 'manage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, canCreate]);

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
  // The card page is its own route, gated on the card grant alone, so it is
  // an action here rather than a tab: a tab would demand members.manage too.
  if (canManageCards && isConnected(NFC_ID_CARDS_INTEGRATION)) {
    actions.push({
      key: 'id-cards',
      label: 'Member ID cards',
      icon: CreditCard,
      onClick: () => void navigate('/members/admin/id-cards'),
    });
  }
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
      description="Manage members and their roles, and add new members"
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
      {/* Tab content. The frame supplies the side gutter, so each tab sets
          only its own width and vertical spacing. */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'manage' && <MembersAdminPage />}
        {activeTab === 'add' && <AddMember />}
        {activeTab === 'import' && <ImportMembers />}
        {activeTab === 'qualifications' && <QualificationImport />}
        {activeTab === 'settings' && (
          <div className="mx-auto max-w-7xl space-y-6 py-6">
            {/* The roster settings, which moved here from the global settings
                page. Links rather than an embedded panel: each section is its
                own route so it can be bookmarked and linked to, and this tab
                already owns a different subject — which metrics the hub shows.

                Every officer here holds `members.manage`, but neither section's
                endpoint accepts it, so the destination filters itself and says
                so. Listing them unconditionally is deliberate: an officer who
                cannot change them should still be able to see where they live
                and who to ask, which a hidden card cannot tell them. */}
            <section className="card p-4">
              <h2 className="text-theme-text-primary text-sm font-semibold">Roster settings</h2>
              <p className="text-theme-text-muted mt-1 text-xs">
                Moved here from Settings. Some sections need a separate permission, and the settings page shows only the
                ones you can change.
              </p>
              <ul className="mt-3 space-y-2">
                {MEMBERS_SETTINGS_SECTIONS.map((entry) => (
                  <li key={entry.key}>
                    <Link
                      to={entry.path}
                      className="mobile-touch-target text-theme-text-primary flex items-center justify-between gap-3 px-1 text-sm hover:underline"
                    >
                      <span className="font-medium">{entry.label}</span>
                      <span className="text-theme-text-muted text-xs">{entry.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

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
