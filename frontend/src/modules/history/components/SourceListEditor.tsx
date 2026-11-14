/**
 * The department's managed list of sources and donors, like the title list:
 * an entry in use is retired (kept on the items that carry it, no longer
 * offered) or merged into another, never deleted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyMediaService } from '../services/api';
import type { HistorySource } from '../types';

export const SourceListEditor: React.FC = () => {
  const [sources, setSources] = useState<HistorySource[] | null>(null);
  const [name, setName] = useState('');
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    historyMediaService
      .listSources(true)
      .then(setSources)
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Unable to load the source list')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setSaving(true);
    try {
      await action();
      load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="sources-heading" className="card space-y-3 p-4">
      <h2 id="sources-heading" className="text-theme-text-primary text-lg font-semibold">
        Sources and donors
      </h2>
      <p className="text-theme-text-secondary text-sm">
        Where photos and recordings came from. A source in use cannot be deleted: retire it to stop offering it, or
        merge it into another to correct a duplicate.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            await historyMediaService.createSource(name.trim());
            setName('');
          }, 'Could not add this source');
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="form-label">Add a source</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} className="form-input" />
        </label>
        <button type="submit" disabled={saving || !name.trim()} className="btn-primary rounded-md px-3 py-2 text-sm">
          Add
        </button>
      </form>
      {sources && sources.length > 0 && (
        <ul className="divide-theme-surface-border divide-y text-sm">
          {sources.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span
                className={source.is_retired ? 'text-theme-text-secondary line-through' : 'text-theme-text-primary'}
              >
                {source.name}
                <span className="text-theme-text-secondary ml-2 text-xs">
                  {source.usage_count} {source.usage_count === 1 ? 'item' : 'items'}
                </span>
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void run(
                    () => historyMediaService.updateSource(source.id, { is_retired: !source.is_retired }),
                    'Could not save this source'
                  )
                }
                className="btn-secondary btn-sm rounded-md"
              >
                {source.is_retired ? 'Restore' : 'Retire'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sources && sources.length > 1 && (
        <div className="card-secondary grid gap-2 rounded-md p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label>
            <span className="form-label">Merge</span>
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="form-input">
              <option value="">Choose a source</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="form-label">Into</span>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="form-input">
              <option value="">Choose a source</option>
              {sources
                .filter((s) => s.id !== mergeFrom)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={saving || !mergeFrom || !mergeInto}
            onClick={() =>
              void run(async () => {
                await historyMediaService.mergeSource(mergeFrom, mergeInto);
                setMergeFrom('');
                setMergeInto('');
              }, 'Could not merge these sources')
            }
            className="btn-secondary rounded-md px-3 py-2 text-sm"
          >
            Merge
          </button>
        </div>
      )}
    </section>
  );
};
