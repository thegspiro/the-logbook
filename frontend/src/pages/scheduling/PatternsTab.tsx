/**
 * Patterns Tab
 *
 * Manage recurring shift patterns and generate shifts from them.
 * Admins can create patterns (weekly, platoon rotation, etc.),
 * link them to templates, and bulk-generate shifts for a date range.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, Loader2, Calendar, Clock, Trash2,
  Play, ChevronDown, ChevronUp, Users, Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';

interface Pattern {
  id: string;
  name: string;
  description?: string;
  pattern_type: string;
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: Record<string, unknown>;
  start_date: string;
  end_date?: string;
  assigned_members?: Array<{ user_id: string; platoon?: string; position?: string }>;
  is_active: boolean;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  is_active: boolean;
}

const PATTERN_TYPE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  platoon: 'Platoon Rotation',
  custom: 'Custom',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500';

export const PatternsTab: React.FC = () => {
  const tz = useTimezone();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    pattern_type: 'weekly',
    template_id: '',
    start_date: '',
    end_date: '',
    days_on: 1,
    days_off: 1,
    rotation_days: 3,
    weekdays: [1, 2, 3, 4, 5] as number[], // Mon-Fri default
  });
  const [creating, setCreating] = useState(false);

  // Generate form
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [generateForm, setGenerateForm] = useState({ start_date: '', end_date: '' });
  const [generating, setGenerating] = useState(false);

  // Expanded pattern detail
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [patternsData, templatesData] = await Promise.all([
        schedulingService.getPatterns(),
        schedulingService.getTemplates(),
      ]);
      setPatterns(patternsData as unknown as Pattern[]);
      setTemplates(templatesData as unknown as Template[]);
    } catch {
      toast.error('Failed to load patterns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!createForm.name || !createForm.start_date) {
      toast.error('Name and start date are required');
      return;
    }
    setCreating(true);
    try {
      const scheduleConfig: Record<string, unknown> = {};
      if (createForm.pattern_type === 'weekly') {
        scheduleConfig.weekdays = createForm.weekdays;
      }
      await schedulingService.createPattern({
        name: createForm.name,
        description: createForm.description || undefined,
        pattern_type: createForm.pattern_type,
        template_id: createForm.template_id || undefined,
        start_date: createForm.start_date,
        end_date: createForm.end_date || undefined,
        days_on: createForm.pattern_type === 'platoon' ? createForm.days_on : undefined,
        days_off: createForm.pattern_type === 'platoon' ? createForm.days_off : undefined,
        rotation_days: createForm.pattern_type === 'platoon' ? createForm.rotation_days : undefined,
        schedule_config: Object.keys(scheduleConfig).length > 0 ? scheduleConfig : undefined,
      });
      toast.success('Pattern created');
      setShowCreate(false);
      setCreateForm({
        name: '', description: '', pattern_type: 'weekly', template_id: '',
        start_date: '', end_date: '', days_on: 1, days_off: 1, rotation_days: 3,
        weekdays: [1, 2, 3, 4, 5],
      });
      loadData();
    } catch {
      toast.error('Failed to create pattern');
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
        pattern_id: patternId,
        start_date: generateForm.start_date,
        end_date: generateForm.end_date,
      });
      const count = (result as Record<string, unknown>).shifts_created ?? 0;
      toast.success(`Generated ${count} shifts`);
      setGeneratingFor(null);
      setGenerateForm({ start_date: '', end_date: '' });
    } catch {
      toast.error('Failed to generate shifts');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (patternId: string) => {
    if (!window.confirm('Delete this pattern? Existing generated shifts will not be removed.')) return;
    try {
      await schedulingService.deletePattern(patternId);
      toast.success('Pattern deleted');
      loadData();
    } catch {
      toast.error('Failed to delete pattern');
    }
  };

  const toggleWeekday = (day: number) => {
    setCreateForm(prev => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter(d => d !== day)
        : [...prev.weekdays, day].sort(),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Shift Patterns</h3>
          <p className="text-sm text-theme-text-muted">Create recurring patterns and generate shifts in bulk.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Pattern
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="p-5 border border-violet-500/20 rounded-xl bg-violet-500/5 space-y-4">
          <h4 className="text-sm font-semibold text-theme-text-primary">Create Shift Pattern</h4>

          <div className="form-grid-2">
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Pattern Name *</label>
              <input type="text" value={createForm.name}
                onChange={e => setCreateForm(p => ({...p, name: e.target.value}))}
                placeholder="e.g., A-Shift Weekly" className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Pattern Type</label>
              <select value={createForm.pattern_type}
                onChange={e => setCreateForm(p => ({...p, pattern_type: e.target.value}))}
                className={inputCls}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="platoon">Platoon Rotation</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-text-secondary mb-1">Description</label>
            <input type="text" value={createForm.description}
              onChange={e => setCreateForm(p => ({...p, description: e.target.value}))}
              placeholder="Optional description" className={inputCls}
            />
          </div>

          {/* Template selection */}
          {templates.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Shift Template</label>
              <select value={createForm.template_id}
                onChange={e => setCreateForm(p => ({...p, template_id: e.target.value}))}
                className={inputCls}
              >
                <option value="">No template</option>
                {templates.filter(t => t.is_active).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.start_time_of_day} - {t.end_time_of_day})</option>
                ))}
              </select>
            </div>
          )}

          {/* Weekly-specific: weekday picker */}
          {createForm.pattern_type === 'weekly' && (
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-2">Active Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAY_LABELS.map((label, i) => (
                  <button key={i} onClick={() => toggleWeekday(i)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      createForm.weekdays.includes(i)
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'border-theme-surface-border text-theme-text-muted hover:border-violet-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Platoon-specific: rotation config */}
          {createForm.pattern_type === 'platoon' && (
            <div className="form-grid-3">
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Days On</label>
                <input type="number" min="1" value={createForm.days_on}
                  onChange={e => setCreateForm(p => ({...p, days_on: parseInt(e.target.value) || 1}))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Days Off</label>
                <input type="number" min="1" value={createForm.days_off}
                  onChange={e => setCreateForm(p => ({...p, days_off: parseInt(e.target.value) || 1}))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Rotation Cycle</label>
                <input type="number" min="1" value={createForm.rotation_days}
                  onChange={e => setCreateForm(p => ({...p, rotation_days: parseInt(e.target.value) || 1}))}
                  className={inputCls}
                />
              </div>
            </div>
          )}

          <div className="form-grid-2">
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Start Date *</label>
              <input type="date" value={createForm.start_date}
                onChange={e => setCreateForm(p => ({...p, start_date: e.target.value}))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">End Date (optional)</label>
              <input type="date" value={createForm.end_date}
                onChange={e => setCreateForm(p => ({...p, end_date: e.target.value}))}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end pt-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create Pattern
            </button>
          </div>
        </div>
      )}

      {/* Pattern List */}
      {patterns.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
          <RefreshCw className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">No patterns yet</h3>
          <p className="text-theme-text-muted text-sm mb-4">
            Create a shift pattern to automatically generate recurring shifts.
          </p>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Create First Pattern
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {patterns.map(pattern => {
            const isExpanded = expandedId === pattern.id;
            const isGenerating = generatingFor === pattern.id;
            const templateName = templates.find(t => t.id === pattern.template_id)?.name;
            const weekdays = (pattern.schedule_config as Record<string, unknown>)?.weekdays as number[] | undefined;

            return (
              <div key={pattern.id} className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : pattern.id)}
                  className="w-full p-4 sm:p-5 text-left flex items-start sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      pattern.is_active ? 'bg-violet-500/10' : 'bg-gray-500/10'
                    }`}>
                      <RefreshCw className={`w-5 h-5 ${pattern.is_active ? 'text-violet-500' : 'text-gray-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-theme-text-primary">{pattern.name}</p>
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 capitalize">
                          {PATTERN_TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type}
                        </span>
                        {!pattern.is_active && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-500/10 text-gray-500">Inactive</span>
                        )}
                      </div>
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        {templateName && <span>Template: {templateName} · </span>}
                        Starts: {new Date(pattern.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })}
                        {pattern.end_date && <span> · Ends: {new Date(pattern.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })}</span>}
                      </p>
                      {weekdays && weekdays.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {WEEKDAY_LABELS.map((label, i) => (
                            <span key={i} className={`px-1.5 py-0.5 text-[9px] rounded font-medium ${
                              weekdays.includes(i) ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400' : 'text-theme-text-muted opacity-40'
                            }`}>{label.charAt(0)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-theme-text-muted" /> : <ChevronDown className="w-4 h-4 text-theme-text-muted" />}
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-theme-surface-border p-4 sm:p-5 space-y-4">
                    {pattern.description && (
                      <p className="text-sm text-theme-text-secondary">{pattern.description}</p>
                    )}

                    {pattern.pattern_type === 'platoon' && (
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span className="text-theme-text-muted">Days on: <span className="text-theme-text-primary font-medium">{pattern.days_on}</span></span>
                        <span className="text-theme-text-muted">Days off: <span className="text-theme-text-primary font-medium">{pattern.days_off}</span></span>
                        <span className="text-theme-text-muted">Rotation: <span className="text-theme-text-primary font-medium">{pattern.rotation_days} days</span></span>
                      </div>
                    )}

                    {/* Generate shifts form */}
                    {isGenerating ? (
                      <div className="p-4 border border-emerald-500/20 rounded-lg bg-emerald-500/5 space-y-3">
                        <h4 className="text-sm font-medium text-theme-text-primary flex items-center gap-2">
                          <Play className="w-3.5 h-3.5 text-emerald-500" /> Generate Shifts
                        </h4>
                        <p className="text-xs text-theme-text-muted">
                          This will create individual shift records for each matching day in the date range.
                        </p>
                        <div className="form-grid-2">
                          <div>
                            <label className="block text-xs font-medium text-theme-text-secondary mb-1">Start Date *</label>
                            <input type="date" value={generateForm.start_date}
                              onChange={e => setGenerateForm(p => ({...p, start_date: e.target.value}))}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-theme-text-secondary mb-1">End Date *</label>
                            <input type="date" value={generateForm.end_date}
                              onChange={e => setGenerateForm(p => ({...p, end_date: e.target.value}))}
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => setGeneratingFor(null)} className="px-3 py-1.5 text-sm text-theme-text-secondary">Cancel</button>
                          <button onClick={() => handleGenerate(pattern.id)} disabled={generating}
                            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm disabled:opacity-50"
                          >
                            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            Generate
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="action-bar">
                        <button onClick={() => { setGeneratingFor(pattern.id); setGenerateForm({ start_date: '', end_date: '' }); }}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> Generate Shifts
                        </button>
                        <div className="flex-1" />
                        <button onClick={() => handleDelete(pattern.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
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
