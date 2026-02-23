/**
 * Inventory Scan Modal
 *
 * A modal that lets the quartermaster scan barcodes (or type codes manually)
 * to build a list of items, then submit them as a batch checkout or batch return.
 *
 * Flow:
 *  1. Open modal from a member's profile ("Check-out Items" or "Return Items")
 *  2. Scan/type a code → item appears in the list instantly
 *  3. Repeat for all items
 *  4. Review the list, then tap "Confirm" to submit the batch
 *
 * The modal uses the device camera for barcode scanning via the BarcodeDetector
 * API (Chrome/Edge 83+, Android). Falls back to manual text entry on
 * unsupported browsers.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { Camera, Keyboard, Check, AlertTriangle, Package, Trash2, Loader2 } from 'lucide-react';
import {
  inventoryService,
  ScanLookupResponse,
  BatchCheckoutResponse,
  BatchReturnResponse,
} from '../services/api';

// ── Types ──────────────────────────────────────────────────────────

interface ScannedItem {
  code: string;
  itemId: string;
  itemName: string;
  matchedField: string;
  status: string;
  trackingType: string;
  quantity: number;
  returnCondition: string;
}

type ResultItem = {
  code: string;
  item_name: string;
  action: string;
  success: boolean;
  error?: string;
};

interface InventoryScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'checkout' | 'return';
  userId: string;
  memberName: string;
  onComplete?: (result: BatchCheckoutResponse | BatchReturnResponse) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

// ── Component ──────────────────────────────────────────────────────

export const InventoryScanModal: React.FC<InventoryScanModalProps> = ({
  isOpen,
  onClose,
  mode,
  userId,
  memberName,
  onComplete,
}) => {
  // State
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleCodeScannedRef = useRef<(code: string) => void>(() => {});

  // ── Camera scanning ──────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!hasBarcodeDetector) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'],
      });

      // Set cameraActive first so the <video> element mounts, then
      // a useEffect will wire up the stream once the element exists.
      setCameraActive(true);
    } catch {
      setLookupError('Camera access denied. Please allow camera permissions, or type codes manually.');
      setTimeout(() => setLookupError(null), 5000);
      setCameraActive(false);
    }
  }, []);

  // Once cameraActive flips to true the <video> element mounts.
  // Wire the stream to it and start the barcode-polling interval.
  useEffect(() => {
    if (!cameraActive || !streamRef.current) return;

    const video = videoRef.current;
    if (!video) return;

    video.srcObject = streamRef.current;
    video.play().catch(() => {
      // autoplay may be blocked; user will see a black preview
    });

    const alreadyScanned = new Set<string>();
    scanIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !detectorRef.current) return;
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        for (const barcode of barcodes) {
          const value = barcode.rawValue;
          if (value && !alreadyScanned.has(value)) {
            alreadyScanned.add(value);
            setTimeout(() => alreadyScanned.delete(value), 3000);
            handleCodeScannedRef.current(value);
          }
        }
      } catch {
        // Detection can fail on individual frames; ignore
      }
    }, 300);

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [cameraActive]);

  // Cleanup camera on unmount or close
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      // Reset state when modal closes
      setScannedItems([]);
      setManualCode('');
      setLookupError(null);
      setResults(null);
    }
  }, [isOpen, stopCamera]);

  // Re-focus the manual input after the Modal's own focus effect
  // steals focus to the modal container on open.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // ── Code lookup ──────────────────────────────────────────────

  // Keep ref in sync so startCamera's interval always calls the latest version
  const handleCodeScanned = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    // Don't add duplicates
    if (scannedItems.some((si) => si.code === trimmed)) {
      setLookupError(`"${trimmed}" is already in the list`);
      setTimeout(() => setLookupError(null), 2000);
      return;
    }

    setLookupLoading(true);
    setLookupError(null);

    try {
      const response: ScanLookupResponse = await inventoryService.lookupByCode(trimmed);
      if (response.results.length === 0) {
        setLookupError(`No item found for "${trimmed}"`);
        setTimeout(() => setLookupError(null), 3000);
        return;
      }
      const match = response.results[0];
      setScannedItems((prev) => [
        ...prev,
        {
          code: trimmed,
          itemId: match.item.id,
          itemName: match.item.name,
          matchedField: match.matched_field,
          status: match.item.status,
          trackingType: match.item.tracking_type,
          quantity: 1,
          returnCondition: 'good',
        },
      ]);
    } catch (err: unknown) {
      const is404 =
        err instanceof Error &&
        'response' in err &&
        (err as { response?: { status?: number } }).response?.status === 404;
      if (is404) {
        setLookupError(`No item found for "${trimmed}"`);
      } else {
        setLookupError('Failed to look up item. Please check your connection and try again.');
      }
      setTimeout(() => setLookupError(null), 3000);
    } finally {
      setLookupLoading(false);
    }
  };

  // Keep the ref up to date so startCamera's interval sees current state
  handleCodeScannedRef.current = handleCodeScanned;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      handleCodeScanned(manualCode);
      setManualCode('');
      inputRef.current?.focus();
    }
  };

  const removeItem = (code: string) => {
    setScannedItems((prev) => prev.filter((si) => si.code !== code));
  };

  const updateQuantity = (code: string, qty: number) => {
    setScannedItems((prev) =>
      prev.map((si) => (si.code === code ? { ...si, quantity: Math.max(1, qty) } : si))
    );
  };

  const updateCondition = (code: string, condition: string) => {
    setScannedItems((prev) =>
      prev.map((si) => (si.code === code ? { ...si, returnCondition: condition } : si))
    );
  };

  // ── Batch submit ─────────────────────────────────────────────

  const confirmAndSubmit = () => {
    if (scannedItems.length === 0) return;
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    if (scannedItems.length === 0) return;
    setShowConfirm(false);
    setSubmitting(true);

    try {
      if (mode === 'checkout') {
        const response = await inventoryService.batchCheckout({
          user_id: userId,
          items: scannedItems.map((si) => ({
            code: si.code,
            quantity: si.quantity,
          })),
        });
        setResults(response.results);
        onComplete?.(response);
      } else {
        const response = await inventoryService.batchReturn({
          user_id: userId,
          items: scannedItems.map((si) => ({
            code: si.code,
            return_condition: si.returnCondition,
            quantity: si.quantity,
          })),
        });
        setResults(response.results);
        onComplete?.(response);
      }
    } catch {
      setLookupError('Failed to process batch. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────

  const title = mode === 'checkout' ? 'Assign Items' : 'Return Items';
  const showResults = results !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg" closeOnClickOutside={false}>
      <div className="space-y-4">
        {/* Member info */}
        <div className="bg-theme-surface-secondary rounded-lg p-3 flex items-center gap-3">
          <Package className="h-5 w-5 text-theme-text-muted" />
          <div>
            <span className="text-sm text-theme-text-muted">
              {mode === 'checkout' ? 'Assigning to' : 'Returning from'}:
            </span>
            <span className="ml-2 font-medium text-theme-text-primary">{memberName}</span>
          </div>
        </div>

        {/* Results view */}
        {showResults ? (
          <div className="space-y-3">
            <h4 className="font-medium text-theme-text-primary">Results</h4>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    r.success
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                      : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.success ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-theme-text-primary">{r.item_name}</p>
                      <p className="text-xs text-theme-text-muted">
                        {r.success ? r.action.replace(/_/g, ' ') : r.error}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-theme-text-muted">{r.code}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Scan input area */}
            <div className="space-y-3">
              {/* Camera toggle + manual input */}
              <div className="flex gap-2">
                {hasBarcodeDetector && (
                  <button
                    type="button"
                    onClick={cameraActive ? stopCamera : startCamera}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                      cameraActive
                        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400'
                        : 'border-theme-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary'
                    }`}
                  >
                    <Camera className="h-4 w-4" />
                    {cameraActive ? 'Stop Camera' : 'Start Camera'}
                  </button>
                )}
                <form onSubmit={handleManualSubmit} className="flex-1 flex gap-2">
                  <div className="relative flex-1">
                    <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder="Type or scan barcode / serial / asset tag / name..."
                      className="w-full pl-9 pr-3 py-2 border border-theme-border rounded-lg bg-theme-surface text-theme-text-primary placeholder:text-theme-text-muted text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!manualCode.trim() || lookupLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                  </button>
                </form>
              </div>

              {/* Camera video preview — always mounted so videoRef is available
                  when startCamera captures the stream */}
              <div
                className={`relative rounded-lg overflow-hidden bg-black ${cameraActive ? '' : 'hidden'}`}
              >
                <video
                  ref={videoRef}
                  className="w-full h-48 object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-0 border-2 border-red-500/50 pointer-events-none" />
                <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/80">
                  Point camera at barcode
                </p>
              </div>

              {/* Lookup error */}
              {lookupError && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">{lookupError}</p>
                </div>
              )}
            </div>

            {/* Scanned items list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-theme-text-primary">
                  Scanned Items ({scannedItems.length})
                </h4>
              </div>

              {scannedItems.length === 0 ? (
                <div className="text-center py-8 text-theme-text-muted text-sm">
                  {hasBarcodeDetector
                    ? 'Scan a barcode or type a code to get started'
                    : 'Type a barcode, serial number, or asset tag to get started'}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {scannedItems.map((si) => (
                    <div
                      key={si.code}
                      className="flex items-center justify-between p-3 rounded-lg border border-theme-border bg-theme-surface"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-theme-text-primary truncate">
                          {si.itemName}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {si.matchedField.replace(/_/g, ' ')}: {si.code}
                          {si.trackingType === 'pool' && ' (pool)'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 ml-3">
                        {/* Quantity for pool items */}
                        {si.trackingType === 'pool' && (
                          <input
                            type="number"
                            min={1}
                            value={si.quantity}
                            onChange={(e) => updateQuantity(si.code, parseInt(e.target.value) || 1)}
                            className="w-16 px-2 py-1 border border-theme-border rounded text-sm text-center bg-theme-surface text-theme-text-primary"
                            title="Quantity"
                          />
                        )}

                        {/* Return condition for return mode */}
                        {mode === 'return' && (
                          <select
                            value={si.returnCondition}
                            onChange={(e) => updateCondition(si.code, e.target.value)}
                            className="px-2 py-1 border border-theme-border rounded text-sm bg-theme-surface text-theme-text-primary"
                            title="Return condition"
                          >
                            <option value="excellent">Excellent</option>
                            <option value="good">Good</option>
                            <option value="fair">Fair</option>
                            <option value="poor">Poor</option>
                            <option value="damaged">Damaged</option>
                          </select>
                        )}

                        <button
                          onClick={() => removeItem(si.code)}
                          className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-theme-text-muted hover:text-red-600 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                          title="Remove"
                          aria-label={`Remove item ${si.code}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            {scannedItems.length > 0 && (
              <div className="flex justify-end gap-3 pt-2 border-t border-theme-border">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-theme-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {mode === 'checkout'
                    ? `Assign ${scannedItems.length} Item${scannedItems.length !== 1 ? 's' : ''}`
                    : `Return ${scannedItems.length} Item${scannedItems.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </>
        )}
        {/* Confirmation overlay */}
        {showConfirm && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg z-10">
            <div className="bg-theme-surface-modal border border-theme-surface-border rounded-lg p-5 max-w-sm mx-4 shadow-xl">
              <h4 className="text-theme-text-primary font-medium mb-2">
                Confirm {mode === 'checkout' ? 'Assignment' : 'Return'}
              </h4>
              <p className="text-theme-text-secondary text-sm mb-4">
                {mode === 'checkout'
                  ? `Assign ${scannedItems.length} item${scannedItems.length !== 1 ? 's' : ''} to ${memberName}?`
                  : `Return ${scannedItems.length} item${scannedItems.length !== 1 ? 's' : ''} from ${memberName}?`}
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowConfirm(false)} className="px-3 py-1.5 border border-theme-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-secondary text-sm">
                  Cancel
                </button>
                <button onClick={handleSubmit} className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Browser compatibility warning */}
        {!hasBarcodeDetector && (
          <p className="text-xs text-theme-text-muted text-center mt-2">
            Camera scanning is not supported in this browser. Use manual entry instead.
          </p>
        )}
      </div>
    </Modal>
  );
};
