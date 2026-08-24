import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { ArrowLeft, Info, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
import {
  AttachmentField,
  Checklist,
  DEFAULT_DURATION_MINUTES,
  DURATION_STEP_MINUTES,
  DurationStepper,
  FieldLabel,
  MIN_DURATION_MINUTES,
  Overline,
  RevisionNotice,
  SectionCard,
  StatusBadge,
  SubmissionReceipt,
  UNCONFIGURED_MAX_HOURS,
  attachmentRejection,
  durationToHours,
  formatDuration,
  minutesToTime,
  timeToMinutes,
} from '../components/training/submit';
import type { ChecklistRow, Receipt } from '../components/training/submit';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTimezone } from '../hooks/useTimezone';
import { trainingProgramService, trainingSubmissionService, trainingService } from '../services/api';
import { blankToNull } from '../utils/formValues';
import { formatCalendarDate, formatTimeOfDay, getTodayLocalDate } from '../utils/dateFormatting';
import { formatHours } from '../utils/hoursFormatting';
import type {
  SelfReportConfig,
  SubmissionAttachment,
  SubmissionStatus,
  TrainingCategory,
  TrainingRequirementEnhanced,
  TrainingSubmission,
  TrainingSubmissionCreate,
  TrainingSubmissionUpdate,
  TrainingType,
} from '../types/training';

// ==================== Constants ====================

const TRAINING_TYPES: { value: TrainingType; label: string }[] = [
  { value: 'certification', label: 'Certification' },
  { value: 'continuing_education', label: 'Continuing Education' },
  { value: 'skills_practice', label: 'Skills Practice' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'refresher', label: 'Refresher' },
  { value: 'specialty', label: 'Specialty' },
];

/**
 * Which fields the redesigned form asks for when the department has not said
 * otherwise. An explicit `field_config` entry from the org's settings still
 * wins — these are only the defaults for a field nobody has configured.
 */
const REQUIRED_BY_DEFAULT: Record<string, boolean> = {
  course_name: true,
  training_type: true,
  category_id: true,
  completion_date: true,
  instructor: true,
  description: true,
  certification_number: true,
  // Optional, matching the backend's own default config and the officer's
  // settings screen: plenty of certifications never expire, and a department
  // that wants the date can mark it required.
  expiration_date: false,
  issuing_agency: false,
  location: false,
  attachments: false,
};

const EDITABLE_STATUSES: SubmissionStatus[] = ['draft', 'pending_review', 'revision_requested'];

/** Placeholder id the API service returns for a submission queued while offline. */
const OFFLINE_SUBMISSION_ID = 'pending-sync';

// ==================== Submission Form ====================

interface SubmissionFormProps {
  config: SelfReportConfig;
  categories: TrainingCategory[];
  requirements: TrainingRequirementEnhanced[];
  submissions: TrainingSubmission[];
  onSaved: (continueEditing?: TrainingSubmission) => void;
  onEdit: (submission: TrainingSubmission) => void;
  onDelete: (submissionId: string) => void;
  editSubmission?: TrainingSubmission | null;
  onCancelEdit?: () => void;
}

