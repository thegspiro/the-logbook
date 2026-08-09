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
import { RequirementModal } from '../components/training/RequirementModal';
import { useCourseLibrary } from '../hooks/useCourseLibrary';
import { toChecklistItems } from '../utils/checklistItems';
import type {
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  DueDateType,
  RegistryInfo,
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
  const [registries, setRegistries] = useState<RegistryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateSeed, setTemplateSeed] = useState<TrainingRequirementCreate | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<TrainingRequirement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');

  // Course catalog, so a requirement's linked course ids render as names.
  const { courses } = useCourseLibrary();
  const courseNameById = React.useMemo(() => new Map(courses.map((c) => [c.id, c.name])), [courses]);

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
      setRequirements(requirements.filter((r) => r.id !== id));
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
    const requirement = requirements.find((r) => r.id === id);
    if (!requirement) return;

    try {
      await trainingService.updateRequirement(id, { active: !requirement.active });
      setRequirements(requirements.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
      toast.success(requirement.active ? 'Requirement deactivated' : 'Requirement activated');
    } catch (_error) {
      toast.error('Failed to update requirement');
    }
  };

  const handleSave = async (
    data: TrainingRequirementCreate | TrainingRequirementUpdate,
    isEdit: boolean,
    id?: string
  ) => {
    try {
      if (isEdit && id) {
        const updated = await trainingService.updateRequirement(id, data);
        setRequirements(requirements.map((r) => (r.id === id ? updated : r)));
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

  const filteredRequirements = requirements.filter((req) => {
    const matchesSearch =
      req.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSource = filterSource === 'all' || req.source === filterSource;
    return matchesSearch && matchesSource;
  });

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-primary" role="status" aria-live="polite">
              Loading requirements...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-theme-text-primary flex items-center space-x-3 text-3xl font-bold">
              <FileText className="h-8 w-8 text-red-700 dark:text-red-500" aria-hidden="true" />
              <span>Training Requirements</span>
            </h1>
            <p className="text-theme-text-muted mt-1">Manage department, state, and national training requirements</p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                void fetchData();
              }}
              className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg p-2 transition-colors"
              aria-label="Refresh requirements"
            >
              <RefreshCcw className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={() => setShowTemplateModal(true)}
              className="btn-info flex items-center space-x-2 font-medium"
            >
              <Copy className="h-5 w-5" aria-hidden="true" />
              <span>Use Template</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-success flex items-center space-x-2 font-medium"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              <span>Create Requirement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter requirements">
          <div className="flex flex-col gap-4 md:flex-row">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search
                  className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                  aria-hidden="true"
                />
                <label htmlFor="req-search" className="sr-only">
                  Search requirements
                </label>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  id="req-search"
                  type="text"
                  aria-label="Search requirements..."
                  placeholder="Search requirements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input placeholder-theme-text-muted pr-4 pl-10 focus:border-transparent"
                />
              </div>
            </div>

            {/* Source Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
              <label htmlFor="source-filter" className="sr-only">
                Filter by source
              </label>
              <select
                id="source-filter"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-4 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden"
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
              <FileText className="text-theme-text-muted mx-auto mb-4 h-16 w-16" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-xl font-semibold">No Requirements Found</h3>
              <p className="text-theme-text-muted mb-6">
                {searchTerm
                  ? 'Try adjusting your search or filters'
                  : 'Get started by creating your first training requirement'}
              </p>
              <button onClick={() => setShowCreateModal(true)} className="btn-success px-6 py-3 font-medium">
                Create First Requirement
              </button>
            </div>
          ) : (
            filteredRequirements.map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                categories={categories}
                courseNameById={courseNameById}
                registryUrlMap={registryUrlMap}
                isExpanded={expandedId === requirement.id}
                onToggleExpand={() => setExpandedId(expandedId === requirement.id ? null : requirement.id)}
                onEdit={() => {
                  setSelectedRequirement(requirement);
                  setShowCreateModal(true);
                }}
                onDelete={() => {
                  void handleDelete(requirement.id);
                }}
                onDuplicate={() => {
                  void handleDuplicate(requirement);
                }}
                onToggleActive={() => {
                  void toggleActive(requirement.id);
                }}
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
            onSave={(...args) => {
              void handleSave(...args);
            }}
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
  /** Course id → name, for rendering linked courses instead of raw ids. */
  courseNameById: Map<string, string>;
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
  courseNameById,
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
      case 'hours':
        return 'Hours';
      case 'courses':
        return 'Courses';
      case 'certification':
        return 'Certification';
      case 'shifts':
        return 'Shifts';
      case 'calls':
        return 'Calls';
      case 'skills_evaluation':
        return 'Skills Evaluation';
      case 'checklist':
        return 'Checklist';
      case 'knowledge_test':
        return 'Knowledge Test';
      default:
        return type;
    }
  };

  const getDueDateTypeLabel = (type: DueDateType) => {
    switch (type) {
      case 'calendar_period':
        return 'Calendar Period';
      case 'rolling':
        return 'Rolling';
      case 'certification_period':
        return 'Certification Period';
      case 'fixed_date':
        return 'Fixed Date';
      default:
        return type;
    }
  };

  const getCategoryNames = () => {
    if (!requirement.category_ids?.length) return null;
    return categories
      .filter((c) => requirement.category_ids?.includes(c.id))
      .map((c) => c.name)
      .join(', ');
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center space-x-3">
              <h3 className="text-theme-text-primary text-lg font-bold">{requirement.name}</h3>
              {requirement.requirement_type && (
                <span className="text-theme-text-primary rounded-sm bg-green-700 px-2 py-1 text-xs font-semibold">
                  {getRequirementTypeLabel(requirement.requirement_type)}
                </span>
              )}
              {/* A one-time requirement has no due-date cycle, so showing its
                  (unused) due date type here read as a recurring schedule —
                  "Calendar Period" implies an annual Dec 31 reset. */}
              {requirement.frequency === 'one_time' ? (
                <span className="text-theme-text-primary rounded bg-teal-700 px-2 py-1 text-xs font-semibold">
                  One Time
                </span>
              ) : (
                <span
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    requirement.due_date_type === 'rolling'
                      ? 'bg-purple-600'
                      : requirement.due_date_type === 'calendar_period'
                        ? 'bg-blue-600'
                        : requirement.due_date_type === 'certification_period'
                          ? 'bg-orange-600'
                          : 'bg-theme-surface-hover'
                  } text-theme-text-primary`}
                >
                  {getDueDateTypeLabel(requirement.due_date_type)}
                </span>
              )}
              {requirement.source && requirement.source !== 'department' && (
                <span
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    requirement.source === 'national'
                      ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                      : 'bg-green-500/20 text-green-700 dark:text-green-400'
                  }`}
                >
                  {requirement.registry_name || (requirement.source === 'national' ? 'National' : 'State')}
                </span>
              )}
              {!requirement.active && (
                <span className="bg-theme-surface-hover text-theme-text-primary rounded-sm px-2 py-1 text-xs font-semibold">
                  Inactive
                </span>
              )}
            </div>
            {requirement.description && <p className="text-theme-text-muted mb-3 text-sm">{requirement.description}</p>}

            {/* Misconfiguration warning — a requirement with no target for its
                type can never be completed (and used to read as compliant). */}
            {requirement.config_warning && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400" />
                <p className="text-xs text-yellow-800 dark:text-yellow-300">{requirement.config_warning}</p>
              </div>
            )}

            {/* Quick Info */}
            <div className="flex flex-wrap gap-3 text-sm">
              {requirement.required_hours && (
                <div className="text-theme-text-secondary flex items-center space-x-2">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  <span>{requirement.required_hours} hours</span>
                </div>
              )}
              <div className="text-theme-text-secondary flex items-center space-x-2">
                <Award className="h-4 w-4" aria-hidden="true" />
                <span className="capitalize">
                  {requirement.frequency === 'one_time'
                    ? 'One time — never resets'
                    : requirement.frequency.replace('_', ' ')}
                </span>
              </div>
              {requirement.applies_to_all ? (
                <div className="text-theme-text-secondary flex items-center space-x-2">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  <span>All Members</span>
                </div>
              ) : (
                <div className="text-theme-text-secondary flex items-center space-x-2">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {requirement.required_membership_types?.length
                      ? requirement.required_membership_types
                          .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
                          .join(', ')
                      : 'Specific Roles/Members'}
                  </span>
                </div>
              )}
              {requirement.due_date_type === 'rolling' && requirement.rolling_period_months && (
                <div className="text-theme-text-secondary flex items-center space-x-2">
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  <span>Every {requirement.rolling_period_months} months</span>
                </div>
              )}
              {getCategoryNames() && (
                <div className="text-theme-text-secondary flex items-center space-x-2">
                  <Tag className="h-4 w-4" aria-hidden="true" />
                  <span>{getCategoryNames()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="ml-4 flex items-center space-x-2">
            <button
              onClick={onToggleActive}
              className={`rounded-lg p-2 transition-colors ${
                requirement.active
                  ? 'bg-green-600/20 text-green-700 hover:bg-green-600/30 dark:text-green-400'
                  : 'bg-theme-surface-hover/20 text-theme-text-muted hover:bg-theme-surface-hover/30'
              }`}
              title={requirement.active ? 'Deactivate' : 'Activate'}
              aria-label={requirement.active ? 'Deactivate requirement' : 'Activate requirement'}
            >
              {requirement.active ? (
                <CheckCircle className="h-5 w-5" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            <button
              onClick={onEdit}
              className="rounded-lg bg-blue-600/20 p-2 text-blue-700 transition-colors hover:bg-blue-600/30 dark:text-blue-400"
              title="Edit"
              aria-label="Edit requirement"
            >
              <Edit className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDuplicate}
              className="rounded-lg bg-purple-600/20 p-2 text-purple-700 transition-colors hover:bg-purple-600/30 dark:text-purple-400"
              title="Duplicate"
              aria-label="Duplicate requirement"
            >
              <Copy className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg bg-red-600/20 p-2 text-red-700 transition-colors hover:bg-red-600/30 dark:text-red-400"
              title="Delete"
              aria-label="Delete requirement"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={onToggleExpand}
              className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg p-2 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              {isExpanded ? (
                <ChevronUp className="h-5 w-5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="border-theme-surface-border mt-6 space-y-4 border-t pt-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <DetailSection title="Requirement Details">
                <DetailRow
                  label="Source"
                  value={
                    requirement.source === 'national'
                      ? requirement.registry_name || 'National'
                      : requirement.source === 'state'
                        ? requirement.registry_name || 'State'
                        : 'Department'
                  }
                />
                {requirement.registry_name && registryUrlMap[requirement.registry_name] && (
                  <div className="flex justify-between">
                    <span className="text-theme-text-muted text-sm">Citation:</span>
                    <a
                      href={registryUrlMap[requirement.registry_name]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span>View source</span>
                    </a>
                  </div>
                )}
                <DetailRow label="Training Type" value={requirement.training_type || 'Any'} />
                {/* Due date type, period and year describe a recurring cycle
                    that a one-time requirement does not have — the backend
                    evaluates one_time over an unbounded window and ignores all
                    three, so surfacing them only implied an annual reset. */}
                {requirement.frequency !== 'one_time' && (
                  <DetailRow label="Due Date Type" value={getDueDateTypeLabel(requirement.due_date_type)} />
                )}
                <DetailRow
                  label="Frequency"
                  value={
                    requirement.frequency === 'one_time'
                      ? 'One time — completion never expires'
                      : requirement.frequency.replace('_', ' ')
                  }
                />
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
                  <DetailRow
                    label={requirement.requirement_type === 'certification' ? 'Earned By' : 'Required Courses'}
                    // Pre-picker requirements stored course *names* here, which
                    // the map can't resolve — show the stored value rather than
                    // a blank so those legacy entries stay diagnosable.
                    value={requirement.required_courses.map((id) => courseNameById.get(id) ?? id).join(', ')}
                  />
                )}
                {requirement.recency_days != null && (
                  <DetailRow
                    label="Recency Window"
                    value={`Completed within the last ${requirement.recency_days} days`}
                  />
                )}
                {requirement.checklist_items && requirement.checklist_items.length > 0 && (
                  <DetailRow label="Checklist Items" value={String(requirement.checklist_items.length)} />
                )}
                {requirement.passing_score != null && (
                  <DetailRow label="Passing Score" value={`${requirement.passing_score}%`} />
                )}
                {requirement.year && requirement.frequency !== 'one_time' && (
                  <DetailRow label="Year" value={String(requirement.year)} />
                )}
                {requirement.due_date && <DetailRow label="Due Date" value={requirement.due_date} />}
                {requirement.frequency !== 'one_time' &&
                  requirement.due_date_type === 'rolling' &&
                  requirement.rolling_period_months && (
                    <DetailRow label="Rolling Period" value={`${requirement.rolling_period_months} months`} />
                  )}
                {requirement.frequency !== 'one_time' && requirement.due_date_type === 'calendar_period' && (
                  <DetailRow
                    label="Period Start"
                    value={`Month ${requirement.period_start_month || 1}, Day ${requirement.period_start_day || 1}`}
                  />
                )}
                {requirement.frequency !== 'one_time' &&
                  requirement.due_date_type === 'calendar_period' &&
                  requirement.period_end_month && (
                    <DetailRow
                      label="Period End"
                      value={`Month ${requirement.period_end_month}, Day ${requirement.period_end_day || 'last'}`}
                    />
                  )}
              </DetailSection>

              <DetailSection title="Assignment">
                <DetailRow label="Applies To" value={requirement.applies_to_all ? 'All Members' : 'Specific Groups'} />
                {requirement.required_membership_types && requirement.required_membership_types.length > 0 && (
                  <DetailRow
                    label="Member Categories"
                    value={requirement.required_membership_types
                      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
                      .join(', ')}
                  />
                )}
                {requirement.required_roles && requirement.required_roles.length > 0 && (
                  <DetailRow label="Required Roles" value={requirement.required_roles.join(', ')} />
                )}
                {requirement.category_ids && requirement.category_ids.length > 0 && (
                  <DetailRow label="Categories" value={getCategoryNames() || ''} />
                )}
                {requirement.start_date && <DetailRow label="Start Date" value={requirement.start_date} />}
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
    <h4 className="text-theme-text-primary mb-3 font-semibold">{title}</h4>
    <div className="space-y-2">{children}</div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-theme-text-muted text-sm">{label}:</span>
    <span className="text-theme-text-primary text-sm font-medium capitalize">{value}</span>
  </div>
);

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
      description:
        '40 hours of continuing education per 2-year National Registry cycle (national, local/state, and individual components)',
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
      description:
        'Annual bloodborne pathogens and exposure control plan training required by OSHA 29 CFR 1910.1030 for members with occupational exposure',
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
      description:
        'Annual HIPAA privacy and security training for all personnel with access to protected health information (patient care reports, EMS records)',
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
      checklist_items: toChecklistItems([
        'Medical clearance for respirator use current',
        'Annual quantitative/qualitative fit test passed',
        'SCBA donning, doffing, and emergency procedures reviewed',
        'Facepiece seal check and user maintenance reviewed',
      ]),
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
      // The four FEMA courses are named in the description rather than seeded
      // into required_courses: that field holds course-library ids, which are
      // per-department, so a starter template can't know them. The officer
      // links the matching library courses when applying the template.
      description:
        'One-time incident command system courses required for emergency responders under the National Incident Management System. Link ICS-100, ICS-200, IS-700, and IS-800 from the course library.',
      requirement_type: 'courses',
      training_type: 'certification',
      frequency: 'one_time',
      applies_to_all: true,
      source: 'national',
      registry_name: 'FEMA',
      registry_code: 'NIMS',
    },
    {
      name: 'New Member Orientation Checklist',
      description: 'One-time onboarding checklist for probationary members — completed once, never repeats',
      requirement_type: 'checklist',
      training_type: 'orientation',
      checklist_items: toChecklistItems([
        'Station tour and facility safety orientation',
        'PPE issued and fit checked',
        'SCBA fit test completed',
        'Radio and communications procedures reviewed',
        'Department SOPs/SOGs reviewed',
      ]),
      frequency: 'one_time',
      applies_to_all: false,
      required_membership_types: ['probationary'],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[80dvh] w-full max-w-4xl overflow-y-auto rounded-lg p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 id="template-modal-title" className="text-theme-text-primary text-xl font-bold">
              Select a Template
            </h3>
            <p className="text-theme-text-muted mt-1">
              Start from a common standard — you can review and adjust everything before saving
            </p>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-2 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.map((template, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(template)}
              className="card hover:bg-theme-surface-hover p-4 text-left transition-colors"
            >
              <h4 className="text-theme-text-primary mb-2 font-semibold">{template.name}</h4>
              <p className="text-theme-text-muted mb-3 text-sm">{template.description}</p>
              <div className="flex flex-wrap items-center gap-2 space-x-2">
                <span
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    template.due_date_type === 'rolling' ? 'bg-purple-600' : 'bg-blue-600'
                  } text-theme-text-primary`}
                >
                  {template.due_date_type === 'rolling' ? 'Rolling' : 'Calendar Period'}
                </span>
                {template.registry_name && (
                  <span className="rounded bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
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
            className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg px-4 py-2 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrainingRequirementsPage;
