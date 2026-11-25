import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import toast from 'react-hot-toast';
import {
  BookOpen,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Clock,
  Award,
  Filter,
  ChevronDown,
  ListOrdered,
  RotateCcw,
} from 'lucide-react';
import { trainingService } from '../services/api';
import { CourseSyllabusBuilder } from '../components/training/CourseSyllabusBuilder';
import { SkeletonCardGrid } from '../components/ux/Skeleton';
import { Pagination } from '../components/ux/Pagination';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuthStore } from '../stores/authStore';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants/config';
import { COURSE_QUALIFICATIONS } from '../constants/enums';
import { formCoercions } from '../utils/formValues';
import type { TrainingCourse, TrainingCourseCreate, TrainingCategory, TrainingType } from '../types/training';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import { ErrorSummary } from '../components/ux/ErrorSummary';
import { FIELD_ERROR_CLASS, FormField } from '../components/ux/FormField';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { firstRefused, saveExceptRefused } from '../utils/saveExceptRefused';

// ==================== Course Form Modal ====================

interface CourseFormModalProps {
  isOpen: boolean;
  course?: TrainingCourse | null; // null = create mode
  categories: TrainingCategory[];
  onClose: () => void;
  onSuccess: (course?: TrainingCourse) => void;
}

const TRAINING_TYPES: { value: TrainingType; label: string }[] = [
  { value: 'certification', label: 'Certification' },
  { value: 'continuing_education', label: 'Continuing Education' },
  { value: 'skills_practice', label: 'Skills Practice' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'refresher', label: 'Refresher' },
  { value: 'specialty', label: 'Specialty' },
  { value: 'policy_acknowledgment', label: 'Policy Acknowledgment' },
];

type CourseForm = {
  name: string;
  code: string;
  description: string;
  training_type: TrainingType;
  duration_hours: string;
  credit_hours: string;
  instructor: string;
  max_participants: string;
  expiration_months: string;
  grants_qualification: string;
  category_ids: string[];
  materials_required: string;
};

const EMPTY_COURSE_FORM: CourseForm = {
  name: '',
  code: '',
  description: '',
  training_type: 'continuing_education',
  duration_hours: '',
  credit_hours: '',
  instructor: '',
  max_participants: '',
  expiration_months: '',
  grants_qualification: '',
  category_ids: [],
  materials_required: '',
};

type CourseField = keyof CourseForm;

// Ordered as on screen, so the first refusal takes focus. Limits mirror
// TrainingCourseBase (name and instructor 255, code and qualification 50).
const COURSE_FIELDS: FieldSpecs<CourseField> = {
  name: { id: 'course-name', label: 'Course name' },
  code: { id: 'course-code', label: 'Course code' },
  description: { id: 'course-description', label: 'Description' },
  training_type: { id: 'course-training-type', label: 'Training type' },
  duration_hours: { id: 'course-duration-hours', label: 'Duration' },
  credit_hours: { id: 'course-credit-hours', label: 'Credit hours' },
  instructor: { id: 'course-instructor', label: 'Instructor' },
  max_participants: { id: 'course-max-participants', label: 'Max participants' },
  expiration_months: { id: 'course-expires-months', label: 'Expires after' },
  grants_qualification: { id: 'course-grants-qualification', label: 'Certifies' },
  category_ids: { id: 'course-categories', label: 'Training categories' },
  materials_required: { id: 'course-materials', label: 'Materials required' },
};
const COURSE_ORDER = Object.keys(COURSE_FIELDS) as CourseField[];
const COURSE_LIMITS = { name: 255, code: 50, instructor: 255 } as const;
const COURSE_LABEL_CLASS = 'text-theme-text-secondary mb-1 block text-sm font-medium';

