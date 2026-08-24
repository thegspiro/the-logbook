/**
 * Binds a physical card to a member, one of two ways.
 *
 * **Write a code** onto a blank tag — a sticker inside an ID card, a fob. The
 * code is minted here, written to the tag, and that is what the station will
 * read. This is the option to prefer: the code is 128 random bits, it is not
 * printed on the card, and a lost tag can be reused for somebody else.
 *
 * **Read the card's serial** — for a card that is already printed and cannot
 * be written to, where the chip's own serial is the only identifier there is.
 *
 * Either way an officer does this and hands the card over. There is no path
 * by which a member binds their own card, here or on the server.
 *
 * A typed field is always offered alongside both. Departments issue cards from
 * a desk as often as from a phone, and a USB reader types the serial like a
 * keyboard straight into it — hiding the field behind "NFC unavailable" would
 * leave an admin on a desktop, the most likely place to be issuing cards, with
 * nothing at all.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Nfc, AlertTriangle, Check, PenLine, ScanLine } from 'lucide-react';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useNfcWriter } from '../../../hooks/useNfcWriter';
import { NfcCredentialType } from '../../../constants/enums';
import { generateCardCode, normalizeCardSerial } from '../constants/idCards';

interface NfcCardCaptureProps {
  /** Current credential value, normalized. Empty until one is captured. */
  value: string;
  onChange: (credential: string, credentialType: NfcCredentialType) => void;
  credentialType: NfcCredentialType;
  /** Rendered under the field; use for a duplicate-card refusal. */
  error?: string | null;
  inputId?: string;
}

export const NfcCardCapture: React.FC<NfcCardCaptureProps> = ({
  value,
  onChange,
  credentialType,
  error = null,
  inputId = 'nfc-card-credential',
}) => {
  const [captured, setCaptured] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleTag = useCallback((tag: { serialNumber: string }) => {
    const serial = normalizeCardSerial(tag.serialNumber);
    if (!serial) return;
    onChangeRef.current(serial, NfcCredentialType.SERIAL);
    setCaptured(true);
  }, []);

  const { supported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag: handleTag });
  const { status: writeStatus, error: writeError, writeText, cancel: cancelWrite } = useNfcWriter();

  // Leaving the dialog must disarm the radio; an orphaned scan keeps reading
  // cards against a form nobody can see, and an orphaned write silently
  // overwrites the next tag that passes the phone.
  useEffect(
    () => () => {
      stop();
      cancelWrite();
    },
    [stop, cancelWrite]
  );

  const handleRead = useCallback(() => {
    setCaptured(false);
    cancelWrite();
    // Web NFC requires transient user activation, so scan() has to run inside
    // the click handler rather than in an effect.
    void start();
  }, [start, cancelWrite]);

  const handleWrite = useCallback(async () => {
    setCaptured(false);
    stop();
    const code = generateCardCode();
    // The code is only bound to the member once the tag actually took it. A
    // registration written first and a write that then failed would leave a
    // member holding a blank card the system believes is theirs.
    const written = await writeText(code);
    if (!written) return;
    onChangeRef.current(code, NfcCredentialType.WRITTEN);
    setCaptured(true);
  }, [stop, writeText]);

  const busyWriting = writeStatus === 'waiting';

  return (
    <div className="space-y-2">
      <span className="form-label" id={`${inputId}-label`}>
        Card
      </span>

      {supported && (
        <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-labelledby={`${inputId}-label`}>
          <button
            type="button"
            onClick={() => void handleWrite()}
            disabled={busyWriting}
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
          >
            <PenLine className={`h-4 w-4 ${busyWriting ? 'animate-pulse' : ''}`} aria-hidden="true" />
            {busyWriting ? 'Hold the card against the phone…' : 'Write a code to a blank card'}
          </button>
          <button
            type="button"
            onClick={handleRead}
            className="btn-secondary inline-flex flex-1 items-center justify-center gap-2"
          >
            <ScanLine className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
            {scanning ? 'Hold the card against the phone…' : "Read a printed card's serial"}
          </button>
        </div>
      )}

      <label className="form-label sr-only" htmlFor={inputId}>
        Card serial number
      </label>
      <input
        id={inputId}
        type="text"
        className="form-input font-mono uppercase"
        value={value}
        onChange={(e) => {
          setCaptured(false);
          // Typed by hand or by a USB reader: either way it is the chip's own
          // serial, never a code this system minted.
          onChange(normalizeCardSerial(e.target.value), NfcCredentialType.SERIAL);
        }}
        placeholder="04A2245B7C1180"
        autoComplete="off"
        spellCheck={false}
      />

      <p className="text-theme-text-secondary text-xs">
        {supported
          ? 'Or hold the card against a USB reader with the cursor in this box, or type the serial printed on the card.'
          : 'Hold the card against a USB reader with the cursor in this box, or type the serial printed on the card. Writing a code to a blank card needs Chrome on Android over HTTPS.'}
      </p>

      {captured && (
        <p className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400" role="status">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {credentialType === NfcCredentialType.WRITTEN
            ? 'Code written to the card. Register it to finish.'
            : 'Card read.'}
        </p>
      )}

      {(error || scanError || writeError) && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error || scanError || writeError}</p>
        </div>
      )}

      {!supported && (
        <p className="text-theme-text-muted inline-flex items-center gap-1.5 text-xs">
          <Nfc className="h-3.5 w-3.5" aria-hidden="true" />
          This device cannot read or write tags itself.
        </p>
      )}
    </div>
  );
};
