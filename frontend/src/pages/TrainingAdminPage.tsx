/**
 * Training Admin Hub
 *
 * Consolidated admin page for training coordinators/officers. Its destinations
 * are grouped into seven areas — Overview, Records, Curriculum, Evaluations,
 * Program Management, Compliance Reporting, Settings & Data — declared in
 * `components/training/trainingAdminAreas.ts`, which also resolves the URL.
 *
 * URL structure: /training/admin?page=<area>&tab=<destination>
 * Older links (`?page=setup&tab=…`, `?page=skills-testing`, a bare `?tab=…`)
 * resolve to the area that now holds the destination.
 *
 * Requires: training.manage permission
 */

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { HelpLink } from '../components/HelpLink';
import { AdminHubFrame, AdminMetricsSettings } from '../components/admin';
import TrainingAdminNav from '../components/training/TrainingAdminNav';
import {
  areaPanelId,
  areaTabId,
  attentionCountsByTab,
  getTrainingAdminArea,
  resolveTrainingAdminLocation,
  tabId,
  tabPanelId,
  type TrainingAdminAreaId,
} from '../components/training/trainingAdminAreas';
import type { AdminHubSummary } from '../types/adminHub';
import { lazyWithRetry } from '../utils/lazyWithRetry';

// Lazy-loaded tab components
const TrainingOfficerDashboard = lazyWithRetry(() => import('./TrainingOfficerDashboard'));
const ComplianceMatrixTab = lazyWithRetry(() => import('./ComplianceMatrixTab'));
const ExpiringCertsTab = lazyWithRetry(() => import('./ExpiringCertsTab'));
const TrainingWaiversTab = lazyWithRetry(() => import('./TrainingWaiversTab'));

const ReviewSubmissionsPage = lazyWithRetry(() => import('./ReviewSubmissionsPage'));
const CreateTrainingSessionPage = lazyWithRetry(() => import('./CreateTrainingSessionPage'));
const ShiftReportPage = lazyWithRetry(() => import('./ShiftReportPage'));
const ManualEntrySettingsPanel = lazyWithRetry(() => import('./training/ManualEntrySettingsPanel'));
const SkillEvaluationsTab = lazyWithRetry(() => import('./training/SkillEvaluationsTab'));
const KnowledgeTestsTab = lazyWithRetry(() => import('./training/KnowledgeTestsTab'));

const TrainingRequirementsPage = lazyWithRetry(() => import('./TrainingRequirementsPage'));
const CreatePipelinePage = lazyWithRetry(() => import('./CreatePipelinePage'));
const ExternalTrainingPage = lazyWithRetry(() => import('./ExternalTrainingPage'));
const HistoricalImportPage = lazyWithRetry(() => import('./HistoricalImportPage'));

const SkillsTestingTemplatesTab = lazyWithRetry(() => import('./SkillsTestingTemplatesTab'));
const SkillsTestingTestRecordsTab = lazyWithRetry(() => import('./SkillsTestingTestRecordsTab'));
const TrainingEnhancementsTab = lazyWithRetry(() => import('./TrainingEnhancementsTab'));
const ComplianceOfficerDashboard = lazyWithRetry(() => import('./ComplianceOfficerDashboard'));
const CourseLibraryPage = lazyWithRetry(() => import('./CourseLibraryPage'));
const CohortsPage = lazyWithRetry(() => import('./training/CohortsPage'));
const MemberTrainingStatusPage = lazyWithRetry(() => import('./MemberTrainingStatusPage'));

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

// ── Tab content renderer ────────────────────────────────────────

// The hub's content column already supplies the page's width and side
// padding, so a tab's root sets only vertical spacing. A tab that brings its
// own `px-4 sm:px-6 lg:px-8` container is indented twice, which on a 320px
// phone costs 32px of an already narrow column.

