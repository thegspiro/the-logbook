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

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ClipboardList,
  Settings,
  ClipboardCheck,
  TrendingUp,
  Shield,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { HelpLink } from '../components/HelpLink';
import { AdminHubFrame, AdminMetricsSettings } from '../components/admin';
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

// ── Type definitions ────────────────────────────────────────────

type PageId = 'dashboard' | 'records' | 'setup' | 'skills-testing' | 'enhancements' | 'compliance';

interface TabDef {
  id: string;
  label: string;
}

interface PageDef {
  id: PageId;
  label: string;
  icon: LucideIcon;
  description: string;
  tabs: TabDef[];
  defaultTab: string;
  actions?: Array<{
    label: string;
    tab: string;
  }>;
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
      { id: 'cohorts', label: 'Course Cohorts' },
      { id: 'shift-reports', label: 'Shift Reports' },
      { id: 'member-status', label: 'Monthly Status' },
    ],
    defaultTab: 'submissions',
    actions: [
      { label: 'Review submissions', tab: 'submissions' },
      { label: 'Create session', tab: 'sessions' },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: Settings,
    description: 'Configure requirements, pipelines, integrations, and data imports',
    tabs: [
      { id: 'requirements', label: 'Requirements' },
      { id: 'courses', label: 'Course Library' },
      { id: 'pipelines', label: 'Pipelines' },
      { id: 'manual-entry', label: 'Manual Entry' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'import', label: 'Import History' },
      { id: 'metrics', label: 'Headline Metrics' },
    ],
    defaultTab: 'requirements',
    actions: [{ label: 'Manage requirements', tab: 'requirements' }],
  },
  {
    id: 'skills-testing',
    label: 'Skills Testing',
    icon: ClipboardCheck,
    description: 'Create evaluation templates and conduct skill assessments',
    tabs: [
      { id: 'templates', label: 'Templates' },
      { id: 'tests', label: 'Test Records' },
    ],
    defaultTab: 'templates',
  },
  {
    id: 'enhancements',
    label: 'Program Management',
    icon: TrendingUp,
    description:
      'Recertification pathways, competency tracking, instructor qualifications, effectiveness, and multi-agency training',
    tabs: [
      { id: 'recertification', label: 'Recertification' },
      { id: 'competency', label: 'Competency' },
      { id: 'instructors', label: 'Instructors' },
      { id: 'effectiveness', label: 'Effectiveness' },
      { id: 'multi-agency', label: 'Multi-Agency' },
      { id: 'reports', label: 'Reports' },
    ],
    defaultTab: 'recertification',
  },
  {
    id: 'compliance',
    label: 'Compliance',
    icon: Shield,
    description:
      'Annual compliance reporting, ISO readiness scoring, NFPA 1401 record quality, and formal attestation workflow',
    tabs: [
      { id: 'annual-report', label: 'Annual Report' },
      { id: 'iso-readiness', label: 'ISO Readiness' },
      { id: 'record-completeness', label: 'Record Quality' },
      { id: 'attestations', label: 'Attestations' },
      { id: 'forecast', label: 'Forecast' },
    ],
    defaultTab: 'annual-report',
  },
];

const primaryPages = pages.filter(({ id }) => ['dashboard', 'records', 'setup'].includes(id));
const overflowPages = pages.filter(({ id }) => !['dashboard', 'records', 'setup'].includes(id));

// Map from old flat tab IDs to new page+tab for backwards compatibility
const legacyTabMap: Record<string, { page: PageId; tab: string }> = {
  dashboard: { page: 'dashboard', tab: 'overview' },
  compliance: { page: 'dashboard', tab: 'compliance' },
  'expiring-certs': { page: 'dashboard', tab: 'expiring-certs' },
  waivers: { page: 'dashboard', tab: 'waivers' },
  submissions: { page: 'records', tab: 'submissions' },
  sessions: { page: 'records', tab: 'sessions' },
  cohorts: { page: 'records', tab: 'cohorts' },
  'shift-reports': { page: 'records', tab: 'shift-reports' },
  'member-status': { page: 'records', tab: 'member-status' },
  requirements: { page: 'setup', tab: 'requirements' },
  courses: { page: 'setup', tab: 'courses' },
  pipelines: { page: 'setup', tab: 'pipelines' },
  integrations: { page: 'setup', tab: 'integrations' },
  import: { page: 'setup', tab: 'import' },
  metrics: { page: 'setup', tab: 'metrics' },
  templates: { page: 'skills-testing', tab: 'templates' },
  tests: { page: 'skills-testing', tab: 'tests' },
  recertification: { page: 'enhancements', tab: 'recertification' },
  competency: { page: 'enhancements', tab: 'competency' },
  instructors: { page: 'enhancements', tab: 'instructors' },
  effectiveness: { page: 'enhancements', tab: 'effectiveness' },
  'multi-agency': { page: 'enhancements', tab: 'multi-agency' },
  reports: { page: 'enhancements', tab: 'reports' },
  'annual-report': { page: 'compliance', tab: 'annual-report' },
  'iso-readiness': { page: 'compliance', tab: 'iso-readiness' },
  'record-completeness': { page: 'compliance', tab: 'record-completeness' },
  attestations: { page: 'compliance', tab: 'attestations' },
  forecast: { page: 'compliance', tab: 'forecast' },
};

