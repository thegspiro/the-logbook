/**
 * Albums: named groups of photos and media. Members see albums shown to
 * members, each counting only the items they may read; keepers also see
 * drafts and create albums.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FolderOpen, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyMediaService, mediaFileUrl } from '../services/api';
import type { AlbumSummary } from '../types';

export const HistoryAlbumsPage: React.FC = () => {
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    historyMediaService
      .listAlbums()
      .then((list) => {
        setAlbums(list);
        setError(null);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load albums.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const album = await historyMediaService.createAlbum({ name: name.trim() });
      void navigate(`/history/albums/${album.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not create this album'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Photos and media', path: '/history/media' },
          { label: 'Albums' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
        <FolderOpen className="h-6 w-6 shrink-0" aria-hidden="true" />
        Albums
      </h1>

      {canManage && (
        <form onSubmit={(e) => void create(e)} className="card mb-4 flex flex-wrap items-end gap-2 p-4">
          <label className="min-w-0 flex-1">
            <span className="form-label">New album</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="1962 Parade"
              className="form-input"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create
          </button>
        </form>
      )}

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && albums.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No albums yet"
          description={canManage ? 'Create an album to group photos.' : 'Nothing has been shared yet.'}
        />
      ) : (
        <ul className="card-grid [--card-grid-min:18rem]" aria-busy={loading}>
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                to={`/history/albums/${album.id}`}
                className="card card-hover border-theme-surface-border block overflow-hidden"
              >
                <div className="bg-theme-surface-secondary flex aspect-video items-center justify-center">
                  {album.cover_media_id ? (
                    <img
                      src={mediaFileUrl(album.cover_media_id, 'thumbnail')}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FolderOpen className="text-theme-text-secondary h-10 w-10" aria-hidden="true" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-theme-text-primary font-medium">{album.name}</p>
                  <p className="text-theme-text-secondary text-sm">
                    {album.item_count} {album.item_count === 1 ? 'item' : 'items'}
                    {canManage && album.level === 'draft' && ' · Draft'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HistoryAlbumsPage;
