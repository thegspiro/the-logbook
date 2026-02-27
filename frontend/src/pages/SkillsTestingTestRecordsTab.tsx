/**
 * Skills Testing - Test Records Tab
 *
 * Renders inside the Training Admin Hub for viewing and managing
 * all skill test records across the organization.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Users,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import type { SkillTestListItem } from '../types/skillsTesting';

// ── Sub-components ─────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

const TestCard: React.FC<{
  test: SkillTestListItem;
  onClick: () => void;
  onDelete: () => void;
}> = ({ test, onClick, onDelete }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    className="w-full text-left bg-theme-surface rounded-lg p-4 border border-theme-surface-border hover:border-red-500/50 transition-colors cursor-pointer"
  >
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium text-theme-text-primary truncate">{test.template_name}</p>
          <StatusBadge status={test.status} />
          {test.result !== 'incomplete' && <StatusBadge status={test.result} />}
        </div>
        <p className="text-sm text-theme-text-muted">
          Candidate: {test.candidate_name} &middot; Examiner: {test.examiner_name}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-4 shrink-0">
        <div className="text-right">
          {test.overall_score != null && (
            <p className="text-lg font-bold text-theme-text-primary">{Math.round(test.overall_score)}%</p>
          )}
          <p className="text-xs text-theme-text-muted">
            {test.completed_at ? new Date(test.completed_at).toLocaleDateString() : test.started_at ? 'In Progress' : 'Not Started'}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 rounded-lg text-theme-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          aria-label={`Delete test for ${test.candidate_name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);

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

  const filteredTests = tests.filter((t) =>
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Search tests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={() => navigate('/training/skills-testing/test/new')}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Start Test</span>
          </button>
        </div>
      </div>

      {/* Tests List */}
      {testsLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500" />
        </div>
      ) : filteredTests.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
          <Users className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No test records found</p>
          {templates.length > 0 && (
            <button
              onClick={() => navigate('/training/skills-testing/test/new')}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
            >
              Start a New Test
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              onClick={() => navigate(`/training/skills-testing/test/${test.id}`)}
              onDelete={() => void handleDelete(test)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillsTestingTestRecordsTab;
