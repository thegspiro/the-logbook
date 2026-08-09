/**
 * Equipment Check Template List
 *
 * Inline template management for the Equipment settings tab.
 * Shows existing templates with summary info, active toggle,
 * and actions (edit, clone, delete). Links to the full builder
 * for create/edit.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../services/api';
import type { EquipmentCheckTemplate } from '../types/equipmentCheck';
import { TEMPLATE_TYPE_LABELS, type TemplateType } from '../types/equipmentCheck';
import { getErrorMessage } from '../../../utils/errorHandling';
import { PromptDialog } from '../../../components/ux';

import { useConfirm } from '../../../contexts/ConfirmContext';
// ─── Helpers ────────────────────────────────────────────────────────────────

const TIMING_LABELS: Record<string, { label: string; color: string }> = {
  start_of_shift: {
    label: 'Start of Shift',
    color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  },
  end_of_shift: {
    label: 'End of Shift',
    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  },
};

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  equipment: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  vehicle: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  combined: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
};

function countItems(template: EquipmentCheckTemplate): number {
  return (template.compartments ?? []).reduce((sum, c) => sum + (c.items?.length ?? 0), 0);
}

/** The name a clone gets unless the user types their own. */
function cloneNameFor(template: EquipmentCheckTemplate): string {
  return `${template.name} (Copy)`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const EquipmentCheckTemplateList: React.FC = () => {
  const { confirm } = useConfirm();
  const [templates, setTemplates] = useState<EquipmentCheckTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<EquipmentCheckTemplate | null>(null);
  const [cloning, setCloning] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await schedulingService.getEquipmentCheckTemplates();
      setTemplates(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load templates'));
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
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, isActive: !t.isActive } : t)));
      toast.success(`Template ${template.isActive ? 'deactivated' : 'activated'}`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update template'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (template: EquipmentCheckTemplate) => {
    if (
      !(await confirm({
        title: 'Delete check template',
        message: `Delete "${template.name}"? Every compartment and item on it goes with it, and this cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    setDeletingId(template.id);
    try {
      await schedulingService.deleteEquipmentCheckTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success('Template deleted');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete template'));
    } finally {
      setDeletingId(null);
    }
  };

  /** Copy a template under a new name.
   *
   * Was a window.prompt, which a browser may suppress — and a suppressed
   * prompt returns null, the same value Cancel returns, so cloning could
   * silently do nothing.
   */
  const handleClone = async (newName: string) => {
    if (!cloneTarget) return;
    const template = cloneTarget;
    setCloning(true);
    try {
      const cloned = await schedulingService.cloneEquipmentCheckTemplate(
        template.id,
        newName || cloneNameFor(template)
      );
      setTemplates((prev) => [...prev, cloned]);
      setCloneTarget(null);
      toast.success(`Cloned as "${cloned.name}"`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to clone template'));
    } finally {
      setCloning(false);
    }
  };

  const hasInactive = templates.some((t) => !t.isActive);

  const filtered = templates.filter(
    (t) =>
      (!hideInactive || t.isActive) &&
      (!search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.apparatusType ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck className="h-4 w-4" /> Check Templates
        </h3>
        <a
          href="/scheduling/equipment-check-templates/new"
          className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700"
        >
          <Plus className="h-3.5 w-3.5" /> Create Template
        </a>
      </div>
      <p className="text-theme-text-muted mb-4 text-xs">
        Define what gets checked on each apparatus at shift start or end.
      </p>

      {/* Search + Filter */}
      {templates.length > 3 && (
        <div className="mb-3 space-y-2">
          <div className="relative">
            <label htmlFor="template-search" className="sr-only">
              Filter templates
            </label>
            <Search
              className="text-theme-text-muted absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="template-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter templates..."
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary placeholder-theme-text-muted w-full rounded-lg border py-1.5 pr-3 pl-8 text-sm focus:ring-1 focus:ring-violet-500 focus:outline-hidden"
            />
          </div>
          {hasInactive && (
            <label className="text-theme-text-muted flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
                className="border-theme-surface-border h-3.5 w-3.5 rounded text-violet-600 focus:ring-violet-500"
              />
              Hide inactive templates
            </label>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="border-theme-surface-border rounded-lg border border-dashed py-8 text-center">
          <AlertCircle className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
          <p className="text-theme-text-muted mb-2 text-sm">No check templates configured</p>
          <p className="text-theme-text-muted mb-3 text-xs">
            Create templates to define what crew members verify at shift start and end.
          </p>
          <a
            href="/scheduling/equipment-check-templates/new"
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700"
          >
            <Plus className="h-3.5 w-3.5" /> Create First Template
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-theme-text-muted py-4 text-center text-sm">No templates matching &ldquo;{search}&rdquo;</p>
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
                className={`flex items-start gap-2 rounded-lg border p-2.5 transition-colors sm:gap-3 sm:p-3 ${
                  template.isActive
                    ? 'bg-theme-surface-hover/30 border-theme-surface-border'
                    : 'bg-theme-surface-hover/10 border-theme-surface-border/50 opacity-60'
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
                  className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    template.isActive ? 'bg-violet-600' : 'bg-theme-surface-border'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      template.isActive ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{template.name}</p>
                    {timing && (
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs font-medium sm:text-[10px] ${timing.color}`}
                      >
                        {timing.label}
                      </span>
                    )}
                    {template.templateType && template.templateType !== 'equipment' && (
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs font-medium sm:text-[10px] ${TEMPLATE_TYPE_COLORS[template.templateType] ?? ''}`}
                      >
                        {TEMPLATE_TYPE_LABELS[template.templateType as TemplateType] ?? template.templateType}
                      </span>
                    )}
                  </div>
                  <div className="text-theme-text-muted mt-1 flex items-center gap-3 text-xs">
                    {template.apparatusType && (
                      <span className="flex items-center gap-0.5 capitalize">
                        <Truck className="h-3 w-3" /> {template.apparatusType}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> {compartmentCount}{' '}
                      {compartmentCount === 1 ? 'compartment' : 'compartments'}, {itemCount}{' '}
                      {itemCount === 1 ? 'item' : 'items'}
                    </span>
                    {template.assignedPositions && template.assignedPositions.length > 0 && (
                      <span className="flex items-center gap-0.5 capitalize">
                        <Users className="h-3 w-3" /> {template.assignedPositions.join(', ')}
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-theme-text-muted mt-1 truncate text-xs">{template.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <a
                    href={`/scheduling/equipment-check-templates/${template.id}`}
                    className="text-theme-text-muted flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 transition-colors hover:bg-violet-500/10 hover:text-violet-600 sm:min-h-0 sm:min-w-0 sm:p-1.5"
                    aria-label={`Edit ${template.name}`}
                  >
                    <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                  </a>
                  <button
                    onClick={() => setCloneTarget(template)}
                    className="text-theme-text-muted flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 transition-colors hover:bg-blue-500/10 hover:text-blue-600 sm:min-h-0 sm:min-w-0 sm:p-1.5"
                    aria-label={`Clone ${template.name}`}
                  >
                    <Copy className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => {
                      void handleDelete(template);
                    }}
                    disabled={isDeleting}
                    className="text-theme-text-muted flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:p-1.5"
                    aria-label={`Delete ${template.name}`}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PromptDialog
        isOpen={cloneTarget !== null}
        onClose={() => setCloneTarget(null)}
        onSubmit={(newName) => void handleClone(newName)}
        title="Clone check template"
        message={
          cloneTarget
            ? `Copies every compartment and item from "${cloneTarget.name}" into a new template you can edit.`
            : undefined
        }
        label="Name for the copy"
        defaultValue={cloneTarget ? cloneNameFor(cloneTarget) : ''}
        confirmLabel="Clone template"
        loading={cloning}
      />
    </div>
  );
};

export default EquipmentCheckTemplateList;