const SubmissionForm: React.FC<SubmissionFormProps> = ({
  config,
  categories,
  requirements,
  submissions,
  onSaved,
  onEdit,
  onDelete,
  editSubmission,
  onCancelEdit,
}) => {
  const navigate = useNavigate();
  const timezone = useTimezone();
  const isEdit = !!editSubmission;

  // Offered in the department's own order, so the type they listed first is
  // the one the form opens on.
  const allowedTypes = useMemo(() => {
    const allowed = config.allowed_training_types;
    // An empty list is a department that has restricted nothing, not one that
    // has banned every type — leaving the select with no options at all.
    if (!allowed?.length) return TRAINING_TYPES;
    return allowed
      .map((value) => TRAINING_TYPES.find((type) => type.value === value))
      .filter((type): type is (typeof TRAINING_TYPES)[number] => !!type);
  }, [config.allowed_training_types]);
  const defaultTrainingType: TrainingType =
    (config.allowed_training_types?.[0] as TrainingType | undefined) ?? 'continuing_education';
  const maxDurationMinutes = (config.max_hours_per_submission || UNCONFIGURED_MAX_HOURS) * 60;

  const [courseName, setCourseName] = useState('');
  const [trainingType, setTrainingType] = useState<TrainingType>(defaultTrainingType);
  const [categoryId, setCategoryId] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(Math.min(DEFAULT_DURATION_MINUTES, maxDurationMinutes));
  const [instructor, setInstructor] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [hasCertification, setHasCertification] = useState(defaultTrainingType === 'certification');
  const [certificationNumber, setCertificationNumber] = useState('');
  const [issuingAgency, setIssuingAgency] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  // Plenty of certifications never expire. Asking is the only way the form can
  // know whether a department that requires an expiry date should be enforced
  // here, so the member says so rather than being blocked or inventing a date.
  const [certificationNeverExpires, setCertificationNeverExpires] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [storedAttachments, setStoredAttachments] = useState<SubmissionAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState('');
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [showAllSubmissions, setShowAllSubmissions] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // Once the member touches the certification checkbox it is theirs: changing
  // the training type must never take the cert block away underneath them,
  // which is the unpredictability this redesign set out to remove.
  const certificationTouched = useRef(false);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = (name: string) => (el: HTMLElement | null) => {
    fieldRefs.current[name] = el;
  };

  useEffect(() => {
    if (!editSubmission) return;
    // Defaults, not decoration: a create response is echoed straight back
    // into this form to keep editing a draft, and a partial one would
    // otherwise drop `undefined` into a field the render calls .trim() on.
    setCourseName(editSubmission.course_name || '');
    setTrainingType(editSubmission.training_type || defaultTrainingType);
    setCategoryId(editSubmission.category_id || '');
    setCompletionDate(editSubmission.completion_date || '');
    setInstructor(editSubmission.instructor || '');
    setLocation(editSubmission.location || '');
    setDescription(editSubmission.description || '');
    setCertificationNumber(editSubmission.certification_number || '');
    setIssuingAgency(editSubmission.issuing_agency || '');
    setExpirationDate(editSubmission.expiration_date || '');
    // Never inferred from an absent date. A submission an officer sent back
    // *because* the expiry was missing would otherwise reopen with "does not
    // expire" already ticked and the field disabled — answering for the member,
    // and letting them resubmit without the date they were asked for.
    setCertificationNeverExpires(false);
    setStoredAttachments(editSubmission.attachments ?? []);
    // Reported start times are kept now. 09:00 is the fallback only for rows
    // written before the column existed, which genuinely have none.
    setStartTime(editSubmission.start_time?.slice(0, 5) || '09:00');
    setDurationMinutes(
      Math.min(
        maxDurationMinutes,
        Math.max(MIN_DURATION_MINUTES, Math.round((editSubmission.hours_completed || 0) * 60))
      )
    );
    const hasCertData = !!(
      editSubmission.certification_number ||
      editSubmission.issuing_agency ||
      editSubmission.expiration_date
    );
    certificationTouched.current = true;
    setHasCertification(hasCertData || editSubmission.training_type === 'certification');
    setReceipt(null);
    setError('');
    setAttemptedSave(false);
  }, [editSubmission, maxDurationMinutes, defaultTrainingType]);

  // Seed the certification block from the training type, until the member says
  // otherwise. `certification` all but always earns one; nothing else does.
  useEffect(() => {
    if (certificationTouched.current) return;
    setHasCertification(trainingType === 'certification');
  }, [trainingType]);

  const fc = config.field_config ?? {};
  const isFieldVisible = (name: string) => fc[name]?.visible !== false;
  const isFieldRequired = (name: string) => fc[name]?.required ?? REQUIRED_BY_DEFAULT[name] ?? false;
  const fieldLabel = (name: string, fallback: string) => fc[name]?.label || fallback;

  const parentCategories = useMemo(() => categories.filter((c) => !c.parent_category_id), [categories]);
  const showCategory = isFieldVisible('category_id') && parentCategories.length > 0;
  // `attachments` is a field in the department's config like any other: an
  // officer who hides supporting documents should not still be offered them.
  const showAttachmentField = isFieldVisible('attachments');
  const attachmentRequired = isFieldRequired('attachments');

  // Every active requirement, deduped by name — the datalist is a set of
  // suggestions, not a filter, so it is no longer narrowed by training type
  // and picking one is never required.
  const suggestions = useMemo(
    () =>
      requirements
        .filter((requirement) => requirement.active)
        .filter((requirement, index, all) => all.findIndex((match) => match.name === requirement.name) === index)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [requirements]
  );

  const hours = durationToHours(durationMinutes);
  const startMinutes = timeToMinutes(startTime);
  const endTime = startMinutes === null ? '' : minutesToTime(startMinutes + durationMinutes);
  const runsPastMidnight = startMinutes !== null && startMinutes + durationMinutes >= 24 * 60;
  const endNote = endTime
    ? `Runs ${formatTimeOfDay(startTime)} to ${formatTimeOfDay(endTime)}${
        runsPastMidnight ? ' the next day' : ''
      }. Adjust in 15-minute steps.`
    : 'Set a start time to see the end time.';
  // At the ceiling the member is not doing anything wrong — a longer course is
  // simply logged a day at a time, so say that instead of leaving a dead button.
  const atMaxDuration = durationMinutes >= maxDurationMinutes;

  const checklist: ChecklistRow[] = [
    { id: 'course_name', label: 'Course name', ok: !!courseName.trim(), required: true },
    { id: 'training_type', label: 'Training type', ok: !!trainingType, required: isFieldRequired('training_type') },
    ...(showCategory
      ? [{ id: 'category_id', label: 'Category', ok: !!categoryId, required: isFieldRequired('category_id') }]
      : []),
    {
      id: 'completion_date',
      label: 'Date and length',
      ok: !!completionDate && !!startTime,
      required: true,
    },
    ...(isFieldVisible('instructor')
      ? [
          {
            id: 'instructor',
            label: 'Instructor',
            ok: !!instructor.trim(),
            required: isFieldRequired('instructor'),
          },
        ]
      : []),
    ...(isFieldVisible('description')
      ? [
          {
            id: 'description',
            label: 'What it covered',
            ok: !!description.trim(),
            required: isFieldRequired('description'),
          },
        ]
      : []),
  ];
  const remaining = checklist.filter((row) => row.required && !row.ok).length;

  /**
   * Ids of required fields the member has not filled in yet. Course name and
   * date are asked for whatever `field_config` says: they are NOT NULL columns,
   * so letting the form call them optional only trades an inline mark for a
   * 422 after the round trip.
   */
  const findMissingFields = (): string[] => {
    const missing: string[] = [];
    if (!courseName.trim()) missing.push('course_name');
    if (showCategory && isFieldRequired('category_id') && !categoryId) missing.push('category_id');
    if (!completionDate) missing.push('completion_date');
    if (!startTime) missing.push('start_time');
    if (isFieldVisible('instructor') && isFieldRequired('instructor') && !instructor.trim()) {
      missing.push('instructor');
    }
    if (isFieldVisible('location') && isFieldRequired('location') && !location.trim()) {
      missing.push('location');
    }
    if (isFieldVisible('description') && isFieldRequired('description') && !description.trim()) {
      missing.push('description');
    }
    if (hasCertification) {
      if (
        isFieldVisible('certification_number') &&
        isFieldRequired('certification_number') &&
        !certificationNumber.trim()
      ) {
        missing.push('certification_number');
      }
      if (isFieldVisible('issuing_agency') && isFieldRequired('issuing_agency') && !issuingAgency.trim()) {
        missing.push('issuing_agency');
      }
      if (
        isFieldVisible('expiration_date') &&
        isFieldRequired('expiration_date') &&
        !certificationNeverExpires &&
        !expirationDate
      ) {
        missing.push('expiration_date');
      }
    }
    if (showAttachmentField && isFieldRequired('attachments') && !attachment && storedAttachments.length === 0) {
      missing.push('attachments');
    }
    return missing;
  };

  const certificationValues = {
    certification_number: hasCertification ? certificationNumber : '',
    issuing_agency: hasCertification ? issuingAgency : '',
    expiration_date: hasCertification && !certificationNeverExpires ? expirationDate : '',
  };

  /** Create payload: blanks are omitted so `""` never reaches a validator. */
  const buildCreatePayload = (saveAsDraft: boolean): TrainingSubmissionCreate => ({
    course_name: courseName.trim(),
    training_type: trainingType,
    completion_date: completionDate,
    start_time: startTime || undefined,
    hours_completed: hours,
    credit_hours: hours,
    description: description.trim() || undefined,
    instructor: instructor.trim() || undefined,
    location: location.trim() || undefined,
    category_id: categoryId || undefined,
    certification_number: certificationValues.certification_number.trim() || undefined,
    issuing_agency: certificationValues.issuing_agency.trim() || undefined,
    expiration_date: certificationValues.expiration_date || undefined,
    ...(saveAsDraft ? { save_as_draft: true } : {}),
  });

  /**
   * Update payload: every field the form owns travels on every save, and a
   * field the member cleared travels as an explicit null. Omitting it would
   * leave the old value in place behind a success toast.
   */
  const buildUpdatePayload = (): TrainingSubmissionUpdate => ({
    course_name: courseName.trim(),
    training_type: trainingType,
    completion_date: completionDate,
    start_time: blankToNull(startTime),
    hours_completed: hours,
    credit_hours: hours,
    description: blankToNull(description),
    instructor: blankToNull(instructor),
    location: blankToNull(location),
    category_id: blankToNull(categoryId),
    certification_number: blankToNull(certificationValues.certification_number),
    issuing_agency: blankToNull(certificationValues.issuing_agency),
    expiration_date: blankToNull(certificationValues.expiration_date),
  });

  const uploadAttachmentIfAny = async (
    submissionId: string
  ): Promise<{ name: string; attachments: SubmissionAttachment[] } | null> => {
    if (!attachment) return null;
    // An offline submission has no server id yet; the queued create flushes
    // without the file, so say so rather than dropping it silently.
    if (!submissionId || submissionId === OFFLINE_SUBMISSION_ID) {
      toast.error('Saved offline — attach the certificate once you are back online.');
      return null;
    }
    try {
      const result = await trainingSubmissionService.uploadAttachment(submissionId, attachment);
      const name = attachment.name;
      // Consumed: saving again must not attach the same file a second time.
      setAttachment(null);
      const attachments = result.attachments ?? [];
      setStoredAttachments(attachments);
      return { name, attachments };
    } catch {
      toast.error('Training saved, but the certificate did not upload. Open the submission to try again.');
      return null;
    }
  };

  const buildReceipt = (attachedName: string | null, approved: boolean): Receipt => {
    const typeLabel = TRAINING_TYPES.find((t) => t.value === trainingType)?.label ?? trainingType;
    const categoryName = parentCategories.find((c) => c.id === categoryId)?.name;
    const when = `${formatCalendarDate(completionDate, { month: 'short', day: 'numeric' })}, ${formatTimeOfDay(
      startTime
    )} – ${formatTimeOfDay(endTime)}`;
    const rows = [
      { key: 'Course', value: courseName.trim() },
      { key: 'Type', value: categoryName ? `${typeLabel} · ${categoryName}` : typeLabel },
      { key: 'When', value: when },
      { key: 'Hours', value: formatDuration(durationMinutes) },
      { key: 'Instructor', value: instructor.trim() || '—' },
      { key: 'Attached', value: attachedName ?? 'Nothing attached' },
    ];
    return { rows, approved };
  };

  const resetForm = useCallback(() => {
    setCourseName('');
    setTrainingType(defaultTrainingType);
    setCategoryId('');
    setCompletionDate('');
    setStartTime('09:00');
    setDurationMinutes(Math.min(DEFAULT_DURATION_MINUTES, maxDurationMinutes));
    setInstructor('');
    setLocation('');
    setDescription('');
    certificationTouched.current = false;
    setHasCertification(defaultTrainingType === 'certification');
    setCertificationNumber('');
    setIssuingAgency('');
    setExpirationDate('');
    setCertificationNeverExpires(false);
    setAttachment(null);
    setAttachmentError('');
    setStoredAttachments([]);
    setAttemptedSave(false);
    setError('');
  }, [defaultTrainingType, maxDurationMinutes]);

  const save = async (options: { asDraft: boolean }) => {
    setError('');
    // A draft is a half-finished note, so only the two columns the API cannot
    // store without are asked for; a real submission needs everything.
    const missing = options.asDraft
      ? [...(courseName.trim() ? [] : ['course_name']), ...(completionDate ? [] : ['completion_date'])]
      : findMissingFields();
    setAttemptedSave(true);
    if (missing.length > 0) {
      if (options.asDraft) setError('A draft still needs a course name and a date.');
      fieldRefs.current[missing[0] ?? '']?.focus();
      return;
    }

    const setBusy = options.asDraft ? setIsSavingDraft : setIsSubmitting;
    setBusy(true);
    // A submission the department auto-approves is frozen the moment it exists
    // — the attachment endpoint refuses it, and its training record has already
    // been copied from it. So a new submission carrying a file goes through the
    // multipart create, which attaches the evidence inside the same transaction
    // that routes it. Offline has no such route: the queued create carries JSON
    // only, and uploadAttachmentIfAny says so.
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const attachOnCreate = !!attachment && !offline;
    try {
      if (isEdit && editSubmission) {
        await trainingSubmissionService.updateSubmission(editSubmission.id, buildUpdatePayload());
        const uploaded = await uploadAttachmentIfAny(editSubmission.id);
        if (options.asDraft) {
          toast.success('Draft saved');
          // Stay on the draft: saving again has to update this one, not file
          // a second copy of the same class. Carry the upload's own metadata,
          // since the submission in hand predates it.
          onSaved(uploaded ? { ...editSubmission, attachments: uploaded.attachments } : editSubmission);
        } else if (editSubmission.status === 'draft') {
          const submitted = await trainingSubmissionService.submitDraft(editSubmission.id);
          setReceipt(buildReceipt(uploaded?.name ?? null, submitted.status === 'approved'));
          resetForm();
          onSaved();
        } else {
          toast.success('Submission updated');
          onSaved();
        }
      } else {
        const payload = buildCreatePayload(options.asDraft);
        const attachedName = attachOnCreate && attachment ? attachment.name : null;
        const created =
          attachOnCreate && attachment
            ? await trainingSubmissionService.createSubmissionWithAttachment(payload, attachment)
            : await trainingSubmissionService.createSubmission(payload);
        const queuedOffline = created.id === OFFLINE_SUBMISSION_ID;
        // Only the offline path can still be holding an unsent file.
        const uploaded = attachOnCreate ? null : await uploadAttachmentIfAny(created.id);
        if (attachOnCreate) setAttachment(null);

        if (options.asDraft) {
          toast.success('Draft saved. It stays in your list until you submit it.');
          // A queued offline create has no server id yet, so there is nothing
          // to keep editing — later saves would PATCH `/pending-sync`.
          const savedDraft = uploaded ? { ...created, attachments: uploaded.attachments } : created;
          onSaved(queuedOffline ? undefined : savedDraft);
        } else {
          setReceipt(buildReceipt(attachedName ?? uploaded?.name ?? null, created.status === 'approved'));
          resetForm();
          onSaved();
        }
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to submit training');
    } finally {
      setBusy(false);
    }
  };

  // Marks are recomputed from the current values, so a field stops being red
  // the moment the member fills it in rather than at the next submit attempt.
  const missingNow = attemptedSave ? findMissingFields() : [];
  const invalidClass = (name: string) =>
    missingNow.includes(name) ? 'border-red-600 focus:border-red-600 dark:border-red-500' : '';

  if (receipt) {
    return (
      <SubmissionReceipt
        receipt={receipt}
        onSubmitAnother={() => setReceipt(null)}
        onDone={() => void navigate('/training')}
      />
    );
  }

  const recentSubmissions = showAllSubmissions ? submissions : submissions.slice(0, 3);
  const submitLabel = isEdit ? 'Update Submission' : 'Submit Training';

  // The rail and the phone action bar are the same button in two places, so
  // each gets its own label — "Submit Training" where there is room for it,
  // "Submit" in the bar, as the design has them.
  const submitButton = (label: string, extraClass: string) => (
    <button
      type="submit"
      disabled={isSubmitting || isSavingDraft}
      className={`btn-primary flex w-full items-center justify-center gap-2 text-sm font-semibold ${extraClass}`}
    >
      <Send className="h-4 w-4" />
      <span>{isSubmitting ? 'Submitting...' : label}</span>
    </button>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save({ asDraft: false });
      }}
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]"
    >
      <div className="flex flex-col gap-4">
        {config.member_instructions && (
          <div className="alert-info flex items-start gap-2.5">
            <Info className="text-theme-alert-info-icon mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-theme-alert-info-text text-sm">{config.member_instructions}</p>
          </div>
        )}

        {isEdit && editSubmission && (
          <div className="card-secondary flex flex-wrap items-center justify-between gap-3 p-3">
            <p className="text-theme-text-secondary text-sm">
              Editing your submission for <span className="font-medium">{editSubmission.course_name}</span>
            </p>
            {onCancelEdit && (
              <button type="button" onClick={onCancelEdit} className="btn-secondary text-sm">
                Cancel
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="alert-danger text-theme-alert-danger-text text-sm" role="alert">
            {error}
          </div>
        )}

        {/* ---------- The class ---------- */}
        <SectionCard title="The Class">
          <div>
            <FieldLabel htmlFor="course-name" required>
              {fieldLabel('course_name', 'Course or class name')}
            </FieldLabel>
            <input
              id="course-name"
              ref={registerField('course_name')}
              type="text"
              list="dept-requirement-suggestions"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="Start typing — suggestions appear"
              className={`form-input ${invalidClass('course_name')}`}
              autoComplete="off"
            />
            <datalist id="dept-requirement-suggestions">
              {suggestions.map((requirement) => (
                <option key={requirement.id} value={requirement.name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="training-type" required={isFieldRequired('training_type')}>
                {fieldLabel('training_type', 'Training type')}
              </FieldLabel>
              <select
                id="training-type"
                value={trainingType}
                onChange={(e) => setTrainingType(e.target.value as TrainingType)}
                className="form-input"
              >
                {allowedTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {showCategory && (
              <div>
                <FieldLabel htmlFor="training-category" required={isFieldRequired('category_id')}>
                  {fieldLabel('category_id', 'Category')}
                </FieldLabel>
                <select
                  id="training-category"
                  ref={registerField('category_id')}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={`form-input ${invalidClass('category_id')}`}
                >
                  <option value="">Select...</option>
                  {parentCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ---------- When ---------- */}
        <SectionCard title="When">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="completion-date" required>
                {fieldLabel('completion_date', 'Date')}
              </FieldLabel>
              <input
                id="completion-date"
                ref={registerField('completion_date')}
                type="date"
                value={completionDate}
                max={getTodayLocalDate(timezone)}
                onChange={(e) => setCompletionDate(e.target.value)}
                className={`form-input font-mono ${invalidClass('completion_date')}`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="start-time" required>
                Start time
              </FieldLabel>
              <input
                id="start-time"
                ref={registerField('start_time')}
                type="time"
                step={DURATION_STEP_MINUTES * 60}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`form-input font-mono ${invalidClass('start_time')}`}
              />
            </div>
          </div>

          <div>
            <p className="form-label" id="duration-label">
              How long did it run?
              <span className="text-red-700 dark:text-red-400" aria-hidden="true">
                {' '}
                *
              </span>
            </p>
            <div role="group" aria-labelledby="duration-label">
              <DurationStepper
                minutes={durationMinutes}
                maxMinutes={maxDurationMinutes}
                onChange={setDurationMinutes}
              />
            </div>
            <p className="text-theme-text-muted mt-2 text-xs">{endNote}</p>
            {atMaxDuration && (
              <p className="text-theme-text-muted mt-1 text-xs">
                {formatDuration(maxDurationMinutes)} is the longest one entry can run
                {config.max_hours_per_submission ? ' in this department' : ''}. Log a longer course one day at a time.
              </p>
            )}
          </div>
        </SectionCard>

        {/* ---------- Details ---------- */}
        <SectionCard title="Details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isFieldVisible('instructor') && (
              <div>
                <FieldLabel
                  htmlFor="instructor"
                  required={isFieldRequired('instructor')}
                  optional={!isFieldRequired('instructor')}
                >
                  {fieldLabel('instructor', 'Instructor')}
                </FieldLabel>
                <input
                  id="instructor"
                  ref={registerField('instructor')}
                  type="text"
                  value={instructor}
                  onChange={(e) => setInstructor(e.target.value)}
                  placeholder="Name or agency"
                  className={`form-input ${invalidClass('instructor')}`}
                />
              </div>
            )}

            {isFieldVisible('location') && (
              <div>
                <FieldLabel
                  htmlFor="location"
                  required={isFieldRequired('location')}
                  optional={!isFieldRequired('location')}
                >
                  {fieldLabel('location', 'Location')}
                </FieldLabel>
                <input
                  id="location"
                  ref={registerField('location')}
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Facility or address"
                  className={`form-input ${invalidClass('location')}`}
                />
              </div>
            )}
          </div>

          {isFieldVisible('description') && (
            <div>
              <FieldLabel htmlFor="description" required={isFieldRequired('description')}>
                {fieldLabel('description', 'What it covered')}
              </FieldLabel>
              <textarea
                id="description"
                ref={registerField('description')}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A sentence or two is enough."
                className={`form-input resize-y ${invalidClass('description')}`}
              />
            </div>
          )}

          <label className="mobile-touch-target flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={hasCertification}
              onChange={(e) => {
                certificationTouched.current = true;
                setHasCertification(e.target.checked);
              }}
              className="form-checkbox h-[18px] w-[18px]"
            />
            <span className="text-theme-text-secondary text-sm font-medium">This training earned a certification</span>
          </label>

          {hasCertification && (
            <div className="alert-info animate-scale-in grid grid-cols-1 gap-3 sm:grid-cols-3">
              {isFieldVisible('certification_number') && (
                <div>
                  <FieldLabel htmlFor="certification-number" required={isFieldRequired('certification_number')}>
                    {fieldLabel('certification_number', 'Certificate no.')}
                  </FieldLabel>
                  <input
                    id="certification-number"
                    ref={registerField('certification_number')}
                    type="text"
                    value={certificationNumber}
                    onChange={(e) => setCertificationNumber(e.target.value)}
                    className={`form-input font-mono ${invalidClass('certification_number')}`}
                  />
                </div>
              )}
              {isFieldVisible('issuing_agency') && (
                <div>
                  <FieldLabel
                    htmlFor="issuing-agency"
                    required={isFieldRequired('issuing_agency')}
                    optional={!isFieldRequired('issuing_agency')}
                  >
                    {fieldLabel('issuing_agency', 'Agency')}
                  </FieldLabel>
                  <input
                    id="issuing-agency"
                    ref={registerField('issuing_agency')}
                    type="text"
                    value={issuingAgency}
                    onChange={(e) => setIssuingAgency(e.target.value)}
                    placeholder="VDFP, NREMT..."
                    className={`form-input ${invalidClass('issuing_agency')}`}
                  />
                </div>
              )}
              {isFieldVisible('expiration_date') && (
                <div>
                  <FieldLabel
                    htmlFor="expiration-date"
                    required={isFieldRequired('expiration_date') && !certificationNeverExpires}
                    optional={!isFieldRequired('expiration_date') && !certificationNeverExpires}
                  >
                    {fieldLabel('expiration_date', 'Expires')}
                  </FieldLabel>
                  <input
                    id="expiration-date"
                    ref={registerField('expiration_date')}
                    type="date"
                    value={certificationNeverExpires ? '' : expirationDate}
                    disabled={certificationNeverExpires}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className={`form-input font-mono disabled:opacity-50 ${invalidClass('expiration_date')}`}
                  />
                  {/* Whether an expiry is required follows the certification,
                      not a blanket rule: a department can ask for the date and
                      still take a credential that never expires. */}
                  <label className="mobile-touch-target mt-1 flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={certificationNeverExpires}
                      onChange={(e) => setCertificationNeverExpires(e.target.checked)}
                      className="form-checkbox"
                    />
                    <span className="text-theme-text-muted text-xs">Does not expire</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {storedAttachments.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {storedAttachments.map((stored) => (
                <li key={stored.index} className="flex items-center gap-2 text-sm">
                  <Paperclip className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                  <a
                    href={
                      editSubmission
                        ? trainingSubmissionService.getAttachmentDownloadUrl(editSubmission.id, stored.index)
                        : '#'
                    }
                    className="text-theme-text-secondary link-underline truncate"
                  >
                    {stored.file_name || `Attachment ${stored.index + 1}`}
                  </a>
                  {editSubmission && (
                    <button
                      type="button"
                      aria-label={`Remove ${stored.file_name || 'attachment'}`}
                      onClick={() => {
                        const submissionId = editSubmission.id;
                        const index = stored.index;
                        void (async () => {
                          try {
                            await trainingSubmissionService.deleteAttachment(submissionId, index);
                            setStoredAttachments(await trainingSubmissionService.getAttachments(submissionId));
                          } catch {
                            toast.error('Failed to remove the attachment');
                          }
                        })();
                      }}
                      className="text-theme-text-muted hover:text-red-700 dark:hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* ---------- Recent submissions ---------- */}
        {submissions.length > 0 && (
          <SectionCard
            title="Recent Submissions"
            action={
              submissions.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowAllSubmissions((open) => !open)}
                  className="max-md:mobile-touch-target text-sm text-blue-700 dark:text-blue-400"
                >
                  {showAllSubmissions ? 'Show fewer' : `View all ${submissions.length}`}
                </button>
              ) : undefined
            }
          >
            <ul className="flex flex-col">
              {recentSubmissions.map((submission) => {
                const canEdit = EDITABLE_STATUSES.includes(submission.status);
                const meta = [
                  `${formatHours(submission.hours_completed)}h`,
                  formatCalendarDate(submission.completion_date, { month: 'short', day: 'numeric' }),
                  submission.issuing_agency || submission.instructor,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li
                    key={submission.id}
                    className="border-theme-surface-border flex flex-col gap-1 border-t py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    {/* Stacked on a phone: a badge and two 44px actions beside
                        the title leave about 200px for a course name, which
                        turns every row into an ellipsis. */}
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-sm font-medium">{submission.course_name}</p>
                      <p className="text-theme-text-muted text-xs">{meta}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                      <StatusBadge status={submission.status} />
                      {/* Shown on every listed row, not only in the expanded
                          list: a member with three submissions would otherwise
                          have no way to correct one at all. */}
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit(submission)}
                            aria-label={`Edit ${submission.course_name}`}
                            className="text-theme-text-muted hover:text-theme-text-primary max-md:mobile-touch-target rounded-sm p-1.5"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(submission.id)}
                            aria-label={`Delete ${submission.course_name}`}
                            className="text-theme-text-muted max-md:mobile-touch-target rounded-sm p-1.5 hover:text-red-700 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* ---------- Summary rail ----------
          A sticky column beside the form on a wide screen; below it on a
          phone, where the fixed bar carries the submit. Rendered once either
          way — the attachment and Save Draft have no second copy to keep in
          step, and no member loses them on a small screen. */}
      <aside className="card flex flex-col gap-4 p-5 lg:sticky lg:top-6">
        <Overline>This Submission</Overline>
        <div>
          <p className="text-theme-text-primary font-mono text-4xl leading-10 font-bold">
            {formatDuration(durationMinutes)}
          </p>
          <p className="text-theme-text-muted text-sm">{formatHours(hours)} hours toward your requirements</p>
        </div>
        <div className="divider" />
        <Checklist rows={checklist} />
        {showAttachmentField && (
          <AttachmentField
            id="training-attachment"
            file={attachment}
            error={attachmentError}
            required={attachmentRequired}
            invalid={missingNow.includes('attachments')}
            onSelect={(file) => {
              const rejection = file ? attachmentRejection(file) : null;
              setAttachmentError(rejection ?? '');
              setAttachment(rejection ? null : file);
            }}
          />
        )}
        <div className="hidden lg:block">{submitButton(submitLabel, '')}</div>
        {/* Nothing to draft once the department has the submission — from
            pending_review on, a save is an edit to something they can see. */}
        {(!isEdit || editSubmission?.status === 'draft') && (
          <button
            type="button"
            onClick={() => void save({ asDraft: true })}
            disabled={isSubmitting || isSavingDraft}
            className="btn-secondary w-full text-sm"
          >
            {isSavingDraft ? 'Saving...' : 'Save Draft'}
          </button>
        )}
        <p className="text-theme-text-muted text-xs">
          {config.require_approval
            ? 'A training officer reviews this before it lands on your record. You can edit it until then.'
            : 'This is recorded on your training record right away.'}
        </p>
      </aside>

      {/* ---------- Sticky action bar (phone) ---------- */}
      <div className="bg-theme-surface border-theme-surface-border action-bar-safe fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 shadow-lg lg:hidden">
        <div className="min-w-0">
          <p className="text-theme-text-primary font-mono text-xl font-bold">{formatDuration(durationMinutes)}</p>
          <p className="text-theme-text-muted text-xs">
            {remaining === 0 ? 'Ready to submit' : `${remaining} field${remaining === 1 ? '' : 's'} left`}
          </p>
        </div>
        <div className="flex-1">{submitButton(isEdit ? 'Update' : 'Submit', 'min-h-12')}</div>
      </div>
    </form>
  );
};

// ==================== Main Page ====================

const SubmitTrainingPage: React.FC = () => {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [config, setConfig] = useState<SelfReportConfig | null>(null);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [submissions, setSubmissions] = useState<TrainingSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<TrainingSubmission | null>(null);

  /**
   * `silent` refreshes the lists without swapping the page for the spinner.
   * A loud refresh after a save unmounts the form — and with it the receipt
   * the member is supposed to be reading, which is how the confirmation
   * screen managed to pass its test and never appear in a browser.
   */
  const loadData = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setLoadError(null);
    try {
      const [configData, categoriesData, submissionsData, requirementsData] = await Promise.all([
        trainingSubmissionService.getConfig(),
        trainingService.getCategories(),
        trainingSubmissionService.getMySubmissions(),
        // Suggestions enhance the free-text field but should never prevent a submission.
        trainingProgramService.getRequirementsEnhanced().catch(() => []),
      ]);
      setConfig(configData);
      setCategories(categoriesData);
      setSubmissions(submissionsData);
      setRequirements(requirementsData);
    } catch (_error) {
      // A failed background refresh must not replace a form the member is
      // still filling in — or a receipt they are still reading.
      if (!options.silent) setLoadError('Failed to load submission form. Please try again.');
      toast.error('Failed to load submission form');
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleDelete = async (submissionId: string) => {
    if (
      !(await confirm({
        title: 'Delete submission',
        message: 'Delete this training submission? This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await trainingSubmissionService.deleteSubmission(submissionId);
      toast.success('Submission deleted');
      if (editingSubmission?.id === submissionId) setEditingSubmission(null);
      void loadData({ silent: true });
    } catch {
      toast.error('Failed to delete submission');
    }
  };

  // The officer's note is the first thing a member should see when work comes
  // back — not a gray strip buried in a history list.
  const returnedSubmission = submissions.find((submission) => submission.status === 'revision_requested');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-red-500" />
          <p className="text-theme-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-500">{loadError || 'Unable to load configuration.'}</p>
          <button
            onClick={() => {
              void loadData();
            }}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8 pb-40 sm:px-6 lg:px-8 lg:pb-8">
        <div className="mb-6 flex items-start gap-3.5">
          <button
            onClick={() => void navigate('/training')}
            aria-label="Back to training"
            className="max-md:mobile-touch-target text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-theme-text-primary text-2xl leading-8 font-bold">Submit External Training</h1>
            <p className="text-theme-text-muted text-sm">Report training you completed outside the department.</p>
          </div>
        </div>

        {returnedSubmission && editingSubmission?.id !== returnedSubmission.id && (
          <RevisionNotice
            submission={returnedSubmission}
            onFix={() => {
              setEditingSubmission(returnedSubmission);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onWithdraw={() => {
              void handleDelete(returnedSubmission.id);
            }}
          />
        )}

        <SubmissionForm
          config={config}
          categories={categories}
          requirements={requirements}
          submissions={submissions}
          onSaved={(continueEditing) => {
            setEditingSubmission(continueEditing ?? null);
            void loadData({ silent: true });
          }}
          onEdit={(submission) => setEditingSubmission(submission)}
          onDelete={(submissionId) => {
            void handleDelete(submissionId);
          }}
          editSubmission={editingSubmission}
          onCancelEdit={() => setEditingSubmission(null)}
        />
      </main>
    </div>
  );
};

export default SubmitTrainingPage;
