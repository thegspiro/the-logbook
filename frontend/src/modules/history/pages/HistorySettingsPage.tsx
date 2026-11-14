/**
 * The module's two department-wide lists: historical titles, and the
 * clearance list a record passes before it is published to the public.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminPageHeader } from '../../../components/admin/AdminPageHeader';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import type { ClearanceStep, HistoryTitle } from '../types';
import { SourceListEditor } from '../components/SourceListEditor';

interface DraftStep {
  name: string;
  position_id: string;
}

export const HistorySettingsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const { checkPermission } = useAuthStore();
  const canEditTitles = checkPermission('history.manage');
  const [titles, setTitles] = useState<HistoryTitle[] | null>(null);
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [savedSteps, setSavedSteps] = useState<ClearanceStep[]>([]);
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [titleList, stepList, positionList] = await Promise.all([
        historyService.listTitles(true),
        historyService.listClearanceSteps(),
        historyService.listClearancePositions(),
      ]);
      setTitles(titleList);
      setSavedSteps(stepList);
      setSteps(stepList.map((s) => ({ name: s.name, position_id: s.position_id ?? '' })));
      setPositions(positionList);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to load the History settings'));
      setTitles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!titles) return <SkeletonPage />;

  const addTitle = async () => {
    if (!newTitle.trim()) return;
    try {
      await historyService.createTitle(newTitle);
      setNewTitle('');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not add the title'));
    }
  };

  const toggleRetired = async (title: HistoryTitle) => {
    try {
      await historyService.updateTitle(title.id, { is_retired: !title.is_retired });
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the title'));
    }
  };

  const rename = async (title: HistoryTitle, name: string) => {
    if (!name.trim() || name.trim() === title.name) return;
    try {
      await historyService.updateTitle(title.id, { name });
      toast.success('Renamed on every record that uses it');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not rename the title'));
      await load();
    }
  };

  const merge = async () => {
    const from = titles.find((t) => t.id === mergeFrom);
    const into = titles.find((t) => t.id === mergeInto);
    if (!from || !into) return;
    const ok = await confirm({
      title: 'Merge titles',
      message: `Move every record using "${from.name}" to "${into.name}", and remove "${from.name}" from the list?`,
      confirmLabel: 'Merge',
      cancelLabel: 'Keep both',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await historyService.mergeTitle(from.id, into.id);
      setMergeFrom('');
      setMergeInto('');
      toast.success('Titles merged');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not merge the titles'));
    }
  };

  const move = (index: number, by: number) =>
    setSteps((current) => {
      const next = [...current];
      const target = index + by;
      const moving = next[index];
      const other = next[target];
      if (!moving || !other) return current;
      next[index] = other;
      next[target] = moving;
      return next;
    });

  const saveSteps = async () => {
    if (steps.some((s) => !s.name.trim() || !s.position_id)) {
      toast.error('Give every step a name and a position');
      return;
    }
    const ok = await confirm({
      title: 'Save clearance list',
      message:
        steps.length === 0
          ? 'With no steps, anyone who can publish may publish to the public directly. The department’s administrators will be told of the change.'
          : 'The department’s administrators will be told of the change. Reviews already under way finish with the list they started with.',
      confirmLabel: 'Save list',
      cancelLabel: 'Keep editing',
      variant: 'info',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await historyService.replaceClearanceSteps(
        steps.map((s) => ({ name: s.name.trim(), position_id: s.position_id }))
      );
      toast.success('Clearance list saved');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the clearance list'));
    } finally {
      setSaving(false);
    }
  };

  const active = titles.filter((t) => !t.is_retired);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader title="Titles and Clearance" />

      <section aria-labelledby="clearance-heading" className="card space-y-3 p-4">
        <h2 id="clearance-heading" className="text-theme-text-primary text-lg font-semibold">
          Clearance list
        </h2>
        <p className="text-theme-text-secondary text-sm">
          Each step names a position; any one member holding it clears the step. Records pass every step, in order,
          before they are published to the public. Publishing to members needs no clearance.
        </p>
        {savedSteps.some((s) => s.blocked) && (
          <p className="alert-warning rounded-md p-3 text-sm">
            A step names a position that no longer exists. Choose another position for it.
          </p>
        )}
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={index} className="card-secondary flex flex-wrap items-end gap-2 rounded-md p-3">
              <label className="min-w-0 flex-1">
                <span className="form-label">Step {index + 1}</span>
                <input
                  value={step.name}
                  maxLength={150}
                  onChange={(e) =>
                    setSteps((current) => current.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)))
                  }
                  className="form-input"
                />
              </label>
              <label className="min-w-0 flex-1">
                <span className="form-label">Cleared by</span>
                <select
                  value={step.position_id}
                  onChange={(e) =>
                    setSteps((current) =>
                      current.map((s, i) => (i === index ? { ...s, position_id: e.target.value } : s))
                    )
                  }
                  className="form-input"
                >
                  <option value="">Choose a position</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1 rounded-md"
            onClick={() => setSteps((current) => [...current, { name: '', position_id: '' }])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add a step
          </button>
          <button
            type="button"
            className="btn-primary btn-sm rounded-md"
            disabled={saving}
            onClick={() => void saveSteps()}
          >
            Save clearance list
          </button>
        </div>
      </section>

      <section aria-labelledby="titles-heading" className="card space-y-3 p-4">
        <h2 id="titles-heading" className="text-theme-text-primary text-lg font-semibold">
          Historical titles
        </h2>
        <p className="text-theme-text-secondary text-sm">
          Renaming a title corrects it on every record. A retired title stays on the records that carry it but is no
          longer offered. A title in use is merged into another rather than deleted.
        </p>
        {canEditTitles && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="form-label">New title</span>
              <input
                value={newTitle}
                maxLength={150}
                onChange={(e) => setNewTitle(e.target.value)}
                className="form-input"
              />
            </label>
            <button type="button" className="btn-secondary rounded-md px-3 py-2" onClick={() => void addTitle()}>
              Add title
            </button>
          </div>
        )}
        <ul className="divide-theme-surface-border divide-y">
          {titles.map((title) => (
            <li key={title.id} className="flex flex-wrap items-center gap-2 py-2">
              {canEditTitles ? (
                <input
                  defaultValue={title.name}
                  key={`${title.id}-${title.name}`}
                  aria-label={`Rename ${title.name}`}
                  maxLength={150}
                  onBlur={(e) => void rename(title, e.target.value)}
                  className="form-input min-w-0 flex-1"
                />
              ) : (
                <span className="text-theme-text-primary flex-1">{title.name}</span>
              )}
              <span className="text-theme-text-secondary text-sm">
                {title.usage_count} {title.usage_count === 1 ? 'record' : 'records'}
                {title.is_retired ? ' · retired' : ''}
              </span>
              {canEditTitles && (
                <button
                  type="button"
                  className="btn-secondary btn-sm rounded-md"
                  onClick={() => void toggleRetired(title)}
                >
                  {title.is_retired ? 'Restore' : 'Retire'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEditTitles && titles.length > 1 && (
          <div className="card-secondary flex flex-wrap items-end gap-2 rounded-md p-3">
            <label className="min-w-0 flex-1">
              <span className="form-label">Merge</span>
              <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="form-input">
                <option value="">Choose a title</option>
                {titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="form-label">Into</span>
              <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="form-input">
                <option value="">Choose a title</option>
                {active
                  .filter((t) => t.id !== mergeFrom)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary rounded-md px-3 py-2"
              disabled={!mergeFrom || !mergeInto}
              onClick={() => void merge()}
            >
              Merge
            </button>
          </div>
        )}
      </section>

      <SourceListEditor />
    </div>
  );
};

export default HistorySettingsPage;
