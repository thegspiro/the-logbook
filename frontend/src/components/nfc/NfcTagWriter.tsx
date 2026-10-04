import React, { useId, useState } from 'react';
import { Nfc, Loader2, Check, AlertTriangle, ChevronDown } from 'lucide-react';
import { useNfcWriter } from '../../hooks/useNfcWriter';

interface NfcTagWriterProps {
  /** Absolute URL encoded onto the tag. */
  url: string;
  /** Name of the thing being tagged, used in the confirmation copy. */
  targetLabel: string;
  /**
   * What tapping the tag does, as a noun phrase — "clock-in" for admin hours,
   * "shift check-in" for an apparatus. Reads as "opens Engine 4 shift
   * check-in", so it must not repeat the label.
   */
  actionNoun?: string;
}

const NfcTagWriterBody: React.FC<NfcTagWriterProps> = ({ url, targetLabel, actionNoun = 'check-in' }) => {
  const { supported, unavailableReason, status, error, writeUrl, cancel, reset } = useNfcWriter();

  if (!supported) {
    // The browser-support reason repeats the "Chrome on Android" sentence
    // below, so only the insecure-origin reason — the one it does not cover —
    // is appended.
    const insecureOrigin = typeof window !== 'undefined' && !window.isSecureContext;
    return (
      <div className="text-theme-text-muted flex items-start gap-2 text-sm">
        <Nfc className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">NFC tags:</span> to write this link to a tag, open this page in Chrome on an
          Android phone.{insecureOrigin && unavailableReason ? ` ${unavailableReason}` : ''}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-theme-text-secondary mb-4 text-sm">
        Write this link to a blank NFC tag or sticker. Members tap the tag with their phone to open {targetLabel}{' '}
        {actionNoun} — no camera needed.
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
              Tag written. Tapping it now opens {targetLabel} {actionNoun}.
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
/**
 * Programs a reusable NFC tag with a check-in link, so a station can mount a
 * sticker beside the door — or on the truck — instead of reprinting a QR sheet.
 *
 * Closed by default behind a "Set up an NFC tag" link: it is a setup tool for
 * the officer who mounts the sticker, and open on a page members also read it
 * was a full card of instructions and a large button for something none of
 * them will ever do. Callers show it only to the officers who may write the
 * tag; members get `NfcTapHint` instead.
 *
 * On a device without Web NFC the opened panel is a single explanatory line
 * rather than nothing. A chief planning tag rollout is usually at a
 * desktop, where the writer can never run — hiding it outright means the
 * capability is undiscoverable from the only screen that documents it.
 */
export const NfcTagWriter: React.FC<NfcTagWriterProps> = (props) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-6 text-left">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 text-sm transition-colors max-md:min-h-11"
      >
        <Nfc className="h-4 w-4" aria-hidden="true" />
        Set up an NFC tag
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {/* Mounted only while open, so the closed state leaves no hidden
          controls in the tab order and no writer armed behind a closed panel. */}
      {open && (
        <div id={panelId} className="card mt-3">
          <NfcTagWriterBody {...props} />
        </div>
      )}
    </div>
  );
};
