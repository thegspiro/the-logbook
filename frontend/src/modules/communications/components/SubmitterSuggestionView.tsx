/**
 * A submission as its author sees it — by session for a named submission,
 * by key for an anonymous one. Never shows the reviewers' internal note (the
 * type does not carry one).
 */

import React from 'react';
import { SUGGESTION_DISPOSITION_COLORS, SUGGESTION_DISPOSITION_LABELS } from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import type { SubmitterSuggestionDetail } from '../types/suggestions';
import { formatSuggestionTime } from '../utils/suggestionTime';
import SuggestionAttachments from './SuggestionAttachments';
import SuggestionThread from './SuggestionThread';

interface SubmitterSuggestionViewProps {
  detail: SubmitterSuggestionDetail;
  loadAttachment: (attachmentId: string) => Promise<Blob>;
  onReply: (body: string) => Promise<void>;
}

const SubmitterSuggestionView: React.FC<SubmitterSuggestionViewProps> = ({ detail, loadAttachment, onReply }) => {
  const tz = useTimezone();
  const disposition = detail.disposition ?? '';

  return (
    <article className="card space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-theme-text-primary text-lg font-semibold">{detail.title}</h2>
          {detail.followUpEnabled && disposition && (
            <span className={`badge ${SUGGESTION_DISPOSITION_COLORS[disposition] ?? ''}`}>
              {SUGGESTION_DISPOSITION_LABELS[disposition] ?? disposition}
            </span>
          )}
        </div>
        <p className="text-theme-text-muted text-xs">
          {detail.boxName} · {detail.isAnonymous ? 'Anonymous' : 'Named'} ·{' '}
          {formatSuggestionTime(detail.createdAt, detail.timestampPrecision, tz)}
        </p>
      </header>
      <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{detail.details}</p>
      <SuggestionAttachments attachments={detail.attachments} load={loadAttachment} />
      {detail.followUpEnabled ? (
        <SuggestionThread messages={detail.messages} onReply={onReply} anonymousLabel="You" />
      ) : (
        <p className="text-theme-text-muted text-sm">
          This box is one-way. Reviewers read every submission but do not reply or report a status.
        </p>
      )}
    </article>
  );
};

export default SubmitterSuggestionView;
