import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { dashboardService } from '../../services/api';
import type { DashboardWidgetData, DashboardWidgetDefinition } from '../../services/adminServices';

interface WidgetState {
  loading: boolean;
  error: boolean;
  data?: DashboardWidgetData;
}

/** Shared organization-widget host. Each widget owns its request lifecycle. */
const OrganizationWidgets: React.FC = () => {
  const navigate = useNavigate();
  const [available, setAvailable] = useState<DashboardWidgetDefinition[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, WidgetState>>({});
  const [registryError, setRegistryError] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  const loadWidget = useCallback(async (id: string) => {
    setStates((old) => ({ ...old, [id]: { ...old[id], loading: true, error: false } }));
    try {
      const data = await dashboardService.getWidgetData(id);
      setStates((old) => ({ ...old, [id]: { loading: false, error: false, data } }));
    } catch {
      setStates((old) => ({
        ...old,
        [id]: old[id]?.data ? { loading: false, error: true, data: old[id].data } : { loading: false, error: true },
      }));
    }
  }, []);

  const loadRegistry = useCallback(async () => {
    setRegistryError(false);
    try {
      const result = await dashboardService.getWidgetRegistry();
      setAvailable(result.widgets);
      setSelected(result.selected_widget_ids);
      result.selected_widget_ids.forEach((id) => void loadWidget(id));
    } catch {
      setRegistryError(true);
    }
  }, [loadWidget]);

  useEffect(() => void loadRegistry(), [loadRegistry]);

  const toggle = async (id: string) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setSelected(next);
    try {
      const result = await dashboardService.updateWidgetPreferences(next);
      setSelected(result.selected_widget_ids);
      if (result.selected_widget_ids.includes(id)) void loadWidget(id);
    } catch {
      void loadRegistry();
    }
  };

  if (registryError) {
    return (
      <div className="card p-5" role="alert">
        <p className="font-semibold">Organization widgets are unavailable</p>
        <button className="btn-primary mt-3 min-h-11 px-4" onClick={() => void loadRegistry()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Organization widgets">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-theme-text-muted text-sm">Your authorized operational overview.</p>
        <button
          type="button"
          className="btn-secondary inline-flex min-h-11 items-center gap-2 px-4"
          aria-expanded={customizing}
          onClick={() => setCustomizing((value) => !value)}
        >
          <Settings2 className="h-4 w-4" />
          Customize
        </button>
      </div>
      {customizing && (
        <fieldset className="card mb-4 grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="px-1 font-semibold">Visible widgets</legend>
          {available.map((widget) => (
            <label key={widget.id} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={selected.includes(widget.id)} onChange={() => void toggle(widget.id)} />
              {widget.title}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {selected.map((id) => {
          const widget = available.find((item) => item.id === id);
          if (!widget) return null;
          const state = states[id] ?? { loading: true, error: false };
          return (
            <article className="card min-w-0 p-5" key={id} data-widget-id={id}>
              <h4 className="text-theme-text-primary font-semibold">{widget.title}</h4>
              {state.loading && !state.data ? (
                <div className="text-theme-text-muted mt-5 flex items-center gap-2" role="status">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading
                </div>
              ) : state.error ? (
                <div className="mt-4" role="alert">
                  <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    Could not load this widget.
                  </p>
                  <button
                    className="mt-2 min-h-11 font-semibold text-red-700 dark:text-red-400"
                    onClick={() => void loadWidget(id)}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-theme-text-primary mt-3 text-3xl font-bold tabular-nums">{state.data?.value}</p>
                  <p className="text-theme-text-muted mt-1 text-sm">{state.data?.description}</p>
                </>
              )}
              <button
                className="text-theme-accent-red mt-3 inline-flex min-h-11 items-center gap-1 font-semibold"
                onClick={() => void navigate(widget.deep_link)}
              >
                View details <ChevronRight className="h-4 w-4" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default OrganizationWidgets;
