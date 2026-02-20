import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Send,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Trash2,
  Edit2,
  Info,
} from 'lucide-react';
import { trainingSubmissionService, trainingService } from '../services/api';
import type {
  TrainingSubmission,
  TrainingSubmissionCreate,
  TrainingCategory,
  SelfReportConfig,
  TrainingType,
  SubmissionStatus,
} from '../types/training';

// ==================== Helpers ====================

const STATUS_CONFIG: Record<SubmissionStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'bg-theme-surface-secondary text-theme-text-muted', icon: FileText },
  pending_review: { label: 'Pending Review', color: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-700 dark:text-green-400', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-700 dark:text-red-400', icon: XCircle },
  revision_requested: { label: 'Revision Requested', color: 'bg-orange-500/20 text-orange-700 dark:text-orange-400', icon: RotateCcw },
};

const TRAINING_TYPES: { value: TrainingType; label: string }[] = [
  { value: 'certification', label: 'Certification' },
  { value: 'continuing_education', label: 'Continuing Education' },
  { value: 'skills_practice', label: 'Skills Practice' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'refresher', label: 'Refresher' },
  { value: 'specialty', label: 'Specialty' },
];

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

// ==================== Submission Form ====================

/** Calculate the hour difference between two datetime-local strings */
function calcHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (diff <= 0) return 0;
  return Math.round((diff / (1000 * 60 * 60)) * 100) / 100; // round to 2 decimals
}

/** Format a number of hours into a readable label like "2h 30m" */
function formatHours(h: number): string {
  if (h <= 0) return '0h';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

const SubmissionForm: React.FC<{
  config: SelfReportConfig;
  categories: TrainingCategory[];
  onSuccess: () => void;
  editSubmission?: TrainingSubmission | null;
  onCancelEdit?: () => void;
}> = ({ config, categories, onSuccess, editSubmission, onCancelEdit }) => {
  const isEdit = !!editSubmission;
  const [formData, setFormData] = useState<TrainingSubmissionCreate>({
    course_name: '',
    training_type: 'continuing_education',
    completion_date: '',
    hours_completed: 0,
  });
  // Start/end datetime state (drives the hours calculation)
  const [startDatetime, setStartDatetime] = useState('');
  const [endDatetime, setEndDatetime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const calculatedHours = calcHours(startDatetime, endDatetime);

  useEffect(() => {
    if (editSubmission) {
      setFormData({
        course_name: editSubmission.course_name,
        course_code: editSubmission.course_code,
        training_type: editSubmission.training_type,
        description: editSubmission.description,
        completion_date: editSubmission.completion_date,
        hours_completed: editSubmission.hours_completed,
        instructor: editSubmission.instructor,
        location: editSubmission.location,
        certification_number: editSubmission.certification_number,
        issuing_agency: editSubmission.issuing_agency,
        expiration_date: editSubmission.expiration_date,
        category_id: editSubmission.category_id,
      });
      // Reconstruct start/end datetimes from completion_date + hours
      if (editSubmission.completion_date && editSubmission.hours_completed) {
        const startDt = `${editSubmission.completion_date}T09:00`;
        const endMs = new Date(startDt).getTime() + editSubmission.hours_completed * 60 * 60 * 1000;
        const endDt = new Date(endMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        const endStr = `${endDt.getFullYear()}-${pad(endDt.getMonth() + 1)}-${pad(endDt.getDate())}T${pad(endDt.getHours())}:${pad(endDt.getMinutes())}`;
        setStartDatetime(startDt);
        setEndDatetime(endStr);
      }
    }
  }, [editSubmission]);

  const fc = config.field_config;
  const isFieldVisible = (name: string) => fc[name]?.visible !== false;
  const isFieldRequired = (name: string) => fc[name]?.required === true;
  const fieldLabel = (name: string, fallback: string) => fc[name]?.label || fallback;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    // Derive completion_date and hours from the datetime pickers
    const hours = calcHours(startDatetime, endDatetime);
    if (!startDatetime || !endDatetime || hours <= 0) {
      setError('Please provide valid start and end times (end must be after start).');
      setIsSubmitting(false);
      return;
    }

    // Validate max hours
    if (config.max_hours_per_submission && hours > config.max_hours_per_submission) {
      setError(`Hours (${hours}) exceed maximum of ${config.max_hours_per_submission} per submission.`);
      setIsSubmitting(false);
      return;
    }

    const completionDate = startDatetime.split('T')[0]; // YYYY-MM-DD

    try {
      const submitData = {
        ...formData,
        completion_date: completionDate,
        hours_completed: hours,
        credit_hours: hours, // credit hours = hours (unified)
      };
      if (isEdit && editSubmission) {
        await trainingSubmissionService.updateSubmission(editSubmission.id, submitData);
        toast.success('Submission updated');
      } else {
        await trainingSubmissionService.createSubmission(submitData);
        toast.success(config.require_approval ? 'Training submitted for review!' : 'Training recorded!');
      }
      onSuccess();
      if (!isEdit) {
        setFormData({
          course_name: '',
          training_type: 'continuing_education',
          completion_date: '',
          hours_completed: 0,
        });
        setStartDatetime('');
        setEndDatetime('');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to submit training';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter training types if config restricts them
  const allowedTypes = config.allowed_training_types
    ? TRAINING_TYPES.filter((t) => config.allowed_training_types!.includes(t.value))
    : TRAINING_TYPES;

  const parentCategories = categories.filter((c) => !c.parent_category_id);

  return (
    <form onSubmit={handleSubmit} className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-6 space-y-4">
      <h2 className="text-lg font-semibold text-theme-text-primary mb-2">
        {isEdit ? 'Edit Submission' : 'Report External Training'}
      </h2>

      {config.member_instructions && (
        <div className="flex items-start space-x-2 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
          <Info className="w-4 h-4 text-blue-700 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-blue-700 dark:text-blue-300 text-sm">{config.member_instructions}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {/* Course name - always visible */}
      <div>
        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
          {fieldLabel('course_name', 'Course / Class Name')} {isFieldRequired('course_name') && <span className="text-red-700 dark:text-red-400">*</span>}
        </label>
        <input
          type="text"
          value={formData.course_name}
          onChange={(e) => setFormData({ ...formData, course_name: e.target.value })}
          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="e.g., Wildland Firefighting - S130/S190"
          required
        />
      </div>

      {/* Training type */}
      {isFieldVisible('training_type') && (
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            {fieldLabel('training_type', 'Training Type')} {isFieldRequired('training_type') && <span className="text-red-700 dark:text-red-400">*</span>}
          </label>
          <select
            value={formData.training_type}
            onChange={(e) => setFormData({ ...formData, training_type: e.target.value as TrainingType })}
            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required={isFieldRequired('training_type')}
          >
            {allowedTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Start / End datetime pickers + calculated hours */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Start Date & Time <span className="text-red-700 dark:text-red-400">*</span>
          </label>
          <input
            type="datetime-local"
            value={startDatetime}
            onChange={(e) => {
              const val = e.target.value;
              setStartDatetime(val);
              // Auto-populate end datetime to start + 1 hour if end is empty or before new start
              if (val) {
                const startMs = new Date(val).getTime();
                const endMs = startMs + 60 * 60 * 1000; // +1 hour
                const endDt = new Date(endMs);
                const pad = (n: number) => String(n).padStart(2, '0');
                const autoEnd = `${endDt.getFullYear()}-${pad(endDt.getMonth() + 1)}-${pad(endDt.getDate())}T${pad(endDt.getHours())}:${pad(endDt.getMinutes())}`;
                if (!endDatetime || new Date(endDatetime).getTime() <= startMs) {
                  setEndDatetime(autoEnd);
                }
              }
            }}
            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            End Date & Time <span className="text-red-700 dark:text-red-400">*</span>
          </label>
          <input
            type="datetime-local"
            value={endDatetime}
            onChange={(e) => setEndDatetime(e.target.value)}
            min={startDatetime || undefined}
            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required
          />
        </div>
      </div>

      {/* Calculated hours display */}
      {(startDatetime && endDatetime) && (
        <div className={`flex items-center space-x-2 rounded-lg p-3 text-sm ${
          calculatedHours > 0
            ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400'
        }`}>
          <Clock className="w-4 h-4 flex-shrink-0" />
          <span>
            {calculatedHours > 0
              ? `Training Hours: ${formatHours(calculatedHours)} (${calculatedHours} hours)`
              : 'End time must be after start time'}
          </span>
          {config.max_hours_per_submission && calculatedHours > config.max_hours_per_submission && (
            <span className="text-red-700 dark:text-red-400 ml-2">(exceeds max of {config.max_hours_per_submission}h)</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Instructor */}
        {isFieldVisible('instructor') && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              {fieldLabel('instructor', 'Instructor Name')} {isFieldRequired('instructor') && <span className="text-red-700 dark:text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={formData.instructor || ''}
              onChange={(e) => setFormData({ ...formData, instructor: e.target.value || undefined })}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              required={isFieldRequired('instructor')}
            />
          </div>
        )}

        {/* Location */}
        {isFieldVisible('location') && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              {fieldLabel('location', 'Location / Facility')} {isFieldRequired('location') && <span className="text-red-700 dark:text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={formData.location || ''}
              onChange={(e) => setFormData({ ...formData, location: e.target.value || undefined })}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              required={isFieldRequired('location')}
            />
          </div>
        )}
      </div>

      {/* Category */}
      {isFieldVisible('category_id') && parentCategories.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            {fieldLabel('category_id', 'Training Category')} {isFieldRequired('category_id') && <span className="text-red-700 dark:text-red-400">*</span>}
          </label>
          <select
            value={formData.category_id || ''}
            onChange={(e) => setFormData({ ...formData, category_id: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required={isFieldRequired('category_id')}
          >
            <option value="">Select a category...</option>
            {parentCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Description */}
      {isFieldVisible('description') && (
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            {fieldLabel('description', 'Description / Notes')} {isFieldRequired('description') && <span className="text-red-700 dark:text-red-400">*</span>}
          </label>
          <textarea
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value || undefined })}
            rows={3}
            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required={isFieldRequired('description')}
            placeholder="Describe what the training covered..."
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Certification Number */}
        {isFieldVisible('certification_number') && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              {fieldLabel('certification_number', 'Certificate / ID Number')} {isFieldRequired('certification_number') && <span className="text-red-700 dark:text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={formData.certification_number || ''}
              onChange={(e) => setFormData({ ...formData, certification_number: e.target.value || undefined })}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              required={isFieldRequired('certification_number')}
            />
          </div>
        )}

        {/* Issuing Agency */}
        {isFieldVisible('issuing_agency') && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              {fieldLabel('issuing_agency', 'Issuing Agency')} {isFieldRequired('issuing_agency') && <span className="text-red-700 dark:text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={formData.issuing_agency || ''}
              onChange={(e) => setFormData({ ...formData, issuing_agency: e.target.value || undefined })}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              required={isFieldRequired('issuing_agency')}
            />
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-theme-surface-border">
        <div className="text-xs text-theme-text-muted">
          {config.require_approval
            ? 'Your submission will be reviewed by a training officer.'
            : 'Training will be recorded immediately.'}
        </div>
        <div className="flex items-center space-x-3">
          {isEdit && onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmitting ? 'Submitting...' : isEdit ? 'Update' : 'Submit Training'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};

// ==================== Main Page ====================

const SubmitTrainingPage: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SelfReportConfig | null>(null);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [submissions, setSubmissions] = useState<TrainingSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSubmission, setEditingSubmission] = useState<TrainingSubmission | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [configData, categoriesData, submissionsData] = await Promise.all([
        trainingSubmissionService.getConfig(),
        trainingService.getCategories(),
        trainingSubmissionService.getMySubmissions(),
      ]);
      setConfig(configData);
      setCategories(categoriesData);
      setSubmissions(submissionsData);
    } catch (_error) {
      toast.error('Failed to load submission form');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (submissionId: string) => {
    if (!confirm('Are you sure you want to delete this submission?')) return;
    try {
      await trainingSubmissionService.deleteSubmission(submissionId);
      toast.success('Submission deleted');
      loadData();
    } catch {
      toast.error('Failed to delete submission');
    }
  };

  if (loading || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-red-500" />
          <p className="text-theme-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <button
            onClick={() => navigate('/training')}
            className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-secondary"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center space-x-2">
              <FileText className="w-7 h-7 text-red-700 dark:text-red-500" />
              <span>Submit External Training</span>
            </h1>
            <p className="text-theme-text-muted text-sm">
              Report training completed at other locations or organizations
            </p>
          </div>
        </div>

        {/* Submission Form */}
        <SubmissionForm
          config={config}
          categories={categories}
          onSuccess={() => { setEditingSubmission(null); loadData(); }}
          editSubmission={editingSubmission}
          onCancelEdit={() => setEditingSubmission(null)}
        />

        {/* My Submissions History */}
        {submissions.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">My Submissions ({submissions.length})</h2>
            <div className="space-y-3">
              {submissions.map((sub) => {
                const canEdit = ['draft', 'pending_review', 'revision_requested'].includes(sub.status);
                return (
                  <div key={sub.id} className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h3 className="text-theme-text-primary font-medium">{sub.course_name}</h3>
                          <StatusBadge status={sub.status} />
                        </div>
                        <div className="flex items-center space-x-4 text-xs text-theme-text-muted">
                          <span>{sub.hours_completed}h</span>
                          <span>{sub.completion_date}</span>
                          {sub.instructor && <span>Instructor: {sub.instructor}</span>}
                          {sub.location && <span>at {sub.location}</span>}
                        </div>
                        {sub.reviewer_notes && (
                          <div className="mt-2 bg-theme-surface rounded p-2 text-sm">
                            <span className="text-theme-text-muted text-xs">Officer notes: </span>
                            <span className="text-theme-text-secondary">{sub.reviewer_notes}</span>
                          </div>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex items-center space-x-1 ml-4">
                          <button
                            onClick={() => setEditingSubmission(sub)}
                            className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded"
                            aria-label="Edit submission"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(sub.id)}
                            className="p-1.5 text-theme-text-muted hover:text-red-700 dark:hover:text-red-400 rounded"
                            aria-label="Delete submission"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SubmitTrainingPage;
