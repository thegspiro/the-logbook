/**
 * Pre-Meeting Package modal.
 *
 * The secretary assembles and emails the pre-meeting package PDF (meeting
 * details, ballot preview, voter-eligibility roster) ahead of an annual or
 * special meeting. The recipient list is fully editable: prefill from
 * leadership or the eligible-voter roster, remove anyone, or add any
 * outside address (e.g. board counsel). Preview links download the PDF
 * variants directly — the secretary can also skip sending entirely and
 * attach the downloaded PDF to their own communication.
 */
import React, { useCallback, useState } from 'react';
import { electionService } from '../../services/api';
import type { PackageVariant } from '../../types/election';
import { getErrorMessage } from '../../utils/errorHandling';

interface PreMeetingPackageModalProps {
  electionId: string;
  electionTitle: string;
  sending: boolean;
  error: string | null;
  onSubmit: (recipientEmails: string[], message: string, includeFullRoster: boolean) => void;
  onClose: () => void;
}

interface RecipientChip {
  email: string;
  name?: string | undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PreMeetingPackageModal: React.FC<PreMeetingPackageModalProps> = ({
  electionId,
  electionTitle,
  sending,
  error,
  onSubmit,
  onClose,
}) => {
  const [recipients, setRecipients] = useState<RecipientChip[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [prefillLoading, setPrefillLoading] = useState<string | null>(null);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [includeFullRoster, setIncludeFullRoster] = useState(false);
  const [rosterTouched, setRosterTouched] = useState(false);
  const [downloading, setDownloading] = useState<PackageVariant | null>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const loadPrefill = async (mode: 'leadership' | 'eligible_voters') => {
    try {
      setPrefillLoading(mode);
      setPrefillError(null);
      const prefill = await electionService.getPackageRecipients(electionId, mode);
      setRecipients(prefill.filter((r) => r.email).map((r) => ({ email: r.email, name: r.name })));
      // Leadership prefills default to the full (ineligibility-detail)
      // variant; anything member-facing defaults to the summary variant.
      // A manual checkbox choice is never overridden.
      if (!rosterTouched) {
        setIncludeFullRoster(mode === 'leadership');
      }
    } catch (err: unknown) {
      setPrefillError(getErrorMessage(err, 'Failed to load recipients'));
    } finally {
      setPrefillLoading(null);
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r.email !== email));
  };

  const addRecipient = () => {
    const email = newEmail.trim();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setAddError('Enter a valid email address');
      return;
    }
    setAddError(null);
    setRecipients((prev) =>
      prev.some((r) => r.email.toLowerCase() === email.toLowerCase()) ? prev : [...prev, { email }]
    );
    setNewEmail('');
  };

  const downloadVariant = async (variant: PackageVariant) => {
    try {
      setDownloading(variant);
      setPrefillError(null);
      const blob = await electionService.downloadPackagePdf(electionId, variant);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pre-meeting-package-${variant}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setPrefillError(getErrorMessage(err, 'Failed to download package PDF'));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="premeeting-package-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="premeeting-package-modal-title" className="text-theme-text-primary text-lg font-medium">
            Email Pre-Meeting Package
          </h3>
          <p className="text-theme-text-muted mt-1 text-sm">{electionTitle}</p>
        </div>

        <div className="space-y-4 px-6 py-4">
          {(error || prefillError) && (
            <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error || prefillError}</p>
            </div>
          )}

          <div>
            <span className="text-theme-text-secondary mb-2 block text-sm font-medium">Start from</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadPrefill('leadership');
                }}
                disabled={prefillLoading !== null}
                className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {prefillLoading === 'leadership' ? 'Loading…' : 'Leadership'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadPrefill('eligible_voters');
                }}
                disabled={prefillLoading !== null}
                className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {prefillLoading === 'eligible_voters' ? 'Loading…' : 'All eligible voters'}
              </button>
              <button
                type="button"
                onClick={() => setRecipients([])}
                className="bg-theme-surface text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1.5 text-sm"
              >
                Clear list
              </button>
            </div>
          </div>

          <div>
            <span className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Recipients ({recipients.length})
            </span>
            {recipients.length > 0 ? (
              <ul className="border-theme-surface-border max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {recipients.map((r) => (
                  <li
                    key={r.email}
                    className="bg-theme-surface flex items-center justify-between rounded-sm px-2 py-1 text-sm"
                  >
                    <span className="text-theme-text-primary truncate">
                      {r.name ? `${r.name} — ` : ''}
                      <span className="text-theme-text-muted">{r.email}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(r.email)}
                      aria-label={`Remove ${r.email}`}
                      className="ml-2 shrink-0 text-xs text-red-700 hover:text-red-800 dark:text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-theme-text-muted text-sm">
                No recipients yet — use a prefill above or add addresses below. Or skip sending and just download the
                PDF to attach to your own email.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
                placeholder="Add an email address (members or outside contacts)"
                aria-label="Add an email address"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring focus:border-theme-focus-ring flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-hidden"
              />
              <button
                type="button"
                onClick={addRecipient}
                className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1.5 text-sm"
              >
                Add
              </button>
            </div>
            {addError && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{addError}</p>}
          </div>

          <div>
            <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeFullRoster}
                onChange={(e) => {
                  setIncludeFullRoster(e.target.checked);
                  setRosterTouched(true);
                }}
                className="mt-0.5"
              />
              <span>
                Include full roster detail (ineligibility reasons)
                <span className="text-theme-text-muted block text-xs">
                  Lists which members are not eligible and why (membership tier, attendance). Intended for leadership —
                  the member version shows only counts and the eligible-voter names.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label
              htmlFor="premeeting-package-message"
              className="text-theme-text-secondary mb-1 block text-sm font-medium"
            >
              Message (optional)
            </label>
            <textarea
              id="premeeting-package-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Included at the top of the email"
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring focus:border-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:outline-hidden"
            />
          </div>

          <div className="text-theme-text-muted text-sm">
            Preview the PDF:{' '}
            <button
              type="button"
              onClick={() => {
                void downloadVariant('full');
              }}
              disabled={downloading !== null}
              className="text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              {downloading === 'full' ? 'Downloading…' : 'Full (leadership)'}
            </button>
            {' · '}
            <button
              type="button"
              onClick={() => {
                void downloadVariant('member');
              }}
              disabled={downloading !== null}
              className="text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              {downloading === 'member' ? 'Downloading…' : 'Member version'}
            </button>
          </div>
        </div>

        <div className="border-theme-surface-border flex justify-end space-x-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSubmit(
                recipients.map((r) => r.email),
                message,
                includeFullRoster
              )
            }
            disabled={sending || recipients.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreMeetingPackageModal;
