import React, { useEffect, useMemo } from 'react';
import { Nfc, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNfcWriter } from '../../hooks/useNfcWriter';
import { nfcActionNoun, parseNfcTagPath } from '../../constants/nfc';

interface NfcTagWriteButtonProps {
  /** Absolute URL to encode. Also decides whether this renders at all. */
  url: string;
  /** Name of the thing being tagged, used in the toast. */
  label: string;
  className?: string;
}

/**
 * Compact tag writer for a row of small actions — the fleet QR directory,
 * where one card per apparatus means a full writer card would triple the grid.
 *
 * Feedback goes through toasts rather than inline alerts on purpose: this sits
 * in a print-oriented grid of fixed-size cards, and an inline status block
 * would reflow every card beside it mid-write.
 *
 * It renders nothing unless `url` is a destination a tap would actually reach.
 * The QR directory also lists public kiosk codes, which `parseNfcTagPath`
 * refuses by design — offering to write a tag no reader would honour is worse
 * than offering nothing, so the same rule gates both ends.
 */
export const NfcTagWriteButton: React.FC<NfcTagWriteButtonProps> = ({ url, label, className = '' }) => {
  const { supported, status, error, writeUrl, cancel, reset } = useNfcWriter();
  const match = useMemo(() => parseNfcTagPath(url), [url]);

  // A failed write has no inline slot to appear in here, so it has to reach the
  // toaster or it reaches nobody — a silent failure reads exactly like a tag
  // that was written, and the member finds out by tapping a dead sticker.
  useEffect(() => {
    if (status === 'error' && error) {
      toast.error(error);
      reset();
    }
  }, [status, error, reset]);

  if (!supported || !match) return null;

  const waiting = status === 'waiting';

  const handleClick = () => {
    if (waiting) {
      cancel();
      return;
    }
    void writeUrl(url).then((written) => {
      if (written) toast.success(`Tag written — opens ${label} ${nfcActionNoun(match.target)}`);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={waiting ? 'Cancel writing' : `Write this link to an NFC tag for ${label}`}
      className={`text-theme-text-muted flex items-center gap-1.5 text-xs transition-colors hover:text-blue-500 max-md:min-h-11 ${className}`}
    >
      {waiting ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : status === 'success' ? (
        <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
      ) : (
        <Nfc className="h-3 w-3" aria-hidden="true" />
      )}
      {waiting ? 'Hold to tag…' : 'Write NFC tag'}
    </button>
  );
};
