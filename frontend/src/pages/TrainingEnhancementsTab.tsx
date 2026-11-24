/**
 * Training Enhancements Tab
 *
 * Admin interface for new training features:
 * - Recertification Pathways (NREMT renewal, NFPA recertification)
 * - Competency Tracking (Dreyfus model progression)
 * - Instructor Qualifications (NFPA 1041 compliance)
 * - Training Effectiveness (Kirkpatrick Model evaluation)
 * - Multi-Agency Training (NIMS/ICS joint exercises)
 * - Report Exports (compliance CSV/PDF, forecasting)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import {
  RefreshCw,
  Plus,
  Download,
  Users,
  Award,
  BookOpen,
  BarChart3,
  Globe,
  FileText,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { MemberPickerModal } from '../components/MemberPickerModal';
import { EffectivenessEvaluationModal } from '../components/training/EffectivenessEvaluationModal';
import { EmptyState } from '../components/ux/EmptyState';
import { CompetencyHeatmap } from '../components/training/CompetencyHeatmap';
import useLoadData from '../hooks/useLoadData';
import { getErrorMessage } from '../utils/errorHandling';
import { isForecastReport } from '../utils/complianceForecast';
import { displayNameOf } from '../utils/memberName';
import { userService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { QUALIFICATION_STANDING, qualificationStanding } from '../utils/instructorQualifications';
import { getTrainingPeriodWindow, TRAINING_PERIOD_LABELS, TrainingExportPeriod } from '../utils/trainingPeriods';
import {
  recertificationService,
  competencyService,
  instructorService,
  effectivenessService,
  multiAgencyService,
  reportExportService,
} from '../services/trainingServices';
import type {
  RecertificationPathway,
  RecertificationPathwayCreate,
  RenewalTask,
  CompetencyMatrix,
  CompetencyMatrixCreate,
  InstructorQualification,
  InstructorQualificationCreate,
  InstructorQualificationType,
  MultiAgencyTraining,
  MultiAgencyTrainingCreate,
  TrainingEffectivenessEvaluation,
  EvaluationLevel,
  ComplianceForecast,
  ParticipatingOrganization,
} from '../types/training';
import type { User } from '../types/user';
import { STANDING_TEXT_COLORS, isActiveAccount } from '../constants/enums';
import { StatGrid } from '../components/ux/StatGrid';
import { SignatureLinesOption } from '../components/SignatureLinesOption';

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';
const selectClass = inputClass;

// ==================== Shared create-dialog pieces ====================

type FieldErrorState<F extends string> = ReturnType<typeof useFieldErrors<F>>;

/**
 * The create step the four dialogs below share. A create form makes nothing
 * until every flagged field is fixed (owner rule 2026-11-05, "Forms — Save With
 * an Error" in docs/KNOWN_LIMITATIONS.md): creating the record without the
 * refused value and then flagging it would leave the flag on a dialog that has
 * already closed. A 422 lands on the field it names; anything else is said in
 * the dialog, where it stays until the next attempt, instead of in a toast.
 *
 * Returns true once the record was created.
 */
async function createUnlessFlagged<F extends string>(
  fieldErrors: FieldErrorState<F>,
  problems: FieldErrors<F>,
  create: () => Promise<unknown>,
  fallback: string
): Promise<boolean> {
  fieldErrors.setFormError(null);
  fieldErrors.setErrors(problems);
  if (Object.keys(problems).length > 0) {
    fieldErrors.focusFirst(problems);
    return false;
  }
  try {
    await create();
    return true;
  } catch (err: unknown) {
    fieldErrors.focusFirst(fieldErrors.setFromApiError(err, fallback));
    return false;
  }
}

/** A typed whole number inside the schema's bounds, or why not; a blank box passes. */
function wholeNumberProblem(raw: string, min: number, max?: number): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isInteger(n) && n >= min && (max === undefined || n <= max)) return undefined;
  return max === undefined ? `Enter a whole number, ${min} or more.` : `Enter a whole number from ${min} to ${max}.`;
}

const FormLevelError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
      {message}
    </p>
  ) : null;

// ==================== Add Pathway Modal ====================

interface AddPathwayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const RENEWAL_TYPES = [
  { value: 'hours', label: 'Hours' },
  { value: 'courses', label: 'Courses' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'combination', label: 'Combination' },
] as const;

type PathwayField =
  'name' | 'description' | 'renewal_type' | 'required_hours' | 'renewal_window_days' | 'grace_period_days';

// In screen order, so the first refusal takes focus. Bounds mirror
// RecertificationPathwayBase (name 255; window 1-365; grace 0-365).
const PATHWAY_FIELDS: FieldSpecs<PathwayField> = {
  name: { id: 'pathway-name', label: 'Name' },
  description: { id: 'pathway-description', label: 'Description' },
  renewal_type: { id: 'pathway-renewal-type', label: 'Renewal Type' },
  required_hours: { id: 'pathway-required-hours', label: 'Required Hours' },
  renewal_window_days: { id: 'pathway-renewal-window-days', label: 'Renewal Window (days)' },
  grace_period_days: { id: 'pathway-grace-period-days', label: 'Grace Period (days)' },
};

const EMPTY_PATHWAY = {
  name: '',
  description: '',
  renewalType: 'hours' as RecertificationPathwayCreate['renewal_type'],
  requiredHours: '',
  renewalWindowDays: '90',
  gracePeriodDays: '30',
};

const AddPathwayModal: React.FC<AddPathwayModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_PATHWAY);
  const fieldErrors = useFieldErrors(PATHWAY_FIELDS);
  const { clear } = fieldErrors;
  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(form) !== JSON.stringify(EMPTY_PATHWAY),
    onClose,
  });

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_PATHWAY);
      clear();
    }
  }, [isOpen, clear]);

  const set = (patch: Partial<typeof EMPTY_PATHWAY>, field: PathwayField) => {
    setForm((f) => ({ ...f, ...patch }));
    fieldErrors.setError(field, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems: FieldErrors<PathwayField> = {};
    if (!form.name.trim()) problems.name = 'Give the pathway a name.';
    const hours = form.requiredHours.trim();
    if (hours && !(Number.isFinite(Number(hours)) && Number(hours) >= 0))
      problems.required_hours = 'Enter a number of hours, 0 or more, or leave it empty.';
    const windowProblem = wholeNumberProblem(form.renewalWindowDays, 1, 365);
    if (windowProblem) problems.renewal_window_days = windowProblem;
    const graceProblem = wholeNumberProblem(form.gracePeriodDays, 0, 365);
    if (graceProblem) problems.grace_period_days = graceProblem;

    setSaving(true);
    try {
      const data: RecertificationPathwayCreate = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        renewal_type: form.renewalType,
        required_hours: hours ? Number(hours) : undefined,
        renewal_window_days: Number(form.renewalWindowDays) || undefined,
        grace_period_days: Number(form.gracePeriodDays) || undefined,
      };
      const created = await createUnlessFlagged(
        fieldErrors,
        problems,
        () => recertificationService.createPathway(data),
        'Failed to create pathway'
      );
      if (created) {
        toast.success('Pathway created');
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add Recertification Pathway"
      size="md"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-1 rounded-lg px-4 py-2 text-sm"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Pathway'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormLevelError message={fieldErrors.formError} />
        <FormField
          id={PATHWAY_FIELDS.name.id}
          label="Name"
          required
          error={fieldErrors.errors.name}
          maxLength={255}
          count={form.name.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputClass}
              value={form.name}
              onChange={(e) => set({ name: e.target.value }, 'name')}
              placeholder="e.g. NREMT Recertification"
            />
          )}
        </FormField>
        <FormField id={PATHWAY_FIELDS.description.id} label="Description" error={fieldErrors.errors.description}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              value={form.description}
              onChange={(e) => set({ description: e.target.value }, 'description')}
              rows={2}
              placeholder="Renewal pathway details..."
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={PATHWAY_FIELDS.renewal_type.id}
            label="Renewal Type"
            required
            error={fieldErrors.errors.renewal_type}
          >
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={form.renewalType}
                onChange={(e) =>
                  set({ renewalType: e.target.value as RecertificationPathwayCreate['renewal_type'] }, 'renewal_type')
                }
              >
                {RENEWAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={PATHWAY_FIELDS.required_hours.id}
            label="Required Hours"
            error={fieldErrors.errors.required_hours}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                min="0"
                step="0.5"
                value={form.requiredHours}
                onChange={(e) => set({ requiredHours: e.target.value }, 'required_hours')}
                placeholder="e.g. 40"
              />
            )}
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={PATHWAY_FIELDS.renewal_window_days.id}
            label="Renewal Window (days)"
            error={fieldErrors.errors.renewal_window_days}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                min="1"
                max="365"
                value={form.renewalWindowDays}
                onChange={(e) => set({ renewalWindowDays: e.target.value }, 'renewal_window_days')}
              />
            )}
          </FormField>
          <FormField
            id={PATHWAY_FIELDS.grace_period_days.id}
            label="Grace Period (days)"
            error={fieldErrors.errors.grace_period_days}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                min="0"
                max="365"
                value={form.gracePeriodDays}
                onChange={(e) => set({ gracePeriodDays: e.target.value }, 'grace_period_days')}
              />
            )}
          </FormField>
        </div>
      </div>
    </Modal>
  );
};

// ==================== Add Matrix Modal ====================

interface AddMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type MatrixField = 'name' | 'position' | 'description';

// Limits mirror CompetencyMatrixBase (name 255, position 100).
const MATRIX_FIELDS: FieldSpecs<MatrixField> = {
  name: { id: 'matrix-name', label: 'Name' },
  position: { id: 'matrix-position', label: 'Position' },
  description: { id: 'matrix-description', label: 'Description' },
};

const EMPTY_MATRIX = { name: '', position: '', description: '' };

const AddMatrixModal: React.FC<AddMatrixModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_MATRIX);
  const fieldErrors = useFieldErrors(MATRIX_FIELDS);
  const { clear } = fieldErrors;
  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(form) !== JSON.stringify(EMPTY_MATRIX),
    onClose,
  });

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_MATRIX);
      clear();
    }
  }, [isOpen, clear]);

  const set = (field: MatrixField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    fieldErrors.setError(field, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems: FieldErrors<MatrixField> = {};
    if (!form.name.trim()) problems.name = 'Give the matrix a name.';
    if (!form.position.trim()) problems.position = 'Name the position this matrix is for.';
    setSaving(true);
    try {
      const data: CompetencyMatrixCreate = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        position: form.position.trim(),
        skill_requirements: [],
      };
      const created = await createUnlessFlagged(
        fieldErrors,
        problems,
        () => competencyService.createMatrix(data),
        'Failed to create matrix'
      );
      if (created) {
        toast.success('Matrix created');
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add Competency Matrix"
      size="md"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-1 rounded-lg px-4 py-2 text-sm"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Matrix'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormLevelError message={fieldErrors.formError} />
        <FormField
          id={MATRIX_FIELDS.name.id}
          label="Name"
          required
          error={fieldErrors.errors.name}
          maxLength={255}
          count={form.name.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Firefighter I Competency Matrix"
            />
          )}
        </FormField>
        <FormField
          id={MATRIX_FIELDS.position.id}
          label="Position"
          required
          error={fieldErrors.errors.position}
          maxLength={100}
          count={form.position.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputClass}
              value={form.position}
              onChange={(e) => set('position', e.target.value)}
              placeholder="e.g. Firefighter, Lieutenant, Captain"
            />
          )}
        </FormField>
        <FormField id={MATRIX_FIELDS.description.id} label="Description" error={fieldErrors.errors.description}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="Matrix description..."
            />
          )}
        </FormField>
        <p className="text-theme-text-muted text-xs">Skill requirements can be added after creating the matrix.</p>
      </div>
    </Modal>
  );
};

// ==================== Add Qualification Modal ====================

