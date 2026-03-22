/**
 * Equipment Check Template List
 *
 * Inline template management for the Equipment settings tab.
 * Shows existing templates with summary info, active toggle,
 * and actions (edit, clone, delete). Links to the full builder
 * for create/edit.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Loader2,
  Search,
  Clock,
  Truck,
  Users,
  AlertCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { schedulingService } from "../services/api";
import type { EquipmentCheckTemplate } from "../types/equipmentCheck";
import { TEMPLATE_TYPE_LABELS, type TemplateType } from "../types/equipmentCheck";
import { getErrorMessage } from "../../../utils/errorHandling";

// ─── Helpers ────────────────────────────────────────────────────────────────

const TIMING_LABELS: Record<string, { label: string; color: string }> = {
  start_of_shift: {
    label: "Start of Shift",
    color:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  },
  end_of_shift: {
    label: "End of Shift",
    color:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
};

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  equipment:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  vehicle:
    "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  combined:
    "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
};

function countItems(template: EquipmentCheckTemplate): number {
  return (template.compartments ?? []).reduce(
    (sum, c) => sum + (c.items?.length ?? 0),
    0,
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export const EquipmentCheckTemplateList: React.FC = () => {
  const [templates, setTemplates] = useState<EquipmentCheckTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await schedulingService.getEquipmentCheckTemplates();
      setTemplates(data);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load templates"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const handleToggleActive = async (template: EquipmentCheckTemplate) => {
    setTogglingId(template.id);
    try {
      await schedulingService.updateEquipmentCheckTemplate(template.id, {
        is_active: !template.isActive,
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, isActive: !t.isActive } : t,
        ),
      );
      toast.success(
        `Template ${template.isActive ? "deactivated" : "activated"}`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update template"));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (template: EquipmentCheckTemplate) => {
    if (
      !window.confirm(
        `Delete "${template.name}"? This removes all compartments and items. This cannot be undone.`,
      )
    )
      return;
    setDeletingId(template.id);
    try {
      await schedulingService.deleteEquipmentCheckTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success("Template deleted");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to delete template"));
    } finally {
      setDeletingId(null);
    }
  };

  const handleClone = async (template: EquipmentCheckTemplate) => {
    const defaultName = `${template.name} (Copy)`;
    const newName = window.prompt("Name for the cloned template:", defaultName);
    if (newName === null) return;
    try {
      const cloned = await schedulingService.cloneEquipmentCheckTemplate(
        template.id,
        newName.trim() || defaultName,
      );
      setTemplates((prev) => [...prev, cloned]);
      toast.success(`Cloned as "${cloned.name}"`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to clone template"));
    }
  };

  const hasInactive = templates.some((t) => !t.isActive);

  const filtered = templates.filter(
    (t) =>
      (!hideInactive || t.isActive) &&
      (!search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.apparatusType ?? "").toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" /> Check Templates
        </h3>
        <a
          href="/scheduling/equipment-check-templates/new"
          className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Create Template
        </a>
      </div>
      <p className="text-xs text-theme-text-muted mb-4">
        Define what gets checked on each apparatus at shift start or end.
      </p>

      {/* Search + Filter */}
      {templates.length > 3 && (
        <div className="mb-3 space-y-2">
          <div className="relative">
            <label htmlFor="template-search" className="sr-only">Filter templates</label>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-text-muted" aria-hidden="true" />
            <input
              id="template-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter templates..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-1 focus:ring-violet-500"
            />
          </div>
          {hasInactive && (
            <label className="flex items-center gap-2 text-xs text-theme-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-theme-surface-border text-violet-600 focus:ring-violet-500"
              />
              Hide inactive templates
            </label>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-theme-surface-border rounded-lg">
          <AlertCircle className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
          <p className="text-sm text-theme-text-muted mb-2">
            No check templates configured
          </p>
          <p className="text-xs text-theme-text-muted mb-3">
            Create templates to define what crew members verify at shift start
            and end.
          </p>
          <a
            href="/scheduling/equipment-check-templates/new"
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Create First Template
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-theme-text-muted text-center py-4">
          No templates matching &ldquo;{search}&rdquo;
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((template) => {
            const timing = TIMING_LABELS[template.checkTiming];
            const itemCount = countItems(template);
            const compartmentCount = template.compartments?.length ?? 0;
            const isDeleting = deletingId === template.id;
            const isToggling = togglingId === template.id;

            return (
              <div
                key={template.id}
                className={`flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-colors ${
                  template.isActive
                    ? "bg-theme-surface-hover/30 border-theme-surface-border"
                    : "bg-theme-surface-hover/10 border-theme-surface-border/50 opacity-60"
                }`}
              >
                {/* Active toggle */}
                <button
                  onClick={() => {
                    void handleToggleActive(template);
                  }}
                  disabled={isToggling}
                  role="switch"
                  aria-checked={template.isActive}
                  aria-label={`${template.name} active`}
                  className={`mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                    template.isActive
                      ? "bg-violet-600"
                      : "bg-theme-surface-border"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      template.isActive ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-theme-text-primary truncate">
                      {template.name}
                    </p>
                    {timing && (
                      <span
                        className={`px-1.5 py-0.5 text-xs sm:text-[10px] font-medium rounded border ${timing.color}`}
                      >
                        {timing.label}
                      </span>
                    )}
                    {template.templateType && template.templateType !== "equipment" && (
                      <span
                        className={`px-1.5 py-0.5 text-xs sm:text-[10px] font-medium rounded border ${TEMPLATE_TYPE_COLORS[template.templateType] ?? ""}`}
                      >
                        {TEMPLATE_TYPE_LABELS[template.templateType as TemplateType] ?? template.templateType}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                    {template.apparatusType && (
                      <span className="flex items-center gap-0.5 capitalize">
                        <Truck className="w-3 h-3" /> {template.apparatusType}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-3 h-3" /> {compartmentCount}{" "}
                      {compartmentCount === 1
                        ? "compartment"
                        : "compartments"}
                      , {itemCount} {itemCount === 1 ? "item" : "items"}
                    </span>
                    {template.assignedPositions &&
                      template.assignedPositions.length > 0 && (
                        <span className="flex items-center gap-0.5 capitalize">
                          <Users className="w-3 h-3" />{" "}
                          {template.assignedPositions.join(", ")}
                        </span>
                      )}
                  </div>
                  {template.description && (
                    <p className="text-xs text-theme-text-muted mt-1 truncate">
                      {template.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <a
                    href={`/scheduling/equipment-check-templates/${template.id}`}
                    className="p-2 sm:p-1.5 text-theme-text-muted hover:text-violet-600 rounded-md hover:bg-violet-500/10 transition-colors min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    aria-label={`Edit ${template.name}`}
                  >
                    <Pencil className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
                  </a>
                  <button
                    onClick={() => {
                      void handleClone(template);
                    }}
                    className="p-2 sm:p-1.5 text-theme-text-muted hover:text-blue-600 rounded-md hover:bg-blue-500/10 transition-colors min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    aria-label={`Clone ${template.name}`}
                  >
                    <Copy className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => {
                      void handleDelete(template);
                    }}
                    disabled={isDeleting}
                    className="p-2 sm:p-1.5 text-theme-text-muted hover:text-red-500 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    aria-label={`Delete ${template.name}`}
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EquipmentCheckTemplateList;
