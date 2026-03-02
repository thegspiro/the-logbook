/**
 * Member ID Scanner Modal
 *
 * Opens the device camera to scan a member's digital ID card (QR code or
 * Code128 barcode). On successful identification the modal calls back with
 * the member's userId and display name so the caller can proceed with an
 * inventory operation (e.g. open the InventoryScanModal).
 *
 * Supported inputs:
 *   - QR code  — JSON payload `{ type: "member_id", id, membership_number?, org? }`
 *   - Code128 barcode — plain membership number string
 *
 * Uses the `html5-qrcode` library (same as MemberScanPage) for broad
 * device/browser support including iOS Safari.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  ScanLine,
  Camera,
  CameraOff,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { inventoryService, type MemberInventorySummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

// ── Types ──────────────────────────────────────────────────────────

interface MemberIdPayload {
  type: 'member_id';
  id: string;
  membership_number?: string;
  org?: string;
}

interface IdentifiedMember {
  userId: string;
  memberName: string;
}

interface MemberIdScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMemberIdentified: (member: IdentifiedMember) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

function isMemberIdPayload(value: unknown): value is MemberIdPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj['type'] === 'member_id' && typeof obj['id'] === 'string';
}

// ── Component ──────────────────────────────────────────────────────

export const MemberIdScannerModal: React.FC<MemberIdScannerModalProps> = ({
  isOpen,
  onClose,
  onMemberIdentified,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const handledRef = useRef(false);
  // Cache members list so repeated scans don't re-fetch
  const membersRef = useRef<MemberInventorySummary[] | null>(null);

  /** Resolve a scanned value to a member. */
  const handleScanResult = useCallback(
    async (decoded: string) => {
      if (handledRef.current) return;
      handledRef.current = true;

      setLookingUp(true);
      setError(null);

      try {
        // 1. Try JSON QR payload
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(decoded);
        } catch {
          // Not JSON — treat as plain membership number
        }

        if (isMemberIdPayload(parsed)) {
          // We have the member ID directly — fetch their name from the
          // members summary so we can display it in the checkout modal.
          if (!membersRef.current) {
            const data = await inventoryService.getMembersSummary();
            membersRef.current = data.members;
          }
          const match = membersRef.current.find((m) => m.user_id === parsed.id);
          if (match) {
            onMemberIdentified({
              userId: match.user_id,
              memberName: match.full_name || match.username,
            });
            return;
          }
          // If not found in inventory members, still navigate with the id
          onMemberIdentified({
            userId: parsed.id,
            memberName: parsed.membership_number ?? 'Member',
          });
          return;
        }

        // 2. Plain string — look up by membership number
        if (!membersRef.current) {
          const data = await inventoryService.getMembersSummary();
          membersRef.current = data.members;
        }
        const match = membersRef.current.find(
          (m) =>
            m.membership_number?.toLowerCase() === decoded.trim().toLowerCase(),
        );

        if (match) {
          onMemberIdentified({
            userId: match.user_id,
            memberName: match.full_name || match.username,
          });
        } else {
          setError(`No member found for "${decoded}"`);
          handledRef.current = false;
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Member lookup failed'));
        handledRef.current = false;
      } finally {
        setLookingUp(false);
      }
    },
    [onMemberIdentified],
  );

  /** Start the camera scanner. */
  const startScanner = useCallback(async () => {
    setError(null);
    handledRef.current = false;

    try {
      const html5QrCode = new Html5Qrcode('member-scanner-viewport');
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          void handleScanResult(decodedText);
        },
        () => {
          // No code in frame — ignore
        },
      );

      setScanning(true);
    } catch (err: unknown) {
      setError(
        getErrorMessage(
          err,
          'Could not start camera. Please allow camera access and try again.',
        ),
      );
    }
  }, [handleScanResult]);

  /** Stop the active scanner. */
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Already stopped
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Auto-start camera when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the DOM element mount
      const timer = setTimeout(() => {
        void startScanner();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, startScanner]);

  // Cleanup on close / unmount
  useEffect(() => {
    if (!isOpen) {
      void stopScanner();
      setError(null);
      setLookingUp(false);
      handledRef.current = false;
      membersRef.current = null;
    }
  }, [isOpen, stopScanner]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        void scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-md mx-4 bg-theme-surface rounded-xl border border-theme-surface-border shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-theme-surface-border">
          <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            Scan Member ID
          </h2>
          <button
            onClick={() => {
              void stopScanner();
              onClose();
            }}
            className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
            aria-label="Close scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scanner viewport */}
        <div className="bg-black">
          <div
            id="member-scanner-viewport"
            className="w-full aspect-square"
          />
        </div>

        {/* Controls + status */}
        <div className="px-4 py-3 space-y-3">
          {/* Camera toggle */}
          <div className="flex justify-center">
            {!scanning ? (
              <button
                onClick={() => { void startScanner(); }}
                disabled={lookingUp}
                className="btn-info font-medium gap-2 inline-flex items-center px-5 py-2.5 text-sm transition"
              >
                <Camera className="h-4 w-4" />
                Start Camera
              </button>
            ) : (
              <button
                onClick={() => { void stopScanner(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 text-sm font-medium transition-colors"
              >
                <CameraOff className="h-4 w-4" />
                Stop Camera
              </button>
            )}
          </div>

          {/* Looking up */}
          {lookingUp && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <p className="text-blue-600 dark:text-blue-400 text-sm">Looking up member...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Instructions */}
          <p className="text-xs text-theme-text-muted text-center">
            Point the camera at a member&apos;s QR code or barcode on their digital ID card.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MemberIdScannerModal;
