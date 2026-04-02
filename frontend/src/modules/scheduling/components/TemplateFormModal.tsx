import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import {
  X,
  Truck,
  Users,
  Plus,
  Minus,
  Copy,
  PartyPopper,
} from 'lucide-react';
import type { ApparatusOption } from '../services/api';
import TimeQuarterHour from '../../../components/ux/TimeQuarterHour';
import type {
  TemplateFormData,
  PositionEntry,
  ResourceUnit,
  EventType,
} from './shiftTemplateTypes';
import {
  TEMPLATE_CATEGORIES,
  FALLBACK_APPARATUS_TYPES,
  EVENT_TYPES,
  RESOURCE_TYPE_OPTIONS,
  EVENT_TEMPLATE_STARTERS,
  getPositionOptions,
  emptyTemplateForm,
} from './shiftTemplateTypes';

interface TemplateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: TemplateFormData | undefined;
  title: string;
  apparatusOptions: ApparatusOption[];
  apparatusSource: 'apparatus' | 'basic' | 'default';
}

const TemplateFormModal: React.FC<TemplateFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
  apparatusOptions,
  apparatusSource,
}) => {
  const [formData, setFormData] = useState<TemplateFormData>(initialData || emptyTemplateForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const positionOptions = getPositionOptions();

  useEffect(() => {
    setFormData(initialData || emptyTemplateForm);
  }, [initialData, isOpen]);

  const loadApparatusTypeDefaults = (type: string) => {
    if (!type) return;
    try {
      const stored = localStorage.getItem('scheduling_settings');
      if (stored) {
        const settings = JSON.parse(stored) as { apparatusTypeDefaults?: Record<string, { positions?: string[]; minStaffing?: number }> };
        const defaults = settings.apparatusTypeDefaults?.[type];
        if (defaults) {
          setFormData(prev => ({
            ...prev,
            positions: defaults.positions
              ? defaults.positions.map(p => ({ position: p, required: true }))
              : prev.positions,
            min_staffing: String(defaults.minStaffing ?? prev.min_staffing),
          }));
          return;
        }
      }
    } catch { /* ignore */ }
  };

  const totalResourceStaffing = useMemo(() => {
    return formData.resources.reduce((sum, r) => sum + (r.positions.length * r.quantity), 0);
  }, [formData.resources]);

  const applyStarter = (starter: { name: string; eventType: EventType; description: string; start_time_of_day: string; end_time_of_day: string; duration_hours: string; color: string; resources: ResourceUnit[] }) => {
    setFormData(prev => ({
      ...prev,
      name: starter.name,
      description: starter.description,
      start_time_of_day: starter.start_time_of_day,
      end_time_of_day: starter.end_time_of_day,
      duration_hours: starter.duration_hours,
      color: starter.color,
      event_type: starter.eventType,
      resources: starter.resources.map(r => ({ ...r, positions: [...r.positions] })),
      min_staffing: String(starter.resources.reduce((s, r) => s + r.positions.length * r.quantity, 0)),
    }));
  };

  const addResource = (typeValue: string) => {
    const opt = RESOURCE_TYPE_OPTIONS.find(o => o.value === typeValue);
    if (!opt) return;
    setFormData(prev => ({
      ...prev,
      resources: [...prev.resources, { type: opt.value, label: opt.label, quantity: opt.defaultQty, positions: [...opt.defaultPositions] }],
    }));
  };

  const removeResource = (index: number) => {
    setFormData(prev => ({
      ...prev,
      resources: prev.resources.filter((_, i) => i !== index),
    }));
  };

  const updateResourceQuantity = (index: number, qty: number) => {
    setFormData(prev => {
      const updated = [...prev.resources];
      updated[index] = { ...updated[index], quantity: Math.max(1, qty) } as ResourceUnit;
      return { ...prev, resources: updated };
    });
  };

  const updateResourcePositions = (index: number, positions: string[]) => {
    setFormData(prev => {
      const updated = [...prev.resources];
      updated[index] = { ...updated[index], positions } as ResourceUnit;
      return { ...prev, resources: updated };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const effectivePositions: PositionEntry[] = formData.category === 'event' && formData.resources.length > 0
        ? formData.resources.flatMap(r =>
            Array.from({ length: r.quantity }, () =>
              r.positions.map(p => ({ position: p, required: true })),
            ).flat(),
          )
        : formData.positions;
      const payload: Record<string, unknown> = {
        name: formData.name,
        start_time_of_day: formData.start_time_of_day,
        end_time_of_day: formData.end_time_of_day,
        duration_hours: parseFloat(formData.duration_hours),
        min_staffing: formData.category === 'event' && totalResourceStaffing > 0
          ? totalResourceStaffing
          : parseInt(formData.min_staffing, 10),
        is_default: formData.is_default,
        open_to_all_members: formData.open_to_all_members,
        positions: effectivePositions.length > 0 ? effectivePositions : null,
        category: formData.category,
      };
      if (formData.description) payload.description = formData.description;
      if (formData.color) payload.color = formData.color;
      if (formData.apparatus_type) payload.apparatus_type = formData.apparatus_type;
      if (formData.apparatus_id) payload.apparatus_id = formData.apparatus_id;
      if (formData.category === 'event') {
        const eventMeta = {
          event_type: formData.event_type || 'other',
          resources: formData.resources,
          flat_positions: effectivePositions.length > 0 ? effectivePositions.map(p => p.position) : [],
        };
        payload.positions = eventMeta;
      }
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save template'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="template-modal-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-4">
          <div>
            <label htmlFor="template-name" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="template-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              placeholder="e.g., Day Shift A"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="template-description" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Description
            </label>
            <textarea
              id="template-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              rows={2}
              placeholder="Optional description"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1.5">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATE_CATEGORIES.map(cat => {
                const CatIcon = cat.icon;
                const isSelected = formData.category === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        category: cat.value,
                        apparatus_type: cat.value === 'event' ? '' : prev.apparatus_type,
                      }));
                    }}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'border-red-500/40 bg-red-500/5'
                        : 'border-theme-surface-border bg-theme-surface-hover/30 hover:border-theme-surface-border/80'
                    }`}
                  >
                    <CatIcon className={`w-4 h-4 mb-1 ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted'}`} />
                    <p className={`text-xs font-medium ${isSelected ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}>{cat.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vehicle (for standard & specialty templates) */}
          {(formData.category === 'standard' || formData.category === 'specialty') && (
            <div>
              <label htmlFor="template-apparatus-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
                <span className="flex items-center gap-1.5">
                  <Truck className="w-4 h-4" />
                  {apparatusSource === 'default' ? 'Vehicle Type' : 'Vehicle'}
                  {formData.category === 'specialty' && <span aria-hidden="true">*</span>}
                </span>
              </label>
              <select
                id="template-apparatus-type"
                value={apparatusSource === 'default' ? formData.apparatus_type : (formData.apparatus_id || '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (apparatusSource === 'default') {
                    setFormData(prev => ({ ...prev, apparatus_type: val, apparatus_id: '' }));
                    loadApparatusTypeDefaults(val);
                  } else {
                    const selected = apparatusOptions.find(o => o.id === val);
                    setFormData(prev => ({
                      ...prev,
                      apparatus_id: val,
                      apparatus_type: selected?.apparatus_type ?? '',
                      positions: selected?.positions?.map(p => typeof p === 'string'
                        ? { position: p, required: true }
                        : { position: p.position, required: (p as { required?: boolean }).required !== false },
                      ) ?? prev.positions,
                      min_staffing: selected?.min_staffing ? String(selected.min_staffing) : prev.min_staffing,
                    }));
                  }
                }}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                required={formData.category === 'specialty'}
              >
                <option value="">
                  {formData.category === 'specialty' ? 'Select vehicle...' : 'No specific vehicle (optional)'}
                </option>
                {apparatusSource === 'default'
                  ? FALLBACK_APPARATUS_TYPES.map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))
                  : apparatusOptions.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.unit_number ? `${o.unit_number} — ${o.name}` : o.name}
                      {o.apparatus_type ? ` (${o.apparatus_type})` : ''}
                    </option>
                  ))
                }
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                {apparatusSource === 'default'
                  ? (formData.category === 'specialty'
                    ? 'Selecting a vehicle type will load default positions from your department settings.'
                    : 'Optionally assign a vehicle type to load default positions from your department settings.')
                  : (formData.category === 'specialty'
                    ? 'Select one of your department\'s vehicles. Positions and staffing will be loaded automatically.'
                    : 'Optionally assign one of your department\'s vehicles to this template.')}
              </p>
            </div>
          )}

          {/* Event-specific fields */}
          {formData.category === 'event' && (
            <>
              {/* Event Type */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1.5">Event Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {EVENT_TYPES.map(et => {
                    const ETIcon = et.icon;
                    const isSelected = formData.event_type === et.value;
                    return (
                      <button
                        key={et.value}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, event_type: et.value }))}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                          isSelected
                            ? 'border-purple-500/40 bg-purple-500/5'
                            : 'border-theme-surface-border bg-theme-surface-hover/20 hover:bg-theme-surface-hover/40'
                        }`}
                      >
                        <ETIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-theme-text-muted'}`} />
                        <span className={`text-xs font-medium truncate ${isSelected ? 'text-purple-700 dark:text-purple-400' : 'text-theme-text-primary'}`}>{et.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick-start from pre-built templates */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-theme-text-secondary">
                    <span className="flex items-center gap-1.5"><Copy className="w-4 h-4" /> Quick Start</span>
                  </label>
                </div>
                <p className="text-xs text-theme-text-muted mb-2">
                  Start from a pre-built template, then customize. Or build from scratch below.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                  {EVENT_TEMPLATE_STARTERS
                    .filter(s => !formData.event_type || s.eventType === formData.event_type)
                    .map((starter, i) => {
                      const evType = EVENT_TYPES.find(e => e.value === starter.eventType);
                      const EvIcon = evType?.icon || PartyPopper;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => applyStarter(starter)}
                          className="flex items-start gap-2 p-2 rounded-lg border border-theme-surface-border bg-theme-surface-hover/20 hover:bg-theme-surface-hover/50 text-left transition-colors"
                        >
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: starter.color }} />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-theme-text-primary truncate flex items-center gap-1">
                              <EvIcon className="w-3 h-3 text-theme-text-muted shrink-0" />
                              {starter.name}
                            </p>
                            <p className="text-[10px] text-theme-text-muted truncate">{starter.resources.length} resource{starter.resources.length !== 1 ? 's' : ''}</p>
                          </div>
                        </button>
                      );
                    })}
                  {formData.event_type && EVENT_TEMPLATE_STARTERS.filter(s => s.eventType === formData.event_type).length === 0 && (
                    <p className="col-span-2 text-xs text-theme-text-muted py-2 text-center">No starters for this event type — build from scratch below.</p>
                  )}
                </div>
              </div>

              {/* Resources / Units */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Resources &amp; Staffing</span>
                </label>
                <p className="text-xs text-theme-text-muted mb-2">
                  Add vehicles, first aid stations, bicycle teams, and other resources needed for this event.
                </p>

                {formData.resources.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {formData.resources.map((res, ri) => {
                      const resOpt = RESOURCE_TYPE_OPTIONS.find(o => o.value === res.type);
                      const ResIcon = resOpt?.icon || Truck;
                      return (
                        <div key={ri} className="p-2.5 border border-theme-surface-border rounded-lg bg-theme-surface-hover/20">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <ResIcon className="w-4 h-4 text-theme-text-muted" />
                              <span className="text-sm font-medium text-theme-text-primary">{res.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] text-theme-text-muted">Qty:</label>
                              <input
                                type="number" min={1} max={20} value={res.quantity}
                                onChange={(e) => updateResourceQuantity(ri, parseInt(e.target.value, 10) || 1)}
                                className="w-14 px-1.5 py-0.5 text-xs bg-theme-input-bg border border-theme-input-border rounded-sm text-theme-text-primary text-center"
                              />
                              <button onClick={() => removeResource(ri)} className="p-0.5 text-red-500 hover:bg-red-500/10 rounded-sm" title="Remove resource">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {/* Positions for this resource */}
                          <div className="flex flex-wrap gap-1 items-center">
                            {res.positions.map((pos, pi) => (
                              <span key={pi} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-300 rounded-sm capitalize">
                                {positionOptions.find(o => o.value === pos)?.label || pos}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newPos = res.positions.filter((_, idx) => idx !== pi);
                                    updateResourcePositions(ri, newPos);
                                  }}
                                  className="ml-0.5 text-purple-700 dark:text-purple-400 hover:text-red-500"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) updateResourcePositions(ri, [...res.positions, e.target.value]);
                                e.target.value = '';
                              }}
                              className="px-1.5 py-0.5 text-[10px] bg-theme-input-bg border border-theme-input-border rounded-sm text-theme-text-muted"
                            >
                              <option value="">+ position</option>
                              {positionOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                          {res.quantity > 1 && (
                            <p className="text-[10px] text-theme-text-muted mt-1">{res.quantity} units x {res.positions.length} positions = {res.quantity * res.positions.length} personnel</p>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between p-2 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                      <span className="text-xs text-purple-700 dark:text-purple-400 font-medium">Total staffing: {totalResourceStaffing} personnel</span>
                    </div>
                  </div>
                )}

                {/* Add resource button */}
                <div className="flex flex-wrap gap-1.5">
                  {RESOURCE_TYPE_OPTIONS.map(opt => {
                    const ResIcon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => addResource(opt.value)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-theme-text-muted bg-theme-surface-hover/50 hover:bg-theme-surface-hover border border-theme-surface-border rounded-lg transition-colors"
                      >
                        <ResIcon className="w-3 h-3" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="template-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Start Time <span aria-hidden="true">*</span>
              </label>
              <TimeQuarterHour
                id="template-start"
                value={formData.start_time_of_day}
                onChange={(e) => setFormData(prev => ({ ...prev, start_time_of_day: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                required
              />
            </div>
            <div>
              <label htmlFor="template-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
                End Time <span aria-hidden="true">*</span>
              </label>
              <TimeQuarterHour
                id="template-end"
                value={formData.end_time_of_day}
                onChange={(e) => setFormData(prev => ({ ...prev, end_time_of_day: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                required
              />
            </div>
            <div>
              <label htmlFor="template-duration" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Duration (hrs) <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-duration"
                type="number"
                value={formData.duration_hours}
                onChange={(e) => setFormData(prev => ({ ...prev, duration_hours: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                min="0.5"
                step="0.5"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="template-color" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="template-color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                  className="w-10 h-10 rounded-sm border border-theme-input-border cursor-pointer"
                />
                <span className="text-sm text-theme-text-muted">{formData.color}</span>
              </div>
            </div>
            <div>
              <label htmlFor="template-min-staffing" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Min Staffing <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-min-staffing"
                type="number"
                value={formData.min_staffing}
                onChange={(e) => setFormData(prev => ({ ...prev, min_staffing: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                min="1"
                required
              />
            </div>
          </div>

          {/* Crew Positions (not shown for event templates — they use resources editor) */}
          {formData.category !== 'event' && <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" aria-hidden="true" /> Crew Positions</span>
            </label>
            <p className="text-xs text-theme-text-muted mb-2">
              Define the crew structure for shifts created from this template. Toggle the switch to mark a position as optional.
            </p>
            {formData.positions.length > 0 && (
              <div className="space-y-2 mb-2">
                {formData.positions.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={entry.position}
                      onChange={(e) => {
                        const updated = [...formData.positions];
                        updated[i] = { ...entry, position: e.target.value };
                        setFormData(prev => ({ ...prev, positions: updated }));
                      }}
                      className="flex-1 px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring"
                    >
                      {positionOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...formData.positions];
                        updated[i] = { ...entry, required: !entry.required };
                        setFormData(prev => ({ ...prev, positions: updated }));
                      }}
                      className={`px-2 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        entry.required
                          ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700'
                          : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border'
                      }`}
                      title={entry.required ? 'Required — click to make optional' : 'Optional — click to make required'}
                    >
                      {entry.required ? 'Required' : 'Optional'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = formData.positions.filter((_, idx) => idx !== i);
                        setFormData(prev => ({ ...prev, positions: updated }));
                      }}
                      className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                      aria-label={`Remove position ${i + 1}`}
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, positions: [...prev.positions, { position: 'firefighter', required: true }] }))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Position
            </button>
          </div>}

          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))}
              className="rounded-sm border-theme-input-border"
            />
            Set as default template
          </label>

          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={formData.open_to_all_members}
              onChange={(e) => setFormData(prev => ({ ...prev, open_to_all_members: e.target.checked }))}
              className="rounded-sm border-theme-input-border"
            />
            Open to all members (allow non-operational members to sign up)
          </label>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary px-6"
            >
              {isSubmitting ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TemplateFormModal;
