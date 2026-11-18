import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  LayoutTemplate,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Clock,
  CheckCircle,
  Users,
  Truck,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { normalizePositions, schedulingService } from '../modules/scheduling/services/api';
import type { ApparatusOption } from '../modules/scheduling/services/api';
import type { ShiftTemplateCreate } from '../modules/scheduling/types';
import { formatTimeOfDay } from '../utils/dateFormatting';
import TemplateFormModal from '../modules/scheduling/components/TemplateFormModal';
import type {
  ShiftTemplate,
  TemplateFormData,
  TemplateCategory,
  ResourceUnit,
  PositionEntry,
  EventType,
} from '../modules/scheduling/components/shiftTemplateTypes';
import {
  TEMPLATE_CATEGORIES,
  EVENT_TYPES,
  RESOURCE_TYPE_OPTIONS,
  getPositionOptions,
} from '../modules/scheduling/components/shiftTemplateTypes';
import { useConfirm } from '../contexts/ConfirmContext';

/**
 * Shift templates: what a shift is. The patterns that repeat a template are
 * made, edited and generated only in Planning › Patterns; this page carried a
 * second pattern form until W32-6, and the two drifted.
 */
export const ShiftTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const { confirm } = useConfirm();
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  // The template being reactivated, so its button can't be pressed twice
  // while the request is in flight.
  const [togglingId, setTogglingId] = useState<string | null>(null);

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
    await Promise.all([loadTemplates(), loadApparatusOptions()]);
    setLoading(false);
  }, [loadTemplates, loadApparatusOptions]);

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
    const template = templates.find((t) => t.id === id);
    // One Enter on a focused Delete removed the record with no way back;
    // Apparatus and Locations already ask first.
    if (
      !(await confirm({
        title: 'Delete template',
        message: `Delete "${template?.name ?? 'this template'}"? If any shift (past or future) or pattern uses it, it is deactivated instead of deleted: those shifts keep it and its equipment checklists, its patterns stop generating new shifts until it is reactivated or they are pointed at another template, and it is no longer offered for new shifts or patterns. Otherwise it is deleted, which cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    setDeletingTemplateId(id);
    try {
      const outcome = await schedulingService.deleteTemplate(id);
      toast.success(
        outcome === 'deactivated'
          ? `"${template?.name ?? 'The template'}" is still used by shifts or patterns, so it was deactivated instead of deleted. Patterns using it no longer generate shifts.`
          : 'Template deleted'
      );
      void loadTemplates();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete template'));
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const handleReactivateTemplate = async (template: ShiftTemplate) => {
    setTogglingId(template.id);
    try {
      await schedulingService.updateTemplate(template.id, { is_active: true });
      toast.success(`"${template.name}" is active again. Patterns using it generate shifts again.`);
      await loadTemplates();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reactivate template'));
    } finally {
      setTogglingId(null);
    }
  };

  const templateToForm = (t: ShiftTemplate): TemplateFormData => {
    let eventType: EventType | '' = '';
    let resources: ResourceUnit[] = [];
    let positions: PositionEntry[] = [];

    if ((t.category || 'standard') === 'event' && t.positions && !Array.isArray(t.positions)) {
      const meta = t.positions;
      eventType = (meta.event_type as EventType) || '';
      resources = meta.resources || [];
    } else if (Array.isArray(t.positions)) {
      positions = normalizePositions(t.positions);
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
      // Seeded even when the Inventory module is off and the picker is
      // hidden: the form sends this field on every save, so dropping it here
      // would delete a template's checklist links the first time anyone edited
      // it in that state.
      equipment_check_template_ids: t.equipment_check_template_ids ?? [],
      event_type: eventType,
      resources,
    };
  };

  return (
    // Vertical padding only: this renders inside SchedulingPlanningPage, which
    // already pads the sides; the doubled gutter took 48px from every card.
    <div className="mx-auto max-w-7xl py-6">
      {/* Header */}
      <div className="split-row mb-6 gap-3 sm:items-center">
        <div className="split-row-main">
          {/* h2: this page renders only inside Shift Planning, whose header
              is the page's h1; a second h1 split the page in two. */}
          <h2 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold">
            <LayoutTemplate className="h-7 w-7 shrink-0" aria-hidden="true" />
            Shift Templates
          </h2>
          <p className="text-theme-text-muted mt-1">
            Reusable shift configurations. To repeat a template on a schedule, make a pattern in{' '}
            <Link
              to="/scheduling/admin/planning/patterns"
              className="touch:min-h-11 inline-flex items-center font-medium underline"
            >
              Shift patterns
            </Link>
            .
          </p>
        </div>
        <button
          onClick={() => setShowTemplateModal(true)}
          className="split-row-aside btn-primary flex shrink-0 items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          New Template
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading...</span>
        </div>
      ) : (
        <div>
          {/* Category filter */}
          {templates.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Filter className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
              <button
                onClick={() => setCategoryFilter('all')}
                className={`touch:min-h-11 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-red-800 text-white'
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
                    className={`touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      categoryFilter === cat.value
                        ? 'bg-red-800 text-white'
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
            <div className="card-grid gap-4">
              {templates
                .filter((t) => categoryFilter === 'all' || (t.category || 'standard') === categoryFilter)
                .map((template) => (
                  <div key={template.id} className="card-secondary p-5">
                    {/* Badges sit under the title rather than beside it: beside
                        it they took a third of a tablet-width card, broke
                        "Specialty Vehicle" across two lines, and wrapped the
                        title to three. */}
                    <div className="mb-3 flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        {template.color && (
                          <div
                            className="mt-2 h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: template.color }}
                            aria-hidden="true"
                          />
                        )}
                        <h3 className="text-theme-text-primary text-lg font-semibold">{template.name}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 empty:hidden">
                        {(() => {
                          const cat = TEMPLATE_CATEGORIES.find((c) => c.value === (template.category || 'standard'));
                          if (cat && cat.value !== 'standard') {
                            const CatIcon = cat.icon;
                            return (
                              <span
                                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                                  cat.value === 'specialty'
                                    ? 'bg-orange-500/10 text-orange-900 dark:bg-orange-500/20 dark:text-orange-300'
                                    : 'bg-purple-500/10 text-purple-900 dark:bg-purple-500/20 dark:text-purple-300'
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
                          <span className="inline-flex items-center rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-900 dark:bg-green-500/20 dark:text-green-300">
                            <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                            Default
                          </span>
                        )}
                        {!template.is_active && (
                          <span className="inline-flex items-center rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-900 dark:bg-red-500/20 dark:text-red-300">
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
                          {formatTimeOfDay(template.start_time_of_day)} - {formatTimeOfDay(template.end_time_of_day)}
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
                        const meta = template.positions;
                        const evType = EVENT_TYPES.find((e) => e.value === meta.event_type);
                        return (
                          <div className="mb-4 space-y-2">
                            {evType && (
                              <div className="flex items-center gap-1.5">
                                {(() => {
                                  const EvIcon = evType.icon;
                                  return <EvIcon className="h-3.5 w-3.5 text-purple-500" />;
                                })()}
                                <span className="text-xs font-medium text-purple-900 dark:text-purple-300">
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
                    {Array.isArray(template.positions) &&
                      (() => {
                        // Seats are stored as `{ position, required }` objects since the
                        // optional-seat flag was added, and as bare strings before that.
                        const slots = normalizePositions(template.positions);
                        if (slots.length === 0) return null;
                        const allOpts = getPositionOptions();
                        return (
                          <div className="mb-4">
                            <p className="text-theme-text-muted mb-1.5 flex items-center gap-1 text-xs">
                              <Users className="h-3 w-3" aria-hidden="true" />
                              Positions ({slots.length})
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {slots.map((slot, i) => (
                                <span
                                  key={i}
                                  className={`rounded-sm px-2 py-0.5 text-xs capitalize ${
                                    slot.required
                                      ? 'bg-red-500/10 text-red-900 dark:text-red-300'
                                      : 'bg-theme-surface-hover text-theme-text-muted'
                                  }`}
                                >
                                  {allOpts.find((o) => o.value === slot.position)?.label || slot.position}
                                  {!slot.required && ' (opt)'}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                    <div className="border-theme-surface-border flex items-center gap-2 border-t pt-3">
                      <button
                        onClick={() => setEditingTemplate(template)}
                        className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary touch:min-h-11 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
                        aria-label={`Edit ${template.name}`}
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                      {!template.is_active && (
                        <button
                          onClick={() => {
                            void handleReactivateTemplate(template);
                          }}
                          disabled={togglingId === template.id}
                          className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary touch:min-h-11 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                          aria-label={`Reactivate ${template.name}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Reactivate
                        </button>
                      )}
                      <button
                        onClick={() => {
                          void handleDeleteTemplate(template.id);
                        }}
                        disabled={deletingTemplateId === template.id}
                        className="bg-theme-surface hover:bg-theme-surface-hover touch:min-h-11 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-900 disabled:opacity-50 dark:text-red-300"
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
    </div>
  );
};

export default ShiftTemplatesPage;
