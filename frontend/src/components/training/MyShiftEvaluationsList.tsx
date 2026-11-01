/**
 * A member's own shift evaluations on My Training: one row per evaluation,
 * opening to the full form as it was filled out, with a print link.
 *
 * The list comes from /training/shift-evaluations/mine, which returns only
 * what the member may see yet (the shift report's review rule decides).
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, Printer } from 'lucide-react';
import type { ShiftEvaluationDetail } from '../../types/training';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { shiftEvaluationPrintPath } from '../../utils/shiftEvaluations';
import { ShiftEvaluationView } from './ShiftEvaluationView';

interface Props {
  evaluations: ShiftEvaluationDetail[];
}

export const MyShiftEvaluationsList: React.FC<Props> = ({ evaluations }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ul className="space-y-3">
      {evaluations.map((evaluation) => {
        const open = openId === evaluation.id;
        const panelId = `my-shift-evaluation-${evaluation.id}`;
        return (
          <li key={evaluation.id} className="bg-theme-surface rounded-lg">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenId(open ? null : evaluation.id)}
              className="hover:bg-theme-surface-hover flex w-full flex-wrap items-center gap-2 rounded-lg p-4 text-left"
            >
              <span className="text-theme-text-primary font-medium">
                {formatCalendarDate(evaluation.shift_date, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span className="text-theme-text-secondary text-sm">{evaluation.template.name}</span>
              {evaluation.unit_label && <span className="text-theme-text-muted text-xs">{evaluation.unit_label}</span>}
              <span className="flex-1" />
              {evaluation.average_rating != null && (
                <span className="text-theme-text-secondary text-sm">
                  Average {evaluation.average_rating.toFixed(1)}
                </span>
              )}
              {evaluation.low_rating_count > 0 && (
                <span className="badge bg-theme-alert-warning-bg text-theme-alert-warning-text">
                  {evaluation.low_rating_count} to work on
                </span>
              )}
              {open ? (
                <ChevronUp className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {open && (
              <div id={panelId} className="space-y-3 px-4 pb-4">
                <p className="text-theme-text-muted text-xs">
                  Evaluated by {evaluation.evaluator_name ?? 'a former member'}
                  {evaluation.program_names.length > 0 && ` · ${evaluation.program_names.join(', ')}`}
                </p>
                <ShiftEvaluationView evaluation={evaluation} />
                <Link
                  to={shiftEvaluationPrintPath(evaluation.id)}
                  className="btn-secondary inline-flex items-center gap-1 text-sm"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" /> Print
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default MyShiftEvaluationsList;
