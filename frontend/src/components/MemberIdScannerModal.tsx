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
 * Uses the `html5-qrcode` library for broad device/browser support
 * including iOS Safari.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ScanLine, Camera, CameraOff, AlertCircle, Loader2, X, Flashlight, FlashlightOff } from 'lucide-react';
import { inventoryService, type MemberInventorySummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useHtml5Scanner } from '../hooks/useHtml5Scanner';
import { useScanFeedback } from '../hooks/useScanFeedback';
import { ScanSuccessFlash } from './ux/ScanSuccessFlash';
import { isMemberIdPayload } from '../types/scanner';
import { describeCameraError, QR_SCAN_CONFIG } from '../constants/camera';

// ── Types ──────────────────────────────────────────────────────────

interface IdentifiedMember {
  userId: string;
  memberName: string;
}

interface MemberIdScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMemberIdentified: (member: IdentifiedMember) => void;
}

// ── Component ──────────────────────────────────────────────────────

export const MemberIdScannerModal: React.FC<MemberIdScannerModalProps> = ({ isOpen, onClose, onMemberIdentified }) => {
  const [error, setError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const handledRef = useRef(false);
  const membersRef = useRef<MemberInventorySummary[] | null>(null);
  const { flashing, signalScanSuccess } = useScanFeedback();

  /** Resolve a scanned value to a member. */
  const handleScanResult = useCallback(
    async (decoded: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      signalScanSuccess();

      setLookingUp(true);
      setError(null);

      try {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(decoded);
        } catch {
          // Not JSON — treat as plain membership number
        }

        if (isMemberIdPayload(parsed)) {
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
          onMemberIdentified({
            userId: parsed.id,
            memberName: parsed.membership_number ?? 'Member',
          });
          return;
        }

        if (!membersRef.current) {
          const data = await inventoryService.getMembersSummary();
          membersRef.current = data.members;
        }
        const match = membersRef.current.find(
          (m) => m.membership_number?.toLowerCase() === decoded.trim().toLowerCase()
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
    [onMemberIdentified, signalScanSuccess]
  );

  const onScan = useCallback(
    (decodedText: string) => {
      void handleScanResult(decodedText);
    },
    [handleScanResult]
  );

  const { scanning, startScanner, stopScanner, flashlightSupported, flashlightOn, toggleFlashlight } = useHtml5Scanner({
    viewportId: 'member-scanner-viewport',
    scanConfig: QR_SCAN_CONFIG,
    onScan,
  });

  const tryStartScanner = useCallback(async () => {
    try {
      setError(null);
      await startScanner();
    } catch (err: unknown) {
      setError(describeCameraError(err));
    }
  }, [startScanner]);

  // Auto-start camera when modal opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        void tryStartScanner();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, tryStartScanner]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      void stopScanner();
      setError(null);
      setLookingUp(false);
      handledRef.current = false;
      membersRef.current = null;
    }
  }, [isOpen, stopScanner]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="bg-theme-surface border-theme-surface-border relative max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-modal-title"
      >
        {/* Header */}
        <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
          <h2
            id="scanner-modal-title"
            className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
          >
            <ScanLine className="h-5 w-5" aria-hidden="true" />
            Scan Member ID
          </h2>
          <button
            onClick={() => {
              void stopScanner();
              onClose();
            }}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg p-1.5 transition-colors"
            aria-label="Close scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scanner viewport. Cap the height so a wide (landscape) phone doesn't
            make the square preview taller than the screen. */}
        <div className="relative bg-black">
          <div
            id="member-scanner-viewport"
            data-testid="member-scanner-viewport"
            className="aspect-square max-h-[55dvh] w-full"
            role="img"
            aria-label="Camera scanner preview"
          />
          <ScanSuccessFlash active={flashing} />
        </div>

        {/* Controls + status */}
        <div className="space-y-3 px-4 py-3">
          {/* Camera toggle */}
          <div className="flex justify-center">
            {!scanning ? (
              <button
                onClick={() => {
                  void tryStartScanner();
                }}
                disabled={lookingUp}
                className="btn-info inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition"
              >
                <Camera className="h-4 w-4" />
                Start Camera
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    void stopScanner();
                  }}
                  className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors dark:border-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                  <CameraOff className="h-4 w-4" />
                  Stop Camera
                </button>
                {flashlightSupported && (
                  <button
                    onClick={() => {
                      void toggleFlashlight();
                    }}
                    aria-pressed={flashlightOn}
                    aria-label={flashlightOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      flashlightOn
                        ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-300'
                        : 'border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary'
                    }`}
                  >
                    {flashlightOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                    {flashlightOn ? 'Off' : 'Flashlight'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Looking up */}
          {lookingUp && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <p className="text-sm text-blue-600 dark:text-blue-400">Looking up member...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Instructions */}
          <p className="text-theme-text-muted text-center text-xs">
            Point the camera at a member&apos;s QR code or barcode on their digital ID card.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MemberIdScannerModal;
