/**
 * The documents a person is tagged in that the viewer may read: the server
 * filters, so a member never sees a draft here.
 */
import React, { useEffect, useState } from 'react';
import { historyDocumentService } from '../services/api';
import type { DocumentSummary } from '../types';
import { DocumentTile } from './DocumentDetails';

export const PersonDocumentsStrip: React.FC<{ personId: string }> = ({ personId }) => {
  const [items, setItems] = useState<DocumentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    historyDocumentService
      .personDocuments(personId)
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
    <section aria-labelledby="person-documents-heading">
      <h2 id="person-documents-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
        Documents
      </h2>
      <ul className="thumb-grid">
        {items.map((item) => (
          <li key={item.id}>
            <DocumentTile item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
};
