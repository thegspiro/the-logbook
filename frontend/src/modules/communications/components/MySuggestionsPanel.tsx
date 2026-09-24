/**
 * The member's own named submissions. Anonymous ones never appear here —
 * nothing records who wrote them; the follow-up key tab is their way back.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronRight, Inbox, MessageSquare } from 'lucide-react';
import { EmptyState } from '../../../components/ux';
import { SUGGESTION_DISPOSITION_COLORS, SUGGESTION_DISPOSITION_LABELS } from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useScrollDetailIntoView } from '../hooks/useScrollDetailIntoView';
import { suggestionsService } from '../services/suggestionsService';
import type { MySuggestionSummary, SubmitterSuggestionDetail } from '../types/suggestions';
import SubmitterSuggestionView from './SubmitterSuggestionView';

interface MySuggestionsPanelProps {
  selectedId: string;
  onSelect: (id: string) => void;
  /** Bumped by the parent after a submission, to reload the list. */
  refreshToken: number;
}

const MySuggestionsPanel: React.FC<MySuggestionsPanelProps> = ({ selectedId, onSelect, refreshToken }) => {
  const tz = useTimezone();
  const [items, setItems] = useState<MySuggestionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SubmitterSuggestionDetail | null>(null);
  const detailRef = useScrollDetailIntoView<HTMLDivElement>(detail?.id);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    suggestionsService
      .listMine()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load your submissions. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    suggestionsService
      .getMine(selectedId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, 'Unable to open that submission.'));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const loadAttachment = useCallback(
    (attachmentId: string) => suggestionsService.getMineAttachment(selectedId, attachmentId),
    [selectedId]
  );

  const reply = async (body: string) => {
    try {
      setDetail(await suggestionsService.replyMine(selectedId, body));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to send your reply.'));
      throw err;
    }
  };

  if (isLoading) return <p className="text-theme-text-muted text-sm">Loading your submissions…</p>;
  if (error) {
    return (
      <p role="alert" className="alert-danger text-sm">
        {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No named submissions"
        description="Submissions you send with your name appear here. Anonymous ones are reached with their follow-up key."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={item.id === selectedId ? 'true' : undefined}
              className={`card flex w-full items-center justify-between gap-3 p-4 text-left max-md:min-h-[44px] ${
                item.id === selectedId ? 'border-l-theme-alert-info-icon border-l-4' : ''
              }`}
            >
              {/* Status and counts sit under the title — see SuggestionReviewPanel. */}
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block font-medium">{item.title}</span>
                <span className="text-theme-text-muted block text-xs">
                  {item.boxName} · {formatDateTime(item.createdAt, tz)}
                </span>
                {(item.disposition || item.messageCount > 0) && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {item.disposition && (
                      <span className={`badge ${SUGGESTION_DISPOSITION_COLORS[item.disposition] ?? ''}`}>
                        {SUGGESTION_DISPOSITION_LABELS[item.disposition] ?? item.disposition}
                      </span>
                    )}
                    {item.messageCount > 0 && (
                      <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                        {item.messageCount}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div ref={detailRef} className="scroll-mt-20">
        {detail ? (
          <SubmitterSuggestionView detail={detail} loadAttachment={loadAttachment} onReply={reply} />
        ) : (
          <p className="text-theme-text-muted text-sm">Select a submission to see it.</p>
        )}
      </div>
    </div>
  );
};

export default MySuggestionsPanel;
