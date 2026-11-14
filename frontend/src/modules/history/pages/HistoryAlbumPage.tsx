/**
 * One album. Members see the items in it they may read; keepers also rename
 * it, show it to members, choose its cover, and add, remove and reorder its
 * items.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowUp, FolderOpen, Search, Star, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { MediaTile } from '../components/MediaDetails';
import { historyMediaService } from '../services/api';
import type { AlbumDetail, MediaSummary } from '../types';

export const HistoryAlbumPage: React.FC = () => {
  const { albumId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);

  const load = useCallback(async () => {
    try {
      setAlbum(await historyMediaService.getAlbum(albumId));
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else toast.error(getErrorMessage(err, 'Unable to load this album.'));
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!album?.can_edit || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyMediaService
        .listMedia({ search: query.trim(), limit: 12 })
        .then((list) => {
          if (!cancelled) setResults(list.items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, album?.can_edit]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={FolderOpen}
          title="Album not found"
          description="This album does not exist or has not been shared."
          actions={[{ label: 'Back to albums', onClick: () => void navigate('/history/albums') }]}
        />
      </div>
    );
  }
  if (!album) return <SkeletonPage />;

  const save = async (action: () => Promise<AlbumDetail>, failure: string) => {
    setBusy(true);
    try {
      setAlbum(await action());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const ids = album.items.map((i) => i.id);
  const setItems = (next: string[]) =>
    save(() => historyMediaService.setAlbumItems(album.id, next), 'Could not save this album');
  const move = (index: number, by: number) => {
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    void setItems(next);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete album',
      message: `Delete "${album.name}"? Its photos and media stay in the archive.`,
      confirmLabel: 'Delete album',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyMediaService.deleteAlbum(album.id);
      void navigate('/history/albums');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this album'));
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Albums', path: '/history/albums' },
          { label: album.name },
        ]}
      />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <div>
          <h1 className="page-header-title text-theme-text-primary text-2xl font-bold">{album.name}</h1>
          {album.description && <p className="text-theme-text-secondary text-sm">{album.description}</p>}
        </div>
        {album.can_edit && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void save(
                  () =>
                    historyMediaService.updateAlbum(album.id, {
                      level: album.level === 'draft' ? 'members' : 'draft',
                    }),
                  'Could not save this album'
                )
              }
              className="btn-secondary rounded-md px-3 py-2 text-sm"
            >
              {album.level === 'draft' ? 'Show to members' : 'Return to draft'}
            </button>
            <button type="button" onClick={() => void remove()} className="btn-secondary rounded-md px-3 py-2 text-sm">
              Delete album
            </button>
          </div>
        )}
      </div>

      {album.can_edit && (
        <section className="card mb-4 p-4" aria-labelledby="album-add-heading">
          <h2 id="album-add-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            Add items
          </h2>
          <label className="relative block">
            <span className="sr-only">Find items</span>
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search photos and media by title or place"
              className="form-input pl-9"
            />
          </label>
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results
                .filter((r) => !ids.includes(r.id))
                .map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setItems([...ids, r.id])}
                      className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                    >
                      Add “{r.title}”
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {album.items.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Nothing in this album yet" description="" />
      ) : (
        <ul className="thumb-grid" aria-busy={busy}>
          {album.items.map((item, index) => (
            <li key={item.id} className="space-y-1">
              <MediaTile item={item} />
              {album.can_edit && (
                <div className="flex justify-center gap-1">
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${item.title} earlier`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    disabled={busy || index === album.items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${item.title} later`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {item.has_thumbnail && (
                    <button
                      type="button"
                      className="btn-icon touch-target-phone"
                      disabled={busy || album.cover_media_id === item.id}
                      aria-pressed={album.cover_media_id === item.id}
                      onClick={() =>
                        void save(
                          () => historyMediaService.updateAlbum(album.id, { cover_media_id: item.id }),
                          'Could not set the cover'
                        )
                      }
                      aria-label={`Use ${item.title} as the cover`}
                    >
                      <Star className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    disabled={busy}
                    onClick={() => void setItems(ids.filter((id) => id !== item.id))}
                    aria-label={`Remove ${item.title} from the album`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HistoryAlbumPage;
