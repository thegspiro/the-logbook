import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, RefreshCw, Settings } from 'lucide-react';
import { trainingService } from '../services/api';
import type { TrainingDashboardSummary } from '../services/trainingServices';
import {
  ComplianceOverviewWidget,
  MembersNeedingInterventionWidget,
  PendingValidationWidget,
  RecentCompletionsWidget,
  RequirementsAtRiskWidget,
  RequirementsStatusWidget,
  TRAINING_WIDGET_METADATA,
  TrainingHoursSummaryWidget,
  UpcomingExpirationsWidget,
  UpcomingSessionCapacityWidget,
  type TrainingWidgetId,
} from '../components/dashboard/widgets/training';

import {
  loadTrainingWidgetPreferences,
  saveTrainingWidgetPreferences,
} from '../components/dashboard/widgets/training/preferences';
import { TrainingSetupGuide } from '../components/training/TrainingSetupGuide';

const widgets: Record<TrainingWidgetId, React.FC<{ data: TrainingDashboardSummary }>> = {
  'compliance-overview': ComplianceOverviewWidget,
  'upcoming-expirations': UpcomingExpirationsWidget,
  'recent-completions': RecentCompletionsWidget,
  'training-hours': TrainingHoursSummaryWidget,
  'requirements-status': RequirementsStatusWidget,
  'members-needing-intervention': MembersNeedingInterventionWidget,
  'upcoming-session-capacity': UpcomingSessionCapacityWidget,
  'pending-validation': PendingValidationWidget,
  'requirements-at-risk': RequirementsAtRiskWidget,
};

const SUMMARY_LISTS = [
  'expirations',
  'recent_completions',
  'requirements',
  'members_needing_intervention',
  'upcoming_session_capacity',
  'requirements_at_risk',
] as const;

/**
 * Whether a response is the summary the widgets read.
 *
 * Every widget dereferences `stats`, one of these lists or `pending_validation`
 * unguarded, so a 200 that is not this shape (a captive portal's HTML page)
 * took the whole Training hub down through the ErrorBoundary. Substituting
 * empty values would be worse than an error: "0% compliant" and "no expiring
 * certifications" are claims an officer acts on, so a malformed body takes the
 * page's own load-error path instead.
 */
const isDashboardSummary = (value: unknown): value is TrainingDashboardSummary => {
  if (typeof value !== 'object' || value === null) return false;
  const summary = value as Record<string, unknown>;
  const pending = summary.pending_validation;
  return (
    typeof summary.stats === 'object' &&
    summary.stats !== null &&
    typeof pending === 'object' &&
    pending !== null &&
    SUMMARY_LISTS.every((key) => Array.isArray(summary[key]))
  );
};

const TrainingOfficerDashboard: React.FC = () => {
  const [data, setData] = useState<TrainingDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [enabled, setEnabled] = useState(loadTrainingWidgetPreferences);
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary: unknown = await trainingService.getDashboardSummary(90);
      if (!isDashboardSummary(summary)) {
        throw new TypeError('The training dashboard response was not a summary');
      }
      setData(summary);
    } catch {
      setError('Failed to load the dashboard. Check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  const toggle = (id: TrainingWidgetId) =>
    setEnabled((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      saveTrainingWidgetPreferences(next);
      return next;
    });

  return (
    <div data-page-main className="py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold sm:text-3xl">
            <GraduationCap className="h-8 w-8 shrink-0 text-red-700" aria-hidden="true" />
            Training Officer Dashboard
          </h1>
          <p className="text-theme-text-muted">
            Compliance, expiring certifications, hours, and what needs your attention
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            title="Refresh Data"
            aria-label="Refresh data"
            onClick={() => void fetchData()}
            className="bg-theme-input-bg btn-icon"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Dashboard Settings"
            aria-label="Dashboard settings"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((x) => !x)}
            className="bg-theme-input-bg btn-icon"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>
      {showSettings && (
        <section className="card mb-6 p-6">
          <h2 className="mb-4 font-semibold">Customize this training dashboard</h2>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {(
              Object.entries(TRAINING_WIDGET_METADATA) as [
                TrainingWidgetId,
                (typeof TRAINING_WIDGET_METADATA)[TrainingWidgetId],
              ][]
            ).map(([id, meta]) => (
              <label key={id} className="bg-theme-input-bg/50 flex cursor-pointer gap-3 rounded p-3">
                <input type="checkbox" checked={enabled[id]} onChange={() => toggle(id)} />
                <span>{meta.title}</span>
              </label>
            ))}
          </div>
        </section>
      )}
      {error && <div className="mb-6 rounded border border-red-500 p-4 text-red-700">{error}</div>}
      {loading && !data ? (
        <div role="status" className="text-theme-text-muted p-16 text-center">
          Loading training dashboard…
        </div>
      ) : (
        data && (
          <>
            <TrainingSetupGuide stats={data.stats} />
            <div className="grid gap-6 md:grid-cols-2">
              {(Object.keys(widgets) as TrainingWidgetId[])
                .filter((id) => enabled[id])
                .map((id) => {
                  const Widget = widgets[id];
                  return <Widget key={id} data={data} />;
                })}
            </div>
          </>
        )
      )}
    </div>
  );
};
export default TrainingOfficerDashboard;
