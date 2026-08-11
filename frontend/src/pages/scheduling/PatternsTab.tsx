/**
 * Patterns Tab
 *
 * Manage recurring shift patterns and generate shifts from them.
 * Admins can:
 * - Pick from common fire department presets (24/48, Kelly, etc.)
 * - Build a fully custom cycle with day/night/off toggles
 * - Create manual patterns (daily, weekly, platoon, custom dates)
 * - Generate shifts from any pattern for a given date range
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Plus,
  RefreshCw,
  Loader2,
  Trash2,
  Play,
  ChevronDown,
  ChevronUp,
  Zap,
  Wrench,
  SlidersHorizontal,
  Sun,
  Moon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftTemplateRecord } from '../../modules/scheduling/services/api';
import type { ShiftPattern } from '../../types/scheduling';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, formatTimeOfDay } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import type { PresetPatternDef, CycleEntry } from './shiftPatternPresets';
import { PlatoonSelector } from './PlatoonSelector';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const PresetPatterns = lazyWithRetry(() => import('./PresetPatterns'));
const CustomPatternBuilder = lazyWithRetry(() => import('./CustomPatternBuilder'));

type CreationMode = 'preset' | 'custom' | 'manual';

const PATTERN_TYPE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  platoon: 'Platoon Rotation',
  custom: 'Custom',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const inputCls =
  'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

const LazyFallback = () => (
  <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
    <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
  </div>
);

/** Visual cycle strip for patterns that have a cycle_pattern in their config. */
const CycleStrip: React.FC<{ config: Record<string, unknown> }> = ({ config }) => {
  const cp = config.cycle_pattern;
  if (!Array.isArray(cp) || cp.length === 0) return null;
  const entries = cp as string[];
  const summary = entries.map((e, i) => `Day ${i + 1}: ${e}`).join(', ');
  return (
    <div className="mt-1.5 flex gap-px" role="img" aria-label={`Cycle pattern: ${summary}`}>
      {entries.map((entry, i) => {
        let bg = 'bg-theme-surface-hover';
        if (entry === 'on') bg = 'bg-violet-500';
        else if (entry === 'day') bg = 'bg-amber-400 dark:bg-amber-500';
        else if (entry === 'night') bg = 'bg-indigo-500 dark:bg-indigo-400';
        return (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-xs ${bg}`}
            title={`Day ${i + 1}: ${entry}`}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
};

export const PatternsTab: React.FC = () => {
  const tz = useTimezone();
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>('preset');
  const [selectedPreset, setSelectedPreset] = useState<PresetPatternDef | null>(null);
  const [customCyclePattern, setCustomCyclePattern] = useState<CycleEntry[]>(
    Array.from({ length: 7 }, () => 'off' as const)
  );

  const [createForm, setCreateForm] = useState<{
    name: string;
    description: string;
    pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
    template_id: string;
    day_template_id: string;
    night_template_id: string;
    start_date: string;
    end_date: string;
    days_on: number;
    days_off: number;
    rotation_days: number;
    weekdays: number[];
  }>({
    name: '',
    description: '',
    pattern_type: 'weekly',
    template_id: '',
    day_template_id: '',
    night_template_id: '',
    start_date: '',
    end_date: '',
    days_on: 1,
    days_off: 1,
    rotation_days: 3,
    weekdays: [1, 2, 3, 4, 5],
  });
  const [creating, setCreating] = useState(false);

  // Platoons declared by a rotation pattern (membership lives on profiles)
  const { members, loadMembers, platoonsEnabled, loadSettings } = useSchedulingStore();
  const [platoons, setPlatoons] = useState<string[]>(['A', 'B', 'C']);

  // Generate form
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [generateForm, setGenerateForm] = useState({
    start_date: '',
    end_date: '',
  });
  const [generating, setGenerating] = useState(false);

  // Inline delete confirmation
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // Expanded pattern detail
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [patternsData, templatesData] = await Promise.all([
        schedulingService.getPatterns(),
        schedulingService.getTemplates(),
      ]);
      setPatterns(patternsData);
      setTemplates(templatesData);
      setExpandedId((current) => current ?? patternsData[0]?.id ?? null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load patterns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadMembers();
    void loadSettings();
  }, [loadMembers, loadSettings]);

  // Escape key closes inline confirmations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirmingDelete) setConfirmingDelete(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmingDelete]);

  // When a preset is selected, populate the form
  const handlePresetSelect = useCallback(
    (preset: PresetPatternDef) => {
      setSelectedPreset((prev) => (prev?.id === preset.id ? null : preset));
      if (selectedPreset?.id === preset.id) return; // deselecting
      setCreateForm((prev) => ({
        ...prev,
        name: preset.name,
        description: preset.description,
        pattern_type: preset.patternType,
        days_on: preset.daysOn ?? 1,
        days_off: preset.daysOff ?? 1,
        rotation_days: preset.cycleDays,
      }));
    },
    [selectedPreset]
  );

  const resetCreateForm = useCallback(() => {
    setShowCreate(false);
    setCreationMode('preset');
    setSelectedPreset(null);
    setCustomCyclePattern(Array.from({ length: 7 }, () => 'off' as const));
    setPlatoons(['A', 'B', 'C']);
    setCreateForm({
      name: '',
      description: '',
      pattern_type: 'weekly',
      template_id: '',
      day_template_id: '',
      night_template_id: '',
      start_date: '',
      end_date: '',
      days_on: 1,
      days_off: 1,
      rotation_days: 3,
      weekdays: [1, 2, 3, 4, 5],
    });
  }, []);

  /** Determine if the current creation config uses day/night entries. */
  const hasDayNight = (): boolean => {
    if (creationMode === 'preset' && selectedPreset) {
      return selectedPreset.hasDayNight;
    }
    if (creationMode === 'custom') {
      return customCyclePattern.some((e) => e === 'day' || e === 'night');
    }
    return false;
  };

  const handleCreate = async () => {
    if (!createForm.name || !createForm.start_date) {
      toast.error('Name and start date are required');
      return;
    }

    // Template is required for generation
    if (!createForm.template_id && !createForm.day_template_id) {
      toast.error('A shift template is required — select one in the Templates tab first');
      return;
    }

    setCreating(true);
    try {
      const scheduleConfig: Record<string, unknown> = {};
      let patternType = createForm.pattern_type;
      let daysOn: number | undefined;
      let daysOff: number | undefined;
      let rotationDays: number | undefined;

      if (creationMode === 'preset' && selectedPreset) {
        patternType = selectedPreset.patternType;
        if (selectedPreset.cyclePattern) {
          scheduleConfig.cycle_pattern = selectedPreset.cyclePattern;
        } else {
          daysOn = selectedPreset.daysOn;
          daysOff = selectedPreset.daysOff;
        }
        rotationDays = selectedPreset.cycleDays;
      } else if (creationMode === 'custom') {
        patternType = 'platoon';
        const hasOnDuty = customCyclePattern.some((e) => e !== 'off');
        if (!hasOnDuty) {
          toast.error('Custom pattern must have at least one on-duty day');
          setCreating(false);
          return;
        }
        scheduleConfig.cycle_pattern = customCyclePattern;
        rotationDays = customCyclePattern.length;
      } else {
        // Manual mode
        if (patternType === 'weekly') {
          scheduleConfig.weekdays = createForm.weekdays;
        }
        if (patternType === 'platoon') {
          daysOn = createForm.days_on;
          daysOff = createForm.days_off;
          rotationDays = createForm.rotation_days;
        }
      }

      // Attach day/night template IDs if the pattern uses them
      if (hasDayNight()) {
        if (createForm.day_template_id) {
          scheduleConfig.day_template_id = createForm.day_template_id;
        }
        if (createForm.night_template_id) {
          scheduleConfig.night_template_id = createForm.night_template_id;
        }
      }

      // Declare the platoons a rotation covers. Generation pulls current
      // members by their profile platoon (User.platoon) — no per-pattern crew
      // snapshot is stored.
      if (platoonsEnabled && patternType === 'platoon' && platoons.length > 0) {
        scheduleConfig.platoons = platoons;
      }

      await schedulingService.createPattern({
        name: createForm.name,
        description: createForm.description || undefined,
        pattern_type: patternType,
        template_id: createForm.template_id || createForm.day_template_id || undefined,
        start_date: createForm.start_date,
        end_date: createForm.end_date || undefined,
        days_on: daysOn,
        days_off: daysOff,
        rotation_days: rotationDays,
        schedule_config: Object.keys(scheduleConfig).length > 0 ? scheduleConfig : undefined,
      });
      toast.success('Pattern created');
      resetCreateForm();
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create pattern'));
    } finally {
      setCreating(false);
    }
  };

  const handleGenerate = async (patternId: string) => {
    if (!generateForm.start_date || !generateForm.end_date) {
      toast.error('Start and end dates are required');
      return;
    }
    setGenerating(true);
    try {
      const result = await schedulingService.generateShiftsFromPattern(patternId, {
        start_date: generateForm.start_date,
        end_date: generateForm.end_date,
      });
      const count = Number(result.shifts_created ?? 0);
      toast.success(`Generated ${count} shift${count !== 1 ? 's' : ''}`);
      setGeneratingFor(null);
      setGenerateForm({ start_date: '', end_date: '' });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to generate shifts'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (patternId: string) => {
    try {
      await schedulingService.deletePattern(patternId);
      toast.success('Pattern deleted');
      setConfirmingDelete(null);
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete pattern'));
    }
  };

  const toggleWeekday = (day: number) => {
    setCreateForm((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day].sort(),
    }));
  };

  const activeTemplates = templates.filter((t) => t.is_active);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading shift patterns…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header. The heading lived here as well as on the page around it, so
          "Shift Patterns" was printed twice, one line apart. The page owns the
          title and the sentence under it; this row keeps only its controls. */}
      <div className="flex justify-end gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void loadData();
            }}
            className="text-theme-text-muted hover:text-theme-text-primary rounded-lg p-2 transition-colors"
            aria-label="Refresh patterns"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" /> New Pattern
          </button>
        </div>
      </div>

      {/* ============================================
          CREATE FORM
          ============================================ */}
      {showCreate && (
        <div className="overflow-hidden rounded-xl border border-violet-500/20 bg-violet-500/5">
          {/* Creation mode selector */}
          <div className="border-b border-violet-500/10 p-4 sm:p-5">
            <h4 className="text-theme-text-primary mb-3 text-sm font-semibold">Create Shift Pattern</h4>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  mode: 'preset' as const,
                  label: 'Fire Dept Presets',
                  icon: Zap,
                  desc: 'Common schedules',
                },
                {
                  mode: 'custom' as const,
                  label: 'Custom Builder',
                  icon: Wrench,
                  desc: 'Build your own cycle',
                },
                {
                  mode: 'manual' as const,
                  label: 'Manual Setup',
                  icon: SlidersHorizontal,
                  desc: 'Daily / weekly / platoon',
                },
              ].map(({ mode, label, icon: Icon, desc }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setCreationMode(mode);
                    setSelectedPreset(null);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                    creationMode === mode
                      ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                      : 'border-theme-surface-border text-theme-text-muted hover:border-violet-500/40'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-[10px] opacity-70">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            {/* Preset selection */}
            {creationMode === 'preset' && (
              <Suspense fallback={<LazyFallback />}>
                <PresetPatterns onSelect={handlePresetSelect} selectedId={selectedPreset?.id} />
              </Suspense>
            )}

            {/* Custom builder */}
            {creationMode === 'custom' && (
              <Suspense fallback={<LazyFallback />}>
                <CustomPatternBuilder cyclePattern={customCyclePattern} onChange={setCustomCyclePattern} />
              </Suspense>
            )}

            {/* Manual mode: pattern type & type-specific fields */}
            {creationMode === 'manual' && (
              <>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Pattern Type</label>
                  <select
                    value={createForm.pattern_type}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        pattern_type: e.target.value as 'daily' | 'weekly' | 'platoon' | 'custom',
                      }))
                    }
                    className={inputCls}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="platoon">Platoon Rotation</option>
                    <option value="custom">Custom Dates</option>
                  </select>
                </div>

                {/* Weekly: weekday picker */}
                {createForm.pattern_type === 'weekly' && (
                  <div>
                    <label className="text-theme-text-secondary mb-2 block text-xs font-medium">Active Days</label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_LABELS.map((label, i) => (
                        <button
                          key={i}
                          onClick={() => toggleWeekday(i)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            createForm.weekdays.includes(i)
                              ? 'border-violet-600 bg-violet-600 text-white'
                              : 'border-theme-surface-border text-theme-text-muted hover:border-violet-500'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Platoon: days on/off */}
                {createForm.pattern_type === 'platoon' && (
                  <div>
                    <div className="form-grid-3">
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Days On</label>
                        <input
                          type="number"
                          min="1"
                          value={createForm.days_on}
                          onChange={(e) =>
                            setCreateForm((p) => ({
                              ...p,
                              days_on: parseInt(e.target.value) || 1,
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Days Off</label>
                        <input
                          type="number"
                          min="1"
                          value={createForm.days_off}
                          onChange={(e) =>
                            setCreateForm((p) => ({
                              ...p,
                              days_off: parseInt(e.target.value) || 1,
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                          Rotation Cycle
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={createForm.rotation_days}
                          onChange={(e) =>
                            setCreateForm((p) => ({
                              ...p,
                              rotation_days: parseInt(e.target.value) || 1,
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <p className="text-theme-text-muted mt-2 text-xs">
                      Example: A common 24/48 schedule uses 1 day on, 2 days off, with a 3-day rotation cycle.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ---- Common fields for all modes ---- */}
            {(creationMode !== 'preset' || selectedPreset) && (
              <>
                <div className="space-y-4 border-t border-violet-500/10 pt-4">
                  <h5 className="text-theme-text-secondary text-xs font-semibold tracking-wider uppercase">
                    Pattern Details
                  </h5>

                  <div className="form-grid-2">
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Pattern Name *</label>
                      <input
                        type="text"
                        value={createForm.name}
                        onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g., A-Shift 24/48"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Description</label>
                      <input
                        type="text"
                        value={createForm.description}
                        onChange={(e) =>
                          setCreateForm((p) => ({
                            ...p,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Optional description"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* Template selection — different UI for day/night vs single */}
                  {hasDayNight() ? (
                    <div className="space-y-3">
                      <p className="text-theme-text-muted flex items-center gap-1.5 text-xs">
                        <Sun className="h-3.5 w-3.5 text-amber-500" />
                        <Moon className="h-3.5 w-3.5 text-indigo-700 dark:text-indigo-400" />
                        This pattern uses day and night shifts. Select a template for each.
                      </p>
                      <div className="form-grid-2">
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                            <Sun className="mr-1 inline h-3 w-3 text-amber-500" />
                            Day Shift Template *
                          </label>
                          <select
                            value={createForm.day_template_id}
                            onChange={(e) =>
                              setCreateForm((p) => ({
                                ...p,
                                day_template_id: e.target.value,
                                template_id: e.target.value || p.template_id,
                              }))
                            }
                            className={inputCls}
                          >
                            <option value="">Select template...</option>
                            {activeTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({formatTimeOfDay(t.start_time_of_day)} - {formatTimeOfDay(t.end_time_of_day)})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                            <Moon className="mr-1 inline h-3 w-3 text-indigo-700 dark:text-indigo-400" />
                            Night Shift Template *
                          </label>
                          <select
                            value={createForm.night_template_id}
                            onChange={(e) =>
                              setCreateForm((p) => ({
                                ...p,
                                night_template_id: e.target.value,
                              }))
                            }
                            className={inputCls}
                          >
                            <option value="">Select template...</option>
                            {activeTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({formatTimeOfDay(t.start_time_of_day)} - {formatTimeOfDay(t.end_time_of_day)})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                        Shift Template *
                      </label>
                      <select
                        value={createForm.template_id}
                        onChange={(e) =>
                          setCreateForm((p) => ({
                            ...p,
                            template_id: e.target.value,
                          }))
                        }
                        className={inputCls}
                      >
                        <option value="">Select template...</option>
                        {activeTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({formatTimeOfDay(t.start_time_of_day)} - {formatTimeOfDay(t.end_time_of_day)})
                          </option>
                        ))}
                      </select>
                      {activeTemplates.length === 0 && (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          No templates found. Create one in the Templates tab first.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="form-grid-2">
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Start Date *</label>
                      <input
                        type="date"
                        value={createForm.start_date}
                        onChange={(e) =>
                          setCreateForm((p) => ({
                            ...p,
                            start_date: e.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                      <p className="text-theme-text-muted mt-1 text-[11px]">The cycle begins counting from this date</p>
                    </div>
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                        End Date (optional)
                      </label>
                      <input
                        type="date"
                        value={createForm.end_date}
                        onChange={(e) =>
                          setCreateForm((p) => ({
                            ...p,
                            end_date: e.target.value,
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>

                {/* Platoon declaration (platoon rotations only) */}
                {platoonsEnabled &&
                  ((creationMode === 'preset' && selectedPreset) ||
                    creationMode === 'custom' ||
                    (creationMode === 'manual' && createForm.pattern_type === 'platoon')) && (
                    <PlatoonSelector members={members} platoons={platoons} onPlatoonsChange={setPlatoons} />
                  )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={resetCreateForm}
                    className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreate();
                    }}
                    disabled={creating}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Create Pattern
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ============================================
          PATTERN LIST
          ============================================ */}
      {patterns.length === 0 && !showCreate ? (
        <div className="border-theme-surface-border rounded-xl border border-dashed py-16 text-center">
          <RefreshCw className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No patterns yet</h3>
          <p className="text-theme-text-muted mb-4 text-sm">
            Create a shift pattern to automatically generate recurring shifts.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" /> Create First Pattern
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {patterns.map((pattern) => {
            const isExpanded = expandedId === pattern.id;
            const isGenerating = generatingFor === pattern.id;
            const templateName = templates.find((t) => t.id === pattern.template_id)?.name;
            const config: Record<string, unknown> = pattern.schedule_config ?? {};
            const weekdays = config.weekdays as number[] | undefined;
            const cyclePattern = config.cycle_pattern as string[] | undefined;
            const patternPlatoons = config.platoons as string[] | undefined;

            return (
              <div
                key={pattern.id}
                className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border"
              >
                {/* A pattern row used to be one big button with a bare chevron:
                    everything a pattern is for — generating the shifts — was
                    behind a glyph that said nothing about what it hid. The
                    toggle names itself, and the one action worth taking sits on
                    the row. */}
                <div className="flex items-start gap-2 sm:items-center">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : pattern.id)}
                    className="flex min-w-0 flex-1 items-start justify-between gap-3 p-4 text-left sm:items-center sm:p-5"
                    aria-expanded={isExpanded}
                    aria-controls={`pattern-details-${pattern.id}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          pattern.is_active ? 'bg-violet-500/10' : 'bg-theme-surface-secondary'
                        }`}
                      >
                        <RefreshCw
                          className={`h-5 w-5 ${pattern.is_active ? 'text-violet-500' : 'text-theme-text-muted'}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-theme-text-primary text-sm font-semibold">{pattern.name}</p>
                          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700 capitalize dark:text-violet-400">
                            {PATTERN_TYPE_LABELS[pattern.pattern_type] ?? pattern.pattern_type}
                          </span>
                          {!pattern.is_active && (
                            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-theme-text-muted mt-0.5 text-xs">
                          {templateName && <span>Template: {templateName} · </span>}
                          Starts:{' '}
                          {formatDateCustom(
                            pattern.start_date + 'T12:00:00',
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            },
                            tz
                          )}
                          {pattern.end_date && (
                            <span>
                              {' '}
                              · Ends:{' '}
                              {formatDateCustom(
                                pattern.end_date + 'T12:00:00',
                                {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                },
                                tz
                              )}
                            </span>
                          )}
                        </p>
                        {weekdays && weekdays.length > 0 && (
                          <div className="mt-1 flex gap-1">
                            {WEEKDAY_LABELS.map((label, i) => (
                              <span
                                key={i}
                                className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                  weekdays.includes(i)
                                    ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400'
                                    : 'text-theme-text-muted opacity-40'
                                }`}
                              >
                                {label.charAt(0)}
                              </span>
                            ))}
                          </div>
                        )}
                        {cyclePattern && <CycleStrip config={config} />}
                      </div>
                    </div>
                    <span className="text-theme-text-muted flex shrink-0 items-center gap-1 text-xs font-medium">
                      {isExpanded ? 'Hide' : 'Details'}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setExpandedId(pattern.id);
                      setGeneratingFor(pattern.id);
                      setGenerateForm({ start_date: '', end_date: '' });
                    }}
                    className="mr-4 flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 max-sm:mt-4 sm:mr-5"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    {/* Never sr-only: hiding the text on a phone leaves the same
                        bare glyph this change exists to replace. Shorter there,
                        not absent. */}
                    <span className="hidden sm:inline">Generate shifts</span>
                    <span className="sm:hidden">Generate</span>
                  </button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div
                    id={`pattern-details-${pattern.id}`}
                    className="border-theme-surface-border space-y-4 border-t p-4 sm:p-5"
                  >
                    {pattern.description && <p className="text-theme-text-secondary text-sm">{pattern.description}</p>}

                    {pattern.pattern_type === 'platoon' && !cyclePattern && (
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span className="text-theme-text-muted">
                          Days on: <span className="text-theme-text-primary font-medium">{pattern.days_on}</span>
                        </span>
                        <span className="text-theme-text-muted">
                          Days off: <span className="text-theme-text-primary font-medium">{pattern.days_off}</span>
                        </span>
                        <span className="text-theme-text-muted">
                          Rotation:{' '}
                          <span className="text-theme-text-primary font-medium">{pattern.rotation_days} days</span>
                        </span>
                      </div>
                    )}

                    {patternPlatoons && patternPlatoons.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-theme-text-secondary text-xs font-medium">
                          Platoons (members assigned on their profile)
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {patternPlatoons.map((p) => (
                            <span
                              key={p}
                              className="text-theme-text-secondary rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px]"
                            >
                              Platoon {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {cyclePattern && (
                      <div className="space-y-2">
                        <p className="text-theme-text-secondary text-xs font-medium">
                          Cycle Pattern ({cyclePattern.length}-day rotation)
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {cyclePattern.map((entry, i) => {
                            let cls = 'bg-theme-surface-hover text-theme-text-muted';
                            if (entry === 'on') cls = 'bg-violet-500/20 text-violet-600 dark:text-violet-400';
                            else if (entry === 'day') cls = 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
                            else if (entry === 'night') cls = 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400';
                            return (
                              <span key={i} className={`rounded-sm px-2 py-1 text-[10px] font-semibold ${cls}`}>
                                D{i + 1}: {String(entry).charAt(0).toUpperCase() + String(entry).slice(1)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Generate shifts form */}
                    {isGenerating ? (
                      <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                          <Play className="h-3.5 w-3.5 text-emerald-500" /> Generate Shifts
                        </h4>
                        <p className="text-theme-text-muted text-xs">
                          Creates a shift for each matching day in the selected range. Duplicates are skipped
                          automatically.
                        </p>
                        <div className="form-grid-2">
                          <div>
                            <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                              Start Date *
                            </label>
                            <input
                              type="date"
                              value={generateForm.start_date}
                              onChange={(e) =>
                                setGenerateForm((p) => ({
                                  ...p,
                                  start_date: e.target.value,
                                }))
                              }
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                              End Date *
                            </label>
                            <input
                              type="date"
                              value={generateForm.end_date}
                              onChange={(e) =>
                                setGenerateForm((p) => ({
                                  ...p,
                                  end_date: e.target.value,
                                }))
                              }
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setGeneratingFor(null)}
                            className="text-theme-text-secondary px-3 py-1.5 text-sm"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              void handleGenerate(pattern.id);
                            }}
                            disabled={generating}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {generating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            Generate
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="action-bar">
                        <button
                          onClick={() => {
                            setGeneratingFor(pattern.id);
                            setGenerateForm({ start_date: '', end_date: '' });
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white transition-colors hover:bg-emerald-700"
                        >
                          <Play className="h-3.5 w-3.5" /> Generate Shifts
                        </button>
                        <div className="flex-1" />
                        {confirmingDelete === pattern.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-500">
                              Delete pattern? Existing shifts will not be removed.
                            </span>
                            <button
                              onClick={() => {
                                void handleDelete(pattern.id);
                              }}
                              className="btn-primary rounded-md px-2.5 py-1.5 text-xs"
                              aria-label="Confirm delete"
                            >
                              Yes, delete
                            </button>
                            <button
                              onClick={() => setConfirmingDelete(null)}
                              className="text-theme-text-muted hover:text-theme-text-primary px-2.5 py-1.5 text-xs"
                              aria-label="Cancel delete"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingDelete(pattern.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PatternsTab;
