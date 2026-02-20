import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { trainingSubmissionService, trainingService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import type {
  TrainingSubmission,
  SelfReportConfig,
  SelfReportConfigUpdate,
  SubmissionReviewRequest,
  SubmissionStatus,
  TrainingType,
  TrainingRecordUpdate,
  FieldConfig,
} from '../types/training';

// ==================== Helpers ====================

const STATUS_CONFIG: Record<SubmissionStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: FileText },
  pending_review: { label: 'Pending Review', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  revision_requested: { label: 'Revision Requested', color: 'bg-orange-500/20 text-orange-400', icon: RotateCcw },
};

const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  certification: 'Certification',
  continuing_education: 'Continuing Education',
  skills_practice: 'Skills Practice',
  orientation: 'Orientation',
  refresher: 'Refresher',
  specialty: 'Specialty',
};

const StatusBadge: React.FC<{ status: SubmissionStatus }> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center space-x-1 px-2 py-0.5 text-xs rounded ${config.color}`}>
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
    </span>
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
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onReview(submission.id, {
        action,
        reviewer_notes: notes || undefined,
        override_hours: overrideHours,
        override_credit_hours: overrideHours ?? overrideCreditHours,
        override_training_type: overrideType,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-theme-surface-border pt-4 mt-4">
      {/* Action Buttons */}
      <div className="flex items-center space-x-2 mb-3">
        <button
          onClick={() => setAction('approve')}
          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            action === 'approve'
              ? 'bg-green-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Approve</span>
        </button>
        <button
          onClick={() => setAction('revision_requested')}
          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            action === 'revision_requested'
              ? 'bg-orange-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Request Revision</span>
        </button>
        <button
          onClick={() => setAction('reject')}
          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            action === 'reject'
              ? 'bg-red-600 text-white'
              : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <XCircle className="w-4 h-4" />
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
        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
        required={action !== 'approve'}
      />

      {/* Overrides (approval only) */}
      {action === 'approve' && (
        <div className="mb-3">
          <button
            onClick={() => setShowOverrides(!showOverrides)}
            className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center space-x-1"
          >
            <Settings className="w-3 h-3" />
            <span>Override values before approving</span>
            {showOverrides ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showOverrides && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="text-xs text-theme-text-muted">Hours</label>
                <input
                  type="number"
                  value={overrideHours ?? ''}
                  onChange={(e) => setOverrideHours(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder={String(submission.hours_completed)}
                  className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
                  min={0}
                  step={0.5}
                />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Training Type</label>
                <select
                  value={overrideType || ''}
                  onChange={(e) => setOverrideType(e.target.value as TrainingType || undefined)}
                  className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
                >
                  <option value="">No change</option>
                  {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || (action !== 'approve' && !notes.trim())}
        className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Processing...' : `Confirm ${action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : 'Revision Request'}`}
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
    training_type: submission.training_type as TrainingType,
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
      if (fields.instructor !== (submission.instructor || ''))
        updates.instructor = fields.instructor || undefined;
      if (fields.location !== (submission.location || ''))
        updates.location = fields.location || undefined;

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
      <div className="border-t border-theme-surface-border pt-3 mt-4">
        <button
          onClick={() => setEditing(true)}
          className="flex items-center space-x-2 px-3 py-1.5 bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg text-sm transition-colors"
        >
          <Edit2 className="w-4 h-4" />
          <span>Edit Training Record</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-theme-surface-border pt-4 mt-4">
      <h4 className="text-sm font-medium text-theme-text-primary mb-3 flex items-center space-x-2">
        <Edit2 className="w-4 h-4" />
        <span>Edit Training Record</span>
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-theme-text-muted">Course Name</label>
          <input
            type="text"
            value={fields.course_name}
            onChange={(e) => setFields({ ...fields, course_name: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Training Type</label>
          <select
            value={fields.training_type}
            onChange={(e) => setFields({ ...fields, training_type: e.target.value as TrainingType })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
          >
            {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Hours Completed</label>
          <input
            type="number"
            value={fields.hours_completed}
            onChange={(e) => setFields({ ...fields, hours_completed: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
            min={0}
            step={0.5}
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Completion Date</label>
          <input
            type="date"
            value={fields.completion_date}
            onChange={(e) => setFields({ ...fields, completion_date: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Certification Number</label>
          <input
            type="text"
            value={fields.certification_number}
            onChange={(e) => setFields({ ...fields, certification_number: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Issuing Agency</label>
          <input
            type="text"
            value={fields.issuing_agency}
            onChange={(e) => setFields({ ...fields, issuing_agency: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Expiration Date</label>
          <input
            type="date"
            value={fields.expiration_date}
            onChange={(e) => setFields({ ...fields, expiration_date: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-theme-text-muted">Instructor</label>
          <input
            type="text"
            value={fields.instructor}
            onChange={(e) => setFields({ ...fields, instructor: e.target.value })}
            className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="flex items-center space-x-2 mt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Changes'}</span>
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-3 py-1.5 bg-theme-surface text-theme-text-secondary rounded-lg text-sm hover:bg-theme-surface-hover"
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
  const isPending = submission.status === 'pending_review';
  const isApproved = submission.status === 'approved' && !!submission.training_record_id;

  return (
    <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-theme-surface-hover transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-theme-text-primary font-medium">{submission.course_name}</h3>
              <StatusBadge status={submission.status} />
            </div>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-theme-text-muted">
              <span className="flex items-center space-x-1">
                <User className="w-3 h-3" />
                <span>{submission.submitted_by}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>{submission.completion_date}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{submission.hours_completed}h</span>
              </span>
              <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
                {TRAINING_TYPE_LABELS[submission.training_type] || submission.training_type}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-theme-text-muted ml-2 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-theme-text-muted ml-2 flex-shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4">
          <div className="border-t border-theme-surface-border pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {submission.course_code && (
                <div>
                  <span className="text-theme-text-muted">Course Code: </span>
                  <span className="text-theme-text-secondary">{submission.course_code}</span>
                </div>
              )}
              {submission.instructor && (
                <div className="flex items-center space-x-1">
                  <User className="w-3 h-3 text-theme-text-muted" />
                  <span className="text-theme-text-muted">Instructor: </span>
                  <span className="text-theme-text-secondary">{submission.instructor}</span>
                </div>
              )}
              {submission.location && (
                <div className="flex items-center space-x-1">
                  <MapPin className="w-3 h-3 text-theme-text-muted" />
                  <span className="text-theme-text-muted">Location: </span>
                  <span className="text-theme-text-secondary">{submission.location}</span>
                </div>
              )}
              {submission.certification_number && (
                <div className="flex items-center space-x-1">
                  <Award className="w-3 h-3 text-theme-text-muted" />
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
                <p className="text-theme-text-secondary text-sm mt-1">{submission.description}</p>
              </div>
            )}
            {submission.reviewer_notes && (
              <div className="mt-3 bg-theme-surface-secondary rounded p-2">
                <span className="text-theme-text-muted text-xs">Previous reviewer notes: </span>
                <p className="text-theme-text-secondary text-sm">{submission.reviewer_notes}</p>
              </div>
            )}
          </div>

          {/* Review Panel */}
          {isPending && (
            <ReviewPanel submission={submission} onReview={onReview} />
          )}

          {/* Edit Record Panel (approved submissions only) */}
          {isApproved && (
            <EditRecordPanel
              recordId={submission.training_record_id!}
              submission={submission}
              onSaved={onRecordUpdated}
            />
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
  const [autoApproveHours, setAutoApproveHours] = useState<number | undefined>(config.auto_approve_under_hours ?? undefined);
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
      [fieldName]: { ...prev[fieldName], [prop]: value },
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
    <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-6 space-y-6">
      <h2 className="text-lg font-semibold text-theme-text-primary flex items-center space-x-2">
        <Settings className="w-5 h-5 text-theme-text-muted" />
        <span>Self-Report Configuration</span>
      </h2>

      {/* Approval Settings */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Approval Settings</h3>
        <div className="space-y-3">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
            />
            <span className="text-theme-text-secondary text-sm">Require officer approval for submissions</span>
          </label>

          {requireApproval && (
            <div className="ml-7 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">Auto-approve under (hours)</label>
                <input
                  type="number"
                  value={autoApproveHours ?? ''}
                  onChange={(e) => setAutoApproveHours(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="Disabled"
                  className="w-full px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
                  min={0}
                  step={0.5}
                />
                <p className="text-xs text-theme-text-muted mt-1">Leave empty to require approval for all</p>
              </div>
              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">Approval deadline (days)</label>
                <input
                  type="number"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(parseInt(e.target.value) || 14)}
                  className="w-full px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
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
        <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Notifications</h3>
        <div className="space-y-2">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={notifyOfficer}
              onChange={(e) => setNotifyOfficer(e.target.checked)}
              className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
            />
            <span className="text-theme-text-secondary text-sm">Notify officer when a submission is created</span>
          </label>
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={notifyMember}
              onChange={(e) => setNotifyMember(e.target.checked)}
              className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
            />
            <span className="text-theme-text-secondary text-sm">Notify member when their submission is reviewed</span>
          </label>
        </div>
      </div>

      {/* Restrictions */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Restrictions</h3>
        <div>
          <label className="text-xs text-theme-text-muted mb-1 block">Max hours per submission</label>
          <input
            type="number"
            value={maxHours ?? ''}
            onChange={(e) => setMaxHours(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder="No limit"
            className="w-48 px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-theme-text-primary text-sm"
            min={0.5}
            step={0.5}
          />
        </div>
      </div>

      {/* Instructions */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Member Instructions</h3>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Optional instructions displayed to members when submitting training..."
          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Field Configuration */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Required Fields</h3>
        <p className="text-xs text-theme-text-muted mb-3">Control which fields are visible and required on the submission form.</p>
        <div className="space-y-2">
          {Object.entries(fieldConfig).map(([name, fc]) => (
            <div key={name} className="flex items-center justify-between py-2 px-3 bg-theme-surface-secondary rounded">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={fc.visible}
                  onChange={(e) => updateField(name, 'visible', e.target.checked)}
                  className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
                  disabled={['course_name', 'training_type', 'completion_date', 'hours_completed'].includes(name)}
                />
                <input
                  type="text"
                  value={fc.label}
                  onChange={(e) => updateField(name, 'label', e.target.value)}
                  className="bg-transparent border-none text-theme-text-secondary text-sm focus:outline-none flex-1 min-w-0"
                />
              </div>
              <label className="flex items-center space-x-2 ml-4 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={fc.required}
                  onChange={(e) => updateField(name, 'required', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-theme-input-border bg-theme-input-bg text-orange-600 focus:ring-orange-500"
                  disabled={!fc.visible}
                />
                <span className="text-xs text-theme-text-muted">Required</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
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

  const loadData = async () => {
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
          status: statusFilter || undefined,
          limit: 100,
        });
        setSubmissions(data);
      }
    } catch (_error) {
      toast.error('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeView, statusFilter]);

  const handleReview = async (submissionId: string, review: SubmissionReviewRequest) => {
    try {
      await trainingSubmissionService.reviewSubmission(submissionId, review);
      const actionLabel = review.action === 'approve' ? 'approved' : review.action === 'reject' ? 'rejected' : 'sent back for revision';
      toast.success(`Submission ${actionLabel}`);
      loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to review submission';
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
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-6">
          <button
            onClick={() => navigate('/training/officer')}
            className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center space-x-2">
              <ClipboardCheck className="w-7 h-7 text-red-500" />
              <span>Review Submissions</span>
            </h1>
            <p className="text-theme-text-muted text-sm">
              Review and approve member self-reported training
            </p>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center space-x-2 bg-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-lg">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{pendingCount} pending</span>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-1 bg-theme-surface p-1 rounded-lg mb-6">
          <button
            onClick={() => setActiveView('pending')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeView === 'pending'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-2" />
            Pending Review
            {pendingCount > 0 && (
              <span className="ml-2 bg-yellow-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveView('all')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeView === 'all'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <FileText className="w-4 h-4 inline mr-2" />
            All Submissions
          </button>
          <button
            onClick={() => setActiveView('config')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeView === 'config'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Settings className="w-4 h-4 inline mr-2" />
            Settings
          </button>
        </div>

        {/* Status Filter (All view only) */}
        {activeView === 'all' && (
          <div className="flex items-center space-x-2 mb-4">
            <Filter className="w-4 h-4 text-theme-text-muted" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">All statuses</option>
              <option value="pending_review">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="revision_requested">Revision Requested</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        )}

        {/* Content */}
        {activeView === 'config' ? (
          config && <ConfigEditor config={config} onSave={handleSaveConfig} />
        ) : loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
            <p className="text-theme-text-muted mt-4">Loading submissions...</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-16 bg-theme-surface rounded-lg border border-theme-surface-border">
            {activeView === 'pending' ? (
              <>
                <CheckCircle2 className="w-16 h-16 text-green-500/50 mx-auto mb-4" />
                <p className="text-theme-text-muted text-lg">All caught up!</p>
                <p className="text-theme-text-muted text-sm mt-1">No submissions waiting for review.</p>
              </>
            ) : (
              <>
                <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-theme-text-muted">No submissions found</p>
                {statusFilter && (
                  <button
                    onClick={() => setStatusFilter('')}
                    className="mt-2 text-red-400 text-sm hover:text-red-300"
                  >
                    Clear filter
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {activeView === 'pending' && (
              <div className="flex items-start space-x-2 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-blue-300 text-sm">
                  Click on a submission to expand details and review. You can approve, reject, or request revisions.
                </p>
              </div>
            )}
            {submissions.map((sub) => (
              <SubmissionCard key={sub.id} submission={sub} onReview={handleReview} onRecordUpdated={loadData} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default ReviewSubmissionsPage;
