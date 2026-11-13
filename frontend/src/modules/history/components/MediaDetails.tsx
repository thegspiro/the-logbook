/**
 * A photo, recording or video and its catalogue, as anyone allowed to read it
 * sees it. A photo is always the server's stripped viewing copy; audio and
 * video play from the server, which answers range requests so they can seek.
 * The research notes and the original file are not part of this — a member's
 * payload does not carry them at all.
 */
import React from 'react';
import { Link } from 'react-router';
import { FileAudio, FileVideo, Image as ImageIcon } from 'lucide-react';
import { mediaFileUrl } from '../services/api';
import type { MediaKind, MediaSummary, MediaView } from '../types';
import { formatPartialDate } from '../utils/historyFormat';

export const MediaPlayer: React.FC<{ item: MediaView }> = ({ item }) => {
  const src = mediaFileUrl(item.id, 'view');
  if (item.kind === 'photo') {
    return (
      <img
        src={src}
        alt={item.title}
        width={item.width ?? undefined}
        height={item.height ?? undefined}
        className="bg-theme-surface-secondary mx-auto h-auto max-h-[75vh] w-auto max-w-full rounded-md object-contain"
      />
    );
  }
  if (item.kind === 'audio') {
    return (
      <audio controls preload="metadata" src={src} aria-label={item.title} className="w-full">
        Your browser cannot play this recording.
      </audio>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      src={src}
      aria-label={item.title}
      className="max-h-[75vh] w-full rounded-md bg-black"
    >
      Your browser cannot play this video.
    </video>
  );
};

const KIND_ICON: Record<MediaKind, React.ComponentType<{ className?: string }>> = {
  photo: ImageIcon,
  audio: FileAudio,
  video: FileVideo,
};

/** One tile in a gallery: the thumbnail of a photo, an icon for the rest. */
export const MediaTile: React.FC<{ item: MediaSummary }> = ({ item }) => {
  const Icon = KIND_ICON[item.kind];
  const when = formatPartialDate(item.taken_date, item.taken_date_precision, item.taken_date_circa);
  return (
    <Link
      to={`/history/media/${item.id}`}
      className="group card-hover border-theme-surface-border block overflow-hidden rounded-md border"
    >
      <div className="bg-theme-surface-secondary flex aspect-square items-center justify-center">
        {item.has_thumbnail ? (
          <img src={mediaFileUrl(item.id, 'thumbnail')} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Icon className="text-theme-text-secondary h-10 w-10" aria-hidden="true" />
        )}
      </div>
      <div className="p-2">
        <p className="text-theme-text-primary line-clamp-2 text-sm font-medium">{item.title}</p>
        {when && <p className="text-theme-text-secondary text-xs">{when}</p>}
      </div>
    </Link>
  );
};

export const MediaDetails: React.FC<{ item: MediaView }> = ({ item }) => {
  const when = formatPartialDate(item.taken_date, item.taken_date_precision, item.taken_date_circa);
  const rows: [string, string | null][] = [
    ['Date', when || null],
    ['Place', item.place],
    ['Photographer or creator', item.creator],
    ['Source or donor', item.source_name],
    ['Rights', item.rights_note],
    ['Accession number', item.accession_number],
    ['Original kept at', item.original_location],
  ];
  return (
    <div className="space-y-4">
      <MediaPlayer item={item} />
      {item.description && <p className="text-theme-text-primary text-sm whitespace-pre-line">{item.description}</p>}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-theme-text-secondary font-medium">{label}</dt>
              <dd className="text-theme-text-primary">{value}</dd>
            </React.Fragment>
          ))}
      </dl>
      {item.tags.length > 0 && (
        <section aria-labelledby="media-people-heading">
          <h2 id="media-people-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
            People
          </h2>
          <ul className="flex flex-wrap gap-2">
            {item.tags.map((tag) => (
              <li key={tag.member_id}>
                <Link
                  to={`/history/people/${tag.member_id}`}
                  className="badge touch-target-phone inline-flex items-center underline-offset-2 hover:underline"
                >
                  {tag.display_name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
