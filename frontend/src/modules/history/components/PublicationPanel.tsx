/**
 * Publication for a record the archive's keepers are looking at: where it
 * stands with the clearance list, and the publish and unpublish buttons. The
 * server decides whether the record may go public (`cleared_for_public`); the
 * buttons only follow it (CLAUDE.md pitfall #29).
 */
import React from 'react';
import { Link } from 'react-router';
import type { ClearanceRequest, PublicationLevel } from '../types';
import { ClearanceSteps } from './ClearanceSteps';

export interface PublishableRecord {
  id: string;
  publication_level: PublicationLevel;
  public_changes_pending: boolean;
  clearance: ClearanceRequest | null;
  clearance_required: boolean;
  cleared_for_public: boolean;
  can_edit: boolean;
  can_publish: boolean;
}

interface PublicationPanelProps {
  record: PublishableRecord;
  /** "event", "apparatus record": how the buttons and notes name it. */
  noun: string;
  busy: boolean;
  /** Runs one action, reporting success or failure; the page reloads after. */
  run: (action: 'submit' | 'members' | 'public' | 'draft') => void;
  headingId: string;
}

export const PublicationPanel: React.FC<PublicationPanelProps> = ({ record, noun, busy, run, headingId }) => {
  const latest = record.clearance;
  const pendingReview = latest?.status === 'pending';
  return (
    <section aria-labelledby={headingId} className="card space-y-3 p-4">
      <h2 id={headingId} className="text-theme-text-primary font-semibold">
        Publication
      </h2>
      {latest && <ClearanceSteps request={latest} />}
      {latest?.can_decide && (
        <Link to={`/history/clearance/${latest.id}`} className="btn-info btn-sm inline-block rounded-md">
          Review this {noun}
        </Link>
      )}
      {record.can_edit && record.clearance_required && !pendingReview && !record.cleared_for_public && (
        <button type="button" disabled={busy} className="btn-secondary btn-sm rounded-md" onClick={() => run('submit')}>
          Submit for public clearance
        </button>
      )}
      {record.can_publish && (
        <div className="flex flex-wrap gap-2">
          {record.publication_level === 'draft' && (
            <button
              type="button"
              disabled={busy}
              className="btn-primary btn-sm rounded-md"
              onClick={() => run('members')}
            >
              Publish to members
            </button>
          )}
          {(record.publication_level !== 'public' || record.public_changes_pending) && (
            <button
              type="button"
              disabled={busy || (record.clearance_required && !record.cleared_for_public)}
              className="btn-secondary btn-sm rounded-md"
              onClick={() => run('public')}
            >
              Publish to the public
            </button>
          )}
          {record.publication_level !== 'draft' && (
            <button
              type="button"
              disabled={busy}
              className="btn-secondary btn-sm rounded-md"
              onClick={() => run('draft')}
            >
              Return to draft
            </button>
          )}
        </div>
      )}
      {record.publication_level === 'public' && (
        <p className="text-theme-text-secondary text-xs">
          Public records appear on the department&apos;s own website when History → Titles, lists and clearance → Public
          website shows this kind of record.
        </p>
      )}
    </section>
  );
};
