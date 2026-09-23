/**
 * Submit to a suggestion box.
 *
 * The follow-up key an anonymous submission receives is shown once and kept
 * only in this component's state — never localStorage: station computers are
 * shared, and a key left in one browser would hand the thread to whoever sits
 * down next.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, KeyRound, Loader2, Lightbulb } from 'lucide-react';
import { EmptyState, FileDropzone } from '../../../components/ux';
import { SuggestionAnonymityMode } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { SubmissionReceipt, SuggestionBoxPublic } from '../types/suggestions';

const MAX_SCREENSHOTS = 5;
const MAX_TITLE_LENGTH = 200;
const MAX_DETAILS_LENGTH = 10000;

interface SuggestionSubmitFormProps {
  onSubmitted?: (() => void) | undefined;
}

function anonymityHint(box: SuggestionBoxPublic): string {
  if (box.anonymityMode === SuggestionAnonymityMode.REQUIRED) {
    return 'Submissions to this box are always anonymous. Your name is not recorded.';
  }
  if (box.anonymityMode === SuggestionAnonymityMode.DISABLED) {
    return 'Submissions to this box include your name.';
  }
  return 'You can submit with your name or anonymously.';
}

const SuggestionSubmitForm: React.FC<SuggestionSubmitFormProps> = ({ onSubmitted }) => {
  const [boxes, setBoxes] = useState<SuggestionBoxPublic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [boxId, setBoxId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [dropzoneKey, setDropzoneKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    suggestionsService
      .listBoxes()
      .then((data) => {
        if (cancelled) return;
        setBoxes(data);
        setBoxId((current) => current || (data.length === 1 ? (data[0]?.id ?? '') : ''));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Unable to load suggestion boxes. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const box = boxes.find((b) => b.id === boxId);
  const willBeAnonymous =
    box?.anonymityMode === SuggestionAnonymityMode.REQUIRED ||
    (box?.anonymityMode === SuggestionAnonymityMode.ALLOWED && anonymous);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!box) return;
    if (screenshots.length > MAX_SCREENSHOTS) {
      toast.error(`Attach at most ${MAX_SCREENSHOTS} screenshots.`);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await suggestionsService.submit(box.id, {
        title: title.trim(),
        details: details.trim(),
        anonymous: willBeAnonymous,
        screenshots,
      });
      setReceipt(result);
      setTitle('');
      setDetails('');
      setAnonymous(false);
      setScreenshots([]);
      setDropzoneKey((k) => k + 1);
      if (!result.followUpKey) toast.success('Thank you — your submission was sent.');
      onSubmitted?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to submit. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success('Key copied');
    } catch {
      toast.error('Copy failed — select the key and copy it manually.');
    }
  };

  if (isLoading) {
    return <p className="text-theme-text-muted text-sm">Loading suggestion boxes…</p>;
  }
  if (loadError) {
    return (
      <p role="alert" className="alert-danger text-sm">
        {loadError}
      </p>
    );
  }
  if (boxes.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No suggestion boxes yet"
        description="Your department has not opened any suggestion boxes."
      />
    );
  }

  return (
    <div className="space-y-6">
      {receipt?.followUpKey && (
        <div className="alert-warning space-y-2" role="status">
          <p className="text-theme-text-primary flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Save your follow-up key
          </p>
          <p className="text-theme-text-secondary text-sm">
            Your submission was sent anonymously. This key is the only way to see replies and respond. It is shown once
            and cannot be recovered — nobody, including the reviewers, can look it up for you.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-theme-surface border-theme-surface-border rounded border px-2 py-1 text-sm break-all select-all">
              {receipt.followUpKey}
            </code>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
              onClick={() => void copyKey(receipt.followUpKey ?? '')}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setReceipt(null)}>
              I saved it
            </button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="card space-y-4">
        <div>
          <label htmlFor="suggestion-box" className="form-label">
            Suggestion box
          </label>
          <select
            id="suggestion-box"
            className="form-input"
            value={boxId}
            onChange={(e) => setBoxId(e.target.value)}
            required
          >
            <option value="">Choose a box…</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {box?.description && <p className="text-theme-text-secondary mt-1 text-sm">{box.description}</p>}
        </div>

        {box && (
          <>
            <div className="alert-info text-sm">
              <p className="text-theme-text-primary">{anonymityHint(box)}</p>
              <p className="text-theme-text-secondary mt-1">
                {box.followUpEnabled
                  ? 'Reviewers may reply with questions, and you can follow the status of your submission.'
                  : 'This box is one-way: reviewers read submissions but do not reply.'}
              </p>
            </div>

            {box.anonymityMode === SuggestionAnonymityMode.ALLOWED && (
              <label className="text-theme-text-primary flex items-start gap-2 text-sm max-md:min-h-[44px]">
                <input
                  type="checkbox"
                  className="form-checkbox mt-0.5"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <span>
                  Submit anonymously
                  <span className="text-theme-text-muted block text-xs">
                    Your name is not stored with the submission.
                    {box.followUpEnabled ? ' You will get a private key to follow up.' : ''}
                  </span>
                </span>
              </label>
            )}

            <div>
              <label htmlFor="suggestion-title" className="form-label">
                Title
              </label>
              <input
                id="suggestion-title"
                className="form-input"
                value={title}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="suggestion-details" className="form-label">
                Details
              </label>
              <textarea
                id="suggestion-details"
                className="form-input"
                rows={6}
                value={details}
                maxLength={MAX_DETAILS_LENGTH}
                onChange={(e) => setDetails(e.target.value)}
                required
              />
            </div>

            <div>
              <span className="form-label">Screenshots (optional, up to {MAX_SCREENSHOTS})</span>
              <FileDropzone
                key={dropzoneKey}
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                maxSizeMB={10}
                label="Drop screenshots here or click to browse"
                onFilesSelected={setScreenshots}
              />
              {willBeAnonymous && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Image metadata (such as location and device) is removed. Check the screenshots themselves do not show
                  your name.
                </p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
              disabled={isSubmitting || !title.trim() || !details.trim()}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {willBeAnonymous ? 'Submit anonymously' : 'Submit'}
            </button>
          </>
        )}
      </form>
    </div>
  );
};

export default SuggestionSubmitForm;
