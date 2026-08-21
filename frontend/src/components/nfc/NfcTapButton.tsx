import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Nfc, AlertTriangle } from 'lucide-react';
import { Modal } from '../Modal';
import { ScanSuccessFlash } from '../ux/ScanSuccessFlash';
import { useNfcScanner } from '../../hooks/useNfcScanner';
import { useScanFeedback } from '../../hooks/useScanFeedback';
import { parseNfcTagPath } from '../../constants/nfc';

/**
 * Tap an NFC tag to jump straight to whatever it points at — an event
 * check-in, an admin hours clock-in, or a shift check-in. The tag decides the
 * destination, so one button serves every module rather than each growing its
 * own.
 *
 * Renders nothing when Web NFC is unavailable. Unlike the writer — which is
 * documentation as much as a control — this is a pure action, and a permanently
 * dead button in the page header on every desktop and iPhone is worse than an
 * absent one.
 */
export const NfcTapButton: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rejected, setRejected] = useState(false);
  const { flashing, signalScanSuccess } = useScanFeedback();

  // Assigned below, once the scanner exists; `handleRead` needs to disarm the
  // radio and the scanner needs `handleRead`, so one side has to be indirect.
  const stopRef = useRef<() => void>(() => {});

  const handleRead = useCallback(
    (payload: string) => {
      const match = parseNfcTagPath(payload);
      if (!match) {
        // Keep the radio armed: the member is most likely holding a tag from
        // another system, and closing here would make them start over.
        setRejected(true);
        return;
      }
      setRejected(false);
      signalScanSuccess();
      // Disarm explicitly rather than relying on this component unmounting
      // with the route change — navigating to a route that keeps the Events
      // page mounted would otherwise leave an armed radio behind a closed
      // dialog, where nothing on screen says NFC is still listening.
      stopRef.current();
      setOpen(false);
      void navigate(match.path);
    },
    [navigate, signalScanSuccess]
  );

  const { supported, scanning, error, start, stop } = useNfcScanner({ onRead: handleRead });
  stopRef.current = stop;

  const handleClose = useCallback(() => {
    stop();
    setRejected(false);
    setOpen(false);
  }, [stop]);

  const handleOpen = useCallback(() => {
    setRejected(false);
    setOpen(true);
    // Web NFC requires transient user activation, so scan() has to run inside
    // the click handler. Deferring it to an effect lets the activation lapse
    // and the browser rejects the scan with NotAllowedError.
    void start();
  }, [start]);

  // Leaving the page (route change, tab close) must disarm the radio even when
  // the dialog was never closed through its own controls.
  useEffect(() => () => stop(), [stop]);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn-secondary btn-auto inline-flex items-center justify-center gap-2"
        title="Tap an NFC tag to check in"
      >
        <Nfc className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Tap Tag</span>
      </button>

      <Modal isOpen={open} onClose={handleClose} title="Tap an NFC tag" size="sm">
        <div className="relative flex flex-col items-center gap-4 py-4 text-center">
          <ScanSuccessFlash active={flashing} />
          <div className={`rounded-full bg-blue-500/10 p-6 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true">
            <Nfc className="h-10 w-10 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-theme-text-secondary text-sm" role="status">
            {scanning ? 'Hold the back of your phone against the tag.' : 'Starting NFC…'}
          </p>
          {rejected && (
            <div className="alert-warning flex w-full items-start gap-3 text-left">
              <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-theme-alert-warning-text text-sm">
                That tag is not a check-in tag for this site. Try a different tag.
              </p>
            </div>
          )}
          {error && (
            <div className="alert-danger flex w-full items-start gap-3 text-left">
              <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-theme-alert-danger-text text-sm">{error}</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};
