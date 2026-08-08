import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  LayoutTemplate,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Clock,
  Calendar,
  Repeat,
  Play,
  CheckCircle,
  Users,
  Truck,
  Filter,
} from 'lucide-react';
import { schedulingService } from '../modules/scheduling/services/api';
import type { ApparatusOption } from '../modules/scheduling/services/api';
import type { ShiftTemplateCreate, ShiftPatternCreate } from '../modules/scheduling/types';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import TemplateFormModal from '../modules/scheduling/components/TemplateFormModal';
import PatternFormModal from '../modules/scheduling/components/PatternFormModal';
import GenerateShiftsModal from '../modules/scheduling/components/GenerateShiftsModal';
import type {
  ShiftTemplate,
  ShiftPattern,
  TemplateFormData,
  PatternFormData,
  TemplateCategory,
  ResourceUnit,
  PositionEntry,
  EventType,
} from '../modules/scheduling/components/shiftTemplateTypes';
import {
  TEMPLATE_CATEGORIES,
  EVENT_TYPES,
  RESOURCE_TYPE_OPTIONS,
  PATTERN_TYPES,
  getPositionOptions,
} from '../modules/scheduling/components/shiftTemplateTypes';

type TabView = 'templates' | 'patterns';

export const ShiftTemplatesPage: React.FC = () => {
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<TabView>('templates');
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const [showPatternModal, setShowPatternModal] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ShiftPattern | null>(null);
  const [deletingPatternId, setDeletingPatternId] = useState<string | null>(null);
  const [generatingPattern, setGeneratingPattern] = useState<ShiftPattern | null>(null);

  const [apparatusOptions, setApparatusOptions] = useState<ApparatusOption[]>([]);
  const [apparatusSource, setApparatusSource] = useState<'apparatus' | 'basic' | 'default'>('default');

  const loadTemplates = useCallback(async () => {
    try {
      const data = await schedulingService.getTemplates({ active_only: false });
      setTemplates(data as unknown as ShiftTemplate[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load templates'));
    }
  }, []);

  const loadPatterns = useCallback(async () => {
    try {
      const data = await schedulingService.getPatterns({ active_only: false });
      setPatterns(data as unknown as ShiftPattern[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load patterns'));
    }
  }, []);

  const loadApparatusOptions = useCallback(async () => {
    try {
      const resp = await schedulingService.getApparatusOptions();
      setApparatusOptions(resp.options);
      setApparatusSource(resp.source);
    } catch {
      setApparatusOptions([]);
      setApparatusSource('default');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadTemplates(), loadPatterns(), loadApparatusOptions()]);
    setLoading(false);
  }, [loadTemplates, loadPatterns, loadApparatusOptions]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateTemplate = async (data: Record<string, unknown>) => {
    await schedulingService.createTemplate(data as unknown as ShiftTemplateCreate);
    toast.success('Template created');
    void loadTemplates();
  };

  const handleUpdateTemplate = async (data: Record<string, unknown>) => {
    if (!editingTemplate) return;
    await schedulingService.updateTemplate(editingTemplate.id, data);
    toast.success('Template updated');
    setEditingTemplate(null);
    void loadTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      await schedulingService.deleteTemplate(id);
      toast.success('Template deleted');
      void loadTemplates();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete template'));
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const handleCreatePattern = async (data: Record<string, unknown>) => {
    await schedulingService.createPattern(data as unknown as ShiftPatternCreate);
    toast.success('Pattern created');
    void loadPatterns();
  };

  const handleUpdatePattern = async (data: Record<string, unknown>) => {
    if (!editingPattern) return;
    await schedulingService.updatePattern(editingPattern.id, data);
    toast.success('Pattern updated');
    setEditingPattern(null);
    void loadPatterns();
  };

  const handleDeletePattern = async (id: string) => {
    setDeletingPatternId(id);
    try {
      await schedulingService.deletePattern(id);
      toast.success('Pattern deleted');
      void loadPatterns();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete pattern'));
    } finally {
      setDeletingPatternId(null);
    }
  };

  const templateToForm = (t: ShiftTemplate): TemplateFormData => {
    let eventType: EventType | '' = '';
    let resources: ResourceUnit[] = [];
    let positions: PositionEntry[] = [];

    if ((t.category || 'standard') === 'event' && t.positions && !Array.isArray(t.positions)) {
      const meta = t.positions as { event_type?: string; resources?: ResourceUnit[] };
      eventType = (meta.event_type as EventType) || '';
      resources = meta.resources || [];
    } else if (Array.isArray(t.positions)) {
      positions = (t.positions as Array<string | { position: string; required?: boolean }>).map((p) =>
        typeof p === 'string'
          ? { position: p, required: true }
          : { position: p.position, required: p.required !== false }
      );
    }

    return {
      name: t.name,
      description: t.description || '',
      start_time_of_day: t.start_time_of_day,
      end_time_of_day: t.end_time_of_day,
      duration_hours: String(t.duration_hours),
      color: t.color || '#dc2626',
      min_staffing: String(t.min_staffing),
      is_default: t.is_default,
      open_to_all_members: t.open_to_all_members ?? false,
      positions,
      category: (t.category as TemplateCategory) || 'standard',
      apparatus_type: t.apparatus_type || '',
      apparatus_id: t.apparatus_id || '',
      event_type: eventType,
      resources,
    };
  };

  const patternToForm = (p: ShiftPattern): PatternFormData => ({
    name: p.name,
    description: p.description || '',
    pattern_type: p.pattern_type,
    template_id: p.template_id || '',
    rotation_days: p.rotation_days ? String(p.rotation_days) : '',
    days_on: p.days_on ? String(p.days_on) : '',
    days_off: p.days_off ? String(p.days_off) : '',
    start_date: p.start_date,
    end_date: p.end_date || '',
  });

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold">
            <LayoutTemplate className="h-7 w-7" aria-hidden="true" />
            Shift Templates & Patterns
          </h1>
          <p className="text-theme-text-muted mt-1">Manage reusable shift configurations and scheduling patterns</p>
        </div>
        <button
          onClick={() => (activeTab === 'templates' ? setShowTemplateModal(true) : setShowPatternModal(true))}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {activeTab === 'templates' ? 'New Template' : 'New Pattern'}
        </button>
      </div>

      {/* Tabs */}
      <div className="tab-scroll mb-6" role="tablist" aria-label="Templates and patterns">
        <button
          onClick={() => setActiveTab('templates')}
          role="tab"
          aria-selected={activeTab === 'templates'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'templates'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <LayoutTemplate className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Templates ({templates.length})
        </button>
        <button
          onClick={() => setActiveTab('patterns')}
          role="tab"
          aria-selected={activeTab === 'patterns'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'patterns'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Repeat className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Patterns ({patterns.length})
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading...</span>
        </div>
      ) : activeTab === 'templates' ? (
        <div role="tabpanel">
          {/* Category filter */}
          {templates.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Filter className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
              <button
                onClick={() => setCategoryFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface-hover text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                All ({templates.length})
              </button>
              {TEMPLATE_CATEGORIES.map((cat) => {
                const count = templates.filter((t) => (t.category || 'standard') === cat.value).length;
                if (count === 0) return null;
                const CatIcon = cat.icon;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setCategoryFilter(cat.value)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      categoryFilter === cat.value
                        ? 'bg-red-600 text-white'
                        : 'bg-theme-surface-hover text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    <CatIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
          {templates.length === 0 ? (
            <div className="card-secondary py-12 text-center">
              <LayoutTemplate className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Templates Yet</h3>
              <p className="text-theme-text-muted mb-4">
                Create a shift template to define reusable shift configurations
              </p>
              <button onClick={() => setShowTemplateModal(true)} className="btn-primary inline-flex items-center gap-2">
                <Plus className="h-5 w-5" aria-hidden="true" />
                Create Template
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates
                .filter((t) => categoryFilter === 'all' || (t.category || 'standard') === categoryFilter)
                .map((template) => (
                  <div key={template.id} className="card-secondary p-5">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {template.color && (
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: template.color }}
                            aria-hidden="true"
                          />
                        )}
                        <h3 className="text-theme-text-primary text-lg font-semibold">{template.name}</h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {(() => {
                          const cat = TEMPLATE_CATEGORIES.find((c) => c.value === (template.category || 'standard'));
                          if (cat && cat.value !== 'standard') {
                            const CatIcon = cat.icon;
                            return (
                              <span
                                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                                  cat.value === 'specialty'
                                    ? 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'
                                    : 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400'
                                }`}
                              >
                                <CatIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                                {cat.label}
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {template.is_default && (
                          <span className="inline-flex items-center rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                            Default
                          </span>
                        )}
                        {!template.is_active && (
                          <span className="inline-flex items-center rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>

                    {template.description && (
                      <p className="text-theme-text-muted mb-3 text-sm">{template.description}</p>
                    )}

                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="bg-theme-surface rounded-lg p-2">
                        <p className="text-theme-text-muted flex items-center gap-1 text-xs">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Shift Time
                        </p>
                        <p className="text-theme-text-primary text-sm font-medium">
                          {template.start_time_of_day} - {template.end_time_of_day}
                        </p>
                      </div>
                      <div className="bg-theme-surface rounded-lg p-2">
                        <p className="text-theme-text-muted text-xs">Duration / Staffing</p>
                        <p className="text-theme-text-primary text-sm font-medium">
                          {template.duration_hours}h / min {template.min_staffing}
                        </p>
                      </div>
                    </div>

                    {/* Apparatus / Vehicle (for specialty) */}
                    {(template.apparatus_type || template.apparatus_id) &&
                      (() => {
                        const matched = template.apparatus_id
                          ? apparatusOptions.find((o) => o.id === template.apparatus_id)
                          : undefined;
                        const label = matched
                          ? `${matched.unit_number ?? ''} ${matched.name}`.trim()
                          : template.apparatus_type || 'Vehicle';
                        return (
                          <div className="mb-2 flex items-center gap-1.5">
                            <Truck className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
                            <span className="text-theme-text-secondary text-xs font-medium capitalize">{label}</span>
                          </div>
                        );
                      })()}

                    {/* Event resources (for event templates) */}
                    {(template.category || 'standard') === 'event' &&
                      template.positions != null &&
                      !Array.isArray(template.positions) &&
                      (() => {
                        const meta = template.positions as { event_type?: string; resources?: ResourceUnit[] };
                        const evType = EVENT_TYPES.find((e) => e.value === meta.event_type);
                        return (
                          <div className="mb-4 space-y-2">
                            {evType && (
                              <div className="flex items-center gap-1.5">
                                {(() => {
                                  const EvIcon = evType.icon;
                                  return <EvIcon className="h-3.5 w-3.5 text-purple-500" />;
                                })()}
                                <span className="text-xs font-medium text-purple-700 dark:text-purple-400">
                                  {evType.label}
                                </span>
                              </div>
                            )}
                            {meta.resources && meta.resources.length > 0 && (
                              <div>
                                <p className="text-theme-text-muted mb-1.5 flex items-center gap-1 text-xs">
                                  <Users className="h-3 w-3" aria-hidden="true" />
                                  Resources ({meta.resources.length})
                                </p>
                                <div className="space-y-1">
                                  {meta.resources.map((res, ri) => {
                                    const resOpt = RESOURCE_TYPE_OPTIONS.find((o) => o.value === res.type);
                                    const ResIcon = resOpt?.icon || Truck;
                                    return (
                                      <div key={ri} className="flex items-center gap-1.5 text-xs">
                                        <ResIcon className="text-theme-text-muted h-3 w-3 shrink-0" />
                                        <span className="text-theme-text-secondary">{res.label}</span>
                                        {res.quantity > 1 && (
                                          <span className="text-theme-text-muted">x{res.quantity}</span>
                                        )}
                                        <span className="text-theme-text-muted">({res.positions.length} pos)</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <p className="text-theme-text-muted mt-1 text-[10px]">
                                  Total: {meta.resources.reduce((s, r) => s + r.positions.length * r.quantity, 0)}{' '}
                                  personnel
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    {/* Positions (for standard/specialty templates) */}
                    {Array.isArray(template.positions) && (template.positions as string[]).length > 0 && (
                      <div className="mb-4">
                        <p className="text-theme-text-muted mb-1.5 flex items-center gap-1 text-xs">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          Positions ({(template.positions as string[]).length})
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(template.positions as string[]).map((pos, i) => {
                            const allOpts = getPositionOptions();
                            return (
                              <span
                                key={i}
                                className="rounded-sm bg-red-500/10 px-2 py-0.5 text-xs text-red-700 capitalize dark:text-red-400"
                              >
                                {allOpts.find((o) => o.value === pos)?.label || pos}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="border-theme-surface-border flex items-center gap-2 border-t pt-3">
                      <button
                        onClick={() => setEditingTemplate(template)}
                        className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
                        aria-label={`Edit ${template.name}`}
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          void handleDeleteTemplate(template.id);
                        }}
                        disabled={deletingTemplateId === template.id}
                        className="bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-700 disabled:opacity-50 dark:text-red-400"
                        aria-label={`Delete ${template.name}`}
                      >
                        {deletingTemplateId === template.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          {patterns.length === 0 ? (
            <div className="card-secondary py-12 text-center">
              <Repeat className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Patterns Yet</h3>
              <p className="text-theme-text-muted mb-4">Create a shift pattern to define recurring schedules</p>
              <button onClick={() => setShowPatternModal(true)} className="btn-primary inline-flex items-center gap-2">
                <Plus className="h-5 w-5" aria-hidden="true" />
                Create Pattern
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {patterns.map((pattern) => (
                <div key={pattern.id} className="card-secondary p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <h3 className="text-theme-text-primary text-lg font-semibold">{pattern.name}</h3>
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                          pattern.is_active
                            ? 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                            : 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                        }`}
                      >
                        {pattern.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  {pattern.description && <p className="text-theme-text-muted mb-3 text-sm">{pattern.description}</p>}

                  <div className="mb-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Repeat className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        {PATTERN_TYPES.find((pt) => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
                      </span>
                      {pattern.days_on && pattern.days_off && (
                        <span className="text-theme-text-muted">
                          ({pattern.days_on} on / {pattern.days_off} off)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        {formatDate(pattern.start_date, tz)}
                        {pattern.end_date && ` - ${formatDate(pattern.end_date, tz)}`}
                      </span>
                    </div>
                    {pattern.rotation_days && (
                      <div className="text-theme-text-muted text-sm">Rotation: {pattern.rotation_days} days</div>
                    )}
                  </div>

                  <div className="border-theme-surface-border flex items-center gap-2 border-t pt-3">
                    <button
                      onClick={() => setGeneratingPattern(pattern)}
                      className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm"
                      aria-label={`Generate shifts from ${pattern.name}`}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      Generate
                    </button>
                    <button
                      onClick={() => setEditingPattern(pattern)}
                      className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
                      aria-label={`Edit ${pattern.name}`}
                    >
                      <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        void handleDeletePattern(pattern.id);
                      }}
                      disabled={deletingPatternId === pattern.id}
                      className="bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-700 disabled:opacity-50 dark:text-red-400"
                      aria-label={`Delete ${pattern.name}`}
                    >
                      {deletingPatternId === pattern.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <TemplateFormModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onSubmit={handleCreateTemplate}
        title="Create Template"
        apparatusOptions={apparatusOptions}
        apparatusSource={apparatusSource}
      />

      <TemplateFormModal
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSubmit={handleUpdateTemplate}
        initialData={editingTemplate ? templateToForm(editingTemplate) : undefined}
        title="Edit Template"
        apparatusOptions={apparatusOptions}
        apparatusSource={apparatusSource}
      />

      <PatternFormModal
        isOpen={showPatternModal}
        onClose={() => setShowPatternModal(false)}
        onSubmit={handleCreatePattern}
        title="Create Pattern"
        templates={templates}
      />

      <PatternFormModal
        isOpen={!!editingPattern}
        onClose={() => setEditingPattern(null)}
        onSubmit={handleUpdatePattern}
        initialData={editingPattern ? patternToForm(editingPattern) : undefined}
        title="Edit Pattern"
        templates={templates}
      />

      <GenerateShiftsModal
        isOpen={!!generatingPattern}
        onClose={() => setGeneratingPattern(null)}
        pattern={generatingPattern}
      />
    </div>
  );
};

export default ShiftTemplatesPage;
