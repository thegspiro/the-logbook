import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { trainingService } from '../services/api';
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
  onSuccess: () => void;
}

const TRAINING_TYPES: { value: TrainingType; label: string }[] = [
  { value: 'certification', label: 'Certification' },
  { value: 'continuing_education', label: 'Continuing Education' },
  { value: 'skills_practice', label: 'Skills Practice' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'refresher', label: 'Refresher' },
  { value: 'specialty', label: 'Specialty' },
];

const CourseFormModal: React.FC<CourseFormModalProps> = ({
  isOpen,
  course,
  categories,
  onClose,
  onSuccess,
}) => {
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
      code: formData.code || undefined,
      description: formData.description || undefined,
      training_type: formData.training_type,
      duration_hours: formData.duration_hours ? parseFloat(formData.duration_hours) : undefined,
      credit_hours: formData.credit_hours ? parseFloat(formData.credit_hours) : undefined,
      instructor: formData.instructor || undefined,
      max_participants: formData.max_participants ? parseInt(formData.max_participants) : undefined,
      expiration_months: formData.expiration_months ? parseInt(formData.expiration_months) : undefined,
      category_ids: formData.category_ids.length > 0 ? formData.category_ids : undefined,
      materials_required: formData.materials_required
        ? formData.materials_required.split('\n').filter((m) => m.trim())
        : undefined,
    };

    try {
      if (isEdit && course) {
        await trainingService.updateCourse(course.id, payload as TrainingCourseUpdate);
        toast.success('Course updated successfully');
      } else {
        await trainingService.createCourse(payload as TrainingCourseCreate);
        toast.success('Course created successfully');
      }
      onSuccess();
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
          <h2 className="text-xl font-bold text-theme-text-primary">
            {isEdit ? 'Edit Course' : 'Add New Course'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Course Name <span className="text-red-700 dark:text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., Firefighter I"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Course Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., FF1"
                maxLength={50}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Describe the course content, objectives, and target audience..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Training Type *</label>
              <select
                value={formData.training_type}
                onChange={(e) => setFormData({ ...formData, training_type: e.target.value as TrainingType })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {TRAINING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Duration (hours)</label>
              <input
                type="number"
                value={formData.duration_hours}
                onChange={(e) => setFormData({ ...formData, duration_hours: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., 40"
                min={0}
                step={0.5}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Credit Hours</label>
              <input
                type="number"
                value={formData.credit_hours}
                onChange={(e) => setFormData({ ...formData, credit_hours: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., 40"
                min={0}
                step={0.5}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Instructor</label>
              <input
                type="text"
                value={formData.instructor}
                onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Instructor name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Max Participants</label>
              <input
                type="number"
                value={formData.max_participants}
                onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Optional"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Expires After (months)</label>
              <input
                type="number"
                value={formData.expiration_months}
                onChange={(e) => setFormData({ ...formData, expiration_months: e.target.value })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Never"
                min={1}
              />
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Training Categories</label>
            <div className="flex flex-wrap gap-2">
              {parentCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    formData.category_ids.includes(cat.id)
                      ? 'text-theme-text-primary'
                      : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                  }`}
                  style={
                    formData.category_ids.includes(cat.id)
                      ? { backgroundColor: cat.color || '#DC2626' }
                      : undefined
                  }
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Materials Required (one per line)</label>
            <textarea
              value={formData.materials_required}
              onChange={(e) => setFormData({ ...formData, materials_required: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="e.g., SCBA&#10;Bunker gear&#10;Notebook"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              disabled={isSubmitting}
            >
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

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[type]}`}>
      {labels[type]}
    </span>
  );
};

// ==================== Main Page ====================

const CourseLibraryPage: React.FC = () => {
  const _navigate = useNavigate();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editCourse, setEditCourse] = useState<TrainingCourse | null>(null);

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

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (courseId: string, courseName: string) => {
    if (!confirm(`Are you sure you want to delete "${courseName}"? This cannot be undone.`)) return;
    try {
      await trainingService.updateCourse(courseId, { active: false });
      toast.success('Course deactivated');
      loadData();
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

      const matchesCategory =
        !filterCategory || (c.category_ids || []).includes(filterCategory);

      return matchesSearch && matchesType && matchesCategory;
    });
  }, [courses, searchTerm, filterType, filterCategory]);

  const parentCategories = categories.filter((c) => !c.parent_category_id);

  // Category lookup for display
  const catMap = useMemo(() => {
    const map: Record<string, TrainingCategory> = {};
    categories.forEach((c) => { map[c.id] = c; });
    return map;
  }, [categories]);

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
              <BookOpen className="w-8 h-8 text-red-700 dark:text-red-500" />
              <span>Course Library</span>
            </h1>
            <p className="text-theme-text-muted mt-1">
              Organization-wide training course catalog ({courses.length} course{courses.length !== 1 ? 's' : ''})
            </p>
          </div>
          <button
            onClick={() => { setEditCourse(null); setShowModal(true); }}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            <Plus className="w-5 h-5" />
            <span>Add Course</span>
          </button>
        </div>

        {/* Search & Filters */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center space-x-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search courses by name, code, or description..."
                className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border text-sm ${
                showFilters || filterType || filterCategory
                  ? 'bg-red-600/20 border-red-500 text-red-700 dark:text-red-400'
                  : 'bg-theme-surface-secondary border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-theme-surface-secondary rounded-lg p-4 border border-theme-surface-border">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Training Type</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">All Types</option>
                  {TRAINING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Category</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">All Categories</option>
                  {parentCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Course Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
            <p className="text-theme-text-muted mt-4">Loading courses...</p>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="text-center py-16 bg-theme-surface-secondary rounded-lg">
            <BookOpen className="w-16 h-16 text-theme-text-secondary mx-auto mb-4" />
            <p className="text-theme-text-muted text-lg mb-2">
              {searchTerm || filterType || filterCategory ? 'No courses match your filters' : 'No courses in your library yet'}
            </p>
            {!searchTerm && !filterType && !filterCategory && (
              <button
                onClick={() => { setEditCourse(null); setShowModal(true); }}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Add Your First Course
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCourses.map((course) => (
              <div
                key={course.id}
                className="bg-theme-surface-secondary rounded-lg p-5 hover:bg-theme-surface-hover transition-colors border border-theme-surface-border"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="text-theme-text-primary font-semibold">{course.name}</h3>
                    </div>
                    {course.code && (
                      <span className="text-xs text-theme-text-muted font-mono">{course.code}</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => { setEditCourse(course); setShowModal(true); }}
                      className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded"
                      aria-label={`Edit ${course.name}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(course.id, course.name)}
                      className="p-1.5 text-theme-text-muted hover:text-red-700 dark:hover:text-red-400 rounded"
                      aria-label={`Delete ${course.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {course.description && (
                  <p className="text-theme-text-muted text-sm mb-3 line-clamp-2">{course.description}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <TypeBadge type={course.training_type} />
                  {!course.active && (
                    <span className="px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-700 dark:text-red-400">Inactive</span>
                  )}
                </div>

                <div className="flex items-center space-x-4 text-xs text-theme-text-muted">
                  {course.duration_hours != null && (
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{course.duration_hours}h</span>
                    </div>
                  )}
                  {course.credit_hours != null && course.credit_hours !== course.duration_hours && (
                    <span>{course.credit_hours} credits</span>
                  )}
                  {course.expiration_months && (
                    <div className="flex items-center space-x-1">
                      <Award className="w-3 h-3" />
                      <span>Expires {course.expiration_months}mo</span>
                    </div>
                  )}
                </div>

                {/* Category chips */}
                {course.category_ids && course.category_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {course.category_ids.map((catId) => {
                      const cat = catMap[catId];
                      if (!cat) return null;
                      return (
                        <span
                          key={catId}
                          className="px-2 py-0.5 text-xs rounded-full text-theme-text-primary"
                          style={{ backgroundColor: (cat.color || '#6B7280') + '40' }}
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
        )}
      </main>

      <CourseFormModal
        isOpen={showModal}
        course={editCourse}
        categories={categories}
        onClose={() => { setShowModal(false); setEditCourse(null); }}
        onSuccess={loadData}
      />
    </div>
  );
};

export default CourseLibraryPage;
