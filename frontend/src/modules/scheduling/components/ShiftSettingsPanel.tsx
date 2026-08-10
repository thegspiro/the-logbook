/**
 * Shift Settings Panel
 *
 * Body of one department-wide scheduling settings section. The section list,
 * the nav that selects between them, and the page chrome belong to
 * SchedulingSettingsPage — this holds the settings state the sections share and
 * delegates rendering to focused card components.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ClipboardCheck, Truck, Users } from 'lucide-react';
import type { ShiftTemplateRecord, SchedulingFeatureSettings } from '../services/api';
import { schedulingService } from '../services/api';
import { useSchedulingStore } from '../store/schedulingStore';
import type { ShiftSettings } from '../types/shiftSettings';
import { BUILTIN_POSITIONS, DEFAULT_SETTINGS, SETTINGS_KEY } from '../types/shiftSettings';
import type { SettingsTab } from './schedulingSettingsSections';
import { LOCALLY_SAVED_SECTIONS } from './schedulingSettingsSections';
import { SchedulingNotificationsPanel } from './SchedulingNotificationsPanel';
import { TemplatesOverviewCard } from './TemplatesOverviewCard';
import { ApparatusTypeDefaultsCard } from './ApparatusTypeDefaultsCard';
import { ResourceTypeDefaultsCard } from './ResourceTypeDefaultsCard';
import { DepartmentDefaultsCard } from './DepartmentDefaultsCard';
import { PositionNamesCard } from './PositionNamesCard';
import { EquipmentCheckTemplateList } from './EquipmentCheckTemplateList';
import { EligibilitySettingsCard } from './EligibilitySettingsCard';
import { ShiftReportsSettingsPanel } from './ShiftReportsSettingsPanel';
import { PlatoonRosterPanel } from './PlatoonRosterPanel';

// ─── Component ──────────────────────────────────────────────────────────────

interface ShiftSettingsPanelProps {
  templates: ShiftTemplateRecord[];
  apparatusList: Array<{
    id: string;
    name: string;
    unit_number: string;
    apparatus_type: string;
    positions?: Array<string | { position: string; required?: boolean }> | undefined;
  }>;
  onNavigateToTemplates: () => void;
  /** Section to render. Owned by the page so it can mirror it into the URL. */
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export const ShiftSettingsPanel: React.FC<ShiftSettingsPanelProps> = ({
  templates,
  apparatusList,
  onNavigateToTemplates,
  activeTab,
  onTabChange,
}) => {
  const platoonsEnabled = useSchedulingStore((s) => s.platoonsEnabled);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const setPlatoonsEnabled = useSchedulingStore((s) => s.setPlatoonsEnabled);
  const [savingPlatoonToggle, setSavingPlatoonToggle] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleTogglePlatoons = async (enabled: boolean) => {
    setSavingPlatoonToggle(true);
    try {
      await schedulingService.updateFeatureSettings({ platoons_enabled: enabled });
      setPlatoonsEnabled(enabled);
      toast.success(`Platoon scheduling ${enabled ? 'enabled' : 'disabled'}`);
      if (!enabled && activeTab === 'platoons') onTabChange('general');
    } catch {
      toast.error('Failed to update platoon setting');
    } finally {
      setSavingPlatoonToggle(false);
    }
  };

  // Department feature settings (overtime advisory + auto-generation).
  const [feature, setFeature] = useState<SchedulingFeatureSettings | null>(null);
  const [savingFeature, setSavingFeature] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fs = await schedulingService.getFeatureSettings();
        if (!cancelled) setFeature(fs);
      } catch {
        // Non-critical — the panel still renders the local template settings.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveFeature = async (patch: Partial<SchedulingFeatureSettings>) => {
    setSavingFeature(true);
    try {
      const updated = await schedulingService.updateFeatureSettings(patch);
      setFeature(updated);
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingFeature(false);
    }
  };

  const [settings, setSettings] = useState<ShiftSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored
        ? {
            ...DEFAULT_SETTINGS,
            ...(JSON.parse(stored) as Partial<ShiftSettings>),
          }
        : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [saved, setSaved] = useState(false);

  // Normalize apparatus positions to flat strings for child components
  const normalizedApparatusList = useMemo(
    () =>
      apparatusList.map((a) => ({
        ...a,
        positions: a.positions?.map((p) => (typeof p === 'string' ? p : p.position)),
      })),
    [apparatusList]
  );

  // All position options (built-in + custom)
  const allPositionOptions = useMemo(() => {
    const builtIn = BUILTIN_POSITIONS.map((p) => ({ ...p }));
    const custom = settings.customPositions.filter((cp) => !builtIn.some((bp) => bp.value === cp.value));
    return [...builtIn, ...custom];
  }, [settings.customPositions]);

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(SETTINGS_KEY);
  };

  return (
    <div className="space-y-6">
      {/* ─── General Tab ─── */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          <div className="card-secondary p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
                  <Users className="h-4 w-4" /> Platoon Scheduling
                </h3>
                <p className="text-theme-text-muted mt-1 text-sm">
                  Enable platoon (A/B/C) rotations: assign members to platoons, build shifts per platoon, and show
                  platoon rosters on shifts.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={platoonsEnabled}
                disabled={savingPlatoonToggle}
                onClick={() => {
                  void handleTogglePlatoons(!platoonsEnabled);
                }}
                className={`toggle-track-sm ${platoonsEnabled ? 'bg-violet-600' : 'bg-theme-surface-border'}`}
              >
                <span className={`toggle-knob-sm ${platoonsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {feature && (
            <div className="card-secondary p-5">
              <h3 className="text-theme-text-primary text-base font-semibold">Overtime advisory</h3>
              <p className="text-theme-text-muted mt-1 text-sm">
                Warn (without blocking) when assigning a member whose scheduled hours in a trailing window exceed a
                limit. Set the limit to 0 to turn this off.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <span className="text-theme-text-secondary mb-1 block text-xs font-medium">Hours limit</span>
                  <input
                    type="number"
                    min="0"
                    max="336"
                    step="1"
                    value={feature.max_hours_per_window ?? 0}
                    onChange={(e) => setFeature({ ...feature, max_hours_per_window: Number(e.target.value) })}
                    className="form-input w-28"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-theme-text-secondary mb-1 block text-xs font-medium">Window (days)</span>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    value={feature.hours_window_days}
                    onChange={(e) => setFeature({ ...feature, hours_window_days: Number(e.target.value) })}
                    className="form-input w-28"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingFeature}
                  onClick={() => {
                    void saveFeature({
                      max_hours_per_window: feature.max_hours_per_window ?? 0,
                      hours_window_days: feature.hours_window_days,
                    });
                  }}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {feature && (
            <div className="card-secondary p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-theme-text-primary text-base font-semibold">Automatic shift generation</h3>
                  <p className="text-theme-text-muted mt-1 text-sm">
                    Keep active patterns generating shifts ahead automatically, so upcoming shifts appear without
                    pressing “generate”.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.auto_generate_enabled}
                  disabled={savingFeature}
                  onClick={() => {
                    void saveFeature({ auto_generate_enabled: !feature.auto_generate_enabled });
                  }}
                  className={`toggle-track-sm ${
                    feature.auto_generate_enabled ? 'bg-violet-600' : 'bg-theme-surface-border'
                  }`}
                >
                  <span
                    className={`toggle-knob-sm ${feature.auto_generate_enabled ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
              {feature.auto_generate_enabled && (
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <label className="text-sm">
                    <span className="text-theme-text-secondary mb-1 block text-xs font-medium">Weeks ahead</span>
                    <input
                      type="number"
                      min="1"
                      max="52"
                      step="1"
                      value={feature.auto_generate_weeks}
                      onChange={(e) => setFeature({ ...feature, auto_generate_weeks: Number(e.target.value) })}
                      className="form-input w-28"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={savingFeature}
                    onClick={() => {
                      void saveFeature({ auto_generate_weeks: feature.auto_generate_weeks });
                    }}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {feature && (
            <div className="card-secondary space-y-4 p-5">
              <h3 className="text-theme-text-primary text-base font-semibold">Shift close-out rules</h3>
              {!feature.require_end_of_shift_checks && (
                <div className="text-theme-text-secondary rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm">
                  <p className="font-medium text-sky-700 dark:text-sky-300">
                    Tip: require end-of-shift checks before finalizing
                  </p>
                  <p className="mt-0.5">
                    It&apos;s off by default. Turning it on makes sure every apparatus is verified ready at the end of
                    each shift, documents accountability, and keeps equipment-compliance records complete — officers can
                    still override with a logged reason when needed.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                    Require end-of-shift equipment checks
                    <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-300">
                      Recommended
                    </span>
                  </p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    Block finalizing a shift while any end-of-shift check is outstanding. Officers can still override
                    with a logged reason.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.require_end_of_shift_checks}
                  disabled={savingFeature}
                  onClick={() => {
                    void saveFeature({ require_end_of_shift_checks: !feature.require_end_of_shift_checks });
                  }}
                  className={`toggle-track-sm ${
                    feature.require_end_of_shift_checks ? 'bg-violet-600' : 'bg-theme-surface-border'
                  }`}
                >
                  <span
                    className={`toggle-knob-sm ${
                      feature.require_end_of_shift_checks ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="border-theme-surface-border/60 flex items-center justify-between gap-4 border-t pt-4">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">Restrict check-in to assigned members</p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    Only members rostered on a shift can check in (open shifts are exempt), so attendance matches the
                    crew.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.restrict_checkin_to_assigned}
                  disabled={savingFeature}
                  onClick={() => {
                    void saveFeature({ restrict_checkin_to_assigned: !feature.restrict_checkin_to_assigned });
                  }}
                  className={`toggle-track-sm ${
                    feature.restrict_checkin_to_assigned ? 'bg-violet-600' : 'bg-theme-surface-border'
                  }`}
                >
                  <span
                    className={`toggle-knob-sm ${
                      feature.restrict_checkin_to_assigned ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
          <TemplatesOverviewCard templates={templates} onNavigateToTemplates={onNavigateToTemplates} />
          <DepartmentDefaultsCard settings={settings} onSettingsChange={setSettings} />
          <PositionNamesCard
            settings={settings}
            onSettingsChange={setSettings}
            allPositionOptions={allPositionOptions}
          />
        </div>
      )}

      {/* ─── Apparatus Tab ─── */}
      {activeTab === 'apparatus' && (
        <div className="space-y-6">
          <ApparatusTypeDefaultsCard
            settings={settings}
            onSettingsChange={setSettings}
            allPositionOptions={allPositionOptions}
            apparatusList={normalizedApparatusList}
          />
          <ResourceTypeDefaultsCard
            settings={settings}
            onSettingsChange={setSettings}
            allPositionOptions={allPositionOptions}
          />

          {/* Apparatus Inventory */}
          <div className="card-secondary p-5">
            <h3 className="text-theme-text-primary mb-3 text-base font-semibold">Apparatus Inventory</h3>
            {normalizedApparatusList.length === 0 ? (
              <p className="text-theme-text-muted text-sm">
                No apparatus configured. Shifts can be created without apparatus assignment.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {normalizedApparatusList.map((a) => (
                  <div key={a.id} className="bg-theme-surface-hover/50 flex items-center gap-3 rounded-lg p-3">
                    <Truck className="h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-sm font-medium">
                        {a.unit_number} — {a.name}
                      </p>
                      <p className="text-theme-text-muted text-xs capitalize">{a.apparatus_type}</p>
                      {a.positions && a.positions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.positions.map((pos, i) => (
                            <span
                              key={i}
                              className="rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-700 capitalize dark:text-red-400"
                            >
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Platoons Tab ─── */}
      {activeTab === 'platoons' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Link
              to="/scheduling/platoons"
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
            >
              <Users className="h-4 w-4" /> Department platoon overview
            </Link>
          </div>
          <PlatoonRosterPanel />
        </div>
      )}

      {/* ─── Eligibility Tab ─── */}
      {activeTab === 'eligibility' && (
        <div className="space-y-6">
          <EligibilitySettingsCard />
        </div>
      )}

      {/* ─── Notifications Tab ─── */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <SchedulingNotificationsPanel />
        </div>
      )}

      {/* ─── Equipment Tab ─── */}
      {activeTab === 'equipment' && (
        <div className="space-y-6">
          <div className="card-secondary p-5">
            <h3 className="text-theme-text-primary mb-3 flex items-center gap-2 text-base font-semibold">
              <ClipboardCheck className="h-4 w-4" /> Equipment Checks
            </h3>
            <p className="text-theme-text-muted mb-4 text-sm">
              Configure equipment check requirements for shift start and end.
            </p>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.equipmentCheckSettings?.enabled ?? false}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      equipmentCheckSettings: {
                        ...s.equipmentCheckSettings,
                        enabled: e.target.checked,
                      },
                    }))
                  }
                  className="form-checkbox"
                />
                <span className="text-theme-text-primary text-sm">Enable equipment checks for shifts</span>
              </label>

              {settings.equipmentCheckSettings?.enabled && (
                <>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.equipmentCheckSettings?.requireSignature ?? false}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            requireSignature: e.target.checked,
                          },
                        }))
                      }
                      className="form-checkbox"
                    />
                    <span className="text-theme-text-primary text-sm">Require signature on completion</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.equipmentCheckSettings?.blockShiftStartOnFail ?? false}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            blockShiftStartOnFail: e.target.checked,
                          },
                        }))
                      }
                      className="form-checkbox"
                    />
                    <span className="text-theme-text-primary text-sm">Block shift start when required items fail</span>
                  </label>

                  <div>
                    <label className="text-theme-text-primary mb-1 block text-sm">
                      Default expiration warning (days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={settings.equipmentCheckSettings?.defaultExpirationWarningDays ?? 30}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            defaultExpirationWarningDays: parseInt(e.target.value, 10) || 30,
                          },
                        }))
                      }
                      className="form-input w-24"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <EquipmentCheckTemplateList />
        </div>
      )}

      {/* ─── Shift Reports Tab ─── */}
      {activeTab === 'shift-reports' && (
        <div className="space-y-6">
          <ShiftReportsSettingsPanel />
        </div>
      )}

      {/* Save Actions — only on the sections this button actually writes. */}
      {LOCALLY_SAVED_SECTIONS.includes(activeTab) && (
        <div className="border-theme-surface-border flex items-center justify-between border-t pt-4">
          <button
            onClick={handleReset}
            className="text-theme-text-muted hover:text-theme-text-primary text-sm transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-600 dark:text-green-400" role="status" aria-live="polite">
                Settings saved
              </span>
            )}
            <button onClick={handleSave} className="btn-primary px-6 py-2 text-sm">
              Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShiftSettingsPanel;
