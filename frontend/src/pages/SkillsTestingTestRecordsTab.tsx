/**
 * Skills Testing - Test Records Tab
 *
 * Renders inside the Training Admin Hub for viewing and managing
 * all skill test records across the organization.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, CheckCircle2, CircleSlash, Plus, Search, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { SkillTestListItem } from '../types/skillsTesting';
import { EmptyState } from '../components/ux';
import { Modal } from '../components/Modal';
import { getErrorMessage } from '../utils/errorHandling';
import { MIN_VOID_REASON_LENGTH } from '../components/training/SkillTestOfficerActions';
import { ClipboardList } from 'lucide-react';

/** Sentinel for the status dropdown. Not a SkillTestStatus — pending validation
 *  is a property of a *completed* test, so it maps to its own query param. */
const PENDING_FILTER = 'pending_validation';

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
  onCancel: () => void;
  onRelease: () => void;
  onValidate: () => void;
}> = ({ test, onClick, onDelete, onVoid, onCancel, onRelease, onValidate }) => {
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
            {test.pending_validation && (
              <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                Needs validation
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
          {/* Three different ways a test leaves the active list, and they are
            not interchangeable:
              practice  → delete. It was never recorded, so nothing is lost.
              scored    → void. An evaluation record the member's certification
                          may rest on; withdrawing it keeps the row, its reason,
                          and its author.
              unscored  → cancel. Abandoned mid-session, so there is no result
                          to withdraw and nothing to release from the pipeline.
            Already-closed rows (voided/cancelled) offer no action. */}
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
          ) : test.status === 'completed' ? (
            <>
              {/* A member ran this evaluation; nothing counts until an officer
                  accepts it. Offered before release because releasing a result
                  the department has not yet accepted puts the cart first. */}
              {test.pending_validation && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onValidate();
                  }}
                  className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                  aria-label={`Validate result for ${test.candidate_name}`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              )}
              {/* Only meaningful under the on_release mode; the endpoint is
                  idempotent and refuses tests whose results are never shown,
                  so offering it on any unreleased result is safe and saves the
                  officer working out which mode a template uses. */}
              {!test.released_at && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRelease();
                  }}
                  className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20"
                  aria-label={`Release results to ${test.candidate_name}`}
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
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
            </>
          ) : test.status === 'draft' || test.status === 'in_progress' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
              aria-label={`Cancel unfinished test for ${test.candidate_name}`}
            >
              <CircleSlash className="h-4 w-4" />
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
  const {
    tests,
    testsLoading,
    loadTests,
    deleteTest,
    voidTest,
    cancelTest,
    releaseTest,
    validateTest,
    templates,
    loadTemplates,
  } = useSkillsTestingStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [voidTarget, setVoidTarget] = useState<SkillTestListItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // "Needs validation" is a filter over completed tests rather than another
  // status value, so it lives in the same dropdown but maps to its own param.
  const pendingOnly = statusFilter === PENDING_FILTER;

  useEffect(() => {
    if (pendingOnly) {
      void loadTests({ pending_validation: true });
    } else {
      void loadTests(statusFilter ? { status: statusFilter } : undefined);
    }
    void loadTemplates({ status: 'published' });
  }, [loadTests, loadTemplates, statusFilter, pendingOnly]);

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

  const handleCancel = async (test: SkillTestListItem) => {
    // A plain confirm rather than the void modal: cancelling withdraws no
    // result and makes no claim about the candidate, so the reason is optional
    // and there is nothing for a reader to need explained.
    const reason = window.prompt(
      `Cancel the unfinished test for ${test.candidate_name} (${test.template_name})?\n\n` +
        'Any partial results are kept, but the test is closed out. ' +
        'Optionally note why:'
    );
    if (reason === null) return;

    try {
      await cancelTest(test.id, reason);
      toast.success('Test cancelled');
    } catch {
      toast.error('Failed to cancel test');
    }
  };

  const handleValidate = async (test: SkillTestListItem) => {
    const confirmed = window.confirm(
      `Validate ${test.examiner_name}'s evaluation of ${test.candidate_name} (${test.template_name})?\n\n` +
        'The result will count against the candidate’s record: it credits any linked program ' +
        'requirement, uses one of their attempts, and becomes visible to them. ' +
        'To reject it instead, void it with a reason.'
    );
    if (!confirmed) return;

    try {
      await validateTest(test.id);
      toast.success('Result validated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to validate result'));
    }
  };

  const handleRelease = async (test: SkillTestListItem) => {
    try {
      await releaseTest(test.id);
      toast.success(`Results released to ${test.candidate_name}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to release results'));
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
            <option value={PENDING_FILTER}>Needs Validation</option>
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
            title={pendingOnly ? 'Nothing waiting on you' : 'No test records found'}
            description={
              pendingOnly
                ? 'Every official result has been validated. Member-run evaluations show up here when they need your sign-off.'
                : templates.length > 0
                  ? 'No skills tests have been recorded yet. Start one to track member progress.'
                  : 'Add a test template before recording skills tests.'
            }
            actions={
              templates.length > 0 && !pendingOnly
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
              onCancel={() => void handleCancel(test)}
              onRelease={() => void handleRelease(test)}
              onValidate={() => void handleValidate(test)}
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
