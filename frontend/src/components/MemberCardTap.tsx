/**
 * "Or tap their ID card" — the NFC half of the member ID scanner.
 *
 * Rendered by `MemberIdScannerModal` only while it is open, so the two reads it
 * needs (the inventory NFC switch and the connected integrations) are not made
 * on every inventory page that merely mounts the picker.
 *
 * Shown only when all of these hold, and otherwise renders nothing:
 *
 * - the viewer holds `inventory.manage` (the lookup endpoint's gate);
 * - the department has inventory NFC switched on, and has the NFC ID Cards
 *   integration connected — the server refuses the lookup without both;
 * - the browser has Web NFC (Chrome on Android over HTTPS).
 *
 * Only a payload that looks like a card code this system issued is forwarded,
 * as at the check-in station: a transit card's text has no business going
 * through a credential lookup.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Nfc } from 'lucide-react';
import { inventoryService } from '../services/api';
import { useNfcScanner } from '../hooks/useNfcScanner';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { useInventoryNfcEnabled } from '../modules/inventory/hooks/useInventoryNfcEnabled';
import {
  NFC_ID_CARDS_INTEGRATION,
  isIssuedCardCode,
  normalizeCardSerial,
} from '../modules/membership/constants/idCards';

interface MemberCardTapProps {
  onMemberIdentified: (member: { userId: string; memberName: string }) => void;
}

export const MemberCardTap: React.FC<MemberCardTapProps> = ({ onMemberIdentified }) => {
  const canManage = useAuthStore((s) => s.checkPermission('inventory.manage'));
  const { enabled } = useInventoryNfcEnabled(canManage);
  const { isConnected } = useConnectedIntegrations();
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const onTag = useCallback(
    (tag: { serialNumber: string; payload: string | null }) => {
      if (handledRef.current) return;
      const serial = normalizeCardSerial(tag.serialNumber);
      const code = isIssuedCardCode(tag.payload) ? normalizeCardSerial(tag.payload ?? '') : undefined;
      if (!code && serial.length < 4) {
        setError('That card could not be read. Hold it still against the phone and try again.');
        return;
      }
      handledRef.current = true;
      setLookingUp(true);
      setError(null);
      inventoryService
        .resolveNfcMember({ code, serial_number: serial.length >= 4 ? serial : undefined })
        .then((member) => {
          stopRef.current();
          onMemberIdentified({ userId: member.user_id, memberName: member.member_name });
        })
        .catch((err: unknown) => {
          handledRef.current = false;
          setError(getErrorMessage(err, 'That card could not be looked up.'));
        })
        .finally(() => setLookingUp(false));
    },
    [onMemberIdentified]
  );

  const { supported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag });
  stopRef.current = stop;
  useEffect(() => () => stop(), [stop]);

  if (!canManage || !enabled || !isConnected(NFC_ID_CARDS_INTEGRATION) || !supported) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={scanning ? stop : () => void start()}
        aria-pressed={scanning}
        disabled={lookingUp}
        className={`inline-flex w-full items-center justify-center gap-2 ${scanning ? 'btn-secondary' : 'btn-primary'}`}
      >
        {lookingUp ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Nfc className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
        )}
        {scanning ? 'Hold their ID card to the phone — tap to stop' : 'Or tap their ID card'}
      </button>
      {(error || scanError) && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {error || scanError}
        </p>
      )}
    </div>
  );
};

export default MemberCardTap;
