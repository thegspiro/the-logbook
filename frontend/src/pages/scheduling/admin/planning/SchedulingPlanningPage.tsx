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

import React, { Suspense } from 'react';
import { useNavigate } from 'react-router';
import { ExternalLink, Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../../../utils/lazyWithRetry';
import PlanningSettingsSummary from './PlanningSettingsSummary';

const StaffingGapsSection = lazyWithRetry(() => import('./StaffingGapsSection'));
const ShiftTemplatesPage = lazyWithRetry(() => import('../../../ShiftTemplatesPage'));
const PatternsTab = lazyWithRetry(() => import('../../PatternsTab'));

/**
 * The three sections, each its own route under `/scheduling/admin/planning`.
 * The administration header's page strip is what moves between them; this
 * screen draws only the section's body.
 */
export type PlanningSection = 'gaps' | 'templates' | 'patterns';

const SECTION_TITLES: Record<PlanningSection, string> = {
  gaps: 'Staffing gaps',
  templates: 'Shift templates',
  patterns: 'Shift patterns',
};

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

  return (
    <div className="min-h-screen">
      <div className="py-6">
        {/* The header above names the page visibly (its strip line); this keeps
            it in heading navigation, under the header's <h1>. */}
        <h2 className="sr-only">{SECTION_TITLES[section]}</h2>
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
            Set the defaults for new shifts and templates in{' '}
            <button
              type="button"
              className="touch:min-h-11 inline-flex items-center gap-1 font-medium underline"
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
