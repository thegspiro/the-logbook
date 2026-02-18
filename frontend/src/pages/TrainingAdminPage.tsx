/**
 * Training Admin Hub
 *
 * Consolidated admin page for training coordinators/officers.
 * Provides a tabbed interface to all training administration functions.
 *
 * Requires: training.manage permission
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const TrainingOfficerDashboard = lazy(() => import('./TrainingOfficerDashboard'));
const ReviewSubmissionsPage = lazy(() => import('./ReviewSubmissionsPage'));
const TrainingRequirementsPage = lazy(() => import('./TrainingRequirementsPage'));
const CreateTrainingSessionPage = lazy(() => import('./CreateTrainingSessionPage'));
const CreatePipelinePage = lazy(() => import('./CreatePipelinePage'));
const ShiftReportPage = lazy(() => import('./ShiftReportPage'));
const ExternalTrainingPage = lazy(() => import('./ExternalTrainingPage'));
const ComplianceMatrixTab = lazy(() => import('./ComplianceMatrixTab'));
const ExpiringCertsTab = lazy(() => import('./ExpiringCertsTab'));

type AdminTab = 'dashboard' | 'submissions' | 'requirements' | 'sessions' | 'compliance' | 'expiring-certs' | 'pipelines' | 'shift-reports' | 'integrations';

const tabs: { id: AdminTab; label: string }[] = [
  { id: 'dashboard', label: 'Officer Dashboard' },
  { id: 'submissions', label: 'Review Submissions' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'sessions', label: 'Create Session' },
  { id: 'compliance', label: 'Compliance Matrix' },
  { id: 'expiring-certs', label: 'Expiring Certs' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'shift-reports', label: 'Shift Reports' },
  { id: 'integrations', label: 'Integrations' },
];

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-slate-400">Loading...</div>
  </div>
);

export const TrainingAdminPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabParam && tabs.some(t => t.id === tabParam) ? tabParam : 'dashboard');

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
          <h1 className="text-2xl font-bold text-white">Training Administration</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage training submissions, requirements, sessions, and more
          </p>
        </div>

        <div className="border-b border-white/10">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Training admin tabs">
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
        {activeTab === 'dashboard' && <TrainingOfficerDashboard />}
        {activeTab === 'submissions' && <ReviewSubmissionsPage />}
        {activeTab === 'requirements' && <TrainingRequirementsPage />}
        {activeTab === 'sessions' && <CreateTrainingSessionPage />}
        {activeTab === 'compliance' && <ComplianceMatrixTab />}
        {activeTab === 'expiring-certs' && <ExpiringCertsTab />}
        {activeTab === 'pipelines' && <CreatePipelinePage />}
        {activeTab === 'shift-reports' && <ShiftReportPage />}
        {activeTab === 'integrations' && <ExternalTrainingPage />}
      </Suspense>
    </div>
  );
};

export default TrainingAdminPage;
