/**
 * Screenshots on a suggestion. Each is fetched through the authenticated
 * client as a blob — a plain <img src> would carry no CSRF-bearing request,
 * and the key-holder route is a POST.
 */

import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { SuggestionAttachment } from '../types/suggestions';

interface SuggestionAttachmentsProps {
  attachments: SuggestionAttachment[];
  load: (attachmentId: string) => Promise<Blob>;
}

const SuggestionAttachments: React.FC<SuggestionAttachmentsProps> = ({ attachments, load }) => {
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void Promise.all(
      attachments.map(async (attachment) => {
        try {
          const blob = await load(attachment.id);
          const url = URL.createObjectURL(blob);
          created.push(url);
          return [attachment.id, url] as const;
        } catch {
          return [attachment.id, null] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments, load]);

  if (attachments.length === 0) return null;

  return (
    <div>
      <h3 className="text-theme-text-secondary mb-2 text-sm font-medium">Screenshots</h3>
      <ul className="flex flex-wrap gap-3">
        {attachments.map((attachment) => {
          const url = urls[attachment.id];
          return (
            <li key={attachment.id}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-theme-surface-border block overflow-hidden rounded-md border"
                >
                  <img src={url} alt={attachment.fileName} className="h-28 w-28 object-cover" />
                </a>
              ) : (
                <div
                  className="border-theme-surface-border text-theme-text-muted flex h-28 w-28 items-center justify-center rounded-md border"
                  aria-label={
                    url === null ? `${attachment.fileName} could not be loaded` : `Loading ${attachment.fileName}`
                  }
                >
                  <ImageOff className="h-6 w-6" aria-hidden="true" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default SuggestionAttachments;
