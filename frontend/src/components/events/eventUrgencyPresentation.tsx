/**
 * How each {@link EventUrgency} looks.
 *
 * The card's status strip and the "Needs You" band read their colours, icons
 * and wording from this one table, so a state can never be red in the band and
 * amber on the card it links to.
 *
 * Colours go through the `theme-alert-*` tokens rather than raw `red-50` /
 * `amber-50`: those tokens carry the design's stated hexes in light mode and
 * already have dark-mode values, which a bare Tailwind shade does not.
 */

import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CalendarX, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { EventUrgency } from '../../utils/eventHelpers';

export interface UrgencyPresentation {
  /** 4px left accent on the card. Empty for states that get no accent. */
  accentClass: string;
  /** Background + text colour of the status strip. */
  stripClass: string;
  /** Typography of the strip's label. Urgent states shout; resolved ones don't. */
  labelClass: string;
  /** Colour of the strip's leading icon. */
  iconClass: string;
  icon: LucideIcon | null;
  label: string;
}

const URGENT_LABEL = 'text-xs font-bold tracking-[0.08em] uppercase';
const RESOLVED_LABEL = 'text-xs font-semibold';

const PRESENTATION: Record<EventUrgency, UrgencyPresentation | null> = {
  live: {
    accentClass: 'border-l-4 border-l-theme-alert-success-icon',
    stripClass: 'bg-theme-alert-success-bg text-theme-alert-success-title',
    labelClass: URGENT_LABEL,
    iconClass: 'text-theme-alert-success-icon',
    // The pulsing dot replaces an icon here; see EventListCard.
    icon: null,
    label: 'Happening now',
  },
  action: {
    accentClass: 'border-l-4 border-l-theme-alert-danger-icon',
    stripClass: 'bg-theme-alert-danger-bg text-theme-alert-danger-title',
    labelClass: URGENT_LABEL,
    iconClass: 'text-theme-alert-danger-icon',
    icon: AlertCircle,
    label: 'Response needed',
  },
  missed: {
    accentClass: 'border-l-4 border-l-theme-alert-warning-icon',
    stripClass: 'bg-theme-alert-warning-bg text-theme-alert-warning-title',
    labelClass: URGENT_LABEL,
    iconClass: 'text-theme-alert-warning-icon',
    icon: CalendarX,
    label: 'No check-in recorded',
  },
  confirmed: {
    accentClass: '',
    stripClass: 'bg-theme-surface-secondary text-theme-text-secondary',
    labelClass: RESOLVED_LABEL,
    iconClass: 'text-green-600 dark:text-green-400',
    icon: CheckCircle2,
    label: "You're going",
  },
  waitlisted: {
    accentClass: '',
    stripClass: 'bg-theme-surface-secondary text-theme-text-secondary',
    labelClass: RESOLVED_LABEL,
    iconClass: 'text-theme-text-muted',
    icon: Clock,
    label: "You're on the waitlist",
  },
  declined: {
    accentClass: '',
    stripClass: 'bg-theme-surface-secondary text-theme-text-secondary',
    labelClass: RESOLVED_LABEL,
    iconClass: 'text-theme-text-muted',
    icon: XCircle,
    label: 'You marked Not Going',
  },
  // A routine event gets no strip and no accent at all — that absence is what
  // makes the urgent cards findable at a glance.
  routine: null,
};

export const getUrgencyPresentation = (urgency: EventUrgency): UrgencyPresentation | null => PRESENTATION[urgency];

/** Row treatment in the "Needs You" band: same colours, laid out as an alert. */
export const BAND_ROW_CLASS: Partial<Record<EventUrgency, string>> = {
  live: 'border-l-theme-alert-success-icon bg-theme-alert-success-bg',
  action: 'border-l-theme-alert-danger-icon bg-theme-alert-danger-bg',
  missed: 'border-l-theme-alert-warning-icon bg-theme-alert-warning-bg',
};
