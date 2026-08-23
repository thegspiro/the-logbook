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
      setData(await trainingService.getDashboardSummary(90));
    } catch {
      setError('Unable to load training dashboard data. Please check your connection and refresh the page.');
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
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-3 text-3xl font-bold">
            <GraduationCap className="h-8 w-8 text-red-700" />
            Training Officer Dashboard
          </h1>
          <p className="text-theme-text-muted">Aggregated compliance, training, validation, and capacity signals</p>
        </div>
        <div className="flex gap-2">
          <button title="Refresh Data" onClick={() => void fetchData()} className="bg-theme-input-bg rounded-lg p-2">
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            title="Dashboard Settings"
            onClick={() => setShowSettings((x) => !x)}
            className="bg-theme-input-bg rounded-lg p-2"
          >
            <Settings className="h-5 w-5" />
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
          <div className="grid gap-6 md:grid-cols-2">
            {(Object.keys(widgets) as TrainingWidgetId[])
              .filter((id) => enabled[id])
              .map((id) => {
                const Widget = widgets[id];
                return <Widget key={id} data={data} />;
              })}
          </div>
        )
      )}
    </main>
  );
};
export default TrainingOfficerDashboard;
