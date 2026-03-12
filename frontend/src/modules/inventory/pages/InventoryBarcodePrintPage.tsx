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
import { ArrowLeft, Printer, Loader2, AlertCircle, Settings2, Download, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem } from '../types';
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
  nameFontSize: string;
  subtitleFontSize: string;
  padding: string;
  pageWidth: string;
  pageHeight: string;
  columns: number;
}

const LABEL_PRESETS: LabelPreset[] = [
  {
    id: 'dymo-30252',
    name: 'Dymo 30252',
    description: '1.125" x 3.5" — Standard address label',
    width: '3.5in', height: '1.125in',
    barcodeHeight: 40, barcodeWidth: 1.5,
    nameFontSize: '9pt', subtitleFontSize: '7pt',
    padding: '0.06in 0.1in',
    pageWidth: '3.5in', pageHeight: '1.125in', columns: 1,
  },
  {
    id: 'dymo-30336',
    name: 'Dymo 30336',
    description: '1" x 2.125" — Small multipurpose label',
    width: '2.125in', height: '1in',
    barcodeHeight: 30, barcodeWidth: 1,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2.125in', pageHeight: '1in', columns: 1,
  },
  {
    id: 'rollo-2x1',
    name: 'Rollo / Thermal 2" x 1"',
    description: '2" x 1" — Small thermal label',
    width: '2in', height: '1in',
    barcodeHeight: 32, barcodeWidth: 1,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2in', pageHeight: '1in', columns: 1,
  },
  {
    id: 'thermal-1x1',
    name: 'Thermal 1" x 1"',
    description: '1" x 1" — Square asset tag',
    width: '1in', height: '1in',
    barcodeHeight: 24, barcodeWidth: 0.8,
    nameFontSize: '6pt', subtitleFontSize: '5pt',
    padding: '0.03in',
    pageWidth: '1in', pageHeight: '1in', columns: 1,
  },
  {
    id: 'letter-grid',
    name: 'Letter Paper (Grid)',
    description: '8.5" x 11" — 30 labels per page (Avery 5160)',
    width: '2.625in', height: '1in',
    barcodeHeight: 35, barcodeWidth: 1.2,
    nameFontSize: '8pt', subtitleFontSize: '6.5pt',
    padding: '0.05in 0.1in',
    pageWidth: '8.5in', pageHeight: '11in', columns: 3,
  },
];

const DEFAULT_PRESET_ID = 'dymo-30252';

/** Map frontend preset IDs to backend label format keys */
const PRESET_TO_BACKEND: Record<string, string> = {
  'dymo-30252': 'dymo_30252',
  'dymo-30336': 'dymo_30334',
  'rollo-2x1': 'custom',
  'thermal-1x1': 'custom',
  'letter-grid': 'letter',
};

/** Gets a printable barcode value for an item, or null if none available */
function getBarcodeValue(item: InventoryItem): string | null {
  const value = item.barcode || item.asset_tag || item.serial_number;
  if (!value || value.trim().length === 0) return null;
  return value.trim();
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
      JsBarcode(svgRef.current, barcodeValue, {
        format: 'CODE128',
        width: preset.barcodeWidth,
        height: preset.barcodeHeight,
        displayValue: true,
        fontSize: 10,
        margin: 0,
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

  const subtitle = item.asset_tag
    ? `AT: ${item.asset_tag}`
    : item.serial_number
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
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [copies, setCopies] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [barcodesReady, setBarcodesReady] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const renderedCountRef = useRef(0);
  const totalLabelsRef = useRef(0);

  // LABEL_PRESETS is a compile-time constant with known length, so index 0 is always valid
  const defaultPreset = LABEL_PRESETS[0] as LabelPreset;
  const preset = LABEL_PRESETS.find((p) => p.id === presetId) ?? defaultPreset;
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

  // Reset rendered count when items or copies change.
  const prevItemsRef = useRef(items);
  const prevCopiesRef = useRef(copies);
  if (prevItemsRef.current !== items || prevCopiesRef.current !== copies) {
    renderedCountRef.current = 0;
    prevItemsRef.current = items;
    prevCopiesRef.current = copies;
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
      const backendFormat = PRESET_TO_BACKEND[preset.id] || 'letter';
      const customW = backendFormat === 'custom' ? parseFloat(preset.width) : undefined;
      const customH = backendFormat === 'custom' ? parseFloat(preset.height) : undefined;
      const blob = await inventoryService.generateBarcodeLabels(
        items.map(i => i.id),
        backendFormat,
        customW,
        customH,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barcode-labels-${new Date().toISOString().split('T')[0] ?? 'export'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('PDF downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate PDF'));
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
            .print-controls { display: none !important; }
            body, html { margin: 0; padding: 0; background: white !important; }

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
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
              >
                <Settings2 className="h-4 w-4" />
                Settings
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
                Print Labels
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
