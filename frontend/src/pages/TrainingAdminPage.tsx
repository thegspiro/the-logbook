/**
 * Training Admin Hub
 *
 * Consolidated admin page for training coordinators/officers.
 * Organizes training administration into three sub-pages, each with
 * its own set of tabs:
 *
 *   Dashboard  – Overview, Compliance Matrix, Expiring Certs
 *   Records    – Review Submissions, Sessions, Shift Reports
 *   Setup      – Requirements, Pipelines, Integrations, Import History
 *
 * URL structure: /training/admin?page=dashboard&tab=overview
 *
 * Requires: training.manage permission
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, Settings } from 'lucide-react';
import { HelpLink } from '../components/HelpLink';

// Lazy-loaded tab components
const TrainingOfficerDashboard = lazy(() => import('./TrainingOfficerDashboard'));
const ComplianceMatrixTab = lazy(() => import('./ComplianceMatrixTab'));
const ExpiringCertsTab = lazy(() => import('./ExpiringCertsTab'));
const TrainingWaiversTab = lazy(() => import('./TrainingWaiversTab'));

const ReviewSubmissionsPage = lazy(() => import('./ReviewSubmissionsPage'));
const CreateTrainingSessionPage = lazy(() => import('./CreateTrainingSessionPage'));
const ShiftReportPage = lazy(() => import('./ShiftReportPage'));

const TrainingRequirementsPage = lazy(() => import('./TrainingRequirementsPage'));
const CreatePipelinePage = lazy(() => import('./CreatePipelinePage'));
const ExternalTrainingPage = lazy(() => import('./ExternalTrainingPage'));
const HistoricalImportPage = lazy(() => import('./HistoricalImportPage'));

// ── Type definitions ────────────────────────────────────────────

type PageId = 'dashboard' | 'records' | 'setup';

interface TabDef {
  id: string;
  label: string;
}

interface PageDef {
  id: PageId;
  label: string;
  icon: React.FC<{ className?: string }>;
  description: string;
  tabs: TabDef[];
  defaultTab: string;
}

// ── Page & tab structure ────────────────────────────────────────

const pages: PageDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Training overview, compliance tracking, and certificate monitoring',
    tabs: [
      { id: 'overview', label: 'Overview' },
      { id: 'compliance', label: 'Compliance Matrix' },
      { id: 'expiring-certs', label: 'Expiring Certs' },
      { id: 'waivers', label: 'Training Waivers' },
    ],
    defaultTab: 'overview',
  },
  {
    id: 'records',
    label: 'Records',
    icon: ClipboardList,
    description: 'Review submissions, manage sessions, and generate shift reports',
    tabs: [
      { id: 'submissions', label: 'Submissions' },
      { id: 'sessions', label: 'Sessions' },
      { id: 'shift-reports', label: 'Shift Reports' },
    ],
    defaultTab: 'submissions',
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: Settings,
    description: 'Configure requirements, pipelines, integrations, and data imports',
    tabs: [
      { id: 'requirements', label: 'Requirements' },
      { id: 'pipelines', label: 'Pipelines' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'import', label: 'Import History' },
    ],
    defaultTab: 'requirements',
  },
];

// Map from old flat tab IDs to new page+tab for backwards compatibility
const legacyTabMap: Record<string, { page: PageId; tab: string }> = {
  'dashboard': { page: 'dashboard', tab: 'overview' },
  'compliance': { page: 'dashboard', tab: 'compliance' },
  'expiring-certs': { page: 'dashboard', tab: 'expiring-certs' },
  'waivers': { page: 'dashboard', tab: 'waivers' },
  'submissions': { page: 'records', tab: 'submissions' },
  'sessions': { page: 'records', tab: 'sessions' },
  'shift-reports': { page: 'records', tab: 'shift-reports' },
  'requirements': { page: 'setup', tab: 'requirements' },
  'pipelines': { page: 'setup', tab: 'pipelines' },
  'integrations': { page: 'setup', tab: 'integrations' },
  'import': { page: 'setup', tab: 'import' },
};

// ── Helpers ──────────────────────────────────────────────────────

const getPage = (id: PageId): PageDef => pages.find(p => p.id === id)!;

const isValidPage = (id: string): id is PageId =>
  pages.some(p => p.id === id);

const isValidTab = (page: PageDef, tabId: string): boolean =>
  page.tabs.some(t => t.id === tabId);

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

// ── Tab content renderer ────────────────────────────────────────

const TabContent: React.FC<{ page: PageId; tab: string }> = ({ page, tab }) => {
  // Dashboard sub-page
  if (page === 'dashboard') {
    if (tab === 'overview') return <TrainingOfficerDashboard />;
    if (tab === 'compliance') return <ComplianceMatrixTab />;
    if (tab === 'expiring-certs') return <ExpiringCertsTab />;
    if (tab === 'waivers') return <TrainingWaiversTab />;
  }

  // Records sub-page
  if (page === 'records') {
    if (tab === 'submissions') return <ReviewSubmissionsPage />;
    if (tab === 'sessions') return <CreateTrainingSessionPage />;
    if (tab === 'shift-reports') return <ShiftReportPage />;
  }

  // Setup sub-page
  if (page === 'setup') {
    if (tab === 'requirements') return <TrainingRequirementsPage />;
    if (tab === 'pipelines') return <CreatePipelinePage />;
    if (tab === 'integrations') return <ExternalTrainingPage />;
    if (tab === 'import') return <HistoricalImportPage />;
  }

  return null;
};

// ── Main component ──────────────────────────────────────────────

export const TrainingAdminPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve initial state from URL params (supports both old and new format)
  const resolveInitial = (): { page: PageId; tab: string } => {
    const pageParam = searchParams.get('page');
    const tabParam = searchParams.get('tab');

    // New format: ?page=dashboard&tab=overview
    if (pageParam && isValidPage(pageParam)) {
      const pageDef = getPage(pageParam);
      const tab = tabParam && isValidTab(pageDef, tabParam) ? tabParam : pageDef.defaultTab;
      return { page: pageParam, tab };
    }

    // Legacy format: ?tab=submissions (old flat tab IDs)
    if (tabParam && tabParam in legacyTabMap) {
      return legacyTabMap[tabParam]!;
    }

    return { page: 'dashboard', tab: 'overview' };
  };

  const initial = resolveInitial();
  const [activePage, setActivePage] = useState<PageId>(initial.page);
  const [activeTab, setActiveTab] = useState<string>(initial.tab);

  // Sync from URL changes (e.g. browser back/forward)
  useEffect(() => {
    const { page, tab } = resolveInitial();
    setActivePage(page);
    setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handlePageChange = (pageId: PageId) => {
    const pageDef = getPage(pageId);
    setActivePage(pageId);
    setActiveTab(pageDef.defaultTab);
    setSearchParams({ page: pageId, tab: pageDef.defaultTab });
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams({ page: activePage, tab: tabId });
  };

  const currentPage = getPage(activePage);

  return (
    <div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Page Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">Training Administration</h1>
            <p className="mt-1 text-sm text-theme-text-muted">
              Manage training submissions, requirements, sessions, and more
            </p>
          </div>
          <HelpLink
            topic="training"
            tooltip="Track NFPA compliance, manage training requirements, review submissions, and set up certification pipelines. The compliance matrix shows department-wide training status."
          />
        </div>

        {/* Top-level sub-page selector */}
        <div className="flex space-x-2 mb-6" role="tablist" aria-label="Training admin sections">
          {pages.map((page) => {
            const Icon = page.icon;
            const isActive = activePage === page.id;
            return (
              <button
                key={page.id}
                onClick={() => handlePageChange(page.id)}
                role="tab"
                aria-selected={isActive}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[var(--ring-offset-bg)] ${
                  isActive
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface-secondary text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{page.label}</span>
              </button>
            );
          })}
        </div>

        {/* Inner tab bar */}
        <div className="border-b border-theme-surface-border">
          <nav className="flex space-x-1" aria-label={`${currentPage.label} tabs`}>
            {currentPage.tabs.map((tab) => (
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
        <TabContent page={activePage} tab={activeTab} />
      </Suspense>
    </div>
  );
};

export default TrainingAdminPage;
