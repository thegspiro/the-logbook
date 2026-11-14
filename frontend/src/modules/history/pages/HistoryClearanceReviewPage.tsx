/**
 * Reviewing one record for the clearance list: the record as members would
 * read it, where the request stands, and — for the current step's position
 * holders — clear or return it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { ClearanceSteps } from '../components/ClearanceSteps';
import { MediaDetails } from '../components/MediaDetails';
import { PersonDetails } from '../components/PersonDetails';
import type { ClearanceDecisionKind, ClearanceReview } from '../types';

export const HistoryClearanceReviewPage: React.FC = () => {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<ClearanceReview | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReview(await historyService.getClearanceReview(requestId));
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else toast.error(getErrorMessage(err, 'Unable to load this review'));
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={ClipboardCheck}
          title="Review not found"
          description="This review does not exist, or it is not one you take part in."
          actions={[{ label: 'Back to History', onClick: () => void navigate('/history') }]}
        />
      </div>
    );
  }
  if (!review) return <SkeletonPage />;

  const decide = async (decision: ClearanceDecisionKind) => {
    if (decision === 'returned' && !note.trim()) {
      toast.error('Say what needs to change before returning the record');
      return;
    }
    setBusy(true);
    try {
      await historyService.decideClearance(requestId, decision, note.trim() || undefined);
      toast.success(decision === 'cleared' ? 'Cleared' : 'Returned for changes');
      setNote('');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record your decision'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Review' }]} />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">Review: {review.request.record_label}</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="card p-4">
          <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">{review.request.record_label}</h2>
          <p className="text-theme-text-secondary mb-4 text-sm">As members would read it.</p>
          {'kind' in review.record ? <MediaDetails item={review.record} /> : <PersonDetails person={review.record} />}
        </div>
        <aside className="card space-y-4 p-4">
          <ClearanceSteps request={review.request} />
          {review.request.can_decide && (
            <div className="space-y-2">
              <label className="block">
                <span className="form-label">Note (required to return)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="form-input"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-success rounded-md px-3 py-2"
                  disabled={busy}
                  onClick={() => void decide('cleared')}
                >
                  Clear this step
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-md px-3 py-2"
                  disabled={busy}
                  onClick={() => void decide('returned')}
                >
                  Return for changes
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default HistoryClearanceReviewPage;
