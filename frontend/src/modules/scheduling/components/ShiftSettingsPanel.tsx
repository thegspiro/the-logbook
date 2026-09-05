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
import { Truck, Users } from 'lucide-react';
import type { ShiftTemplateRecord, SchedulingFeatureSettings, PositionSlot } from '../services/api';
import { schedulingService } from '../services/api';
import { useSchedulingStore } from '../store/schedulingStore';
import type { ShiftSettings } from '../types/shiftSettings';
import { BUILTIN_POSITIONS } from '../types/shiftSettings';
import { getCachedShiftSettings, loadShiftSettings, shiftSettingsService } from '../services/shiftSettingsApi';
import type { SettingsTab } from './schedulingSettingsSections';
import { LOCALLY_SAVED_SECTIONS } from './schedulingSettingsSections';
import { SchedulingNotificationsPanel } from './SchedulingNotificationsPanel';
import { TemplatesOverviewCard } from './TemplatesOverviewCard';
import { ApparatusTypeDefaultsCard } from './ApparatusTypeDefaultsCard';
import { ResourceTypeDefaultsCard } from './ResourceTypeDefaultsCard';
import { DepartmentDefaultsCard } from './DepartmentDefaultsCard';
import { PositionNamesCard } from './PositionNamesCard';
import { CallTypesCard } from './CallTypesCard';
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
    positions?: PositionSlot[] | undefined;
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
      // Mirror into the store the rest of the app reads. `loadSettings` is a
      // once-per-session cache, so without this an admin who switched call
      // tracking on kept seeing the old close-out — which never asks for a
      // count — while the backend had already moved to count-only and would
      // finalize the shift with none recorded.
      useSchedulingStore.setState({
        platoonsEnabled: updated.platoons_enabled,
        requireEndOfShiftChecks: updated.require_end_of_shift_checks,
        callTrackingMode: updated.call_tracking?.mode || 'detailed',
        // Without this a rename shows the old label everywhere else in the
        // session — loadSettings is a once-per-session cache and will not
        // fetch again.
        callTypeLabels: Object.fromEntries((updated.call_tracking?.call_types ?? []).map((t) => [t.slug, t.label])),
        // `??`, not `||`: 0 means "closes exactly at the start", which `||`
        // would silently replace with the default.
        signupClosesMinutesBefore: updated.signup_closes_minutes_before ?? 0,
        lateSignupGraceMinutes: updated.late_signup_grace_minutes ?? 60,
        settingsLoaded: true,
      });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingFeature(false);
    }
  };

  // Paint immediately from the cached/mirrored value, then replace with the
  // department-wide copy from the backend. migrateLocal: this panel requires
  // scheduling.manage, so if the backend has never stored settings but this
  // browser has a mirror explicitly scoped to the current organization, that
  // copy is pushed up once. Untagged legacy copies are ignored.
  const [settings, setSettings] = useState<ShiftSettings>(() => getCachedShiftSettings());
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadShiftSettings({ migrateLocal: true });
      if (!cancelled) setSettings(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Normalize apparatus positions to flat strings for child components
  const normalizedApparatusList = useMemo(
    () =>
      apparatusList.map((a) => ({
        ...a,
        positions: a.positions?.map((p) => p.position),
      })),
    [apparatusList]
  );

  // All position options (built-in + custom)
  const allPositionOptions = useMemo(() => {
    const builtIn = BUILTIN_POSITIONS.map((p) => ({ ...p }));
    const custom = settings.customPositions.filter((cp) => !builtIn.some((bp) => bp.value === cp.value));
    return [...builtIn, ...custom];
  }, [settings.customPositions]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const persisted = await shiftSettingsService.saveShiftSettings(settings);
      setSettings(persisted);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const defaults = await shiftSettingsService.resetShiftSettings();
      setSettings(defaults);
    } catch {
      toast.error('Failed to reset settings');
    } finally {
      setSaving(false);
    }
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
                  <p className="text-theme-text-primary text-sm font-medium">Record a call count at close-out</p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    For departments that don&apos;t log individual incidents. The officer is asked how many calls the
                    apparatus ran when they close the shift out, and the crew&apos;s call credit comes from that number.
                    Leave this off to keep logging calls one at a time.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Record a call count at close-out"
                  aria-checked={feature.call_tracking?.mode === 'count_only'}
                  disabled={savingFeature}
                  onClick={() => {
                    const next = feature.call_tracking?.mode === 'count_only' ? 'detailed' : 'count_only';
                    // Send the existing type list back untouched: the payload
                    // replaces the whole call_tracking object, so omitting it
                    // would wipe the department's own call types.
                    void saveFeature({
                      call_tracking: { mode: next, call_types: feature.call_tracking?.call_types ?? [] },
                    });
                  }}
                  className={`toggle-track-sm ${
                    feature.call_tracking?.mode === 'count_only' ? 'bg-violet-600' : 'bg-theme-surface-border'
                  }`}
                >
                  <span
                    className={`toggle-knob-sm ${
                      feature.call_tracking?.mode === 'count_only' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="border-theme-surface-border/60 flex items-center justify-between gap-4 border-t pt-4">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">
                    Enforce EVOC for drivers
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                      Safety
                    </span>
                  </p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    Block assigning or signing up a driver who lacks the EVOC level their apparatus requires. A chief
                    can approve a time-boxed exception for parades and special events. Turning this off downgrades the
                    check to an advisory warning.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Enforce EVOC for drivers"
                  aria-checked={feature.enforce_evoc}
                  disabled={savingFeature}
                  onClick={() => {
                    void saveFeature({ enforce_evoc: !feature.enforce_evoc });
                  }}
                  className={`toggle-track-sm ${feature.enforce_evoc ? 'bg-violet-600' : 'bg-theme-surface-border'}`}
                >
                  <span className={`toggle-knob-sm ${feature.enforce_evoc ? 'translate-x-6' : 'translate-x-1'}`} />
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
          {feature && (
            <CallTypesCard
              types={feature.call_tracking?.call_types ?? []}
              usage={feature.call_type_usage ?? {}}
              locked={feature.call_type_locked ?? []}
              mode={feature.call_tracking?.mode ?? 'detailed'}
              saving={savingFeature}
              onSave={(call_types) =>
                saveFeature({
                  call_tracking: { mode: feature.call_tracking?.mode ?? 'detailed', call_types },
                })
              }
            />
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
              to="/scheduling/admin/platoons"
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
          {feature && (
            <div className="card space-y-4 p-5">
              <div>
                <h3 className="text-theme-text-primary text-base font-semibold">Signup window</h3>
                <p className="text-theme-text-muted mt-0.5 text-sm">
                  When a shift stops accepting people. A scheduling admin can always add someone, whatever these are set
                  to, and any officer can reopen one shift on the night.
                </p>
              </div>

              {/* Selects rather than number inputs on purpose: 0 is a
                  meaningful value here — it means "closes exactly at the
                  start" — so an admin who cleared a number field would
                  silently impose the tightest possible setting. */}
              <div className="border-theme-surface-border/60 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">Members can sign up until</p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    Signing up after a shift has gone out puts somebody on a crew they were never part of.
                  </p>
                </div>
                <select
                  aria-label="Members can sign up until"
                  disabled={savingFeature}
                  value={String(feature.signup_closes_minutes_before ?? 0)}
                  onChange={(e) => {
                    void saveFeature({ signup_closes_minutes_before: Number(e.target.value) });
                  }}
                  className="form-input w-56"
                >
                  <option value="0">The shift starts</option>
                  <option value="15">15 minutes before it starts</option>
                  <option value="30">30 minutes before it starts</option>
                  <option value="60">1 hour before it starts</option>
                  <option value="120">2 hours before it starts</option>
                  <option value="1440">1 day before it starts</option>
                </select>
              </div>

              <div className="border-theme-surface-border/60 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">Officers can add members until</p>
                  <p className="text-theme-text-muted mt-0.5 text-sm">
                    How long past the start an officer can still seat somebody who turned up. Past this, a scheduling
                    admin records it instead.
                  </p>
                </div>
                <select
                  aria-label="Officers can add members until"
                  disabled={savingFeature}
                  value={String(feature.late_signup_grace_minutes ?? 60)}
                  onChange={(e) => {
                    void saveFeature({ late_signup_grace_minutes: Number(e.target.value) });
                  }}
                  className="form-input w-56"
                >
                  <option value="0">The shift starts</option>
                  <option value="15">15 minutes after it starts</option>
                  <option value="30">30 minutes after it starts</option>
                  <option value="60">1 hour after it starts</option>
                  <option value="240">4 hours after it starts</option>
                  <option value="1440">1 day after it starts</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Notifications Tab ─── */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <SchedulingNotificationsPanel />
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
            onClick={() => {
              void handleReset();
            }}
            disabled={saving}
            className="text-theme-text-muted hover:text-theme-text-primary text-sm transition-colors disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-600 dark:text-green-400" role="status" aria-live="polite">
                Settings saved
              </span>
            )}
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShiftSettingsPanel;
