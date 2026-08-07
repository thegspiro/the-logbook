/**
 * Skills Testing - Test Records Tab
 *
 * Renders inside the Training Admin Hub for viewing and managing
 * all skill test records across the organization.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { SkillTestListItem } from '../types/skillsTesting';
import { EmptyState } from '../components/ux';
import { Modal } from '../components/Modal';
import { ClipboardList } from 'lucide-react';

/** Matches the backend's SkillTestVoidRequest minimum — a void stays visible in
 *  the member's history, so the record has to say why it was withdrawn. */
const MIN_VOID_REASON_LENGTH = 10;

// ── Sub-components ─────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    voided: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
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
  onVoid: () => void;
}> = ({ test, onClick, onDelete, onVoid }) => {
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
          {/* Practice attempts were never recorded, so they are simply deleted.
            An official result is an evaluation record the member's
            certification may rest on — it is withdrawn by voiding, which keeps
            the row, its reason, and its author. Already-voided rows offer
            neither action. */}
          {test.is_practice ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              aria-label={`Delete practice attempt for ${test.candidate_name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : test.status !== 'voided' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVoid();
              }}
              className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
              aria-label={`Void test for ${test.candidate_name}`}
            >
              <Ban className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────

const SkillsTestingTestRecordsTab: React.FC = () => {
  const navigate = useNavigate();
  const { tests, testsLoading, loadTests, deleteTest, voidTest, templates, loadTemplates } = useSkillsTestingStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [voidTarget, setVoidTarget] = useState<SkillTestListItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

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
      `Delete the practice attempt for ${test.candidate_name} (${test.template_name})? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteTest(test.id);
      toast.success('Practice attempt deleted');
    } catch {
      toast.error('Failed to delete practice attempt');
    }
  };

  const closeVoidModal = () => {
    setVoidTarget(null);
    setVoidReason('');
  };

  const handleVoid = async () => {
    if (!voidTarget || voidReason.trim().length < MIN_VOID_REASON_LENGTH) return;

    setVoiding(true);
    try {
      await voidTest(voidTarget.id, voidReason.trim());
      toast.success('Test result voided');
      closeVoidModal();
    } catch {
      toast.error('Failed to void test result');
    } finally {
      setVoiding(false);
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
            <option value="voided">Voided</option>
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
              onVoid={() => setVoidTarget(test)}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={voidTarget !== null}
        onClose={closeVoidModal}
        title="Void test result"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={closeVoidModal}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleVoid()}
              disabled={voiding || voidReason.trim().length < MIN_VOID_REASON_LENGTH}
              className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {voiding ? 'Voiding...' : 'Void result'}
            </button>
          </div>
        }
      >
        <div className="modal-body space-y-3">
          <p className="text-theme-text-secondary text-sm">
            Voiding withdraws this result for{' '}
            <span className="text-theme-text-primary font-medium">{voidTarget?.candidate_name}</span> (
            {voidTarget?.template_name}) without deleting it. The record stays in the member&apos;s history marked as
            voided, stops counting toward testing statistics, and releases any training requirement this test completed.
          </p>
          <div>
            <label htmlFor="void-reason" className="form-label">
              Reason for voiding
            </label>
            <textarea
              id="void-reason"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Scored against the wrong candidate"
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Required, at least {MIN_VOID_REASON_LENGTH} characters. The member can see this reason.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SkillsTestingTestRecordsTab;
