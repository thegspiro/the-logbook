/**
 * The photos, recordings and videos a person is tagged in that the viewer may
 * read: the server filters, so a member never sees a draft here.
 */
import React, { useEffect, useState } from 'react';
import { historyMediaService } from '../services/api';
import type { MediaSummary } from '../types';
import { MediaTile } from './MediaDetails';

export const PersonMediaStrip: React.FC<{ personId: string }> = ({ personId }) => {
  const [items, setItems] = useState<MediaSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    historyMediaService
      .personMedia(personId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (items.length === 0) return null;
  return (
    <section aria-labelledby="person-media-heading">
      <h2 id="person-media-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
        Photos and media
      </h2>
      <ul className="thumb-grid">
        {items.map((item) => (
          <li key={item.id}>
            <MediaTile item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
};
