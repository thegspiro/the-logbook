/**
 * Templates Overview Card
 *
 * Displays active shift templates with a link to the templates management page.
 * Shows a warning when no templates are configured.
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { resolveTemplatePositions } from '../services/api';
import type { ShiftTemplateRecord } from '../services/api';

interface TemplatesOverviewCardProps {
  templates: ShiftTemplateRecord[];
  onNavigateToTemplates: () => void;
}

export const TemplatesOverviewCard: React.FC<TemplatesOverviewCardProps> = ({ templates, onNavigateToTemplates }) => {
  const activeTemplates = templates.filter((t) => t.is_active);

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-base font-semibold">Shift Templates</h3>
        <button
          onClick={onNavigateToTemplates}
          className="text-sm text-violet-600 hover:underline dark:text-violet-400"
        >
          Manage templates
        </button>
      </div>
      {activeTemplates.length === 0 ? (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">No templates configured</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">
                The system is using built-in defaults. Create custom templates to define your department's shift
                structure with specific times, positions, and staffing requirements.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {activeTemplates.map((t) => (
            <div key={t.id} className="bg-theme-surface-hover/50 flex items-center gap-3 rounded-lg p-3">
              {t.color && <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />}
              <div className="min-w-0">
                <p className="text-theme-text-primary truncate text-sm font-medium">{t.name}</p>
                <p className="text-theme-text-muted text-xs">
                  {t.start_time_of_day} - {t.end_time_of_day} / {t.duration_hours}h / min {t.min_staffing}
                </p>
                {(() => {
                  const slots = resolveTemplatePositions(t.positions);
                  return slots.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {slots.map((slot, i) => (
                        <span
                          key={i}
                          className={`rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${slot.required ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-theme-surface-hover text-theme-text-muted'}`}
                        >
                          {slot.position}
                          {!slot.required && ' (opt)'}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              {t.is_default && (
                <span className="shrink-0 rounded-sm bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-700 dark:text-green-400">
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
