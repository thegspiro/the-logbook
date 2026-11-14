/**
 * The titles a file uses that the department's list does not already hold.
 *
 * Each one is mapped to a title on the list, added as a new title, or
 * dropped. The answer is remembered, so next year's file is not asked again.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import type { HistoryTitle, ImportTitle, ImportTitleChoice, TitleAction } from '../types';

interface ImportTitlesPanelProps {
  titles: ImportTitle[];
  list: HistoryTitle[];
  disabled: boolean;
  onSave: (choices: ImportTitleChoice[]) => Promise<void>;
}

const STATUS_TEXT: Record<ImportTitle['status'], string> = {
  known: 'On the list',
  mapped: 'Uses an existing title',
  create: 'Will be added as a new title',
  dropped: 'Will be dropped',
  unresolved: 'Needs an answer',
};

/** The select's value: "create", "drop", or "map:<title id>". */
function initialValue(title: ImportTitle): string {
  if (title.status === 'create') return 'create';
  if (title.status === 'dropped') return 'drop';
  if (title.status === 'mapped' && title.title_id) return `map:${title.title_id}`;
  return '';
}

export const ImportTitlesPanel: React.FC<ImportTitlesPanelProps> = ({ titles, list, disabled, onSave }) => {
  const answerable = useMemo(() => titles.filter((t) => t.status !== 'known'), [titles]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    // The draft reloads after every row decision; an answer picked here but
    // not yet saved must survive that, so only an empty choice takes the
    // server's value.
    setValues((prev) => Object.fromEntries(answerable.map((t) => [t.key, prev[t.key] || initialValue(t)])));
  }, [answerable]);

  if (answerable.length === 0) return null;

  const changed = answerable.filter((t) => (values[t.key] ?? '') !== initialValue(t) && values[t.key]);

  const save = () => {
    const choices: ImportTitleChoice[] = changed.map((t) => {
      const value = values[t.key] ?? '';
      if (value.startsWith('map:')) {
        return { text: t.text, action: 'map', title_id: value.slice(4) };
      }
      return { text: t.text, action: value as TitleAction };
    });
    void onSave(choices);
  };

  const unresolved = answerable.filter((t) => t.status === 'unresolved').length;

  return (
    <section className="card mb-4 p-4" aria-labelledby="import-titles-heading">
      <h2
        id="import-titles-heading"
        className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold"
      >
        <Tags className="h-5 w-5" aria-hidden="true" />
        Titles in this file
      </h2>
      <p className="text-theme-text-secondary mb-3 text-sm">
        {unresolved > 0
          ? `${unresolved} title${unresolved === 1 ? '' : 's'} are not on your list yet. Choose what each one is; your answer is remembered for later imports.`
          : 'Every title in this file has an answer. You can still change one.'}
      </p>
      <ul className="space-y-3">
        {answerable.map((title) => (
          <li
            key={title.key}
            className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-3"
          >
            <div>
              <p className="text-theme-text-primary font-medium">{title.text}</p>
              <p className="text-theme-text-secondary text-xs">{STATUS_TEXT[title.status]}</p>
            </div>
            <label>
              <span className="sr-only">What “{title.text}” is</span>
              <select
                value={values[title.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [title.key]: e.target.value }))}
                className="form-input"
                disabled={disabled}
              >
                <option value="">Choose…</option>
                <option value="create">Add “{title.text}” as a new title</option>
                <option value="drop">Drop it — don't record this title</option>
                <optgroup label="Use a title already on the list">
                  {list
                    .filter((t) => !t.is_retired)
                    .map((t) => (
                      <option key={t.id} value={`map:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={save}
        disabled={disabled || changed.length === 0}
        className="btn-primary mt-3 rounded-md px-3 py-2 text-sm font-medium"
      >
        Save title answers
      </button>
    </section>
  );
};
