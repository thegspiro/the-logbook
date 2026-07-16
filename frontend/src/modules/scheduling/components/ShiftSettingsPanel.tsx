/**
 * Shift Settings Panel
 *
 * Department-wide scheduling settings organized into tabbed sections:
 * General, Apparatus, Notifications, and Equipment.
 *
 * This is a thin orchestrator that manages the top-level settings state and
 * delegates rendering to focused card components.
 */

import React, { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Settings,
  Truck,
  ClipboardCheck,
  Bell,
  LayoutTemplate,
  Shield,
  FileBarChart,
  Users,
} from "lucide-react";
import type { ShiftTemplateRecord, SchedulingFeatureSettings } from "../services/api";
import { schedulingService } from "../services/api";
import { useSchedulingStore } from "../store/schedulingStore";
import type { ShiftSettings } from "../types/shiftSettings";
import {
  BUILTIN_POSITIONS,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
} from "../types/shiftSettings";
import { SchedulingNotificationsPanel } from "./SchedulingNotificationsPanel";
import { TemplatesOverviewCard } from "./TemplatesOverviewCard";
import { ApparatusTypeDefaultsCard } from "./ApparatusTypeDefaultsCard";
import { ResourceTypeDefaultsCard } from "./ResourceTypeDefaultsCard";
import { DepartmentDefaultsCard } from "./DepartmentDefaultsCard";
import { PositionNamesCard } from "./PositionNamesCard";
import { EquipmentCheckTemplateList } from "./EquipmentCheckTemplateList";
import { EligibilitySettingsCard } from "./EligibilitySettingsCard";
import { ShiftReportsSettingsPanel } from "./ShiftReportsSettingsPanel";
import { PlatoonRosterPanel } from "./PlatoonRosterPanel";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SettingsTab = "general" | "apparatus" | "platoons" | "notifications" | "equipment" | "eligibility" | "shift-reports";

const SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "general", label: "General", icon: LayoutTemplate },
  { id: "apparatus", label: "Apparatus", icon: Truck },
  { id: "platoons", label: "Platoons", icon: Users },
  { id: "eligibility", label: "Eligibility", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "equipment", label: "Equipment", icon: ClipboardCheck },
  { id: "shift-reports", label: "Shift Reports", icon: FileBarChart },
];

// ─── Component ──────────────────────────────────────────────────────────────

interface ShiftSettingsPanelProps {
  templates: ShiftTemplateRecord[];
  apparatusList: Array<{
    id: string;
    name: string;
    unit_number: string;
    apparatus_type: string;
    positions?:
      | Array<string | { position: string; required?: boolean }>
      | undefined;
  }>;
  onNavigateToTemplates: () => void;
  defaultTab?: SettingsTab | undefined;
}

