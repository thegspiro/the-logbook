/**
 * Scheduling Notifications Panel
 *
 * Configure which scheduling events trigger in-app notifications
 * for department members. Supports preset notification rules.
 *
 * Includes shift decline/drop notification settings and equipment
 * check failure alert settings, both stored in the organization's
 * settings JSON.
 *
 * Extracted from the SchedulingPage monolith for maintainability.
 */

import React, { useState, useEffect } from "react";
import { Bell, Clock, Loader2, Mail, AlertTriangle, UserPlus } from "lucide-react";
import toast from "react-hot-toast";
import { notificationsService, organizationService } from "../../../services/api";
import type { NotificationRuleRecord } from "../../../services/api";
import { getErrorMessage } from "../../../utils/errorHandling";

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

interface DeclineSettings {
  notify_on_decline: boolean;
  notify_roles: string[];
  notify_shift_officer: boolean;
  send_email: boolean;
  cc_emails: string[];
}

interface AssignmentSettings {
  notify_on_assignment: boolean;
  send_email: boolean;
  cc_emails: string[];
}

interface ShiftReminderSettings {
  enabled: boolean;
  lookahead_hours: number;
  send_email: boolean;
  cc_emails: string[];
}

interface EquipmentCheckAlertSettings {
  notify_on_failure: boolean;
  notify_roles: string[];
  notify_shift_officer: boolean;
  send_email: boolean;
  cc_emails: string[];
}

const DEFAULT_DECLINE_SETTINGS: DeclineSettings = {
  notify_on_decline: true,
  notify_roles: ["chief", "deputy_chief", "captain"],
  notify_shift_officer: true,
  send_email: false,
  cc_emails: [],
};

const DEFAULT_ASSIGNMENT_SETTINGS: AssignmentSettings = {
  notify_on_assignment: true,
  send_email: false,
  cc_emails: [],
};

const DEFAULT_REMINDER_SETTINGS: ShiftReminderSettings = {
  enabled: true,
  lookahead_hours: 2,
  send_email: false,
  cc_emails: [],
};

const DEFAULT_EQUIPMENT_ALERT_SETTINGS: EquipmentCheckAlertSettings = {
  notify_on_failure: true,
  notify_roles: ["chief", "captain"],
  notify_shift_officer: true,
  send_email: false,
  cc_emails: [],
};

const AVAILABLE_ROLES = [
  { value: "chief", label: "Chief" },
  { value: "deputy_chief", label: "Deputy Chief" },
  { value: "assistant_chief", label: "Assistant Chief" },
  { value: "captain", label: "Captain" },
  { value: "lieutenant", label: "Lieutenant" },
  { value: "sergeant", label: "Sergeant" },
];

