import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  FileText,
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  MapPin,
  Award,
  Settings,
  Save,
  AlertCircle,
  Filter,
  Info,
  Edit2,
} from 'lucide-react';
import { trainingSubmissionService, trainingService, trainingProgramService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { SubmissionStatus, TRAINING_TYPE_LABELS } from '../constants/enums';
import { EmptyState } from '../components/ux';
import type {
  TrainingSubmission,
  SelfReportConfig,
  SelfReportConfigUpdate,
  SubmissionReviewRequest,
  TrainingType,
  TrainingRecordUpdate,
  FieldConfig,
  ProgramEnrollment,
  RequirementProgressRecord,
} from '../types/training';

// ==================== Helpers ====================

const STATUS_CONFIG: Record<SubmissionStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'bg-theme-surface-secondary text-theme-text-secondary', icon: FileText },
  pending_review: {
    label: 'Pending Review',
    color: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
    icon: Clock,
  },
  approved: {
    label: 'Approved',
    color: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    icon: XCircle,
  },
  revision_requested: {
    label: 'Revision Requested',
    color: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    icon: RotateCcw,
  },
};

const StatusBadge: React.FC<{ status: SubmissionStatus }> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center space-x-1 rounded-sm px-2 py-0.5 text-xs ${config.color}`}>
      <Icon className="h-3 w-3" />
      <span>{config.label}</span>
    </span>
  );
};

// ==================== Apply-to-pipeline picker ====================

// Lets the officer credit the approved training toward a requirement in one of
// the member's active enrollments — e.g. a make-up session with no scheduled
// date. Emits the chosen program + requirement to the parent.
const ApplyToPipelinePicker: React.FC<{
  userId: string;
  onChange: (programId?: string, requirementId?: string) => void;
  alwaysOpen?: boolean;
}> = ({ userId, onChange, alwaysOpen = false }) => {
  const [enabled, setEnabled] = useState(alwaysOpen);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [programNames, setProgramNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [requirements, setRequirements] = useState<RequirementProgressRecord[]>([]);
  const [requirementId, setRequirementId] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [enrs, programs] = await Promise.all([
          trainingProgramService.getUserEnrollments(userId, 'active'),
          trainingProgramService.getPrograms(),
        ]);
        if (cancelled) return;
        setEnrollments(enrs);
        setProgramNames(Object.fromEntries(programs.map((p) => [p.id, p.name])));
      } catch {
        if (!cancelled) setEnrollments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  const selectEnrollment = (id: string) => {
    setEnrollmentId(id);
    setRequirementId('');
    onChange(undefined, undefined);
    if (!id) {
      setRequirements([]);
      return;
    }
    void (async () => {
      try {
        const progress = await trainingProgramService.getEnrollmentProgress(id);
        setRequirements(progress.requirement_progress);
      } catch {
        setRequirements([]);
      }
    })();
  };

  const selectRequirement = (reqId: string) => {
    setRequirementId(reqId);
    const enrollment = enrollments.find((e) => e.id === enrollmentId);
    onChange(enrollment && reqId ? enrollment.program_id : undefined, reqId || undefined);
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) {
      setEnrollmentId('');
      setRequirementId('');
      onChange(undefined, undefined);
    }
  };

  return (
    <div className="mb-3">
      {!alwaysOpen && (
        <label className="text-theme-text-secondary inline-flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          <span>Apply this training toward a pipeline requirement</span>
        </label>
      )}
      {enabled && (
        <div className="border-theme-surface-border mt-2 space-y-2 rounded-lg border p-3">
          {loading ? (
            <p className="text-theme-text-muted text-xs">Loading the member&apos;s programs…</p>
          ) : enrollments.length === 0 ? (
            <p className="text-theme-text-muted text-xs">
              This member isn&apos;t enrolled in any active training program.
            </p>
          ) : (
            <>
              <div>
                <label className="text-theme-text-muted text-xs">Program</label>
                <select
                  value={enrollmentId}
                  onChange={(e) => selectEnrollment(e.target.value)}
                  className="form-input-sm"
                >
                  <option value="">Select a program…</option>
                  {enrollments.map((enr) => (
                    <option key={enr.id} value={enr.id}>
                      {programNames[enr.program_id] ?? 'Program'}
                    </option>
                  ))}
                </select>
              </div>
              {enrollmentId && (
                <div>
                  <label className="text-theme-text-muted text-xs">Requirement</label>
                  <select
                    value={requirementId}
                    onChange={(e) => selectRequirement(e.target.value)}
                    className="form-input-sm"
                  >
                    <option value="">Select a requirement…</option>
                    {requirements.map((rp) => (
                      <option key={rp.id} value={rp.requirement_id}>
                        {rp.requirement?.name ?? 'Requirement'}
                      </option>
                    ))}
                  </select>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Hours requirements gain the approved hours; a course counts as one completion; other types are
                    marked complete.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Retroactively apply an already-approved submission's record toward a pipeline
// requirement (e.g. training approved before the member enrolled, or approved
// automatically). Reuses the picker; commits via the record apply endpoint.
const ApplyRecordToPipelinePanel: React.FC<{
  recordId: string;
  userId: string;
}> = ({ recordId, userId }) => {
  const [programId, setProgramId] = useState<string | undefined>();
  const [requirementId, setRequirementId] = useState<string | undefined>();
  const [applying, setApplying] = useState(false);

  const handleChange = useCallback((p?: string, r?: string) => {
    setProgramId(p);
    setRequirementId(r);
  }, []);

  const apply = async () => {
    if (!programId || !requirementId) return;
    setApplying(true);
    try {
      await trainingProgramService.applyTrainingRecord(recordId, programId, requirementId);
      toast.success('Applied to the pipeline requirement');
      setProgramId(undefined);
      setRequirementId(undefined);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to apply to the requirement'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="border-theme-surface-border mt-4 border-t pt-4">
      <h4 className="text-theme-text-primary mb-2 text-sm font-semibold">Apply to a training pipeline</h4>
      <ApplyToPipelinePicker userId={userId} onChange={handleChange} alwaysOpen />
      <button
        onClick={() => {
          void apply();
        }}
        disabled={applying || !programId || !requirementId}
        className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {applying ? 'Applying…' : 'Apply to requirement'}
      </button>
    </div>
  );
};

// ==================== Review Panel ====================

const ReviewPanel: React.FC<{
  submission: TrainingSubmission;
  onReview: (id: string, review: SubmissionReviewRequest) => Promise<void>;
}> = ({ submission, onReview }) => {
  const [action, setAction] = useState<'approve' | 'reject' | 'revision_requested'>('approve');
  const [notes, setNotes] = useState('');
  const [overrideHours, setOverrideHours] = useState<number | undefined>();
  const [overrideCreditHours, _setOverrideCreditHours] = useState<number | undefined>();
  const [overrideType, setOverrideType] = useState<TrainingType | undefined>();
  const [showOverrides, setShowOverrides] = useState(false);
  const [applyProgramId, setApplyProgramId] = useState<string | undefined>();
  const [applyRequirementId, setApplyRequirementId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const handleApplyTarget = useCallback((programId?: string, requirementId?: string) => {
    setApplyProgramId(programId);
    setApplyRequirementId(requirementId);
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onReview(submission.id, {
        action,
        ...(notes ? { reviewer_notes: notes } : {}),
        override_hours: overrideHours,
        override_credit_hours: overrideHours || overrideCreditHours,
        override_training_type: overrideType,
        ...(action === 'approve' && applyProgramId && applyRequirementId
          ? { apply_to_program_id: applyProgramId, apply_to_requirement_id: applyRequirementId }
          : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-theme-surface-border mt-4 border-t pt-4">
      {/* Action Buttons */}
      <div className="mb-3 flex items-center space-x-2">
        <button
          onClick={() => setAction('approve')}
          className={`flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            action === 'approve'
              ? 'bg-green-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>Approve</span>
        </button>
        <button
          onClick={() => setAction(SubmissionStatus.REVISION_REQUESTED)}
          className={`flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            action === SubmissionStatus.REVISION_REQUESTED
              ? 'bg-orange-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <RotateCcw className="h-4 w-4" />
          <span>Request Revision</span>
        </button>
        <button
          onClick={() => setAction('reject')}
          className={`flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            action === 'reject'
              ? 'bg-red-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <XCircle className="h-4 w-4" />
          <span>Reject</span>
        </button>
      </div>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder={
          action === 'approve'
            ? 'Optional notes for the member...'
            : 'Explain why (required for rejection or revision request)...'
        }
        className="form-input mb-3 text-sm"
        required={action !== 'approve'}
      />

      {/* Overrides (approval only) */}
      {action === 'approve' && (
        <div className="mb-3">
          <button
            onClick={() => setShowOverrides(!showOverrides)}
            className="text-theme-text-muted hover:text-theme-text-primary flex items-center space-x-1 text-xs"
          >
            <Settings className="h-3 w-3" />
            <span>Override values before approving</span>
            {showOverrides ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showOverrides && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-muted text-xs">Hours</label>
                <input
                  type="number"
                  value={overrideHours ?? ''}
                  onChange={(e) => setOverrideHours(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder={String(submission.hours_completed)}
                  className="form-input-sm"
                  min={0}
                  step={0.5}
                />
              </div>
              <div>
                <label className="text-theme-text-muted text-xs">Training Type</label>
                <select
                  value={overrideType || ''}
                  onChange={(e) => setOverrideType((e.target.value as TrainingType) || undefined)}
                  className="form-input-sm"
                >
                  <option value="">No change</option>
                  {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Apply to a pipeline requirement (approval only) */}
      {action === 'approve' && <ApplyToPipelinePicker userId={submission.submitted_by} onChange={handleApplyTarget} />}

      {/* Submit */}
      <button
        onClick={() => {
          void handleSubmit();
        }}
        disabled={submitting || (action !== 'approve' && !notes.trim())}
        className="btn-primary w-full text-sm font-medium disabled:cursor-not-allowed"
      >
        {submitting
          ? 'Processing...'
          : `Confirm ${action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : 'Revision Request'}`}
      </button>
    </div>
  );
};

// ==================== Edit Record Panel ====================

const EditRecordPanel: React.FC<{
  recordId: string;
  submission: TrainingSubmission;
  onSaved: () => void;
}> = ({ recordId, submission, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    course_name: submission.course_name,
    training_type: submission.training_type,
    hours_completed: submission.hours_completed,
    completion_date: submission.completion_date,
    certification_number: submission.certification_number || '',
    issuing_agency: submission.issuing_agency || '',
    expiration_date: submission.expiration_date || '',
    instructor: submission.instructor || '',
    location: submission.location || '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: TrainingRecordUpdate = {};
      if (fields.course_name !== submission.course_name) updates.course_name = fields.course_name;
      if (fields.training_type !== submission.training_type) updates.training_type = fields.training_type;
      if (fields.hours_completed !== submission.hours_completed) {
        updates.hours_completed = fields.hours_completed;
        updates.credit_hours = fields.hours_completed;
      }
      if (fields.completion_date !== submission.completion_date) updates.completion_date = fields.completion_date;
      if (fields.certification_number !== (submission.certification_number || ''))
        updates.certification_number = fields.certification_number || undefined;
      if (fields.issuing_agency !== (submission.issuing_agency || ''))
        updates.issuing_agency = fields.issuing_agency || undefined;
      if (fields.expiration_date !== (submission.expiration_date || ''))
        updates.expiration_date = fields.expiration_date || undefined;
      if (fields.instructor !== (submission.instructor || '')) updates.instructor = fields.instructor || undefined;
      if (fields.location !== (submission.location || '')) updates.location = fields.location || undefined;

      if (Object.keys(updates).length === 0) {
        setEditing(false);
        return;
      }

      await trainingService.updateRecord(recordId, updates);
      toast.success('Training record updated');
      setEditing(false);
      onSaved();
    } catch {
      toast.error('Failed to update training record');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="border-theme-surface-border mt-4 border-t pt-3">
        <button
          onClick={() => setEditing(true)}
          className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-2 rounded-lg px-3 py-1.5 text-sm transition-colors"
        >
          <Edit2 className="h-4 w-4" />
          <span>Edit Training Record</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-theme-surface-border mt-4 border-t pt-4">
      <h4 className="text-theme-text-primary mb-3 flex items-center space-x-2 text-sm font-medium">
        <Edit2 className="h-4 w-4" />
        <span>Edit Training Record</span>
      </h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-theme-text-muted text-xs">Course Name</label>
          <input
            type="text"
            value={fields.course_name}
            onChange={(e) => setFields({ ...fields, course_name: e.target.value })}
            className="form-input-sm"
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Training Type</label>
          <select
            value={fields.training_type}
            onChange={(e) => setFields({ ...fields, training_type: e.target.value as TrainingType })}
            className="form-input-sm"
          >
            {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Hours Completed</label>
          <input
            type="number"
            value={fields.hours_completed}
            onChange={(e) => setFields({ ...fields, hours_completed: parseFloat(e.target.value) || 0 })}
            className="form-input-sm"
            min={0}
            step={0.5}
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Completion Date</label>
          <input
            type="date"
            value={fields.completion_date}
            onChange={(e) => setFields({ ...fields, completion_date: e.target.value })}
            className="form-input-sm"
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Certification Number</label>
          <input
            type="text"
            value={fields.certification_number}
            onChange={(e) => setFields({ ...fields, certification_number: e.target.value })}
            className="form-input-sm"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Issuing Agency</label>
          <input
            type="text"
            value={fields.issuing_agency}
            onChange={(e) => setFields({ ...fields, issuing_agency: e.target.value })}
            className="form-input-sm"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Expiration Date</label>
          <input
            type="date"
            value={fields.expiration_date}
            onChange={(e) => setFields({ ...fields, expiration_date: e.target.value })}
            className="form-input-sm"
          />
        </div>
        <div>
          <label className="text-theme-text-muted text-xs">Instructor</label>
          <input
            type="text"
            value={fields.instructor}
            onChange={(e) => setFields({ ...fields, instructor: e.target.value })}
            className="form-input-sm"
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center space-x-2">
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
          className="btn-success flex items-center space-x-1 px-3 py-1.5 text-sm font-medium"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Saving...' : 'Save Changes'}</span>
        </button>
        <button
          onClick={() => setEditing(false)}
          className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ==================== Submission Card ====================

const SubmissionCard: React.FC<{
  submission: TrainingSubmission;
  onReview: (id: string, review: SubmissionReviewRequest) => Promise<void>;
  onRecordUpdated: () => void;
}> = ({ submission, onReview, onRecordUpdated }) => {
  const [expanded, setExpanded] = useState(false);
  const tz = useTimezone();
  const isPending = submission.status === SubmissionStatus.PENDING_REVIEW;
  const isApproved = submission.status === SubmissionStatus.APPROVED && !!submission.training_record_id;

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-theme-surface-hover w-full p-4 text-left transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-1 flex items-center space-x-2">
              <h3 className="text-theme-text-primary font-medium">{submission.course_name}</h3>
              <StatusBadge status={submission.status} />
            </div>
            <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center space-x-1">
                <User className="h-3 w-3" />
                <span>{submission.submitted_by}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Calendar className="h-3 w-3" />
                <span>{submission.completion_date}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Clock className="h-3 w-3" />
                <span>{submission.hours_completed}h</span>
              </span>
              <span className="rounded-sm bg-blue-500/20 px-1.5 py-0.5 text-xs text-blue-700 dark:text-blue-400">
                {TRAINING_TYPE_LABELS[submission.training_type] || submission.training_type}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="text-theme-text-muted ml-2 h-5 w-5 shrink-0" />
          ) : (
            <ChevronDown className="text-theme-text-muted ml-2 h-5 w-5 shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4">
          <div className="border-theme-surface-border border-t pt-3">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              {submission.course_code && (
                <div>
                  <span className="text-theme-text-muted">Course Code: </span>
                  <span className="text-theme-text-secondary">{submission.course_code}</span>
                </div>
              )}
              {submission.instructor && (
                <div className="flex items-center space-x-1">
                  <User className="text-theme-text-muted h-3 w-3" />
                  <span className="text-theme-text-muted">Instructor: </span>
                  <span className="text-theme-text-secondary">{submission.instructor}</span>
                </div>
              )}
              {submission.location && (
                <div className="flex items-center space-x-1">
                  <MapPin className="text-theme-text-muted h-3 w-3" />
                  <span className="text-theme-text-muted">Location: </span>
                  <span className="text-theme-text-secondary">{submission.location}</span>
                </div>
              )}
              {submission.certification_number && (
                <div className="flex items-center space-x-1">
                  <Award className="text-theme-text-muted h-3 w-3" />
                  <span className="text-theme-text-muted">Cert #: </span>
                  <span className="text-theme-text-secondary">{submission.certification_number}</span>
                </div>
              )}
              {submission.issuing_agency && (
                <div>
                  <span className="text-theme-text-muted">Issuing Agency: </span>
                  <span className="text-theme-text-secondary">{submission.issuing_agency}</span>
                </div>
              )}
              {submission.expiration_date && (
                <div>
                  <span className="text-theme-text-muted">Expires: </span>
                  <span className="text-theme-text-secondary">{submission.expiration_date}</span>
                </div>
              )}
              <div>
                <span className="text-theme-text-muted">Submitted: </span>
                <span className="text-theme-text-secondary">{formatDate(submission.submitted_at, tz)}</span>
              </div>
            </div>
            {submission.description && (
              <div className="mt-3">
                <span className="text-theme-text-muted text-sm">Description: </span>
                <p className="text-theme-text-secondary mt-1 text-sm">{submission.description}</p>
              </div>
            )}
            {submission.reviewer_notes && (
              <div className="bg-theme-surface-secondary mt-3 rounded-sm p-2">
                <span className="text-theme-text-muted text-xs">Previous reviewer notes: </span>
                <p className="text-theme-text-secondary text-sm">{submission.reviewer_notes}</p>
              </div>
            )}
          </div>

          {/* Review Panel */}
          {isPending && <ReviewPanel submission={submission} onReview={onReview} />}

          {/* Edit Record Panel (approved submissions only) */}
          {isApproved && (
            <EditRecordPanel
              recordId={submission.training_record_id ?? ''}
              submission={submission}
              onSaved={onRecordUpdated}
            />
          )}

          {/* Retroactively apply an approved submission toward a pipeline */}
          {isApproved && submission.training_record_id && (
            <ApplyRecordToPipelinePanel recordId={submission.training_record_id} userId={submission.submitted_by} />
          )}
        </div>
      )}
    </div>
  );
};

// ==================== Config Editor ====================

const DEFAULT_FIELD_CONFIG: Record<string, FieldConfig> = {
  course_name: { visible: true, required: true, label: 'Course / Class Name' },
  training_type: { visible: true, required: true, label: 'Training Type' },
  completion_date: { visible: true, required: true, label: 'Date Completed' },
  hours_completed: { visible: true, required: true, label: 'Hours Completed' },
  course_code: { visible: true, required: false, label: 'Course Code' },
  description: { visible: true, required: false, label: 'Description / Notes' },
  instructor: { visible: true, required: false, label: 'Instructor Name' },
  location: { visible: true, required: false, label: 'Location / Facility' },
  category_id: { visible: true, required: false, label: 'Training Category' },
  certification_number: { visible: true, required: false, label: 'Certificate / ID Number' },
  issuing_agency: { visible: true, required: false, label: 'Issuing Agency' },
  expiration_date: { visible: true, required: false, label: 'Expiration Date' },
};

const ConfigEditor: React.FC<{
  config: SelfReportConfig;
  onSave: (updates: SelfReportConfigUpdate) => Promise<void>;
}> = ({ config, onSave }) => {
  const [requireApproval, setRequireApproval] = useState(config.require_approval);
  const [autoApproveHours, setAutoApproveHours] = useState<number | undefined>(
    config.auto_approve_under_hours ?? undefined
  );
  const [deadlineDays, setDeadlineDays] = useState(config.approval_deadline_days);
  const [notifyOfficer, setNotifyOfficer] = useState(config.notify_officer_on_submit);
  const [notifyMember, setNotifyMember] = useState(config.notify_member_on_decision);
  const [maxHours, setMaxHours] = useState<number | undefined>(config.max_hours_per_submission ?? undefined);
  const [instructions, setInstructions] = useState(config.member_instructions || '');
  const [fieldConfig, setFieldConfig] = useState<Record<string, FieldConfig>>(() => {
    // Merge defaults with existing config
    const merged = { ...DEFAULT_FIELD_CONFIG };
    if (config.field_config) {
      Object.entries(config.field_config).forEach(([key, val]) => {
        merged[key] = { ...merged[key], ...val };
      });
    }
    return merged;
  });
  const [saving, setSaving] = useState(false);

  const updateField = (fieldName: string, prop: keyof FieldConfig, value: boolean | string) => {
    setFieldConfig((prev) => ({
      ...prev,
      [fieldName]: { ...(prev[fieldName] ?? { visible: true, required: false, label: '' }), [prop]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        require_approval: requireApproval,
        auto_approve_under_hours: autoApproveHours ?? null,
        approval_deadline_days: deadlineDays,
        notify_officer_on_submit: notifyOfficer,
        notify_member_on_decision: notifyMember,
        max_hours_per_submission: maxHours ?? null,
        member_instructions: instructions || null,
        field_config: fieldConfig,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border space-y-6 rounded-lg border p-6">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-lg font-semibold">
        <Settings className="text-theme-text-muted h-5 w-5" />
        <span>Self-Report Configuration</span>
      </h2>

      {/* Approval Settings */}
      <div>
        <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Approval Settings</h3>
        <div className="space-y-3">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Require officer approval for submissions</span>
          </label>

          {requireApproval && (
            <div className="ml-7 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs">Auto-approve under (hours)</label>
                <input
                  type="number"
                  value={autoApproveHours ?? ''}
                  onChange={(e) => setAutoApproveHours(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="Disabled"
                  className="form-input-sm"
                  min={0}
                  step={0.5}
                />
                <p className="text-theme-text-muted mt-1 text-xs">Leave empty to require approval for all</p>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs">Approval deadline (days)</label>
                <input
                  type="number"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(parseInt(e.target.value) || 14)}
                  className="form-input-sm"
                  min={1}
                  max={90}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notification Settings */}
      <div>
        <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Notifications</h3>
        <div className="space-y-2">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={notifyOfficer}
              onChange={(e) => setNotifyOfficer(e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Notify officer when a submission is created</span>
          </label>
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={notifyMember}
              onChange={(e) => setNotifyMember(e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Notify member when their submission is reviewed</span>
          </label>
        </div>
      </div>

      {/* Restrictions */}
      <div>
        <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Restrictions</h3>
        <div>
          <label className="text-theme-text-muted mb-1 block text-xs">Max hours per submission</label>
          <input
            type="number"
            value={maxHours ?? ''}
            onChange={(e) => setMaxHours(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder="No limit"
            className="form-input-sm w-48"
            min={0.5}
            step={0.5}
          />
        </div>
      </div>

      {/* Instructions */}
      <div>
        <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Member Instructions</h3>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Optional instructions displayed to members when submitting training..."
          className="form-input text-sm"
        />
      </div>

      {/* Field Configuration */}
      <div>
        <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Required Fields</h3>
        <p className="text-theme-text-muted mb-3 text-xs">
          Control which fields are visible and required on the submission form.
        </p>
        <div className="space-y-2">
          {Object.entries(fieldConfig).map(([name, fc]) => (
            <div
              key={name}
              className="bg-theme-surface-secondary flex items-center justify-between rounded-sm px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 items-center space-x-3">
                <input
                  type="checkbox"
                  checked={fc.visible}
                  onChange={(e) => updateField(name, 'visible', e.target.checked)}
                  className="form-checkbox"
                  disabled={['course_name', 'training_type', 'completion_date', 'hours_completed'].includes(name)}
                />
                <input
                  type="text"
                  value={fc.label}
                  onChange={(e) => updateField(name, 'label', e.target.value)}
                  className="text-theme-text-secondary min-w-0 flex-1 border-none bg-transparent text-sm focus:outline-hidden"
                />
              </div>
              <label className="ml-4 flex shrink-0 items-center space-x-2">
                <input
                  type="checkbox"
                  checked={fc.required}
                  onChange={(e) => updateField(name, 'required', e.target.checked)}
                  className="form-checkbox"
                  disabled={!fc.visible}
                />
                <span className="text-theme-text-muted text-xs">Required</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
          className="btn-primary flex items-center space-x-2 text-sm font-medium"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </div>
  );
};

// ==================== Main Page ====================

type ActiveView = 'pending' | 'all' | 'config';

const ReviewSubmissionsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<ActiveView>('pending');
  const [submissions, setSubmissions] = useState<TrainingSubmission[]>([]);
  const [config, setConfig] = useState<SelfReportConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, countData] = await Promise.all([
        trainingSubmissionService.getConfig(),
        trainingSubmissionService.getPendingCount(),
      ]);
      setConfig(configData);
      setPendingCount(countData.pending_count);

      if (activeView === 'pending') {
        const data = await trainingSubmissionService.getPendingSubmissions();
        setSubmissions(data);
      } else if (activeView === 'all') {
        const data = await trainingSubmissionService.getAllSubmissions({
          ...(statusFilter ? { status: statusFilter } : {}),
          limit: 100,
        });
        setSubmissions(data);
      }
    } catch (_error) {
      toast.error('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [activeView, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleReview = async (submissionId: string, review: SubmissionReviewRequest) => {
    try {
      await trainingSubmissionService.reviewSubmission(submissionId, review);
      const actionLabel =
        review.action === 'approve' ? 'approved' : review.action === 'reject' ? 'rejected' : 'sent back for revision';
      toast.success(`Submission ${actionLabel}`);
      void loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to review submission';
      toast.error(msg);
    }
  };

  const handleSaveConfig = async (updates: SelfReportConfigUpdate) => {
    try {
      const updated = await trainingSubmissionService.updateConfig(updates);
      setConfig(updated);
      toast.success('Configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center space-x-4">
          <button
            onClick={() => void navigate('/training/officer')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-lg p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-theme-text-primary flex items-center space-x-2 text-2xl font-bold">
              <ClipboardCheck className="h-7 w-7 text-red-500" />
              <span>Review Submissions</span>
            </h1>
            <p className="text-theme-text-muted text-sm">Review and approve member self-reported training</p>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center space-x-2 rounded-lg bg-yellow-500/20 px-3 py-1.5 text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{pendingCount} pending</span>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="bg-theme-surface mb-6 flex space-x-1 rounded-lg p-1">
          <button
            onClick={() => setActiveView('pending')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'pending'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Clock className="mr-2 inline h-4 w-4" />
            Pending Review
            {pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-yellow-500 px-1.5 py-0.5 text-xs font-bold text-black">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveView('all')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'all'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <FileText className="mr-2 inline h-4 w-4" />
            All Submissions
          </button>
          <button
            onClick={() => setActiveView('config')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'config'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Settings className="mr-2 inline h-4 w-4" />
            Settings
          </button>
        </div>

        {/* Status Filter (All view only) */}
        {activeView === 'all' && (
          <div className="mb-4 flex items-center space-x-2">
            <Filter className="text-theme-text-muted h-4 w-4" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input-sm">
              <option value="">All statuses</option>
              <option value={SubmissionStatus.PENDING_REVIEW}>Pending Review</option>
              <option value={SubmissionStatus.APPROVED}>Approved</option>
              <option value={SubmissionStatus.REJECTED}>Rejected</option>
              <option value={SubmissionStatus.REVISION_REQUESTED}>Revision Requested</option>
              <option value={SubmissionStatus.DRAFT}>Draft</option>
            </select>
          </div>
        )}

        {/* Content */}
        {activeView === 'config' ? (
          config && <ConfigEditor config={config} onSave={handleSaveConfig} />
        ) : loading ? (
          <div className="py-12 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-red-500" />
            <p className="text-theme-text-muted mt-4">Loading submissions...</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border">
            {activeView === 'pending' ? (
              <EmptyState icon={CheckCircle2} title="All caught up!" description="No submissions waiting for review." />
            ) : (
              <EmptyState
                icon={FileText}
                title="No submissions found"
                description={
                  statusFilter
                    ? 'Try clearing the status filter to see more.'
                    : 'Submissions will appear here once members start logging training.'
                }
                actions={
                  statusFilter
                    ? [{ label: 'Clear filter', onClick: () => setStatusFilter(''), variant: 'secondary' }]
                    : undefined
                }
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {activeView === 'pending' && (
              <div className="mb-4 flex items-start space-x-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Click on a submission to expand details and review. You can approve, reject, or request revisions.
                </p>
              </div>
            )}
            {submissions.map((sub) => (
              <SubmissionCard
                key={sub.id}
                submission={sub}
                onReview={handleReview}
                onRecordUpdated={() => {
                  void loadData();
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default ReviewSubmissionsPage;
