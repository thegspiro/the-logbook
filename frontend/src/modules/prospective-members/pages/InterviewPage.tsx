/**
 * Interview Page
 *
 * Full-page view for conducting interviews with prospective members.
 * Displays applicant information, pipeline progress, and allows
 * interviewers to submit notes, comments, and recommendations.
 * Multiple interviewers can contribute at different stages.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import {
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_RECOMMENDATION_COLORS,
} from '../types';

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
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-theme-text-secondary" />
          <h3 className="text-sm font-semibold text-theme-text-primary">Applicant Information</h3>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-theme-text-tertiary" />
        ) : (
          <ChevronDown className="h-4 w-4 text-theme-text-tertiary" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-theme-surface-border px-4 pb-4 pt-3">
          {/* Avatar and name */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-lg font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {getInitials(applicant.first_name, applicant.last_name)}
            </div>
            <div>
              <p className="text-lg font-semibold text-theme-text-primary">
                {applicant.first_name} {applicant.last_name}
              </p>
              <p className="text-sm text-theme-text-secondary">
                Applied {formatDate(applicant.created_at, timezone)}
              </p>
            </div>
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-theme-text-tertiary" />
              <span className="text-theme-text-primary">{applicant.email}</span>
            </div>
            {applicant.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-theme-text-tertiary" />
                <span className="text-theme-text-primary">{applicant.phone}</span>
              </div>
            )}
            {applicant.date_of_birth && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-theme-text-tertiary" />
                <span className="text-theme-text-primary">
                  DOB: {formatDate(applicant.date_of_birth, timezone)}
                </span>
              </div>
            )}
            {applicant.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-theme-text-tertiary" />
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
            <div className="mt-3 rounded-md bg-theme-bg-secondary p-3">
              <p className="text-xs font-medium text-theme-text-secondary">Applicant Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-theme-text-primary">
                {applicant.notes}
              </p>
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

const PipelineProgressSection: React.FC<PipelineProgressSectionProps> = ({
  applicant,
  timezone,
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-theme-text-secondary" />
          <h3 className="text-sm font-semibold text-theme-text-primary">Pipeline Progress</h3>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-theme-text-tertiary" />
        ) : (
          <ChevronDown className="h-4 w-4 text-theme-text-tertiary" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-theme-surface-border px-4 pb-4 pt-3">
          {applicant.pipeline_name && (
            <p className="mb-2 text-xs text-theme-text-secondary">
              Pipeline: <span className="font-medium">{applicant.pipeline_name}</span>
            </p>
          )}

          {applicant.current_stage_name && (
            <div className="mb-3 rounded-md bg-blue-50 p-2 dark:bg-blue-900/20">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Current Stage</p>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                {applicant.current_stage_name}
              </p>
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
                    <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-theme-text-tertiary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${
                        isCurrent
                          ? 'font-semibold text-blue-700 dark:text-blue-300'
                          : 'text-theme-text-primary'
                      }`}
                    >
                      {entry.stage_name}
                    </p>
                    {entry.completed_at && (
                      <p className="text-xs text-theme-text-tertiary">
                        Completed {formatDateTime(entry.completed_at, timezone)}
                        {entry.completed_by_name ? ` by ${entry.completed_by_name}` : ''}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="mt-0.5 text-xs italic text-theme-text-secondary">
                        {entry.notes}
                      </p>
                    )}
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

const InterviewForm: React.FC<InterviewFormProps> = ({
  applicantId,
  existingInterview,
  onSaved,
  onCancel,
}) => {
  const { createInterview, updateInterview } = useProspectiveMembersStore();
  const [isSaving, setIsSaving] = useState(false);

  const [notes, setNotes] = useState(existingInterview?.notes ?? '');
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | ''>(
    existingInterview?.recommendation ?? ''
  );
  const [recommendationNotes, setRecommendationNotes] = useState(
    existingInterview?.recommendation_notes ?? ''
  );
  const [interviewerRole, setInterviewerRole] = useState(
    existingInterview?.interviewer_role ?? ''
  );

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
          onChange={(e) =>
            setRecommendation(e.target.value as InterviewRecommendation | '')
          }
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
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isEditing ? 'Update Interview' : 'Submit Interview'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-bg-secondary"
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

const InterviewCard: React.FC<InterviewCardProps> = ({
  interview,
  applicantId,
  isOwn,
  timezone,
  onRefresh,
}) => {
  const { deleteInterview } = useProspectiveMembersStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this interview?')) return;
    setIsDeleting(true);
    try {
      await deleteInterview(interview.id);
      toast.success('Interview deleted');
    } catch {
      toast.error('Failed to delete interview');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteInterview, interview.id]);

  if (isEditing) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/10">
        <h4 className="mb-3 text-sm font-semibold text-theme-text-primary">Edit Interview</h4>
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
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-theme-bg-secondary text-xs font-medium text-theme-text-secondary">
            <User className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-theme-text-primary">
              {interview.interviewer_name ?? 'Unknown Interviewer'}
            </p>
            {interview.interviewer_role && (
              <p className="text-xs text-theme-text-secondary">{interview.interviewer_role}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-xs text-theme-text-tertiary">
            {formatDateTime(interview.interview_date ?? interview.created_at, timezone)}
          </p>
          {isOwn && (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="ml-2 rounded p-1 text-theme-text-tertiary hover:bg-theme-bg-secondary hover:text-theme-text-secondary"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="rounded p-1 text-theme-text-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                title="Delete"
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
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
            {INTERVIEW_RECOMMENDATION_LABELS[interview.recommendation] ??
              interview.recommendation}
          </span>
        </div>
      )}

      {/* Notes */}
      {interview.notes && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-theme-text-secondary">Notes</p>
          <p className="whitespace-pre-wrap text-sm text-theme-text-primary">{interview.notes}</p>
        </div>
      )}

      {/* Recommendation details */}
      {interview.recommendation_notes && (
        <div className="rounded-md bg-theme-bg-secondary p-3">
          <p className="mb-1 text-xs font-medium text-theme-text-secondary">
            Recommendation Details
          </p>
          <p className="whitespace-pre-wrap text-sm text-theme-text-primary">
            {interview.recommendation_notes}
          </p>
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
      <div className="flex h-64 items-center justify-center">
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/prospective-members')}
            className="rounded-lg p-2 text-theme-text-secondary hover:bg-theme-bg-secondary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-theme-text-primary">
              Interview: {currentApplicant.first_name} {currentApplicant.last_name}
            </h1>
            <p className="text-sm text-theme-text-secondary">
              Review applicant information and submit interview feedback
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-text-primary">
                <FileText className="h-4 w-4 text-theme-text-secondary" />
                Recommendation Summary
              </h3>
              <div className="space-y-2">
                {Object.entries(recommendationSummary).map(([rec, count]) => (
                  <div key={rec} className="flex items-center justify-between">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        INTERVIEW_RECOMMENDATION_COLORS[
                          rec as InterviewRecommendation
                        ] ?? ''
                      }`}
                    >
                      {INTERVIEW_RECOMMENDATION_LABELS[rec as InterviewRecommendation] ??
                        rec}
                    </span>
                    <span className="text-sm font-semibold text-theme-text-primary">{count}</span>
                  </div>
                ))}
                <div className="mt-2 border-t border-theme-surface-border pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-theme-text-secondary">Total Interviews</span>
                    <span className="font-semibold text-theme-text-primary">
                      {interviews.length}
                    </span>
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
            <div className="rounded-lg border border-blue-200 bg-theme-surface p-4 dark:border-blue-800">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-theme-text-primary">
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
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-text-primary">
              <ClipboardList className="h-4 w-4 text-theme-text-secondary" />
              Interview Records ({interviews.length})
            </h3>

            {isLoadingInterviews ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : interviews.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-theme-surface-border py-12">
                <MessageSquare className="mb-2 h-8 w-8 text-theme-text-tertiary" />
                <p className="text-sm text-theme-text-secondary">No interviews recorded yet</p>
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
