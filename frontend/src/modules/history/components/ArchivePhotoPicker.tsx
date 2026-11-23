/**
 * Choose one photo from the archive: search by title, pick from thumbnails.
 * Only photos are offered (not recordings or films), which is all an article
 * can show; the server checks the same.
 */
import React, { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { historyMediaService, mediaFileUrl } from '../services/api';
import type { MediaSummary } from '../types';
import { PublicationBadge } from './PublicationBadge';

interface ArchivePhotoPickerProps {
  /** Labels the search box, so two pickers on a page can be told apart. */
  label: string;
  onPick: (media: MediaSummary) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export const ArchivePhotoPicker: React.FC<ArchivePhotoPickerProps> = ({
  label,
  onPick,
  onCancel,
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyMediaService
        .listMedia({ search: query.trim() || undefined, kind: 'photo', limit: 12 })
        .then((list) => {
          if (cancelled) return;
          setResults(list.items);
          setSearched(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="card-secondary space-y-3 rounded-md p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-[1_1_14rem]">
          <span className="form-label">{label}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the archive's photos"
            className="form-input"
            disabled={disabled}
          />
        </label>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary rounded-md px-3 py-2 text-sm">
            Cancel
          </button>
        )}
      </div>
      {searched && results.length === 0 && <p className="text-theme-text-secondary text-sm">No photos found.</p>}
      {results.length > 0 && (
        <ul className="thumb-grid" aria-label="Photos to choose from">
          {results.map((media) => (
            <li key={media.id}>
              <button
                type="button"
                onClick={() => onPick(media)}
                disabled={disabled}
                className="group w-full text-left"
                aria-label={`Choose ${media.title}`}
              >
                <span className="bg-theme-surface-secondary flex aspect-square w-full items-center justify-center overflow-hidden rounded-md">
                  {media.has_thumbnail ? (
                    <img
                      src={mediaFileUrl(media.id, 'thumbnail')}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="text-theme-text-muted h-8 w-8" aria-hidden="true" />
                  )}
                </span>
                <span className="text-theme-text-primary mt-1 block text-sm break-words group-hover:underline">
                  {media.title}
                </span>
                {media.publication_level !== 'public' && <PublicationBadge level={media.publication_level} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
