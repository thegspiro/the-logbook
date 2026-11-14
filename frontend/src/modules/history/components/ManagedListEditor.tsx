/**
 * One of the department's managed lists (sources and donors, document types),
 * kept like the title list: an entry in use is retired (kept on the records
 * that carry it, no longer offered) or merged into another, never deleted.
 */
import React, { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';

export interface ManagedEntry {
  id: string;
  name: string;
  is_retired: boolean;
  usage_count: number;
}

export interface ManagedListApi {
  list: () => Promise<ManagedEntry[]>;
  create: (name: string) => Promise<unknown>;
  setRetired: (id: string, retired: boolean) => Promise<unknown>;
  merge: (id: string, intoId: string) => Promise<unknown>;
}

interface ManagedListEditorProps {
  title: string;
  description: string;
  /** The singular noun, lower case: "source", "document type". */
  noun: string;
  /** What an entry is used by, singular and plural: ["item", "items"]. */
  usage: [string, string];
  api: ManagedListApi;
}

export const ManagedListEditor: React.FC<ManagedListEditorProps> = ({ title, description, noun, usage, api }) => {
  const headingId = useId();
  const [entries, setEntries] = useState<ManagedEntry[] | null>(null);
  const [name, setName] = useState('');
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .list()
      .then(setEntries)
      .catch((err: unknown) => toast.error(getErrorMessage(err, `Unable to load the ${noun} list`)));
  }, [api, noun]);

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
    <section aria-labelledby={headingId} className="card space-y-3 p-4">
      <h2 id={headingId} className="text-theme-text-primary text-lg font-semibold">
        {title}
      </h2>
      <p className="text-theme-text-secondary text-sm">{description}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            await api.create(name.trim());
            setName('');
          }, `Could not add this ${noun}`);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="form-label">Add a {noun}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} className="form-input" />
        </label>
        <button type="submit" disabled={saving || !name.trim()} className="btn-primary rounded-md px-3 py-2 text-sm">
          Add
        </button>
      </form>
      {entries && entries.length > 0 && (
        <ul className="divide-theme-surface-border divide-y text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className={entry.is_retired ? 'text-theme-text-secondary line-through' : 'text-theme-text-primary'}>
                {entry.name}
                <span className="text-theme-text-secondary ml-2 text-xs">
                  {entry.usage_count} {entry.usage_count === 1 ? usage[0] : usage[1]}
                </span>
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void run(() => api.setRetired(entry.id, !entry.is_retired), `Could not save this ${noun}`)
                }
                className="btn-secondary btn-sm rounded-md"
              >
                {entry.is_retired ? 'Restore' : 'Retire'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {entries && entries.length > 1 && (
        <div className="card-secondary grid gap-2 rounded-md p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label>
            <span className="form-label">Merge</span>
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="form-input">
              <option value="">Choose a {noun}</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="form-label">Into</span>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="form-input">
              <option value="">Choose a {noun}</option>
              {entries
                .filter((entry) => entry.id !== mergeFrom)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={saving || !mergeFrom || !mergeInto}
            onClick={() =>
              void run(async () => {
                await api.merge(mergeFrom, mergeInto);
                setMergeFrom('');
                setMergeInto('');
              }, `Could not merge these ${noun}s`)
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
