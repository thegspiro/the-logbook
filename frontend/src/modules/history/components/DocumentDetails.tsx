/**
 * A document and its catalogue, as anyone allowed to read it sees it, and its
 * tile in a list. Everything shown is the server's stripped copy, never the
 * original: a PDF rebuilt without metadata, scripts or attachments, or a
 * scan's WebP.
 *
 * A PDF opens in the browser's own viewer, in a tab of its own: the app is
 * served with frame-ancestors 'none', so a PDF cannot be shown inside a page
 * here, and the copy it opens has been rebuilt without its scripts. The page
 * shows the first-page preview instead.
 */
import React from 'react';
import { Link } from 'react-router';
import { ApparatusLinks } from './ApparatusDetails';
import { LinkedEventsList } from './LinkedEventsList';
import { ExternalLink, FileImage, FileText } from 'lucide-react';
import { documentFileUrl } from '../services/api';
import type { DocumentKind, DocumentMemberView, DocumentSummary, DocumentView } from '../types';
import { formatPartialDate } from '../utils/historyFormat';

const KIND_ICON: Record<DocumentKind, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  image: FileImage,
};

const pagesLabel = (count: number | null): string => (count && count > 1 ? `${count} pages` : '');

/** One tile in a list: the first page's preview, or an icon. */
export const DocumentTile: React.FC<{ item: DocumentSummary }> = ({ item }) => {
  const Icon = KIND_ICON[item.kind];
  const when = formatPartialDate(item.taken_date, item.taken_date_precision, item.taken_date_circa);
  const detail = [item.document_type_name, when, pagesLabel(item.page_count)].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/history/documents/${item.id}`}
      className="group card-hover border-theme-surface-border block overflow-hidden rounded-md border"
    >
      <div className="bg-theme-surface-secondary flex aspect-[3/4] items-center justify-center">
        {item.has_thumbnail ? (
          <img
            src={documentFileUrl(item.id, 'thumbnail')}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <Icon className="text-theme-text-secondary h-10 w-10" aria-hidden="true" />
        )}
      </div>
      <div className="p-2">
        <p className="text-theme-text-primary line-clamp-2 text-sm font-medium">{item.title}</p>
        {detail && <p className="text-theme-text-secondary text-xs">{detail}</p>}
      </div>
    </Link>
  );
};

/** The preview and the way to open the document. */
export const DocumentViewer: React.FC<{ item: DocumentView | DocumentMemberView }> = ({ item }) => {
  const viewUrl = documentFileUrl(item.id, 'view');
  return (
    <div className="space-y-3">
      <a
        href={viewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-theme-surface-secondary mx-auto block max-w-md overflow-hidden rounded-md"
        aria-label={`Open ${item.title}`}
      >
        {item.has_thumbnail ? (
          <img
            src={item.kind === 'image' ? viewUrl : documentFileUrl(item.id, 'thumbnail')}
            alt={`First page of ${item.title}`}
            className="mx-auto h-auto max-h-[70vh] w-auto max-w-full object-contain"
          />
        ) : (
          <span className="flex aspect-[3/4] items-center justify-center">
            <FileText className="text-theme-text-secondary h-12 w-12" aria-hidden="true" />
          </span>
        )}
      </a>
      <div className="flex justify-center">
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open{item.kind === 'pdf' ? ' the PDF' : ' full size'}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
};

export const DocumentDetails: React.FC<{ item: DocumentView | DocumentMemberView }> = ({ item }) => {
  const when = formatPartialDate(item.taken_date, item.taken_date_precision, item.taken_date_circa);
  const rows: [string, string | null][] = [
    ['Type', item.document_type_name],
    ['Date', when || null],
    ['Pages', item.page_count ? String(item.page_count) : null],
    ['Author or sender', item.author],
    ['Recipient', item.recipient],
    ['Place', item.place],
    ['Source or donor', item.source_name],
    ['Rights', item.rights_note],
    ['Accession number', item.accession_number],
    ['Original kept at', item.original_location],
  ];
  return (
    <div className="space-y-4">
      <DocumentViewer item={item} />
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
      {item.transcription && (
        <section aria-labelledby="document-transcription-heading">
          <h2 id="document-transcription-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
            Transcription
          </h2>
          <p className="text-theme-text-primary card-secondary rounded-md p-3 text-sm whitespace-pre-wrap">
            {item.transcription}
          </p>
        </section>
      )}
      {item.tags.length > 0 && (
        <section aria-labelledby="document-people-heading">
          <h2 id="document-people-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
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
      <ApparatusLinks apparatus={item.apparatus} headingId="document-apparatus-heading" />
      {item.events.length > 0 && (
        <section aria-labelledby="document-events-heading">
          <h2 id="document-events-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
            Events
          </h2>
          <LinkedEventsList events={item.events} />
        </section>
      )}
    </div>
  );
};