interface AddQualificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const QUALIFICATION_TYPES: { value: InstructorQualificationType; label: string }[] = [
  { value: 'instructor', label: 'Instructor' },
  { value: 'evaluator', label: 'Evaluator' },
  { value: 'lead_instructor', label: 'Lead Instructor' },
  { value: 'mentor', label: 'Mentor' },
];

type QualificationField =
  | 'user_id'
  | 'qualification_type'
  | 'certification_level'
  | 'certification_number'
  | 'issuing_agency'
  | 'issued_date'
  | 'expiration_date';

// Limits mirror InstructorQualificationBase.
const QUALIFICATION_FIELDS: FieldSpecs<QualificationField> = {
  user_id: { id: 'qualification-member', label: 'Member' },
  qualification_type: { id: 'qualification-type', label: 'Qualification Type' },
  certification_level: { id: 'qualification-certification-level', label: 'Certification Level' },
  certification_number: { id: 'qualification-certification-number', label: 'Certification Number' },
  issuing_agency: { id: 'qualification-issuing-agency', label: 'Issuing Agency' },
  issued_date: { id: 'qualification-issued-date', label: 'Issued Date' },
  expiration_date: { id: 'qualification-expiration-date', label: 'Expiration Date' },
};

const EMPTY_QUALIFICATION: Record<Exclude<QualificationField, 'qualification_type'>, string> & {
  qualification_type: InstructorQualificationType;
} = {
  user_id: '',
  qualification_type: 'instructor',
  certification_level: '',
  certification_number: '',
  issuing_agency: '',
  issued_date: '',
  expiration_date: '',
};

