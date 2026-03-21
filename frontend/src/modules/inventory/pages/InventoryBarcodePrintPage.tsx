/**
 * Inventory Barcode Print Page (Rewrite)
 *
 * Renders inventory item barcodes in a print-optimized layout.
 * Supports thermal label printers and standard paper.
 *
 * Fixes from previous version:
 * - Ensures all barcodes are fully rendered before printing (prevents blank labels)
 * - Adds PDF download option for thermal printer users
 * - Validates that items have printable barcode values before rendering
 * - Better SVG render timing with MutationObserver fallback
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { ArrowLeft, Printer, Loader2, AlertCircle, Settings2, Download, AlertTriangle, RotateCw, TestTube2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import toast from 'react-hot-toast';

// ── Label size presets ──────────────────────────────────────────

interface LabelPreset {
  id: string;
  name: string;
  description: string;
  width: string;
  height: string;
  barcodeHeight: number;
  barcodeWidth: number;
  /** Font size for the human-readable text beneath the barcode (px) */
  barcodeFontSize: number;
  nameFontSize: string;
  subtitleFontSize: string;
  padding: string;
  pageWidth: string;
  pageHeight: string;
  columns: number;
  /** Whether to auto-rotate landscape labels for roll-fed printers.
   *  Dymo drivers handle rotation themselves (false), while generic
   *  thermal / Rollo printers need the PDF pre-rotated (true). */
  autoRotate: boolean;
}

// Each preset uses a `backendFormat` key that maps directly to a backend
// LABEL_FORMATS entry, so the PDF download always generates at the exact
// same dimensions as the on-screen preview — no size mismatches.
const LABEL_PRESETS: LabelPreset[] = [
  {
    id: 'dymo_30252',
    name: 'Dymo 30252',
    description: '1.125" x 3.5" — Standard address label',
    width: '3.5in', height: '1.125in',
    barcodeHeight: 40, barcodeWidth: 1.5, barcodeFontSize: 10,
    nameFontSize: '9pt', subtitleFontSize: '7pt',
    padding: '0.06in 0.1in',
    pageWidth: '3.5in', pageHeight: '1.125in', columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30256',
    name: 'Dymo 30256',
    description: '2.3125" x 4" — Shipping label',
    width: '4in', height: '2.3125in',
    barcodeHeight: 50, barcodeWidth: 1.8, barcodeFontSize: 14,
    nameFontSize: '11pt', subtitleFontSize: '8pt',
    padding: '0.08in 0.12in',
    pageWidth: '4in', pageHeight: '2.3125in', columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30334',
    name: 'Dymo 30334',
    description: '2.25" x 1.25" — Multi-purpose label',
    width: '2.25in', height: '1.25in',
    barcodeHeight: 35, barcodeWidth: 1.1, barcodeFontSize: 9,
    nameFontSize: '8pt', subtitleFontSize: '6.5pt',
    padding: '0.05in 0.08in',
    pageWidth: '2.25in', pageHeight: '1.25in', columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30336',
    name: 'Dymo 30336',
    description: '1" x 2.125" — Small multipurpose label',
    width: '2.125in', height: '1in',
    barcodeHeight: 30, barcodeWidth: 1, barcodeFontSize: 8,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2.125in', pageHeight: '1in', columns: 1,
    autoRotate: false,
  },
  {
    id: 'rollo_4x6',
    name: 'Rollo 4" x 6"',
    description: '4" x 6" — Shipping label',
    width: '4in', height: '6in',
    barcodeHeight: 60, barcodeWidth: 2, barcodeFontSize: 16,
    nameFontSize: '14pt', subtitleFontSize: '10pt',
    padding: '0.12in 0.2in',
    pageWidth: '4in', pageHeight: '6in', columns: 1,
    autoRotate: true,
  },
  {
    id: 'rollo_2x1',
    name: 'Rollo / Thermal 2" x 1"',
    description: '2" x 1" — Small thermal label',
    width: '2in', height: '1in',
    barcodeHeight: 32, barcodeWidth: 1, barcodeFontSize: 8,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2in', pageHeight: '1in', columns: 1,
    autoRotate: true,
  },
  {
    id: 'thermal_1x1',
    name: 'Thermal 1" x 1"',
    description: '1" x 1" — Square asset tag',
    width: '1in', height: '1in',
    barcodeHeight: 24, barcodeWidth: 0.8, barcodeFontSize: 6,
    nameFontSize: '6pt', subtitleFontSize: '5pt',
    padding: '0.03in',
    pageWidth: '1in', pageHeight: '1in', columns: 1,
    autoRotate: true,
  },
  {
    id: 'letter',
    name: 'Letter Paper (Grid)',
    description: '8.5" x 11" — 30 labels per page (Avery 5160)',
    width: '2.625in', height: '1in',
    barcodeHeight: 35, barcodeWidth: 1.2, barcodeFontSize: 8,
    nameFontSize: '8pt', subtitleFontSize: '6.5pt',
    padding: '0.05in 0.1in',
    pageWidth: '8.5in', pageHeight: '11in', columns: 3,
    autoRotate: false,
  },
];

