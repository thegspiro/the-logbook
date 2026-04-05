/**
 * Shift Reports Settings Panel
 *
 * Controls which checklist timing windows are active, whether post-shift
 * validation is enabled, whether officer reports are required, and surfaces
 * the training module's shift-review defaults (call types, skills, tasks)
 * so officers know what form they'll be filing.
 *
 * Settings are stored in org.settings under the "shift_reports" key.
 * Training defaults are read from the TrainingModuleConfig API.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck,
  FileText,
  Loader2,
  GraduationCap,
  Clock,
  Plus,
  X,
  SlidersHorizontal,
  Truck,
  Star,
  Pencil,
} from "lucide-react";
import toast from "react-hot-toast";
import { organizationService } from "../../../services/api";
import { trainingModuleConfigService } from "../../../services/trainingServices";
import { schedulingService } from "../services/api";
import { getErrorMessage } from "../../../utils/errorHandling";
import type { ShiftReportSettings } from "../types/shiftSettings";
import type { TrainingModuleConfig } from "../../../types/training";

type SectionKey =
  | "checklist-timing"
  | "post-shift"
  | "training-defaults"
  | "apparatus-skills"
  | "form-sections"
  | "review-workflow"
  | "rating-scale";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: React.ElementType;
  description: string;
}[] = [
  {
    key: "checklist-timing",
    label: "Checklist Timing",
    icon: ClipboardCheck,
    description: "Start/end of shift checklist windows",
  },
  {
    key: "post-shift",
    label: "Post-Shift Validation",
    icon: FileText,
    description: "Officer review after shift ends",
  },
  {
    key: "training-defaults",
    label: "Feedback Defaults",
    icon: GraduationCap,
    description: "Call types, skills, and tasks",
  },
  {
    key: "apparatus-skills",
    label: "Apparatus Skills",
    icon: Truck,
    description: "Skills & tasks per apparatus type",
  },
  {
    key: "form-sections",
    label: "Form Sections",
    icon: SlidersHorizontal,
    description: "Show/hide report form fields",
  },
  {
    key: "review-workflow",
    label: "Review Workflow",
    icon: Clock,
    description: "Report approval requirements",
  },
  {
    key: "rating-scale",
    label: "Rating Scale",
    icon: Star,
    description: "Rating levels and display style",
  },
];

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: ShiftReportSettings = {
  checklist_timing: {
    start_of_shift_enabled: true,
    end_of_shift_enabled: true,
  },
  post_shift_validation: {
    enabled: true,
    require_officer_report: false,
    validation_window_hours: 2,
  },
};

const SAMPLE_CALL_TYPES = [
  "Structure Fire", "Vehicle Fire", "Brush/Wildland",
  "EMS/Medical", "Motor Vehicle Accident", "Hazmat",
  "Rescue/Extrication", "Alarm Investigation",
  "Water Rescue", "Public Assist", "Other",
];

const SAMPLE_SKILLS = [
  "SCBA donning/doffing", "Hose deployment",
  "Ladder operations", "Search and rescue",
  "Ventilation", "Radio communications",
  "Scene size-up", "Knot tying",
  "Forcible entry", "Patient assessment",
  "CPR/AED", "Vitals monitoring",
  "Apparatus check-off",
];

const SAMPLE_TASKS = [
  "Apparatus check-off", "Station duties",
  "Equipment inventory", "Hydrant inspection",
  "Pre-plan review", "Map/district familiarization",
  "Training drill participation",
  "Report writing", "PPE inspection",
];

const SAMPLE_APPARATUS_SKILLS: Record<string, string[]> = {
  engine: [
    "Pump operations", "Hose deployment",
    "Hydrant connection", "Drafting",
    "Foam operations", "Attack line advancement",
    "Water supply establishment",
    "Apparatus positioning",
  ],
  ladder: [
    "Aerial operations", "Ladder placement",
    "Ventilation (vertical)", "Roof operations",
    "Forcible entry", "Ground ladder deployment",
    "Elevated master stream",
    "Building size-up",
  ],
  ambulance: [
    "Patient assessment", "Vitals monitoring",
    "CPR/AED", "Airway management",
    "IV/IO access", "Splinting/immobilization",
    "Medication administration",
    "Patient packaging/transport",
    "12-lead ECG interpretation",
  ],
  rescue: [
    "Vehicle extrication", "Confined space entry",
    "Rope rescue (high/low angle)",
    "Structural collapse operations",
    "Trench rescue", "Water rescue",
    "Stabilization techniques",
    "Cribbing and shoring",
  ],
  tanker: [
    "Water shuttle operations", "Portable tank setup",
    "Drafting from portable tank",
    "Dump valve operations",
    "Tanker positioning",
    "Water supply calculation",
  ],
  hazmat: [
    "HazMat identification (placards/SDS)",
    "Level A/B suit donning",
    "Decontamination setup",
    "Air monitoring", "Containment/damming",
    "ERG reference and zone establishment",
  ],
  brush: [
    "Wildland fire line construction",
    "Pump and roll operations",
    "Foam application (Class A)",
    "Mop-up techniques",
    "Weather observation and reporting",
  ],
  chief: [
    "Incident command establishment",
    "Resource management",
    "Accountability tracking",
    "Strategic decision-making",
    "Interagency coordination",
  ],
  boat: [
    "Vessel operation and navigation",
    "Water rescue swimmer deployment",
    "Throw bag / reach techniques",
    "Towing and anchoring",
  ],
};

const SAMPLE_APPARATUS_TASKS: Record<string, string[]> = {
  engine: [
    "Pump test / pressure check",
    "Hose load inspection",
    "Nozzle and appliance check",
    "Tank fill verification",
  ],
  ladder: [
    "Aerial function test",
    "Ground ladder inventory",
    "Hydraulic system check",
    "Outrigger/stabilizer inspection",
  ],
  ambulance: [
    "Medication expiration check",
    "Monitor/defibrillator test",
    "Oxygen supply verification",
    "Stretcher and restraint check",
    "BLS/ALS supply restock",
  ],
  rescue: [
    "Extrication tool function test",
    "Rope and harness inspection",
    "Air supply verification",
    "Cribbing inventory",
  ],
  tanker: [
    "Tank integrity check",
    "Dump valve function test",
    "Portable tank condition check",
  ],
  hazmat: [
    "Detection equipment calibration",
    "PPE suit integrity check",
    "Decon supplies inventory",
  ],
};

const checkboxClass =
  "w-4 h-4 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500";
// ─── Component ─────────────────────────────────────────────────────────────

export const ShiftReportsSettingsPanel: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionKey>("checklist-timing");
  const [settings, setSettings] = useState<ShiftReportSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [trainingConfig, setTrainingConfig] = useState<TrainingModuleConfig | null>(null);
  const [loadingTraining, setLoadingTraining] = useState(true);
  const [savingTraining, setSavingTraining] = useState(false);
  const [skillEvalNames, setSkillEvalNames] = useState<Set<string>>(new Set());

  // Editable lists for training defaults
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);

  // New-item inputs
  const [newCallType, setNewCallType] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newTask, setNewTask] = useState("");

  // Per-apparatus-type mapping
  const [apparatusTypes, setApparatusTypes] = useState<string[]>([]);
  const [selectedAppType, setSelectedAppType] = useState("");
  const [appTypeSkills, setAppTypeSkills] = useState<
    Record<string, string[]>
  >({});
  const [appTypeTasks, setAppTypeTasks] = useState<
    Record<string, string[]>
  >({});
  const [newAppSkill, setNewAppSkill] = useState("");
  const [newAppTask, setNewAppTask] = useState("");
  const [savingAppType, setSavingAppType] = useState(false);
  const [editingAppItem, setEditingAppItem] = useState<{
    type: "skill" | "task";
    index: number;
    value: string;
  } | null>(null);

  // Rating scale editor
  const [ratingLabels, setRatingLabels] = useState<
    Record<string, string>
  >({});
  const [savingRating, setSavingRating] = useState(false);

  // ── Load settings ──

  useEffect(() => {
    const load = async () => {
      try {
        const orgSettings = await organizationService.getSettings();
        const obj = orgSettings as Record<string, unknown>;
        const saved = obj.shift_reports as Partial<ShiftReportSettings> | undefined;
        if (saved) {
          setSettings({
            checklist_timing: { ...DEFAULT_SETTINGS.checklist_timing, ...saved.checklist_timing },
            post_shift_validation: { ...DEFAULT_SETTINGS.post_shift_validation, ...saved.post_shift_validation },
          });
        }
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const config = await trainingModuleConfigService.getConfig();
        setTrainingConfig(config);
        setCallTypes(
          config.shift_review_call_types?.length
            ? config.shift_review_call_types
            : SAMPLE_CALL_TYPES,
        );
        setSkills(
          config.shift_review_default_skills?.length
            ? config.shift_review_default_skills
            : SAMPLE_SKILLS,
        );
        setTasks(
          config.shift_review_default_tasks?.length
            ? config.shift_review_default_tasks
            : SAMPLE_TASKS,
        );
        setAppTypeSkills(
          config.apparatus_type_skills &&
            Object.keys(config.apparatus_type_skills).length > 0
            ? config.apparatus_type_skills
            : SAMPLE_APPARATUS_SKILLS,
        );
        setAppTypeTasks(
          config.apparatus_type_tasks &&
            Object.keys(config.apparatus_type_tasks).length > 0
            ? config.apparatus_type_tasks
            : SAMPLE_APPARATUS_TASKS,
        );
        setRatingLabels(
          config.rating_scale_labels ?? {
            "1": "Needs Improvement",
            "2": "Developing",
            "3": "Meets Expectations",
            "4": "Exceeds Expectations",
            "5": "Outstanding",
          },
        );
      } catch {
        // Training module may not be enabled
      } finally {
        setLoadingTraining(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    trainingModuleConfigService
      .getSkillNames()
      .then((names) => {
        setSkillEvalNames(
          new Set(names.map((n) => n.name.toLowerCase())),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    schedulingService
      .getBasicApparatus({ is_active: true })
      .then((list) => {
        const fromApi = list.map((a) => a.apparatus_type);
        const sampleTypes = Object.keys(
          SAMPLE_APPARATUS_SKILLS,
        );
        const merged = [
          ...new Set([...fromApi, ...sampleTypes]),
        ];
        merged.sort();
        setApparatusTypes(merged);
        if (merged.length > 0 && !selectedAppType) {
          setSelectedAppType(merged[0] ?? "");
        }
      })
      .catch(() => {
        const fallback = Object.keys(
          SAMPLE_APPARATUS_SKILLS,
        ).sort();
        setApparatusTypes(fallback);
        if (fallback.length > 0 && !selectedAppType) {
          setSelectedAppType(fallback[0] ?? "");
        }
      });
  }, []);

  // ── Save handlers ──

  const saveSettings = useCallback(async (updated: ShiftReportSettings) => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ shift_reports: updated });
      setSettings(updated);
      toast.success("Shift report settings saved");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  }, []);

  const saveTrainingDefaults = useCallback(async () => {
    setSavingTraining(true);
    try {
      const updated = await trainingModuleConfigService.updateConfig({
        shift_review_call_types: callTypes,
        shift_review_default_skills: skills,
        shift_review_default_tasks: tasks,
      });
      setTrainingConfig(updated);
      toast.success("Training feedback defaults saved");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to save training defaults"));
    } finally {
      setSavingTraining(false);
    }
  }, [callTypes, skills, tasks]);

  const saveAppTypeMapping = useCallback(async (
    updatedSkills: Record<string, string[]>,
    updatedTasks: Record<string, string[]>,
  ) => {
    setSavingAppType(true);
    try {
      const result = await trainingModuleConfigService.updateConfig({
        apparatus_type_skills: updatedSkills,
        apparatus_type_tasks: updatedTasks,
      });
      setTrainingConfig(result);
      toast.success("Apparatus skills/tasks saved");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to save"));
    } finally {
      setSavingAppType(false);
    }
  }, []);

  // ── Checklist timing helpers ──

  const updateChecklistTiming = useCallback(
    (field: keyof ShiftReportSettings["checklist_timing"], value: boolean) => {
      const updated: ShiftReportSettings = {
        ...settings,
        checklist_timing: { ...settings.checklist_timing, [field]: value },
      };
      setSettings(updated);
      void saveSettings(updated);
    },
    [settings, saveSettings],
  );

  // ── Post-shift validation helpers ──

  const updateValidation = useCallback(
    (field: keyof ShiftReportSettings["post_shift_validation"], value: boolean | number) => {
      const updated: ShiftReportSettings = {
        ...settings,
        post_shift_validation: { ...settings.post_shift_validation, [field]: value },
      };
      setSettings(updated);
      void saveSettings(updated);
    },
    [settings, saveSettings],
  );

  // ── Tag-list helpers ──

  const addItem = useCallback(
    (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, item: string, setInput: React.Dispatch<React.SetStateAction<string>>) => {
      const trimmed = item.trim();
      if (!trimmed || list.includes(trimmed)) return;
      setList((prev) => [...prev, trimmed]);
      setInput("");
    },
    [],
  );

  const removeItem = useCallback(
    (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, index: number) => {
      setList(list.filter((_, i) => i !== index));
    },
    [],
  );

  const trainingDirty =
    trainingConfig &&
    (JSON.stringify(callTypes) !== JSON.stringify(trainingConfig.shift_review_call_types ?? []) ||
      JSON.stringify(skills) !== JSON.stringify(trainingConfig.shift_review_default_skills ?? []) ||
      JSON.stringify(tasks) !== JSON.stringify(trainingConfig.shift_review_default_tasks ?? []));

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-theme-text-muted" />
        <span className="ml-2 text-sm text-theme-text-muted">Loading settings...</span>
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case "checklist-timing":
        return (
          <div>
        <p className="text-sm text-theme-text-muted mb-4">
          Choose which checklist windows are active for shifts. Equipment check templates
          are assigned per apparatus on the Equipment tab — these toggles control whether
          members are prompted at shift start, shift end, or both.
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.checklist_timing.start_of_shift_enabled}
              onChange={(e) => updateChecklistTiming("start_of_shift_enabled", e.target.checked)}
              disabled={saving}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-theme-text-primary">Start-of-shift checklists</span>
              <p className="text-xs text-theme-text-muted">
                Members are prompted to complete equipment checks when their shift begins.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.checklist_timing.end_of_shift_enabled}
              onChange={(e) => updateChecklistTiming("end_of_shift_enabled", e.target.checked)}
              disabled={saving}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-theme-text-primary">End-of-shift checklists</span>
              <p className="text-xs text-theme-text-muted">
                Members are reminded to complete equipment checks before their shift ends.
              </p>
            </div>
          </label>
        </div>
          </div>
        );
      case "post-shift":
        return (
          <div>
        <p className="text-sm text-theme-text-muted mb-4">
          After a shift ends, the shift officer can be notified to validate attendance,
          review hours, and confirm call counts before the shift is finalized.
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.post_shift_validation.enabled}
              onChange={(e) => updateValidation("enabled", e.target.checked)}
              disabled={saving}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-theme-text-primary">Enable post-shift validation</span>
              <p className="text-xs text-theme-text-muted">
                Notify the shift officer after a shift ends to review and confirm records.
              </p>
            </div>
          </label>

          {settings.post_shift_validation.enabled && (
            <>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.post_shift_validation.require_officer_report}
                  onChange={(e) => updateValidation("require_officer_report", e.target.checked)}
                  disabled={saving}
                  className={checkboxClass}
                />
                <div>
                  <span className="text-sm font-medium text-theme-text-primary">Require officer shift completion report</span>
                  <p className="text-xs text-theme-text-muted">
                    Officers must file a shift completion report before the shift can be finalized.
                    The report covers staffing, call response, and training observations.
                  </p>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">
                  Validation window (hours after shift end)
                </label>
                <p className="text-xs text-theme-text-muted mb-2">
                  How long after a shift ends to send the validation reminder to the officer.
                </p>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.post_shift_validation.validation_window_hours}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 24) {
                      updateValidation("validation_window_hours", val);
                    }
                  }}
                  disabled={saving}
                  className="w-20 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </>
          )}
        </div>
          </div>
        );
      case "training-defaults":
        return (
          <div>
        <p className="text-sm text-theme-text-muted mb-4">
          Define the default call types, skills, and tasks that appear on the officer&apos;s
          shift completion report form. Officers can add to these lists when filing a report.
        </p>

        {loadingTraining ? (
          <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin text-theme-text-muted" />
            <span className="ml-2 text-sm text-theme-text-muted">Loading training config...</span>
          </div>
        ) : !trainingConfig ? (
          <p className="text-sm text-theme-text-muted italic">
            Training module configuration is not available. Enable the training module to configure
            shift report defaults.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Call Types */}
            <TagListEditor
              label="Call / Incident Types"
              description="Incident types officers can select when recording calls responded."
              items={callTypes}
              onRemove={(i) => removeItem(callTypes, setCallTypes, i)}
              inputValue={newCallType}
              onInputChange={setNewCallType}
              onAdd={() => addItem(callTypes, setCallTypes, newCallType, setNewCallType)}
              placeholder="e.g. Structure Fire"
            />

            {/* Skills */}
            <TagListEditor
              label="Observable Skills"
              description="Skills officers can mark as demonstrated during the shift."
              items={skills}
              onRemove={(i) => removeItem(skills, setSkills, i)}
              inputValue={newSkill}
              onInputChange={setNewSkill}
              onAdd={() => addItem(skills, setSkills, newSkill, setNewSkill)}
              placeholder="e.g. SCBA donning/doffing"
            />

            {/* Tasks */}
            <TagListEditor
              label="Default Tasks"
              description="Tasks to track on the shift completion report."
              items={tasks}
              onRemove={(i) => removeItem(tasks, setTasks, i)}
              inputValue={newTask}
              onInputChange={setNewTask}
              onAdd={() => addItem(tasks, setTasks, newTask, setNewTask)}
              placeholder="e.g. Apparatus check-off"
            />

            {/* Save button */}
            {trainingDirty && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => void saveTrainingDefaults()}
                  disabled={savingTraining}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {savingTraining && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Training Defaults
                </button>
              </div>
            )}
          </div>
        )}
          </div>
        );
      case "apparatus-skills":
        if (!trainingConfig || apparatusTypes.length === 0) return null;
        return (
          <div>
          <p className="text-sm text-theme-text-muted mb-4">
            Assign specific skills and tasks to each apparatus type. When an officer files
            a report linked to a shift, the form will show skills and tasks relevant to
            that shift&apos;s apparatus instead of the general defaults above.
          </p>

          {/* Type selector */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {apparatusTypes.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedAppType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  selectedAppType === t
                    ? "bg-violet-600 text-white"
                    : "bg-theme-surface-hover text-theme-text-muted hover:text-theme-text-primary"
                }`}
              >
                {t}
                {(appTypeSkills[t]?.length || appTypeTasks[t]?.length)
                  ? ` (${(appTypeSkills[t]?.length ?? 0) + (appTypeTasks[t]?.length ?? 0)})`
                  : ""}
              </button>
            ))}
          </div>

          {selectedAppType && (
            <div className="space-y-5 border-t border-theme-surface-border pt-4">
              {/* Skills for selected type */}
              <div>
                <p className="text-sm font-medium text-theme-text-primary mb-1">
                  Skills for <span className="capitalize">{selectedAppType}</span>
                </p>
                <p className="text-xs text-theme-text-muted mb-2">
                  These override the general defaults when a shift uses this apparatus type.
                  Leave empty to use the general defaults.
                </p>

                {/* Existing skills */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(appTypeSkills[selectedAppType] ?? []).map((s, i) => {
                    const isEditing =
                      editingAppItem?.type === "skill" &&
                      editingAppItem.index === i;
                    if (isEditing) {
                      return (
                        <input
                          key={i}
                          autoFocus
                          type="text"
                          value={editingAppItem.value}
                          onChange={(e) =>
                            setEditingAppItem({
                              ...editingAppItem,
                              value: e.target.value,
                            })
                          }
                          onBlur={() => {
                            const trimmed =
                              editingAppItem.value.trim();
                            if (trimmed) {
                              const updated = {
                                ...appTypeSkills,
                              };
                              const list = [
                                ...(updated[selectedAppType] ??
                                  []),
                              ];
                              list[i] = trimmed;
                              updated[selectedAppType] = list;
                              setAppTypeSkills(updated);
                            }
                            setEditingAppItem(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (
                                e.target as HTMLInputElement
                              ).blur();
                            }
                            if (e.key === "Escape") {
                              setEditingAppItem(null);
                            }
                          }}
                          className="px-2.5 py-1 rounded-full text-xs font-medium border-2 border-violet-500 bg-theme-surface text-theme-text-primary w-48 focus:outline-hidden"
                        />
                      );
                    }
                    const isLinked = skillEvalNames.has(s.toLowerCase());
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          isLinked
                            ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                        }`}
                        title={isLinked ? "Linked to training skill evaluation" : "No matching skill evaluation found — won't track competency"}
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() =>
                            setEditingAppItem({
                              type: "skill",
                              index: i,
                              value: s,
                            })
                          }
                          className="hover:text-violet-500"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = {
                              ...appTypeSkills,
                            };
                            updated[selectedAppType] = (
                              updated[selectedAppType] ?? []
                            ).filter((_, idx) => idx !== i);
                            setAppTypeSkills(updated);
                          }}
                          className="hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>

                {/* Add skill input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAppSkill}
                    onChange={(e) => setNewAppSkill(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = newAppSkill.trim();
                        if (!trimmed) return;
                        const current = appTypeSkills[selectedAppType] ?? [];
                        if (current.includes(trimmed)) return;
                        const updated = { ...appTypeSkills, [selectedAppType]: [...current, trimmed] };
                        setAppTypeSkills(updated);
                        setNewAppSkill("");
                      }
                    }}
                    placeholder="e.g. Pump operations"
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = newAppSkill.trim();
                      if (!trimmed) return;
                      const current = appTypeSkills[selectedAppType] ?? [];
                      if (current.includes(trimmed)) return;
                      const updated = { ...appTypeSkills, [selectedAppType]: [...current, trimmed] };
                      setAppTypeSkills(updated);
                      setNewAppSkill("");
                    }}
                    disabled={!newAppSkill.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {/* Quick copy from defaults */}
                {skills.length > 0 && (appTypeSkills[selectedAppType] ?? []).length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAppTypeSkills({ ...appTypeSkills, [selectedAppType]: [...skills] });
                    }}
                    className="mt-2 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Copy from general defaults ({skills.length} skills)
                  </button>
                )}

                {skillEvalNames.size > 0 && (appTypeSkills[selectedAppType] ?? []).length > 0 && (
                  <p className="mt-2 text-[10px] text-theme-text-muted">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
                    Linked to training module
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 ml-2 mr-1" />
                    No matching skill evaluation
                  </p>
                )}
              </div>

              {/* Tasks for selected type */}
              <div>
                <p className="text-sm font-medium text-theme-text-primary mb-1">
                  Tasks for <span className="capitalize">{selectedAppType}</span>
                </p>

                {/* Existing tasks */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(appTypeTasks[selectedAppType] ?? []).map((t, i) => {
                    const isEditing =
                      editingAppItem?.type === "task" &&
                      editingAppItem.index === i;
                    if (isEditing) {
                      return (
                        <input
                          key={i}
                          autoFocus
                          type="text"
                          value={editingAppItem.value}
                          onChange={(e) =>
                            setEditingAppItem({
                              ...editingAppItem,
                              value: e.target.value,
                            })
                          }
                          onBlur={() => {
                            const trimmed =
                              editingAppItem.value.trim();
                            if (trimmed) {
                              const updated = {
                                ...appTypeTasks,
                              };
                              const list = [
                                ...(updated[selectedAppType] ??
                                  []),
                              ];
                              list[i] = trimmed;
                              updated[selectedAppType] = list;
                              setAppTypeTasks(updated);
                            }
                            setEditingAppItem(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (
                                e.target as HTMLInputElement
                              ).blur();
                            }
                            if (e.key === "Escape") {
                              setEditingAppItem(null);
                            }
                          }}
                          className="px-2.5 py-1 rounded-full text-xs font-medium border-2 border-violet-500 bg-theme-surface text-theme-text-primary w-48 focus:outline-hidden"
                        />
                      );
                    }
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() =>
                            setEditingAppItem({
                              type: "task",
                              index: i,
                              value: t,
                            })
                          }
                          className="hover:text-violet-500"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = {
                              ...appTypeTasks,
                            };
                            updated[selectedAppType] = (
                              updated[selectedAppType] ?? []
                            ).filter((_, idx) => idx !== i);
                            setAppTypeTasks(updated);
                          }}
                          className="hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>

                {/* Add task input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAppTask}
                    onChange={(e) => setNewAppTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = newAppTask.trim();
                        if (!trimmed) return;
                        const current = appTypeTasks[selectedAppType] ?? [];
                        if (current.includes(trimmed)) return;
                        const updated = { ...appTypeTasks, [selectedAppType]: [...current, trimmed] };
                        setAppTypeTasks(updated);
                        setNewAppTask("");
                      }
                    }}
                    placeholder="e.g. Apparatus check-off"
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = newAppTask.trim();
                      if (!trimmed) return;
                      const current = appTypeTasks[selectedAppType] ?? [];
                      if (current.includes(trimmed)) return;
                      const updated = { ...appTypeTasks, [selectedAppType]: [...current, trimmed] };
                      setAppTypeTasks(updated);
                      setNewAppTask("");
                    }}
                    disabled={!newAppTask.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {/* Quick copy from defaults */}
                {tasks.length > 0 && (appTypeTasks[selectedAppType] ?? []).length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAppTypeTasks({ ...appTypeTasks, [selectedAppType]: [...tasks] });
                    }}
                    className="mt-2 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Copy from general defaults ({tasks.length} tasks)
                  </button>
                )}
              </div>

              {/* Save button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => void saveAppTypeMapping(appTypeSkills, appTypeTasks)}
                  disabled={savingAppType}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {savingAppType && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Apparatus Skills &amp; Tasks
                </button>
              </div>
            </div>
          )}
          </div>
        );
      case "form-sections":
        if (!trainingConfig) return null;
        return (
          <div>
          <p className="text-sm text-theme-text-muted mb-4">
            Choose which optional sections appear on the shift completion report
            form when officers file a new report. Core fields (trainee, date,
            hours) are always shown.
          </p>

          <div className="space-y-3">
            {([
              {
                field: "form_show_performance_rating" as const,
                label: "Performance Rating",
                desc: "Star or competency rating for the trainee.",
              },
              {
                field: "form_show_areas_of_strength" as const,
                label: "Areas of Strength",
                desc: "Free-text field for positive feedback.",
              },
              {
                field: "form_show_areas_for_improvement" as const,
                label: "Areas for Improvement",
                desc: "Free-text field for developmental feedback.",
              },
              {
                field: "form_show_officer_narrative" as const,
                label: "Officer Narrative",
                desc: "General observations and overall assessment.",
              },
              {
                field: "form_show_call_types" as const,
                label: "Call / Incident Types",
                desc: "Categorize calls responded during the shift.",
              },
              {
                field: "form_show_skills_observed" as const,
                label: "Skills Observed",
                desc: "Checklist of skills demonstrated on shift.",
              },
              {
                field: "form_show_tasks_performed" as const,
                label: "Tasks Performed",
                desc: "Track tasks completed during the shift.",
              },
            ]).map(({ field, label, desc }) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trainingConfig[field] ?? true}
                  onChange={(e) => {
                    const updates = { [field]: e.target.checked };
                    void (async () => {
                      setSavingTraining(true);
                      try {
                        const result = await trainingModuleConfigService.updateConfig(updates);
                        setTrainingConfig(result);
                        toast.success(`${label} ${e.target.checked ? "enabled" : "disabled"}`);
                      } catch (err: unknown) {
                        toast.error(getErrorMessage(err, "Failed to update"));
                      } finally {
                        setSavingTraining(false);
                      }
                    })();
                  }}
                  disabled={savingTraining}
                  className={checkboxClass}
                />
                <div>
                  <span className="text-sm font-medium text-theme-text-primary">{label}</span>
                  <p className="text-xs text-theme-text-muted">{desc}</p>
                </div>
              </label>
            ))}
          </div>
          </div>
        );
      case "review-workflow":
        if (!trainingConfig) return null;
        return (
          <div>
          <p className="text-sm text-theme-text-muted mb-4">
            Controls whether shift completion reports require approval before the trainee can see them.
          </p>

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={trainingConfig.report_review_required}
                onChange={(e) => {
                  const updated = { report_review_required: e.target.checked };
                  void (async () => {
                    setSavingTraining(true);
                    try {
                      const result = await trainingModuleConfigService.updateConfig(updated);
                      setTrainingConfig(result);
                      toast.success("Review workflow updated");
                    } catch (err: unknown) {
                      toast.error(getErrorMessage(err, "Failed to update"));
                    } finally {
                      setSavingTraining(false);
                    }
                  })();
                }}
                disabled={savingTraining}
                className={checkboxClass}
              />
              <div>
                <span className="text-sm font-medium text-theme-text-primary">Require report review before trainee visibility</span>
                <p className="text-xs text-theme-text-muted">
                  Reports must be approved by a reviewer before the trainee can see them.
                </p>
              </div>
            </label>

            {trainingConfig.report_review_required && (
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">
                  Reviewer role
                </label>
                <select
                  value={trainingConfig.report_review_role}
                  onChange={(e) => {
                    const updated = { report_review_role: e.target.value };
                    void (async () => {
                      setSavingTraining(true);
                      try {
                        const result = await trainingModuleConfigService.updateConfig(updated);
                        setTrainingConfig(result);
                        toast.success("Reviewer role updated");
                      } catch (err: unknown) {
                        toast.error(getErrorMessage(err, "Failed to update"));
                      } finally {
                        setSavingTraining(false);
                      }
                    })();
                  }}
                  disabled={savingTraining}
                  className="px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
                >
                  <option value="training_officer">Training Officer</option>
                  <option value="captain">Captain</option>
                  <option value="chief">Chief</option>
                </select>
              </div>
            )}
          </div>
          </div>
        );
      case "rating-scale":
        if (!trainingConfig) return null;
        return (
          <div>
          <p className="text-sm text-theme-text-muted mb-4">
            Define the rating levels officers use when evaluating trainees.
            You can add, remove, rename, and reorder levels. Each level
            gets a numeric value starting at 1.
          </p>

          {/* Scale type */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-theme-text-primary mb-1">
              Display style
            </label>
            <div className="flex gap-2">
              {(["competency", "stars"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    void (async () => {
                      setSavingRating(true);
                      try {
                        const result =
                          await trainingModuleConfigService.updateConfig({
                            rating_scale_type: st,
                          });
                        setTrainingConfig(result);
                        toast.success("Display style updated");
                      } catch (err: unknown) {
                        toast.error(
                          getErrorMessage(err, "Failed to update"),
                        );
                      } finally {
                        setSavingRating(false);
                      }
                    })();
                  }}
                  disabled={savingRating}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    trainingConfig.rating_scale_type === st
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30"
                  }`}
                >
                  {st === "stars" ? "Stars (1-5)" : "Labeled Bubbles"}
                </button>
              ))}
            </div>
          </div>

          {/* Custom label */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-theme-text-primary mb-1">
              Field label
            </label>
            <input
              type="text"
              value={trainingConfig.rating_label}
              onChange={(e) => {
                const val = e.target.value;
                setTrainingConfig((prev) =>
                  prev ? { ...prev, rating_label: val } : prev,
                );
              }}
              onBlur={() => {
                void (async () => {
                  setSavingRating(true);
                  try {
                    const result =
                      await trainingModuleConfigService.updateConfig({
                        rating_label: trainingConfig.rating_label,
                      });
                    setTrainingConfig(result);
                  } catch (err: unknown) {
                    toast.error(
                      getErrorMessage(err, "Failed to update"),
                    );
                  } finally {
                    setSavingRating(false);
                  }
                })();
              }}
              className="w-64 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Level labels editor */}
          {trainingConfig.rating_scale_type !== "stars" && (
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Rating levels
              </label>
              <div className="space-y-2">
                {Object.keys(ratingLabels)
                  .sort((a, b) => Number(a) - Number(b))
                  .map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 text-sm font-bold flex items-center justify-center shrink-0">
                        {key}
                      </span>
                      <input
                        type="text"
                        value={ratingLabels[key] ?? ""}
                        onChange={(e) =>
                          setRatingLabels((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
                        placeholder={`Level ${key} label`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...ratingLabels };
                          delete updated[key];
                          const renumbered: Record<string, string> =
                            {};
                          Object.values(updated)
                            .sort()
                            .forEach((v, i) => {
                              renumbered[String(i + 1)] = v;
                            });
                          setRatingLabels(renumbered);
                        }}
                        disabled={Object.keys(ratingLabels).length <= 2}
                        className="p-1.5 text-theme-text-muted hover:text-red-500 disabled:opacity-30 transition-colors"
                        title="Remove level"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextKey = String(
                    Object.keys(ratingLabels).length + 1,
                  );
                  setRatingLabels((prev) => ({
                    ...prev,
                    [nextKey]: "",
                  }));
                }}
                className="mt-2 text-xs text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add level
              </button>

              {/* Save */}
              <div className="flex justify-end pt-3">
                <button
                  onClick={() => {
                    void (async () => {
                      setSavingRating(true);
                      try {
                        const result =
                          await trainingModuleConfigService.updateConfig({
                            rating_scale_labels: ratingLabels,
                          });
                        setTrainingConfig(result);
                        toast.success("Rating scale saved");
                      } catch (err: unknown) {
                        toast.error(
                          getErrorMessage(err, "Failed to save"),
                        );
                      } finally {
                        setSavingRating(false);
                      }
                    })();
                  }}
                  disabled={savingRating || JSON.stringify(ratingLabels) === JSON.stringify(trainingConfig?.rating_scale_labels ?? {})}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    JSON.stringify(ratingLabels) === JSON.stringify(trainingConfig?.rating_scale_labels ?? {})
                      ? "bg-violet-600/30 text-violet-300 cursor-default"
                      : "bg-violet-600 text-white hover:bg-violet-700"
                  } disabled:opacity-50`}
                >
                  {savingRating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Save Rating Scale
                </button>
              </div>
            </div>
          )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Mobile: horizontal scrollable tabs */}
      <nav className="md:hidden -mx-4 px-4 border-b border-theme-surface-border" aria-label="Shift report settings sections">
        <div className="flex overflow-x-auto scrollbar-thin scroll-smooth gap-1 pb-2">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const isActive = activeSection === key;
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
                    : "text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? "" : "text-theme-text-muted"}`} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Desktop: sidebar */}
      <nav className="hidden md:block md:w-52 shrink-0" aria-label="Shift report settings sections">
        <div className="md:sticky md:top-24 space-y-1">
          {SECTIONS.map(({ key, label, icon: Icon, description }) => {
            const isActive = activeSection === key;
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
                    : "text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? "" : "text-theme-text-muted"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className={`text-xs ${isActive ? "text-violet-600/70 dark:text-violet-400/70" : "text-theme-text-muted"}`}>
                    {description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content panel */}
      <main className="flex-1 min-w-0">
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-6">
          {renderSection()}
        </div>
      </main>
    </div>
  );
};

// ─── Tag List Editor ───────────────────────────────────────────────────────

interface TagListEditorProps {
  label: string;
  description: string;
  items: string[];
  onRemove: (index: number) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
}

const TagListEditor: React.FC<TagListEditorProps> = ({
  label,
  description,
  items,
  onRemove,
  inputValue,
  onInputChange,
  onAdd,
  placeholder,
}) => (
  <div>
    <label className="block text-sm font-medium text-theme-text-primary mb-0.5">{label}</label>
    <p className="text-xs text-theme-text-muted mb-2">{description}</p>

    {items.length > 0 && (
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/20 px-2.5 py-0.5 text-xs font-medium"
          >
            {item}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
              aria-label={`Remove ${item}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    )}

    <div className="flex gap-2">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
        placeholder={placeholder}
        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary placeholder:text-theme-text-muted focus:ring-2 focus:ring-violet-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!inputValue.trim()}
        className="inline-flex items-center gap-1 rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-1.5 text-xs font-medium text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-40 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </button>
    </div>
  </div>
);

export default ShiftReportsSettingsPanel;
