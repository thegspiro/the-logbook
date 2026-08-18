import React from 'react';
import { Nfc, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useNfcWriter } from '../../hooks/useNfcWriter';

interface NfcTagWriterProps {
  /** Absolute URL encoded onto the tag. */
  url: string;
  /** Name of the thing being tagged, used in the confirmation copy. */
  targetLabel: string;
}

/**
 * Programs a reusable NFC tag with a check-in link, so a station can mount a
 * sticker beside the door instead of reprinting a QR sheet per event.
 *
 * On a device without Web NFC this collapses to a single explanatory line
 * rather than disappearing. A chief planning tag rollout is usually at a
 * desktop, where the writer can never run — hiding it outright means the
 * capability is undiscoverable from the only screen that documents it.
 */
export const NfcTagWriter: React.FC<NfcTagWriterProps> = ({ url, targetLabel }) => {
  const { supported, unavailableReason, status, error, writeUrl, cancel, reset } = useNfcWriter();

  if (!supported) {
    return (
      <div className="text-theme-text-muted mt-6 flex items-start gap-2 text-sm">
        <Nfc className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">NFC tags:</span> open this page in Chrome on an Android phone to write this
          check-in link to an NFC tag. {unavailableReason}
        </p>
      </div>
    );
  }

  return (
    <div className="card mt-6 text-left">
      <div className="mb-3 flex items-center gap-2">
        <Nfc className="text-theme-text-secondary h-5 w-5" aria-hidden="true" />
        <h3 className="text-theme-text-primary text-lg font-semibold">Write to an NFC tag</h3>
      </div>

      <p className="text-theme-text-secondary mb-4 text-sm">
        Encode this check-in link onto a blank NFC tag or sticker. Members tap the tag with their phone to open{' '}
        {targetLabel} check-in — no camera needed.
      </p>

      {status === 'waiting' ? (
        <div className="flex flex-col gap-3">
          <div className="alert-info flex items-center gap-3">
            <Loader2 className="text-theme-alert-info-icon h-5 w-5 animate-spin" aria-hidden="true" />
            <p className="text-theme-alert-info-text text-sm">
              Hold the back of your phone against the tag and keep it still.
            </p>
          </div>
          <button type="button" onClick={cancel} className="btn-secondary self-start text-sm">
            Cancel
          </button>
        </div>
      ) : status === 'success' ? (
        <div className="flex flex-col gap-3">
          <div className="alert-success flex items-center gap-3">
            <Check className="text-theme-alert-success-icon h-5 w-5" aria-hidden="true" />
            <p className="text-theme-alert-success-text text-sm">
              Tag written. Tapping it now opens {targetLabel} check-in.
            </p>
          </div>
          <button type="button" onClick={reset} className="btn-secondary self-start text-sm">
            Write another tag
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {status === 'error' && error && (
            <div className="alert-danger flex items-start gap-3">
              <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-theme-alert-danger-text text-sm">{error}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => void writeUrl(url)}
            className="btn-info inline-flex items-center gap-2 self-start text-sm"
          >
            <Nfc className="h-4 w-4" aria-hidden="true" />
            {status === 'error' ? 'Try again' : 'Write tag'}
          </button>
        </div>
      )}

      {/* Writing overwrites whatever the tag already held, and a tag reused
          from another event is the likeliest mistake in the field. */}
      <p className="text-theme-text-muted mt-3 text-xs">Writing replaces any link already on the tag.</p>
    </div>
  );
};
