/**
 * Skills Testing - Templates Tab
 *
 * Renders inside the Training Admin Hub for managing skill evaluation templates.
 * Training officers use this to create, edit, publish, duplicate, and archive templates.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
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
  CheckCircle2,
} from 'lucide-react';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import type { SkillTemplateListItem } from '../types/skillsTesting';
import { FormStatus } from '../constants/enums';

// ── Shared sub-components ──────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    archived: 'bg-theme-surface-secondary text-theme-text-primary',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles['draft']}`}
    >
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
  <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-theme-text-muted text-sm">{label}</p>
        <p className="text-theme-text-primary mt-1 text-2xl font-bold">{value}</p>
      </div>
      <div className={`rounded-lg p-3 ${color}`}>{icon}</div>
    </div>
  </div>
);

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
        <p className="text-theme-text-primary font-medium">{template.name}</p>
        {template.description && <p className="text-theme-text-muted line-clamp-1 text-sm">{template.description}</p>}
      </div>
    </td>
    <td className="hidden px-4 py-3 md:table-cell">
      <span className="text-theme-text-muted text-sm">{template.category ?? '—'}</span>
    </td>
    <td className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={template.status} />
        {template.visibility && template.visibility !== 'all_members' && (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            {template.visibility === 'officers_only' ? 'Officers' : 'Assigned'}
          </span>
        )}
      </div>
    </td>
    <td className="hidden px-4 py-3 text-center lg:table-cell">
      <span className="text-theme-text-muted text-sm">{template.section_count}</span>
    </td>
    <td className="hidden px-4 py-3 text-center lg:table-cell">
      <span className="text-theme-text-muted text-sm">{template.criteria_count}</span>
    </td>
    <td className="px-4 py-3">
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={onView}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
          title="View"
        >
          <Eye className="text-theme-text-muted h-4 w-4" />
        </button>
        <button
          onClick={onEdit}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
          title="Edit"
        >
          <Pencil className="text-theme-text-muted h-4 w-4" />
        </button>
        {template.status === FormStatus.DRAFT && (
          <button
            onClick={onPublish}
            className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
            title="Publish"
          >
            <Send className="h-4 w-4 text-green-600" />
          </button>
        )}
        <button
          onClick={onDuplicate}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
          title="Duplicate"
        >
          <Copy className="text-theme-text-muted h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
          title="Archive"
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      </div>
    </td>
  </tr>
);

// ── Main component ─────────────────────────────────────────────

const SkillsTestingTemplatesTab: React.FC = () => {
  const navigate = useNavigate();
  const {
    templates,
    templatesLoading,
    loadTemplates,
    deleteTemplate,
    publishTemplate,
    duplicateTemplate,
    summary,
    summaryLoading,
    loadSummary,
  } = useSkillsTestingStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
    void loadSummary();
  }, [loadTemplates, loadSummary, statusFilter]);

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.category ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePublish = useCallback(
    async (id: string) => {
      if (window.confirm('Publish this template? It will be available for use in tests.')) {
        await publishTemplate(id);
        void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
      }
    },
    [publishTemplate, loadTemplates, statusFilter]
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const newTemplate = await duplicateTemplate(id);
      void navigate(`/training/skills-testing/templates/${newTemplate.id}/edit`);
    },
    [duplicateTemplate, navigate]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (window.confirm('Are you sure you want to archive this template?')) {
        await deleteTemplate(id);
      }
    },
    [deleteTemplate]
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Summary Cards */}
      {!summaryLoading && summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard
            label="Templates"
            value={summary.total_templates}
            icon={<FileText className="h-5 w-5 text-blue-600" />}
            color="bg-blue-100 dark:bg-blue-900/30"
          />
          <SummaryCard
            label="Tests This Month"
            value={summary.tests_this_month}
            icon={<Users className="h-5 w-5 text-purple-600" />}
            color="bg-purple-100 dark:bg-purple-900/30"
          />
          {/* Swapped in when member-run results are waiting: a queue nobody
              clears blocks candidates from getting credit, so it outranks the
              pass rate for attention while it is non-zero. */}
          {summary.pending_validation ? (
            <SummaryCard
              label="Needs Validation"
              value={summary.pending_validation}
              icon={<CheckCircle2 className="h-5 w-5 text-purple-600" />}
              color="bg-purple-100 dark:bg-purple-900/30"
            />
          ) : (
            <SummaryCard
              label="Pass Rate"
              value={`${Math.round(summary.pass_rate ?? 0)}%`}
              icon={<TrendingUp className="h-5 w-5 text-green-600" />}
              color="bg-green-100 dark:bg-green-900/30"
            />
          )}
          <SummaryCard
            label="Avg Score"
            value={`${Math.round(summary.average_score ?? 0)}%`}
            icon={<BarChart3 className="h-5 w-5 text-orange-600" />}
            color="bg-orange-100 dark:bg-orange-900/30"
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search templates..."
            placeholder="Search templates..."
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
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <button
            onClick={() => void navigate('/training/skills-testing/templates/new')}
            className="btn-primary flex items-center gap-2 font-medium"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Template</span>
          </button>
        </div>
      </div>

      {/* Templates Table */}
      {templatesLoading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-red-500" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border py-12 text-center">
          <ClipboardCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">No templates found</p>
          <button
            onClick={() => void navigate('/training/skills-testing/templates/new')}
            className="btn-primary mt-4 text-sm"
          >
            Create Your First Template
          </button>
        </div>
      ) : (
        <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th
                    scope="col"
                    className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Template
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted hidden px-4 py-3 text-left text-xs font-medium tracking-wider uppercase md:table-cell"
                  >
                    Category
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted hidden px-4 py-3 text-center text-xs font-medium tracking-wider uppercase lg:table-cell"
                  >
                    Sections
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted hidden px-4 py-3 text-center text-xs font-medium tracking-wider uppercase lg:table-cell"
                  >
                    Criteria
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {filteredTemplates.map((template) => (
                  <TemplateRow
                    key={template.id}
                    template={template}
                    onEdit={() => void navigate(`/training/skills-testing/templates/${template.id}/edit`)}
                    onView={() => void navigate(`/training/skills-testing/templates/${template.id}`)}
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

export default SkillsTestingTemplatesTab;
