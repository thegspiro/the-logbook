import React from 'react';
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { computeReadiness, joinClauses } from '../../utils/readiness';
import type { ReadinessCert, ReadinessLevel, ReadinessScreenings } from '../../utils/readiness';
import { POSITION_LABELS } from '../../constants/enums';

const LEVEL: Record<ReadinessLevel, { box: string; icon: string; headline: string; Icon: typeof ShieldCheck }> = {
  clear: {
    box: 'alert-success hover:bg-theme-alert-success-bg/60',
    icon: 'text-theme-alert-success-icon',
    headline: 'text-theme-alert-success-title',
    Icon: ShieldCheck,
  },
  conditions: {
    box: 'alert-warning hover:bg-theme-alert-warning-bg/60',
    icon: 'text-theme-alert-warning-icon',
    headline: 'text-theme-alert-warning-title',
    Icon: ShieldAlert,
  },
  'not-clear': {
    box: 'alert-danger hover:bg-theme-alert-danger-bg/60',
    icon: 'text-theme-alert-danger-icon',
    headline: 'text-theme-alert-danger-title',
    Icon: ShieldX,
  },
};

interface DashboardReadinessProps {
  certs: ReadinessCert[];
  /**
   * Shift positions the member is eligible to hold, from the scheduling
   * eligibility service — rank, completed training and membership type
   * resolved together. Empty for a member the department excludes from shift
   * signup altogether, where the concept does not apply and nothing renders.
   */
  positions?: string[] | undefined;
  /**
   * The member's own screening compliance, as counts. Undefined when the read
   * failed or has not landed; the verdict then covers certifications and seats
   * only, and says so rather than implying screenings were checked and passed.
   */
  screenings?: ReadinessScreenings | null | undefined;
  onOpen: () => void;
}

/**
 * One line answering the question a fire department asks first: can this
 * member respond tonight?
 *
 * It sits above "Needs you" and summarises what the rows below spell out, and
 * renders nothing at all when there are no certifications to judge. The scope
 * note is not decoration — without it a green line reads as a full clearance,
 * and a member could skip checking the things this cannot see.
 */
const DashboardReadiness: React.FC<DashboardReadinessProps> = ({ certs, positions, screenings, onOpen }) => {
  const readiness = computeReadiness(certs, screenings);
  if (!readiness) return null;

  const { box, icon, headline, Icon } = LEVEL[readiness.level];
  const seats = positions ?? [];

  // Names the inputs the verdict actually had, so it never implies a check it
  // did not make. A department tracking no screenings sees no mention of them.
  const inputs: string[] = [];
  if (certs.length > 0) inputs.push('certifications');
  if (screenings && screenings.total_requirements > 0) inputs.push('screenings');
  if (seats.length > 0) inputs.push('seats');
  const scope = joinClauses(inputs);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`focus:ring-theme-focus-ring flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors focus:ring-2 focus:outline-hidden sm:gap-4 sm:px-5 ${box}`}
    >
      <Icon className={`h-5 w-5 shrink-0 sm:h-6 sm:w-6 ${icon}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] leading-snug font-bold sm:text-base ${headline}`}>
          {readiness.headline}
        </span>
        <span className="text-theme-text-secondary mt-0.5 block text-xs sm:text-sm">
          {readiness.detail}
          {/* Names the inputs rather than claiming a clearance, and only the
              ones this verdict actually had. SCBA fit-test dates are still not
              modelled anywhere, so they are never among them. */}
          <span className="text-theme-text-muted">
            {' · '}
            {scope.charAt(0).toUpperCase() + scope.slice(1)}
            {inputs.length === 1 ? ' only' : ''}
          </span>
        </span>
        {seats.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Seats you can hold">
            {seats.map((position) => (
              <span
                key={position}
                className="border-theme-surface-border bg-theme-surface text-theme-text-secondary rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              >
                {POSITION_LABELS[position] ?? position}
              </span>
            ))}
          </span>
        )}
      </span>
      <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  );
};

export default DashboardReadiness;
