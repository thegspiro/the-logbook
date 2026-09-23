/**
 * The reviewers' queue: suggestions in boxes the member reviews, plus any
 * single suggestion forwarded to them. The backend decides both — this
 * screen does not filter anything itself.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronRight, Forward, Inbox, Loader2, MessageSquare, Paperclip, X } from 'lucide-react';
import { EmptyState } from '../../../components/ux';
import {
  SUGGESTION_DISPOSITION_COLORS,
  SUGGESTION_DISPOSITION_LABELS,
  SuggestionDisposition,
} from '../../../constants/enums';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { suggestionsService } from '../services/suggestionsService';
import type {
  ReviewFilter,
  ReviewSuggestionDetail,
  ReviewSuggestionSummary,
  SuggestionBoxPublic,
} from '../types/suggestions';
import { formatSuggestionTime } from '../utils/suggestionTime';
import SuggestionAttachments from './SuggestionAttachments';
import SuggestionForwardModal from './SuggestionForwardModal';
import SuggestionThread from './SuggestionThread';

const PAGE_SIZE = 25;
const DISPOSITIONS = Object.values(SuggestionDisposition);

interface SuggestionReviewPanelProps {
  boxes: SuggestionBoxPublic[];
  selectedId: string;
  onSelect: (id: string) => void;
}

interface ReviewDetailProps {
  detail: ReviewSuggestionDetail;
  onChange: (detail: ReviewSuggestionDetail) => void;
}

const ReviewDetail: React.FC<ReviewDetailProps> = ({ detail, onChange }) => {
  const tz = useTimezone();
  const [disposition, setDisposition] = useState<SuggestionDisposition>(detail.disposition);
  const [note, setNote] = useState(detail.internalNote ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);
  const { confirm } = useConfirm();

  useEffect(() => {
    setDisposition(detail.disposition);
    setNote(detail.internalNote ?? '');
  }, [detail.id, detail.disposition, detail.internalNote]);

  const loadAttachment = useCallback(
    (attachmentId: string) => suggestionsService.getReviewAttachment(detail.id, attachmentId),
    [detail.id]
  );

  const save = async () => {
    setIsSaving(true);
    try {
      // Both fields are sent every time: an emptied note must clear, not be
      // skipped (the update contract reads an omitted key as "leave alone").
      onChange(await suggestionsService.updateDisposition(detail.id, { disposition, internalNote: blankToNull(note) }));
      toast.success('Saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to save.'));
    } finally {
      setIsSaving(false);
    }
  };

  const withdraw = async (forwardId: string, name: string) => {
    const ok = await confirm({
      title: 'Withdraw forward?',
      message: `${name} will no longer be able to open this suggestion.`,
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      onChange(await suggestionsService.withdrawForward(detail.id, forwardId));
      toast.success('Forward withdrawn');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to withdraw the forward.'));
    }
  };

  const reply = async (body: string) => {
    try {
      onChange(await suggestionsService.replyAsReviewer(detail.id, body));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to send your reply.'));
      throw err;
    }
  };

  return (
    <article className="card space-y-4">
      <header className="space-y-1">
        <h2 className="text-theme-text-primary text-lg font-semibold">{detail.title}</h2>
        <p className="text-theme-text-muted text-xs">
          {detail.boxName} · {detail.isAnonymous ? 'Anonymous' : (detail.submitterName ?? 'Former member')} ·{' '}
          {formatSuggestionTime(detail.createdAt, detail.timestampPrecision, tz)}
        </p>
      </header>
      <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{detail.details}</p>
      <SuggestionAttachments attachments={detail.attachments} load={loadAttachment} />

      <section className="border-theme-surface-border space-y-3 border-t pt-4" aria-label="Disposition">
        <div>
          <label htmlFor="suggestion-disposition" className="form-label">
            Disposition
          </label>
          <select
            id="suggestion-disposition"
            className="form-input"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as SuggestionDisposition)}
          >
            {DISPOSITIONS.map((value) => (
              <option key={value} value={value}>
                {SUGGESTION_DISPOSITION_LABELS[value] ?? value}
              </option>
            ))}
          </select>
          {detail.followUpEnabled && !detail.isAnonymous && (
            <p className="text-theme-text-muted mt-1 text-xs">The submitter is emailed when the disposition changes.</p>
          )}
        </div>
        <div>
          <label htmlFor="suggestion-note" className="form-label">
            Internal note <span className="text-theme-text-muted font-normal">(reviewers only)</span>
          </label>
          <textarea
            id="suggestion-note"
            className="form-input"
            rows={3}
            maxLength={10000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {detail.dispositionUpdatedByName && detail.dispositionUpdatedAt && (
          <p className="text-theme-text-muted text-xs">
            Last set by {detail.dispositionUpdatedByName} · {formatDateTime(detail.dispositionUpdatedAt, tz)}
          </p>
        )}
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
          disabled={isSaving}
          onClick={() => void save()}
        >
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </button>
      </section>

      <section className="border-theme-surface-border space-y-2 border-t pt-4" aria-label="Forwarded to">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-theme-text-secondary text-sm font-medium">Forwarded to</h3>
          {detail.canForward && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
              onClick={() => setIsForwarding(true)}
            >
              <Forward className="h-4 w-4" aria-hidden="true" />
              Forward
            </button>
          )}
        </div>
        {detail.viaForward && (
          <p className="text-theme-text-muted text-xs">
            This suggestion was forwarded to you. You can review it, but only the box&apos;s reviewers can forward it.
          </p>
        )}
        {detail.forwards.length === 0 ? (
          <p className="text-theme-text-muted text-sm">Not forwarded.</p>
        ) : (
          <ul className="space-y-1">
            {detail.forwards.map((forward) => (
              <li key={forward.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-theme-text-primary">
                  {forward.name}
                  <span className="text-theme-text-muted text-xs">
                    {forward.kind === 'position' ? ' (position)' : ''}
                    {forward.forwardedByName ? ` · by ${forward.forwardedByName}` : ''}
                  </span>
                </span>
                {detail.canForward && (
                  <button
                    type="button"
                    className="btn-icon text-theme-text-muted"
                    aria-label={`Withdraw forward to ${forward.name}`}
                    onClick={() => void withdraw(forward.id, forward.name)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.followUpEnabled ? (
        <div className="border-theme-surface-border border-t pt-4">
          <SuggestionThread
            messages={detail.messages}
            onReply={detail.canFollowUp ? reply : undefined}
            anonymousLabel="Anonymous submitter"
          />
          {!detail.canFollowUp && (
            <p className="text-theme-text-muted mt-2 text-xs">
              This anonymous submission arrived before follow-up was turned on, so its author has no key to read a
              reply.
            </p>
          )}
        </div>
      ) : (
        <p className="text-theme-text-muted text-sm">This box is one-way: submitters do not see replies or status.</p>
      )}
      {isForwarding && (
        <SuggestionForwardModal
          detail={detail}
          onClose={() => setIsForwarding(false)}
          onForwarded={(updated) => {
            setIsForwarding(false);
            onChange(updated);
          }}
        />
      )}
    </article>
  );
};

const SuggestionReviewPanel: React.FC<SuggestionReviewPanelProps> = ({ boxes, selectedId, onSelect }) => {
  const tz = useTimezone();
  const [boxId, setBoxId] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('open');
  const [items, setItems] = useState<ReviewSuggestionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewSuggestionDetail | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await suggestionsService.listForReview({ boxId, disposition: filter, skip: 0, limit: PAGE_SIZE });
      setItems(page.items);
      setTotal(page.total);
    } catch {
      setError('Unable to load submissions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [boxId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    suggestionsService
      .getForReview(selectedId)
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

  const loadMore = async () => {
    setIsLoadingMore(true);
    try {
      const page = await suggestionsService.listForReview({
        boxId,
        disposition: filter,
        skip: items.length,
        limit: PAGE_SIZE,
      });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch {
      toast.error('Unable to load more submissions.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleChange = (updated: ReviewSuggestionDetail) => {
    setDetail(updated);
    setItems((current) =>
      current.map((item) =>
        item.id === updated.id
          ? { ...item, disposition: updated.disposition, messageCount: updated.messages.length }
          : item
      )
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="review-box" className="form-label">
            Box
          </label>
          <select id="review-box" className="form-input" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
            <option value="">All my boxes</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="review-filter" className="form-label">
            Status
          </label>
          <select
            id="review-filter"
            className="form-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value as ReviewFilter)}
          >
            <option value="open">Open (new or under review)</option>
            <option value="">All</option>
            {DISPOSITIONS.map((value) => (
              <option key={value} value={value}>
                {SUGGESTION_DISPOSITION_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          {isLoading ? (
            <p className="text-theme-text-muted text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing here" description="No submissions match these filters." />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    className={`card flex w-full items-start justify-between gap-3 p-3 text-left max-md:min-h-[44px] ${
                      item.id === selectedId ? 'border-l-theme-info border-l-4' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block font-medium">{item.title}</span>
                      <span className="text-theme-text-muted block text-xs">
                        {item.boxName} · {item.isAnonymous ? 'Anonymous' : (item.submitterName ?? 'Former member')} ·{' '}
                        {formatSuggestionTime(item.createdAt, item.timestampPrecision, tz)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {item.viaForward && (
                        <span className="badge bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                          Forwarded to you
                        </span>
                      )}
                      <span className={`badge ${SUGGESTION_DISPOSITION_COLORS[item.disposition] ?? ''}`}>
                        {SUGGESTION_DISPOSITION_LABELS[item.disposition] ?? item.disposition}
                      </span>
                      {item.attachmentCount > 0 && (
                        <Paperclip className="text-theme-text-muted h-3.5 w-3.5" aria-label="Has screenshots" />
                      )}
                      {item.messageCount > 0 && (
                        <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          {item.messageCount}
                        </span>
                      )}
                      <ChevronRight className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!isLoading && items.length < total && (
            <button
              type="button"
              className="btn-secondary mt-3 inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Load more
            </button>
          )}
        </div>
        <div>
          {detail ? (
            <ReviewDetail detail={detail} onChange={handleChange} />
          ) : (
            <p className="text-theme-text-muted text-sm">Select a submission to review it.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuggestionReviewPanel;