// ── Helpers ──────────────────────────────────────────────────────

const getPage = (id: PageId): PageDef => {
  const found = pages.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown page: ${id}`);
  return found;
};

const isValidPage = (id: string): id is PageId => pages.some((p) => p.id === id);

const isValidTab = (page: PageDef, tabId: string): boolean => page.tabs.some((t) => t.id === tabId);

const TabLoading = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="text-theme-text-muted">Loading...</div>
  </div>
);

// ── Tab content renderer ────────────────────────────────────────

const TabContent: React.FC<{ page: PageId; tab: string; onMetricsSaved: () => void }> = ({
  page,
  tab,
  onMetricsSaved,
}) => {
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
    if (tab === 'cohorts') return <CohortsPage embedded />;
    if (tab === 'shift-reports') return <ShiftReportPage />;
    if (tab === 'member-status') return <MemberTrainingStatusPage />;
  }

  // Setup sub-page
  if (page === 'setup') {
    if (tab === 'requirements') return <TrainingRequirementsPage />;
    if (tab === 'courses') return <CourseLibraryPage embedded />;
    if (tab === 'pipelines') return <CreatePipelinePage />;
    if (tab === 'manual-entry') return <ManualEntrySettingsPanel />;
    if (tab === 'integrations') return <ExternalTrainingPage />;
    if (tab === 'import') return <HistoricalImportPage />;
    if (tab === 'metrics')
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
  }

  // Skills Testing sub-page
  if (page === 'skills-testing') {
    if (tab === 'templates') return <SkillsTestingTemplatesTab />;
    if (tab === 'tests') return <SkillsTestingTestRecordsTab />;
  }

  // Advanced / Enhancements sub-page
  if (page === 'enhancements') {
    return <TrainingEnhancementsTab activeTab={tab} />;
  }

  // Compliance Officer sub-page
  if (page === 'compliance') {
    return <ComplianceOfficerDashboard activeTab={tab} />;
  }

  return null;
};

// ── Main component ──────────────────────────────────────────────

export const TrainingAdminPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const pageTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const innerTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  // Bumped when the metrics settings tab saves, so the row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);

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
      return legacyTabMap[tabParam] ?? { page: 'dashboard', tab: 'overview' };
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
    setIsMoreOpen(false);
  };

  // Entering the open menu is a side effect of it opening, not of a click:
  // the trigger is also reachable by keyboard, and either route has to land
  // the user on a menu item for the arrow keys below to have somewhere to go.
  useEffect(() => {
    if (!isMoreOpen) return;
    const firstId = overflowPages.find(({ id }) => id === activePage)?.id ?? overflowPages[0]?.id;
    if (firstId) moreItemRefs.current[firstId]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMoreOpen]);

  /**
   * Close the More menu and put focus back where the user left it.
   *
   * A menu that closes while focus is still on one of its now-removed items
   * drops focus to the document body, stranding a keyboard user at the top of
   * the page. `returnFocus` is false only when the caller is navigating away
   * to a section tab that takes focus itself.
   */
  const closeMoreMenu = (returnFocus = true) => {
    setIsMoreOpen(false);
    if (returnFocus) moreTriggerRef.current?.focus();
  };

  /**
   * `role="menu"` advertises a keyboard contract the browser does not supply.
   * Without this the popup opened with focus left on the trigger and neither
   * arrow keys, Home/End nor Escape did anything, so a screen-reader user was
   * told these sections existed and had no way to reach them.
   */
  const handleMoreMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const ids = overflowPages.map((page) => page.id);
    if (ids.length === 0) return;
    const focusedIndex = ids.findIndex((id) => moreItemRefs.current[id] === document.activeElement);

    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % ids.length;
    if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + ids.length) % ids.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ids.length - 1;

    if (nextIndex !== undefined) {
      event.preventDefault();
      const nextId = ids[nextIndex];
      if (nextId !== undefined) moreItemRefs.current[nextId]?.focus();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMoreMenu();
    }
    // Tab moves on through the page rather than being trapped, so the menu
    // dismisses itself and leaves focus where the browser puts it next.
    if (event.key === 'Tab') setIsMoreOpen(false);
  };

  const handleMoreTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setIsMoreOpen(true);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams({ page: activePage, tab: tabId });
  };

  /**
   * `focusedId` is the tab the keystroke came from, not the selected one.
   *
   * Browser back/forward changes the selection without moving focus, so the
   * two diverge: deriving the step from the selected tab then moved focus from
   * somewhere the user was not, skipping over the tab they were actually on.
   */
  const handleTabKeyDown = <T extends string>(
    event: React.KeyboardEvent<HTMLButtonElement>,
    ids: T[],
    focusedId: T,
    activate: (id: T) => void,
    refs: React.RefObject<Record<string, HTMLButtonElement | null>>
  ) => {
    let nextIndex: number | undefined;
    const focusedIndex = ids.indexOf(focusedId);

    if (event.key === 'ArrowRight') nextIndex = (focusedIndex + 1) % ids.length;
    if (event.key === 'ArrowLeft') nextIndex = (focusedIndex - 1 + ids.length) % ids.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ids.length - 1;

    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextId = ids[nextIndex];
    if (nextId === undefined) return;
    activate(nextId);
    refs.current[nextId]?.focus();
  };

  const currentPage = getPage(activePage);

  // Training keeps its own two-level navigation — six sections, each with its
  // own tabs — so it fills the frame's nav slot rather than taking the
  // standard single tab bar. Everything above it is the shared frame.
  const nav = (
    <>
      {/* Narrow-screen navigation uses native controls rather than horizontal scrolling. */}
      <div className="grid gap-4 md:hidden">
        <label className="text-theme-text-primary text-sm font-medium" htmlFor="training-admin-page">
          Section
        </label>
        <select
          id="training-admin-page"
          aria-label="Training admin section"
          value={activePage}
          onChange={(event) => handlePageChange(event.target.value as PageId)}
          className="border-theme-surface-border bg-theme-surface-primary text-theme-text-primary focus:ring-theme-focus-ring min-h-11 w-full rounded-lg border px-3 focus:ring-2 focus:outline-hidden"
        >
          <optgroup label="Primary">
            {primaryPages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="More">
            {overflowPages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.label}
              </option>
            ))}
          </optgroup>
        </select>
        <label className="text-theme-text-primary text-sm font-medium" htmlFor="training-admin-tab">
          {currentPage.label} destination
        </label>
        <select
          id="training-admin-tab"
          aria-label={`${currentPage.label} destination`}
          value={activeTab}
          onChange={(event) => handleTabChange(event.target.value)}
          className="border-theme-surface-border bg-theme-surface-primary text-theme-text-primary focus:ring-theme-focus-ring min-h-11 w-full rounded-lg border px-3 focus:ring-2 focus:outline-hidden"
        >
          {currentPage.tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop navigation keeps frequent workflows prominent and tucks the rest into More. */}
      <div className="hidden items-center space-x-2 md:flex" role="tablist" aria-label="Training admin sections">
        {primaryPages.map((page) => {
          const Icon = page.icon;
          const isActive = activePage === page.id;
          return (
            <button
              key={page.id}
              id={`training-admin-section-tab-${page.id}`}
              ref={(element) => {
                pageTabRefs.current[page.id] = element;
              }}
              onClick={() => handlePageChange(page.id)}
              onKeyDown={(event) =>
                handleTabKeyDown(
                  event,
                  primaryPages.map((item) => item.id),
                  page.id,
                  handlePageChange,
                  pageTabRefs
                )
              }
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              className={`focus:ring-theme-focus-ring flex min-h-11 items-center space-x-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden ${
                isActive
                  ? 'bg-red-800 text-white'
                  : 'bg-theme-surface-secondary text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{page.label}</span>
            </button>
          );
        })}
        <div className="relative">
          <button
            type="button"
            ref={moreTriggerRef}
            onClick={() => setIsMoreOpen((open) => !open)}
            onKeyDown={handleMoreTriggerKeyDown}
            aria-expanded={isMoreOpen}
            aria-haspopup="menu"
            className={`focus:ring-theme-focus-ring flex min-h-11 items-center space-x-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-hidden ${
              overflowPages.some(({ id }) => id === activePage)
                ? 'bg-red-800 text-white'
                : 'bg-theme-surface-secondary text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <span>More</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          {isMoreOpen && (
            <div
              role="menu"
              aria-label="More training admin sections"
              onKeyDown={handleMoreMenuKeyDown}
              className="border-theme-surface-border bg-theme-surface-primary absolute right-0 z-20 mt-2 w-64 rounded-lg border p-1 shadow-lg"
            >
              {overflowPages.map((page) => {
                const Icon = page.icon;
                const isActive = activePage === page.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    role="menuitem"
                    ref={(element) => {
                      moreItemRefs.current[page.id] = element;
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handlePageChange(page.id)}
                    className={`focus:ring-theme-focus-ring flex w-full items-start gap-3 rounded-md px-3 py-2 text-left focus:ring-2 focus:outline-hidden ${
                      isActive
                        ? 'bg-theme-surface-secondary text-theme-text-primary'
                        : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-primary'
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium">{page.label}</span>
                      <span className="mt-0.5 block text-xs">{page.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* The live region gives section changes useful context without announcing tab content. */}
      <div
        className="border-theme-surface-border bg-theme-surface-secondary flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-theme-text-muted text-sm">
          <span className="text-theme-text-primary font-semibold">{currentPage.label}:</span> {currentPage.description}
        </p>
        {currentPage.actions && (
          <div className="flex shrink-0 flex-wrap gap-2" aria-label={`${currentPage.label} actions`}>
            {currentPage.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => handleTabChange(action.tab)}
                className="focus:ring-theme-focus-ring text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover min-h-10 rounded-md border px-3 py-2 text-sm font-medium focus:ring-2 focus:outline-hidden"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <AdminHubFrame
      moduleKey="training"
      title="Training Administration"
      description="Manage training submissions, requirements, sessions, and more"
      primaryAction={{
        key: 'create-session',
        label: 'Create Session',
        icon: Plus,
        onClick: () => {
          setActivePage('records');
          setActiveTab('sessions');
          setSearchParams({ page: 'records', tab: 'sessions' });
        },
      }}
      headerAside={
        <HelpLink
          topic="training"
          tooltip="Track NFPA compliance, manage training requirements, review submissions, and set up certification pipelines. The compliance matrix shows department-wide training status."
        />
      }
      nav={nav}
      refreshToken={frameToken}
    >
      <div
        id={`training-admin-section-panel-${activePage}`}
        role="tabpanel"
        aria-labelledby={`training-admin-section-tab-${activePage}`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Inner tab bar */}
          <div className="border-theme-surface-border border-b">
            <div className="hscroll flex space-x-1" role="tablist" aria-label={`${currentPage.label} tabs`}>
              {currentPage.tabs.map((tab) => (
                <button
                  key={tab.id}
                  id={`training-admin-tab-${activePage}-${tab.id}`}
                  ref={(element) => {
                    innerTabRefs.current[tab.id] = element;
                  }}
                  onClick={() => handleTabChange(tab.id)}
                  onKeyDown={(event) =>
                    handleTabKeyDown(
                      event,
                      currentPage.tabs.map((item) => item.id),
                      tab.id,
                      handleTabChange,
                      innerTabRefs
                    )
                  }
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`training-admin-tabpanel-${activePage}-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={`focus:ring-theme-focus-ring border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden ${
                    activeTab === tab.id
                      ? 'text-theme-text-primary border-red-500'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/*
            One panel per tab, not one for the selected tab. Every inner tab
            advertises its panel through `aria-controls`, and rendering only
            the active one left every inactive tab pointing at an ID that was
            not in the document — so assistive technology could not resolve the
            panel a tab claimed to control. Only the selected panel holds
            content: mounting all of them would have each tab's page fetch its
            data on arrival at the section.
          */}
          {currentPage.tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <div
                key={tab.id}
                id={`training-admin-tabpanel-${activePage}-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`training-admin-tab-${activePage}-${tab.id}`}
                hidden={!isActive}
              >
                {isActive && (
                  <Suspense fallback={<TabLoading />}>
                    <TabContent
                      page={activePage}
                      tab={tab.id}
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
