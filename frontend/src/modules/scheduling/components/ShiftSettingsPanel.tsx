/**
 * Shift Settings Panel
 *
 * Department-wide scheduling settings organized into tabbed sections:
 * General, Apparatus, Notifications, and Equipment.
 *
 * This is a thin orchestrator that manages the top-level settings state and
 * delegates rendering to focused card components.
 */

import React, { useState, useMemo } from "react";
import {
  Settings,
  Truck,
  ClipboardCheck,
  Bell,
  LayoutTemplate,
  Shield,
} from "lucide-react";
import type { ShiftTemplateRecord } from "../services/api";
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

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = "general" | "apparatus" | "notifications" | "equipment" | "eligibility";

const SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "general", label: "General", icon: LayoutTemplate },
  { id: "apparatus", label: "Apparatus", icon: Truck },
  { id: "eligibility", label: "Eligibility", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "equipment", label: "Equipment", icon: ClipboardCheck },
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
}

export const ShiftSettingsPanel: React.FC<ShiftSettingsPanelProps> = ({
  templates,
  apparatusList,
  onNavigateToTemplates,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
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
        {SETTINGS_TABS.map((tab) => {
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
