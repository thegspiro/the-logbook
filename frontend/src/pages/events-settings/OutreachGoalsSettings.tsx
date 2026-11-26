/**
 * Events Settings → Outreach Goals: a department's yearly targets for
 * Outreach Impact's headline figures and its CRR counts (owner decisions,
 * 2026-11-24). Saves as it goes; there is no Save footer.
 *
 * Last year, this year and next year are offered: last year's to correct,
 * next year's to plan before January.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import {
  outreachGoalService,
  type OutreachGoalProgress,
  type OutreachGoalsResponse,
  type OutreachMetric,
} from '../../services/outreachGoalServices';
import { crrService } from '../../services/crrServices';
import type { CrrActivityType } from '../../types/crr';
import { useConfirm } from '../../contexts/ConfirmContext';
import { asArray } from '../../utils/asArray';
import { getErrorMessage } from '../../utils/errorHandling';
import GoalProgressBar from '../community-engagement/GoalProgressBar';

/** A figure a goal can target, as the picker offers it. */
interface FigureOption {
  /** "metric:events_held" or "measure:<id>", unique across both kinds. */
  key: string;
  label: string;
}

const TargetEditor: React.FC<{
  goal: OutreachGoalProgress;
  busy: boolean;
  onSave: (target: number) => void;
}> = ({ goal, busy, onSave }) => {
  const [value, setValue] = useState(String(goal.target));
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const id = `goal-target-${goal.id}`;
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && parsed !== goal.target) onSave(parsed);
      }}
    >
      <div>
        <label htmlFor={id} className="form-label">
          Target
        </label>
        <input
          id={id}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="form-input-sm w-28"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-secondary btn-sm" disabled={busy || !valid || parsed === goal.target}>
        Save
      </button>
    </form>
  );
};

