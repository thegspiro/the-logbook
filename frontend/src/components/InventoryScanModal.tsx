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
 * Camera scanning uses the native BarcodeDetector API when available
 * (Chrome/Edge 83+, Android) for best performance, and falls back to
 * html5-qrcode on all other browsers (Firefox, Safari, etc.).
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { Camera, Check, AlertTriangle, Package, Trash2, Loader2, Search } from 'lucide-react';
import { RETURN_CONDITION_OPTIONS } from '../constants/enums';
import {
  inventoryService,
  ScanLookupResponse,
  ScanLookupResult,
  BatchCheckoutResponse,
  BatchReturnResponse,
} from '../services/api';
import { useHtml5Scanner } from '../hooks/useHtml5Scanner';
import { useScanFeedback } from '../hooks/useScanFeedback';
import { ScanSuccessFlash } from './ux/ScanSuccessFlash';
import { FlashlightToggle } from './ux/FlashlightToggle';
import { trackSupportsFlashlight, setTrackFlashlight } from '../utils/cameraTorch';
import {
  HAS_BARCODE_DETECTOR,
  BARCODE_SCAN_CONFIG,
  INVENTORY_BARCODE_FORMATS,
  NATIVE_BARCODE_FORMATS,
  acquirePreferredCameraStream,
  describeCameraError,
  getCameraUnavailableReason,
} from '../constants/camera';

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
  size?: string | undefined;
  color?: string | undefined;
}

type ResultItem = {
  code: string;
  item_name: string;
  action: string;
  success: boolean;
  error?: string;
};

type ActiveScanner = 'native' | 'html5' | null;

