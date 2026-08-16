import React from 'react';
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { computeReadiness } from '../../utils/readiness';
import type { ReadinessCert, ReadinessLevel } from '../../utils/readiness';

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
const DashboardReadiness: React.FC<DashboardReadinessProps> = ({ certs, onOpen }) => {
  const readiness = computeReadiness(certs);
  if (!readiness) return null;

  const { box, icon, headline, Icon } = LEVEL[readiness.level];

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
          <span className="text-theme-text-muted"> · Certifications only</span>
        </span>
      </span>
      <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  );
};

export default DashboardReadiness;
