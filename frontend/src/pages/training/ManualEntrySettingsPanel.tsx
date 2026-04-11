/**
 * Manual Entry Settings Panel
 *
 * Admin configuration for the manual shift report feature.
 * Controls which apparatus are available for selection,
 * default start time, and default shift duration.
 *
 * Rendered as a tab/section within the Training Admin page
 * when the scheduling module is disabled.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Truck, Clock, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingModuleConfigService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ApparatusOption } from '../../modules/scheduling/services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import type { TrainingModuleConfig } from '../../types/training';

export const ManualEntrySettingsPanel: React.FC = () => {
  const [, setConfig] = useState<TrainingModuleConfig | null>(null);
  const [allApparatus, setAllApparatus] = useState<ApparatusOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [requireApparatus, setRequireApparatus] = useState(true);
  const [selectedApparatusIds, setSelectedApparatusIds] = useState<Set<string>>(new Set());
  const [defaultStartTime, setDefaultStartTime] = useState('');
  const [defaultDuration, setDefaultDuration] = useState<number | ''>('');

  useEffect(() => {
    const load = async () => {
      try {
        const [cfg, apparatus] = await Promise.all([
          trainingModuleConfigService.getConfig(),
          schedulingService.getApparatusOptions().then(r => r.options.filter(o => o.source !== 'default')),
        ]);
        setConfig(cfg);
        setAllApparatus(apparatus);
        setEnabled(cfg.manual_entry_enabled);
        setRequireApparatus(cfg.manual_entry_require_apparatus);
        setSelectedApparatusIds(new Set(cfg.manual_entry_apparatus_ids || []));
        setDefaultStartTime(cfg.manual_entry_default_start_time || '');
        setDefaultDuration(cfg.manual_entry_default_duration_hours || '');
      } catch {
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        manual_entry_enabled: enabled,
        manual_entry_require_apparatus: requireApparatus,
      };
      if (selectedApparatusIds.size > 0) {
        updates.manual_entry_apparatus_ids = Array.from(selectedApparatusIds);
      }
      if (defaultStartTime) {
        updates.manual_entry_default_start_time = defaultStartTime;
      }
      if (typeof defaultDuration === 'number' && defaultDuration > 0) {
        updates.manual_entry_default_duration_hours = defaultDuration;
      }
      const result = await trainingModuleConfigService.updateConfig(
        updates as Partial<TrainingModuleConfig>,
      );
      setConfig(result);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  }, [enabled, requireApparatus, selectedApparatusIds, defaultStartTime, defaultDuration]);

  const toggleApparatus = (id: string) => {
    setSelectedApparatusIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Manual Shift Entry</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Configure the manual shift report form for departments without the scheduling module.
          </p>
        </div>
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>

      {/* Enable toggle */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
          />
          <div>
            <span className="text-sm font-medium text-theme-text-primary">Enable Manual Shift Entry</span>
            <p className="text-xs text-theme-text-muted">
              Allow officers to log shift hours without linking to a shift record.
            </p>
          </div>
        </label>
      </div>

      {enabled && (
        <>
          {/* Apparatus configuration */}
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-theme-text-muted" />
              <h4 className="text-sm font-medium text-theme-text-primary">Apparatus</h4>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireApparatus}
                onChange={e => setRequireApparatus(e.target.checked)}
                className="rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm text-theme-text-secondary">Require apparatus selection on the form</span>
            </label>

            <div>
              <p className="text-sm text-theme-text-secondary mb-2">
                Select which apparatus are available for manual entry.
                Leave all unchecked to allow any active apparatus.
              </p>
              {allApparatus.length === 0 ? (
                <p className="text-sm text-theme-text-muted py-2">
                  No apparatus configured. Add apparatus in the scheduling settings.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {allApparatus.map(a => (
                    <label
                      key={a.id || a.name}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedApparatusIds.has(a.id || '')
                          ? 'border-violet-500/40 bg-violet-500/5'
                          : 'border-theme-surface-border hover:bg-theme-surface-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedApparatusIds.has(a.id || '')}
                        onChange={() => toggleApparatus(a.id || '')}
                        className="rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-theme-text-primary">{a.name}</span>
                        {a.unit_number && (
                          <span className="ml-1.5 text-xs text-theme-text-muted">({a.unit_number})</span>
                        )}
                        <span className="block text-xs text-theme-text-muted capitalize">{a.apparatus_type}</span>
                      </div>
                      {selectedApparatusIds.has(a.id || '') && (
                        <Check className="w-4 h-4 text-violet-500 shrink-0" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Default times */}
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-theme-text-muted" />
              <h4 className="text-sm font-medium text-theme-text-primary">Default Shift Times</h4>
            </div>
            <p className="text-sm text-theme-text-muted">
              Pre-fill the start time and shift duration to speed up data entry. Officers can always override these.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Default Start Time</label>
                <input
                  type="time"
                  value={defaultStartTime}
                  onChange={e => setDefaultStartTime(e.target.value)}
                  className="form-input focus:ring-violet-500 text-sm"
                  placeholder="e.g. 08:00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Default Shift Duration (hours)</label>
                <input
                  type="number"
                  min="0.5"
                  max="48"
                  step="0.5"
                  value={defaultDuration}
                  onChange={e => setDefaultDuration(parseFloat(e.target.value) || '')}
                  className="form-input focus:ring-violet-500 text-sm"
                  placeholder="e.g. 24"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ManualEntrySettingsPanel;
