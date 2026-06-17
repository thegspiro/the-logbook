/**
 * Skills Testing Page (Member-Facing)
 *
 * Shows published skill evaluation templates so regular members can
 * browse available tests and view their own test history/results.
 * Training officers also see this page but manage templates via the
 * Training Admin Hub (/training/admin?page=skills-testing).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Search, FileText, Layers, CheckCircle2, XCircle, Clock, ChevronRight } from 'lucide-react';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { SkillTemplateListItem, SkillTestListItem } from '../types/skillsTesting';

// ── Sub-components ─────────────────────────────────────────────

const ResultBadge: React.FC<{ result: string }> = ({ result }) => {
  const styles: Record<string, string> = {
    pass: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    fail: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    incomplete: 'bg-theme-surface-secondary text-theme-text-primary',
    in_progress: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    completed: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  };

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[result] ?? styles['incomplete']}`}
    >
      {result.replace('_', ' ')}
    </span>
  );
};

const TemplateCard: React.FC<{
  template: SkillTemplateListItem;
  onClick: () => void;
}> = ({ template, onClick }) => (
  <button
    onClick={onClick}
    className="bg-theme-surface border-theme-surface-border group w-full rounded-lg border p-5 text-left transition-all hover:border-red-500/50 hover:shadow-xs"
  >
    <div className="flex items-start justify-between">
      <div className="min-w-0 flex-1">
        <h3 className="text-theme-text-primary text-base font-semibold transition-colors group-hover:text-red-600">
          {template.name}
        </h3>
        {template.description && (
          <p className="text-theme-text-muted mt-1 line-clamp-2 text-sm">{template.description}</p>
        )}
        <div className="text-theme-text-muted mt-3 flex items-center gap-3 text-xs">
          {template.category && (
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {template.category}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3 w-3" aria-hidden="true" />
            {template.section_count} section{template.section_count !== 1 ? 's' : ''}
          </span>
          <span>{template.criteria_count} criteria</span>
        </div>
      </div>
      <ChevronRight className="text-theme-text-muted mt-1 h-5 w-5 shrink-0 transition-colors group-hover:text-red-500" />
    </div>
  </button>
);

const TestHistoryCard: React.FC<{
  test: SkillTestListItem;
  onClick: () => void;
}> = ({ test, onClick }) => {
  const tz = useTimezone();
  return (
    <button
      onClick={onClick}
      className="bg-theme-surface border-theme-surface-border w-full rounded-lg border p-4 text-left transition-colors hover:border-red-500/50"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-theme-text-primary truncate font-medium">{test.template_name}</p>
            <ResultBadge result={test.status} />
            {test.result !== 'incomplete' && <ResultBadge result={test.result} />}
          </div>
          <p className="text-theme-text-muted text-sm">
            Examiner: {test.examiner_name}
            {test.completed_at && <> &middot; {formatDate(test.completed_at, tz)}</>}
          </p>
        </div>
        <div className="ml-4 shrink-0 text-right">
          {test.overall_score != null ? (
            <div className="flex items-center gap-1.5">
              {test.result === 'pass' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : test.result === 'fail' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : null}
              <p
                className={`text-lg font-bold ${test.result === 'pass' ? 'text-green-600' : test.result === 'fail' ? 'text-red-600' : 'text-theme-text-primary'}`}
              >
                {Math.round(test.overall_score)}%
              </p>
            </div>
          ) : (
            <span className="text-theme-text-muted flex items-center gap-1 text-sm">
              <Clock className="h-4 w-4" />
              In Progress
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

// ── Main Page Component ────────────────────────────────────────

type TabType = 'available' | 'history';

export const SkillsTestingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { templates, templatesLoading, loadTemplates, tests, testsLoading, loadTests } = useSkillsTestingStore();

  const [activeTab, setActiveTab] = useState<TabType>('available');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Load only published templates for regular users
    void loadTemplates({ status: 'published' });
    // Load the current user's test history
    if (user?.id) {
      void loadTests({ candidate_id: user.id });
    }
  }, [loadTemplates, loadTests, user?.id]);

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.category ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTests = tests.filter((t) => t.template_name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-theme-text-primary flex items-center space-x-3 text-2xl font-bold sm:text-3xl">
            <ClipboardCheck className="h-7 w-7 text-red-700 sm:h-8 sm:w-8" />
            <span>Skills Testing</span>
          </h1>
          <p className="text-theme-text-muted mt-1">Practice and review your skill evaluations</p>
        </div>

        {/* Tab Navigation */}
        <div className="border-theme-surface-border mb-6 border-b">
          <nav className="flex gap-6" aria-label="Skills Testing Tabs">
            <button
              onClick={() => {
                setActiveTab('available');
                setSearchQuery('');
              }}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === 'available'
                  ? 'border-red-600 text-red-600'
                  : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Available Tests
              </div>
            </button>
            <button
              onClick={() => {
                setActiveTab('history');
                setSearchQuery('');
              }}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'border-red-600 text-red-600'
                  : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" />
                My Results
              </div>
            </button>
          </nav>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search
            className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder={activeTab === 'available' ? 'Search available tests...' : 'Search your results...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring/50 w-full rounded-lg border py-2 pr-4 pl-10 focus:ring-2 focus:outline-hidden"
          />
        </div>

        {/* Available Tests Tab */}
        {activeTab === 'available' && (
          <>
            {templatesLoading ? (
              <div className="flex justify-center py-12" role="status" aria-live="polite">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-red-500"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading...</span>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border rounded-lg border py-12 text-center">
                <ClipboardCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
                <p className="text-theme-text-muted">
                  {searchQuery ? 'No tests match your search' : 'No tests are available yet'}
                </p>
                <p className="text-theme-text-muted mt-1 text-sm">Check back later for published skill evaluations.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onClick={() => navigate(`/training/skills-testing/test/new?template=${template.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* My Results Tab */}
        {activeTab === 'history' && (
          <>
            {testsLoading ? (
              <div className="flex justify-center py-12" role="status" aria-live="polite">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-red-500"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading...</span>
              </div>
            ) : filteredTests.length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border rounded-lg border py-12 text-center">
                <ClipboardCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
                <p className="text-theme-text-muted">
                  {searchQuery ? 'No results match your search' : "You haven't taken any tests yet"}
                </p>
                <p className="text-theme-text-muted mt-1 text-sm">Browse the Available Tests tab to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTests.map((test) => (
                  <TestHistoryCard
                    key={test.id}
                    test={test}
                    onClick={() => navigate(`/training/skills-testing/test/${test.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default SkillsTestingPage;
