/**
 * An article as anyone allowed to read it sees it: the body in order, then
 * what it links to and its sources. The server sends only the photos and links
 * the caller may open, so nothing here filters; a photo block with no photo
 * (the editor's view of one since withdrawn) is shown as a gap to fix.
 */
import React from 'react';
import { Link } from 'react-router';
import { RichText } from '../../../components/ux/RichText';
import { mediaFileUrl } from '../services/api';
import type { ArticleBlockView, ArticleView, MediaSummary } from '../types';
import { ApparatusLinks } from './ApparatusDetails';
import { DocumentTile } from './DocumentDetails';
import { LinkedEventsList } from './LinkedEventsList';

const SOURCE_PATHS = {
  document: (id: string) => `/history/documents/${id}`,
  event: (id: string) => `/history/events/${id}`,
  photo: (id: string) => `/history/media/${id}`,
};

const SOURCE_LABELS = { document: 'Document', event: 'Event', photo: 'Photo' };

const Photo: React.FC<{ media: MediaSummary; caption: string | null; half?: boolean }> = ({
  media,
  caption,
  half = false,
}) => (
  <figure className={half ? 'sm:w-1/2' : 'w-full'}>
    <Link to={`/history/media/${media.id}`} className="block">
      <img
        src={mediaFileUrl(media.id, 'view')}
        alt={caption || media.title}
        loading="lazy"
        className="w-full rounded-md"
      />
    </Link>
    {caption && <figcaption className="text-theme-text-secondary mt-1 text-sm italic">{caption}</figcaption>}
  </figure>
);

const Block: React.FC<{ block: ArticleBlockView }> = ({ block }) => {
  if (block.kind === 'text') {
    return <RichText content={block.html ?? ''} format="html" className="text-theme-text-primary" />;
  }
  if (!block.media) {
    return (
      <p className="alert-warning rounded-md p-3 text-sm">
        A photo here is no longer in the archive or no longer published. Edit the article to replace or remove it.
      </p>
    );
  }
  return <Photo media={block.media} caption={block.caption} half={block.size === 'half'} />;
};

export const ArticleDetails: React.FC<{ item: ArticleView }> = ({ item }) => {
  const linked = item.members.length + item.events.length + item.apparatus.length + item.documents.length > 0;
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        {item.subtitle && <p className="text-theme-text-secondary text-lg">{item.subtitle}</p>}
        {item.byline && <p className="text-theme-text-secondary text-sm italic">By {item.byline}</p>}
        {item.summary && <p className="text-theme-text-primary italic">{item.summary}</p>}
      </header>
      {item.cover && <Photo media={item.cover} caption={null} />}
      <div className="space-y-4">
        {item.blocks.map((block) => (
          <Block key={block.id} block={block} />
        ))}
      </div>

      {linked && (
        <section aria-labelledby="article-links-heading" className="space-y-3">
          <h2 id="article-links-heading" className="text-theme-text-primary text-lg font-semibold">
            In this article
          </h2>
          {item.members.length > 0 && (
            <div>
              <h3 className="text-theme-text-primary mb-1 text-base font-semibold">People</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {item.members.map((person) => (
                  <li key={person.member_id}>
                    <Link
                      to={`/history/people/${person.member_id}`}
                      className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center font-medium"
                    >
                      {person.display_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.events.length > 0 && (
            <div>
              <h3 className="text-theme-text-primary mb-1 text-base font-semibold">Events</h3>
              <LinkedEventsList events={item.events} />
            </div>
          )}
          <ApparatusLinks apparatus={item.apparatus} headingId="article-apparatus-heading" />
          {item.documents.length > 0 && (
            <div>
              <h3 className="text-theme-text-primary mb-2 text-base font-semibold">Documents</h3>
              <ul className="thumb-grid">
                {item.documents.map((document) => (
                  <li key={document.id}>
                    <DocumentTile item={document} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(item.sources.length > 0 || item.citations.length > 0) && (
        <section aria-labelledby="article-sources-heading">
          <h2 id="article-sources-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            Sources
          </h2>
          <ul className="text-theme-text-primary space-y-1 text-sm">
            {item.sources.map((source) => (
              <li key={`${source.kind}:${source.id}`}>
                <span className="font-medium">{SOURCE_LABELS[source.kind]}:</span>{' '}
                <Link
                  to={SOURCE_PATHS[source.kind](source.id)}
                  className="touch-target-phone link-underline inline-flex items-center"
                >
                  {source.title}
                </Link>{' '}
                <span className="text-theme-text-secondary">(department archive)</span>
              </li>
            ))}
            {item.citations.map((citation, index) => (
              <li key={`citation-${index}`}>{citation}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
};
