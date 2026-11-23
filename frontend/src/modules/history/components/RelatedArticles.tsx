/**
 * The "Articles" section on a person, event, apparatus, document or photo
 * page: the articles that link to it or show it, as far as the caller may read
 * them. Nothing is shown while there are none, so a record no article mentions
 * keeps its page as it was.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { historyArticleService } from '../services/api';
import type { ArticleQuery, ArticleSummary } from '../types';
import { PublicationBadge } from './PublicationBadge';

type RelatedQuery = Pick<ArticleQuery, 'member_id' | 'event_id' | 'apparatus_id' | 'document_id' | 'media_id'>;

export const RelatedArticles: React.FC<{ query: RelatedQuery; headingId: string; className?: string }> = ({
  query,
  headingId,
  className = 'card p-4',
}) => {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const { member_id, event_id, apparatus_id, document_id, media_id } = query;

  useEffect(() => {
    let cancelled = false;
    historyArticleService
      .relatedTo({ member_id, event_id, apparatus_id, document_id, media_id })
      .then((items) => {
        if (!cancelled) setArticles(items);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [member_id, event_id, apparatus_id, document_id, media_id]);

  if (articles.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="text-theme-text-primary mb-2 font-semibold">
        Articles
      </h2>
      <ul className="divide-theme-surface-border divide-y">
        {articles.map((article) => (
          <li key={article.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link
              to={`/history/articles/${article.id}`}
              className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center font-medium"
            >
              {article.title}
            </Link>
            {article.publication_level === 'draft' && <PublicationBadge level="draft" />}
          </li>
        ))}
      </ul>
    </section>
  );
};
