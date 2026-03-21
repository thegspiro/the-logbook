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
import { useHtml5Scanner } from '../hooks/useHtml5Scanner';
import { isMemberIdPayload } from '../types/scanner';
import { QR_SCAN_CONFIG } from '../constants/camera';

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

export const MemberIdScannerModal: React.FC<MemberIdScannerModalProps> = ({
  isOpen,
  onClose,
  onMemberIdentified,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const handledRef = useRef(false);
  const membersRef = useRef<MemberInventorySummary[] | null>(null);

  /** Resolve a scanned value to a member. */
  const handleScanResult = useCallback(
    async (decoded: string) => {
      if (handledRef.current) return;
      handledRef.current = true;

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

  const onScan = useCallback(
    (decodedText: string) => {
      void handleScanResult(decodedText);
    },
    [handleScanResult],
  );

  const { scanning, startScanner, stopScanner } = useHtml5Scanner({
    viewportId: 'member-scanner-viewport',
    scanConfig: QR_SCAN_CONFIG,
    onScan,
  });

  // Auto-start camera when modal opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        void startScanner();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, startScanner]);

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
            data-testid="member-scanner-viewport"
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
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
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
