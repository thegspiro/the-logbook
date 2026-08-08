/**
 * My Skill Test Result Page
 *
 * A member's read-only view of a skills test they were the candidate in.
 *
 * The examiner-facing ActiveSkillTestPage is gated on training.manage, so
 * before this page existed a candidate could only see how they did by looking
 * over the examiner's shoulder — the results lived on the examiner's device.
 * This renders the same scorecard from the candidate's own account, for both
 * official results and practice attempts.
 *
 * Practice attempts are the member's to clear: they were never recorded, so
 * this page offers a delete. Official results are never deletable here — an
 * evaluation record is withdrawn by an officer voiding it, which keeps the row.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Timer,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { ReadOnlySectionView } from './ActiveSkillTestPage';
import { hydrateTemplateSections } from '../utils/skillTemplateSections';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';
import { SkeletonPage } from '../components/ux/Skeleton';
import { EmptyState } from '../components/ux/EmptyState';

export const MySkillTestResultPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { testId } = useParams<{ testId: string }>();
  const { user } = useAuthStore();
  const { currentTest, testLoading, loadTest, clearCurrentTest, discardPracticeTest } = useSkillsTestingStore();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (testId) {
      void loadTest(testId);
    }
    return () => clearCurrentTest();
  }, [testId, loadTest, clearCurrentTest]);

  const handleDeletePractice = useCallback(async () => {
    if (!currentTest) return;
    setDeleting(true);
    try {
      await discardPracticeTest(currentTest.id);
      toast.success('Practice attempt deleted');
      void navigate('/training/my-training');
    } catch {
      toast.error('Failed to delete practice attempt');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [currentTest, discardPracticeTest, navigate]);

  if (testLoading || !currentTest) {
    return testLoading ? (
      <SkeletonPage />
    ) : (
      <EmptyState
        icon={ClipboardCheck}
        title="Result not available"
        description="This skills test either doesn't exist or isn't one of yours."
        actions={[{ label: 'Back to My Training', onClick: () => void navigate('/training/my-training') }]}
      />
    );
  }

  const templateSections = hydrateTemplateSections(
    currentTest.template_sections as Record<string, unknown>[] | undefined
  );
  const isPractice = currentTest.is_practice;
  const isVoided = currentTest.status === 'voided';
  const isComplete = currentTest.status === 'completed' || isVoided;
  // The candidate may clear their own practice attempts. An official result is
  // an evaluation record — withdrawing one is an officer's void, never a delete.
  const canDelete = isPractice && currentTest.candidate_id === user?.id;

  return (
    <div className="space-y-4">
      <button
        onClick={() => void navigate('/training/my-training')}
        className="hover:bg-theme-surface-hover -ml-2 flex items-center gap-1 rounded-lg p-2 text-sm transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to My Training
      </button>

      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">{currentTest.template_name}</h1>
        <p className="text-theme-text-muted text-sm">{isPractice ? 'Practice attempt' : 'Official skills test'}</p>
      </div>

      {isPractice && (
        <div className="alert-info">
          <p className="text-sm font-medium">
            Practice attempt — not recorded against you and not part of your official training history. Kept for your
            review, and deleted automatically after a year.
          </p>
        </div>
      )}

      {isVoided && (
        <div className="alert-warning">
          <p className="text-sm font-medium">This result was voided and no longer counts.</p>
          {currentTest.void_reason && <p className="mt-1 text-sm">Reason: {currentTest.void_reason}</p>}
          {currentTest.voided_by_name && currentTest.voided_at && (
            <p className="mt-1 text-xs">
              Voided by {currentTest.voided_by_name} on {formatDateTime(currentTest.voided_at, tz)}
            </p>
          )}
        </div>
      )}

      {isComplete ? (
        <div
          className={`flex items-center gap-3 rounded-xl p-4 ${
            isVoided
              ? 'bg-theme-surface border-theme-surface-border border'
              : currentTest.result === 'pass'
                ? 'border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                : 'border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
          }`}
        >
          {currentTest.result === 'pass' ? (
            <CheckCircle2 className="h-10 w-10 shrink-0 text-green-500" />
          ) : (
            <XCircle className="h-10 w-10 shrink-0 text-red-500" />
          )}
          <div className="flex-1">
            <p
              className={`text-lg font-bold ${
                isVoided
                  ? 'text-theme-text-muted line-through'
                  : currentTest.result === 'pass'
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-red-700 dark:text-red-300'
              }`}
            >
              {currentTest.result === 'pass' ? 'Passed' : 'Failed'}
            </p>
            {currentTest.overall_score != null && (
              <p className="text-theme-text-secondary text-sm font-medium">
                Overall score: {Math.round(currentTest.overall_score)}%
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="alert-info">
          <p className="text-sm font-medium">
            This test is still in progress. Results appear once your examiner finishes scoring it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card">
          <div className="mb-1 flex items-center gap-1.5">
            <User className="text-theme-text-muted h-3 w-3" />
            <p className="text-theme-text-muted text-xs">Candidate</p>
          </div>
          <p className="text-theme-text-primary text-sm font-medium">{currentTest.candidate_name}</p>
        </div>
        <div className="card">
          <div className="mb-1 flex items-center gap-1.5">
            <ClipboardCheck className="text-theme-text-muted h-3 w-3" />
            <p className="text-theme-text-muted text-xs">Examiner</p>
          </div>
          <p className="text-theme-text-primary text-sm font-medium">{currentTest.examiner_name}</p>
        </div>
        {currentTest.elapsed_seconds != null && (
          <div className="card">
            <div className="mb-1 flex items-center gap-1.5">
              <Timer className="text-theme-text-muted h-3 w-3" />
              <p className="text-theme-text-muted text-xs">Total time</p>
            </div>
            <p className="text-theme-text-primary font-mono text-sm font-medium">
              {Math.floor(currentTest.elapsed_seconds / 60)}:{String(currentTest.elapsed_seconds % 60).padStart(2, '0')}
            </p>
          </div>
        )}
        {currentTest.completed_at && (
          <div className="card">
            <div className="mb-1 flex items-center gap-1.5">
              <Calendar className="text-theme-text-muted h-3 w-3" />
              <p className="text-theme-text-muted text-xs">Completed</p>
            </div>
            <p className="text-theme-text-primary text-sm font-medium">
              {formatDateTime(currentTest.completed_at, tz)}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {templateSections.map((section) => (
          <ReadOnlySectionView
            key={section.id}
            section={section}
            sectionResult={currentTest.section_results?.find(
              (sr) => sr.section_id === section.id || sr.section_name === section.name
            )}
          />
        ))}
      </div>

      {currentTest.notes && (
        <div className="card">
          <p className="text-theme-text-muted mb-2 flex items-center gap-1.5 text-xs font-medium">
            <FileText className="h-3 w-3" />
            Examiner notes
          </p>
          <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{currentTest.notes}</p>
        </div>
      )}

      {canDelete && (
        <div className="pt-2">
          <button
            onClick={() => setConfirmingDelete(true)}
            className="bg-theme-surface border-theme-surface-border text-theme-text-muted mobile-touch-target flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 font-medium transition-colors hover:border-red-500 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Delete this practice attempt
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingDelete}
        title="Delete practice attempt?"
        message="This permanently deletes the attempt and its notes. It was never part of your official record, so nothing else changes."
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDeletePractice()}
        onClose={() => setConfirmingDelete(false)}
      />
    </div>
  );
};

export default MySkillTestResultPage;
