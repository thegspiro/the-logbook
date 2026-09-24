/**
 * One field that takes a barcode from either input a quartermaster has to
 * hand: the device camera, or a handheld USB/Bluetooth scanner, which types
 * the code into the focused box and presses Enter. Both reach `onCode`.
 */

import React, { useRef, useState } from 'react';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { useHtml5Scanner } from '../../../hooks/useHtml5Scanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import {
  BARCODE_SCAN_CONFIG,
  INVENTORY_BARCODE_FORMATS,
  describeCameraError,
  getCameraUnavailableReason,
} from '../../../constants/camera';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { FlashlightToggle } from '../../../components/ux/FlashlightToggle';

// The camera decodes a label many times a second while it stays in view.
const REPEAT_WINDOW_MS = 1500;

interface ScanCodeFieldProps {
  /** Unique per page: html5-qrcode renders the preview into this element id. */
  viewportId: string;
  label: string;
  /** Return true when the code was recognised, to flash the success cue. */
  onCode: (code: string) => boolean;
}

export const ScanCodeField: React.FC<ScanCodeFieldProps> = ({ viewportId, label, onCode }) => {
  const [value, setValue] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const { flashing, signalScanSuccess } = useScanFeedback();

  const submit = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.code === code && now - last.at < REPEAT_WINDOW_MS) return;
    lastRef.current = { code, at: now };
    if (onCode(code)) signalScanSuccess();
  };

  const { scanning, startScanner, stopScanner, flashlightSupported, flashlightOn, toggleFlashlight } = useHtml5Scanner({
    viewportId,
    scanConfig: BARCODE_SCAN_CONFIG,
    onScan: submit,
    formatsToSupport: INVENTORY_BARCODE_FORMATS,
  });

  const cameraUnavailable = getCameraUnavailableReason();
  const inputId = `${viewportId}-input`;

  const toggleCamera = async () => {
    if (scanning) {
      await stopScanner();
      return;
    }
    setCameraError(null);
    try {
      await startScanner();
    } catch (err: unknown) {
      setCameraError(describeCameraError(err));
    }
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
          setValue('');
        }}
      >
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            className="form-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            // A handheld scanner types into whatever has focus.
            autoFocus
          />
          <button type="submit" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <ScanLine className="h-3.5 w-3.5" /> Find
          </button>
          <button
            type="button"
            onClick={() => void toggleCamera()}
            disabled={cameraUnavailable !== null}
            title={cameraUnavailable ?? undefined}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            {scanning ? <CameraOff className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {scanning ? 'Stop camera' : 'Camera'}
          </button>
        </div>
      </form>
      <div className={`relative overflow-hidden rounded-lg ${scanning ? '' : 'hidden'}`}>
        <div id={viewportId} className="w-full" />
        {scanning && flashlightSupported && <FlashlightToggle on={flashlightOn} onToggle={toggleFlashlight} />}
        <ScanSuccessFlash active={flashing} />
      </div>
      {cameraError && <p className="text-sm text-red-700 dark:text-red-400">{cameraError}</p>}
    </div>
  );
};

export default ScanCodeField;
