import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, Plus, Search, Edit2, Trash2, X, Clock, Award, Filter, ChevronDown, ListOrdered } from 'lucide-react';
import { trainingService } from '../services/api';
import { CourseSyllabusBuilder } from '../components/training/CourseSyllabusBuilder';
import { SkeletonCardGrid } from '../components/ux/Skeleton';
import { Pagination } from '../components/ux/Pagination';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants/config';
import type {
  TrainingCourse,
  TrainingCourseCreate,
  TrainingCourseUpdate,
  TrainingCategory,
  TrainingType,
} from '../types/training';

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
];

const CourseFormModal: React.FC<CourseFormModalProps> = ({ isOpen, course, categories, onClose, onSuccess }) => {
  const isEdit = !!course;
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    training_type: 'continuing_education' as TrainingType,
    duration_hours: '',
    credit_hours: '',
    instructor: '',
    max_participants: '',
    expiration_months: '',
    category_ids: [] as string[],
    materials_required: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (course) {
      setFormData({
        name: course.name,
        code: course.code || '',
        description: course.description || '',
        training_type: course.training_type,
        duration_hours: course.duration_hours?.toString() || '',
        credit_hours: course.credit_hours?.toString() || '',
        instructor: course.instructor || '',
        max_participants: course.max_participants?.toString() || '',
        expiration_months: course.expiration_months?.toString() || '',
        category_ids: course.category_ids || [],
        materials_required: (course.materials_required || []).join('\n'),
      });
    } else {
      setFormData({
        name: '',
        code: '',
        description: '',
        training_type: 'continuing_education',
        duration_hours: '',
        credit_hours: '',
        instructor: '',
        max_participants: '',
        expiration_months: '',
        category_ids: [],
        materials_required: '',
      });
    }
    setError('');
  }, [course, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    const payload = {
      name: formData.name,
      ...(formData.code ? { code: formData.code } : {}),
      ...(formData.description ? { description: formData.description } : {}),
      training_type: formData.training_type,
      duration_hours: formData.duration_hours ? parseFloat(formData.duration_hours) : undefined,
      credit_hours: formData.credit_hours ? parseFloat(formData.credit_hours) : undefined,
      ...(formData.instructor ? { instructor: formData.instructor } : {}),
      max_participants: formData.max_participants ? parseInt(formData.max_participants) : undefined,
      expiration_months: formData.expiration_months ? parseInt(formData.expiration_months) : undefined,
      category_ids: formData.category_ids.length > 0 ? formData.category_ids : undefined,
      materials_required: formData.materials_required
        ? formData.materials_required.split('\n').filter((m) => m.trim())
        : undefined,
    };

    try {
      let saved: TrainingCourse;
      if (isEdit && course) {
        saved = await trainingService.updateCourse(course.id, payload as TrainingCourseUpdate);
        toast.success('Course updated successfully');
      } else {
        saved = await trainingService.createCourse(payload as TrainingCourseCreate);
        toast.success('Course created successfully');
      }
      onSuccess(saved);
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        `Failed to ${isEdit ? 'update' : 'create'} course`;
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCategory = (catId: string) => {
    setFormData((prev) => ({
      ...prev,
      category_ids: prev.category_ids.includes(catId)
        ? prev.category_ids.filter((id) => id !== catId)
        : [...prev.category_ids, catId],
    }));
  };

  if (!isOpen) return null;

  // Only show parent categories for selection
  const parentCategories = categories.filter((c) => !c.parent_category_id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-lg">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 className="text-theme-text-primary text-xl font-bold">{isEdit ? 'Edit Course' : 'Add New Course'}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 p-6"
        >
          {error && (
            <div className="rounded-sm border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                Course Name <span className="text-red-700 dark:text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="form-input text-sm"
                placeholder="e.g., Firefighter I"
                required
              />
            </div>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Course Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className="form-input text-sm"
                placeholder="e.g., FF1"
                maxLength={50}
              />
            </div>
          </div>

          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="form-input text-sm"
              placeholder="Describe the course content, objectives, and target audience..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Training Type *</label>
              <select
                value={formData.training_type}
                onChange={(e) => setFormData({ ...formData, training_type: e.target.value as TrainingType })}
                className="form-input text-sm"
              >
                {TRAINING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Duration (hours)</label>
              <input
                type="number"
                value={formData.duration_hours}
                onChange={(e) => setFormData({ ...formData, duration_hours: e.target.value })}
                className="form-input text-sm"
                placeholder="e.g., 40"
                min={0}
                step={0.5}
              />
            </div>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Credit Hours</label>
              <input
                type="number"
                value={formData.credit_hours}
                onChange={(e) => setFormData({ ...formData, credit_hours: e.target.value })}
                className="form-input text-sm"
                placeholder="e.g., 40"
                min={0}
                step={0.5}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Instructor</label>
              <input
                type="text"
                value={formData.instructor}
                onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                className="form-input text-sm"
                placeholder="Instructor name"
              />
            </div>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Max Participants</label>
              <input
                type="number"
                value={formData.max_participants}
                onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
                className="form-input text-sm"
                placeholder="Optional"
                min={1}
              />
            </div>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Expires After (months)</label>
              <input
                type="number"
                value={formData.expiration_months}
                onChange={(e) => setFormData({ ...formData, expiration_months: e.target.value })}
                className="form-input text-sm"
                placeholder="Never"
                min={1}
              />
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Training Categories</label>
            <div className="flex flex-wrap gap-2">
              {parentCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    formData.category_ids.includes(cat.id)
                      ? 'bg-red-600 text-white'
                      : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
              Materials Required (one per line)
            </label>
            <textarea
              value={formData.materials_required}
              onChange={(e) => setFormData({ ...formData, materials_required: e.target.value })}
              rows={3}
              className="form-input text-sm"
              placeholder="e.g., SCBA&#10;Bunker gear&#10;Notebook"
            />
          </div>

          <div className="border-theme-surface-border flex justify-end space-x-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
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
      </div>
    </div>
  );
};

// ==================== Training Type Badge ====================

const TypeBadge: React.FC<{ type: TrainingType }> = ({ type }) => {
  const colors: Record<TrainingType, string> = {
    certification: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
    continuing_education: 'bg-green-500/20 text-green-700 dark:text-green-400',
    skills_practice: 'bg-purple-500/20 text-purple-700 dark:text-purple-400',
    orientation: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
    refresher: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
    specialty: 'bg-pink-500/20 text-pink-700 dark:text-pink-400',
  };

  const labels: Record<TrainingType, string> = {
    certification: 'Certification',
    continuing_education: 'CE',
    skills_practice: 'Skills',
    orientation: 'Orientation',
    refresher: 'Refresher',
    specialty: 'Specialty',
  };

  return <span className={`rounded-sm px-2 py-0.5 text-xs ${colors[type]}`}>{labels[type]}</span>;
};

// ==================== Main Page ====================

// `embedded` renders the page as a tab inside TrainingAdminPage (which already
// provides the outer page chrome + title), so we drop the standalone
// min-h-screen wrapper and the big page header to avoid doubling them up.
const CourseLibraryPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [coursesData, categoriesData] = await Promise.all([
        trainingService.getCourses(),
        trainingService.getCategories(),
      ]);
      setCourses(coursesData);
      setCategories(categoriesData);
    } catch (_error) {
      toast.error('Failed to load course library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleDelete = async (courseId: string, courseName: string) => {
    if (!confirm(`Are you sure you want to delete "${courseName}"? This cannot be undone.`)) return;
    try {
      await trainingService.updateCourse(courseId, { active: false });
      toast.success('Course deactivated');
      void loadData();
    } catch {
      toast.error('Failed to deactivate course');
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

  return (
    <div className={embedded ? '' : 'min-h-screen'}>
      <main className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8'}>
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          {embedded ? (
            <p className="text-theme-text-muted text-sm">
              Organization-wide training course catalog ({courses.length} course{courses.length !== 1 ? 's' : ''})
            </p>
          ) : (
            <div>
              <h1 className="text-theme-text-primary flex items-center space-x-3 text-3xl font-bold">
                <BookOpen className="h-8 w-8 text-red-700 dark:text-red-500" />
                <span>Course Library</span>
              </h1>
              <p className="text-theme-text-muted mt-1">
                Organization-wide training course catalog ({courses.length} course{courses.length !== 1 ? 's' : ''})
              </p>
            </div>
          )}
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
        </div>

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
              className={`flex items-center space-x-2 rounded-lg border px-4 py-2 text-sm max-md:min-h-[44px] ${
                showFilters || filterType || filterCategory
                  ? 'border-red-500 bg-red-600/20 text-red-700 dark:text-red-400'
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
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Training Type</label>
                <select
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
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Category</label>
                <select
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
                : 'No courses in your library yet'}
            </p>
            {!searchTerm && !filterType && !filterCategory && (
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginatedCourses.map((course) => (
                <div key={course.id} className="card-secondary hover:bg-theme-surface-hover p-5 transition-colors">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center space-x-2">
                        <h3 className="text-theme-text-primary font-semibold">{course.name}</h3>
                      </div>
                      {course.code && <span className="text-theme-text-muted font-mono text-xs">{course.code}</span>}
                    </div>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => setSyllabusCourse(course)}
                        className="text-theme-text-muted hover:text-theme-text-primary rounded-sm p-1.5"
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
                        className="text-theme-text-muted hover:text-theme-text-primary rounded-sm p-1.5"
                        aria-label={`Edit ${course.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          void handleDelete(course.id, course.name);
                        }}
                        className="text-theme-text-muted rounded-sm p-1.5 hover:text-red-700 dark:hover:text-red-400"
                        aria-label={`Delete ${course.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {course.description && (
                    <p className="text-theme-text-muted mb-3 line-clamp-2 text-sm">{course.description}</p>
                  )}

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <TypeBadge type={course.training_type} />
                    {!course.active && (
                      <span className="rounded-sm bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
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
      </main>

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

      {syllabusCourse && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Classes for ${syllabusCourse.name}`}
        >
          <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-lg">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-theme-text-primary text-xl font-bold">{syllabusCourse.name}</h2>
                <p className="text-theme-text-muted text-sm">Classes that make up this course</p>
              </div>
              <button
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
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseLibraryPage;
