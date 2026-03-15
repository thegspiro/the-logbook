/**
 * Templates Overview Card
 *
 * Displays active shift templates with a link to the templates management page.
 * Shows a warning when no templates are configured.
 */

import React from "react";
import { AlertCircle } from "lucide-react";
import { resolveTemplatePositions } from "../services/api";
import type { ShiftTemplateRecord } from "../services/api";

interface TemplatesOverviewCardProps {
  templates: ShiftTemplateRecord[];
  onNavigateToTemplates: () => void;
}

export const TemplatesOverviewCard: React.FC<TemplatesOverviewCardProps> = ({
  templates,
  onNavigateToTemplates,
}) => {
  const activeTemplates = templates.filter((t) => t.is_active);

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-theme-text-primary">
          Shift Templates
        </h3>
        <button
          onClick={onNavigateToTemplates}
          className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
        >
          Manage templates
        </button>
      </div>
      {activeTemplates.length === 0 ? (
        <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                No templates configured
              </p>
              <p className="text-xs text-theme-text-muted mt-0.5">
                The system is using built-in defaults. Create custom templates
                to define your department's shift structure with specific
                times, positions, and staffing requirements.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {activeTemplates.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg"
            >
              {t.color && (
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text-primary truncate">
                  {t.name}
                </p>
                <p className="text-xs text-theme-text-muted">
                  {t.start_time_of_day} - {t.end_time_of_day} /{" "}
                  {t.duration_hours}h / min {t.min_staffing}
                </p>
                {(() => {
                  const flat = resolveTemplatePositions(t.positions);
                  return flat.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {flat.map((pos, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-sm capitalize"
                      >
                        {pos}
                      </span>
                    ))}
                  </div>
                  ) : null;
                })()}
              </div>
              {t.is_default && (
                <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-700 dark:text-green-400 rounded-sm shrink-0">
                  Default
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TemplatesOverviewCard;
