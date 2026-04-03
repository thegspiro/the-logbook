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
      positions = (t.positions as Array<string | { position: string; required?: boolean }>).map(
        p => typeof p === 'string'
          ? { position: p, required: true }
          : { position: p.position, required: p.required !== false },
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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
            <LayoutTemplate className="w-7 h-7" aria-hidden="true" />
            Shift Templates & Patterns
          </h1>
          <p className="text-theme-text-muted mt-1">Manage reusable shift configurations and scheduling patterns</p>
        </div>
        <button
          onClick={() => activeTab === 'templates' ? setShowTemplateModal(true) : setShowPatternModal(true)}
          className="btn-primary flex gap-2 items-center"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          {activeTab === 'templates' ? 'New Template' : 'New Pattern'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="Templates and patterns">
        <button
          onClick={() => setActiveTab('templates')}
          role="tab"
          aria-selected={activeTab === 'templates'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'templates'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <LayoutTemplate className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Templates ({templates.length})
        </button>
        <button
          onClick={() => setActiveTab('patterns')}
          role="tab"
          aria-selected={activeTab === 'patterns'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'patterns'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Repeat className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Patterns ({patterns.length})
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
          <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading...</span>
        </div>
      ) : activeTab === 'templates' ? (
        <div role="tabpanel">
          {/* Category filter */}
          {templates.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Filter className="w-4 h-4 text-theme-text-muted shrink-0" aria-hidden="true" />
              <button
                onClick={() => setCategoryFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface-hover text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                All ({templates.length})
              </button>
              {TEMPLATE_CATEGORIES.map(cat => {
                const count = templates.filter(t => (t.category || 'standard') === cat.value).length;
                if (count === 0) return null;
                const CatIcon = cat.icon;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setCategoryFilter(cat.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5 ${
                      categoryFilter === cat.value
                        ? 'bg-red-600 text-white'
                        : 'bg-theme-surface-hover text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    <CatIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
          {templates.length === 0 ? (
            <div className="card-secondary py-12 text-center">
              <LayoutTemplate className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Templates Yet</h3>
              <p className="text-theme-text-muted mb-4">Create a shift template to define reusable shift configurations</p>
              <button
                onClick={() => setShowTemplateModal(true)}
                className="btn-primary gap-2 inline-flex items-center"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Create Template
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates.filter(t => categoryFilter === 'all' || (t.category || 'standard') === categoryFilter).map(template => (
                <div
                  key={template.id}
                  className="card-secondary p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {template.color && (
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: template.color }}
                          aria-hidden="true"
                        />
                      )}
                      <h3 className="text-lg font-semibold text-theme-text-primary">{template.name}</h3>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {(() => {
                        const cat = TEMPLATE_CATEGORIES.find(c => c.value === (template.category || 'standard'));
                        if (cat && cat.value !== 'standard') {
                          const CatIcon = cat.icon;
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              cat.value === 'specialty'
                                ? 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'
                                : 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400'
                            }`}>
                              <CatIcon className="w-3 h-3 mr-1" aria-hidden="true" />
                              {cat.label}
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {template.is_default && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                          <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                          Default
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>

                  {template.description && (
                    <p className="text-sm text-theme-text-muted mb-3">{template.description}</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="bg-theme-surface rounded-lg p-2">
                      <p className="text-xs text-theme-text-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        Shift Time
                      </p>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {template.start_time_of_day} - {template.end_time_of_day}
                      </p>
                    </div>
                    <div className="bg-theme-surface rounded-lg p-2">
                      <p className="text-xs text-theme-text-muted">Duration / Staffing</p>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {template.duration_hours}h / min {template.min_staffing}
                      </p>
                    </div>
                  </div>

                  {/* Apparatus / Vehicle (for specialty) */}
                  {(template.apparatus_type || template.apparatus_id) && (() => {
                    const matched = template.apparatus_id ? apparatusOptions.find(o => o.id === template.apparatus_id) : undefined;
                    const label = matched
                      ? `${matched.unit_number ?? ''} ${matched.name}`.trim()
                      : template.apparatus_type || 'Vehicle';
                    return (
                      <div className="flex items-center gap-1.5 mb-2">
                        <Truck className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
                        <span className="text-xs text-theme-text-secondary capitalize font-medium">{label}</span>
                      </div>
                    );
                  })()}

                  {/* Event resources (for event templates) */}
                  {(template.category || 'standard') === 'event' && template.positions != null && !Array.isArray(template.positions) && (() => {
                    const meta = template.positions as { event_type?: string; resources?: ResourceUnit[] };
                    const evType = EVENT_TYPES.find(e => e.value === meta.event_type);
                    return (
                      <div className="mb-4 space-y-2">
                        {evType && (
                          <div className="flex items-center gap-1.5">
                            {(() => { const EvIcon = evType.icon; return <EvIcon className="w-3.5 h-3.5 text-purple-500" />; })()}
                            <span className="text-xs text-purple-700 dark:text-purple-400 font-medium">{evType.label}</span>
                          </div>
                        )}
                        {meta.resources && meta.resources.length > 0 && (
                          <div>
                            <p className="text-xs text-theme-text-muted flex items-center gap-1 mb-1.5">
                              <Users className="w-3 h-3" aria-hidden="true" />
                              Resources ({meta.resources.length})
                            </p>
                            <div className="space-y-1">
                              {meta.resources.map((res, ri) => {
                                const resOpt = RESOURCE_TYPE_OPTIONS.find(o => o.value === res.type);
                                const ResIcon = resOpt?.icon || Truck;
                                return (
                                  <div key={ri} className="flex items-center gap-1.5 text-xs">
                                    <ResIcon className="w-3 h-3 text-theme-text-muted shrink-0" />
                                    <span className="text-theme-text-secondary">{res.label}</span>
                                    {res.quantity > 1 && <span className="text-theme-text-muted">x{res.quantity}</span>}
                                    <span className="text-theme-text-muted">({res.positions.length} pos)</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-theme-text-muted mt-1">
                              Total: {meta.resources.reduce((s, r) => s + r.positions.length * r.quantity, 0)} personnel
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Positions (for standard/specialty templates) */}
                  {Array.isArray(template.positions) && (template.positions as string[]).length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-theme-text-muted flex items-center gap-1 mb-1.5">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        Positions ({(template.positions as string[]).length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {(template.positions as string[]).map((pos, i) => {
                          const allOpts = getPositionOptions();
                          return (
                            <span key={i} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-700 dark:text-red-400 rounded-sm capitalize">
                              {allOpts.find(o => o.value === pos)?.label || pos}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-theme-surface-border">
                    <button
                      onClick={() => setEditingTemplate(template)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg"
                      aria-label={`Edit ${template.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      onClick={() => { void handleDeleteTemplate(template.id); }}
                      disabled={deletingTemplateId === template.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-theme-surface hover:bg-theme-surface-hover text-red-700 dark:text-red-400 text-sm rounded-lg disabled:opacity-50"
                      aria-label={`Delete ${template.name}`}
                    >
                      {deletingTemplateId === template.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
              <Repeat className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Patterns Yet</h3>
              <p className="text-theme-text-muted mb-4">Create a shift pattern to define recurring schedules</p>
              <button
                onClick={() => setShowPatternModal(true)}
                className="btn-primary gap-2 inline-flex items-center"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Create Pattern
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {patterns.map(pattern => (
                <div
                  key={pattern.id}
                  className="card-secondary p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-theme-text-primary">{pattern.name}</h3>
                    <div className="flex items-center gap-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        pattern.is_active
                          ? 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                          : 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                      }`}>
                        {pattern.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  {pattern.description && (
                    <p className="text-sm text-theme-text-muted mb-3">{pattern.description}</p>
                  )}

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Repeat className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        {PATTERN_TYPES.find(pt => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
                      </span>
                      {pattern.days_on && pattern.days_off && (
                        <span className="text-theme-text-muted">({pattern.days_on} on / {pattern.days_off} off)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        {formatDate(pattern.start_date, tz)}
                        {pattern.end_date && ` - ${formatDate(pattern.end_date, tz)}`}
                      </span>
                    </div>
                    {pattern.rotation_days && (
                      <div className="text-sm text-theme-text-muted">
                        Rotation: {pattern.rotation_days} days
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-3 border-t border-theme-surface-border">
                    <button
                      onClick={() => setGeneratingPattern(pattern)}
                      className="btn-primary flex gap-1 items-center px-3 py-1.5 text-sm"
                      aria-label={`Generate shifts from ${pattern.name}`}
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      Generate
                    </button>
                    <button
                      onClick={() => setEditingPattern(pattern)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg"
                      aria-label={`Edit ${pattern.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      onClick={() => { void handleDeletePattern(pattern.id); }}
                      disabled={deletingPatternId === pattern.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-theme-surface hover:bg-theme-surface-hover text-red-700 dark:text-red-400 text-sm rounded-lg disabled:opacity-50"
                      aria-label={`Delete ${pattern.name}`}
                    >
                      {deletingPatternId === pattern.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