const AddQualificationModal: React.FC<AddQualificationModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_QUALIFICATION);
  const [members, setMembers] = useState<User[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const fieldErrors = useFieldErrors(QUALIFICATION_FIELDS);
  const { clear } = fieldErrors;
  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(form) !== JSON.stringify(EMPTY_QUALIFICATION),
    onClose,
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);
    userService
      .getUsers()
      .then((users) => {
        if (cancelled) return;
        // A qualification is recorded for a current member, never a former one.
        const named = users
          .filter((u) => isActiveAccount(u.status))
          .map((u) => ({ user: u, name: displayNameOf(u) || u.username }));
        named.sort((a, b) => a.name.localeCompare(b.name));
        setMembers(named.map((n) => n.user));
      })
      .catch((err: unknown) => {
        if (!cancelled) setMembersError(getErrorMessage(err, 'Unable to load members.'));
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_QUALIFICATION);
      clear();
    }
  }, [isOpen, clear]);

  const set = (patch: Partial<typeof EMPTY_QUALIFICATION>) => {
    setForm((f) => ({ ...f, ...patch }));
    for (const key of Object.keys(patch)) fieldErrors.setError(key as QualificationField, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems: FieldErrors<QualificationField> = {};
    if (!form.user_id) problems.user_id = 'Select the member this qualification belongs to.';
    setSaving(true);
    try {
      const data: InstructorQualificationCreate = {
        user_id: form.user_id,
        qualification_type: form.qualification_type,
        certification_number: form.certification_number.trim() || undefined,
        issuing_agency: form.issuing_agency.trim() || undefined,
        certification_level: form.certification_level.trim() || undefined,
        issued_date: form.issued_date || undefined,
        expiration_date: form.expiration_date || undefined,
      };
      const created = await createUnlessFlagged(
        fieldErrors,
        problems,
        () => instructorService.createQualification(data),
        'Failed to add qualification'
      );
      if (created) {
        toast.success('Qualification added');
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const textField = (
    name: 'certification_level' | 'certification_number' | 'issuing_agency',
    maxLength: number,
    placeholder: string
  ) => (
    <FormField
      id={QUALIFICATION_FIELDS[name].id}
      label={QUALIFICATION_FIELDS[name].label}
      error={fieldErrors.errors[name]}
      maxLength={maxLength}
      count={form[name].length}
    >
      {(field) => (
        <input
          {...field}
          className={inputClass}
          value={form[name]}
          onChange={(e) => set({ [name]: e.target.value })}
          placeholder={placeholder}
        />
      )}
    </FormField>
  );

  const dateField = (name: 'issued_date' | 'expiration_date') => (
    <FormField
      id={QUALIFICATION_FIELDS[name].id}
      label={QUALIFICATION_FIELDS[name].label}
      error={fieldErrors.errors[name]}
    >
      {(field) => (
        <input
          {...field}
          className={inputClass}
          type="date"
          value={form[name]}
          onChange={(e) => set({ [name]: e.target.value })}
        />
      )}
    </FormField>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add Instructor Qualification"
      size="md"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-1 rounded-lg px-4 py-2 text-sm"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Adding...' : 'Add Qualification'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormLevelError message={fieldErrors.formError} />
        <div>
          <FormField id={QUALIFICATION_FIELDS.user_id.id} label="Member" required error={fieldErrors.errors.user_id}>
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={form.user_id}
                onChange={(e) => set({ user_id: e.target.value })}
                disabled={membersLoading}
              >
                <option value="">{membersLoading ? 'Loading members...' : 'Select a member...'}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {displayNameOf(m) || m.username}
                    {m.membership_number ? ` (#${m.membership_number})` : ''}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {membersError && (
            <p className={`mt-1 text-xs ${FIELD_ERROR_CLASS}`} role="alert">
              {membersError}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={QUALIFICATION_FIELDS.qualification_type.id}
            label="Qualification Type"
            required
            error={fieldErrors.errors.qualification_type}
          >
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={form.qualification_type}
                onChange={(e) => set({ qualification_type: e.target.value as InstructorQualificationType })}
              >
                {QUALIFICATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {textField('certification_level', 50, 'e.g. Level I, Level II')}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {textField('certification_number', 100, 'Cert #')}
          {textField('issuing_agency', 255, 'e.g. State Fire Marshal')}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {dateField('issued_date')}
          {dateField('expiration_date')}
        </div>
      </div>
    </Modal>
  );
};

// ==================== Add Exercise Modal ====================

interface AddExerciseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EXERCISE_TYPES = [
  { value: 'joint_training', label: 'Joint Training' },
  { value: 'mutual_aid_drill', label: 'Mutual Aid Drill' },
  { value: 'regional_exercise', label: 'Regional Exercise' },
  { value: 'tabletop', label: 'Tabletop' },
  { value: 'full_scale', label: 'Full Scale' },
] as const;

type ExerciseField =
  | 'exercise_name'
  | 'exercise_type'
  | 'exercise_date'
  | 'description'
  | 'lead_agency'
  | 'total_participants'
  | 'org_name';

// Limits mirror MultiAgencyTrainingBase and ParticipatingOrganization (255 each).
const EXERCISE_FIELDS: FieldSpecs<ExerciseField> = {
  exercise_name: { id: 'exercise-name', label: 'Exercise Name' },
  exercise_type: { id: 'exercise-type', label: 'Exercise Type' },
  exercise_date: { id: 'exercise-date', label: 'Exercise Date' },
  description: { id: 'exercise-description', label: 'Description' },
  lead_agency: { id: 'exercise-lead-agency', label: 'Lead Agency' },
  total_participants: { id: 'exercise-total-participants', label: 'Total Participants' },
  // A refusal on the one organization the form sends arrives as
  // participating_organizations.0.name, whose last key is `name`.
  org_name: { id: 'exercise-organization-name', label: 'Organization Name', apiKeys: ['name'] },
};

interface ExerciseForm {
  exerciseName: string;
  exerciseType: MultiAgencyTrainingCreate['exercise_type'];
  description: string;
  exerciseDate: string;
  leadAgency: string;
  totalParticipants: string;
  nimsCompliant: boolean;
  orgName: string;
  orgRole: ParticipatingOrganization['role'];
}

const AddExerciseModal: React.FC<AddExerciseModalProps> = ({ isOpen, onClose, onSaved }) => {
  const tz = useTimezone();
  const [saving, setSaving] = useState(false);
  const emptyForm = useMemo<ExerciseForm>(
    () => ({
      exerciseName: '',
      exerciseType: 'joint_training',
      description: '',
      exerciseDate: getTodayLocalDate(tz),
      leadAgency: '',
      totalParticipants: '',
      nimsCompliant: false,
      orgName: '',
      orgRole: 'participant',
    }),
    [tz]
  );
  const [form, setForm] = useState(emptyForm);
  const fieldErrors = useFieldErrors(EXERCISE_FIELDS);
  const { clear } = fieldErrors;
  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(form) !== JSON.stringify(emptyForm),
    onClose,
  });

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm);
      clear();
    }
  }, [isOpen, emptyForm, clear]);

  const set = (patch: Partial<ExerciseForm>, field?: ExerciseField) => {
    setForm((f) => ({ ...f, ...patch }));
    if (field) fieldErrors.setError(field, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems: FieldErrors<ExerciseField> = {};
    if (!form.exerciseName.trim()) problems.exercise_name = 'Give the exercise a name.';
    if (!form.exerciseDate) problems.exercise_date = 'Enter the date of the exercise.';
    const participantsProblem = wholeNumberProblem(form.totalParticipants, 0);
    if (participantsProblem) problems.total_participants = participantsProblem;
    setSaving(true);
    try {
      const orgs: ParticipatingOrganization[] = form.orgName.trim()
        ? [{ name: form.orgName.trim(), role: form.orgRole }]
        : [];
      const data: MultiAgencyTrainingCreate = {
        exercise_name: form.exerciseName.trim(),
        exercise_type: form.exerciseType,
        description: form.description.trim() || undefined,
        exercise_date: form.exerciseDate,
        lead_agency: form.leadAgency.trim() || undefined,
        total_participants: form.totalParticipants ? Number(form.totalParticipants) : undefined,
        nims_compliant: form.nimsCompliant || undefined,
        participating_organizations: orgs,
      };
      const created = await createUnlessFlagged(
        fieldErrors,
        problems,
        () => multiAgencyService.createExercise(data),
        'Failed to create exercise'
      );
      if (created) {
        toast.success('Exercise created');
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add Multi-Agency Exercise"
      size="lg"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      footer={
        <>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-1 rounded-lg px-4 py-2 text-sm"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Exercise'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormLevelError message={fieldErrors.formError} />
        <FormField
          id={EXERCISE_FIELDS.exercise_name.id}
          label="Exercise Name"
          required
          error={fieldErrors.errors.exercise_name}
          maxLength={255}
          count={form.exerciseName.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputClass}
              value={form.exerciseName}
              onChange={(e) => set({ exerciseName: e.target.value }, 'exercise_name')}
              placeholder="e.g. Regional MCI Drill"
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={EXERCISE_FIELDS.exercise_type.id}
            label="Exercise Type"
            required
            error={fieldErrors.errors.exercise_type}
          >
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={form.exerciseType}
                onChange={(e) =>
                  set({ exerciseType: e.target.value as MultiAgencyTrainingCreate['exercise_type'] }, 'exercise_type')
                }
              >
                {EXERCISE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={EXERCISE_FIELDS.exercise_date.id}
            label="Exercise Date"
            required
            error={fieldErrors.errors.exercise_date}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="date"
                value={form.exerciseDate}
                onChange={(e) => set({ exerciseDate: e.target.value }, 'exercise_date')}
              />
            )}
          </FormField>
        </div>
        <FormField id={EXERCISE_FIELDS.description.id} label="Description" error={fieldErrors.errors.description}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              value={form.description}
              onChange={(e) => set({ description: e.target.value }, 'description')}
              rows={2}
              placeholder="Exercise scenario and objectives..."
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={EXERCISE_FIELDS.lead_agency.id}
            label="Lead Agency"
            error={fieldErrors.errors.lead_agency}
            maxLength={255}
            count={form.leadAgency.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                value={form.leadAgency}
                onChange={(e) => set({ leadAgency: e.target.value }, 'lead_agency')}
                placeholder="e.g. County Fire Authority"
              />
            )}
          </FormField>
          <FormField
            id={EXERCISE_FIELDS.total_participants.id}
            label="Total Participants"
            error={fieldErrors.errors.total_participants}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                min="0"
                step="1"
                value={form.totalParticipants}
                onChange={(e) => set({ totalParticipants: e.target.value }, 'total_participants')}
                placeholder="# of participants"
              />
            )}
          </FormField>
        </div>
        <fieldset className="border-theme-surface-border rounded-lg border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">Participating Organization</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={EXERCISE_FIELDS.org_name.id}
              label="Organization Name"
              error={fieldErrors.errors.org_name}
              maxLength={255}
              count={form.orgName.length}
            >
              {(field) => (
                <input
                  {...field}
                  className={inputClass}
                  value={form.orgName}
                  onChange={(e) => set({ orgName: e.target.value }, 'org_name')}
                  placeholder="Agency name"
                />
              )}
            </FormField>
            <div>
              <label htmlFor="exercise-role" className="form-label">
                Role
              </label>
              <select
                id="exercise-role"
                className={selectClass}
                value={form.orgRole}
                onChange={(e) => set({ orgRole: e.target.value as ParticipatingOrganization['role'] })}
              >
                <option value="host">Host</option>
                <option value="participant">Participant</option>
                <option value="observer">Observer</option>
                <option value="evaluator">Evaluator</option>
              </select>
            </div>
          </div>
          <p className="text-theme-text-muted mt-2 text-xs">
            Additional organizations can be added after creating the exercise.
          </p>
        </fieldset>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="nims-compliant"
            checked={form.nimsCompliant}
            onChange={(e) => set({ nimsCompliant: e.target.checked })}
            className="border-theme-surface-border rounded"
          />
          <label htmlFor="nims-compliant" className="text-theme-text-secondary text-sm">
            NIMS/ICS Compliant
          </label>
        </div>
      </div>
    </Modal>
  );
};

