/**
 * Photos, documents or events a record links to, found by searching the
 * archive. Their order is the order they are added.
 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { historyDocumentService, historyEventService, historyMediaService } from '../services/api';
import type { LinkedRecord } from '../utils/eventCatalogue';

interface RecordLinksPickerProps {
  kind: 'media' | 'document' | 'event';
  value: LinkedRecord[];
  onChange: (next: LinkedRecord[]) => void;
  disabled?: boolean;
}

const LABELS = {
  media: { list: 'Linked photos and media', add: 'Add a photo, recording or film' },
  document: { list: 'Linked documents', add: 'Add a document' },
  event: { list: 'Linked events', add: 'Add an event' },
};

export const RecordLinksPicker: React.FC<RecordLinksPickerProps> = ({ kind, value, onChange, disabled = false }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinkedRecord[]>([]);
  const labels = LABELS[kind];

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const search = { search: query.trim(), limit: 10 };
      const request =
        kind === 'media'
          ? historyMediaService.listMedia(search).then((list) => list.items)
          : kind === 'event'
            ? historyEventService.listEvents(search).then((list) => list.items)
            : historyDocumentService.listDocuments(search).then((list) => list.items);
      request
        .then((items) => {
          if (!cancelled) setResults(items.map((item) => ({ id: item.id, label: item.title })));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, kind]);

  const chosen = new Set(value.map((r) => r.id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1" aria-label={labels.list}>
          {value.map((record) => (
            <li key={record.id} className="flex items-center gap-2 text-sm">
              <span className="text-theme-text-primary min-w-0 flex-1 break-words">{record.label}</span>
              <button
                type="button"
                className="btn-icon touch-target-phone"
                aria-label={`Remove ${record.label}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((r) => r.id !== record.id))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        <span className="form-label">{labels.add}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the archive"
          className="form-input"
          disabled={disabled}
        />
      </label>
      {results.length > 0 && (
        <ul className="space-y-1">
          {results
            .filter((record) => !chosen.has(record.id))
            .map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                  onClick={() => {
                    onChange([...value, record]);
                    setQuery('');
                    setResults([]);
                  }}
                >
                  {record.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};
