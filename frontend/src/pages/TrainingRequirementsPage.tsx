import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  Users,
  Award,
  AlertCircle,
  CheckCircle,
  Search,
  Filter,
  RefreshCcw,
  X,
  Tag,
  Clock,
} from 'lucide-react';
import { trainingService } from '../services/api';
import type {
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  DueDateType,
  RequirementFrequency,
  RequirementType,
  TrainingType,
} from '../types/training';
import toast from 'react-hot-toast';

type FilterSource = 'all' | 'department' | 'state' | 'national';

/**
 * Training Requirements Management Page
 *
 * Allows training officers to create, manage, and track training requirements.
 * Supports department, state, and national registry requirements.
 */
const TrainingRequirementsPage: React.FC = () => {
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedRequirement, setSelectedRequirement] = useState<TrainingRequirement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqs, cats] = await Promise.all([
        trainingService.getRequirements({ active_only: false }),
        trainingService.getCategories(false),
      ]);
      setRequirements(reqs);
      setCategories(cats);
    } catch (_error) {
      toast.error('Failed to load training requirements');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this requirement?')) return;

    try {
      await trainingService.deleteRequirement(id);
      setRequirements(requirements.filter(r => r.id !== id));
      toast.success('Requirement deleted');
    } catch (_error) {
      toast.error('Failed to delete requirement');
    }
  };

  const handleDuplicate = async (requirement: TrainingRequirement) => {
    try {
      const newReq: TrainingRequirementCreate = {
        name: `${requirement.name} (Copy)`,
        description: requirement.description,
        requirement_type: requirement.requirement_type || 'hours',
        training_type: requirement.training_type,
        required_hours: requirement.required_hours,
        required_courses: requirement.required_courses,
        frequency: requirement.frequency,
        year: requirement.year,
        applies_to_all: requirement.applies_to_all,
        required_roles: requirement.required_roles,
        start_date: requirement.start_date,
        due_date: requirement.due_date,
        due_date_type: requirement.due_date_type,
        rolling_period_months: requirement.rolling_period_months,
        period_start_month: requirement.period_start_month,
        period_start_day: requirement.period_start_day,
        category_ids: requirement.category_ids,
      };

      const created = await trainingService.createRequirement(newReq);
      setRequirements([...requirements, created]);
      toast.success('Requirement duplicated');
    } catch (_error) {
      toast.error('Failed to duplicate requirement');
    }
  };

  const toggleActive = async (id: string) => {
    const requirement = requirements.find(r => r.id === id);
    if (!requirement) return;

    try {
      await trainingService.updateRequirement(id, { active: !requirement.active });
      setRequirements(requirements.map(r =>
        r.id === id ? { ...r, active: !r.active } : r
      ));
      toast.success(requirement.active ? 'Requirement deactivated' : 'Requirement activated');
    } catch (_error) {
      toast.error('Failed to update requirement');
    }
  };

  const handleSave = async (data: TrainingRequirementCreate | TrainingRequirementUpdate, isEdit: boolean, id?: string) => {
    try {
      if (isEdit && id) {
        const updated = await trainingService.updateRequirement(id, data as TrainingRequirementUpdate);
        setRequirements(requirements.map(r => r.id === id ? updated : r));
        toast.success('Requirement updated');
      } else {
        const created = await trainingService.createRequirement(data as TrainingRequirementCreate);
        setRequirements([...requirements, created]);
        toast.success('Requirement created');
      }
      setShowCreateModal(false);
      setSelectedRequirement(null);
    } catch (_error) {
      toast.error('Failed to save requirement');
    }
  };

  const filteredRequirements = requirements.filter(req => {
    const matchesSearch = req.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.description?.toLowerCase().includes(searchTerm.toLowerCase());
    // For now, filter by source is placeholder since we don't have source field in model
    const matchesSource = filterSource === 'all';
    return matchesSearch && matchesSource;
  });

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-theme-text-primary" role="status" aria-live="polite">Loading requirements...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
              <FileText className="w-8 h-8 text-red-700 dark:text-red-500" aria-hidden="true" />
              <span>Training Requirements</span>
            </h1>
            <p className="text-theme-text-muted mt-1">
              Manage department, state, and national training requirements
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchData}
              className="p-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
              aria-label="Refresh requirements"
            >
              <RefreshCcw className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
              <span>Use Template</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" aria-hidden="true" />
              <span>Create Requirement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6" role="search" aria-label="Search and filter requirements">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                <label htmlFor="req-search" className="sr-only">Search requirements</label>
                <input
                  id="req-search"
                  type="text"
                  placeholder="Search requirements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Source Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
              <label htmlFor="source-filter" className="sr-only">Filter by source</label>
              <select
                id="source-filter"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="all">All Sources</option>
                <option value="department">Department</option>
                <option value="state">State</option>
                <option value="national">National</option>
              </select>
            </div>
          </div>
        </div>

        {/* Requirements List */}
        <div className="space-y-4">
          {filteredRequirements.length === 0 ? (
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
              <FileText className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-theme-text-primary text-xl font-semibold mb-2">No Requirements Found</h3>
              <p className="text-theme-text-muted mb-6">
                {searchTerm ? 'Try adjusting your search or filters' : 'Get started by creating your first training requirement'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Create First Requirement
              </button>
            </div>
          ) : (
            filteredRequirements.map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                categories={categories}
                isExpanded={expandedId === requirement.id}
                onToggleExpand={() => setExpandedId(expandedId === requirement.id ? null : requirement.id)}
                onEdit={() => {
                  setSelectedRequirement(requirement);
                  setShowCreateModal(true);
                }}
                onDelete={() => handleDelete(requirement.id)}
                onDuplicate={() => handleDuplicate(requirement)}
                onToggleActive={() => toggleActive(requirement.id)}
              />
            ))
          )}
        </div>

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <RequirementModal
            requirement={selectedRequirement}
            categories={categories}
            onClose={() => {
              setShowCreateModal(false);
              setSelectedRequirement(null);
            }}
            onSave={handleSave}
          />
        )}

        {/* Template Modal */}
        {showTemplateModal && (
          <TemplateModal
            onClose={() => setShowTemplateModal(false)}
            onSelect={async (template) => {
              try {
                const created = await trainingService.createRequirement(template);
                setRequirements([...requirements, created]);
                toast.success(`Template "${template.name}" added`);
                setShowTemplateModal(false);
              } catch (_error) {
                toast.error('Failed to create requirement from template');
              }
            }}
          />
        )}
      </main>
    </div>
  );
};