export const SchedulingNotificationsPanel: React.FC = () => {
  const [rules, setRules] = useState<NotificationRuleRecord[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  // Shift decline/drop notification settings (stored in org settings)
  const [declineSettings, setDeclineSettings] = useState<DeclineSettings>(DEFAULT_DECLINE_SETTINGS);
  const [loadingDecline, setLoadingDecline] = useState(true);
  const [savingDecline, setSavingDecline] = useState(false);
  const [ccInput, setCcInput] = useState("");

  // Shift assignment notification settings (stored in org settings)
  const [assignmentSettings, setAssignmentSettings] = useState<AssignmentSettings>(
    DEFAULT_ASSIGNMENT_SETTINGS,
  );
  const [loadingAssignment, setLoadingAssignment] = useState(true);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignCcInput, setAssignCcInput] = useState("");

  // Start-of-shift reminder settings (stored in org settings)
  const [reminderSettings, setReminderSettings] = useState<ShiftReminderSettings>(
    DEFAULT_REMINDER_SETTINGS,
  );
  const [loadingReminder, setLoadingReminder] = useState(true);
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderCcInput, setReminderCcInput] = useState("");

  // Equipment check failure alert settings (stored in org settings)
  const [equipAlertSettings, setEquipAlertSettings] = useState<EquipmentCheckAlertSettings>(
    DEFAULT_EQUIPMENT_ALERT_SETTINGS,
  );
  const [loadingEquipAlerts, setLoadingEquipAlerts] = useState(true);
  const [savingEquipAlerts, setSavingEquipAlerts] = useState(false);
  const [equipCcInput, setEquipCcInput] = useState("");

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

  // Load org settings (decline + equipment alerts)
  useEffect(() => {
    const load = async () => {
      try {
        const settings = await organizationService.getSettings();
        const settingsObj = settings as Record<string, unknown>;
        const sched = settingsObj.scheduling as Partial<DeclineSettings> | undefined;
        if (sched) {
          setDeclineSettings({ ...DEFAULT_DECLINE_SETTINGS, ...sched });
        }
        const assignCfg = settingsObj.scheduling_assignment as
          | Partial<AssignmentSettings>
          | undefined;
        if (assignCfg) {
          setAssignmentSettings({ ...DEFAULT_ASSIGNMENT_SETTINGS, ...assignCfg });
        }
        const reminderCfg = settingsObj.shift_reminders as
          | Partial<ShiftReminderSettings>
          | undefined;
        if (reminderCfg) {
          setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, ...reminderCfg });
        }
        const equipAlerts = settingsObj.equipment_check_alerts as
          | Partial<EquipmentCheckAlertSettings>
          | undefined;
        if (equipAlerts) {
          setEquipAlertSettings({ ...DEFAULT_EQUIPMENT_ALERT_SETTINGS, ...equipAlerts });
        }
      } catch {
        // Settings may not exist yet — use defaults
      } finally {
        setLoadingDecline(false);
        setLoadingAssignment(false);
        setLoadingReminder(false);
        setLoadingEquipAlerts(false);
      }
    };
    void load();
  }, []);

  const saveDeclineSettings = async (updated: DeclineSettings) => {
    setSavingDecline(true);
    try {
      await organizationService.updateSettings({ scheduling: updated });
      setDeclineSettings(updated);
      toast.success("Decline notification settings saved");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    } finally {
      setSavingDecline(false);
    }
  };

  const saveAssignmentSettings = async (updated: AssignmentSettings) => {
    setSavingAssignment(true);
    try {
      await organizationService.updateSettings({ scheduling_assignment: updated });
      setAssignmentSettings(updated);
      toast.success("Assignment notification settings saved");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    } finally {
      setSavingAssignment(false);
    }
  };

  const addAssignCcEmail = () => {
    const email = assignCcInput.trim();
    if (!email || assignmentSettings.cc_emails.includes(email)) return;
    const updated = { ...assignmentSettings, cc_emails: [...assignmentSettings.cc_emails, email] };
    setAssignCcInput("");
    void saveAssignmentSettings(updated);
  };

  const removeAssignCcEmail = (email: string) => {
    const updated = {
      ...assignmentSettings,
      cc_emails: assignmentSettings.cc_emails.filter(e => e !== email),
    };
    void saveAssignmentSettings(updated);
  };

  const saveReminderSettings = async (updated: ShiftReminderSettings) => {
    setSavingReminder(true);
    try {
      await organizationService.updateSettings({ shift_reminders: updated });
      setReminderSettings(updated);
      toast.success("Shift reminder settings saved");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    } finally {
      setSavingReminder(false);
    }
  };

  const addReminderCcEmail = () => {
    const email = reminderCcInput.trim();
    if (!email || reminderSettings.cc_emails.includes(email)) return;
    const updated = { ...reminderSettings, cc_emails: [...reminderSettings.cc_emails, email] };
    setReminderCcInput("");
    void saveReminderSettings(updated);
  };

  const removeReminderCcEmail = (email: string) => {
    const updated = {
      ...reminderSettings,
      cc_emails: reminderSettings.cc_emails.filter(e => e !== email),
    };
    void saveReminderSettings(updated);
  };

  const saveEquipAlertSettings = async (updated: EquipmentCheckAlertSettings) => {
    setSavingEquipAlerts(true);
    try {
      await organizationService.updateSettings({ equipment_check_alerts: updated });
      setEquipAlertSettings(updated);
      toast.success("Equipment check alert settings saved");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    } finally {
      setSavingEquipAlerts(false);
    }
  };

  const toggleRole = (role: string) => {
    const updated = { ...declineSettings };
    if (updated.notify_roles.includes(role)) {
      updated.notify_roles = updated.notify_roles.filter(r => r !== role);
    } else {
      updated.notify_roles = [...updated.notify_roles, role];
    }
    void saveDeclineSettings(updated);
  };

  const toggleEquipRole = (role: string) => {
    const updated = { ...equipAlertSettings };
    if (updated.notify_roles.includes(role)) {
      updated.notify_roles = updated.notify_roles.filter(r => r !== role);
    } else {
      updated.notify_roles = [...updated.notify_roles, role];
    }
    void saveEquipAlertSettings(updated);
  };

  const addCcEmail = () => {
    const email = ccInput.trim();
    if (!email || declineSettings.cc_emails.includes(email)) return;
    const updated = { ...declineSettings, cc_emails: [...declineSettings.cc_emails, email] };
    setCcInput("");
    void saveDeclineSettings(updated);
  };

  const removeCcEmail = (email: string) => {
    const updated = { ...declineSettings, cc_emails: declineSettings.cc_emails.filter(e => e !== email) };
    void saveDeclineSettings(updated);
  };

  const addEquipCcEmail = () => {
    const email = equipCcInput.trim();
    if (!email || equipAlertSettings.cc_emails.includes(email)) return;
    const updated = { ...equipAlertSettings, cc_emails: [...equipAlertSettings.cc_emails, email] };
    setEquipCcInput("");
    void saveEquipAlertSettings(updated);
  };

  const removeEquipCcEmail = (email: string) => {
    const updated = {
      ...equipAlertSettings,
      cc_emails: equipAlertSettings.cc_emails.filter(e => e !== email),
    };
    void saveEquipAlertSettings(updated);
  };

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
        <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4" role="status" aria-live="polite">
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

      {/* Shift Decline/Drop Notification Settings */}
      <div className="mt-5 pt-5 border-t border-theme-surface-border">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-theme-text-primary">
            Shift Decline / Drop Alerts
          </h4>
          {savingDecline && <Loader2 className="w-3 h-3 animate-spin text-theme-text-muted" />}
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          Alert specific roles when a member declines or drops a shift assignment.
        </p>

        {loadingDecline ? (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <div className="space-y-3">
            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={declineSettings.notify_on_decline}
                onChange={(e) => {
                  void saveDeclineSettings({ ...declineSettings, notify_on_decline: e.target.checked });
                }}
                className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm text-theme-text-primary">
                Enable decline/drop notifications
              </span>
            </label>

            {declineSettings.notify_on_decline && (
              <>
                {/* Notify shift officer */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={declineSettings.notify_shift_officer}
                    onChange={(e) => {
                      void saveDeclineSettings({ ...declineSettings, notify_shift_officer: e.target.checked });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Notify the shift officer
                  </span>
                </label>

                {/* Notify roles */}
                <div className="ml-4">
                  <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                    Notify these roles:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_ROLES.map(role => (
                      <button
                        key={role.value}
                        onClick={() => toggleRole(role.value)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                          declineSettings.notify_roles.includes(role.value)
                            ? "bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-400"
                            : "bg-theme-surface-hover border-theme-surface-border text-theme-text-muted hover:text-theme-text-secondary"
                        }`}
                      >
                        {role.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Send email toggle */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={declineSettings.send_email}
                    onChange={(e) => {
                      void saveDeclineSettings({ ...declineSettings, send_email: e.target.checked });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Also send email notification
                  </span>
                </label>

                {/* CC emails */}
                {declineSettings.send_email && (
                  <div className="ml-4">
                    <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                      CC additional email addresses:
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="email"
                        value={ccInput}
                        onChange={(e) => setCcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCcEmail(); } }}
                        placeholder="email@example.com"
                        className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
                      />
                      <button
                        onClick={addCcEmail}
                        className="px-3 py-1 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700"
                      >
                        Add
                      </button>
                    </div>
                    {declineSettings.cc_emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {declineSettings.cc_emails.map(email => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-theme-surface-hover rounded-full text-theme-text-secondary"
                          >
                            {email}
                            <button
                              onClick={() => removeCcEmail(email)}
                              className="text-theme-text-muted hover:text-red-500"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Shift Assignment Notification Settings */}
      <div className="mt-5 pt-5 border-t border-theme-surface-border">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="w-4 h-4 text-blue-500" />
          <h4 className="text-sm font-semibold text-theme-text-primary">
            Shift Assignment Alerts
          </h4>
          {savingAssignment && <Loader2 className="w-3 h-3 animate-spin text-theme-text-muted" />}
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          Notify members when they are assigned to a shift.
        </p>

        {loadingAssignment ? (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <div className="space-y-3">
            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={assignmentSettings.notify_on_assignment}
                onChange={(e) => {
                  void saveAssignmentSettings({ ...assignmentSettings, notify_on_assignment: e.target.checked });
                }}
                className="w-4 h-4 rounded border-theme-surface-border text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-theme-text-primary">
                Enable assignment notifications
              </span>
            </label>

            {assignmentSettings.notify_on_assignment && (
              <>
                {/* Send email toggle */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={assignmentSettings.send_email}
                    onChange={(e) => {
                      void saveAssignmentSettings({ ...assignmentSettings, send_email: e.target.checked });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Also send email notification
                  </span>
                </label>

                {/* CC emails */}
                {assignmentSettings.send_email && (
                  <div className="ml-4">
                    <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                      CC additional email addresses:
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="email"
                        value={assignCcInput}
                        onChange={(e) => setAssignCcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAssignCcEmail(); } }}
                        placeholder="email@example.com"
                        className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={addAssignCcEmail}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Add
                      </button>
                    </div>
                    {assignmentSettings.cc_emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {assignmentSettings.cc_emails.map(email => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-theme-surface-hover rounded-full text-theme-text-secondary"
                          >
                            {email}
                            <button
                              onClick={() => removeAssignCcEmail(email)}
                              className="text-theme-text-muted hover:text-red-500"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Start-of-Shift Reminder Settings */}
      <div className="mt-5 pt-5 border-t border-theme-surface-border">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-green-500" />
          <h4 className="text-sm font-semibold text-theme-text-primary">
            Start-of-Shift Reminders
          </h4>
          {savingReminder && <Loader2 className="w-3 h-3 animate-spin text-theme-text-muted" />}
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          Remind assigned members before their shift starts. Includes the list of
          equipment checklists they need to complete.
        </p>

        {loadingReminder ? (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <div className="space-y-3">
            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={reminderSettings.enabled}
                onChange={(e) => {
                  void saveReminderSettings({ ...reminderSettings, enabled: e.target.checked });
                }}
                className="w-4 h-4 rounded border-theme-surface-border text-green-600 focus:ring-green-500"
              />
              <span className="text-sm text-theme-text-primary">
                Enable start-of-shift reminders
              </span>
            </label>

            {reminderSettings.enabled && (
              <>
                {/* Lookahead hours */}
                <div className="ml-4">
                  <label className="text-xs font-medium text-theme-text-secondary mb-1 block">
                    Send reminder this many hours before shift starts:
                  </label>
                  <select
                    value={reminderSettings.lookahead_hours}
                    onChange={(e) => {
                      void saveReminderSettings({
                        ...reminderSettings,
                        lookahead_hours: Number(e.target.value),
                      });
                    }}
                    className="px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-green-500"
                  >
                    <option value={1}>1 hour</option>
                    <option value={2}>2 hours</option>
                    <option value={3}>3 hours</option>
                    <option value={4}>4 hours</option>
                    <option value={6}>6 hours</option>
                    <option value={12}>12 hours</option>
                    <option value={24}>24 hours</option>
                  </select>
                </div>

                {/* Send email toggle */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={reminderSettings.send_email}
                    onChange={(e) => {
                      void saveReminderSettings({ ...reminderSettings, send_email: e.target.checked });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-green-600 focus:ring-green-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Also send email notification
                  </span>
                </label>

                {/* CC emails */}
                {reminderSettings.send_email && (
                  <div className="ml-4">
                    <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                      CC additional email addresses:
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="email"
                        value={reminderCcInput}
                        onChange={(e) => setReminderCcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReminderCcEmail(); } }}
                        placeholder="email@example.com"
                        className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-green-500"
                      />
                      <button
                        onClick={addReminderCcEmail}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Add
                      </button>
                    </div>
                    {reminderSettings.cc_emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {reminderSettings.cc_emails.map(email => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-theme-surface-hover rounded-full text-theme-text-secondary"
                          >
                            {email}
                            <button
                              onClick={() => removeReminderCcEmail(email)}
                              className="text-theme-text-muted hover:text-red-500"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Equipment Check Failure Alerts */}
      <div className="mt-5 pt-5 border-t border-theme-surface-border">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h4 className="text-sm font-semibold text-theme-text-primary">
            Equipment Check Alerts
          </h4>
          {savingEquipAlerts && <Loader2 className="w-3 h-3 animate-spin text-theme-text-muted" />}
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          Alert specific roles when an equipment check fails. Failed checks also
          flag the apparatus with a deficiency indicator.
        </p>

        {loadingEquipAlerts ? (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <div className="space-y-3">
            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={equipAlertSettings.notify_on_failure}
                onChange={(e) => {
                  void saveEquipAlertSettings({
                    ...equipAlertSettings,
                    notify_on_failure: e.target.checked,
                  });
                }}
                className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-theme-text-primary">
                Notify on equipment check failure
              </span>
            </label>

            {equipAlertSettings.notify_on_failure && (
              <>
                {/* Notify shift officer */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={equipAlertSettings.notify_shift_officer}
                    onChange={(e) => {
                      void saveEquipAlertSettings({
                        ...equipAlertSettings,
                        notify_shift_officer: e.target.checked,
                      });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Notify the shift officer
                  </span>
                </label>

                {/* Notify roles */}
                <div className="ml-4">
                  <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                    Notify these roles:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_ROLES.map(role => (
                      <button
                        key={role.value}
                        onClick={() => toggleEquipRole(role.value)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                          equipAlertSettings.notify_roles.includes(role.value)
                            ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                            : "bg-theme-surface-hover border-theme-surface-border text-theme-text-muted hover:text-theme-text-secondary"
                        }`}
                      >
                        {role.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Send email toggle */}
                <label className="flex items-center gap-3 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={equipAlertSettings.send_email}
                    onChange={(e) => {
                      void saveEquipAlertSettings({
                        ...equipAlertSettings,
                        send_email: e.target.checked,
                      });
                    }}
                    className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm text-theme-text-secondary">
                    Also send email notification
                  </span>
                </label>

                {/* CC emails */}
                {equipAlertSettings.send_email && (
                  <div className="ml-4">
                    <p className="text-xs font-medium text-theme-text-secondary mb-1.5">
                      CC additional email addresses:
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="email"
                        value={equipCcInput}
                        onChange={(e) => setEquipCcInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); addEquipCcEmail(); }
                        }}
                        placeholder="email@example.com"
                        className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-red-500"
                      />
                      <button
                        onClick={addEquipCcEmail}
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Add
                      </button>
                    </div>
                    {equipAlertSettings.cc_emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {equipAlertSettings.cc_emails.map(email => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-theme-surface-hover rounded-full text-theme-text-secondary"
                          >
                            {email}
                            <button
                              onClick={() => removeEquipCcEmail(email)}
                              className="text-theme-text-muted hover:text-red-500"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulingNotificationsPanel;