function seedCourseForm(course: TrainingCourse | null | undefined): CourseForm {
  if (!course) return EMPTY_COURSE_FORM;
  return {
    name: course.name,
    code: course.code || '',
    description: course.description || '',
    training_type: course.training_type,
    duration_hours: course.duration_hours?.toString() || '',
    credit_hours: course.credit_hours?.toString() || '',
    instructor: course.instructor || '',
    max_participants: course.max_participants?.toString() || '',
    expiration_months: course.expiration_months?.toString() || '',
    grants_qualification: course.grants_qualification || '',
    category_ids: course.category_ids || [],
    materials_required: (course.materials_required || []).join('\n'),
  };
}

/** The checks the server makes too, said on the field before anything is sent. */
function checkCourseForm(form: CourseForm): FieldErrors<CourseField> {
  const problems: FieldErrors<CourseField> = {};
  if (!form.name.trim()) problems.name = 'Give the course a name.';
  const notNegative = (value: string) => value.trim() === '' || Number(value) >= 0;
  const wholeFrom = (value: string, min: number) =>
    value.trim() === '' || (Number.isInteger(Number(value)) && Number(value) >= min);
  if (!notNegative(form.duration_hours)) problems.duration_hours = 'Enter 0 or more hours, or leave it empty.';
  if (!notNegative(form.credit_hours)) problems.credit_hours = 'Enter 0 or more hours, or leave it empty.';
  if (!wholeFrom(form.max_participants, 1))
    problems.max_participants = 'Enter a whole number, 1 or more, or leave it empty.';
  if (!wholeFrom(form.expiration_months, 0))
    problems.expiration_months = 'Enter a whole number of months, or leave it empty for never.';
  return problems;
}