// ==================== Section Components ====================

const RecertificationSection: React.FC = () => {
  const loadRecertData = useCallback(async () => {
    const [pathwaysData, tasksData] = await Promise.all([
      recertificationService.getPathways(),
      recertificationService.getMyRenewalTasks(),
    ]);
    return { pathways: pathwaysData, renewalTasks: tasksData };
  }, []);
  const {
    data,
    loading,
    reload: loadData,
  } = useLoadData(loadRecertData, { pathways: [] as RecertificationPathway[], renewalTasks: [] as RenewalTask[] });
  const { pathways, renewalTasks } = data;
  const [showAddModal, setShowAddModal] = useState(false);
  const { busy: generateBusy, run: runGenerate } = useSubmitGuard();

  const handleGenerateTasks = () =>
    runGenerate(async () => {
      try {
        const result = await recertificationService.generateRenewalTasks();
        toast.success(`Generated ${result.tasks_created} renewal tasks`);
        void loadData();
      } catch {
        toast.error('Failed to generate renewal tasks');
      }
    });

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Recertification Pathways</h2>
          <p className="text-theme-text-muted text-sm">
            Define renewal requirements for expiring certifications (NREMT, ACLS, etc.)
          </p>
        </div>
        <div className="split-row-aside flex flex-col gap-2 sm:flex-row">
          <button
            disabled={generateBusy}
            onClick={() => {
              void handleGenerateTasks();
            }}
            className="btn-secondary flex items-center gap-1 rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Generate Tasks</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Add Pathway</span>
          </button>
        </div>
      </div>

      {pathways.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={Award}
          title="No recertification pathways configured yet."
          description="Create pathways to define how members renew expiring certifications."
        />
      ) : (
        <div className="grid gap-4">
          {pathways.map((pathway) => (
            <div key={pathway.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-theme-text-primary font-medium">{pathway.name}</h3>
                  {pathway.description && <p className="text-theme-text-muted mt-1 text-sm">{pathway.description}</p>}
                  <div className="text-theme-text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span>Type: {pathway.renewal_type}</span>
                    {pathway.required_hours && <span>Hours: {pathway.required_hours}</span>}
                    <span>Window: {pathway.renewal_window_days} days</span>
                    {pathway.grace_period_days > 0 && <span>Grace: {pathway.grace_period_days} days</span>}
                  </div>
                </div>
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs ${
                    pathway.active
                      ? 'bg-green-500/10 text-green-800 dark:text-green-400'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {pathway.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {renewalTasks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-theme-text-primary mb-3 text-sm font-medium">Active Renewal Tasks</h3>
          <div className="space-y-2">
            {renewalTasks.map((task) => (
              <div
                key={task.id}
                className="card-secondary flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <span className="text-theme-text-primary text-sm">{task.pathway_name || 'Renewal'}</span>
                  <span className="text-theme-text-muted ml-2 text-xs">
                    Expires: {task.certification_expiration_date}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="bg-theme-surface-secondary h-2 w-24 rounded-full">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${task.progress_percentage}%` }} />
                  </div>
                  <span className="text-theme-text-muted text-xs">{Math.round(task.progress_percentage)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddPathwayModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {
          void loadData();
        }}
      />
    </div>
  );
};

const CompetencySection: React.FC = () => {
  const loadMatricesData = useCallback(() => competencyService.getMatrices(), []);
  const { data: matrices, loading, reload: loadData } = useLoadData(loadMatricesData, [] as CompetencyMatrix[]);
  const [showAddModal, setShowAddModal] = useState(false);

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Competency Matrices</h2>
          <p className="text-theme-text-muted text-sm">
            Define required skill levels by position (Dreyfus model: novice to expert)
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="split-row-aside btn-primary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Add Matrix</span>
        </button>
      </div>

      {matrices.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={TrendingUp}
          title="No competency matrices configured."
          description="Create matrices to map positions to required skill levels per NFPA 1021/1041."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {matrices.map((matrix) => (
            <div key={matrix.id} className="card-secondary p-4">
              <h3 className="text-theme-text-primary font-medium">{matrix.name}</h3>
              <p className="text-theme-text-muted mt-1 text-xs">Position: {matrix.position}</p>
              <p className="text-theme-text-muted text-xs">Skills: {matrix.skill_requirements.length} requirements</p>
            </div>
          ))}
        </div>
      )}

      <CompetencyHeatmap />

      <AddMatrixModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {
          void loadData();
        }}
      />
    </div>
  );
};

const InstructorsSection: React.FC = () => {
  const tz = useTimezone();
  const loadQualData = useCallback(() => instructorService.getQualifications(), []);
  const {
    data: qualifications,
    loading,
    reload: loadData,
  } = useLoadData(loadQualData, [] as InstructorQualification[]);
  const [showAddModal, setShowAddModal] = useState(false);
  const today = getTodayLocalDate(tz);

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Instructor Qualifications</h2>
          <p className="text-theme-text-muted text-sm">Track who is qualified to instruct and evaluate per NFPA 1041</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="split-row-aside btn-primary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Add Qualification</span>
        </button>
      </div>

      {qualifications.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={BookOpen}
          title="No instructor qualifications recorded."
          description="Add qualifications to track who can instruct which courses and evaluate which skills."
        />
      ) : (
        <div className="rwd-table-container overflow-x-auto">
          <table className="rwd-table rwd-table-wide w-full text-sm">
            <thead>
              <tr className="text-theme-text-muted border-theme-surface-border border-b text-left text-xs">
                <th scope="col" className="pr-4 pb-2">
                  Instructor
                </th>
                <th scope="col" className="pr-4 pb-2">
                  Type
                </th>
                <th scope="col" className="pr-4 pb-2">
                  Qualifies for
                </th>
                <th scope="col" className="pr-4 pb-2">
                  Level
                </th>
                <th scope="col" className="pr-4 pb-2">
                  Cert #
                </th>
                <th scope="col" className="pr-4 pb-2">
                  Expires
                </th>
                <th scope="col" className="pb-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {qualifications.map((qual) => (
                <tr key={qual.id} className="border-theme-surface-border/50 border-b">
                  <td data-label="Instructor" className="text-theme-text-primary py-2 pr-4">
                    {qual.user_name || qual.user_id}
                  </td>
                  {/* The stored values are snake_case (`lead_instructor`), so
                      `capitalize` alone leaves the underscore on screen. */}
                  <td data-label="Type" className="py-2 pr-4 capitalize">
                    {qual.qualification_type.replace(/_/g, ' ')}
                  </td>
                  <td data-label="Qualifies for" className="py-2 pr-4">
                    {qual.course_name || qual.skill_name || '-'}
                  </td>
                  <td data-label="Level" className="py-2 pr-4">
                    {qual.certification_level || '-'}
                  </td>
                  <td data-label="Cert #" className="py-2 pr-4">
                    {qual.certification_number || '-'}
                  </td>
                  <td data-label="Expires" className="py-2 pr-4">
                    {qual.expiration_date ? formatDate(qual.expiration_date, tz) : '-'}
                  </td>
                  <td data-label="Status" className="py-2">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs ${QUALIFICATION_STANDING[qualificationStanding(qual, today)].className}`}
                    >
                      {QUALIFICATION_STANDING[qualificationStanding(qual, today)].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddQualificationModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {
          void loadData();
        }}
      />
    </div>
  );
};

const KIRKPATRICK_LEVELS: {
  key: EvaluationLevel;
  level: string;
  desc: string;
  icon: typeof FileText;
  color: string;
}[] = [
  {
    key: 'reaction',
    level: 'Level 1: Reaction',
    desc: 'Post-training surveys',
    icon: FileText,
    color: 'text-blue-500',
  },
  {
    key: 'learning',
    level: 'Level 2: Learning',
    desc: 'Pre/post assessments',
    icon: BookOpen,
    color: 'text-green-500',
  },
  {
    key: 'behavior',
    level: 'Level 3: Behavior',
    desc: 'On-the-job observation',
    icon: Users,
    color: 'text-yellow-500',
  },
  { key: 'results', level: 'Level 4: Results', desc: 'Organizational impact', icon: BarChart3, color: 'text-red-500' },
];

const EffectivenessSection: React.FC = () => {
  const tz = useTimezone();
  const loadEvalData = useCallback(() => effectivenessService.getEvaluations(), []);
  const {
    data: evaluations,
    loading,
    reload: reloadEvaluations,
  } = useLoadData(loadEvalData, [] as TrainingEffectivenessEvaluation[]);
  // Pick the member first, then record the evaluation for them, so the form
  // never asks for a raw member id and no modal opens on top of another.
  const [pickingMember, setPickingMember] = useState(false);
  const [evaluatedMember, setEvaluatedMember] = useState<{ userId: string; memberName: string } | null>(null);

  const countByLevel = (level: EvaluationLevel) => evaluations.filter((ev) => ev.evaluation_level === level).length;

  const avgRatingByLevel = (level: EvaluationLevel): string => {
    const levelEvals = evaluations.filter((ev) => ev.evaluation_level === level && ev.overall_rating != null);
    if (levelEvals.length === 0) return '-';
    const sum = levelEvals.reduce((acc, ev) => acc + (ev.overall_rating ?? 0), 0);
    return (sum / levelEvals.length).toFixed(1);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Training Effectiveness</h2>
          <p className="text-theme-text-muted text-sm">
            Kirkpatrick Model evaluation: Reaction, Learning, Behavior, Results
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickingMember(true)}
          className="split-row-aside btn-primary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Submit Evaluation</span>
        </button>
      </div>

      <MemberPickerModal
        isOpen={pickingMember}
        onClose={() => setPickingMember(false)}
        onSelect={(member) => {
          setPickingMember(false);
          setEvaluatedMember(member);
        }}
        title="Whose training are you evaluating?"
      />
      <EffectivenessEvaluationModal
        isOpen={evaluatedMember !== null}
        onClose={() => setEvaluatedMember(null)}
        onSaved={() => void reloadEvaluations()}
        member={evaluatedMember}
      />

      <StatGrid columns={4} gap={4}>
        {KIRKPATRICK_LEVELS.map((item) => {
          const Icon = item.icon;
          const count = countByLevel(item.key);
          const avg = avgRatingByLevel(item.key);
          return (
            <div key={item.level} className="card-secondary p-4 text-center">
              <Icon className={`mx-auto mb-2 h-8 w-8 ${item.color}`} />
              <h3 className="text-theme-text-primary text-sm font-medium">{item.level}</h3>
              <p className="text-theme-text-muted mt-1 text-xs">{item.desc}</p>
              <div className="border-theme-surface-border mt-2 border-t pt-2">
                <span className="text-theme-text-primary text-lg font-semibold">{count}</span>
                <span className="text-theme-text-muted ml-1 text-xs">evaluation{count !== 1 ? 's' : ''}</span>
                {avg !== '-' && <p className="text-theme-text-muted mt-0.5 text-xs">Avg rating: {avg}/5</p>}
              </div>
            </div>
          );
        })}
      </StatGrid>

      {evaluations.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={BarChart3}
          title="No effectiveness evaluations recorded yet."
          description="Members can submit post-training surveys. Pre/post assessments measure knowledge gain."
        />
      ) : (
        <div>
          <h3 className="text-theme-text-primary mb-3 text-sm font-medium">Recent Evaluations</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-theme-text-muted border-theme-surface-border border-b text-left text-xs">
                  <th scope="col" className="pr-4 pb-2">
                    Level
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    Rating
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    Knowledge Gain
                  </th>
                  <th scope="col" className="pb-2">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {evaluations.slice(0, 20).map((ev) => (
                  <tr key={ev.id} className="border-theme-surface-border/50 border-b">
                    <td className="text-theme-text-primary py-2 pr-4 capitalize">{ev.evaluation_level}</td>
                    <td className="py-2 pr-4">{ev.overall_rating != null ? `${ev.overall_rating}/5` : '-'}</td>
                    <td className="py-2 pr-4">
                      {ev.knowledge_gain_percentage != null ? (
                        <span
                          className={
                            ev.knowledge_gain_percentage >= 0 ? 'text-green-700 dark:text-green-600' : 'text-red-600'
                          }
                        >
                          {ev.knowledge_gain_percentage > 0 ? '+' : ''}
                          {/* Computed as a ratio of two scores, so it arrives
                              with full float precision (58.620689655…). */}
                          {ev.knowledge_gain_percentage.toFixed(1)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="text-theme-text-muted py-2">{formatDate(ev.created_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const MultiAgencySection: React.FC = () => {
  const tz = useTimezone();
  const loadExerciseData = useCallback(() => multiAgencyService.getExercises(), []);
  const { data: exercises, loading, reload: loadData } = useLoadData(loadExerciseData, [] as MultiAgencyTraining[]);
  const [showAddModal, setShowAddModal] = useState(false);

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Multi-Agency Training</h2>
          <p className="text-theme-text-muted text-sm">
            Joint exercises, mutual aid drills, and regional training per NFPA 1500 / NIMS
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="split-row-aside btn-primary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Add Exercise</span>
        </button>
      </div>

      {exercises.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={Globe}
          title="No multi-agency exercises recorded."
          description="Log joint training exercises with other departments, mutual aid drills, and regional exercises."
        />
      ) : (
        <div className="grid gap-4">
          {exercises.map((exercise) => (
            <div key={exercise.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-theme-text-primary font-medium">{exercise.exercise_name}</h3>
                  <div className="text-theme-text-muted mt-1 flex items-center space-x-3 text-xs">
                    <span className="capitalize">{exercise.exercise_type.replace(/_/g, ' ')}</span>
                    <span>{formatDate(exercise.exercise_date, tz)}</span>
                    {exercise.total_participants && <span>{exercise.total_participants} participants</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {exercise.participating_organizations.map((org, i) => (
                      <span
                        key={i}
                        className="bg-theme-surface-secondary text-theme-text-muted rounded-sm px-2 py-0.5 text-xs"
                      >
                        {org.name} ({org.role})
                      </span>
                    ))}
                  </div>
                </div>
                {exercise.nims_compliant && (
                  <span className="rounded-sm bg-green-500/10 px-2 py-0.5 text-xs text-green-800 dark:text-green-400">
                    NIMS Compliant
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddExerciseModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {
          void loadData();
        }}
      />
    </div>
  );
};

const ReportsSection: React.FC = () => {
  const tz = useTimezone();
  const [forecasts, setForecasts] = useState<ComplianceForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signatureLines, setSignatureLines] = useState(false);
  const [memberRecordsPeriod, setMemberRecordsPeriod] = useState<TrainingExportPeriod>(TrainingExportPeriod.YEAR);

  const handleExport = async (reportType: string) => {
    setExporting(true);
    try {
      const blob = await reportExportService.exportReport({
        report_type: reportType as 'compliance' | 'hours_summary' | 'certification',
        format: 'csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_report_${reportType}_${getTodayLocalDate(tz)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setExporting(false);
    }
  };

  const handleMemberRecordsExport = async (format: 'csv' | 'pdf') => {
    setExporting(true);
    try {
      const window = getTrainingPeriodWindow(memberRecordsPeriod, tz);
      const blob = await reportExportService.exportReport({
        report_type: 'member_records',
        format,
        start_date: window.start_date,
        end_date: window.end_date,
        ...(format === 'pdf' && signatureLines ? { signature_lines: true } : {}),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_member_records_${memberRecordsPeriod}_${getTodayLocalDate(tz)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to generate report'));
    } finally {
      setExporting(false);
    }
  };

  const handleLoadForecast = async () => {
    setLoading(true);
    try {
      const data: unknown = await reportExportService.getComplianceForecast();
      if (!isForecastReport(data)) throw new TypeError('The compliance forecast response was not a report');
      setForecasts(data.members);
    } catch {
      toast.error('Failed to load forecast');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Reports & Analytics</h2>
        <p className="text-theme-text-muted text-sm">
          Export compliance reports, individual training records, and view predictive forecasts
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => void handleExport('compliance')}
          disabled={exporting}
          className="card-secondary hover:bg-theme-surface-hover p-4 text-left"
        >
          <Download className="mb-2 h-6 w-6 text-blue-500" />
          <h3 className="text-theme-text-primary text-sm font-medium">Compliance Report</h3>
          <p className="text-theme-text-muted mt-1 text-xs">
            Each member's current standing on every requirement, as the Compliance Matrix shows it, with training hours
            and records since January 1
          </p>
        </button>

        <button
          onClick={() => void handleExport('hours_summary')}
          disabled={exporting}
          className="card-secondary hover:bg-theme-surface-hover p-4 text-left"
        >
          <Download className="mb-2 h-6 w-6 text-green-500" />
          <h3 className="text-theme-text-primary text-sm font-medium">Hours Summary</h3>
          <p className="text-theme-text-muted mt-1 text-xs">
            Training hours by member, category, and type for state reporting
          </p>
        </button>

        <button
          onClick={() => void handleExport('certification')}
          disabled={exporting}
          className="card-secondary hover:bg-theme-surface-hover p-4 text-left"
        >
          <Download className="mb-2 h-6 w-6 text-yellow-500" />
          <h3 className="text-theme-text-primary text-sm font-medium">Certification Report</h3>
          <p className="text-theme-text-muted mt-1 text-xs">
            All certifications with expiration status and renewal tracking
          </p>
        </button>
      </div>

      <div className="border-theme-surface-border border-t pt-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-theme-text-primary text-sm font-medium">Member Records (All Members)</h3>
            <p className="text-theme-text-muted text-xs">
              Every member&apos;s completed training records for the selected period
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Member records period"
              value={memberRecordsPeriod}
              onChange={(e) => setMemberRecordsPeriod(e.target.value as TrainingExportPeriod)}
              className="form-input px-3 text-sm"
            >
              {Object.values(TrainingExportPeriod).map((p) => (
                <option key={p} value={p}>
                  {TRAINING_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
            <SignatureLinesOption checked={signatureLines} onChange={setSignatureLines} disabled={exporting} />
            <button
              onClick={() => {
                void handleMemberRecordsExport('csv');
              }}
              disabled={exporting}
              className="btn-secondary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>CSV</span>
            </button>
            <button
              onClick={() => {
                void handleMemberRecordsExport('pdf');
              }}
              disabled={exporting}
              className="btn-secondary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="border-theme-surface-border border-t pt-6">
        <div className="split-row mb-4 gap-3 sm:items-center">
          <div className="split-row-main">
            <h3 className="text-theme-text-primary text-sm font-medium">Compliance Forecast</h3>
            <p className="text-theme-text-muted text-xs">
              Each member's standing 30, 60 and 90 days from now if nothing new is logged
            </p>
          </div>
          <button
            onClick={() => {
              void handleLoadForecast();
            }}
            disabled={loading}
            className="split-row-aside btn-secondary flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            <span>Load Forecast</span>
          </button>
        </div>

        {forecasts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="text-theme-text-muted border-theme-surface-border border-b text-left text-xs">
                  <th scope="col" className="pr-4 pb-2">
                    Member
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    Current
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    30 Days
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    60 Days
                  </th>
                  <th scope="col" className="pr-4 pb-2">
                    90 Days
                  </th>
                  <th scope="col" className="pb-2">
                    At Risk
                  </th>
                </tr>
              </thead>
              <tbody>
                {forecasts.map((f) => (
                  <tr key={f.user_id} className="border-theme-surface-border/50 border-b">
                    <td data-label="Member" className="text-theme-text-primary py-2 pr-4">
                      {f.user_name || f.user_id}
                    </td>
                    <td data-label="Current" className="py-2 pr-4">
                      {f.current_compliance_percentage === null ? (
                        // No requirement grades this member.
                        <span className="text-theme-text-muted">N/A</span>
                      ) : (
                        // The server's standing for this figure, by the
                        // member's profile or the department's thresholds
                        // (CLAUDE.md pitfall #29).
                        <span className={STANDING_TEXT_COLORS[f.current_standing]}>
                          {f.current_compliance_percentage}%
                        </span>
                      )}
                    </td>
                    <td data-label="30 Days" className="py-2 pr-4">
                      {f.forecast_30_days === null ? (
                        <span className="text-theme-text-muted">N/A</span>
                      ) : (
                        // An estimate, classified by the member's grading
                        // like the current figure.
                        <span className={STANDING_TEXT_COLORS[f.forecast_30_standing]}>{f.forecast_30_days}%</span>
                      )}
                    </td>
                    <td data-label="60 Days" className="py-2 pr-4">
                      {f.forecast_60_days === null ? (
                        <span className="text-theme-text-muted">N/A</span>
                      ) : (
                        // An estimate, classified by the member's grading
                        // like the current figure.
                        <span className={STANDING_TEXT_COLORS[f.forecast_60_standing]}>{f.forecast_60_days}%</span>
                      )}
                    </td>
                    <td data-label="90 Days" className="py-2 pr-4">
                      {f.forecast_90_days === null ? (
                        <span className="text-theme-text-muted">N/A</span>
                      ) : (
                        // An estimate, classified by the member's grading
                        // like the current figure.
                        <span className={STANDING_TEXT_COLORS[f.forecast_90_standing]}>{f.forecast_90_days}%</span>
                      )}
                    </td>
                    <td data-label="At Risk" className="py-2">
                      {f.at_risk_requirements.length > 0 && (
                        <span className="text-xs text-red-500">
                          {f.at_risk_requirements.length} requirement{f.at_risk_requirements.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== Main Component ====================

interface TrainingEnhancementsTabProps {
  activeTab: string;
}

export const TrainingEnhancementsTab: React.FC<TrainingEnhancementsTabProps> = ({ activeTab }) => {
  return (
    <div className="py-6">
      {activeTab === 'recertification' && <RecertificationSection />}
      {activeTab === 'competency' && <CompetencySection />}
      {activeTab === 'instructors' && <InstructorsSection />}
      {activeTab === 'effectiveness' && <EffectivenessSection />}
      {activeTab === 'multi-agency' && <MultiAgencySection />}
      {activeTab === 'reports' && <ReportsSection />}
    </div>
  );
};

export default TrainingEnhancementsTab;
