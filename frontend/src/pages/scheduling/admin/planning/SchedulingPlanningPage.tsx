/**
 * Shift Planning
 *
 * Planning a stretch of calendar was three unconnected places: the templates
 * that say what a shift is, the patterns that repeat it, and — for the gaps the
 * generation leaves — the shift board, one day at a time. This is one screen,
 * in the order the work happens: see what is short, then fix the pattern or the
 * template that keeps leaving it short.
 *
 * The settings that govern planning are shown here but not edited here. General
 * and Apparatus are written by one footer Save that PUTs the whole settings
 * object, so a second screen writing them means whichever saved last silently
 * reverts the other — the failure that moved checklist timing to a single home
 * in Inventory. One editing home, and a link to it.
 */

import React, { Suspense, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ExternalLink, Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../../../utils/lazyWithRetry';
import SchedulingHeader from '../../SchedulingHeader';
import { PLANNING_SECTIONS, planningPathFor, type PlanningSection } from './planningSections';
import PlanningSettingsSummary from './PlanningSettingsSummary';

const StaffingGapsSection = lazyWithRetry(() => import('./StaffingGapsSection'));
const ShiftTemplatesPage = lazyWithRetry(() => import('../../../ShiftTemplatesPage'));
const PatternsTab = lazyWithRetry(() => import('../../PatternsTab'));

interface SchedulingPlanningPageProps {
  /** Which section this route mounts. */
  section: PlanningSection;
}

const SectionFallback = () => (
  <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
    <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
  </div>
);

const SchedulingPlanningPage: React.FC<SchedulingPlanningPageProps> = ({ section }) => {
  const navigate = useNavigate();

  const go = useCallback(
    (next: PlanningSection) => {
      void navigate(planningPathFor(next));
    },
    [navigate]
  );

  const active = PLANNING_SECTIONS.find((entry) => entry.key === section) ?? PLANNING_SECTIONS[0];

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <SchedulingHeader
          title="Shift Planning"
          backTo="/scheduling/admin"
          backLabel="Back to scheduling administration"
          description={active?.description ?? ''}
        />

        {/* Scrolls sideways below md rather than wrapping, and says so, so its
            off-screen items are exempt from the mobile overflow check and a
            keyboard can still reach them. */}
        <nav
          className="segmented-group hscroll mb-5 flex gap-1 md:flex-wrap md:overflow-x-visible"
          aria-label="Planning sections"
          data-mobile-scroll-region
          tabIndex={0}
        >
          {PLANNING_SECTIONS.map(({ key, label, icon: Icon }) => {
            const isActive = active?.key === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(key)}
                className={`settings-section-tab ${isActive ? 'settings-nav-item-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </nav>

        <Suspense fallback={<SectionFallback />}>
          {section === 'gaps' && (
            <div className="space-y-6">
              <StaffingGapsSection />
              <PlanningSettingsSummary />
            </div>
          )}
          {section === 'templates' && <ShiftTemplatesPage />}
          {section === 'patterns' && <PatternsTab />}
        </Suspense>

        {section !== 'gaps' && (
          <p className="text-theme-text-muted mt-6 text-xs">
            The defaults a new shift or template starts from live in{' '}
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium underline"
              onClick={() => void navigate('/scheduling/admin/settings/general')}
            >
              Scheduling settings
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
};

export default SchedulingPlanningPage;