const OutreachGoalsSettings: React.FC = () => {
  const { confirm } = useConfirm();
  const [data, setData] = useState<OutreachGoalsResponse | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [types, setTypes] = useState<CrrActivityType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [figure, setFigure] = useState('');
  const [target, setTarget] = useState('');

  // Only the latest load may land: a slow answer for the year chosen first
  // must not replace the year chosen after it.
  const latestLoad = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(async (chosen?: number) => {
    const ticket = ++latestLoad.current;
    try {
      const response = await outreachGoalService.list(chosen);
      if (ticket !== latestLoad.current) return;
      setData({ ...response, goals: asArray(response?.goals), metrics: asArray(response?.metrics) });
      setYear(response.year);
      setError(null);
      hasData.current = true;
    } catch (err: unknown) {
      if (ticket !== latestLoad.current) return;
      const message = getErrorMessage(err, 'Outreach goals could not be loaded.');
      // With a year already on screen, keep it and say the switch failed;
      // only a first load that fails has nothing to show but the error.
      if (hasData.current) toast.error(message);
      else setError(message);
    }
  }, []);

  useEffect(() => {
    void load();
    // The catalogue only supplies the counts to choose from; without it the
    // outreach figures can still be given goals.
    void crrService
      .getCatalogue()
      .then((catalogue) => setTypes(asArray(catalogue?.activity_types)))
      .catch(() => setTypes([]));
  }, [load]);

  const options = useMemo((): { title: string; figures: FigureOption[] }[] => {
    if (!data) return [];
    const taken = new Set(
      data.goals.map((g) => (g.measure_id ? `measure:${g.measure_id}` : `metric:${g.outreach_metric}`))
    );
    const groups = [
      {
        title: 'Outreach Impact',
        figures: data.metrics.map((m) => ({ key: `metric:${m.value}`, label: m.label })),
      },
      ...types
        .filter((t) => t.is_active)
        .map((t) => ({
          title: t.name,
          figures: t.measures.filter((m) => m.is_active).map((m) => ({ key: `measure:${m.id}`, label: m.label })),
        })),
    ];
    return groups
      .map((g) => ({ ...g, figures: g.figures.filter((f) => !taken.has(f.key)) }))
      .filter((g) => g.figures.length > 0);
  }, [data, types]);

  const run = async (work: () => Promise<OutreachGoalsResponse | void>, success: string, failure: string) => {
    setBusy(true);
    try {
      const response = await work();
      if (response) setData({ ...response, goals: asArray(response.goals), metrics: asArray(response.metrics) });
      else await load(year ?? undefined);
      toast.success(success);
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!year) return;
    const parsed = Number(target);
    if (!figure || !Number.isInteger(parsed) || parsed < 1) return;
    const [kind, value] = figure.split(':');
    const saved = await run(
      () =>
        outreachGoalService.create({
          year,
          target: parsed,
          measure_id: kind === 'measure' ? value : undefined,
          outreach_metric: kind === 'metric' ? (value as OutreachMetric) : undefined,
        }),
      'Goal set',
      'The goal could not be set'
    );
    if (saved) {
      setFigure('');
      setTarget('');
    }
  };

  const remove = async (goal: OutreachGoalProgress) => {
    const confirmed = await confirm({
      title: 'Remove this goal?',
      message: `The ${year} goal for ${goal.label} will be removed. The work counted toward it stays recorded.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });
    if (confirmed) {
      await run(() => outreachGoalService.remove(goal.id), 'Goal removed', 'The goal could not be removed');
    }
  };

  if (error) {
    return (
      <p className="text-theme-text-secondary text-sm" role="alert">
        {error}
      </p>
    );
  }
  if (!data || year === null) {
    return <p className="text-theme-text-muted text-sm">Loading goals…</p>;
  }

  const years = [data.current_year - 1, data.current_year, data.current_year + 1];
  const parsedTarget = Number(target);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary font-semibold">Outreach goals</h3>
        <p className="text-theme-text-muted text-sm">
          A target for the calendar year, for any Outreach Impact figure or CRR count. Outreach Impact and the Overview
          show how far each has got, and whether it is on pace.
        </p>
      </div>

      <div className="segmented-group flex flex-wrap gap-1" role="group" aria-label="Year">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={y === year}
            className={`touch:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium ${
              y === year ? 'bg-red-800 text-white' : 'text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
            onClick={() => void load(y)}
          >
            {y}
          </button>
        ))}
      </div>

      {data.goals.length ? (
        <ul className="space-y-3" aria-label={`Goals for ${year}`}>
          {data.goals.map((goal) => (
            <li key={goal.id} className="card-secondary space-y-3 p-3" aria-label={goal.label}>
              <GoalProgressBar goal={goal} yearComplete={data.year_complete} />
              <div className="flex flex-wrap items-end justify-between gap-3">
                <TargetEditor
                  key={`${goal.id}-${goal.target}`}
                  goal={goal}
                  busy={busy}
                  onSave={(next) =>
                    void run(
                      () => outreachGoalService.updateTarget(goal.id, next),
                      'Target saved',
                      'The target could not be saved'
                    )
                  }
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm inline-flex items-center gap-1"
                  disabled={busy}
                  onClick={() => void remove(goal)}
                  aria-label={`Remove the goal for ${goal.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-theme-text-muted text-sm">No goals set for {year}.</p>
      )}

      <form
        className="card-secondary space-y-3 p-3"
        aria-labelledby="goal-add-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h4 id="goal-add-heading" className="text-theme-text-primary text-sm font-semibold">
          Add a goal for {year}
        </h4>
        {options.length ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="goal-figure" className="form-label">
                Figure
              </label>
              <select
                id="goal-figure"
                className="form-input"
                value={figure}
                onChange={(e) => setFigure(e.target.value)}
              >
                <option value="">Choose a figure…</option>
                {options.map((group) => (
                  <optgroup key={group.title} label={group.title}>
                    {group.figures.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="goal-new-target" className="form-label">
                Target
              </label>
              <input
                id="goal-new-target"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className="form-input w-32"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary inline-flex items-center gap-1"
              disabled={busy || !figure || !Number.isInteger(parsedTarget) || parsedTarget < 1}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add goal</span>
            </button>
          </div>
        ) : (
          <p className="text-theme-text-muted text-sm">Every figure already has a goal for {year}.</p>
        )}
      </form>
    </div>
  );
};

export default OutreachGoalsSettings;
