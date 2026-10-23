import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface PatternTemplateInactiveNoticeProps {
  /** The inactive template names, when known; omitted, the notice is generic. */
  names?: string[] | undefined;
}

/**
 * Why a pattern has stopped filling the calendar. A template still in use is
 * deactivated rather than deleted, and the server then generates nothing from
 * a pattern naming it — scheduled or manual — until the template is
 * reactivated or the pattern points at another one. Existing shifts stay.
 */
const PatternTemplateInactiveNotice: React.FC<PatternTemplateInactiveNoticeProps> = ({ names }) => (
  <div role="status" className="alert-warning flex items-start gap-2 p-2 text-xs">
    <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>
      <span className="text-theme-text-primary font-semibold">
        Template inactive — this pattern is not generating shifts
      </span>
      <span className="text-theme-text-secondary">
        {names && names.length > 0 ? ` (${names.join(', ')})` : ''}. Reactivate the template, or point the pattern at
        another one.
      </span>
    </span>
  </div>
);

export default PatternTemplateInactiveNotice;
