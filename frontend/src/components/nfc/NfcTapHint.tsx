import React from 'react';
import { Nfc } from 'lucide-react';

interface NfcTapHintProps {
  /** What tapping does, as a verb phrase: "check in", "clock in or out". */
  action: string;
}

/**
 * The one line a member needs about NFC on a check-in page: that a tag, where
 * one is mounted, does the same as the QR code. Writing tags is an officer's
 * job and lives behind `NfcTagWriter`.
 *
 * Worded conditionally because the page cannot know whether anyone has put a
 * tag up, and shown on every device because reading one needs no app support —
 * an iPhone opens a written tag as readily as an Android phone; only writing
 * one is limited to Chrome on Android.
 */
export const NfcTapHint: React.FC<NfcTapHintProps> = ({ action }) => (
  // Hidden in print: a QR sheet is posted whether or not a tag ever goes up
  // beside it, and a printed promise of a tag that is not there is a dead end.
  <p className="text-theme-text-secondary mt-6 flex items-center justify-center gap-2 text-sm print:hidden">
    <Nfc className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span>Have an NFC tag here? Tap it with your phone to {action}.</span>
  </p>
);
