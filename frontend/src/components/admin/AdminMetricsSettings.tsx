import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ChevronLeft, ChevronRight, CircleDashed, GripVertical, Loader2, Lock, X } from 'lucide-react';
import { adminHubService } from '../../services/adminHubService';
import { getErrorMessage } from '../../utils/errorHandling';
import { ADMIN_METRIC_OPEN_SLOTS } from '../../types/adminHub';
import type { AdminMetricOption, AdminMetricSettings as Settings } from '../../types/adminHub';

/**
 * Choosing the four headline metrics for one administration page.
 *
 * Four slots, never more — the row is a glance, and a fifth card makes it a
 * report. Three are the admin's to choose and reorder; the fourth is the
 * attention count, which is what the page is for, so it is shown locked rather
 * than hidden.
 *
 * Metrics the department cannot produce yet are listed but not selectable, so
 * an admin can see what enabling a module would gain them rather than
 * wondering why something is missing.
 *
 * Changing metrics never changes the queue — exceptions are defined by the
 * module, not by this setting.
 */

interface AdminMetricsSettingsProps {
  moduleKey: string;
  /** Names the page in the heading, e.g. "Training". */
  moduleLabel: string;
  /** Permission the copy names as the audience, e.g. "training.manage". */
  permission: string;
  /** Called after a successful save, so the frame above can refetch. */
  onSaved?: (() => void) | undefined;
}

/** Slots that survive the two-column phone strip. */
const PHONE_SLOTS = 2;

const slotNote = (index: number): string => (index < PHONE_SLOTS ? `Slot ${index + 1} · phone` : `Slot ${index + 1}`);

