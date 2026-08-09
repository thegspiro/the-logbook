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

import React, { useRef, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router';
import { ScanLine, ArrowLeft, Camera, CameraOff, AlertCircle, Flashlight, FlashlightOff } from 'lucide-react';
import { userService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useHtml5Scanner } from '../hooks/useHtml5Scanner';
import { useScanFeedback } from '../hooks/useScanFeedback';
import { ScanSuccessFlash } from '../components/ux/ScanSuccessFlash';
import { isMemberIdPayload } from '../types/scanner';
import { QR_SCAN_CONFIG } from '../constants/camera';

export const MemberScanPage: React.FC = () => {
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const handledRef = useRef(false);
  // Cache the member list so repeated barcode attempts don't refetch the whole
  // directory each time (costly over a cell connection).
  const usersRef = useRef<Awaited<ReturnType<typeof userService.getUsers>> | null>(null);
  const { flashing, signalScanSuccess } = useScanFeedback();

  /** Try to resolve the scanned value to a member and navigate. */
  const handleScanResult = useCallback(
    async (decoded: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      signalScanSuccess();

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
          void navigate(`/members/${parsed.id}`);
          return;
        }

        if (!usersRef.current) {
          usersRef.current = await userService.getUsers();
        }
        const match = usersRef.current.find((u) => u.membership_number?.toLowerCase() === decoded.trim().toLowerCase());

        if (match) {
          void navigate(`/members/${match.id}`);
        } else {
          setError(`No member found for "${decoded}"`);
          handledRef.current = false;
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Lookup failed'));
        handledRef.current = false;
      } finally {
        setLookingUp(false);
      }
    },
    [navigate, signalScanSuccess]
  );

  const onScan = useCallback(
    (decodedText: string) => {
      void handleScanResult(decodedText);
    },
    [handleScanResult]
  );

  const { scanning, startScanner, stopScanner, flashlightSupported, flashlightOn, toggleFlashlight } = useHtml5Scanner({
    viewportId: 'scanner-viewport',
    scanConfig: QR_SCAN_CONFIG,
    onScan,
  });

  const tryStartScanner = useCallback(async () => {
    try {
      setError(null);
      await startScanner();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Camera access denied. Please allow camera permissions in your browser settings.'));
    }
  }, [startScanner]);

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/members"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-4 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Members
        </Link>
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <ScanLine className="h-6 w-6" />
          Scan Member ID
        </h1>
        <p className="text-theme-text-muted mt-1 text-sm">
          Point your camera at a member&apos;s QR code or barcode to look them up.
        </p>
      </div>

      {/* Scanner Viewport */}
      <div className="bg-theme-surface border-theme-surface-border mb-6 overflow-hidden rounded-lg border">
        <div className="relative">
          <div id="scanner-viewport" data-testid="scanner-viewport" className="aspect-square w-full bg-black/90" />
          <ScanSuccessFlash active={flashing} />
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 flex justify-center gap-3">
        {!scanning ? (
          <button
            onClick={() => {
              void tryStartScanner();
            }}
            disabled={lookingUp}
            className="btn-info inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition"
          >
            <Camera className="h-4 w-4" />
            Start Scanning
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                void stopScanner();
              }}
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition"
            >
              <CameraOff className="h-4 w-4" />
              Stop Scanning
            </button>
            {flashlightSupported && (
              <button
                onClick={() => {
                  void toggleFlashlight();
                }}
                aria-pressed={flashlightOn}
                className={`inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition ${
                  flashlightOn
                    ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-300'
                    : 'border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary'
                }`}
              >
                {flashlightOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                {flashlightOn ? 'Flashlight Off' : 'Flashlight'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Status Messages */}
      {lookingUp && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-center">
          <p className="text-sm text-blue-700 dark:text-blue-400">Looking up member...</p>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          <div>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            {lastScan && <p className="mt-1 text-xs text-red-700 dark:text-red-400/70">Scanned: {lastScan}</p>}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
        <h3 className="text-theme-text-primary mb-2 text-sm font-semibold">How to use</h3>
        <ol className="text-theme-text-secondary list-inside list-decimal space-y-1 text-sm">
          <li>Tap &ldquo;Start Scanning&rdquo; and allow camera access</li>
          <li>Point the camera at a member&apos;s QR code or barcode on their ID card</li>
          <li>The member&apos;s profile will open automatically once recognized</li>
        </ol>
      </div>
    </div>
  );
};

export default MemberScanPage;
