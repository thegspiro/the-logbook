/**
 * Members Admin Hub
 *
 * Consolidated admin page for member management, rendered in the shared
 * administration frame: header, four headline metrics, the "Needs attention"
 * queue, then the area cards and page strip (`AdminHubAreaNav`) Training,
 * Events, Inventory and Scheduling Administration also draw, and the page's
 * own body.
 *
 * URL structure: /members/admin?tab=<page>. The area is derived from the page,
 * so no link needs to name it.
 *
 * Requires: members.manage permission
 */

import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CreditCard, ScanLine, Upload, UserPlus } from 'lucide-react';
import { AdminHubFrame, AdminMetricsSettings } from '../components/admin';
import type { AdminHubAction } from '../components/admin';
import { attentionCountsForTabs } from '../components/admin/attentionCounts';
import { AdminHubAreaNav } from '../components/admin/AdminHubAreaNav';
import type { AdminHubSummary } from '../types/adminHub';
import { useAuthStore } from '../stores/authStore';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { NFC_ID_CARDS_INTEGRATION } from '../modules/membership/constants/idCards';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { MEMBERS_SETTINGS_SECTIONS } from './members/admin/settings/membersSettingsSections';
import {
  MEMBERS_ADMIN_AREA_ID_PREFIX,
  membersAdminAreasFor,
  membersAdminTabId,
  membersAdminTabPanelId,
  resolveMembersAdminLocation,
  type MembersAdminAreaId,
  type MembersAdminTab,
} from './membersAdminTabs';

const HUB_PATH = '/members/admin';

const MembersAdminPage = lazyWithRetry(() => import('./MembersAdminPage'));
const AddMember = lazyWithRetry(() => import('./AddMember'));
const ImportMembers = lazyWithRetry(() => import('./ImportMembers'));
const QualificationImport = lazyWithRetry(() => import('./QualificationImport'));

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

const SettingsTab: React.FC<{ onMetricsSaved: () => void }> = ({ onMetricsSaved }) => (
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
        Moved here from Settings. Some sections need a separate permission, and the settings page shows only the ones
        you can change.
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
      onSaved={onMetricsSaved}
    />
  </div>
);

const TabContent: React.FC<{ tab: MembersAdminTab; onMetricsSaved: () => void }> = ({ tab, onMetricsSaved }) => {
  switch (tab) {
    case 'manage':
      return <MembersAdminPage />;
    case 'add':
      return <AddMember />;
    case 'import':
      return <ImportMembers />;
    case 'qualifications':
      return <QualificationImport />;
    case 'settings':
      return <SettingsTab onMetricsSaved={onMetricsSaved} />;
  }
};

export const MembersAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canCreate = checkPermission('users.create');
  const canManageCards = checkPermission('members.manage_id_cards');
  const { isConnected } = useConnectedIntegrations({ enabled: canManageCards });
  const areas = useMemo(() => membersAdminAreasFor(checkPermission), [checkPermission]);
  // Derived from the URL on every render rather than mirrored into state, so
  // browser back/forward and in-app links can never leave the two disagreeing.
  // Resolved against the pages this member can open, so a bookmarked ?tab=add
  // without users.create lands on Member Management, not on a page whose body
  // is not allowed to render.
  const { area: activeArea, tab: activeTab } = resolveMembersAdminLocation(searchParams.get('tab'), areas);
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({});

  const handleTabChange = useCallback(
    (tab: MembersAdminTab) => {
      setSearchParams({ tab });
    },
    [setSearchParams]
  );

  const handleAreaChange = (areaId: MembersAdminAreaId) => {
    const landing = areas.find((candidate) => candidate.id === areaId)?.destinations[0];
    if (landing) handleTabChange(landing.id);
  };

  const handleSummaryChange = (summary: AdminHubSummary | null) =>
    setAttentionCounts(attentionCountsForTabs(summary?.attention ?? [], HUB_PATH));

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
    <AdminHubFrame
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
      nav={
        <AdminHubAreaNav
          areas={areas}
          activeArea={activeArea}
          activeTab={activeTab}
          onAreaChange={handleAreaChange}
          onTabChange={handleTabChange}
          attentionCounts={attentionCounts}
          hintOf={(destination) => destination.description}
          label="Members admin areas"
          idPrefix={MEMBERS_ADMIN_AREA_ID_PREFIX}
          tabId={(_area, tab) => membersAdminTabId(tab)}
          tabPanelId={(_area, tab) => membersAdminTabPanelId(tab)}
        />
      }
      refreshToken={frameToken}
      onSummaryChange={handleSummaryChange}
    >
      <div
        id={`${MEMBERS_ADMIN_AREA_ID_PREFIX}-panel-${activeArea.id}`}
        role="tabpanel"
        aria-labelledby={`${MEMBERS_ADMIN_AREA_ID_PREFIX}-tab-${activeArea.id}-label`}
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
              id={membersAdminTabPanelId(destination.id)}
              role="tabpanel"
              aria-labelledby={membersAdminTabId(destination.id)}
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

export default MembersAdminHub;
