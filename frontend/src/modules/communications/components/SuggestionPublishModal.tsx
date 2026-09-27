/**
 * Write the copy of a suggestion that goes on the idea board.
 *
 * The reviewer writes it rather than the submission being shown, because the
 * original may name people or carry screenshots, and its wording can give away
 * an anonymous author. The title starts from the submission's; the summary
 * starts empty on purpose, so nothing of the original reaches the board unread.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewSuggestionDetail } from '../types/suggestions';

const MAX_TITLE = 200;
const MAX_SUMMARY = 2000;

interface SuggestionPublishModalProps {
  detail: ReviewSuggestionDetail;
  onClose: () => void;
  onPublished: (detail: ReviewSuggestionDetail) => void;
}

const SuggestionPublishModal: React.FC<SuggestionPublishModalProps> = ({ detail, onClose, onPublished }) => {
  const [title, setTitle] = useState(detail.publishedTitle ?? detail.title);
  const [summary, setSummary] = useState(detail.publishedSummary ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = Boolean(detail.publishedAt);
  const hasResponse = detail.timeline.some((entry) => entry.publicResponse);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      onPublished(await suggestionsService.publish(detail.id, { title: title.trim(), summary: summary.trim() }));
      toast.success(isEdit ? 'Published copy updated' : 'Published to the idea board');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to publish.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit published copy' : 'Publish to the idea board'} size="lg">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-4">
          <div className="alert-info text-sm">
            <p className="text-theme-text-primary">
              Every member can read this and vote on it. Write it in your own words: the submission itself, its
              screenshots and who sent it are never shown.
              {hasResponse ? ' The latest response to the submitter will also be shown with it.' : ''}
            </p>
          </div>
          <div>
            <label htmlFor="publish-title" className="form-label">
              Title
            </label>
            <input
              id="publish-title"
              className="form-input"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="publish-summary" className="form-label">
              Summary
            </label>
            <textarea
              id="publish-summary"
              className="form-input"
              rows={5}
              maxLength={MAX_SUMMARY}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What is being suggested, without names or anything that identifies who sent it."
              required
            />
          </div>
        </div>
        <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving || !title.trim() || !summary.trim()}>
            {isSaving ? 'Publishing…' : isEdit ? 'Save copy' : 'Publish'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default SuggestionPublishModal;
