/**
 * Skills Testing - Test Records Tab
 *
 * Renders inside the Training Admin Hub for viewing and managing
 * all skill test records across the organization.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { SkillTestListItem } from '../types/skillsTesting';
import { EmptyState } from '../components/ux';
import { ClipboardList } from 'lucide-react';

// ── Sub-components ─────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    incomplete: 'bg-theme-surface-secondary text-theme-text-primary',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-theme-surface-secondary text-theme-text-primary'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
};

const TestCard: React.FC<{
  test: SkillTestListItem;
  onClick: () => void;
  onDelete: () => void;
}> = ({ test, onClick, onDelete }) => {
  const tz = useTimezone();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className="bg-theme-surface border-theme-surface-border w-full cursor-pointer rounded-lg border p-4 text-left transition-colors hover:border-red-500/50"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-theme-text-primary truncate font-medium">{test.template_name}</p>
            <StatusBadge status={test.status} />
            {test.result !== 'incomplete' && <StatusBadge status={test.result} />}
            {test.is_practice && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                Practice
              </span>
            )}
          </div>
          <p className="text-theme-text-muted text-sm">
            Candidate: {test.candidate_name} &middot; Examiner: {test.examiner_name}
          </p>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-3">
          <div className="text-right">
            {test.overall_score != null && (
              <p className="text-theme-text-primary text-lg font-bold">{Math.round(test.overall_score)}%</p>
            )}
            <p className="text-theme-text-muted text-xs">
              {test.completed_at ? formatDate(test.completed_at, tz) : test.started_at ? 'In Progress' : 'Not Started'}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
            aria-label={`Delete test for ${test.candidate_name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────

const SkillsTestingTestRecordsTab: React.FC = () => {
  const navigate = useNavigate();
  const { tests, testsLoading, loadTests, deleteTest, templates, loadTemplates } = useSkillsTestingStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    void loadTests(statusFilter ? { status: statusFilter } : undefined);
    void loadTemplates({ status: 'published' });
  }, [loadTests, loadTemplates, statusFilter]);

  const filteredTests = tests.filter(
    (t) =>
      t.template_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.candidate_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.examiner_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = async (test: SkillTestListItem) => {
    const confirmed = window.confirm(
      `Delete the test record for ${test.candidate_name} (${test.template_name})? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteTest(test.id);
      toast.success('Test record deleted');
    } catch {
      toast.error('Failed to delete test record');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Toolbar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search tests..."
            placeholder="Search tests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring/50 w-full rounded-lg border py-2 pr-4 pl-10 focus:ring-2 focus:outline-hidden"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={() => void navigate('/training/skills-testing/test/new')}
            className="btn-primary flex items-center gap-2 font-medium"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Start Test</span>
          </button>
        </div>
      </div>

      {/* Tests List */}
      {testsLoading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-red-500" />
        </div>
      ) : filteredTests.length === 0 ? (
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border">
          <EmptyState
            icon={ClipboardList}
            title="No test records found"
            description={
              templates.length > 0
                ? 'No skills tests have been recorded yet. Start one to track member progress.'
                : 'Add a test template before recording skills tests.'
            }
            actions={
              templates.length > 0
                ? [{ label: 'Start a new test', onClick: () => void navigate('/training/skills-testing/test/new') }]
                : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              onClick={() => void navigate(`/training/skills-testing/test/${test.id}`)}
              onDelete={() => void handleDelete(test)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillsTestingTestRecordsTab;
