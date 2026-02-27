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
import {
  ClipboardCheck,
  Search,
  FileText,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/dateFormatting';
import type { SkillTemplateListItem, SkillTestListItem } from '../types/skillsTesting';

// ── Sub-components ─────────────────────────────────────────────

const ResultBadge: React.FC<{ result: string }> = ({ result }) => {
  const styles: Record<string, string> = {
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[result] ?? styles['incomplete']}`}>
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
    className="w-full text-left bg-theme-surface rounded-lg p-5 border border-theme-surface-border hover:border-red-500/50 hover:shadow-sm transition-all group"
  >
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-theme-text-primary text-base group-hover:text-red-600 transition-colors">
          {template.name}
        </h3>
        {template.description && (
          <p className="text-sm text-theme-text-muted mt-1 line-clamp-2">{template.description}</p>
        )}
        <div className="flex items-center gap-3 mt-3 text-xs text-theme-text-muted">
          {template.category && (
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {template.category}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Layers className="w-3 h-3" />
            {template.section_count} section{template.section_count !== 1 ? 's' : ''}
          </span>
          <span>
            {template.criteria_count} criteria
          </span>
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-theme-text-muted group-hover:text-red-500 transition-colors shrink-0 mt-1" />
    </div>
  </button>
);

const TestHistoryCard: React.FC<{
  test: SkillTestListItem;
  onClick: () => void;
}> = ({ test, onClick }) => (
  <button
    onClick={onClick}
    className="w-full text-left bg-theme-surface rounded-lg p-4 border border-theme-surface-border hover:border-red-500/50 transition-colors"
  >
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium text-theme-text-primary truncate">{test.template_name}</p>
          <ResultBadge result={test.status} />
          {test.result !== 'incomplete' && <ResultBadge result={test.result} />}
        </div>
        <p className="text-sm text-theme-text-muted">
          Examiner: {test.examiner_name}
          {test.completed_at && (
            <> &middot; {formatDate(test.completed_at)}</>
          )}
        </p>
      </div>
      <div className="text-right ml-4 shrink-0">
        {test.overall_score != null ? (
          <div className="flex items-center gap-1.5">
            {test.result === 'pass' ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : test.result === 'fail' ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : null}
            <p className={`text-lg font-bold ${test.result === 'pass' ? 'text-green-600' : test.result === 'fail' ? 'text-red-600' : 'text-theme-text-primary'}`}>
              {Math.round(test.overall_score)}%
            </p>
          </div>
        ) : (
          <span className="text-sm text-theme-text-muted flex items-center gap-1">
            <Clock className="w-4 h-4" />
            In Progress
          </span>
        )}
      </div>
    </div>
  </button>
);

// ── Main Page Component ────────────────────────────────────────

type TabType = 'available' | 'history';

export const SkillsTestingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    templates,
    templatesLoading,
    loadTemplates,
    tests,
    testsLoading,
    loadTests,
  } = useSkillsTestingStore();

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

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTests = tests.filter((t) =>
    t.template_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <ClipboardCheck className="w-7 h-7 sm:w-8 sm:h-8 text-red-700" />
            <span>Skills Testing</span>
          </h1>
          <p className="text-theme-text-muted mt-1">
            Practice and review your skill evaluations
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-theme-surface-border mb-6">
          <nav className="flex gap-6" aria-label="Skills Testing Tabs">
            <button
              onClick={() => { setActiveTab('available'); setSearchQuery(''); }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'available'
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Available Tests
              </div>
            </button>
            <button
              onClick={() => { setActiveTab('history'); setSearchQuery(''); }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'history'
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" />
                My Results
              </div>
            </button>
          </nav>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            type="text"
            placeholder={activeTab === 'available' ? 'Search available tests...' : 'Search your results...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        </div>

        {/* Available Tests Tab */}
        {activeTab === 'available' && (
          <>
            {templatesLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500" />
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
                <ClipboardCheck className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
                <p className="text-theme-text-muted">
                  {searchQuery ? 'No tests match your search' : 'No tests are available yet'}
                </p>
                <p className="text-sm text-theme-text-muted mt-1">
                  Check back later for published skill evaluations.
                </p>
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
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500" />
              </div>
            ) : filteredTests.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
                <ClipboardCheck className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
                <p className="text-theme-text-muted">
                  {searchQuery ? 'No results match your search' : 'You haven\'t taken any tests yet'}
                </p>
                <p className="text-sm text-theme-text-muted mt-1">
                  Browse the Available Tests tab to get started.
                </p>
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
