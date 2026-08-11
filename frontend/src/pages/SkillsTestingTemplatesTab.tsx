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
  Printer,
  Trash2,
  Eye,
  Send,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import type { SkillTemplateListItem } from '../types/skillsTesting';
import { FormStatus } from '../constants/enums';
import { ConfirmDialog } from '../components/ux';
import { SkillSheetLibraryModal } from '../components/training/SkillSheetLibraryModal';

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
  /** Makes the tile the way into the work it counts. Only some are actionable —
   *  a pass rate is a fact, a queue is a job. */
  onClick?: () => void;
}> = ({ label, value, icon, color, onClick }) => {
  const body = (
    <div className="flex items-center justify-between">
      <div className="text-left">
        <p className="text-theme-text-muted text-sm">{label}</p>
        <p className="text-theme-text-primary mt-1 text-2xl font-bold">{value}</p>
      </div>
      <div className={`rounded-lg p-3 ${color}`}>{icon}</div>
    </div>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="bg-theme-surface border-theme-surface-border w-full rounded-lg border p-4 transition-colors hover:border-purple-500/60"
      >
        {body}
      </button>
    );
  }

  return <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">{body}</div>;
};

const TemplateRow: React.FC<{
  template: SkillTemplateListItem;
  onEdit: () => void;
  onView: () => void;
  onPublish: () => void;
  onDuplicate: () => void;
  onPrint: () => void;
  onDelete: () => void;
}> = ({ template, onEdit, onView, onPublish, onDuplicate, onPrint, onDelete }) => (
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
        {/* The paper fallback for a burn tower or apparatus bay with no signal.
            Offered on drafts too — an author proofreads a sheet far more
            easily on the printed form than in the builder. */}
        <button
          onClick={onPrint}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
          title="Print blank sheet"
        >
          <Printer className="text-theme-text-muted h-4 w-4" />
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
  // Held as the whole row, not just an id, so the confirmation can name the
  // template the officer is about to publish or archive. A bare "this template"
  // is no help on a screen listing a dozen of them.
  const [publishTarget, setPublishTarget] = useState<SkillTemplateListItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SkillTemplateListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
    void loadSummary();
  }, [loadTemplates, loadSummary, statusFilter]);

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.category ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePublish = useCallback(async () => {
    if (!publishTarget) return;
    setBusy(true);
    try {
      await publishTemplate(publishTarget.id);
      setPublishTarget(null);
      void loadTemplates(statusFilter ? { status: statusFilter } : undefined);
    } finally {
      setBusy(false);
    }
  }, [publishTarget, publishTemplate, loadTemplates, statusFilter]);

  const handleDuplicate = useCallback(
    async (id: string) => {
      const newTemplate = await duplicateTemplate(id);
      void navigate(`/training/skills-testing/templates/${newTemplate.id}/edit`);
    },
    [duplicateTemplate, navigate]
  );

  const handleArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await deleteTemplate(archiveTarget.id);
      setArchiveTarget(null);
    } finally {
      setBusy(false);
    }
  }, [archiveTarget, deleteTemplate]);

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
              // The tile counted the queue without being a way into it, so an
              // officer read "3" and then had to find the right tab and set a
              // dropdown to see which three.
              onClick={() => void navigate('/training/admin?page=skills-testing&tab=tests&status=pending_validation')}
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
            onClick={() => setLibraryOpen(true)}
            className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Add from library</span>
          </button>
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
          {/* Where a new department actually lands, so the library is offered
              first: copying a ready-made NREMT sheet is a shorter path to a
              first evaluation than authoring one from a blank form. */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button onClick={() => setLibraryOpen(true)} className="btn-primary text-sm">
              Browse the sheet library
            </button>
            <button
              onClick={() => void navigate('/training/skills-testing/templates/new')}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Start from scratch
            </button>
          </div>
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
                    onPublish={() => setPublishTarget(template)}
                    onDuplicate={() => void handleDuplicate(template.id)}
                    // A new tab: the print view calls window.print() on load,
                    // and navigating the current tab would drop an officer out
                    // of the templates list to get back to a print dialog.
                    onPrint={() =>
                      window.open(
                        `/training/skills-testing/print/template?id=${encodeURIComponent(template.id)}`,
                        '_blank',
                        'noopener'
                      )
                    }
                    onDelete={() => setArchiveTarget(template)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SkillSheetLibraryModal
        isOpen={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onImported={() => {
          // Imported sheets land as drafts, so reloading the filter the user
          // already had would show nothing new under Published or Archived and
          // read as a failed import. Move the view to what the import actually
          // produced — which is also where the next step is, since a draft has
          // to be reviewed and published before anyone can test against it.
          setStatusFilter('draft');
          // Explicitly, not via the statusFilter effect: setting state to the
          // value it already holds re-renders nothing, so an import made while
          // already filtered to Draft would not refresh.
          void loadTemplates({ status: 'draft' });
          void loadSummary();
        }}
      />

      <ConfirmDialog
        isOpen={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        onConfirm={() => void handlePublish()}
        title="Publish this template?"
        message={`"${publishTarget?.name ?? ''}" becomes available to start tests from. Each test keeps a copy of the template it was taken against, so later edits never re-score a test already run.`}
        cancelLabel="Not yet"
        confirmLabel="Publish"
        variant="info"
        loading={busy}
      />

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
        title="Archive this template?"
        message={`"${archiveTarget?.name ?? ''}" stops appearing when starting a new test. It is not deleted — tests already taken against it keep their scorecards, and you can still find it under the Archived filter.`}
        cancelLabel="Keep it"
        confirmLabel="Archive"
        variant="warning"
        loading={busy}
      />
    </div>
  );
};

export default SkillsTestingTemplatesTab;
