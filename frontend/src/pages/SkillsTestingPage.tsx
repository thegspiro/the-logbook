/**
 * Skills Testing Admin Hub Page
 *
 * Desktop-optimized admin hub for managing skill evaluation templates
 * and viewing test results. Training officers use this to create and
 * manage skill sheets from a station computer.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ClipboardCheck,
  Plus,
  Search,
  FileText,
  Users,
  TrendingUp,
  BarChart3,
  Copy,
  Pencil,
  Trash2,
  Eye,
  Send,
} from 'lucide-react';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import type {
  SkillTemplateListItem,
  SkillTestListItem,
} from '../types/skillsTesting';

// ==================== Sub-components ====================

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    archived: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles['draft']}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

const SummaryCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, icon, color }) => (
  <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-theme-text-muted">{label}</p>
        <p className="text-2xl font-bold text-theme-text-primary mt-1">{value}</p>
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        {icon}
      </div>
    </div>
  </div>
);

// ==================== Templates Tab ====================

const TemplatesTab: React.FC = () => {
  const navigate = useNavigate();
  const { templates, templatesLoading, loadTemplates, deleteTemplate, publishTemplate, duplicateTemplate } = useSkillsTestingStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
  }, [loadTemplates, statusFilter]);

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePublish = useCallback(async (id: string) => {
    if (window.confirm('Publish this template? It will be available for use in tests.')) {
      await publishTemplate(id);
      void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
    }
  }, [publishTemplate, loadTemplates, statusFilter]);

  const handleDuplicate = useCallback(async (id: string) => {
    const newTemplate = await duplicateTemplate(id);
    navigate(`/training/skills-testing/templates/${newTemplate.id}/edit`);
  }, [duplicateTemplate, navigate]);

  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm('Are you sure you want to archive this template?')) {
      await deleteTemplate(id);
    }
  }, [deleteTemplate]);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Search templates..."
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
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <button
            onClick={() => navigate('/training/skills-testing/templates/new')}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Template</span>
          </button>
        </div>
      </div>

      {/* Templates Table */}
      {templatesLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
          <ClipboardCheck className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No templates found</p>
          <button
            onClick={() => navigate('/training/skills-testing/templates/new')}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
          >
            Create Your First Template
          </button>
        </div>
      ) : (
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">Template</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider hidden md:table-cell">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider hidden lg:table-cell">Sections</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider hidden lg:table-cell">Criteria</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {filteredTemplates.map((template) => (
                  <TemplateRow
                    key={template.id}
                    template={template}
                    onEdit={() => navigate(`/training/skills-testing/templates/${template.id}/edit`)}
                    onView={() => navigate(`/training/skills-testing/templates/${template.id}`)}
                    onPublish={() => void handlePublish(template.id)}
                    onDuplicate={() => void handleDuplicate(template.id)}
                    onDelete={() => void handleDelete(template.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const TemplateRow: React.FC<{
  template: SkillTemplateListItem;
  onEdit: () => void;
  onView: () => void;
  onPublish: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}> = ({ template, onEdit, onView, onPublish, onDuplicate, onDelete }) => (
  <tr className="hover:bg-theme-surface-hover transition-colors">
    <td className="px-4 py-3">
      <div>
        <p className="font-medium text-theme-text-primary">{template.name}</p>
        {template.description && (
          <p className="text-sm text-theme-text-muted line-clamp-1">{template.description}</p>
        )}
      </div>
    </td>
    <td className="px-4 py-3 hidden md:table-cell">
      <span className="text-sm text-theme-text-muted">{template.category ?? '—'}</span>
    </td>
    <td className="px-4 py-3">
      <StatusBadge status={template.status} />
    </td>
    <td className="px-4 py-3 text-center hidden lg:table-cell">
      <span className="text-sm text-theme-text-muted">{template.section_count}</span>
    </td>
    <td className="px-4 py-3 text-center hidden lg:table-cell">
      <span className="text-sm text-theme-text-muted">{template.criteria_count}</span>
    </td>
    <td className="px-4 py-3">
      <div className="flex items-center justify-end gap-1">
        <button onClick={onView} className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors" title="View">
          <Eye className="w-4 h-4 text-theme-text-muted" />
        </button>
        <button onClick={onEdit} className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors" title="Edit">
          <Pencil className="w-4 h-4 text-theme-text-muted" />
        </button>
        {template.status === 'draft' && (
          <button onClick={onPublish} className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors" title="Publish">
            <Send className="w-4 h-4 text-green-600" />
          </button>
        )}
        <button onClick={onDuplicate} className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors" title="Duplicate">
          <Copy className="w-4 h-4 text-theme-text-muted" />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors" title="Archive">
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>
    </td>
  </tr>
);

// ==================== Tests Tab ====================

const TestsTab: React.FC = () => {
  const navigate = useNavigate();
  const { tests, testsLoading, loadTests, templates, loadTemplates } = useSkillsTestingStore();
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

  return (
    <div>
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TestCard: React.FC<{
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
          <StatusBadge status={test.status} />
          {test.result !== 'incomplete' && <StatusBadge status={test.result} />}
        </div>
        <p className="text-sm text-theme-text-muted">
          Candidate: {test.candidate_name} &middot; Examiner: {test.examiner_name}
        </p>
      </div>
      <div className="text-right ml-4 shrink-0">
        {test.overall_score != null && (
          <p className="text-lg font-bold text-theme-text-primary">{Math.round(test.overall_score)}%</p>
        )}
        <p className="text-xs text-theme-text-muted">
          {test.completed_at ? new Date(test.completed_at).toLocaleDateString() : test.started_at ? 'In Progress' : 'Not Started'}
        </p>
      </div>
    </div>
  </button>
);

// ==================== Main Page Component ====================

type TabType = 'templates' | 'tests';

export const SkillsTestingPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabType) || 'templates';
  const { summary, summaryLoading, loadSummary } = useSkillsTestingStore();

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const setActiveTab = (tab: TabType) => {
    setSearchParams({ tab });
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <ClipboardCheck className="w-8 h-8 text-red-700" />
            <span>Skills Testing</span>
          </h1>
          <p className="text-theme-text-muted mt-1">
            Create evaluation templates and conduct skill assessments
          </p>
        </div>

        {/* Summary Cards */}
        {!summaryLoading && summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              label="Templates"
              value={summary.total_templates}
              icon={<FileText className="w-5 h-5 text-blue-600" />}
              color="bg-blue-100 dark:bg-blue-900/30"
            />
            <SummaryCard
              label="Tests This Month"
              value={summary.tests_this_month}
              icon={<Users className="w-5 h-5 text-purple-600" />}
              color="bg-purple-100 dark:bg-purple-900/30"
            />
            <SummaryCard
              label="Pass Rate"
              value={`${Math.round(summary.pass_rate)}%`}
              icon={<TrendingUp className="w-5 h-5 text-green-600" />}
              color="bg-green-100 dark:bg-green-900/30"
            />
            <SummaryCard
              label="Avg Score"
              value={`${Math.round(summary.average_score)}%`}
              icon={<BarChart3 className="w-5 h-5 text-orange-600" />}
              color="bg-orange-100 dark:bg-orange-900/30"
            />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-theme-surface-border mb-6">
          <nav className="flex gap-6" aria-label="Skills Testing Tabs">
            <button
              onClick={() => setActiveTab('templates')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'templates'
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Templates
              </div>
            </button>
            <button
              onClick={() => setActiveTab('tests')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'tests'
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" />
                Test Records
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'templates' ? <TemplatesTab /> : <TestsTab />}
      </main>
    </div>
  );
};

export default SkillsTestingPage;