const TabContent: React.FC<{ area: TrainingAdminAreaId; tab: string; onMetricsSaved: () => void }> = ({
  area,
  tab,
  onMetricsSaved,
}) => {
  // These two areas are single components that switch on the destination themselves.
  if (area === 'enhancements') return <TrainingEnhancementsTab activeTab={tab} />;
  if (area === 'compliance') return <ComplianceOfficerDashboard activeTab={tab} />;

  switch (tab) {
    case 'overview':
      return <TrainingOfficerDashboard />;
    case 'compliance':
      return <ComplianceMatrixTab />;
    case 'expiring-certs':
      return <ExpiringCertsTab />;
    case 'waivers':
      return <TrainingWaiversTab />;
    case 'submissions':
      return <ReviewSubmissionsPage />;
    case 'sessions':
      return <CreateTrainingSessionPage />;
    case 'cohorts':
      return <CohortsPage embedded />;
    case 'shift-reports':
      return <ShiftReportPage />;
    case 'member-status':
      return <MemberTrainingStatusPage />;
    case 'requirements':
      return <TrainingRequirementsPage />;
    case 'courses':
      return <CourseLibraryPage embedded />;
    case 'pipelines':
      return <CreatePipelinePage />;
    case 'skill-evaluations':
      return <SkillEvaluationsTab />;
    case 'knowledge-tests':
      return <KnowledgeTestsTab />;
    case 'templates':
      return <SkillsTestingTemplatesTab />;
    case 'tests':
      return <SkillsTestingTestRecordsTab />;
    case 'manual-entry':
      return <ManualEntrySettingsPanel />;
    case 'integrations':
      return <ExternalTrainingPage />;
    case 'import':
      return <HistoricalImportPage />;
    case 'metrics':
      return (
        <div className="py-6">
          <AdminMetricsSettings
            moduleKey="training"
            moduleLabel="Training"
            permission="training.manage"
            onSaved={onMetricsSaved}
          />
        </div>
      );
    default:
      return null;
  }
};

// ── Main component ──────────────────────────────────────────────

export const TrainingAdminPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Bumped when the metrics settings tab saves, so the row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({});

  // Derived from the URL on every render rather than mirrored into state, so
  // browser back/forward and in-app links can never leave the two disagreeing.
  const { area: activeAreaId, tab: activeTab } = resolveTrainingAdminLocation(
    searchParams.get('page'),
    searchParams.get('tab')
  );
  const activeArea = getTrainingAdminArea(activeAreaId);

  const navigateTo = (area: TrainingAdminAreaId, tab: string) => setSearchParams({ page: area, tab });

  const handleAreaChange = (areaId: TrainingAdminAreaId) => {
    const area = getTrainingAdminArea(areaId);
    navigateTo(areaId, area.destinations[0]?.id ?? '');
  };

  const handleSummaryChange = (summary: AdminHubSummary | null) =>
    setAttentionCounts(attentionCountsByTab(summary?.attention ?? []));

  return (
    <AdminHubFrame
      moduleKey="training"
      title="Training Administration"
      description="Manage training submissions, requirements, sessions, and more"
      primaryAction={{
        key: 'create-session',
        label: 'Create Session',
        icon: Plus,
        onClick: () => navigateTo('records', 'sessions'),
      }}
      headerAside={
        <HelpLink
          topic="training"
          tooltip="Track NFPA compliance, manage training requirements, review submissions, and set up certification pipelines. The compliance matrix shows department-wide training status."
        />
      }
      nav={
        <TrainingAdminNav
          activeArea={activeArea}
          activeTab={activeTab}
          onAreaChange={handleAreaChange}
          onTabChange={(tab) => navigateTo(activeAreaId, tab)}
          attentionCounts={attentionCounts}
        />
      }
      refreshToken={frameToken}
      onSummaryChange={handleSummaryChange}
    >
      <div id={areaPanelId(activeAreaId)} role="tabpanel" aria-labelledby={`${areaTabId(activeAreaId)}-label`}>
        <div className="mx-auto max-w-7xl">
          {/*
            One panel per destination, not one for the selected destination.
            Every destination tab advertises its panel through `aria-controls`,
            and rendering only the active one left every inactive tab pointing
            at an ID that was not in the document — so assistive technology
            could not resolve the panel a tab claimed to control. Only the
            selected panel holds content: mounting all of them would have each
            destination fetch its data on arrival at the area.
          */}
          {activeArea.destinations.map((destination) => {
            const isActive = activeTab === destination.id;
            return (
              <div
                key={destination.id}
                id={tabPanelId(activeAreaId, destination.id)}
                role="tabpanel"
                aria-labelledby={tabId(activeAreaId, destination.id)}
                hidden={!isActive}
              >
                {isActive && (
                  <Suspense fallback={<TabLoading />}>
                    <TabContent
                      area={activeAreaId}
                      tab={destination.id}
                      onMetricsSaved={() => setFrameToken((token) => token + 1)}
                    />
                  </Suspense>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AdminHubFrame>
  );
};

export default TrainingAdminPage;
