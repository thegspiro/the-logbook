/**
 * Warns that a crew's hours would be credited nowhere: no Admin Hours category
 * is chosen, and the event type has no mapping either.
 *
 * Whether the event type is mapped comes from the backend
 * (`EditorOptions.mapped_event_types`, the same rule crediting uses), not from
 * anything worked out here. The wording is for an outreach coordinator, who
 * usually cannot create a category or a mapping and needs to know who can.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { getEventTypeLabel } from '../../utils/eventHelpers';

interface HoursNotCreditedNoteProps {
  eventType: string;
  /** Whether the department has any category to choose. */
  hasCategories: boolean;
}

export const HoursNotCreditedNote: React.FC<HoursNotCreditedNoteProps> = ({ eventType, hasCategories }) => (
  <p className="alert-warning mt-2 flex items-start gap-2 text-sm" role="status">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <span>
      The crew’s hours won’t be credited: no Admin Hours category is chosen, and {getEventTypeLabel(eventType)} events
      aren’t mapped to one.{' '}
      {hasCategories
        ? 'Choose a category above, or ask whoever manages Admin Hours to map this event type.'
        : 'Your department has no Admin Hours categories yet. Ask whoever manages Admin Hours to add one.'}
    </span>
  </p>
);

export default HoursNotCreditedNote;
