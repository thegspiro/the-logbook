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
    } catch (error) {
      console.error('Error loading data:', error);
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
    } catch (error) {
      console.error('Error deleting requirement:', error);
      toast.error('Failed to delete requirement');
    }
  };

  const handleDuplicate = async (requirement: TrainingRequirement) => {
    try {
      const newReq: TrainingRequirementCreate = {
        name: `${requirement.name} (Copy)`,
        description: requirement.description,
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
    } catch (error) {
      console.error('Error duplicating requirement:', error);
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
    } catch (error) {
      console.error('Error toggling requirement:', error);
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
    } catch (error) {
      console.error('Error saving requirement:', error);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-white">Loading requirements...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center space-x-3">
              <FileText className="w-8 h-8 text-red-500" />
              <span>Training Requirements</span>
            </h1>
            <p className="text-slate-400 mt-1">
              Manage department, state, and national training requirements
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchData}
              className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCcw className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Copy className="w-5 h-5" />
              <span>Use Template</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Create Requirement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search requirements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Source Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" />
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
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
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white text-xl font-semibold mb-2">No Requirements Found</h3>
              <p className="text-slate-400 mb-6">
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
              } catch (error) {
                console.error('Error creating from template:', error);
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
    <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-white text-lg font-bold">{requirement.name}</h3>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                requirement.due_date_type === 'rolling' ? 'bg-purple-600' :
                requirement.due_date_type === 'calendar_period' ? 'bg-blue-600' :
                requirement.due_date_type === 'certification_period' ? 'bg-orange-600' :
                'bg-gray-600'
              } text-white`}>
                {getDueDateTypeLabel(requirement.due_date_type)}
              </span>
              {!requirement.active && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-600 text-white">
                  Inactive
                </span>
              )}
            </div>
            {requirement.description && (
              <p className="text-slate-400 text-sm mb-3">{requirement.description}</p>
            )}

            {/* Quick Info */}
            <div className="flex flex-wrap gap-3 text-sm">
              {requirement.required_hours && (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Clock className="w-4 h-4" />
                  <span>{requirement.required_hours} hours</span>
                </div>
              )}
              <div className="flex items-center space-x-2 text-slate-300">
                <Award className="w-4 h-4" />
                <span className="capitalize">{requirement.frequency.replace('_', ' ')}</span>
              </div>
              {requirement.applies_to_all ? (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Users className="w-4 h-4" />
                  <span>All Members</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Users className="w-4 h-4" />
                  <span>Specific Roles/Members</span>
                </div>
              )}
              {requirement.due_date_type === 'rolling' && requirement.rolling_period_months && (
                <div className="flex items-center space-x-2 text-slate-300">
                  <RefreshCcw className="w-4 h-4" />
                  <span>Every {requirement.rolling_period_months} months</span>
                </div>
              )}
              {getCategoryNames() && (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Tag className="w-4 h-4" />
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
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
              }`}
              title={requirement.active ? 'Active' : 'Inactive'}
            >
              {requirement.active ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            </button>
            <button
              onClick={onEdit}
              className="p-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors"
              title="Duplicate"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-6 pt-6 border-t border-white/10 space-y-4">
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
    <h4 className="text-white font-semibold mb-3">{title}</h4>
    <div className="space-y-2">{children}</div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-slate-400 text-sm">{label}:</span>
    <span className="text-white text-sm font-medium capitalize">{value}</span>
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

  const handleSubmit = async (e: React.FormEvent) => {
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

      await onSave(data, !!requirement, requirement?.id);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white text-xl font-bold">
            {requirement ? 'Edit Requirement' : 'Create Requirement'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h4 className="text-white font-semibold border-b border-white/10 pb-2">Basic Information</h4>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g., Annual Training Hours"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Describe the requirement..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Training Type</label>
                <select
                  value={formData.training_type}
                  onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
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
                <label className="block text-sm font-medium text-slate-300 mb-2">Required Hours</label>
                <input
                  type="number"
                  value={formData.required_hours || ''}
                  onChange={(e) => setFormData({ ...formData, required_hours: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="e.g., 36"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
          </div>

          {/* Due Date Configuration */}
          <div className="space-y-4">
            <h4 className="text-white font-semibold border-b border-white/10 pb-2">Due Date Configuration</h4>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Due Date Type</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { value: 'calendar_period', label: 'Calendar Period', desc: 'Due by end of period (e.g., Dec 31)' },
                  { value: 'rolling', label: 'Rolling', desc: 'Due X months from last completion' },
                  { value: 'certification_period', label: 'Cert Period', desc: 'Due when certification expires' },
                  { value: 'fixed_date', label: 'Fixed Date', desc: 'Due by a specific date' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, due_date_type: option.value as DueDateType })}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      formData.due_date_type === option.value
                        ? 'border-red-500 bg-red-500/20 text-white'
                        : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-slate-400 mt-1">{option.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Rolling period options */}
            {formData.due_date_type === 'rolling' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Rolling Period (Months)
                </label>
                <input
                  type="number"
                  value={formData.rolling_period_months}
                  onChange={(e) => setFormData({ ...formData, rolling_period_months: Number(e.target.value) })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  min="1"
                  max="120"
                />
                <p className="text-slate-400 text-sm mt-1">
                  Training must be completed every {formData.rolling_period_months} months from the last completion date.
                </p>
              </div>
            )}

            {/* Calendar period options */}
            {formData.due_date_type === 'calendar_period' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Period Start Month</label>
                  <select
                    value={formData.period_start_month}
                    onChange={(e) => setFormData({ ...formData, period_start_month: Number(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                      <option key={idx} value={idx + 1}>{month}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Period Start Day</label>
                  <input
                    type="number"
                    value={formData.period_start_day}
                    onChange={(e) => setFormData({ ...formData, period_start_day: Number(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    min="1"
                    max="31"
                  />
                </div>
              </div>
            )}

            {/* Fixed date option */}
            {formData.due_date_type === 'fixed_date' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Due Date</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Frequency</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RequirementFrequency })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="annual">Annual</option>
                  <option value="biannual">Biannual (Every 2 Years)</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="one_time">One Time</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Year</label>
                <input
                  type="number"
                  value={formData.year || ''}
                  onChange={(e) => setFormData({ ...formData, year: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
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
              <h4 className="text-white font-semibold border-b border-white/10 pb-2">
                Training Categories
              </h4>
              <p className="text-slate-400 text-sm">
                Select categories that can satisfy this requirement. Training sessions tagged with these categories will count towards completion.
              </p>
              <div className="flex flex-wrap gap-2">
                {categories.filter(c => c.active).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => handleCategoryToggle(category.id)}
                    className={`px-3 py-2 rounded-lg border transition-colors flex items-center space-x-2 ${
                      formData.category_ids.includes(category.id)
                        ? 'border-red-500 bg-red-500/20 text-white'
                        : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {category.color && (
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                    )}
                    <span>{category.name}</span>
                    {formData.category_ids.includes(category.id) && (
                      <CheckCircle className="w-4 h-4 text-red-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assignment */}
          <div className="space-y-4">
            <h4 className="text-white font-semibold border-b border-white/10 pb-2">Assignment</h4>

            <div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.applies_to_all}
                  onChange={(e) => setFormData({ ...formData, applies_to_all: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500"
                />
                <span className="text-slate-300">Applies to all members</span>
              </label>
              <p className="text-slate-400 text-sm mt-1 ml-8">
                When checked, this requirement applies to everyone in the organization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
      required_hours: 24,
      frequency: 'biannual',
      applies_to_all: false,
      due_date_type: 'rolling',
      rolling_period_months: 24,
    },
    {
      name: 'Annual CPR Certification',
      description: 'Annual CPR certification renewal requirement',
      required_hours: 4,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'rolling',
      rolling_period_months: 12,
    },
    {
      name: 'Hazmat Operations Refresher',
      description: 'OSHA-required hazmat operations refresher training',
      required_hours: 8,
      frequency: 'annual',
      applies_to_all: false,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg max-w-4xl w-full p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-white text-xl font-bold">Select a Template</h3>
            <p className="text-slate-400 mt-1">
              Start with a pre-configured requirement template for common standards
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {templates.map((template, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(template)}
              className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 hover:bg-white/15 transition-colors text-left"
            >
              <h4 className="text-white font-semibold mb-2">{template.name}</h4>
              <p className="text-slate-400 text-sm mb-3">{template.description}</p>
              <div className="flex items-center space-x-2 flex-wrap gap-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${
                  template.due_date_type === 'rolling' ? 'bg-purple-600' : 'bg-blue-600'
                } text-white`}>
                  {template.due_date_type === 'rolling' ? 'Rolling' : 'Calendar Period'}
                </span>
                {template.required_hours && (
                  <span className="text-slate-400 text-xs">{template.required_hours} hours</span>
                )}
                <span className="text-slate-400 text-xs capitalize">{template.frequency}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrainingRequirementsPage;