interface InventoryScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'checkout' | 'return';
  userId: string;
  memberName: string;
  onComplete?: (result: BatchCheckoutResponse | BatchReturnResponse) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

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
  const [activeScanner, setActiveScanner] = useState<ActiveScanner>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [searchResults, setSearchResults] = useState<ScanLookupResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState(-1);
  // Whether the native BarcodeDetector is present AND supports our formats.
  // Verified asynchronously on mount; until then we use the html5-qrcode path.
  const [nativeDetectorReady, setNativeDetectorReady] = useState(false);

  // Refs — native BarcodeDetector path only
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const nativeFormatsRef = useRef<string[]>([]);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const handleCodeScannedRef = useRef<(code: string) => void>(() => {});
  // Invalidates native camera acquisition when the modal closes or a newer
  // start/stop action supersedes a pending permission prompt.
  const cameraLifecycleRef = useRef(0);
  const resumeNativeCameraRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // ── Camera scanning ──────────────────────────────────────────

  // html5-qrcode fallback (Firefox, Safari, older browsers)
  const onHtml5Scan = useCallback((decodedText: string) => {
    handleCodeScannedRef.current(decodedText);
  }, []);

  const {
    startScanner: startHtml5Scanner,
    stopScanner: stopHtml5Scanner,
    flashlightSupported: html5FlashlightSupported,
    flashlightOn: html5FlashlightOn,
    toggleFlashlight: toggleHtml5Flashlight,
  } = useHtml5Scanner({
    viewportId: 'inventory-scanner-viewport',
    scanConfig: BARCODE_SCAN_CONFIG,
    onScan: onHtml5Scan,
    formatsToSupport: INVENTORY_BARCODE_FORMATS,
  });

  const { flashing, signalScanSuccess } = useScanFeedback();

  // Flashlight state for the native BarcodeDetector path (the html5-qrcode path
  // exposes its own via the hook above).
  const [nativeFlashlightSupported, setNativeFlashlightSupported] = useState(false);
  const [nativeFlashlightOn, setNativeFlashlightOn] = useState(false);
  const nativeFlashlightOnRef = useRef(false);
  nativeFlashlightOnRef.current = nativeFlashlightOn;

  // Verify the native BarcodeDetector actually supports our formats before
  // preferring it over html5-qrcode. Some Android builds expose the API but
  // support only a subset (or none) of our formats, which would otherwise scan
  // nothing. When unusable we fall back to html5-qrcode (broad support incl.
  // iOS Safari).
  useEffect(() => {
    if (!HAS_BARCODE_DETECTOR) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        const usable = NATIVE_BARCODE_FORMATS.filter((f) => supported.includes(f));
        if (!cancelled) {
          nativeFormatsRef.current = usable;
          setNativeDetectorReady(usable.length > 0);
        }
      } catch {
        if (!cancelled) setNativeDetectorReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopCamera = useCallback(() => {
    cameraLifecycleRef.current += 1;
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Always stop the fallback scanner too. BarcodeDetector support is
    // discovered asynchronously and may become ready after html5-qrcode has
    // already started; keying cleanup off the latest support state would then
    // leave the original camera stream running.
    void stopHtml5Scanner();
    setNativeFlashlightSupported(false);
    setNativeFlashlightOn(false);
    setCameraActive(false);
    setActiveScanner(null);
  }, [stopHtml5Scanner]);

  // Unified flashlight controls that dispatch to whichever scanning path is
  // active. The html5-qrcode path is driven by the hook; the native
  // BarcodeDetector path controls the raw MediaStreamTrack directly.
  const flashlightSupported = activeScanner === 'native' ? nativeFlashlightSupported : html5FlashlightSupported;
  const flashlightOn = activeScanner === 'native' ? nativeFlashlightOn : html5FlashlightOn;

  const toggleNativeFlashlight = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !nativeFlashlightOnRef.current;
    try {
      await setTrackFlashlight(track, next);
      setNativeFlashlightOn(next);
    } catch {
      setNativeFlashlightSupported(false);
    }
  }, []);

  const toggleFlashlight = useCallback(() => {
    return activeScanner === 'native' ? toggleNativeFlashlight() : toggleHtml5Flashlight();
  }, [activeScanner, toggleNativeFlashlight, toggleHtml5Flashlight]);

  const startCamera = useCallback(async () => {
    const lifecycle = ++cameraLifecycleRef.current;
    // Actionable message on insecure origins (HTTP LAN) where the camera APIs
    // are absent, instead of a misleading "permission denied".
    const unavailable = getCameraUnavailableReason();
    if (unavailable) {
      setLookupError(unavailable);
      setCameraActive(false);
      return;
    }

    if (nativeDetectorReady) {
      try {
        const stream = await acquirePreferredCameraStream();
        // getUserMedia can settle after the modal was closed (most commonly
        // when a mobile permission prompt was still open). Never attach that
        // late stream to an unmounted preview.
        if (lifecycle !== cameraLifecycleRef.current || !isOpenRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setNativeFlashlightSupported(trackSupportsFlashlight(stream.getVideoTracks()[0]));

        detectorRef.current = new BarcodeDetector({
          formats: nativeFormatsRef.current,
        });

        setActiveScanner('native');
        setCameraActive(true);
      } catch (err: unknown) {
        // A stream can be acquired successfully before detector setup fails.
        // Release it here rather than leaving the mobile camera indicator on
        // while the UI reports that scanning did not start.
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        detectorRef.current = null;
        if (lifecycle !== cameraLifecycleRef.current || !isOpenRef.current) return;
        setLookupError(describeCameraError(err));
        setCameraActive(false);
        setActiveScanner(null);
      }
    } else {
      try {
        await startHtml5Scanner();
        if (lifecycle !== cameraLifecycleRef.current || !isOpenRef.current) {
          await stopHtml5Scanner();
          return;
        }
        setActiveScanner('html5');
        setCameraActive(true);
      } catch (err: unknown) {
        if (lifecycle !== cameraLifecycleRef.current || !isOpenRef.current) return;
        setLookupError(describeCameraError(err));
        setCameraActive(false);
        setActiveScanner(null);
      }
    }
  }, [startHtml5Scanner, stopHtml5Scanner, nativeDetectorReady]);

  // Once cameraActive flips to true the <video> element mounts.
  // Wire the stream to it and start the barcode-polling interval.
  // (BarcodeDetector path only — html5-qrcode manages its own video.)
  useEffect(() => {
    if (!cameraActive || !streamRef.current) return;

    const video = videoRef.current;
    if (!video) return;

    video.srcObject = streamRef.current;
    video.play().catch(() => {
      // autoplay may be blocked; user will see a black preview
    });

    const alreadyScanned = new Set<string>();
    scanIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !detectorRef.current) return;
      void (async () => {
        try {
          const barcodes = (await detectorRef.current?.detect(videoRef.current as HTMLVideoElement)) ?? [];
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
      })();
    }, 300);

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [cameraActive]);

  // The raw BarcodeDetector path does not get the visibility handling supplied
  // by useHtml5Scanner. Release it while a phone is locked/backgrounded and
  // reacquire it on return; iOS otherwise commonly resumes to a frozen frame.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && activeScanner === 'native') {
        resumeNativeCameraRef.current = true;
        stopCamera();
      } else if (document.visibilityState === 'visible' && resumeNativeCameraRef.current && isOpenRef.current) {
        resumeNativeCameraRef.current = false;
        void startCamera();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [activeScanner, startCamera, stopCamera]);

  // Cleanup camera on unmount or close
  useEffect(() => {
    if (!isOpen) {
      resumeNativeCameraRef.current = false;
      stopCamera();
      setScannedItems([]);
      setManualCode('');
      setLookupError(null);
      setResults(null);
      setSearchResults([]);
      setShowDropdown(false);
      setActiveDropdownIndex(-1);
    }
  }, [isOpen, stopCamera]);

  // Re-focus the manual input after the Modal's own focus effect
  // steals focus to the modal container on open.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // ── Live search ────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    // Cancel any in-flight request so stale responses don't overwrite newer ones
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const trimmed = manualCode.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      void (async () => {
        try {
          const response: ScanLookupResponse = await inventoryService.lookupByCode(trimmed);
          if (controller.signal.aborted) return;
          setSearchResults(response.results);
          setShowDropdown(response.results.length > 0);
          setActiveDropdownIndex(-1);
        } catch {
          if (controller.signal.aborted) return;
          setSearchResults([]);
          setShowDropdown(false);
        } finally {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        }
      })();
    }, 300);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [manualCode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Code lookup ──────────────────────────────────────────────

  // Add an item from a search result directly (used by live dropdown and barcode scan)
  const addItemFromResult = (match: ScanLookupResult) => {
    // Don't add duplicates (check by item ID)
    if (scannedItems.some((si) => si.itemId === match.item.id)) {
      setLookupError(`"${match.item.name}" is already in the list`);
      setTimeout(() => setLookupError(null), 2000);
      return;
    }

    setScannedItems((prev) => [
      ...prev,
      {
        code: match.matched_value,
        itemId: match.item.id,
        itemName: match.item.name,
        matchedField: match.matched_field,
        status: match.item.status,
        trackingType: match.item.tracking_type,
        quantity: 1,
        returnCondition: 'good',
        size: match.item.size,
        color: match.item.color,
      },
    ]);
    setManualCode('');
    setShowDropdown(false);
    setSearchResults([]);
    inputRef.current?.focus();
  };

  // Keep ref in sync so startCamera's interval always calls the latest version
  const handleCodeScanned = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    // Bound the lookup key — a malfunctioning scanner can emit a very long
    // string; the backend caps this too, but fail fast on the client.
    if (trimmed.length > 255) {
      setLookupError('Scanned code is too long to look up.');
      setTimeout(() => setLookupError(null), 3000);
      return;
    }

    // Don't add duplicates (check by item ID via lookup first)
    // Note: code-based dedup removed — addItemFromResult checks by itemId

    setLookupLoading(true);
    setLookupError(null);

    try {
      const response: ScanLookupResponse = await inventoryService.lookupByCode(trimmed);
      if (response.results.length === 0) {
        setLookupError(`No item found for "${trimmed}"`);
        setTimeout(() => setLookupError(null), 3000);
        return;
      }
      const firstResult = response.results[0];
      if (firstResult) {
        signalScanSuccess();
        addItemFromResult(firstResult);
      }
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
  handleCodeScannedRef.current = (code: string) => {
    void handleCodeScanned(code);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // If dropdown is showing and an item is highlighted, add it
    if (showDropdown && activeDropdownIndex >= 0 && searchResults[activeDropdownIndex]) {
      addItemFromResult(searchResults[activeDropdownIndex]);
      return;
    }
    // If dropdown is showing with results, add the first one
    if (showDropdown && searchResults.length > 0) {
      const firstResult = searchResults[0];
      if (firstResult) addItemFromResult(firstResult);
      return;
    }
    // Fallback: search by what was typed
    if (manualCode.trim()) {
      void handleCodeScanned(manualCode);
      setManualCode('');
      inputRef.current?.focus();
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveDropdownIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveDropdownIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveDropdownIndex(-1);
    }
  };

  const removeItem = (itemId: string) => {
    setScannedItems((prev) => prev.filter((si) => si.itemId !== itemId));
  };

  const updateQuantity = (itemId: string, qty: number) => {
    setScannedItems((prev) => prev.map((si) => (si.itemId === itemId ? { ...si, quantity: Math.max(1, qty) } : si)));
  };

  const updateCondition = (itemId: string, condition: string) => {
    setScannedItems((prev) => prev.map((si) => (si.itemId === itemId ? { ...si, returnCondition: condition } : si)));
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
            item_id: si.itemId,
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
            item_id: si.itemId,
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
        <div className="bg-theme-surface-secondary flex items-center gap-3 rounded-lg p-3">
          <Package className="text-theme-text-muted h-5 w-5" />
          <div>
            <span className="text-theme-text-muted text-sm">
              {mode === 'checkout' ? 'Assigning to' : 'Returning from'}:
            </span>
            <span className="text-theme-text-primary ml-2 font-medium">{memberName}</span>
          </div>
        </div>

        {/* Results view */}
        {showResults ? (
          <div className="space-y-3">
            {/* Summary counts */}
            {(() => {
              const successCount = results.filter((r) => r.success).length;
              const failCount = results.length - successCount;
              return (
                <div className="flex items-center gap-3">
                  <h4 className="text-theme-text-primary font-medium">Results</h4>
                  <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                    {successCount} succeeded
                  </span>
                  {failCount > 0 && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                      {failCount} failed
                    </span>
                  )}
                </div>
              );
            })()}
            {/* Failed items first, then successes */}
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {[...results]
                .sort((a, b) => Number(a.success) - Number(b.success))
                .map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      r.success
                        ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                        : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.success ? (
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      )}
                      <div>
                        <p className="text-theme-text-primary text-sm font-medium">{r.item_name}</p>
                        <p
                          className={`text-xs ${r.success ? 'text-theme-text-muted' : 'font-medium text-red-600 dark:text-red-400'}`}
                        >
                          {r.success ? r.action.replace(/_/g, ' ') : r.error}
                        </p>
                      </div>
                    </div>
                    <span className="text-theme-text-muted font-mono text-xs">{r.code}</span>
                  </div>
                ))}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn-primary">
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
                <button
                  type="button"
                  onClick={
                    cameraActive
                      ? stopCamera
                      : () => {
                          void startCamera();
                        }
                  }
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    cameraActive
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400'
                      : 'border-theme-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary'
                  }`}
                >
                  <Camera className="h-4 w-4" />
                  {cameraActive ? 'Stop Camera' : 'Start Camera'}
                </button>
                <form onSubmit={handleManualSubmit} className="flex flex-1 gap-2">
                  <div className="relative flex-1">
                    <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      onFocus={() => {
                        if (searchResults.length > 0) setShowDropdown(true);
                      }}
                      placeholder="Search by name, barcode, serial, or asset tag..."
                      className="border-theme-border bg-theme-surface text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border py-2 pr-8 pl-9 text-sm focus:border-transparent focus:ring-2"
                      autoComplete="off"
                      autoFocus
                    />
                    {searchLoading && (
                      <Loader2 className="text-theme-text-muted absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                    )}

                    {/* Live search dropdown */}
                    {showDropdown && searchResults.length > 0 && (
                      <div
                        ref={dropdownRef}
                        className="bg-theme-surface-modal border-theme-surface-border absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border shadow-lg"
                      >
                        {searchResults.map((result, i) => {
                          const isAlreadyAdded = scannedItems.some((si) => si.itemId === result.item.id);
                          return (
                            <button
                              key={result.item.id}
                              type="button"
                              disabled={isAlreadyAdded}
                              onClick={() => !isAlreadyAdded && addItemFromResult(result)}
                              className={`border-theme-border flex w-full items-center justify-between gap-2 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                                isAlreadyAdded
                                  ? 'bg-theme-surface-secondary cursor-not-allowed opacity-50'
                                  : i === activeDropdownIndex
                                    ? 'bg-red-50 dark:bg-red-900/20'
                                    : 'hover:bg-theme-surface-secondary cursor-pointer'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-theme-text-primary truncate text-sm font-medium">
                                    {result.item.name}
                                  </p>
                                  {result.item.size && (
                                    <span className="inline-flex shrink-0 items-center rounded-sm bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                      {result.item.size}
                                    </span>
                                  )}
                                  {result.item.color && (
                                    <span className="inline-flex shrink-0 items-center rounded-sm bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                                      {result.item.color}
                                    </span>
                                  )}
                                </div>
                                <p className="text-theme-text-muted truncate text-xs">
                                  {result.matched_field.replace(/_/g, ' ')}: {result.matched_value}
                                  {result.item.tracking_type === 'pool' ? ' (pool)' : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                    result.item.status === 'available'
                                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                      : result.item.status === 'assigned'
                                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                                  }`}
                                >
                                  {result.item.status}
                                </span>
                                {isAlreadyAdded && <Check className="h-3.5 w-3.5 text-green-600" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!manualCode.trim() || lookupLoading}
                    className="btn-primary text-sm disabled:cursor-not-allowed"
                  >
                    {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                  </button>
                </form>
              </div>

              {/* Camera preview: native video for BarcodeDetector, div for html5-qrcode */}
              {activeScanner === 'native' ? (
                <div className={`relative overflow-hidden rounded-lg bg-black ${cameraActive ? '' : 'hidden'}`}>
                  <video ref={videoRef} className="h-48 w-full object-cover" playsInline muted />
                  <div className="pointer-events-none absolute inset-0 border-2 border-red-500/50" />
                  <p className="absolute right-0 bottom-2 left-0 text-center text-xs text-white/80">
                    Point camera at barcode
                  </p>
                  {flashlightSupported && <FlashlightToggle on={flashlightOn} onToggle={toggleFlashlight} />}
                  <ScanSuccessFlash active={flashing} />
                </div>
              ) : (
                <div className={`relative overflow-hidden rounded-lg ${cameraActive ? '' : 'hidden'}`}>
                  <div id="inventory-scanner-viewport" className="w-full" />
                  {cameraActive && flashlightSupported && (
                    <FlashlightToggle on={flashlightOn} onToggle={toggleFlashlight} />
                  )}
                  <ScanSuccessFlash active={flashing} />
                </div>
              )}

              {/* Lookup error */}
              {lookupError && (
                <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 dark:border-yellow-800 dark:bg-yellow-900/20">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">{lookupError}</p>
                </div>
              )}
            </div>

            {/* Scanned items list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-theme-text-primary text-sm font-medium">Scanned Items ({scannedItems.length})</h4>
                {scannedItems.length > 1 && (
                  <button
                    onClick={() => setScannedItems([])}
                    className="text-theme-text-muted text-xs transition-colors hover:text-red-600"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {scannedItems.length === 0 ? (
                <div className="text-theme-text-muted py-8 text-center text-sm">
                  Scan a barcode or type a code to get started
                </div>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {scannedItems.map((si) => (
                    <div
                      key={si.itemId}
                      className="border-theme-border bg-theme-surface flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-theme-text-primary truncate text-sm font-medium">{si.itemName}</p>
                          {si.size && (
                            <span className="inline-flex shrink-0 items-center rounded-sm bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                              {si.size}
                            </span>
                          )}
                          {si.color && (
                            <span className="inline-flex shrink-0 items-center rounded-sm bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                              {si.color}
                            </span>
                          )}
                        </div>
                        <p className="text-theme-text-muted text-xs">
                          {si.matchedField.replace(/_/g, ' ')}: {si.code}
                          {si.trackingType === 'pool' && ' (pool)'}
                        </p>
                      </div>

                      <div className="ml-3 flex items-center gap-2">
                        {/* Quantity for pool items */}
                        {si.trackingType === 'pool' && (
                          <div className="flex items-center gap-1">
                            {mode === 'return' && (
                              <span className="text-theme-text-muted text-xs whitespace-nowrap">Qty:</span>
                            )}
                            <input
                              type="number"
                              min={1}
                              value={si.quantity}
                              onChange={(e) => updateQuantity(si.itemId, parseInt(e.target.value) || 1)}
                              className="border-theme-border bg-theme-surface text-theme-text-primary w-16 rounded-sm border px-2 py-1 text-center text-sm"
                              title={mode === 'return' ? 'Quantity to return (partial return supported)' : 'Quantity'}
                            />
                          </div>
                        )}

                        {/* Return condition for return mode */}
                        {mode === 'return' && (
                          <select
                            value={si.returnCondition}
                            onChange={(e) => updateCondition(si.itemId, e.target.value)}
                            className="border-theme-border bg-theme-surface text-theme-text-primary rounded-sm border px-2 py-1 text-sm"
                            title="Return condition"
                          >
                            {RETURN_CONDITION_OPTIONS.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}

                        <button
                          onClick={() => removeItem(si.itemId)}
                          className="text-theme-text-muted focus:ring-theme-focus-ring flex min-h-[36px] min-w-[36px] items-center justify-center rounded-sm p-2 hover:text-red-600 focus:ring-2 focus:outline-hidden"
                          title="Remove"
                          aria-label={`Remove item ${si.itemName}`}
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
              <div className="border-theme-border flex justify-end gap-3 border-t pt-2">
                <button
                  onClick={onClose}
                  className="border-theme-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndSubmit}
                  disabled={submitting}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
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
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/50">
            <div className="bg-theme-surface-modal border-theme-surface-border mx-4 max-w-sm rounded-lg border p-5 shadow-xl">
              <h4 className="text-theme-text-primary mb-2 font-medium">
                Confirm {mode === 'checkout' ? 'Assignment' : 'Return'}
              </h4>
              <p className="text-theme-text-secondary mb-4 text-sm">
                {mode === 'checkout'
                  ? `Assign ${scannedItems.length} item${scannedItems.length !== 1 ? 's' : ''} to ${memberName}?`
                  : `Return ${scannedItems.length} item${scannedItems.length !== 1 ? 's' : ''} from ${memberName}?`}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="border-theme-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-lg border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleSubmit();
                  }}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