const CourseFormModal: React.FC<CourseFormModalProps> = ({ isOpen, course, categories, onClose, onSuccess }) => {
  const isEdit = !!course;
  const [formData, setFormData] = useState<CourseForm>(EMPTY_COURSE_FORM);
  // What the dialog held when it opened (or last saved), so Escape, the X and
  // Cancel ask before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<CourseForm>(EMPTY_COURSE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const courseErrors = useFieldErrors(COURSE_FIELDS);
  const { clear: clearErrors } = courseErrors;

  useEffect(() => {
    const seeded = seedCourseForm(course);
    setFormData(seeded);
    setBaseline(seeded);
    clearErrors();
  }, [course, isOpen, clearErrors]);

  const set = (patch: Partial<CourseForm>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    for (const key of Object.keys(patch)) courseErrors.setError(key as CourseField, null);
  };

  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(formData) !== JSON.stringify(baseline),
    onClose,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const problems = checkCourseForm(formData);
    courseErrors.setFormError(null);
    courseErrors.setErrors(problems);
    // A new course is not created until every field is fixed; an edit saves
    // the rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!isEdit && Object.keys(problems).length > 0) {
      courseErrors.focusFirst(problems);
      return;
    }
    setIsSubmitting(true);

    // On an edit every blank field goes out as null (an empty list for the
    // list fields): omitting the key means "leave it alone" to a
    // model_dump(exclude_unset=True) backend, so a cleared instructor or
    // expiry reported success and kept its old value.
    const { text, pick, num } = formCoercions(isEdit);
    const emptyList = isEdit ? [] : undefined;

    const payload = {
      name: formData.name.trim(),
      code: text(formData.code),
      description: text(formData.description),
      training_type: formData.training_type,
      duration_hours: num(formData.duration_hours),
      credit_hours: num(formData.credit_hours),
      instructor: text(formData.instructor),
      max_participants: num(formData.max_participants),
      expiration_months: num(formData.expiration_months),
      grants_qualification: pick(formData.grants_qualification),
      category_ids: formData.category_ids.length > 0 ? formData.category_ids : emptyList,
      materials_required: formData.materials_required
        ? formData.materials_required.split('\n').filter((m) => m.trim())
        : emptyList,
    };

    try {
      if (isEdit && course) {
        const { result: saved, refused } = await saveExceptRefused<CourseField, TrainingCourse>({
          payload,
          refused: problems,
          send: (body) => trainingService.updateCourse(course.id, body),
          place: (err) => placeApiError(COURSE_FIELDS, err),
        });
        const first = firstRefused(COURSE_ORDER, refused);
        if (first) {
          // The library refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          onSuccess(saved);
          courseErrors.setErrors(refused);
          courseErrors.setFormError(
            `Course saved, except ${COURSE_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          courseErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as CourseField]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Course updated');
        onSuccess(saved);
      } else {
        const saved = await trainingService.createCourse(payload as TrainingCourseCreate);
        toast.success('Course created');
        onSuccess(saved);
      }
      onClose();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the dialog.
      courseErrors.focusFirst(courseErrors.setFromApiError(err, `Failed to ${isEdit ? 'update' : 'create'} course`));
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCategory = (catId: string) => {
    set({
      category_ids: formData.category_ids.includes(catId)
        ? formData.category_ids.filter((id) => id !== catId)
        : [...formData.category_ids, catId],
    });
  };

  if (!isOpen) return null;

  // Only show parent categories for selection
  const parentCategories = categories.filter((c) => !c.parent_category_id);
  const { errors } = courseErrors;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-form-title"
    >
      <DialogPanel onClose={requestClose} className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="course-form-title" className="text-theme-text-primary text-xl font-bold">
            {isEdit ? 'Edit Course' : 'Add New Course'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            data-dialog-close
            className="text-theme-text-muted hover:text-theme-text-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 p-6"
        >
          <ErrorSummary items={courseErrors.summary} formError={courseErrors.formError} title="Check these fields" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              id={COURSE_FIELDS.name.id}
              label="Course Name"
              labelClassName={COURSE_LABEL_CLASS}
              required
              error={errors.name}
              maxLength={COURSE_LIMITS.name}
              count={formData.name.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.name}
                  onChange={(e) => set({ name: e.target.value })}
                  className="form-input text-sm"
                  placeholder="e.g., Firefighter I"
                />
              )}
            </FormField>
            <FormField
              id={COURSE_FIELDS.code.id}
              label="Course Code"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.code}
              maxLength={COURSE_LIMITS.code}
              count={formData.code.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                  className="form-input text-sm"
                  placeholder="e.g., FF1"
                />
              )}
            </FormField>
          </div>

          <FormField
            id={COURSE_FIELDS.description.id}
            label="Description"
            labelClassName={COURSE_LABEL_CLASS}
            error={errors.description}
          >
            {(field) => (
              <textarea
                {...field}
                value={formData.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={3}
                className="form-input text-sm"
                placeholder="Describe the course content, objectives, and target audience..."
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              id={COURSE_FIELDS.training_type.id}
              label="Training Type"
              labelClassName={COURSE_LABEL_CLASS}
              required
              error={errors.training_type}
            >
              {(field) => (
                <select
                  {...field}
                  value={formData.training_type}
                  onChange={(e) => set({ training_type: e.target.value as TrainingType })}
                  className="form-input text-sm"
                >
                  {TRAINING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              id={COURSE_FIELDS.duration_hours.id}
              label="Duration (hours)"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.duration_hours}
              hint="How long the class runs."
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  value={formData.duration_hours}
                  onChange={(e) => set({ duration_hours: e.target.value })}
                  className="form-input text-sm"
                  placeholder="e.g., 40"
                  min={0}
                  step={0.5}
                />
              )}
            </FormField>
            <FormField
              id={COURSE_FIELDS.credit_hours.id}
              label="Credit Hours"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.credit_hours}
              hint="The training hours a member is credited with, by a session of this course or by a mapped provider completion that reports no hours. Left blank, the course credits its duration."
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  value={formData.credit_hours}
                  onChange={(e) => set({ credit_hours: e.target.value })}
                  className="form-input text-sm"
                  placeholder="e.g., 40"
                  min={0}
                  step={0.5}
                />
              )}
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              id={COURSE_FIELDS.instructor.id}
              label="Instructor"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.instructor}
              maxLength={COURSE_LIMITS.instructor}
              count={formData.instructor.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={formData.instructor}
                  onChange={(e) => set({ instructor: e.target.value })}
                  className="form-input text-sm"
                  placeholder="Instructor name"
                />
              )}
            </FormField>
            <FormField
              id={COURSE_FIELDS.max_participants.id}
              label="Max Participants"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.max_participants}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  value={formData.max_participants}
                  onChange={(e) => set({ max_participants: e.target.value })}
                  className="form-input text-sm"
                  placeholder="Optional"
                  min={1}
                />
              )}
            </FormField>
            <FormField
              id={COURSE_FIELDS.expiration_months.id}
              label="Expires After (months)"
              labelClassName={COURSE_LABEL_CLASS}
              error={errors.expiration_months}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  value={formData.expiration_months}
                  onChange={(e) => set({ expiration_months: e.target.value })}
                  className="form-input text-sm"
                  placeholder="Never"
                  min={0}
                />
              )}
            </FormField>
          </div>

          <FormField
            id={COURSE_FIELDS.grants_qualification.id}
            label="Certifies"
            labelClassName={COURSE_LABEL_CLASS}
            error={errors.grants_qualification}
            hint="Completing this course grants the member this qualification, dated from the training record's completion and expiry. The qualification decides which shift positions they may fill, and stops counting on its own when the card lapses."
          >
            {(field) => (
              <select
                {...field}
                value={formData.grants_qualification}
                onChange={(e) => set({ grants_qualification: e.target.value })}
                className="form-input text-sm"
              >
                <option value="">Nothing — this course certifies no qualification</option>
                {COURSE_QUALIFICATIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          {/* Categories */}
          <div>
            <p id="course-categories-label" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Training Categories
            </p>
            <div
              id={COURSE_FIELDS.category_ids.id}
              tabIndex={-1}
              role="group"
              aria-labelledby="course-categories-label"
              aria-describedby={errors.category_ids ? 'course-categories-error' : undefined}
              className="flex flex-wrap gap-2"
            >
              {parentCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  aria-pressed={formData.category_ids.includes(cat.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    formData.category_ids.includes(cat.id)
                      ? 'bg-red-800 text-white'
                      : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            {errors.category_ids && (
              <p id="course-categories-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                {errors.category_ids}
              </p>
            )}
          </div>

          <FormField
            id={COURSE_FIELDS.materials_required.id}
            label="Materials Required (one per line)"
            labelClassName={COURSE_LABEL_CLASS}
            error={errors.materials_required}
          >
            {(field) => (
              <textarea
                {...field}
                value={formData.materials_required}
                onChange={(e) => set({ materials_required: e.target.value })}
                rows={3}
                className="form-input text-sm"
                placeholder="e.g., SCBA&#10;Bunker gear&#10;Notebook"
              />
            )}
          </FormField>

          <div className="border-theme-surface-border flex justify-end space-x-3 border-t pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary text-sm" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Update Course' : 'Create Course'}
            </button>
          </div>
        </form>
      </DialogPanel>
    </div>
  );
};

// ==================== Training Type Badge ====================

const TypeBadge: React.FC<{ type: TrainingType }> = ({ type }) => {
  const colors: Record<TrainingType, string> = {
    certification: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
    continuing_education: 'bg-green-500/20 text-green-800 dark:text-green-400',
    skills_practice: 'bg-purple-500/20 text-purple-700 dark:text-purple-400',
    orientation: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400',
    refresher: 'bg-orange-500/20 text-orange-800 dark:text-orange-400',
    specialty: 'bg-pink-500/20 text-pink-800 dark:text-pink-400',
    policy_acknowledgment: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
  };

  const labels: Record<TrainingType, string> = {
    certification: 'Certification',
    continuing_education: 'CE',
    skills_practice: 'Skills',
    orientation: 'Orientation',
    refresher: 'Refresher',
    specialty: 'Specialty',
    policy_acknowledgment: 'Policy',
  };

  return <span className={`rounded-sm px-2 py-0.5 text-xs ${colors[type]}`}>{labels[type]}</span>;
};

// ==================== Main Page ====================

// `embedded` renders the page as a tab inside TrainingAdminPage (which already
// provides the outer page chrome + title), so we drop the standalone
// min-h-screen wrapper and the big page header to avoid doubling them up.
const CourseLibraryPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { confirm } = useConfirm();
  // The catalog is readable by anyone in the training module; creating,
  // editing, deactivating and building a syllabus are all `training.manage`
  // on the backend, so the controls for them are gated on the same permission
  // rather than left visible to fail with a 403.
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canManage = checkPermission('training.manage');
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  // A deactivated course leaves the library, so an officer needs a way to
  // see it again to bring it back. Only managers are offered it; members see
  // the courses they can actually train on.
  const [showInactive, setShowInactive] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editCourse, setEditCourse] = useState<TrainingCourse | null>(null);

  // Syllabus panel — the classes that make up a multi-class course
  const [syllabusCourse, setSyllabusCourse] = useState<TrainingCourse | null>(null);
  // Resolver for the syllabus builder's inline "create a course" action, so
  // an officer can add a missing subject without leaving the builder.
  const [pendingCourseResolver, setPendingCourseResolver] = useState<((course: TrainingCourse | null) => void) | null>(
    null
  );

  const requestNewCourse = (): Promise<TrainingCourse | null> => {
    setEditCourse(null);
    setShowModal(true);
    return new Promise<TrainingCourse | null>((resolve) => {
      setPendingCourseResolver(() => resolve);
    });
  };

  const includeInactive = canManage && showInactive;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [coursesData, categoriesData] = await Promise.all([
        trainingService.getCourses(!includeInactive),
        trainingService.getCategories(),
      ]);
      setCourses(coursesData);
      setCategories(categoriesData);
    } catch (_error) {
      toast.error('Failed to load course library');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDelete = async (courseId: string, courseName: string) => {
    if (
      !(await confirm({
        title: 'Deactivate course',
        message: `Deactivate "${courseName}"? It will no longer be available for new training records. You can bring it back later from Filters → Show inactive courses.`,
        confirmLabel: 'Deactivate',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await trainingService.updateCourse(courseId, { active: false });
      toast.success('Course deactivated');
      void loadData();
    } catch {
      toast.error('Failed to deactivate course');
    }
  };

  const handleReactivate = async (courseId: string) => {
    try {
      await trainingService.updateCourse(courseId, { active: true });
      toast.success('Course reactivated');
      void loadData();
    } catch {
      toast.error('Failed to reactivate course');
    }
  };

  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      const matchesSearch =
        !searchTerm ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.description?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesType = !filterType || c.training_type === filterType;

      const matchesCategory = !filterCategory || (c.category_ids || []).includes(filterCategory);

      return matchesSearch && matchesType && matchesCategory;
    });
  }, [courses, searchTerm, filterType, filterCategory]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType, filterCategory]);

  const paginatedCourses = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCourses.slice(start, start + pageSize);
  }, [filteredCourses, currentPage, pageSize]);

  const parentCategories = categories.filter((c) => !c.parent_category_id);

  // Category lookup for display
  const catMap = useMemo(() => {
    const map: Record<string, TrainingCategory> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const addCourseButton = canManage ? (
    <button
      onClick={() => {
        setEditCourse(null);
        setShowModal(true);
      }}
      className="btn-primary flex items-center space-x-2"
    >
      <Plus className="h-5 w-5" />
      <span>Add Course</span>
    </button>
  ) : undefined;

  return (
    <div className={embedded ? '' : 'min-h-screen'}>
      <div data-page-main className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8'}>
        {/* Embedded, this is a Training Administration tab under the hub's own
            header, where a strip and trail would sit within the very hub the
            trail points at. */}
        {embedded ? (
          <div className="split-row mb-8 gap-4 sm:items-center">
            <p className="split-row-main text-theme-text-muted text-sm">
              Organization-wide training course catalog ({courses.length} course{courses.length !== 1 ? 's' : ''})
            </p>
            <div className="split-row-aside">{addCourseButton}</div>
          </div>
        ) : (
          <TrainingPageHeader
            icon={BookOpen}
            title="Course Library"
            subtitle={`The classes your department runs or recognizes (${courses.length} course${courses.length !== 1 ? 's' : ''})`}
            underHub="/training/admin"
            actions={addCourseButton}
          />
        )}

        {/* Search & Filters */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center space-x-3">
            <div className="relative flex-1">
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search courses by name, code, or description..."
                placeholder="Search courses by name, code, or description..."
                className="form-input pr-4 pl-10"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`touch:min-h-[44px] flex items-center space-x-2 rounded-lg border px-4 py-2 text-sm ${
                showFilters || filterType || filterCategory || includeInactive
                  ? 'border-red-500 bg-red-600/20 text-red-800 dark:text-red-400'
                  : 'bg-theme-surface-secondary border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showFilters && (
            <div className="card-secondary grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="course-filter-type"
                  className="text-theme-text-secondary mb-1 block text-sm font-medium"
                >
                  Training Type
                </label>
                <select
                  id="course-filter-type"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="form-input text-sm"
                >
                  <option value="">All Types</option>
                  {TRAINING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="course-filter-category"
                  className="text-theme-text-secondary mb-1 block text-sm font-medium"
                >
                  Category
                </label>
                <select
                  id="course-filter-category"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="form-input text-sm"
                >
                  <option value="">All Categories</option>
                  {parentCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              {canManage && (
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                  />
                  Show inactive courses
                </label>
              )}
            </div>
          )}
        </div>

        {/* Course Grid */}
        {loading ? (
          <SkeletonCardGrid count={6} />
        ) : filteredCourses.length === 0 ? (
          <div className="bg-theme-surface-secondary rounded-lg py-16 text-center">
            <BookOpen className="text-theme-text-secondary mx-auto mb-4 h-16 w-16" aria-hidden="true" />
            <p className="text-theme-text-muted mb-2 text-lg">
              {searchTerm || filterType || filterCategory
                ? 'No courses match your filters'
                : canManage
                  ? 'No courses in your library yet'
                  : 'Your department has not added any courses yet'}
            </p>
            {!canManage && !searchTerm && !filterType && !filterCategory && (
              <p className="text-theme-text-muted mx-auto max-w-xl px-6 text-sm">
                Once a training officer adds them, you can see here what each class covers and how many training hours
                it counts for.
              </p>
            )}
            {canManage && !searchTerm && !filterType && !filterCategory && (
              <button
                onClick={() => {
                  setEditCourse(null);
                  setShowModal(true);
                }}
                className="btn-primary mt-4"
              >
                Add Your First Course
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="card-grid gap-4 [--card-grid-min:22rem]">
              {paginatedCourses.map((course) => (
                <div key={course.id} className="card-secondary hover:bg-theme-surface-hover p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center space-x-2">
                        <h3 className="text-theme-text-primary font-semibold">{course.name}</h3>
                      </div>
                      {course.code && <span className="text-theme-text-muted font-mono text-xs">{course.code}</span>}
                    </div>
                    {canManage && (
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setSyllabusCourse(course)}
                          className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone rounded-sm p-1.5"
                          aria-label={`Manage classes for ${course.name}`}
                          title="Manage classes"
                        >
                          <ListOrdered className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditCourse(course);
                            setShowModal(true);
                          }}
                          className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone rounded-sm p-1.5"
                          aria-label={`Edit ${course.name}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {course.active ? (
                          <button
                            onClick={() => {
                              void handleDelete(course.id, course.name);
                            }}
                            className="text-theme-text-muted touch-target-phone rounded-sm p-1.5 hover:text-red-700 dark:hover:text-red-400"
                            aria-label={`Deactivate ${course.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              void handleReactivate(course.id);
                            }}
                            className="text-theme-text-muted touch-target-phone rounded-sm p-1.5 hover:text-green-700 dark:hover:text-green-400"
                            aria-label={`Reactivate ${course.name}`}
                            title="Reactivate"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {course.description && (
                    <p className="text-theme-text-muted mb-3 line-clamp-2 text-sm">{course.description}</p>
                  )}

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <TypeBadge type={course.training_type} />
                    {/* Which courses actually certify something is otherwise
                        invisible until you open each one. */}
                    {course.grants_qualification && (
                      <span className="rounded-sm bg-teal-500/15 px-2 py-0.5 text-xs text-teal-800 dark:text-teal-400">
                        Certifies:{' '}
                        {COURSE_QUALIFICATIONS.find((p) => p.value === course.grants_qualification)?.label ??
                          course.grants_qualification}
                      </span>
                    )}
                    {!course.active && (
                      <span className="rounded-sm bg-red-500/20 px-2 py-0.5 text-xs text-red-800 dark:text-red-400">
                        Inactive
                      </span>
                    )}
                  </div>

                  <div className="text-theme-text-muted flex items-center space-x-4 text-xs">
                    {course.duration_hours != null && (
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{course.duration_hours}h</span>
                      </div>
                    )}
                    {course.credit_hours != null && course.credit_hours !== course.duration_hours && (
                      <span>{course.credit_hours} credits</span>
                    )}
                    {course.expiration_months && (
                      <div className="flex items-center space-x-1">
                        <Award className="h-3 w-3" />
                        <span>Expires {course.expiration_months}mo</span>
                      </div>
                    )}
                  </div>

                  {/* Category chips */}
                  {course.category_ids && course.category_ids.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {course.category_ids.map((catId) => {
                        const cat = catMap[catId];
                        if (!cat) return null;
                        return (
                          <span
                            key={catId}
                            className="bg-theme-surface-secondary text-theme-text-secondary border-theme-surface-border rounded-full border px-2 py-0.5 text-xs"
                          >
                            {cat.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {filteredCourses.length > pageSize && (
              <Pagination
                currentPage={currentPage}
                totalItems={filteredCourses.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                className="mt-6"
              />
            )}
          </>
        )}
      </div>

      {canManage && (
        <>
          {syllabusCourse && (
            <div
              className="modal-overlay z-50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`Classes for ${syllabusCourse.name}`}
            >
              <DialogPanel
                onClose={() => setSyllabusCourse(null)}
                className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto"
              >
                <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
                  <div>
                    <h2 className="text-theme-text-primary text-xl font-bold">{syllabusCourse.name}</h2>
                    <p className="text-theme-text-muted text-sm">Classes that make up this course</p>
                  </div>
                  <button
                    data-dialog-close
                    onClick={() => {
                      setSyllabusCourse(null);
                      void loadData();
                    }}
                    className="text-theme-text-muted hover:text-theme-text-primary"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="modal-body">
                  <CourseSyllabusBuilder course={syllabusCourse} onCreateCourse={requestNewCourse} />
                </div>
              </DialogPanel>
            </div>
          )}

          {/* After the syllabus dialog on purpose: the builder's "Create a new
              course" opens this form over it, and at the same z-index the later
              element paints on top. Placed first, the form sat beneath the
              syllabus and took no clicks. */}
          <CourseFormModal
            isOpen={showModal}
            course={editCourse}
            categories={categories}
            onClose={() => {
              setShowModal(false);
              setEditCourse(null);
              // A dismissed modal must still settle the builder's promise.
              pendingCourseResolver?.(null);
              setPendingCourseResolver(null);
            }}
            onSuccess={(saved) => {
              void loadData();
              if (saved) pendingCourseResolver?.(saved);
              setPendingCourseResolver(null);
            }}
          />
        </>
      )}
    </div>
  );
};

export default CourseLibraryPage;
