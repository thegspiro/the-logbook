import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { X, Truck, Users, Plus, Minus, Copy, PartyPopper, Check } from 'lucide-react';
import type { ApparatusOption } from '../services/api';
import TimeQuarterHour from '../../../components/ux/TimeQuarterHour';
import { formatTimeOfDay, hoursBetweenTimesOfDay } from '../../../utils/dateFormatting';
import type { TemplateFormData, PositionEntry, ResourceUnit, EventType } from './shiftTemplateTypes';
import {
  TEMPLATE_CATEGORIES,
  FALLBACK_APPARATUS_TYPES,
  EVENT_TYPES,
  RESOURCE_TYPE_OPTIONS,
  EVENT_TEMPLATE_STARTERS,
  getPositionOptions,
  emptyTemplateForm,
} from './shiftTemplateTypes';

/**
 * A hex field is developer-facing, and the old default was the same red the
 * calendar uses for a shift in trouble. Named swatches instead, and a default
 * that does not compete with the status colours.
 */
const TEMPLATE_COLORS: { value: string; label: string }[] = [
  { value: '#2563eb', label: 'Blue' },
  { value: '#0d9488', label: 'Teal' },
  { value: '#16a34a', label: 'Green' },
  { value: '#d97706', label: 'Amber' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#dc2626', label: 'Red' },
  { value: '#7c3aed', label: 'Violet' },
  { value: '#475569', label: 'Slate' },
];

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

  /**
   * The shift's length is the distance between its start and its end — asking
   * for it a third time only let the two disagree, and the field arrived
   * pre-filled with 12 whatever the times said. Derived here, and shown back as
   * a sentence. Only a shift longer than a single day needs the number typed,
   * so that field stays hidden until it does.
   */
  const spanHours = useMemo(
    () => hoursBetweenTimesOfDay(formData.start_time_of_day, formData.end_time_of_day),
    [formData.start_time_of_day, formData.end_time_of_day]
  );
  const [runsMultipleDays, setRunsMultipleDays] = useState(false);

  useEffect(() => {
    const next = initialData || emptyTemplateForm;
    setFormData(next);
    const span = hoursBetweenTimesOfDay(next.start_time_of_day, next.end_time_of_day);
    const stated = parseFloat(next.duration_hours);
    setRunsMultipleDays(!isNaN(stated) && span !== null && stated - span > 0.01);
  }, [initialData, isOpen]);

  const effectiveDuration = runsMultipleDays ? parseFloat(formData.duration_hours) : (spanHours ?? NaN);

  const loadApparatusTypeDefaults = (type: string) => {
    if (!type) return;
    try {
      const stored = localStorage.getItem('scheduling_settings');
      if (stored) {
        const settings = JSON.parse(stored) as {
          apparatusTypeDefaults?: Record<string, { positions?: string[]; minStaffing?: number }>;
        };
        const defaults = settings.apparatusTypeDefaults?.[type];
        if (defaults) {
          setFormData((prev) => ({
            ...prev,
            positions: defaults.positions
              ? defaults.positions.map((p) => ({ position: p, required: true }))
              : prev.positions,
            min_staffing: String(defaults.minStaffing ?? prev.min_staffing),
          }));
          return;
        }
      }
    } catch {
      /* ignore */
    }
  };

  const totalResourceStaffing = useMemo(() => {
    return formData.resources.reduce((sum, r) => sum + r.positions.length * r.quantity, 0);
  }, [formData.resources]);

  const applyStarter = (starter: {
    name: string;
    eventType: EventType;
    description: string;
    start_time_of_day: string;
    end_time_of_day: string;
    duration_hours: string;
    color: string;
    resources: ResourceUnit[];
  }) => {
    setFormData((prev) => ({
      ...prev,
      name: starter.name,
      description: starter.description,
      start_time_of_day: starter.start_time_of_day,
      end_time_of_day: starter.end_time_of_day,
      duration_hours: starter.duration_hours,
      color: starter.color,
      event_type: starter.eventType,
      resources: starter.resources.map((r) => ({ ...r, positions: [...r.positions] })),
      min_staffing: String(starter.resources.reduce((s, r) => s + r.positions.length * r.quantity, 0)),
    }));
    setRunsMultipleDays(false);
  };

  const addResource = (typeValue: string) => {
    const opt = RESOURCE_TYPE_OPTIONS.find((o) => o.value === typeValue);
    if (!opt) return;
    setFormData((prev) => ({
      ...prev,
      resources: [
        ...prev.resources,
        { type: opt.value, label: opt.label, quantity: opt.defaultQty, positions: [...opt.defaultPositions] },
      ],
    }));
  };

  const removeResource = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      resources: prev.resources.filter((_, i) => i !== index),
    }));
  };

  const updateResourceQuantity = (index: number, qty: number) => {
    setFormData((prev) => {
      const updated = [...prev.resources];
      updated[index] = { ...updated[index], quantity: Math.max(1, qty) } as ResourceUnit;
      return { ...prev, resources: updated };
    });
  };

  const updateResourcePositions = (index: number, positions: string[]) => {
    setFormData((prev) => {
      const updated = [...prev.resources];
      updated[index] = { ...updated[index], positions } as ResourceUnit;
      return { ...prev, resources: updated };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(effectiveDuration) || effectiveDuration <= 0) {
      toast.error('Set a start and end time so the shift has a length.');
      return;
    }
    setIsSubmitting(true);
    try {
      const effectivePositions: PositionEntry[] =
        formData.category === 'event' && formData.resources.length > 0
          ? formData.resources.flatMap((r) =>
              Array.from({ length: r.quantity }, () => r.positions.map((p) => ({ position: p, required: true }))).flat()
            )
          : formData.positions;
      const payload: Record<string, unknown> = {
        name: formData.name,
        start_time_of_day: formData.start_time_of_day,
        end_time_of_day: formData.end_time_of_day,
        duration_hours: effectiveDuration,
        min_staffing:
          formData.category === 'event' && totalResourceStaffing > 0
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
          flat_positions: effectivePositions.length > 0 ? effectivePositions.map((p) => p.position) : [],
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* The whole panel used to be the scroll container, which put Save at the
          bottom of the scrolled content: on a short window the form ended
          mid-option with nothing on screen to say it continued, and no way to
          submit without scrolling for it. Header and footer are fixed now, and
          only the fields move. */}
      <div className="bg-theme-surface-modal flex max-h-[90dvh] w-full max-w-lg flex-col rounded-lg">
        <div className="border-theme-surface-border flex shrink-0 items-center justify-between border-b p-6">
          <h2 id="template-modal-title" className="text-theme-text-primary text-xl font-bold">
            {title}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            <div>
              <label htmlFor="template-name" className="form-label">
                Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="form-input"
                placeholder="e.g., Day Shift A"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="template-description" className="form-label">
                Description
              </label>
              <textarea
                id="template-description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="form-input"
                rows={2}
                placeholder="Optional description"
              />
            </div>

            {/* Category */}
            <div>
              <label className="form-label mb-1.5">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATE_CATEGORIES.map((cat) => {
                  const CatIcon = cat.icon;
                  const isSelected = formData.category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          category: cat.value,
                          apparatus_type: cat.value === 'event' ? '' : prev.apparatus_type,
                        }));
                      }}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${
                        isSelected
                          ? 'border-red-500/40 bg-red-500/5'
                          : 'border-theme-surface-border bg-theme-surface-hover/30 hover:border-theme-surface-border/80'
                      }`}
                    >
                      <CatIcon
                        className={`mb-1 h-4 w-4 ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted'}`}
                      />
                      <p
                        className={`text-xs font-medium ${isSelected ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}
                      >
                        {cat.label}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vehicle (for standard & specialty templates) */}
            {(formData.category === 'standard' || formData.category === 'specialty') && (
              <div>
                <label htmlFor="template-apparatus-type" className="form-label">
                  <span className="flex items-center gap-1.5">
                    <Truck className="h-4 w-4" />
                    {apparatusSource === 'default' ? 'Vehicle Type' : 'Vehicle'}
                    {formData.category === 'specialty' && <span aria-hidden="true">*</span>}
                  </span>
                </label>
                <select
                  id="template-apparatus-type"
                  value={apparatusSource === 'default' ? formData.apparatus_type : formData.apparatus_id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (apparatusSource === 'default') {
                      setFormData((prev) => ({ ...prev, apparatus_type: val, apparatus_id: '' }));
                      loadApparatusTypeDefaults(val);
                    } else {
                      const selected = apparatusOptions.find((o) => o.id === val);
                      setFormData((prev) => ({
                        ...prev,
                        apparatus_id: val,
                        apparatus_type: selected?.apparatus_type ?? '',
                        positions:
                          selected?.positions?.map((p) =>
                            typeof p === 'string'
                              ? { position: p, required: true }
                              : { position: p.position, required: (p as { required?: boolean }).required !== false }
                          ) ?? prev.positions,
                        min_staffing: selected?.min_staffing ? String(selected.min_staffing) : prev.min_staffing,
                      }));
                    }
                  }}
                  className="form-input"
                  required={formData.category === 'specialty'}
                >
                  <option value="">
                    {formData.category === 'specialty' ? 'Select vehicle...' : 'No specific vehicle (optional)'}
                  </option>
                  {apparatusSource === 'default'
                    ? FALLBACK_APPARATUS_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))
                    : apparatusOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.unit_number ? `${o.unit_number} — ${o.name}` : o.name}
                          {o.apparatus_type ? ` (${o.apparatus_type})` : ''}
                        </option>
                      ))}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  {apparatusSource === 'default'
                    ? formData.category === 'specialty'
                      ? 'Selecting a vehicle type will load default positions from your department settings.'
                      : 'Optionally assign a vehicle type to load default positions from your department settings.'
                    : formData.category === 'specialty'
                      ? "Select one of your department's vehicles. Positions and staffing will be loaded automatically."
                      : "Optionally assign one of your department's vehicles to this template."}
                </p>
              </div>
            )}

            {/* Event-specific fields */}
            {formData.category === 'event' && (
              <>
                {/* Event Type */}
                <div>
                  <label className="form-label mb-1.5">Event Type</label>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {EVENT_TYPES.map((et) => {
                      const ETIcon = et.icon;
                      const isSelected = formData.event_type === et.value;
                      return (
                        <button
                          key={et.value}
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, event_type: et.value }))}
                          className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                            isSelected
                              ? 'border-purple-500/40 bg-purple-500/5'
                              : 'border-theme-surface-border bg-theme-surface-hover/20 hover:bg-theme-surface-hover/40'
                          }`}
                        >
                          <ETIcon
                            className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-theme-text-muted'}`}
                          />
                          <span
                            className={`truncate text-xs font-medium ${isSelected ? 'text-purple-700 dark:text-purple-400' : 'text-theme-text-primary'}`}
                          >
                            {et.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick-start from pre-built templates */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="form-label mb-0">
                      <span className="flex items-center gap-1.5">
                        <Copy className="h-4 w-4" /> Quick Start
                      </span>
                    </label>
                  </div>
                  <p className="text-theme-text-muted mb-2 text-xs">
                    Start from a pre-built template, then customize. Or build from scratch below.
                  </p>
                  <div className="grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {EVENT_TEMPLATE_STARTERS.filter(
                      (s) => !formData.event_type || s.eventType === formData.event_type
                    ).map((starter, i) => {
                      const evType = EVENT_TYPES.find((e) => e.value === starter.eventType);
                      const EvIcon = evType?.icon || PartyPopper;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => applyStarter(starter)}
                          className="border-theme-surface-border bg-theme-surface-hover/20 hover:bg-theme-surface-hover/50 flex items-start gap-2 rounded-lg border p-2 text-left transition-colors"
                        >
                          <div
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: starter.color }}
                          />
                          <div className="min-w-0">
                            <p className="text-theme-text-primary flex items-center gap-1 truncate text-xs font-medium">
                              <EvIcon className="text-theme-text-muted h-3 w-3 shrink-0" />
                              {starter.name}
                            </p>
                            <p className="text-theme-text-muted truncate text-[10px]">
                              {starter.resources.length} resource{starter.resources.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    {formData.event_type &&
                      EVENT_TEMPLATE_STARTERS.filter((s) => s.eventType === formData.event_type).length === 0 && (
                        <p className="text-theme-text-muted col-span-2 py-2 text-center text-xs">
                          No starters for this event type — build from scratch below.
                        </p>
                      )}
                  </div>
                </div>

                {/* Resources / Units */}
                <div>
                  <label className="form-label">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> Resources &amp; Staffing
                    </span>
                  </label>
                  <p className="text-theme-text-muted mb-2 text-xs">
                    Add vehicles, first aid stations, bicycle teams, and other resources needed for this event.
                  </p>

                  {formData.resources.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {formData.resources.map((res, ri) => {
                        const resOpt = RESOURCE_TYPE_OPTIONS.find((o) => o.value === res.type);
                        const ResIcon = resOpt?.icon || Truck;
                        return (
                          <div
                            key={ri}
                            className="border-theme-surface-border bg-theme-surface-hover/20 rounded-lg border p-2.5"
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <ResIcon className="text-theme-text-muted h-4 w-4" />
                                <span className="text-theme-text-primary text-sm font-medium">{res.label}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-theme-text-muted text-[10px]">Qty:</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={res.quantity}
                                  onChange={(e) => updateResourceQuantity(ri, parseInt(e.target.value, 10) || 1)}
                                  className="bg-theme-input-bg border-theme-input-border text-theme-text-primary w-14 rounded-sm border px-1.5 py-0.5 text-center text-xs"
                                />
                                <button
                                  onClick={() => removeResource(ri)}
                                  className="rounded-sm p-0.5 text-red-500 hover:bg-red-500/10"
                                  title="Remove resource"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            {/* Positions for this resource */}
                            <div className="flex flex-wrap items-center gap-1">
                              {res.positions.map((pos, pi) => (
                                <span
                                  key={pi}
                                  className="inline-flex items-center gap-0.5 rounded-sm bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-700 capitalize dark:text-purple-300"
                                >
                                  {positionOptions.find((o) => o.value === pos)?.label || pos}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newPos = res.positions.filter((_, idx) => idx !== pi);
                                      updateResourcePositions(ri, newPos);
                                    }}
                                    className="ml-0.5 text-purple-700 hover:text-red-500 dark:text-purple-400"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              ))}
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) updateResourcePositions(ri, [...res.positions, e.target.value]);
                                  e.target.value = '';
                                }}
                                className="bg-theme-input-bg border-theme-input-border text-theme-text-muted rounded-sm border px-1.5 py-0.5 text-[10px]"
                              >
                                <option value="">+ position</option>
                                {positionOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {res.quantity > 1 && (
                              <p className="text-theme-text-muted mt-1 text-[10px]">
                                {res.quantity} units x {res.positions.length} positions ={' '}
                                {res.quantity * res.positions.length} personnel
                              </p>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 p-2">
                        <span className="text-xs font-medium text-purple-700 dark:text-purple-400">
                          Total staffing: {totalResourceStaffing} personnel
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Add resource button */}
                  <div className="flex flex-wrap gap-1.5">
                    {RESOURCE_TYPE_OPTIONS.map((opt) => {
                      const ResIcon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => addResource(opt.value)}
                          className="text-theme-text-muted bg-theme-surface-hover/50 hover:bg-theme-surface-hover border-theme-surface-border inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors"
                        >
                          <ResIcon className="h-3 w-3" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="template-start" className="form-label">
                    Starts at <span aria-hidden="true">*</span>
                  </label>
                  <TimeQuarterHour
                    id="template-start"
                    value={formData.start_time_of_day}
                    onChange={(e) => setFormData((prev) => ({ ...prev, start_time_of_day: e.target.value }))}
                    className="form-input"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="template-end" className="form-label">
                    Ends at <span aria-hidden="true">*</span>
                  </label>
                  <TimeQuarterHour
                    id="template-end"
                    value={formData.end_time_of_day}
                    onChange={(e) => setFormData((prev) => ({ ...prev, end_time_of_day: e.target.value }))}
                    className="form-input"
                    required
                  />
                </div>
              </div>
              <p className="text-theme-text-secondary mt-1.5 text-xs">
                {spanHours === null ? (
                  'Pick a start and an end time.'
                ) : (
                  <>
                    {formatTimeOfDay(formData.start_time_of_day)} to {formatTimeOfDay(formData.end_time_of_day)} —{' '}
                    <span className="font-medium">
                      {runsMultipleDays && !isNaN(effectiveDuration) ? effectiveDuration : spanHours} hours
                    </span>
                    {spanHours >= 24
                      ? ', a full day'
                      : formData.end_time_of_day <= formData.start_time_of_day
                        ? ', ending the next day'
                        : ', the same day'}
                    .
                  </>
                )}
              </p>
              <label className="text-theme-text-secondary mt-2 flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={runsMultipleDays}
                  onChange={(e) => {
                    setRunsMultipleDays(e.target.checked);
                    if (e.target.checked && spanHours !== null) {
                      setFormData((prev) => ({ ...prev, duration_hours: String(spanHours) }));
                    }
                  }}
                  className="form-checkbox"
                />
                This shift runs longer than the times above (a 48-hour tour, say)
              </label>
              {runsMultipleDays && (
                <div className="mt-2">
                  <label htmlFor="template-duration" className="form-label">
                    Total hours on duty <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="template-duration"
                    type="number"
                    value={formData.duration_hours}
                    onChange={(e) => setFormData((prev) => ({ ...prev, duration_hours: e.target.value }))}
                    className="form-input w-32"
                    min="0.5"
                    step="0.5"
                    required
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <span className="form-label" id="template-color-label">
                  Calendar colour
                </span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="template-color-label">
                  {TEMPLATE_COLORS.some((c) => c.value === formData.color) ? null : (
                    <button
                      type="button"
                      aria-pressed={true}
                      className="border-theme-text-primary mobile-touch-target rounded-md border-2"
                      style={{ backgroundColor: formData.color }}
                      title={`Current colour (${formData.color})`}
                    >
                      <Check className="h-4 w-4 text-white drop-shadow" aria-hidden="true" />
                      <span className="sr-only">Current colour {formData.color}</span>
                    </button>
                  )}
                  {TEMPLATE_COLORS.map((c) => {
                    const isSelected = formData.color === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setFormData((prev) => ({ ...prev, color: c.value }))}
                        className={`mobile-touch-target rounded-md border-2 transition-transform hover:scale-105 ${
                          isSelected ? 'border-theme-text-primary' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      >
                        {isSelected && <Check className="h-4 w-4 text-white drop-shadow" aria-hidden="true" />}
                        <span className="sr-only">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label htmlFor="template-min-staffing" className="form-label">
                  Smallest crew that can run <span aria-hidden="true">*</span>
                </label>
                <input
                  id="template-min-staffing"
                  type="number"
                  value={formData.min_staffing}
                  onChange={(e) => setFormData((prev) => ({ ...prev, min_staffing: e.target.value }))}
                  className="form-input w-28"
                  min="1"
                  required
                />
                <p className="text-theme-text-muted mt-1 text-xs">Below this, the shift is flagged as running short.</p>
              </div>
            </div>

            {/* Crew Positions (not shown for event templates — they use resources editor) */}
            {formData.category !== 'event' && (
              <div>
                <label className="form-label">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" aria-hidden="true" /> Crew Positions
                  </span>
                </label>
                <p className="text-theme-text-muted mb-2 text-xs">
                  {/* "Toggle the switch" described a control that was never
                    built: the Required/Optional control is a button whose
                    label is its state, not a switch. */}
                  Define the crew structure for shifts created from this template. Click a position&apos;s Required
                  badge to make it optional.
                </p>
                {formData.positions.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {formData.positions.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={entry.position}
                          onChange={(e) => {
                            const updated = [...formData.positions];
                            updated[i] = { ...entry, position: e.target.value };
                            setFormData((prev) => ({ ...prev, positions: updated }));
                          }}
                          className="form-input-sm flex-1 rounded-lg"
                        >
                          {positionOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...formData.positions];
                            updated[i] = { ...entry, required: !entry.required };
                            setFormData((prev) => ({ ...prev, positions: updated }));
                          }}
                          className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                            entry.required
                              ? 'border-violet-300 bg-violet-500/10 text-violet-700 dark:border-violet-700 dark:text-violet-400'
                              : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border'
                          }`}
                          title={
                            entry.required ? 'Required — click to make optional' : 'Optional — click to make required'
                          }
                        >
                          {entry.required ? 'Required' : 'Optional'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = formData.positions.filter((_, idx) => idx !== i);
                            setFormData((prev) => ({ ...prev, positions: updated }));
                          }}
                          className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
                          aria-label={`Remove position ${i + 1}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      positions: [...prev.positions, { position: 'firefighter', required: true }],
                    }))
                  }
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Position
                </button>
              </div>
            )}

            <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_default: e.target.checked }))}
                className="border-theme-input-border rounded-sm"
              />
              Set as default template
            </label>

            <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.open_to_all_members}
                onChange={(e) => setFormData((prev) => ({ ...prev, open_to_all_members: e.target.checked }))}
                className="border-theme-input-border rounded-sm"
              />
              Open to all members (allow non-operational members to sign up)
            </label>
          </div>

          <div className="border-theme-surface-border flex shrink-0 justify-end gap-3 border-t p-6 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary px-6">
              {isSubmitting ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TemplateFormModal;