const DEFAULT_PRESET_ID = 'dymo_30252';

/** Code128 supports ASCII 0-127. Strip anything outside that range. */
function sanitizeForCode128(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[^\x00-\x7F]/g, '');
}

/** Gets a printable barcode value for an item, using the same fallback chain as the backend */
function getBarcodeValue(item: InventoryItem): string | null {
  const value = item.barcode || item.asset_tag || item.serial_number || item.id?.slice(0, 12);
  if (!value || value.trim().length === 0) return null;
  const sanitized = sanitizeForCode128(value.trim());
  return sanitized.length > 0 ? sanitized : null;
}

// ── Single barcode label ────────────────────────────────────────

interface BarcodeLabelProps {
  item: InventoryItem;
  preset: LabelPreset;
  onRendered?: () => void;
}

const BarcodeLabel: React.FC<BarcodeLabelProps> = ({ item, preset, onRendered }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const barcodeValue = getBarcodeValue(item);

  useEffect(() => {
    if (!svgRef.current || !barcodeValue) {
      onRendered?.();
      return;
    }
    try {
      // ISO/IEC 15417 requires a quiet zone of at least 10x the module
      // (bar) width on each side of a Code128 barcode for reliable scanning.
      const quietZone = Math.ceil(preset.barcodeWidth * 10);
      JsBarcode(svgRef.current, barcodeValue, {
        format: 'CODE128',
        width: preset.barcodeWidth,
        height: preset.barcodeHeight,
        displayValue: true,
        fontSize: preset.barcodeFontSize,
        marginTop: 0,
        marginBottom: 1,
        marginLeft: quietZone,
        marginRight: quietZone,
        textMargin: 1,
        font: 'monospace',
      });
    } catch {
      // Invalid barcode value — SVG stays empty
    }
    onRendered?.();
  }, [barcodeValue, preset.barcodeWidth, preset.barcodeHeight, onRendered]);

  if (!barcodeValue) {
    return (
      <div
        className="barcode-label"
        style={{
          width: preset.width, height: preset.height, padding: preset.padding,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', overflow: 'hidden', boxSizing: 'border-box',
          pageBreakInside: 'avoid',
        }}
      >
        <div style={{ fontSize: preset.nameFontSize, fontWeight: 600, textAlign: 'center', color: '#000' }}>
          {item.name}
        </div>
        <div style={{ fontSize: preset.subtitleFontSize, color: '#999', textAlign: 'center', marginTop: '4px' }}>
          No barcode value
        </div>
      </div>
    );
  }

  // Show secondary identifier only if it differs from the barcode value,
  // avoiding redundant text on the label.
  const subtitle = item.asset_tag && item.asset_tag !== barcodeValue
    ? `AT: ${item.asset_tag}`
    : item.serial_number && item.serial_number !== barcodeValue
      ? `S/N: ${item.serial_number}`
      : null;

  return (
    <div
      className="barcode-label"
      style={{
        width: preset.width, height: preset.height, padding: preset.padding,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden', boxSizing: 'border-box',
        pageBreakInside: 'avoid',
      }}
    >
      <div
        style={{
          fontSize: preset.nameFontSize, fontWeight: 600, textAlign: 'center',
          lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#000',
        }}
      >
        {item.name}
      </div>
      <svg
        ref={svgRef}
        style={{
          maxWidth: '100%', flexShrink: 0, display: 'block',
          colorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        } as React.CSSProperties}
      />
      {subtitle && (
        <div style={{ fontSize: preset.subtitleFontSize, color: '#444', textAlign: 'center', lineHeight: 1.1, marginTop: '1px' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
};

// ── Main page component ─────────────────────────────────────────

const InventoryBarcodePrintPage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [copies, setCopies] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [barcodesReady, setBarcodesReady] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [autoRotateOverride, setAutoRotateOverride] = useState<boolean | null>(null);
  const renderedCountRef = useRef(0);
  const totalLabelsRef = useRef(0);

  // LABEL_PRESETS is a compile-time constant with known length, so index 0 is always valid
  const defaultPreset = LABEL_PRESETS[0] as LabelPreset;
  const preset = LABEL_PRESETS.find((p) => p.id === presetId) ?? defaultPreset;
  const effectiveAutoRotate = autoRotateOverride ?? preset.autoRotate;
  const isLandscape = parseFloat(preset.width) > parseFloat(preset.height);
  const isThermal = preset.columns === 1;

  const fetchItems = useCallback(async () => {
    const idsParam = searchParams.get('ids');
    if (!idsParam) {
      setError('No items specified. Go back to inventory and select items to print.');
      setLoading(false);
      return;
    }

    const ids = idsParam.split(',').filter(Boolean);
    if (ids.length === 0) {
      setError('No valid item IDs provided.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const fetched = await Promise.all(ids.map((id) => inventoryService.getItem(id)));
      setItems(fetched);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load inventory items'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Track barcode rendering — compute expected total synchronously during
  // render so it's set before child useEffects fire onRendered callbacks.
  const expectedLabelCount = items.length * copies;
  totalLabelsRef.current = expectedLabelCount;

  // Reset rendered count when items, copies, or preset change so the
  // print button is gated until all labels have re-rendered.
  const prevItemsRef = useRef(items);
  const prevCopiesRef = useRef(copies);
  const prevPresetRef = useRef(presetId);
  if (prevItemsRef.current !== items || prevCopiesRef.current !== copies || prevPresetRef.current !== presetId) {
    renderedCountRef.current = 0;
    setBarcodesReady(false);
    prevItemsRef.current = items;
    prevCopiesRef.current = copies;
    prevPresetRef.current = presetId;
    // Reset rotation override when switching presets so each preset
    // uses its own default until the user explicitly overrides it.
    if (prevPresetRef.current !== presetId) {
      setAutoRotateOverride(null);
    }
  }

  const handleLabelRendered = useCallback(() => {
    renderedCountRef.current += 1;
    if (renderedCountRef.current >= totalLabelsRef.current) {
      setBarcodesReady(true);
    }
  }, []);

  // Items without printable barcodes
  const itemsWithoutBarcodes = items.filter(item => !getBarcodeValue(item));

  const handlePrint = () => {
    if (!barcodesReady) {
      toast.error('Barcodes are still rendering. Please wait a moment.');
      return;
    }
    // Double-check SVGs have content before printing
    const svgs = document.querySelectorAll('.barcode-label svg');
    const emptyCount = Array.from(svgs).filter(svg => !svg.innerHTML || svg.innerHTML.trim().length < 20).length;
    if (emptyCount > 0 && emptyCount === svgs.length) {
      toast.error('No barcodes rendered. Check that items have barcode, asset tag, or serial number values.');
      return;
    }
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (items.length === 0) return;
    setDownloadingPdf(true);
    try {
      // preset.id matches backend LABEL_FORMATS keys directly
      const { blob, autoPopulated } = await inventoryService.generateBarcodeLabels(
        items.map(i => i.id),
        preset.id,
        undefined,
        undefined,
        effectiveAutoRotate,
      );
      if (autoPopulated > 0) {
        toast.success(`${autoPopulated} item${autoPopulated !== 1 ? 's' : ''} had barcode values auto-generated`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barcode-labels-${getTodayLocalDate(tz)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('PDF downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate PDF'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleTestPrint = async () => {
    if (items.length === 0) return;
    setDownloadingPdf(true);
    try {
      const firstItem = items[0];
      if (!firstItem) return;
      const { blob } = await inventoryService.generateBarcodeLabels(
        [firstItem.id],
        preset.id,
        undefined,
        undefined,
        effectiveAutoRotate,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `test-label-${preset.id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('Test label PDF downloaded — print it to verify alignment and orientation');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate test label'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Build the repeated items list based on copies
  const labelItems: InventoryItem[] = [];
  for (let c = 0; c < copies; c++) {
    for (const item of items) {
      labelItems.push(item);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
        <span className="ml-2 text-theme-text-secondary">Loading items...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto p-6 mt-12">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
        <Link
          to="/inventory"
          className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Inventory
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Dynamic print styles */}
      <style>
        {`
          @media print {
            /* ── Hide everything except labels ── */
            .print-controls { display: none !important; }
            footer, [role="contentinfo"] { display: none !important; }

            /* Reset body/html — override global 12pt font-size so label
               preset sizes (6-9pt) are respected */
            body, html {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
              font-size: unset !important;
            }

            /* Remove the sidebar left-margin offset so labels aren't
               shifted off-center when the sidebar is hidden */
            .md\\:ml-64 {
              margin-left: 0 !important;
            }

            /* Remove the top padding added for the mobile top-bar */
            .pt-16 {
              padding-top: 0 !important;
            }

            /* Strip background gradient from the layout root */
            .min-h-screen {
              background: white !important;
            }

            @page {
              size: ${preset.pageWidth} ${preset.pageHeight};
              margin: ${isThermal ? '0' : '0.5in 0.19in'};
            }

            .barcode-labels-container {
              padding: 0 !important;
              margin: 0 !important;
              gap: 0 !important;
            }

            .barcode-label {
              break-inside: avoid;
              border: none !important;
              background: white !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }

            .barcode-label svg {
              display: block !important;
              visibility: visible !important;
              max-width: 100% !important;
              height: auto !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .barcode-label svg rect,
            .barcode-label svg g rect {
              fill: #000 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            ${isThermal ? `
              .barcode-label {
                page-break-after: always;
              }
              .barcode-label:last-child {
                page-break-after: auto;
              }
            ` : ''}

            /* Suppress the global rule that appends link URLs after text */
            a[href]:after { content: "" !important; }
          }

          @media screen {
            .barcode-label {
              border: 1px dashed #ccc;
              background: white;
            }
          }
        `}
      </style>

      {/* Screen-only controls */}
      <div className="print-controls min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Link
            to="/inventory"
            className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Inventory
          </Link>

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">Print Barcode Labels</h1>
              <p className="text-sm text-theme-text-muted mt-1">
                {items.length} item{items.length !== 1 ? 's' : ''} &middot; {labelItems.length} label{labelItems.length !== 1 ? 's' : ''} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              >
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </button>
              <button
                onClick={() => { void handleDownloadPdf(); }}
                disabled={downloadingPdf || items.length === 0}
                className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                PDF
              </button>
              <button
                onClick={handlePrint}
                disabled={!barcodesReady}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Print</span> Labels
              </button>
            </div>
          </div>

          {/* Warning for items without barcodes */}
          {itemsWithoutBarcodes.length > 0 && (
            <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                  {itemsWithoutBarcodes.length} item{itemsWithoutBarcodes.length !== 1 ? 's' : ''} missing barcode values
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                  These items have no barcode, asset tag, or serial number and will print without a scannable barcode:
                  {' '}{itemsWithoutBarcodes.map(i => i.name).join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Print scaling warning — scaling barcodes makes them unscannable */}
          <div className="mb-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Set scaling to 100% in the print dialog
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Barcodes must print at exact size to scan correctly.
                In the print dialog, set <strong>Scale</strong> to <strong>100%</strong> (or disable &quot;Fit to page&quot; / &quot;Shrink to fit&quot;).
                Set margins to <strong>{isThermal ? 'None' : '0.5" top/bottom, 0.19" sides'}</strong> and
                paper size to <strong>{preset.pageWidth} x {preset.pageHeight}</strong>.
                For thermal printers, the <strong>PDF</strong> download often produces better results than browser printing.
              </p>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="card-secondary p-4 mb-6 space-y-4">
              <h3 className="text-sm font-semibold text-theme-text-primary">Label Settings</h3>

              <div>
                <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
                  Label Size
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {LABEL_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPresetId(p.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        presetId === p.id
                          ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                          : 'border-theme-surface-border hover:bg-theme-surface-secondary'
                      }`}
                    >
                      <span className="block text-sm font-medium text-theme-text-primary">{p.name}</span>
                      <span className="block text-xs text-theme-text-muted">{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="label-copies" className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">
                  Copies per item
                </label>
                <input
                  id="label-copies"
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="form-input w-24"
                />
              </div>

              {/* Rotation control — only relevant for thermal presets with landscape labels */}
              {isThermal && (
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
                    Label Orientation (PDF only)
                  </label>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => setAutoRotateOverride(effectiveAutoRotate ? false : true)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        effectiveAutoRotate
                          ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500 text-theme-text-primary'
                          : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-secondary'
                      }`}
                    >
                      <RotateCw className="h-4 w-4" />
                      Auto-rotate for roll-fed
                    </button>
                    <div className="flex-1 text-xs text-theme-text-muted">
                      {effectiveAutoRotate ? (
                        <p>
                          <strong className="text-theme-text-primary">On:</strong> PDF content is rotated to match how roll-fed printers
                          (Rollo, Brother, generic thermal) feed labels narrow-edge first.
                          {isLandscape && ' The landscape content will be rotated 90° in the PDF.'}
                        </p>
                      ) : (
                        <p>
                          <strong className="text-theme-text-primary">Off:</strong> PDF matches the visual layout.
                          Use this for Dymo printers whose driver handles rotation automatically.
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Feed direction diagram */}
                  {isLandscape && (
                    <div className="mt-2 flex items-center gap-3 bg-theme-surface-secondary rounded-lg p-2.5">
                      <div
                        className="border border-theme-surface-border bg-white rounded flex items-center justify-center shrink-0"
                        style={{
                          width: effectiveAutoRotate ? '24px' : '60px',
                          height: effectiveAutoRotate ? '60px' : '24px',
                        }}
                      >
                        <span className="text-[6px] text-gray-400 font-mono">ABC</span>
                      </div>
                      <div className="text-xs text-theme-text-muted">
                        <span className="font-medium text-theme-text-primary">
                          {effectiveAutoRotate ? 'Portrait page' : 'Landscape page'}
                        </span>
                        {' — '}
                        {effectiveAutoRotate
                          ? 'Narrow edge feeds first into the printer. Content is pre-rotated so barcode reads correctly after printing.'
                          : 'Wide edge is the page width. The printer driver must rotate the content to match label orientation.'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Test print */}
              {isThermal && items.length > 0 && (
                <div>
                  <button
                    onClick={() => { void handleTestPrint(); }}
                    disabled={downloadingPdf}
                    className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors disabled:opacity-50"
                  >
                    {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                    Download Test Label
                  </button>
                  <p className="text-xs text-theme-text-muted mt-1">
                    Downloads a single-label PDF to verify orientation and alignment before printing the full batch.
                  </p>
                </div>
              )}

              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-xs font-medium text-theme-text-primary mb-1">Printer Tips</p>
                {isThermal ? (
                  <ul className="text-xs text-theme-text-muted space-y-0.5">
                    <li>Set your printer&apos;s paper size to match ({preset.width} x {preset.height})</li>
                    <li>In the print dialog, set margins to &quot;None&quot; or &quot;Minimum&quot;</li>
                    <li>Disable &quot;Scale to fit&quot; or set scaling to 100%</li>
                    <li>For Dymo: select the correct label type in Dymo Print Utility</li>
                    <li>For Rollo: the printer auto-detects label size</li>
                    <li>Alternatively, use the <strong>PDF</strong> button above for better thermal printer compatibility</li>
                  </ul>
                ) : (
                  <ul className="text-xs text-theme-text-muted space-y-0.5">
                    <li>Use Avery 5160 or compatible label sheets (30 labels per page)</li>
                    <li>Set margins to 0.5&quot; top/bottom, 0.19&quot; left/right</li>
                    <li>Disable &quot;Scale to fit&quot; or set scaling to 100%</li>
                  </ul>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Label preview — outside print-controls so it remains visible during print */}
      <div className="max-w-4xl mx-auto px-4 pb-6 print:max-w-none print:p-0">
        <div className="card-secondary p-4 print:bg-white print:p-0 print:border-0 print:shadow-none">
          <h3 className="text-sm font-medium text-theme-text-muted mb-3 print:hidden">Preview</h3>
          <div
            className="barcode-labels-container"
            style={{
              display: isThermal ? 'flex' : 'grid',
              flexDirection: isThermal ? 'column' : undefined,
              gridTemplateColumns: isThermal ? undefined : `repeat(${preset.columns}, ${preset.width})`,
              gap: isThermal ? '8px' : '0',
              alignItems: isThermal ? 'center' : undefined,
              justifyContent: isThermal ? undefined : 'center',
            }}
          >
            {labelItems.map((item, index) => (
              <BarcodeLabel
                key={`${item.id}-${index}`}
                item={item}
                preset={preset}
                onRendered={handleLabelRendered}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default InventoryBarcodePrintPage;