// Requirement Card Component
interface RequirementCardProps {
  requirement: TrainingRequirement;
  categories: TrainingCategory[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
}

const RequirementCard: React.FC<RequirementCardProps> = ({
  requirement,
  categories,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
}) => {
  const getRequirementTypeLabel = (type: string) => {
    switch (type) {
      case 'hours': return 'Hours';
      case 'courses': return 'Courses';
      case 'certification': return 'Certification';
      case 'shifts': return 'Shifts';
      case 'calls': return 'Calls';
      case 'skills_evaluation': return 'Skills Evaluation';
      case 'checklist': return 'Checklist';
      default: return type;
    }
  };

  const getDueDateTypeLabel = (type: DueDateType) => {
    switch (type) {
      case 'calendar_period': return 'Calendar Period';
      case 'rolling': return 'Rolling';
      case 'certification_period': return 'Certification Period';
      case 'fixed_date': return 'Fixed Date';
      default: return type;
    }
  };

  const getCategoryNames = () => {
    if (!requirement.category_ids?.length) return null;
    return categories
      .filter(c => requirement.category_ids?.includes(c.id))
      .map(c => c.name)
      .join(', ');
  };

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-theme-text-primary text-lg font-bold">{requirement.name}</h3>
              {requirement.requirement_type && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-green-700 text-theme-text-primary">
                  {getRequirementTypeLabel(requirement.requirement_type)}
                </span>
              )}
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                requirement.due_date_type === 'rolling' ? 'bg-purple-600' :
                requirement.due_date_type === 'calendar_period' ? 'bg-blue-600' :
                requirement.due_date_type === 'certification_period' ? 'bg-orange-600' :
                'bg-theme-surface-hover'
              } text-theme-text-primary`}>
                {getDueDateTypeLabel(requirement.due_date_type)}
              </span>
              {!requirement.active && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-theme-surface-hover text-theme-text-primary">
                  Inactive
                </span>
              )}
            </div>
            {requirement.description && (
              <p className="text-theme-text-muted text-sm mb-3">{requirement.description}</p>
            )}

            {/* Quick Info */}
            <div className="flex flex-wrap gap-3 text-sm">
              {requirement.required_hours && (
                <div className="flex items-center space-x-2 text-theme-text-secondary">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>{requirement.required_hours} hours</span>
                </div>
              )}
              <div className="flex items-center space-x-2 text-theme-text-secondary">
                <Award className="w-4 h-4" aria-hidden="true" />
                <span className="capitalize">{requirement.frequency.replace('_', ' ')}</span>
              </div>
              {requirement.applies_to_all ? (
                <div className="flex items-center space-x-2 text-theme-text-secondary">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  <span>All Members</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-theme-text-secondary">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  <span>Specific Roles/Members</span>
                </div>
              )}
              {requirement.due_date_type === 'rolling' && requirement.rolling_period_months && (
                <div className="flex items-center space-x-2 text-theme-text-secondary">
                  <RefreshCcw className="w-4 h-4" aria-hidden="true" />
                  <span>Every {requirement.rolling_period_months} months</span>
                </div>
              )}
              {getCategoryNames() && (
                <div className="flex items-center space-x-2 text-theme-text-secondary">
                  <Tag className="w-4 h-4" aria-hidden="true" />
                  <span>{getCategoryNames()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={onToggleActive}
              className={`p-2 rounded-lg transition-colors ${
                requirement.active
                  ? 'bg-green-600/20 text-green-700 dark:text-green-400 hover:bg-green-600/30'
                  : 'bg-theme-surface-hover/20 text-theme-text-muted hover:bg-theme-surface-hover/30'
              }`}
              aria-label={requirement.active ? 'Deactivate requirement' : 'Activate requirement'}
            >
              {requirement.active ? <CheckCircle className="w-5 h-5" aria-hidden="true" /> : <AlertCircle className="w-5 h-5" aria-hidden="true" />}
            </button>
            <button
              onClick={onEdit}
              className="p-2 bg-blue-600/20 text-blue-700 dark:text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors"
              aria-label="Edit requirement"
            >
              <Edit className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-2 bg-purple-600/20 text-purple-700 dark:text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors"
              aria-label="Duplicate requirement"
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 bg-red-600/20 text-red-700 dark:text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
              aria-label="Delete requirement"
            >
              <Trash2 className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" aria-hidden="true" /> : <ChevronDown className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-6 pt-6 border-t border-theme-surface-border space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DetailSection title="Requirement Details">
                <DetailRow label="Training Type" value={requirement.training_type || 'Any'} />
                <DetailRow label="Due Date Type" value={getDueDateTypeLabel(requirement.due_date_type)} />
                <DetailRow label="Frequency" value={requirement.frequency.replace('_', ' ')} />
                {requirement.required_hours && (
                  <DetailRow label="Required Hours" value={`${requirement.required_hours} hours`} />
                )}
                {requirement.year && (
                  <DetailRow label="Year" value={String(requirement.year)} />
                )}
                {requirement.due_date && (
                  <DetailRow label="Due Date" value={requirement.due_date} />
                )}
                {requirement.due_date_type === 'rolling' && requirement.rolling_period_months && (
                  <DetailRow label="Rolling Period" value={`${requirement.rolling_period_months} months`} />
                )}
                {requirement.due_date_type === 'calendar_period' && (
                  <DetailRow
                    label="Period Start"
                    value={`Month ${requirement.period_start_month || 1}, Day ${requirement.period_start_day || 1}`}
                  />
                )}
              </DetailSection>

              <DetailSection title="Assignment">
                <DetailRow
                  label="Applies To"
                  value={requirement.applies_to_all ? 'All Members' : 'Specific Groups'}
                />
                {requirement.required_roles && requirement.required_roles.length > 0 && (
                  <DetailRow label="Required Roles" value={requirement.required_roles.join(', ')} />
                )}
                {requirement.category_ids && requirement.category_ids.length > 0 && (
                  <DetailRow label="Categories" value={getCategoryNames() || ''} />
                )}
                {requirement.start_date && (
                  <DetailRow label="Start Date" value={requirement.start_date} />
                )}
              </DetailSection>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DetailSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-theme-text-primary font-semibold mb-3">{title}</h4>
    <div className="space-y-2">{children}</div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-theme-text-muted text-sm">{label}:</span>
    <span className="text-theme-text-primary text-sm font-medium capitalize">{value}</span>
  </div>
);

// Requirement Modal with Full Form
interface RequirementModalProps {
  requirement: TrainingRequirement | null;
  categories: TrainingCategory[];
  onClose: () => void;
  onSave: (data: TrainingRequirementCreate | TrainingRequirementUpdate, isEdit: boolean, id?: string) => void;
}

const RequirementModal: React.FC<RequirementModalProps> = ({
  requirement,
  categories,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    name: requirement?.name || '',
    description: requirement?.description || '',
    requirement_type: (requirement?.requirement_type || 'hours') as RequirementType,
    training_type: requirement?.training_type || '',
    required_hours: requirement?.required_hours || undefined,
    frequency: requirement?.frequency || 'annual' as RequirementFrequency,
    year: requirement?.year || new Date().getFullYear() as number | undefined,
    applies_to_all: requirement?.applies_to_all ?? true,
    due_date: requirement?.due_date || '',
    start_date: requirement?.start_date || '',
    due_date_type: requirement?.due_date_type || 'calendar_period' as DueDateType,
    rolling_period_months: requirement?.rolling_period_months || 12,
    period_start_month: requirement?.period_start_month || 1,
    period_start_day: requirement?.period_start_day || 1,
    category_ids: requirement?.category_ids || [] as string[],
  });

  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      const data = {
        name: formData.name,
        description: formData.description || undefined,
        requirement_type: formData.requirement_type as RequirementType,
        training_type: formData.training_type as TrainingType || undefined,
        required_hours: formData.required_hours || undefined,
        frequency: formData.frequency,
        year: formData.year || undefined,
        applies_to_all: formData.applies_to_all,
        due_date: formData.due_date || undefined,
        start_date: formData.start_date || undefined,
        due_date_type: formData.due_date_type,
        rolling_period_months: formData.due_date_type === 'rolling' ? formData.rolling_period_months : undefined,
        period_start_month: formData.due_date_type === 'calendar_period' ? formData.period_start_month : undefined,
        period_start_day: formData.due_date_type === 'calendar_period' ? formData.period_start_day : undefined,
        category_ids: formData.category_ids.length > 0 ? formData.category_ids : undefined,
      };

      onSave(data, !!requirement, requirement?.id);
    } finally {
      setSaving(false);
    }
  };

  const handleCategoryToggle = (categoryId: string) => {
    setFormData(prev => ({
      ...prev,
      category_ids: prev.category_ids.includes(categoryId)
        ? prev.category_ids.filter(id => id !== categoryId)
        : [...prev.category_ids, categoryId],
    }));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="requirement-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 id="requirement-modal-title" className="text-theme-text-primary text-xl font-bold">
            {requirement ? 'Edit Requirement' : 'Create Requirement'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-theme-surface-hover rounded-lg transition-colors text-theme-text-muted"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary font-semibold border-b border-theme-surface-border pb-2">Basic Information</h4>

            <div>
              <label htmlFor="req-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Name <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
              </label>
              <input
                id="req-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., Annual Training Hours"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="req-description" className="block text-sm font-medium text-theme-text-secondary mb-2">Description</label>
              <textarea
                id="req-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Describe the requirement..."
                rows={3}
              />
            </div>

            <div>
              <label htmlFor="req-requirement-type" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Requirement Type <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
              </label>
              <select
                id="req-requirement-type"
                value={formData.requirement_type}
                onChange={(e) => setFormData({ ...formData, requirement_type: e.target.value as RequirementType })}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                required
                aria-required="true"
              >
                <option value="hours">Hours</option>
                <option value="courses">Courses</option>
                <option value="certification">Certification</option>
                <option value="shifts">Shifts</option>
                <option value="calls">Calls</option>
                <option value="skills_evaluation">Skills Evaluation</option>
                <option value="checklist">Checklist</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-training-type" className="block text-sm font-medium text-theme-text-secondary mb-2">Training Type</label>
                <select
                  id="req-training-type"
                  value={formData.training_type}
                  onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Any Type</option>
                  <option value="certification">Certification</option>
                  <option value="continuing_education">Continuing Education</option>
                  <option value="skills_practice">Skills Practice</option>
                  <option value="orientation">Orientation</option>
                  <option value="refresher">Refresher</option>
                  <option value="specialty">Specialty</option>
                </select>
              </div>

              <div>
                <label htmlFor="req-required-hours" className="block text-sm font-medium text-theme-text-secondary mb-2">Required Hours</label>
                <input
                  id="req-required-hours"
                  type="number"
                  value={formData.required_hours || ''}
                  onChange={(e) => setFormData({ ...formData, required_hours: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="e.g., 36"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
          </div>

          {/* Due Date Configuration */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary font-semibold border-b border-theme-surface-border pb-2">Due Date Configuration</h4>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Due Date Type</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="radiogroup" aria-label="Due date type">
                {[
                  { value: 'calendar_period', label: 'Calendar Period', desc: 'Due by end of period (e.g., Dec 31)' },
                  { value: 'rolling', label: 'Rolling', desc: 'Due X months from last completion' },
                  { value: 'certification_period', label: 'Cert Period', desc: 'Due when certification expires' },
                  { value: 'fixed_date', label: 'Fixed Date', desc: 'Due by a specific date' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={formData.due_date_type === option.value}
                    onClick={() => setFormData({ ...formData, due_date_type: option.value as DueDateType })}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      formData.due_date_type === option.value
                        ? 'border-red-500 bg-red-500/20 text-theme-text-primary'
                        : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                    }`}
                  >
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-theme-text-muted mt-1">{option.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Rolling period options */}
            {formData.due_date_type === 'rolling' && (
              <div>
                <label htmlFor="req-rolling-period" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Rolling Period (Months)
                </label>
                <input
                  id="req-rolling-period"
                  type="number"
                  value={formData.rolling_period_months}
                  onChange={(e) => setFormData({ ...formData, rolling_period_months: Number(e.target.value) })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  min="1"
                  max="120"
                />
                <p className="text-theme-text-muted text-sm mt-1">
                  Training must be completed every {formData.rolling_period_months} months from the last completion date.
                </p>
              </div>
            )}

            {/* Calendar period options */}
            {formData.due_date_type === 'calendar_period' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="req-period-start-month" className="block text-sm font-medium text-theme-text-secondary mb-2">Period Start Month</label>
                  <select
                    id="req-period-start-month"
                    value={formData.period_start_month}
                    onChange={(e) => setFormData({ ...formData, period_start_month: Number(e.target.value) })}
                    className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                      <option key={idx} value={idx + 1}>{month}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="req-period-start-day" className="block text-sm font-medium text-theme-text-secondary mb-2">Period Start Day</label>
                  <input
                    id="req-period-start-day"
                    type="number"
                    value={formData.period_start_day}
                    onChange={(e) => setFormData({ ...formData, period_start_day: Number(e.target.value) })}
                    className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    min="1"
                    max="31"
                  />
                </div>
              </div>
            )}

            {/* Fixed date option */}
            {formData.due_date_type === 'fixed_date' && (
              <div>
                <label htmlFor="req-due-date" className="block text-sm font-medium text-theme-text-secondary mb-2">Due Date</label>
                <input
                  id="req-due-date"
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-frequency" className="block text-sm font-medium text-theme-text-secondary mb-2">Frequency</label>
                <select
                  id="req-frequency"
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RequirementFrequency })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="annual">Annual</option>
                  <option value="biannual">Biannual (Every 2 Years)</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="one_time">One Time</option>
                </select>
              </div>

              <div>
                <label htmlFor="req-year" className="block text-sm font-medium text-theme-text-secondary mb-2">Year</label>
                <input
                  id="req-year"
                  type="number"
                  value={formData.year || ''}
                  onChange={(e) => setFormData({ ...formData, year: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="e.g., 2026"
                  min="2020"
                  max="2100"
                />
              </div>
            </div>
          </div>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-theme-text-primary font-semibold border-b border-theme-surface-border pb-2">
                Training Categories
              </h4>
              <p className="text-theme-text-muted text-sm">
                Select categories that can satisfy this requirement. Training sessions tagged with these categories will count towards completion.
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Training categories">
                {categories.filter(c => c.active).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => handleCategoryToggle(category.id)}
                    aria-pressed={formData.category_ids.includes(category.id)}
                    className={`px-3 py-2 rounded-lg border transition-colors flex items-center space-x-2 ${
                      formData.category_ids.includes(category.id)
                        ? 'border-red-500 bg-red-500/20 text-theme-text-primary'
                        : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                    }`}
                  >
                    {category.color && (
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: category.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span>{category.name}</span>
                    {formData.category_ids.includes(category.id) && (
                      <CheckCircle className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assignment */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary font-semibold border-b border-theme-surface-border pb-2">Assignment</h4>

            <div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.applies_to_all}
                  onChange={(e) => setFormData({ ...formData, applies_to_all: e.target.checked })}
                  className="w-5 h-5 rounded border-theme-input-border bg-theme-input-bg text-red-700 dark:text-red-500 focus:ring-red-500"
                />
                <span className="text-theme-text-secondary">Applies to all members</span>
              </label>
              <p className="text-theme-text-muted text-sm mt-1 ml-8">
                When checked, this requirement applies to everyone in the organization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-start-date" className="block text-sm font-medium text-theme-text-secondary mb-2">Start Date</label>
                <input
                  id="req-start-date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : (requirement ? 'Update Requirement' : 'Create Requirement')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TemplateModal: React.FC<{
  onClose: () => void;
  onSelect: (template: TrainingRequirementCreate) => void;
}> = ({ onClose, onSelect }) => {
  const templates: TrainingRequirementCreate[] = [
    {
      name: 'NFPA 1001 Annual Training',
      description: 'NFPA 1001 requires annual training for firefighters',
      requirement_type: 'hours',
      required_hours: 36,
      frequency: 'annual',
      applies_to_all: false,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
    },
    {
      name: 'NREMT EMT Recertification',
      description: 'National Registry EMT continuing education requirements',
      requirement_type: 'hours',
      required_hours: 24,
      frequency: 'biannual',
      applies_to_all: false,
      due_date_type: 'rolling',
      rolling_period_months: 24,
    },
    {
      name: 'Annual CPR Certification',
      description: 'Annual CPR certification renewal requirement',
      requirement_type: 'certification',
      required_hours: 4,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'rolling',
      rolling_period_months: 12,
    },
    {
      name: 'Hazmat Operations Refresher',
      description: 'OSHA-required hazmat operations refresher training',
      requirement_type: 'hours',
      required_hours: 8,
      frequency: 'annual',
      applies_to_all: false,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
    },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-4xl w-full p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 id="template-modal-title" className="text-theme-text-primary text-xl font-bold">Select a Template</h3>
            <p className="text-theme-text-muted mt-1">
              Start with a pre-configured requirement template for common standards
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-theme-surface-hover rounded-lg transition-colors text-theme-text-muted"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {templates.map((template, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(template)}
              className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border hover:bg-theme-surface-hover transition-colors text-left"
            >
              <h4 className="text-theme-text-primary font-semibold mb-2">{template.name}</h4>
              <p className="text-theme-text-muted text-sm mb-3">{template.description}</p>
              <div className="flex items-center space-x-2 flex-wrap gap-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${
                  template.due_date_type === 'rolling' ? 'bg-purple-600' : 'bg-blue-600'
                } text-theme-text-primary`}>
                  {template.due_date_type === 'rolling' ? 'Rolling' : 'Calendar Period'}
                </span>
                {template.required_hours && (
                  <span className="text-theme-text-muted text-xs">{template.required_hours} hours</span>
                )}
                <span className="text-theme-text-muted text-xs capitalize">{template.frequency}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrainingRequirementsPage;
