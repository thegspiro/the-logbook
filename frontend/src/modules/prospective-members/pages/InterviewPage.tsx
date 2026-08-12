/**
 * Interview Page
 *
 * Full-page view for conducting interviews with prospective members.
 * Displays applicant information, pipeline progress, and allows
 * interviewers to submit notes, comments, and recommendations.
 * Multiple interviewers can contribute at different stages.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  FileText,
  MessageSquare,
  CheckCircle,
  Circle,
  Clock,
  Loader2,
  Save,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { getInitials } from '../utils';
import type { Interview, InterviewRecommendation, StageHistoryEntry } from '../types';
import { INTERVIEW_RECOMMENDATION_LABELS, INTERVIEW_RECOMMENDATION_COLORS } from '../types';

import { useConfirm } from '../../../contexts/ConfirmContext';
// ---------------------------------------------------------------------------
// Shared Tailwind class constants
// ---------------------------------------------------------------------------

const inputClass = 'form-input';

const labelClass = 'form-label';

const selectClass = 'form-input';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ApplicantInfoSectionProps {
  applicant: NonNullable<ReturnType<typeof useProspectiveMembersStore.getState>['currentApplicant']>;
  timezone: string;
}

const ApplicantInfoSection: React.FC<ApplicantInfoSectionProps> = ({ applicant, timezone }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-theme-surface-border bg-theme-surface rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <User className="text-theme-text-secondary h-4 w-4" />
          <h3 className="text-theme-text-primary text-sm font-semibold">Applicant Information</h3>
        </div>
        {expanded ? (
          <ChevronUp className="text-theme-text-tertiary h-4 w-4" />
        ) : (
          <ChevronDown className="text-theme-text-tertiary h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="border-theme-surface-border border-t px-4 pt-3 pb-4">
          {/* Avatar and name */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-lg font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {getInitials(applicant.first_name, applicant.last_name)}
            </div>
            <div>
              <p className="text-theme-text-primary text-lg font-semibold">
                {applicant.first_name} {applicant.last_name}
              </p>
              <p className="text-theme-text-secondary text-sm">Applied {formatDate(applicant.created_at, timezone)}</p>
            </div>
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="text-theme-text-tertiary h-4 w-4" />
              <span className="text-theme-text-primary">{applicant.email}</span>
            </div>
            {applicant.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="text-theme-text-tertiary h-4 w-4" />
                <span className="text-theme-text-primary">{applicant.phone}</span>
              </div>
            )}
            {applicant.date_of_birth && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="text-theme-text-tertiary h-4 w-4" />
                <span className="text-theme-text-primary">DOB: {formatDate(applicant.date_of_birth, timezone)}</span>
              </div>
            )}
            {applicant.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="text-theme-text-tertiary h-4 w-4" />
                <span className="text-theme-text-primary">
                  {[
                    applicant.address.street,
                    applicant.address.city,
                    applicant.address.state,
                    applicant.address.zip_code,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
            )}
          </div>

          {/* Notes */}
          {applicant.notes && (
            <div className="bg-theme-bg-secondary mt-3 rounded-md p-3">
              <p className="text-theme-text-secondary text-xs font-medium">Applicant Notes</p>
              <p className="text-theme-text-primary mt-1 text-sm whitespace-pre-wrap">{applicant.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pipeline Progress Section
// ---------------------------------------------------------------------------

interface PipelineProgressSectionProps {
  applicant: NonNullable<ReturnType<typeof useProspectiveMembersStore.getState>['currentApplicant']>;
  timezone: string;
}

const PipelineProgressSection: React.FC<PipelineProgressSectionProps> = ({ applicant, timezone }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-theme-surface-border bg-theme-surface rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="text-theme-text-secondary h-4 w-4" />
          <h3 className="text-theme-text-primary text-sm font-semibold">Pipeline Progress</h3>
        </div>
        {expanded ? (
          <ChevronUp className="text-theme-text-tertiary h-4 w-4" />
        ) : (
          <ChevronDown className="text-theme-text-tertiary h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="border-theme-surface-border border-t px-4 pt-3 pb-4">
          {applicant.pipeline_name && (
            <p className="text-theme-text-secondary mb-2 text-xs">
              Pipeline: <span className="font-medium">{applicant.pipeline_name}</span>
            </p>
          )}

          {applicant.current_stage_name && (
            <div className="mb-3 rounded-md bg-blue-50 p-2 dark:bg-blue-900/20">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Current Stage</p>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">{applicant.current_stage_name}</p>
            </div>
          )}

          {/* Stage history timeline */}
          <div className="space-y-2">
            {applicant.stage_history.map((entry: StageHistoryEntry) => {
              const isCompleted = !!entry.completed_at;
              const isCurrent = entry.stage_id === applicant.current_stage_id;

              return (
                <div key={entry.id} className="flex items-start gap-2">
                  {isCompleted ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                  ) : isCurrent ? (
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                  ) : (
                    <Circle className="text-theme-text-tertiary mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${
                        isCurrent ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-theme-text-primary'
                      }`}
                    >
                      {entry.stage_name}
                    </p>
                    {entry.completed_at && (
                      <p className="text-theme-text-tertiary text-xs">
                        Completed {formatDateTime(entry.completed_at, timezone)}
                        {entry.completed_by_name ? ` by ${entry.completed_by_name}` : ''}
                      </p>
                    )}
                    {entry.notes && <p className="text-theme-text-secondary mt-0.5 text-xs italic">{entry.notes}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Interview Form
// ---------------------------------------------------------------------------

interface InterviewFormProps {
  applicantId: string;
  existingInterview?: Interview | undefined;
  onSaved: () => void;
  onCancel?: (() => void) | undefined;
}

const InterviewForm: React.FC<InterviewFormProps> = ({ applicantId, existingInterview, onSaved, onCancel }) => {
  const { createInterview, updateInterview } = useProspectiveMembersStore();
  const [isSaving, setIsSaving] = useState(false);

  const [notes, setNotes] = useState(existingInterview?.notes ?? '');
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | ''>(
    existingInterview?.recommendation ?? ''
  );
  const [recommendationNotes, setRecommendationNotes] = useState(existingInterview?.recommendation_notes ?? '');
  const [interviewerRole, setInterviewerRole] = useState(existingInterview?.interviewer_role ?? '');

  const isEditing = !!existingInterview;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSaving(true);

      try {
        const payload = {
          notes: notes || undefined,
          recommendation: (recommendation as InterviewRecommendation) || undefined,
          recommendation_notes: recommendationNotes || undefined,
          interviewer_role: interviewerRole || undefined,
        };

        if (isEditing) {
          await updateInterview(existingInterview.id, payload);
          toast.success('Interview updated');
        } else {
          await createInterview(applicantId, payload);
          toast.success('Interview submitted');
          // Reset form after creating
          setNotes('');
          setRecommendation('');
          setRecommendationNotes('');
          setInterviewerRole('');
        }
        onSaved();
      } catch {
        toast.error(isEditing ? 'Failed to update interview' : 'Failed to submit interview');
      } finally {
        setIsSaving(false);
      }
    },
    [
      notes,
      recommendation,
      recommendationNotes,
      interviewerRole,
      isEditing,
      existingInterview,
      applicantId,
      createInterview,
      updateInterview,
      onSaved,
    ]
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      {/* Interviewer role */}
      <div>
        <label className={labelClass}>Your Role / Title</label>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          type="text"
          className={inputClass}
          placeholder="e.g., Membership Coordinator, Chief, President"
          value={interviewerRole}
          onChange={(e) => setInterviewerRole(e.target.value)}
        />
      </div>

      {/* Interview notes */}
      <div>
        <label className={labelClass}>Interview Notes & Comments</label>
        <textarea
          className={`${inputClass} min-h-[120px]`}
          placeholder="Record your observations, questions asked, and the applicant's responses..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
        />
      </div>

      {/* Recommendation */}
      <div>
        <label className={labelClass}>Recommendation</label>
        <select
          className={selectClass}
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value as InterviewRecommendation | '')}
        >
          <option value="">Select a recommendation...</option>
          {Object.entries(INTERVIEW_RECOMMENDATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Recommendation notes */}
      {recommendation && (
        <div>
          <label className={labelClass}>Recommendation Details</label>
          <textarea
            className={`${inputClass} min-h-[80px]`}
            placeholder="Provide additional context for your recommendation..."
            value={recommendationNotes}
            onChange={(e) => setRecommendationNotes(e.target.value)}
            rows={3}
          />
        </div>
      )}

      {/* Submit / Cancel */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isEditing ? 'Update Interview' : 'Submit Interview'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-theme-text-secondary hover:bg-theme-bg-secondary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Interview Card
// ---------------------------------------------------------------------------

interface InterviewCardProps {
  interview: Interview;
  applicantId: string;
  isOwn: boolean;
  timezone: string;
  onRefresh: () => void;
}

const InterviewCard: React.FC<InterviewCardProps> = ({ interview, applicantId, isOwn, timezone, onRefresh }) => {
  const { confirm } = useConfirm();
  const { deleteInterview } = useProspectiveMembersStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (
      !(await confirm({
        title: 'Delete interview',
        message: 'The interview and its notes and recommendation are removed for good.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    setIsDeleting(true);
    try {
      await deleteInterview(interview.id);
      toast.success('Interview deleted');
    } catch {
      toast.error('Failed to delete interview');
    } finally {
      setIsDeleting(false);
    }
  }, [confirm, deleteInterview, interview.id]);

  if (isEditing) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/10">
        <h4 className="text-theme-text-primary mb-3 text-sm font-semibold">Edit Interview</h4>
        <InterviewForm
          applicantId={applicantId}
          existingInterview={interview}
          onSaved={() => {
            setIsEditing(false);
            onRefresh();
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-theme-bg-secondary text-theme-text-secondary flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium">
            <User className="h-4 w-4" />
          </div>
          <div>
            <p className="text-theme-text-primary text-sm font-semibold">
              {interview.interviewer_name ?? 'Unknown Interviewer'}
            </p>
            {interview.interviewer_role && (
              <p className="text-theme-text-secondary text-xs">{interview.interviewer_role}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-theme-text-tertiary text-xs">
            {formatDateTime(interview.interview_date ?? interview.created_at, timezone)}
          </p>
          {isOwn && (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-theme-text-tertiary hover:bg-theme-bg-secondary hover:text-theme-text-secondary ml-2 rounded p-1"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="text-theme-text-tertiary rounded p-1 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                title="Delete"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recommendation badge */}
      {interview.recommendation && (
        <div className="mb-3">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
              INTERVIEW_RECOMMENDATION_COLORS[interview.recommendation] ?? ''
            }`}
          >
            {INTERVIEW_RECOMMENDATION_LABELS[interview.recommendation] ?? interview.recommendation}
          </span>
        </div>
      )}

      {/* Notes */}
      {interview.notes && (
        <div className="mb-3">
          <p className="text-theme-text-secondary mb-1 text-xs font-medium">Notes</p>
          <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{interview.notes}</p>
        </div>
      )}

      {/* Recommendation details */}
      {interview.recommendation_notes && (
        <div className="bg-theme-bg-secondary rounded-md p-3">
          <p className="text-theme-text-secondary mb-1 text-xs font-medium">Recommendation Details</p>
          <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{interview.recommendation_notes}</p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main InterviewPage
// ---------------------------------------------------------------------------

export const InterviewPage: React.FC = () => {
  const { applicantId } = useParams<{ applicantId: string }>();
  const navigate = useNavigate();
  const timezone = useTimezone();
  const currentUser = useAuthStore((s) => s.user);

  const {
    currentApplicant,
    isLoadingApplicant,
    interviews,
    isLoadingInterviews,
    fetchApplicant,
    fetchInterviews,
    error,
  } = useProspectiveMembersStore();

  const [showForm, setShowForm] = useState(false);

  // Load applicant and interviews on mount
  useEffect(() => {
    if (!applicantId) return;
    void fetchApplicant(applicantId);
    void fetchInterviews(applicantId);
  }, [applicantId, fetchApplicant, fetchInterviews]);

  const handleRefresh = useCallback(() => {
    if (!applicantId) return;
    void fetchInterviews(applicantId);
  }, [applicantId, fetchInterviews]);

  // Loading state
  if (isLoadingApplicant || !currentApplicant) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Summary of recommendations
  const recommendationSummary = interviews.reduce<Record<string, number>>((acc, interview) => {
    if (interview.recommendation) {
      acc[interview.recommendation] = (acc[interview.recommendation] ?? 0) + 1;
    }
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void navigate('/prospective-members')}
            className="text-theme-text-secondary hover:bg-theme-bg-secondary rounded-lg p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-theme-text-primary text-xl font-bold">
              Interview: {currentApplicant.first_name} {currentApplicant.last_name}
            </h1>
            <p className="text-theme-text-secondary text-sm">
              Review applicant information and submit interview feedback
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:self-auto"
        >
          <MessageSquare className="h-4 w-4" />
          {showForm ? 'Hide Form' : 'New Interview'}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Applicant info + pipeline progress */}
        <div className="space-y-4 lg:col-span-1">
          <ApplicantInfoSection applicant={currentApplicant} timezone={timezone} />
          <PipelineProgressSection applicant={currentApplicant} timezone={timezone} />

          {/* Recommendation summary */}
          {Object.keys(recommendationSummary).length > 0 && (
            <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
              <h3 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileText className="text-theme-text-secondary h-4 w-4" />
                Recommendation Summary
              </h3>
              <div className="space-y-2">
                {Object.entries(recommendationSummary).map(([rec, count]) => (
                  <div key={rec} className="flex items-center justify-between">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        INTERVIEW_RECOMMENDATION_COLORS[rec as InterviewRecommendation] ?? ''
                      }`}
                    >
                      {INTERVIEW_RECOMMENDATION_LABELS[rec as InterviewRecommendation] ?? rec}
                    </span>
                    <span className="text-theme-text-primary text-sm font-semibold">{count}</span>
                  </div>
                ))}
                <div className="border-theme-surface-border mt-2 border-t pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-theme-text-secondary">Total Interviews</span>
                    <span className="text-theme-text-primary font-semibold">{interviews.length}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Interview form + existing interviews */}
        <div className="space-y-4 lg:col-span-2">
          {/* New interview form */}
          {showForm && (
            <div className="bg-theme-surface rounded-lg border border-blue-200 p-4 dark:border-blue-800">
              <h3 className="text-theme-text-primary mb-4 flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-blue-600" />
                Submit Interview Feedback
              </h3>
              <InterviewForm
                applicantId={currentApplicant.id}
                onSaved={() => {
                  handleRefresh();
                  setShowForm(false);
                }}
                onCancel={() => setShowForm(false)}
              />
            </div>
          )}

          {/* Existing interviews */}
          <div>
            <h3 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="text-theme-text-secondary h-4 w-4" />
              Interview Records ({interviews.length})
            </h3>

            {isLoadingInterviews ? (
              <div className="flex h-32 items-center justify-center" role="status" aria-live="polite">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : interviews.length === 0 ? (
              <div className="border-theme-surface-border flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
                <MessageSquare className="text-theme-text-tertiary mb-2 h-8 w-8" />
                <p className="text-theme-text-secondary text-sm">No interviews recorded yet</p>
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Submit the first interview
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {interviews.map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    applicantId={currentApplicant.id}
                    isOwn={currentUser?.id === interview.interviewer_id}
                    timezone={timezone}
                    onRefresh={handleRefresh}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewPage;
