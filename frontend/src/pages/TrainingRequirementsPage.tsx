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
  ExternalLink,
} from 'lucide-react';
import { trainingService, trainingProgramService } from '../services/api';
import type {
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  DueDateType,
  RequirementFrequency,
  RequirementType,
  TrainingType,
  RegistryInfo,
} from '../types/training';
import toast from 'react-hot-toast';

type FilterSource = 'all' | 'department' | 'state' | 'national';

const MEMBERSHIP_TYPES = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
  { value: 'honorary', label: 'Honorary' },
] as const;

/**
 * Training Requirements Management Page
 *
 * Allows training officers to create, manage, and track training requirements.
 * Supports department, state, and national registry requirements.
 */
const TrainingRequirementsPage: React.FC = () => {
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [registries, setRegistries] = useState<RegistryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateSeed, setTemplateSeed] = useState<TrainingRequirementCreate | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<TrainingRequirement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');

  // Build a lookup from registry name to source_url
  const registryUrlMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const reg of registries) {
      if (reg.source_url) {
        map[reg.name] = reg.source_url;
      }
    }
    return map;
  }, [registries]);

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqs, cats, regs] = await Promise.all([
        trainingService.getRequirements({ active_only: false }),
        trainingService.getCategories(false),
        trainingProgramService.getRegistries().catch(() => [] as RegistryInfo[]),
      ]);
      setRequirements(reqs);
      setCategories(cats);
      setRegistries(regs);
    } catch (_error) {
      toast.error('Failed to load training requirements');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this requirement? This action cannot be undone.')) return;

    try {
      await trainingService.deleteRequirement(id);
      setRequirements(requirements.filter(r => r.id !== id));
      toast.success('Requirement permanently deleted');
    } catch (_error) {
      toast.error('Failed to delete requirement');
    }
  };

  const handleDuplicate = async (requirement: TrainingRequirement) => {
    try {
      // Copy every quantity field: the create endpoint rejects e.g. a shifts
      // requirement without required_shifts, so a partial copy 422s or
      // silently loses data (checklist items, passing scores, etc.)
      const newReq: TrainingRequirementCreate = {
        name: `${requirement.name} (Copy)`,
        description: requirement.description,
        requirement_type: requirement.requirement_type || 'hours',
        source: requirement.source,
        registry_name: requirement.registry_name,
        registry_code: requirement.registry_code,
        training_type: requirement.training_type,
        required_hours: requirement.required_hours,
        required_courses: requirement.required_courses,
        required_shifts: requirement.required_shifts,
        required_calls: requirement.required_calls,
        required_call_types: requirement.required_call_types,
        required_skills: requirement.required_skills,
        checklist_items: requirement.checklist_items,
        passing_score: requirement.passing_score,
        max_attempts: requirement.max_attempts,
        frequency: requirement.frequency,
        year: requirement.year,
        applies_to_all: requirement.applies_to_all,
        required_roles: requirement.required_roles,
        required_positions: requirement.required_positions,
        required_membership_types: requirement.required_membership_types,
        start_date: requirement.start_date,
        due_date: requirement.due_date,
        time_limit_days: requirement.time_limit_days,
        due_date_type: requirement.due_date_type,
        rolling_period_months: requirement.rolling_period_months,
        period_start_month: requirement.period_start_month,
        period_start_day: requirement.period_start_day,
        period_end_month: requirement.period_end_month,
        period_end_day: requirement.period_end_day,
        include_current_month: requirement.include_current_month,
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
      setTemplateSeed(null);
    } catch (_error) {
      toast.error('Failed to save requirement');
    }
  };

  const filteredRequirements = requirements.filter(req => {
    const matchesSearch = req.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSource = filterSource === 'all' || req.source === filterSource;
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
              onClick={() => { void fetchData(); }}
              className="p-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
              aria-label="Refresh requirements"
            >
              <RefreshCcw className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={() => setShowTemplateModal(true)}
              className="btn-info flex font-medium items-center space-x-2"
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
              <span>Use Template</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-success flex font-medium items-center space-x-2"
            >
              <Plus className="w-5 h-5" aria-hidden="true" />
              <span>Create Requirement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter requirements">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                <label htmlFor="req-search" className="sr-only">Search requirements</label>
                <input
                  id="req-search"
                  type="text"
                  aria-label="Search requirements..." placeholder="Search requirements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input focus:border-transparent pl-10 placeholder-theme-text-muted pr-4"
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
                className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring focus:border-transparent"
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
            <div className="card p-12 text-center">
              <FileText className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-theme-text-primary text-xl font-semibold mb-2">No Requirements Found</h3>
              <p className="text-theme-text-muted mb-6">
                {searchTerm ? 'Try adjusting your search or filters' : 'Get started by creating your first training requirement'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-success font-medium px-6 py-3"
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
                registryUrlMap={registryUrlMap}
                isExpanded={expandedId === requirement.id}
                onToggleExpand={() => setExpandedId(expandedId === requirement.id ? null : requirement.id)}
                onEdit={() => {
                  setSelectedRequirement(requirement);
                  setShowCreateModal(true);
                }}
                onDelete={() => { void handleDelete(requirement.id); }}
                onDuplicate={() => { void handleDuplicate(requirement); }}
                onToggleActive={() => { void toggleActive(requirement.id); }}
              />
            ))
          )}
        </div>

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <RequirementModal
            requirement={selectedRequirement}
            template={templateSeed}
            categories={categories}
            onClose={() => {
              setShowCreateModal(false);
              setSelectedRequirement(null);
              setTemplateSeed(null);
            }}
            onSave={(...args) => { void handleSave(...args); }}
          />
        )}

        {/* Template Modal */}
        {showTemplateModal && (
          <TemplateModal
            onClose={() => setShowTemplateModal(false)}
            onSelect={(template) => {
              // Open the create form pre-filled instead of saving immediately,
              // so officers confirm hours/assignment before the requirement
              // starts counting against members
              setTemplateSeed(template);
              setShowTemplateModal(false);
              setShowCreateModal(true);
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
  registryUrlMap: Record<string, string>;
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
  registryUrlMap,
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
      case 'knowledge_test': return 'Knowledge Test';
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
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-theme-text-primary text-lg font-bold">{requirement.name}</h3>
              {requirement.requirement_type && (
                <span className="text-xs font-semibold px-2 py-1 rounded-sm bg-green-700 text-theme-text-primary">
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
              {requirement.source && requirement.source !== 'department' && (
                <span className={`text-xs font-semibold px-2 py-1 rounded ${
                  requirement.source === 'national' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                  'bg-green-500/20 text-green-700 dark:text-green-400'
                }`}>
                  {requirement.registry_name || (requirement.source === 'national' ? 'National' : 'State')}
                </span>
              )}
              {!requirement.active && (
                <span className="text-xs font-semibold px-2 py-1 rounded-sm bg-theme-surface-hover text-theme-text-primary">
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
                  <span>
                    {requirement.required_membership_types?.length
                      ? requirement.required_membership_types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
                      : 'Specific Roles/Members'}
                  </span>
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
              title={requirement.active ? 'Deactivate' : 'Activate'}
              aria-label={requirement.active ? 'Deactivate requirement' : 'Activate requirement'}
            >
              {requirement.active ? <CheckCircle className="w-5 h-5" aria-hidden="true" /> : <AlertCircle className="w-5 h-5" aria-hidden="true" />}
            </button>
            <button
              onClick={onEdit}
              className="p-2 bg-blue-600/20 text-blue-700 dark:text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors"
              title="Edit"
              aria-label="Edit requirement"
            >
              <Edit className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-2 bg-purple-600/20 text-purple-700 dark:text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors"
              title="Duplicate"
              aria-label="Duplicate requirement"
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 bg-red-600/20 text-red-700 dark:text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
              title="Delete"
              aria-label="Delete requirement"
            >
              <Trash2 className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
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
                <DetailRow label="Source" value={
                  requirement.source === 'national' ? (requirement.registry_name || 'National') :
                  requirement.source === 'state' ? (requirement.registry_name || 'State') :
                  'Department'
                } />
                {requirement.registry_name && registryUrlMap[requirement.registry_name] && (
                  <div className="flex justify-between">
                    <span className="text-theme-text-muted text-sm">Citation:</span>
                    <a
                      href={registryUrlMap[requirement.registry_name]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      <span>View source</span>
                    </a>
                  </div>
                )}
                <DetailRow label="Training Type" value={requirement.training_type || 'Any'} />
                <DetailRow label="Due Date Type" value={getDueDateTypeLabel(requirement.due_date_type)} />
                <DetailRow label="Frequency" value={requirement.frequency.replace('_', ' ')} />
                {requirement.required_hours && (
                  <DetailRow label="Required Hours" value={`${requirement.required_hours} hours`} />
                )}
                {requirement.required_shifts != null && (
                  <DetailRow label="Required Shifts" value={String(requirement.required_shifts)} />
                )}
                {requirement.required_calls != null && (
                  <DetailRow label="Required Calls" value={String(requirement.required_calls)} />
                )}
                {requirement.required_courses && requirement.required_courses.length > 0 && (
                  <DetailRow label="Required Courses" value={requirement.required_courses.join(', ')} />
                )}
                {requirement.checklist_items && requirement.checklist_items.length > 0 && (
                  <DetailRow label="Checklist Items" value={String(requirement.checklist_items.length)} />
                )}
                {requirement.passing_score != null && (
                  <DetailRow label="Passing Score" value={`${requirement.passing_score}%`} />
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
                {requirement.due_date_type === 'calendar_period' && requirement.period_end_month && (
                  <DetailRow
                    label="Period End"
                    value={`Month ${requirement.period_end_month}, Day ${requirement.period_end_day || 'last'}`}
                  />
                )}
              </DetailSection>

              <DetailSection title="Assignment">
                <DetailRow
                  label="Applies To"
                  value={requirement.applies_to_all ? 'All Members' : 'Specific Groups'}
                />
                {requirement.required_membership_types && requirement.required_membership_types.length > 0 && (
                  <DetailRow
                    label="Member Categories"
                    value={requirement.required_membership_types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}
                  />
                )}
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
  template?: TrainingRequirementCreate | null;
  categories: TrainingCategory[];
  onClose: () => void;
  onSave: (data: TrainingRequirementCreate | TrainingRequirementUpdate, isEdit: boolean, id?: string) => void;
}

const RequirementModal: React.FC<RequirementModalProps> = ({
  requirement,
  template,
  categories,
  onClose,
  onSave,
}) => {
  const seed = requirement ?? template;
  const [formData, setFormData] = useState({
    name: seed?.name || '',
    description: seed?.description || '',
    requirement_type: (seed?.requirement_type || 'hours'),
    training_type: seed?.training_type || '',
    required_hours: seed?.required_hours || undefined,
    required_courses: (seed?.required_courses || []).join('\n'),
    required_shifts: seed?.required_shifts || undefined,
    required_calls: seed?.required_calls || undefined,
    checklist_items: (seed?.checklist_items || []).join('\n'),
    passing_score: seed?.passing_score || undefined,
    max_attempts: seed?.max_attempts || undefined,
    frequency: seed?.frequency || 'annual' as RequirementFrequency,
    year: seed?.year || new Date().getFullYear() as number | undefined,
    applies_to_all: seed?.applies_to_all ?? true,
    required_membership_types: seed?.required_membership_types || [] as string[],
    due_date: seed?.due_date || '',
    start_date: seed?.start_date || '',
    due_date_type: seed?.due_date_type || 'calendar_period' as DueDateType,
    rolling_period_months: seed?.rolling_period_months || 12,
    period_start_month: seed?.period_start_month || 1,
    period_start_day: seed?.period_start_day || 1,
    period_end_month: seed?.period_end_month || undefined as number | undefined,
    period_end_day: seed?.period_end_day || undefined as number | undefined,
    include_current_month_mode:
      seed?.include_current_month == null
        ? 'inherit'
        : seed.include_current_month
          ? 'include'
          : 'exclude',
    category_ids: seed?.category_ids || [] as string[],
  });

  const [saving, setSaving] = useState(false);

  const splitLines = (value: string): string[] =>
    value.split('\n').map(line => line.trim()).filter(Boolean);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }

    // Mirror the backend TrainingRequirementCreate validator so users get a
    // specific message instead of a generic 422 failure
    const courses = splitLines(formData.required_courses);
    const checklistItems = splitLines(formData.checklist_items);
    if (formData.requirement_type === 'hours' && !formData.required_hours) {
      toast.error('Required hours must be set for an hours requirement');
      return;
    }
    if (formData.requirement_type === 'courses' && courses.length === 0) {
      toast.error('List at least one course for a courses requirement');
      return;
    }
    if (formData.requirement_type === 'shifts' && !formData.required_shifts) {
      toast.error('Required shifts must be set for a shifts requirement');
      return;
    }
    if (formData.requirement_type === 'calls' && !formData.required_calls) {
      toast.error('Required calls must be set for a calls requirement');
      return;
    }
    if (formData.requirement_type === 'knowledge_test' && !formData.passing_score) {
      toast.error('Passing score must be set for a knowledge test requirement');
      return;
    }

    // A requirement that applies to nobody silently disappears from every
    // member's compliance view — block it unless the record targets by
    // role/position (set outside this form)
    const hasRoleTargeting =
      (seed?.required_roles?.length || 0) > 0 || (seed?.required_positions?.length || 0) > 0;
    if (!formData.applies_to_all && formData.required_membership_types.length === 0 && !hasRoleTargeting) {
      toast.error('Select at least one member category, or check "Applies to all members"');
      return;
    }

    setSaving(true);
    try {
      const data = {
        name: formData.name,
        ...(formData.description ? { description: formData.description } : {}),
        requirement_type: formData.requirement_type,
        ...(formData.training_type ? { training_type: formData.training_type as TrainingType } : {}),
        ...(formData.required_hours ? { required_hours: formData.required_hours } : {}),
        ...(formData.requirement_type === 'courses' ? { required_courses: courses } : {}),
        ...(formData.requirement_type === 'shifts' && formData.required_shifts
          ? { required_shifts: formData.required_shifts } : {}),
        ...(formData.requirement_type === 'calls' && formData.required_calls
          ? { required_calls: formData.required_calls } : {}),
        ...(formData.requirement_type === 'checklist' && checklistItems.length > 0
          ? { checklist_items: checklistItems } : {}),
        ...(formData.requirement_type === 'knowledge_test' && formData.passing_score
          ? { passing_score: formData.passing_score } : {}),
        ...(formData.requirement_type === 'knowledge_test' && formData.max_attempts
          ? { max_attempts: formData.max_attempts } : {}),
        frequency: formData.frequency,
        ...(formData.year ? { year: formData.year } : {}),
        applies_to_all: formData.applies_to_all,
        required_membership_types: formData.required_membership_types.length > 0 ? formData.required_membership_types : undefined,
        ...(formData.due_date ? { due_date: formData.due_date } : {}),
        ...(formData.start_date ? { start_date: formData.start_date } : {}),
        due_date_type: formData.due_date_type,
        rolling_period_months: formData.due_date_type === 'rolling' ? formData.rolling_period_months : undefined,
        period_start_month: formData.due_date_type === 'calendar_period' ? formData.period_start_month : undefined,
        period_start_day: formData.due_date_type === 'calendar_period' ? formData.period_start_day : undefined,
        period_end_month: formData.due_date_type === 'calendar_period' ? formData.period_end_month : undefined,
        period_end_day: formData.due_date_type === 'calendar_period' ? formData.period_end_day : undefined,
        include_current_month:
          formData.include_current_month_mode === 'inherit'
            ? null
            : formData.include_current_month_mode === 'include',
        category_ids: formData.category_ids.length > 0 ? formData.category_ids : undefined,
        // Preserve registry attribution when creating from a standards template
        ...(!requirement && template?.source ? { source: template.source } : {}),
        ...(!requirement && template?.registry_name ? { registry_name: template.registry_name } : {}),
        ...(!requirement && template?.registry_code ? { registry_code: template.registry_code } : {}),
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
                className="form-input placeholder-theme-text-muted"
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
                className="form-input placeholder-theme-text-muted"
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
                onChange={(e) => {
                  const reqType = e.target.value as RequirementType;
                  // Auto-set related fields when there's a direct mapping
                  const trainingTypeMap: Record<string, string> = {
                    certification: 'certification',
                    skills_evaluation: 'skills_practice',
                  };
                  const dueDateTypeMap: Record<string, DueDateType> = {
                    certification: 'certification_period' as DueDateType,
                  };
                  const autoTrainingType = trainingTypeMap[reqType];
                  const autoDueDateType = dueDateTypeMap[reqType];
                  setFormData({
                    ...formData,
                    requirement_type: reqType,
                    ...(autoTrainingType ? { training_type: autoTrainingType } : {}),
                    ...(autoDueDateType ? { due_date_type: autoDueDateType } : {}),
                  });
                }}
                className="form-input"
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
                <option value="knowledge_test">Knowledge Test</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-training-type" className="block text-sm font-medium text-theme-text-secondary mb-2">Training Type</label>
                <select
                  id="req-training-type"
                  value={formData.training_type}
                  onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                  className="form-input"
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
                <label htmlFor="req-required-hours" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Required Hours{formData.requirement_type === 'hours' && (
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400"> *</span>
                  )}
                </label>
                <input
                  id="req-required-hours"
                  type="number"
                  value={formData.required_hours || ''}
                  onChange={(e) => setFormData({ ...formData, required_hours: e.target.value ? Number(e.target.value) : undefined })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 36"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>

            {/* Per-type quantity fields */}
            {formData.requirement_type === 'courses' && (
              <div>
                <label htmlFor="req-required-courses" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Required Courses <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
                </label>
                <textarea
                  id="req-required-courses"
                  value={formData.required_courses}
                  onChange={(e) => setFormData({ ...formData, required_courses: e.target.value })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder={'One course per line, e.g.\nICS-100\nICS-200'}
                  rows={4}
                />
                <p className="text-theme-text-muted text-sm mt-1">
                  Members must complete every course listed (one per line).
                </p>
              </div>
            )}

            {formData.requirement_type === 'shifts' && (
              <div>
                <label htmlFor="req-required-shifts" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Required Shifts <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  id="req-required-shifts"
                  type="number"
                  value={formData.required_shifts || ''}
                  onChange={(e) => setFormData({ ...formData, required_shifts: e.target.value ? Number(e.target.value) : undefined })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 12"
                  min="1"
                />
              </div>
            )}

            {formData.requirement_type === 'calls' && (
              <div>
                <label htmlFor="req-required-calls" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Required Calls <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  id="req-required-calls"
                  type="number"
                  value={formData.required_calls || ''}
                  onChange={(e) => setFormData({ ...formData, required_calls: e.target.value ? Number(e.target.value) : undefined })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 24"
                  min="1"
                />
              </div>
            )}

            {formData.requirement_type === 'checklist' && (
              <div>
                <label htmlFor="req-checklist-items" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Checklist Items
                </label>
                <textarea
                  id="req-checklist-items"
                  value={formData.checklist_items}
                  onChange={(e) => setFormData({ ...formData, checklist_items: e.target.value })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder={'One item per line, e.g.\nStation tour completed\nSCBA fit test'}
                  rows={5}
                />
                <p className="text-theme-text-muted text-sm mt-1">
                  Each line becomes an item members must check off.
                </p>
              </div>
            )}

            {formData.requirement_type === 'knowledge_test' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="req-passing-score" className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Passing Score (%) <span aria-hidden="true" className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    id="req-passing-score"
                    type="number"
                    value={formData.passing_score || ''}
                    onChange={(e) => setFormData({ ...formData, passing_score: e.target.value ? Number(e.target.value) : undefined })}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 80"
                    min="1"
                    max="100"
                  />
                </div>
                <div>
                  <label htmlFor="req-max-attempts" className="block text-sm font-medium text-theme-text-secondary mb-2">Max Attempts</label>
                  <input
                    id="req-max-attempts"
                    type="number"
                    value={formData.max_attempts || ''}
                    onChange={(e) => setFormData({ ...formData, max_attempts: e.target.value ? Number(e.target.value) : undefined })}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="Unlimited"
                    min="1"
                  />
                </div>
              </div>
            )}
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
                  className="form-input"
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
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="req-period-start-month" className="block text-sm font-medium text-theme-text-secondary mb-2">Period Start Month</label>
                    <select
                      id="req-period-start-month"
                      value={formData.period_start_month}
                      onChange={(e) => setFormData({ ...formData, period_start_month: Number(e.target.value) })}
                      className="form-input"
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
                      className="form-input"
                      min="1"
                      max="31"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="req-period-end-month" className="block text-sm font-medium text-theme-text-secondary mb-2">Period End Month (Optional)</label>
                    <select
                      id="req-period-end-month"
                      value={formData.period_end_month || ''}
                      onChange={(e) => setFormData({ ...formData, period_end_month: e.target.value ? Number(e.target.value) : undefined })}
                      className="form-input"
                    >
                      <option value="">Default (end of year)</option>
                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                        <option key={idx} value={idx + 1}>{month}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="req-period-end-day" className="block text-sm font-medium text-theme-text-secondary mb-2">Period End Day</label>
                    <input
                      id="req-period-end-day"
                      type="number"
                      value={formData.period_end_day || ''}
                      onChange={(e) => setFormData({ ...formData, period_end_day: e.target.value ? Number(e.target.value) : undefined })}
                      className="form-input"
                      min="1"
                      max="31"
                      disabled={!formData.period_end_month}
                      placeholder={formData.period_end_month ? 'Last day of month' : ''}
                    />
                  </div>
                </div>
                {formData.period_end_month && formData.period_start_month > formData.period_end_month && (
                  <p className="text-theme-text-muted text-sm">
                    Cross-year window: completions accepted from month {formData.period_start_month} of the previous year through month {formData.period_end_month}, day {formData.period_end_day || 'last'} of the current year.
                  </p>
                )}
              </>
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
                  className="form-input"
                />
              </div>
            )}

            {/* Evaluation period boundary (per-requirement override) */}
            <div>
              <label htmlFor="req-include-current-month" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Evaluation Period
              </label>
              <select
                id="req-include-current-month"
                value={formData.include_current_month_mode}
                onChange={(e) => setFormData({ ...formData, include_current_month_mode: e.target.value })}
                className="form-input"
              >
                <option value="inherit">Use department default</option>
                <option value="include">Count the current (in-progress) month</option>
                <option value="exclude">Stop at the end of the previous month</option>
              </select>
              <p className="mt-1 text-xs text-theme-text-muted">
                Controls whether this requirement counts the in-progress month.
                Choose &ldquo;stop at the end of the previous month&rdquo; for
                drills held late in the month so members aren&rsquo;t flagged
                early. Defaults to the department-wide compliance setting.
              </p>
            </div>

            {/* Frequency & Year only apply to calendar-period due dates */}
            {formData.due_date_type === 'calendar_period' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="req-frequency" className="block text-sm font-medium text-theme-text-secondary mb-2">Frequency</label>
                  <select
                    id="req-frequency"
                    value={formData.frequency}
                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RequirementFrequency })}
                    className="form-input"
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
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 2026"
                    min="2020"
                    max="2100"
                  />
                </div>
              </div>
            )}
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
                  onChange={(e) => setFormData({
                    ...formData,
                    applies_to_all: e.target.checked,
                    ...(e.target.checked ? { required_membership_types: [] } : {}),
                  })}
                  className="w-5 h-5 rounded-sm border-theme-input-border bg-theme-input-bg text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                />
                <span className="text-theme-text-secondary">Applies to all members</span>
              </label>
              <p className="text-theme-text-muted text-sm mt-1 ml-8">
                When checked, this requirement applies to everyone in the organization.
              </p>
            </div>

            {/* Member Categories - shown when not applies_to_all */}
            {!formData.applies_to_all && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Member Categories</label>
                <p className="text-theme-text-muted text-sm mb-3">
                  Select which member categories this requirement applies to.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2" role="group" aria-label="Member categories">
                  {MEMBERSHIP_TYPES.map((memberType) => (
                    <label
                      key={memberType.value}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        formData.required_membership_types.includes(memberType.value)
                          ? 'border-red-500 bg-red-500/20 text-theme-text-primary'
                          : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.required_membership_types.includes(memberType.value)}
                        onChange={() => {
                          setFormData(prev => ({
                            ...prev,
                            required_membership_types: prev.required_membership_types.includes(memberType.value)
                              ? prev.required_membership_types.filter(v => v !== memberType.value)
                              : [...prev.required_membership_types, memberType.value],
                          }));
                        }}
                        className="w-4 h-4 rounded-sm border-theme-input-border bg-theme-input-bg text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                      />
                      <span className="text-sm">{memberType.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-start-date" className="block text-sm font-medium text-theme-text-secondary mb-2">Start Date</label>
                <input
                  id="req-start-date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="form-input"
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
              className="btn-success"
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
  // Templates default to applies_to_all: true (or explicit membership types)
  // because a requirement with applies_to_all: false and no targeting applies
  // to nobody and vanishes from every member's compliance view. Selecting a
  // template opens the create form, where officers can narrow the assignment.
  const templates: TrainingRequirementCreate[] = [
    {
      name: 'NFPA 1001 Firefighter Annual Training',
      description: 'Annual continuing education for firefighters certified to NFPA 1001 Firefighter I & II',
      requirement_type: 'hours',
      training_type: 'continuing_education',
      required_hours: 36,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'NFPA',
      registry_code: 'NFPA 1001',
    },
    {
      name: 'NFPA 1500 Occupational Safety Training',
      description: 'Annual occupational health and safety training required for all members',
      requirement_type: 'hours',
      training_type: 'continuing_education',
      required_hours: 8,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'NFPA',
      registry_code: 'NFPA 1500',
    },
    {
      name: 'NREMT EMT Recertification',
      description: '40 hours of continuing education per 2-year National Registry cycle (national, local/state, and individual components)',
      requirement_type: 'hours',
      training_type: 'continuing_education',
      required_hours: 40,
      frequency: 'biannual',
      applies_to_all: true,
      due_date_type: 'rolling',
      rolling_period_months: 24,
      source: 'national',
      registry_name: 'NREMT',
      registry_code: 'NREMT',
    },
    {
      name: 'CPR/BLS Certification',
      description: 'Maintain a current CPR/BLS provider certification (2-year certification cycle)',
      requirement_type: 'certification',
      frequency: 'biannual',
      applies_to_all: true,
      due_date_type: 'rolling',
      rolling_period_months: 24,
    },
    {
      name: 'Hazmat Operations Refresher',
      description: 'Annual hazardous materials operations-level refresher required by OSHA 29 CFR 1910.120',
      requirement_type: 'hours',
      training_type: 'refresher',
      required_hours: 8,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'OSHA',
      registry_code: '29 CFR 1910.120',
    },
    {
      name: 'Bloodborne Pathogens Annual Refresher',
      description: 'Annual bloodborne pathogens and exposure control plan training required by OSHA 29 CFR 1910.1030 for members with occupational exposure',
      requirement_type: 'hours',
      training_type: 'refresher',
      required_hours: 2,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'OSHA',
      registry_code: '29 CFR 1910.1030',
    },
    {
      name: 'HIPAA Privacy & Security Awareness',
      description: 'Annual HIPAA privacy and security training for all personnel with access to protected health information (patient care reports, EMS records)',
      requirement_type: 'hours',
      training_type: 'continuing_education',
      required_hours: 1,
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'HIPAA',
      registry_code: '45 CFR 164.530(b)',
    },
    {
      name: 'SCBA Fit Test & Respiratory Protection',
      description: 'Annual respirator fit testing and respiratory protection training required by OSHA 29 CFR 1910.134',
      requirement_type: 'checklist',
      checklist_items: [
        'Medical clearance for respirator use current',
        'Annual quantitative/qualitative fit test passed',
        'SCBA donning, doffing, and emergency procedures reviewed',
        'Facepiece seal check and user maintenance reviewed',
      ],
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'OSHA',
      registry_code: '29 CFR 1910.134',
    },
    {
      name: 'NIMS/ICS Initial Certification',
      description: 'One-time incident command system courses required for emergency responders under the National Incident Management System',
      requirement_type: 'courses',
      training_type: 'certification',
      required_courses: [
        'ICS-100: Introduction to the Incident Command System',
        'ICS-200: Basic Incident Command System for Initial Response',
        'IS-700: An Introduction to the National Incident Management System',
        'IS-800: National Response Framework, An Introduction',
      ],
      frequency: 'one_time',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      period_start_month: 1,
      period_start_day: 1,
      source: 'national',
      registry_name: 'FEMA',
      registry_code: 'NIMS',
    },
    {
      name: 'New Member Orientation Checklist',
      description: 'One-time onboarding checklist for probationary members',
      requirement_type: 'checklist',
      checklist_items: [
        'Station tour and facility safety orientation',
        'PPE issued and fit checked',
        'SCBA fit test completed',
        'Radio and communications procedures reviewed',
        'Department SOPs/SOGs reviewed',
      ],
      frequency: 'one_time',
      applies_to_all: false,
      required_membership_types: ['probationary'],
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
              Start from a common standard — you can review and adjust everything before saving
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
              className="card hover:bg-theme-surface-hover p-4 text-left transition-colors"
            >
              <h4 className="text-theme-text-primary font-semibold mb-2">{template.name}</h4>
              <p className="text-theme-text-muted text-sm mb-3">{template.description}</p>
              <div className="flex items-center space-x-2 flex-wrap gap-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${
                  template.due_date_type === 'rolling' ? 'bg-purple-600' : 'bg-blue-600'
                } text-theme-text-primary`}>
                  {template.due_date_type === 'rolling' ? 'Rolling' : 'Calendar Period'}
                </span>
                {template.registry_name && (
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-500/20 text-blue-700 dark:text-blue-400">
                    {template.registry_name}
                  </span>
                )}
                {template.required_hours && (
                  <span className="text-theme-text-muted text-xs">{template.required_hours} hours</span>
                )}
                {template.checklist_items && (
                  <span className="text-theme-text-muted text-xs">{template.checklist_items.length} items</span>
                )}
                {template.required_courses && (
                  <span className="text-theme-text-muted text-xs">{template.required_courses.length} courses</span>
                )}
                <span className="text-theme-text-muted text-xs capitalize">{template.frequency.replace('_', ' ')}</span>
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