export const ShiftSettingsPanel: React.FC<ShiftSettingsPanelProps> = ({
  templates,
  apparatusList,
  onNavigateToTemplates,
  defaultTab,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab || "general");
  const platoonsEnabled = useSchedulingStore((s) => s.platoonsEnabled);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const setPlatoonsEnabled = useSchedulingStore((s) => s.setPlatoonsEnabled);
  const [savingPlatoonToggle, setSavingPlatoonToggle] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Hide the Platoons tab unless the department has enabled platoon scheduling.
  const visibleTabs = SETTINGS_TABS.filter(
    (t) => t.id !== "platoons" || platoonsEnabled,
  );

  const handleTogglePlatoons = async (enabled: boolean) => {
    setSavingPlatoonToggle(true);
    try {
      await schedulingService.updateFeatureSettings({ platoons_enabled: enabled });
      setPlatoonsEnabled(enabled);
      toast.success(`Platoon scheduling ${enabled ? "enabled" : "disabled"}`);
      if (!enabled && activeTab === "platoons") setActiveTab("general");
    } catch {
      toast.error("Failed to update platoon setting");
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
    return () => { cancelled = true; };
  }, []);

  const saveFeature = async (patch: Partial<SchedulingFeatureSettings>) => {
    setSavingFeature(true);
    try {
      const updated = await schedulingService.updateFeatureSettings(patch);
      setFeature(updated);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
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
        positions: a.positions?.map((p) =>
          typeof p === "string" ? p : p.position,
        ),
      })),
    [apparatusList],
  );

  // All position options (built-in + custom)
  const allPositionOptions = useMemo(() => {
    const builtIn = BUILTIN_POSITIONS.map((p) => ({ ...p }));
    const custom = settings.customPositions.filter(
      (cp) => !builtIn.some((bp) => bp.value === cp.value),
    );
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
          <Settings className="w-5 h-5" /> Shift Settings
        </h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure department-wide defaults for shift scheduling.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-theme-surface-hover/50 rounded-lg overflow-x-auto">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-theme-surface text-theme-text-primary shadow-sm"
                  : "text-theme-text-muted hover:text-theme-text-secondary"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── General Tab ─── */}
      {activeTab === "general" && (
        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                  <Users className="w-4 h-4" /> Platoon Scheduling
                </h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  Enable platoon (A/B/C) rotations: assign members to platoons,
                  build shifts per platoon, and show platoon rosters on shifts.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={platoonsEnabled}
                disabled={savingPlatoonToggle}
                onClick={() => { void handleTogglePlatoons(!platoonsEnabled); }}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  platoonsEnabled ? "bg-violet-600" : "bg-theme-surface-border"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    platoonsEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {feature && (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
              <h3 className="text-base font-semibold text-theme-text-primary">
                Overtime advisory
              </h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Warn (without blocking) when assigning a member whose scheduled
                hours in a trailing window exceed a limit. Set the limit to 0 to
                turn this off.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <span className="block text-xs font-medium text-theme-text-secondary mb-1">Hours limit</span>
                  <input
                    type="number" min="0" max="336" step="1"
                    value={feature.max_hours_per_window ?? 0}
                    onChange={(e) => setFeature({ ...feature, max_hours_per_window: Number(e.target.value) })}
                    className="form-input w-28"
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-xs font-medium text-theme-text-secondary mb-1">Window (days)</span>
                  <input
                    type="number" min="1" max="31" step="1"
                    value={feature.hours_window_days}
                    onChange={(e) => setFeature({ ...feature, hours_window_days: Number(e.target.value) })}
                    className="form-input w-28"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingFeature}
                  onClick={() => { void saveFeature({ max_hours_per_window: feature.max_hours_per_window ?? 0, hours_window_days: feature.hours_window_days }); }}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {feature && (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-theme-text-primary">
                    Automatic shift generation
                  </h3>
                  <p className="text-sm text-theme-text-muted mt-1">
                    Keep active patterns generating shifts ahead automatically,
                    so upcoming shifts appear without pressing “generate”.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.auto_generate_enabled}
                  disabled={savingFeature}
                  onClick={() => { void saveFeature({ auto_generate_enabled: !feature.auto_generate_enabled }); }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    feature.auto_generate_enabled ? "bg-violet-600" : "bg-theme-surface-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      feature.auto_generate_enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              {feature.auto_generate_enabled && (
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <label className="text-sm">
                    <span className="block text-xs font-medium text-theme-text-secondary mb-1">Weeks ahead</span>
                    <input
                      type="number" min="1" max="52" step="1"
                      value={feature.auto_generate_weeks}
                      onChange={(e) => setFeature({ ...feature, auto_generate_weeks: Number(e.target.value) })}
                      className="form-input w-28"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={savingFeature}
                    onClick={() => { void saveFeature({ auto_generate_weeks: feature.auto_generate_weeks }); }}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {feature && (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 space-y-4">
              <h3 className="text-base font-semibold text-theme-text-primary">
                Shift close-out rules
              </h3>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-theme-text-primary">
                    Require end-of-shift equipment checks
                  </p>
                  <p className="text-sm text-theme-text-muted mt-0.5">
                    Block finalizing a shift while any end-of-shift check is
                    outstanding. Officers can still override with a logged reason.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.require_end_of_shift_checks}
                  disabled={savingFeature}
                  onClick={() => { void saveFeature({ require_end_of_shift_checks: !feature.require_end_of_shift_checks }); }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    feature.require_end_of_shift_checks ? "bg-violet-600" : "bg-theme-surface-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      feature.require_end_of_shift_checks ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-theme-surface-border/60 pt-4">
                <div>
                  <p className="text-sm font-medium text-theme-text-primary">
                    Restrict check-in to assigned members
                  </p>
                  <p className="text-sm text-theme-text-muted mt-0.5">
                    Only members rostered on a shift can check in (open shifts
                    are exempt), so attendance matches the crew.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.restrict_checkin_to_assigned}
                  disabled={savingFeature}
                  onClick={() => { void saveFeature({ restrict_checkin_to_assigned: !feature.restrict_checkin_to_assigned }); }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    feature.restrict_checkin_to_assigned ? "bg-violet-600" : "bg-theme-surface-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      feature.restrict_checkin_to_assigned ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
          <TemplatesOverviewCard
            templates={templates}
            onNavigateToTemplates={onNavigateToTemplates}
          />
          <DepartmentDefaultsCard
            settings={settings}
            onSettingsChange={setSettings}
          />
          <PositionNamesCard
            settings={settings}
            onSettingsChange={setSettings}
            allPositionOptions={allPositionOptions}
          />
        </div>
      )}

      {/* ─── Apparatus Tab ─── */}
      {activeTab === "apparatus" && (
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
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-theme-text-primary mb-3">
              Apparatus Inventory
            </h3>
            {normalizedApparatusList.length === 0 ? (
              <p className="text-sm text-theme-text-muted">
                No apparatus configured. Shifts can be created without apparatus
                assignment.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {normalizedApparatusList.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg"
                  >
                    <Truck className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-text-primary truncate">
                        {a.unit_number} — {a.name}
                      </p>
                      <p className="text-xs text-theme-text-muted capitalize">
                        {a.apparatus_type}
                      </p>
                      {a.positions && a.positions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {a.positions.map((pos, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 rounded-sm capitalize"
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
      {activeTab === "platoons" && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Link
              to="/scheduling/platoons"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              <Users className="w-4 h-4" /> Department platoon overview
            </Link>
          </div>
          <PlatoonRosterPanel />
        </div>
      )}

      {/* ─── Eligibility Tab ─── */}
      {activeTab === "eligibility" && (
        <div className="space-y-6">
          <EligibilitySettingsCard />
        </div>
      )}

      {/* ─── Notifications Tab ─── */}
      {activeTab === "notifications" && (
        <div className="space-y-6">
          <SchedulingNotificationsPanel />
        </div>
      )}

      {/* ─── Equipment Tab ─── */}
      {activeTab === "equipment" && (
        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" /> Equipment Checks
            </h3>
            <p className="text-sm text-theme-text-muted mb-4">
              Configure equipment check requirements for shift start and end.
            </p>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
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
                  className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                />
                <span className="text-sm text-theme-text-primary">
                  Enable equipment checks for shifts
                </span>
              </label>

              {settings.equipmentCheckSettings?.enabled && (
                <>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        settings.equipmentCheckSettings?.requireSignature ??
                        false
                      }
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            requireSignature: e.target.checked,
                          },
                        }))
                      }
                      className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                    />
                    <span className="text-sm text-theme-text-primary">
                      Require signature on completion
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        settings.equipmentCheckSettings
                          ?.blockShiftStartOnFail ?? false
                      }
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            blockShiftStartOnFail: e.target.checked,
                          },
                        }))
                      }
                      className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                    />
                    <span className="text-sm text-theme-text-primary">
                      Block shift start when required items fail
                    </span>
                  </label>

                  <div>
                    <label className="block text-sm text-theme-text-primary mb-1">
                      Default expiration warning (days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={
                        settings.equipmentCheckSettings
                          ?.defaultExpirationWarningDays ?? 30
                      }
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          equipmentCheckSettings: {
                            ...s.equipmentCheckSettings,
                            defaultExpirationWarningDays:
                              parseInt(e.target.value, 10) || 30,
                          },
                        }))
                      }
                      className="w-24 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
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
      {activeTab === "shift-reports" && (
        <div className="space-y-6">
          <ShiftReportsSettingsPanel />
        </div>
      )}

      {/* Save Actions — visible on all tabs */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleReset}
          className="text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
        >
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Settings saved
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftSettingsPanel;
