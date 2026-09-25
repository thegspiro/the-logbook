/**
 * Forward one suggestion to members or positions. They become reviewers of
 * this suggestion only — not of the box — and cannot pass it on.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewerOptions, ReviewSuggestionDetail } from '../types/suggestions';
import ReviewerChecklist from './ReviewerChecklist';

interface SuggestionForwardModalProps {
  detail: ReviewSuggestionDetail;
  onClose: () => void;
  onForwarded: (detail: ReviewSuggestionDetail) => void;
}

const SuggestionForwardModal: React.FC<SuggestionForwardModalProps> = ({ detail, onClose, onForwarded }) => {
  const [options, setOptions] = useState<ReviewerOptions | null>(null);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    let cancelled = false;
    suggestionsService
      .getForwardOptions()
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, 'Unable to load people to forward to.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Someone who already has this forward is not offered it again, and nor is
  // the reviewer doing the forwarding, who can already read it.
  const already = useMemo(() => {
    const ids = new Set(detail.forwards.map((f) => f.targetId ?? ''));
    if (currentUserId) ids.add(currentUserId);
    return ids;
  }, [detail.forwards, currentUserId]);
  const positions = (options?.positions ?? []).filter((p) => !already.has(p.id));
  const members = (options?.members ?? []).filter((m) => !already.has(m.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      onForwarded(await suggestionsService.forward(detail.id, { positionIds, memberIds }));
      toast.success('Forwarded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to forward.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Forward for review" size="lg">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-4">
          <div className="alert-info text-sm">
            <p className="text-theme-text-primary">
              The people you choose can read <strong>this suggestion only</strong>, including its screenshots and
              thread, set its disposition and reply. They are emailed a link, and cannot forward it further.
              {detail.isAnonymous ? ' The submitter stays anonymous.' : ''}
            </p>
          </div>
          {options === null ? (
            <p className="text-theme-text-muted text-sm">Loading…</p>
          ) : (
            <>
              <ReviewerChecklist
                legend="Positions"
                items={positions}
                selected={positionIds}
                onChange={setPositionIds}
              />
              <div>
                <label htmlFor="forward-member-filter" className="form-label">
                  Find members
                </label>
                <input
                  id="forward-member-filter"
                  className="form-input mb-2"
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  placeholder="Filter by name"
                />
                <ReviewerChecklist
                  legend="Members"
                  items={members}
                  selected={memberIds}
                  onChange={setMemberIds}
                  filter={memberFilter}
                />
              </div>
            </>
          )}
        </div>
        <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSaving || positionIds.length + memberIds.length === 0}
          >
            {isSaving ? 'Forwarding…' : 'Forward'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default SuggestionForwardModal;
