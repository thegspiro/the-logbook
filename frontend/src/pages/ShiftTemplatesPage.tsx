/**
 * Shift Templates & Patterns Page
 *
 * Manages shift templates and scheduling patterns.
 * Templates define reusable shift configurations.
 * Patterns define recurring shift schedules and can generate shifts.
 */

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
  X,
  CheckCircle,
  Users,
  Minus,
  Truck,
  PartyPopper,
  Filter,
} from 'lucide-react';
import { schedulingService } from '../services/api';

// ============================================
// Interfaces
// ============================================

type TemplateCategory = 'standard' | 'specialty' | 'event';

const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'standard', label: 'Standard', icon: Clock, description: 'Regular day, night, or rotating shifts' },
  { value: 'specialty', label: 'Specialty Vehicle', icon: Truck, description: 'Templates for specialty apparatus (Hazmat, Tower, etc.)' },
  { value: 'event', label: 'Event / Special', icon: PartyPopper, description: 'Parades, SantaMobile, community events, details' },
];

const APPARATUS_TYPES = [
  'engine', 'ladder', 'ambulance', 'rescue', 'tanker', 'brush',
  'tower', 'hazmat', 'boat', 'chief', 'utility',
];

interface ShiftTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  color?: string;
  positions?: unknown;
  min_staffing: number;
  category?: string;
  apparatus_type?: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

interface ShiftPattern {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: unknown;
  start_date: string;
  end_date?: string;
  assigned_members?: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

const BUILTIN_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'officer', label: 'Officer' },
  { value: 'driver', label: 'Driver/Operator' },
  { value: 'firefighter', label: 'Firefighter' },
  { value: 'ems', label: 'EMS' },
  { value: 'captain', label: 'Captain' },
  { value: 'lieutenant', label: 'Lieutenant' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'other', label: 'Other' },
];

// Load custom positions from settings (shared with ShiftSettingsPanel)
const getPositionOptions = (): { value: string; label: string }[] => {
  try {
    const stored = localStorage.getItem('scheduling_settings');
    if (stored) {
      const settings = JSON.parse(stored);
      const custom = (settings.customPositions || []) as { value: string; label: string }[];
      const merged = [...BUILTIN_POSITION_OPTIONS];
      for (const cp of custom) {
        if (!merged.some(p => p.value === cp.value)) {
          merged.push(cp);
        }
      }
      return merged;
    }
  } catch { /* ignore */ }
  return BUILTIN_POSITION_OPTIONS;
};

interface TemplateFormData {
  name: string;
  description: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: string;
  color: string;
  min_staffing: string;
  is_default: boolean;
  positions: string[];
  category: TemplateCategory;
  apparatus_type: string;
}

interface PatternFormData {
  name: string;
  description: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id: string;
  rotation_days: string;
  days_on: string;
  days_off: string;
  start_date: string;
  end_date: string;
}

type TabView = 'templates' | 'patterns';

const PATTERN_TYPES: { value: string; label: string; description: string }[] = [
  { value: 'daily', label: 'Daily', description: 'Shifts repeat every day' },
  { value: 'weekly', label: 'Weekly', description: 'Shifts repeat on specific days of the week' },
  { value: 'platoon', label: 'Platoon', description: 'Rotating platoon schedule (e.g., 24/48, Kelly)' },
  { value: 'custom', label: 'Custom', description: 'Custom rotation pattern' },
];

const emptyTemplateForm: TemplateFormData = {
  name: '',
  description: '',
  start_time_of_day: '08:00',
  end_time_of_day: '20:00',
  duration_hours: '12',
  color: '#dc2626',
  min_staffing: '1',
  is_default: false,
  positions: [],
  category: 'standard',
  apparatus_type: '',
};

const emptyPatternForm: PatternFormData = {
  name: '',
  description: '',
  pattern_type: 'daily',
  template_id: '',
  rotation_days: '',
  days_on: '',
  days_off: '',
  start_date: '',
  end_date: '',
};

// ============================================
// Template Form Modal
// ============================================

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: TemplateFormData;
  title: string;
}

const TemplateFormModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
}) => {
  const [formData, setFormData] = useState<TemplateFormData>(initialData || emptyTemplateForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const positionOptions = getPositionOptions();

  useEffect(() => {
    setFormData(initialData || emptyTemplateForm);
  }, [initialData, isOpen]);

  // Load apparatus-type defaults from settings when apparatus_type changes
  const loadApparatusTypeDefaults = (type: string) => {
    if (!type) return;
    try {
      const stored = localStorage.getItem('scheduling_settings');
      if (stored) {
        const settings = JSON.parse(stored);
        const defaults = settings.apparatusTypeDefaults?.[type];
        if (defaults) {
          setFormData(prev => ({
            ...prev,
            positions: defaults.positions || prev.positions,
            min_staffing: String(defaults.minStaffing || prev.min_staffing),
          }));
          return;
        }
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        start_time_of_day: formData.start_time_of_day,
        end_time_of_day: formData.end_time_of_day,
        duration_hours: parseFloat(formData.duration_hours),
        min_staffing: parseInt(formData.min_staffing, 10),
        is_default: formData.is_default,
        positions: formData.positions.length > 0 ? formData.positions : null,
        category: formData.category,
      };
      if (formData.description) payload.description = formData.description;
      if (formData.color) payload.color = formData.color;
      if (formData.apparatus_type) payload.apparatus_type = formData.apparatus_type;
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="template-name" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="template-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
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
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
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
                        apparatus_type: cat.value !== 'specialty' ? '' : prev.apparatus_type,
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

          {/* Apparatus Type (for specialty templates) */}
          {formData.category === 'specialty' && (
            <div>
              <label htmlFor="template-apparatus-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
                <span className="flex items-center gap-1.5"><Truck className="w-4 h-4" /> Vehicle Type</span>
              </label>
              <select
                id="template-apparatus-type"
                value={formData.apparatus_type}
                onChange={(e) => {
                  const newType = e.target.value;
                  setFormData(prev => ({ ...prev, apparatus_type: newType }));
                  loadApparatusTypeDefaults(newType);
                }}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              >
                <option value="">Select vehicle type...</option>
                {APPARATUS_TYPES.map(t => (
                  <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                Selecting a vehicle type will load default positions from your department settings.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="template-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Start Time <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-start"
                type="time"
                value={formData.start_time_of_day}
                onChange={(e) => setFormData(prev => ({ ...prev, start_time_of_day: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
              />
            </div>
            <div>
              <label htmlFor="template-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
                End Time <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-end"
                type="time"
                value={formData.end_time_of_day}
                onChange={(e) => setFormData(prev => ({ ...prev, end_time_of_day: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
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
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                min="0.5"
                step="0.5"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                  className="w-10 h-10 rounded border border-theme-input-border cursor-pointer"
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
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                min="1"
                required
              />
            </div>
          </div>

          {/* Required Positions */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" aria-hidden="true" /> Required Positions</span>
            </label>
            <p className="text-xs text-theme-text-muted mb-2">
              Define the crew structure for shifts created from this template.
            </p>
            {formData.positions.length > 0 && (
              <div className="space-y-2 mb-2">
                {formData.positions.map((pos, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={pos}
                      onChange={(e) => {
                        const updated = [...formData.positions];
                        updated[i] = e.target.value;
                        setFormData(prev => ({ ...prev, positions: updated }));
                      }}
                      className="flex-1 px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                    >
                      {positionOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
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
              onClick={() => setFormData(prev => ({ ...prev, positions: [...prev.positions, 'firefighter'] }))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Position
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))}
              className="rounded border-theme-input-border"
            />
            Set as default template
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
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Pattern Form Modal
// ============================================

interface PatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: PatternFormData;
  title: string;
  templates: ShiftTemplate[];
}

const PatternFormModal: React.FC<PatternModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
  templates,
}) => {
  const [formData, setFormData] = useState<PatternFormData>(initialData || emptyPatternForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormData(initialData || emptyPatternForm);
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        pattern_type: formData.pattern_type,
        start_date: formData.start_date,
      };
      if (formData.description) payload.description = formData.description;
      if (formData.template_id) payload.template_id = formData.template_id;
      if (formData.rotation_days) payload.rotation_days = parseInt(formData.rotation_days, 10);
      if (formData.days_on) payload.days_on = parseInt(formData.days_on, 10);
      if (formData.days_off) payload.days_off = parseInt(formData.days_off, 10);
      if (formData.end_date) payload.end_date = formData.end_date;
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save pattern'));
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
      aria-labelledby="pattern-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="pattern-modal-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="pattern-name" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="pattern-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="e.g., 24/48 Rotation"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="pattern-description" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Description
            </label>
            <textarea
              id="pattern-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={2}
              placeholder="Optional description"
            />
          </div>

          <div>
            <label htmlFor="pattern-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Pattern Type <span aria-hidden="true">*</span>
            </label>
            <select
              id="pattern-type"
              value={formData.pattern_type}
              onChange={(e) => setFormData(prev => ({ ...prev, pattern_type: e.target.value as PatternFormData['pattern_type'] }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
            >
              {PATTERN_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label} - {pt.description}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pattern-template" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Shift Template
            </label>
            <select
              id="pattern-template"
              value={formData.template_id}
              onChange={(e) => setFormData(prev => ({ ...prev, template_id: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            >
              <option value="">No template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.start_time_of_day} - {t.end_time_of_day})</option>
              ))}
            </select>
          </div>

          {(formData.pattern_type === 'platoon' || formData.pattern_type === 'custom') && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="pattern-rotation" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Rotation Days
                </label>
                <input
                  id="pattern-rotation"
                  type="number"
                  value={formData.rotation_days}
                  onChange={(e) => setFormData(prev => ({ ...prev, rotation_days: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                  min="1"
                  placeholder="e.g., 3"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-on" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Days On
                </label>
                <input
                  id="pattern-days-on"
                  type="number"
                  value={formData.days_on}
                  onChange={(e) => setFormData(prev => ({ ...prev, days_on: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                  min="1"
                  placeholder="e.g., 1"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-off" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Days Off
                </label>
                <input
                  id="pattern-days-off"
                  type="number"
                  value={formData.days_off}
                  onChange={(e) => setFormData(prev => ({ ...prev, days_off: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                  min="1"
                  placeholder="e.g., 2"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="pattern-start-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Start Date <span aria-hidden="true">*</span>
              </label>
              <input
                id="pattern-start-date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
              />
            </div>
            <div>
              <label htmlFor="pattern-end-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
                End Date
              </label>
              <input
                id="pattern-end-date"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
          </div>

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
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Pattern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Generate Shifts Modal
// ============================================

interface GenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  pattern: ShiftPattern | null;
}

const GenerateShiftsModal: React.FC<GenerateModalProps> = ({ isOpen, onClose, pattern }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStartDate('');
      setEndDate('');
    }
  }, [isOpen]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern) return;
    setIsGenerating(true);
    try {
      const result = await schedulingService.generateShiftsFromPattern(pattern.id, {
        pattern_id: pattern.id,
        start_date: startDate,
        end_date: endDate,
      });
      toast.success(`Generated ${String(result.shifts_created)} shifts`);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to generate shifts'));
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen || !pattern) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="generate-modal-title" className="text-xl font-bold text-theme-text-primary">Generate Shifts</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="p-6 space-y-4">
          <div className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
            <p className="text-sm text-theme-text-muted">Pattern</p>
            <p className="text-theme-text-primary font-medium">{pattern.name}</p>
            <p className="text-xs text-theme-text-muted mt-1">
              Type: {PATTERN_TYPES.find(pt => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
              {pattern.days_on && pattern.days_off && ` (${pattern.days_on} on / ${pattern.days_off} off)`}
            </p>
          </div>

          <div>
            <label htmlFor="generate-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Start Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
            />
          </div>

          <div>
            <label htmlFor="generate-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
              End Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
            />
          </div>

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
              disabled={isGenerating}
              className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {isGenerating ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4" aria-hidden="true" />
              )}
              {isGenerating ? 'Generating...' : 'Generate Shifts'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Main Page
// ============================================

export const ShiftTemplatesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('templates');
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);

  // Template modals
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Pattern modals
  const [showPatternModal, setShowPatternModal] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ShiftPattern | null>(null);
  const [deletingPatternId, setDeletingPatternId] = useState<string | null>(null);
  const [generatingPattern, setGeneratingPattern] = useState<ShiftPattern | null>(null);

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadTemplates(), loadPatterns()]);
    setLoading(false);
  }, [loadTemplates, loadPatterns]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Template handlers
  const handleCreateTemplate = async (data: Record<string, unknown>) => {
    await schedulingService.createTemplate(data);
    toast.success('Template created');
    loadTemplates();
  };

  const handleUpdateTemplate = async (data: Record<string, unknown>) => {
    if (!editingTemplate) return;
    await schedulingService.updateTemplate(editingTemplate.id, data);
    toast.success('Template updated');
    setEditingTemplate(null);
    loadTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      await schedulingService.deleteTemplate(id);
      toast.success('Template deleted');
      loadTemplates();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete template'));
    } finally {
      setDeletingTemplateId(null);
    }
  };

  // Pattern handlers
  const handleCreatePattern = async (data: Record<string, unknown>) => {
    await schedulingService.createPattern(data);
    toast.success('Pattern created');
    loadPatterns();
  };

  const handleUpdatePattern = async (data: Record<string, unknown>) => {
    if (!editingPattern) return;
    await schedulingService.updatePattern(editingPattern.id, data);
    toast.success('Pattern updated');
    setEditingPattern(null);
    loadPatterns();
  };

  const handleDeletePattern = async (id: string) => {
    setDeletingPatternId(id);
    try {
      await schedulingService.deletePattern(id);
      toast.success('Pattern deleted');
      loadPatterns();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete pattern'));
    } finally {
      setDeletingPatternId(null);
    }
  };

  const templateToForm = (t: ShiftTemplate): TemplateFormData => ({
    name: t.name,
    description: t.description || '',
    start_time_of_day: t.start_time_of_day,
    end_time_of_day: t.end_time_of_day,
    duration_hours: String(t.duration_hours),
    color: t.color || '#dc2626',
    min_staffing: String(t.min_staffing),
    is_default: t.is_default,
    positions: Array.isArray(t.positions) ? t.positions as string[] : [],
    category: (t.category as TemplateCategory) || 'standard',
    apparatus_type: t.apparatus_type || '',
  });

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
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
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
              <Filter className="w-4 h-4 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
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
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <LayoutTemplate className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Templates Yet</h3>
              <p className="text-theme-text-muted mb-4">Create a shift template to define reusable shift configurations</p>
              <button
                onClick={() => setShowTemplateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
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
                  className="bg-theme-surface-secondary rounded-lg p-5 border border-theme-surface-border"
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                          <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                          Default
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>

                  {template.description && (
                    <p className="text-sm text-theme-text-muted mb-3">{template.description}</p>
                  )}

                  <div className="grid grid-cols-2 gap-3 mb-3">
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

                  {/* Apparatus type (for specialty) */}
                  {template.apparatus_type && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Truck className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
                      <span className="text-xs text-theme-text-secondary capitalize font-medium">{template.apparatus_type}</span>
                    </div>
                  )}

                  {/* Positions */}
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
                            <span key={i} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-700 dark:text-red-400 rounded capitalize">
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
                      onClick={() => handleDeleteTemplate(template.id)}
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
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Repeat className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Patterns Yet</h3>
              <p className="text-theme-text-muted mb-4">Create a shift pattern to define recurring schedules</p>
              <button
                onClick={() => setShowPatternModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
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
                  className="bg-theme-surface-secondary rounded-lg p-5 border border-theme-surface-border"
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
                        {new Date(pattern.start_date).toLocaleDateString()}
                        {pattern.end_date && ` - ${new Date(pattern.end_date).toLocaleDateString()}`}
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
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
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
                      onClick={() => handleDeletePattern(pattern.id)}
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
      />

      <TemplateFormModal
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSubmit={handleUpdateTemplate}
        initialData={editingTemplate ? templateToForm(editingTemplate) : undefined}
        title="Edit Template"
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