export const AdminMetricsSettings: React.FC<AdminMetricsSettingsProps> = ({
  moduleKey,
  moduleLabel,
  permission,
  onSaved,
}) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [appliesToEveryone, setAppliesToEveryone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminHubService.getMetricSettings(moduleKey);
      setSettings(data);
      setSelected(data.selected);
      setAppliesToEveryone(data.appliesToEveryone);
      setLoadError(null);
    } catch (err: unknown) {
      setSettings(null);
      setLoadError(getErrorMessage(err, 'Could not load the metric options.'));
    } finally {
      setLoading(false);
    }
  }, [moduleKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = (key: string): AdminMetricOption | undefined => settings?.options.find((o) => o.key === key);

  const openSlotsUsed = selected.length;
  const dirty =
    settings !== null &&
    (appliesToEveryone !== settings.appliesToEveryone ||
      selected.length !== settings.selected.length ||
      selected.some((key, index) => settings.selected[index] !== key));

  const removeSlot = (key: string) => setSelected((current) => current.filter((k) => k !== key));

  const addToSlot = (key: string) => {
    setSelected((current) => (current.length >= ADMIN_METRIC_OPEN_SLOTS ? current : [...current, key]));
  };

  const moveTo = (key: string, targetIndex: number) => {
    setSelected((current) => {
      const from = current.indexOf(key);
      if (from === -1 || from === targetIndex) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(targetIndex, 0, key);
      return next;
    });
  };

  const resetToDepartment = () => {
    if (!settings) return;
    const fallback = settings.departmentDefault.length > 0 ? settings.departmentDefault : settings.builtInDefault;
    setSelected(fallback);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await adminHubService.updateMetricSettings(moduleKey, {
        // Both fields, every save — the screen owns them together.
        metricKeys: selected,
        appliesToEveryone,
      });
      setSettings(saved);
      setSelected(saved.selected);
      setAppliesToEveryone(saved.appliesToEveryone);
      toast.success('Headline metrics saved');
      onSaved?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the headline metrics.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-6" aria-busy="true">
        <div className="shimmer-skeleton h-5 w-40 rounded" />
        <div className="shimmer-skeleton mt-3 h-24 w-full rounded" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="alert-danger">
        <p className="text-theme-alert-danger-title text-sm font-semibold">Headline metrics unavailable</p>
        <p className="text-theme-alert-danger-text mt-1 text-sm">{loadError}</p>
        <button type="button" onClick={() => void load()} className="btn-secondary btn-md mt-3 text-sm">
          Try again
        </button>
      </div>
    );
  }

  const chooseable = settings.options.filter((option) => !option.fixed);
  const fixedOption = settings.options.find((option) => option.fixed);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-5">
        {/* The four slots */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-theme-text-primary text-base font-bold">Headline metrics</h3>
              <p className="text-theme-text-muted mt-1 text-sm">
                Four slots, shown to everyone with <code className="text-xs">{permission}</code>. Reorder with the
                arrows — slots 1 and 2 are the two that fit on a phone.
              </p>
            </div>
            <button
              type="button"
              onClick={resetToDepartment}
              className="text-theme-text-secondary hover:text-theme-text-primary min-h-[44px] text-sm font-semibold underline"
            >
              Reset to default
            </button>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {selected.map((key, index) => {
              const option = byKey(key);
              if (!option) return null;
              return (
                <li
                  key={key}
                  draggable
                  onDragStart={() => setDragKey(key)}
                  onDragEnd={() => setDragKey(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragKey) moveTo(dragKey, index);
                    setDragKey(null);
                  }}
                  className={`card-secondary relative p-3 ${dragKey === key ? 'opacity-60' : ''}`}
                >
                  <div className="text-theme-text-muted flex items-center justify-between">
                    <GripVertical className="h-4 w-4 cursor-grab" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => removeSlot(key)}
                      aria-label={`Remove ${option.label} from slot ${index + 1}`}
                      className="btn-icon-sm hover:text-theme-text-primary"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="text-theme-text-muted truncate text-[11px] font-semibold tracking-[0.12em] uppercase">
                    {option.label}
                  </p>
                  <p className="text-theme-text-primary mt-0.5 text-2xl leading-none font-bold tabular-nums">
                    {option.value ?? '—'}
                  </p>
                  <p className="text-theme-text-muted mt-2 text-[11px]">{slotNote(index)}</p>

                  {/* Drag is the quick gesture; the arrows are the one that
                      works with a keyboard, a screen reader, or a thumb. */}
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveTo(key, Math.max(0, index - 1))}
                      disabled={index === 0}
                      aria-label={`Move ${option.label} earlier`}
                      className="btn-icon-sm border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTo(key, Math.min(selected.length - 1, index + 1))}
                      disabled={index === selected.length - 1}
                      aria-label={`Move ${option.label} later`}
                      className="btn-icon-sm border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}

            {fixedOption && (
              <li className="card-secondary border-theme-alert-danger-border relative p-3">
                <Lock className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                <p className="text-theme-text-muted mt-2 truncate text-[11px] font-semibold tracking-[0.12em] uppercase">
                  {fixedOption.label}
                </p>
                <p className="text-theme-text-primary mt-0.5 text-2xl leading-none font-bold tabular-nums">
                  {fixedOption.value ?? '—'}
                </p>
                <p className="text-theme-text-muted mt-2 text-[11px]">Slot 4 · fixed</p>
              </li>
            )}
          </ul>
        </section>

        {/* What this module offers */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-theme-text-primary text-base font-bold">Available in {moduleLabel}</h3>
            <p className="text-theme-text-muted text-sm">
              <span className="font-semibold tabular-nums">{openSlotsUsed}</span> of {ADMIN_METRIC_OPEN_SLOTS} open
              slots used
              {openSlotsUsed >= ADMIN_METRIC_OPEN_SLOTS && ' — remove one to add another'}
            </p>
          </div>

          <ul className="divide-theme-surface-border mt-3 divide-y">
            {chooseable.map((option) => {
              const slot = selected.indexOf(option.key);
              const inUse = slot !== -1;
              const unavailable = option.unavailableReason !== null;
              return (
                <li key={option.key} className="flex items-center gap-3 py-3">
                  {unavailable ? (
                    <Lock className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : inUse ? (
                    <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary text-sm font-semibold">{option.label}</p>
                    <p className="text-theme-text-muted text-xs">
                      {option.unavailableReason ?? option.description}
                      {!unavailable && option.value && (
                        <>
                          {' · currently '}
                          <span className="text-theme-text-secondary font-semibold tabular-nums">{option.value}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {unavailable ? (
                    <span className="badge bg-theme-surface-hover text-theme-text-muted shrink-0">Not available</span>
                  ) : inUse ? (
                    <span className="badge bg-theme-surface-hover text-theme-text-secondary shrink-0">
                      In slot {slot + 1}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToSlot(option.key)}
                      disabled={openSlotsUsed >= ADMIN_METRIC_OPEN_SLOTS}
                      className="btn-secondary btn-md shrink-0 text-sm disabled:opacity-40"
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Preview, audience, save */}
      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <h4 className="text-theme-text-muted text-[11px] font-bold tracking-[0.14em] uppercase">Preview</h4>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[...selected, ...(fixedOption ? [fixedOption.key] : [])].map((key) => {
              const option = byKey(key);
              if (!option) return null;
              return (
                <div key={key} className="card-secondary p-2">
                  <p className="text-theme-text-muted truncate text-[10px] font-semibold uppercase">{option.label}</p>
                  <p className="text-theme-text-primary text-lg leading-tight font-bold tabular-nums">
                    {option.value ?? '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-4">
          <h4 className="text-theme-text-muted text-[11px] font-bold tracking-[0.14em] uppercase">
            Who this applies to
          </h4>
          <div className="mt-3 flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={appliesToEveryone}
              onClick={() => setAppliesToEveryone((on) => !on)}
              className={`toggle-track-sm mt-0.5 ${appliesToEveryone ? 'bg-red-600' : 'bg-theme-surface-border'}`}
            >
              <span
                className={`toggle-knob-sm ${appliesToEveryone ? 'translate-x-6' : 'translate-x-1'}`}
                aria-hidden="true"
              />
            </button>
            <span className="text-theme-text-secondary text-sm">
              {appliesToEveryone
                ? 'Everyone who can see this page. Turn off to let each admin choose their own four.'
                : 'Each admin chooses their own four. Your selection is saved for you alone.'}
            </span>
          </div>
          <p className="text-theme-text-muted mt-3 text-xs">
            Changing metrics never changes the queue — exceptions are defined by the module, not by this setting.
          </p>
        </section>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="btn-primary flex items-center justify-center gap-2 text-sm font-semibold"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save metrics
        </button>
      </div>
    </div>
  );
};

export default AdminMetricsSettings;
