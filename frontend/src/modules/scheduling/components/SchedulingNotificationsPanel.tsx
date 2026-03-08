/**
 * Scheduling Notifications Panel
 *
 * Configure which scheduling events trigger in-app notifications
 * for department members. Supports preset notification rules.
 *
 * Extracted from the SchedulingPage monolith for maintainability.
 */

import React, { useState, useEffect } from "react";
import { Bell, Loader2 } from "lucide-react";
import { notificationsService } from "../../../services/api";
import type { NotificationRuleRecord } from "../../../services/api";

const SCHEDULING_NOTIFICATION_PRESETS = [
  {
    name: "New Assignment",
    description: "Notify members when they are assigned to a shift",
    trigger: "schedule_change" as const,
    config: { event: "assignment_created" },
  },
  {
    name: "Assignment Confirmed",
    description:
      "Notify shift officers when a member confirms their assignment",
    trigger: "schedule_change" as const,
    config: { event: "assignment_confirmed" },
  },
  {
    name: "Assignment Declined",
    description: "Alert when a member declines their shift assignment",
    trigger: "schedule_change" as const,
    config: { event: "assignment_declined" },
  },
  {
    name: "Time-Off Approved",
    description: "Notify members when their time-off request is approved",
    trigger: "schedule_change" as const,
    config: { event: "timeoff_approved" },
  },
  {
    name: "Swap Request",
    description: "Notify affected members about shift swap requests",
    trigger: "schedule_change" as const,
    config: { event: "swap_requested" },
  },
  {
    name: "Understaffed Shift",
    description: "Alert when a shift falls below minimum staffing",
    trigger: "schedule_change" as const,
    config: { event: "understaffed" },
  },
];

export const SchedulingNotificationsPanel: React.FC = () => {
  const [rules, setRules] = useState<NotificationRuleRecord[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { rules: data } = await notificationsService.getRules({
          category: "scheduling",
        });
        setRules(data);
      } catch (err) {
        console.warn("Failed to load notification rules:", err);
      } finally {
        setLoadingRules(false);
      }
    };
    void load();
  }, []);

  const isRuleEnabled = (presetName: string) => {
    return rules.some((r) => r.name === presetName && r.enabled);
  };

  const getRuleForPreset = (presetName: string) => {
    return rules.find((r) => r.name === presetName);
  };

  const handleToggle = async (
    preset: (typeof SCHEDULING_NOTIFICATION_PRESETS)[number],
  ) => {
    const existing = getRuleForPreset(preset.name);
    if (existing) {
      try {
        const updated = await notificationsService.toggleRule(
          existing.id,
          !existing.enabled,
        );
        setRules((prev) =>
          prev.map((r) => (r.id === existing.id ? updated : r)),
        );
      } catch (err) {
        console.warn("Failed to toggle notification rule:", err);
      }
    } else {
      setCreating(preset.name);
      try {
        const newRule = await notificationsService.createRule({
          name: preset.name,
          description: preset.description,
          trigger: preset.trigger,
          category: "scheduling",
          channel: "in_app",
          enabled: true,
          config: preset.config,
        });
        setRules((prev) => [...prev, newRule]);
      } catch (err) {
        console.warn("Failed to create notification rule:", err);
      } finally {
        setCreating(null);
      }
    }
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-4 h-4 text-violet-500" />
        <h3 className="text-base font-semibold text-theme-text-primary">
          Scheduling Notifications
        </h3>
      </div>
      <p className="text-xs text-theme-text-muted mb-4">
        Configure which scheduling events trigger in-app notifications for your
        department members.
      </p>

      {loadingRules ? (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading notification
          rules...
        </div>
      ) : (
        <div className="space-y-2">
          {SCHEDULING_NOTIFICATION_PRESETS.map((preset) => {
            const enabled = isRuleEnabled(preset.name);
            const isCreating = creating === preset.name;

            return (
              <div
                key={preset.name}
                className="flex items-center justify-between p-3 bg-theme-surface-hover/50 rounded-lg"
              >
                <div className="min-w-0 mr-3">
                  <p className="text-sm font-medium text-theme-text-primary">
                    {preset.name}
                  </p>
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    {preset.description}
                  </p>
                </div>
                <button
                  onClick={() => {
                    void handleToggle(preset);
                  }}
                  disabled={isCreating}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                    enabled ? "bg-violet-600" : "bg-theme-surface-border"
                  } ${isCreating ? "opacity-50" : ""}`}
                >
                  <span
                    className={`toggle-knob-sm ${
                      enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SchedulingNotificationsPanel;
