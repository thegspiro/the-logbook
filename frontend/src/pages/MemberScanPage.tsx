/**
 * Member Scan Page
 *
 * Provides a camera-based QR / barcode scanner so that users (e.g., the
 * quartermaster) can scan a member's digital ID card and instantly navigate
 * to their profile.
 *
 * Supported inputs:
 *   - QR code (JSON payload with `type: "member_id"` and `id`)
 *   - Code128 barcode of a membership number (looks up member by number)
 *
 * Accessible at /members/scan.
 */

import React, { useRef, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ScanLine,
  ArrowLeft,
  Camera,
  CameraOff,
  AlertCircle,
} from "lucide-react";
import { userService } from "../services/api";
import { getErrorMessage } from "../utils/errorHandling";
import { useHtml5Scanner } from "../hooks/useHtml5Scanner";
import { isMemberIdPayload } from "../types/scanner";
import { QR_SCAN_CONFIG } from "../constants/camera";

export const MemberScanPage: React.FC = () => {
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const handledRef = useRef(false);

  /** Try to resolve the scanned value to a member and navigate. */
  const handleScanResult = useCallback(
    async (decoded: string) => {
      if (handledRef.current) return;
      handledRef.current = true;

      setLastScan(decoded);
      setLookingUp(true);
      setError(null);

      try {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(decoded);
        } catch {
          // Not JSON — treat as a plain membership number (barcode)
        }

        if (isMemberIdPayload(parsed)) {
          navigate(`/members/${parsed.id}`);
          return;
        }

        const users = await userService.getUsers();
        const match = users.find(
          (u) =>
            u.membership_number?.toLowerCase() === decoded.trim().toLowerCase(),
        );

        if (match) {
          navigate(`/members/${match.id}`);
        } else {
          setError(`No member found for "${decoded}"`);
          handledRef.current = false;
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Lookup failed"));
        handledRef.current = false;
      } finally {
        setLookingUp(false);
      }
    },
    [navigate],
  );

  const onScan = useCallback(
    (decodedText: string) => {
      void handleScanResult(decodedText);
    },
    [handleScanResult],
  );

  const { scanning, startScanner, stopScanner } = useHtml5Scanner({
    viewportId: "scanner-viewport",
    scanConfig: QR_SCAN_CONFIG,
    onScan,
  });

  return (
    <div className="min-h-screen max-w-lg mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/members"
          className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Members
        </Link>
        <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
          <ScanLine className="h-6 w-6" />
          Scan Member ID
        </h1>
        <p className="text-sm text-theme-text-muted mt-1">
          Point your camera at a member&apos;s QR code or barcode to look them
          up.
        </p>
      </div>

      {/* Scanner Viewport */}
      <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden mb-6">
        <div
          id="scanner-viewport"
          data-testid="scanner-viewport"
          className="w-full aspect-square bg-black/90"
        />
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-3 mb-6">
        {!scanning ? (
          <button
            onClick={() => {
              void startScanner();
            }}
            disabled={lookingUp}
            className="btn-info font-medium gap-2 inline-flex items-center px-5 py-2.5 text-sm transition"
          >
            <Camera className="h-4 w-4" />
            Start Scanning
          </button>
        ) : (
          <button
            onClick={() => {
              void stopScanner();
            }}
            className="btn-primary font-medium gap-2 inline-flex items-center px-5 py-2.5 text-sm transition"
          >
            <CameraOff className="h-4 w-4" />
            Stop Scanning
          </button>
        )}
      </div>

      {/* Status Messages */}
      {lookingUp && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-center mb-4">
          <p className="text-blue-400 text-sm">Looking up member...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3 mb-4">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm">{error}</p>
            {lastScan && (
              <p className="text-red-400/70 text-xs mt-1">
                Scanned: {lastScan}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
        <h3 className="text-sm font-semibold text-theme-text-primary mb-2">
          How to use
        </h3>
        <ol className="list-decimal list-inside space-y-1 text-sm text-theme-text-secondary">
          <li>Tap &ldquo;Start Scanning&rdquo; and allow camera access</li>
          <li>
            Point the camera at a member&apos;s QR code or barcode on their ID
            card
          </li>
          <li>
            The member&apos;s profile will open automatically once recognized
          </li>
        </ol>
      </div>
    </div>
  );
};

export default MemberScanPage;
