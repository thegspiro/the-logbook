/**
 * Family links. A link is recorded once, read from this person ("is the parent
 * of"), and the other person's page shows it from their side automatically.
 */
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import {
  RELATION_TYPE_LABELS,
  type HistoricalMemberFullView,
  type HistoricalMemberSummary,
  type RelationType,
} from '../types';

interface RelationsEditorProps {
  person: HistoricalMemberFullView;
  onChanged: () => void;
}

export const RelationsEditor: React.FC<RelationsEditorProps> = ({ person, onChanged }) => {
  const { confirm } = useConfirm();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistoricalMemberSummary[]>([]);
  const [otherId, setOtherId] = useState('');
  const [relationType, setRelationType] = useState<RelationType>('parent_of');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyService
        .listPeople({ search: query.trim(), limit: 10 })
        .then((list) => {
          if (!cancelled) setResults(list.items.filter((p) => p.id !== person.id));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, person.id]);

  const add = async () => {
    if (!otherId) return;
    setSaving(true);
    try {
      await historyService.addRelation(person.id, otherId, relationType, label.trim() || undefined);
      toast.success('Family link added');
      setQuery('');
      setOtherId('');
      setLabel('');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not link these people'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (relationId: string, otherName: string) => {
    const ok = await confirm({
      title: 'Remove family link',
      message: `Remove the link between ${person.display_name} and ${otherName}? Both people stay in the archive.`,
      confirmLabel: 'Remove link',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await historyService.deleteRelation(relationId);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not remove the link'));
    }
  };

  return (
    <div className="space-y-3">
      {person.relations.length > 0 && (
        <ul className="divide-theme-surface-border divide-y">
          {person.relations.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-theme-text-primary text-sm">
                {r.other_display_name} <span className="text-theme-text-secondary">({r.relationship})</span>
              </span>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove the link to ${r.other_display_name}`}
                onClick={() => void remove(r.id, r.other_display_name)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          <span className="form-label">{person.display_name} is the…</span>
          <select
            value={relationType}
            onChange={(e) => setRelationType(e.target.value as RelationType)}
            className="form-input"
          >
            {(Object.keys(RELATION_TYPE_LABELS) as RelationType[]).map((t) => (
              <option key={t} value={t}>
                {RELATION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {relationType === 'other' && (
          <label>
            <span className="form-label">Relationship</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              placeholder="Uncle, cousin…"
              className="form-input"
            />
          </label>
        )}
        <label>
          <span className="form-label">Other person</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOtherId('');
            }}
            placeholder="Search the archive"
            className="form-input"
          />
        </label>
      </div>
      {results.length > 0 && !otherId && (
        <ul className="flex flex-wrap gap-2" aria-label="Matching people">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="btn-secondary btn-sm rounded-md"
                onClick={() => {
                  setOtherId(p.id);
                  setQuery(p.display_name);
                }}
              >
                {p.display_name}
                {p.service_years ? ` (${p.service_years})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn-primary btn-sm rounded-md"
        disabled={!otherId || saving || (relationType === 'other' && !label.trim())}
        onClick={() => void add()}
      >
        Add family link
      </button>
    </div>
  );
};
