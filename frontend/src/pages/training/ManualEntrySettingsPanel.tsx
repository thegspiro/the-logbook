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
          schedulingService.getApparatusOptions().then((r) => r.options.filter((o) => o.source !== 'default')),
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
      const result = await trainingModuleConfigService.updateConfig(updates);
      setConfig(result);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  }, [enabled, requireApparatus, selectedApparatusIds, defaultStartTime, defaultDuration]);

  const toggleApparatus = (id: string) => {
    setSelectedApparatusIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">Manual Shift Entry</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Configure the manual shift report form for departments without the scheduling module.
          </p>
        </div>
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 sm:self-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
      </div>

      {/* Enable toggle */}
      <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="border-theme-surface-border rounded text-violet-600 focus:ring-violet-500"
          />
          <div>
            <span className="text-theme-text-primary text-sm font-medium">Enable Manual Shift Entry</span>
            <p className="text-theme-text-muted text-xs">
              Allow officers to log shift hours without linking to a shift record.
            </p>
          </div>
        </label>
      </div>

      {enabled && (
        <>
          {/* Apparatus configuration */}
          <div className="bg-theme-surface border-theme-surface-border space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Truck className="text-theme-text-muted h-4 w-4" />
              <h4 className="text-theme-text-primary text-sm font-medium">Apparatus</h4>
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={requireApparatus}
                onChange={(e) => setRequireApparatus(e.target.checked)}
                className="border-theme-surface-border rounded text-violet-600 focus:ring-violet-500"
              />
              <span className="text-theme-text-secondary text-sm">Require apparatus selection on the form</span>
            </label>

            <div>
              <p className="text-theme-text-secondary mb-2 text-sm">
                Select which apparatus are available for manual entry. Leave all unchecked to allow any active
                apparatus.
              </p>
              {allApparatus.length === 0 ? (
                <p className="text-theme-text-muted py-2 text-sm">
                  No apparatus configured. Add apparatus in the scheduling settings.
                </p>
              ) : (
                <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {allApparatus.map((a) => (
                    <label
                      key={a.id || a.name}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        selectedApparatusIds.has(a.id || '')
                          ? 'border-violet-500/40 bg-violet-500/5'
                          : 'border-theme-surface-border hover:bg-theme-surface-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedApparatusIds.has(a.id || '')}
                        onChange={() => toggleApparatus(a.id || '')}
                        className="border-theme-surface-border rounded text-violet-600 focus:ring-violet-500"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-theme-text-primary text-sm">{a.name}</span>
                        {a.unit_number && (
                          <span className="text-theme-text-muted ml-1.5 text-xs">({a.unit_number})</span>
                        )}
                        <span className="text-theme-text-muted block text-xs capitalize">{a.apparatus_type}</span>
                      </div>
                      {selectedApparatusIds.has(a.id || '') && <Check className="h-4 w-4 shrink-0 text-violet-500" />}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Default times */}
          <div className="bg-theme-surface border-theme-surface-border space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Clock className="text-theme-text-muted h-4 w-4" />
              <h4 className="text-theme-text-primary text-sm font-medium">Default Shift Times</h4>
            </div>
            <p className="text-theme-text-muted text-sm">
              Pre-fill the start time and shift duration to speed up data entry. Officers can always override these.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Default Start Time</label>
                <input
                  type="time"
                  value={defaultStartTime}
                  onChange={(e) => setDefaultStartTime(e.target.value)}
                  className="form-input text-sm focus:ring-violet-500"
                  placeholder="e.g. 08:00"
                />
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                  Default Shift Duration (hours)
                </label>
                <input
                  type="number"
                  min="0.5"
                  max="48"
                  step="0.5"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(parseFloat(e.target.value) || '')}
                  className="form-input text-sm focus:ring-violet-500"
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
