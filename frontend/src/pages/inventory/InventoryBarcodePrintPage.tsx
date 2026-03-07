/**
 * Inventory Barcode Print Page
 *
 * Renders inventory item barcodes in a print-optimized layout designed for
 * thermal label printers (Dymo, Rollo, Brother) as well as standard printers.
 *
 * Supports multiple label sizes:
 * - Dymo 30252 (1.125" x 3.5") — standard address labels
 * - Dymo 30336 (1" x 2.125") — small multipurpose labels
 * - Rollo 4x6 (4" x 6") — shipping-size labels (multiple per page)
 * - Standard Letter (8.5" x 11") — grid layout for laser/inkjet
 *
 * Items are passed via URL query params (?ids=id1,id2,...) so the page can
 * be linked from anywhere (inventory list, item detail modal, etc.).
 *
 * Each label includes:
 * - Code128 barcode (scannable)
 * - Item name (truncated to fit)
 * - Asset tag or serial number
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { ArrowLeft, Printer, Loader2, AlertCircle, Settings2 } from 'lucide-react';
import { inventoryService, type InventoryItem } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';

// ── Label size presets ──────────────────────────────────────────

interface LabelPreset {
  id: string;
  name: string;
  description: string;
  /** CSS width for each label */
  width: string;
  /** CSS height for each label */
  height: string;
  /** Barcode height in pixels for JsBarcode */
  barcodeHeight: number;
  /** Barcode module width for JsBarcode */
  barcodeWidth: number;
  /** Font size for item name */
  nameFontSize: string;
  /** Font size for subtitle (asset tag / serial) */
  subtitleFontSize: string;
  /** CSS padding inside each label */
  padding: string;
  /** Page size for @page rule */
  pageWidth: string;
  pageHeight: string;
  /** Grid columns for sheet layouts */
  columns: number;
}

const DEFAULT_LABEL_PRESET: LabelPreset = {
  id: 'dymo-30252',
  name: 'Dymo 30252',
  description: '1.125" x 3.5" — Standard address label',
  width: '3.5in',
  height: '1.125in',
  barcodeHeight: 40,
  barcodeWidth: 1.5,
  nameFontSize: '9pt',
  subtitleFontSize: '7pt',
  padding: '0.06in 0.1in',
  pageWidth: '3.5in',
  pageHeight: '1.125in',
  columns: 1,
};

const LABEL_PRESETS: LabelPreset[] = [
  DEFAULT_LABEL_PRESET,
  {
    id: 'dymo-30336',
    name: 'Dymo 30336',
    description: '1" x 2.125" — Small multipurpose label',
    width: '2.125in',
    height: '1in',
    barcodeHeight: 30,
    barcodeWidth: 1,
    nameFontSize: '7pt',
    subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2.125in',
    pageHeight: '1in',
    columns: 1,
  },
  {
    id: 'rollo-2x1',
    name: 'Rollo / Thermal 2" x 1"',
    description: '2" x 1" — Small thermal label',
    width: '2in',
    height: '1in',
    barcodeHeight: 32,
    barcodeWidth: 1,
    nameFontSize: '7pt',
    subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2in',
    pageHeight: '1in',
    columns: 1,
  },
  {
    id: 'thermal-1x1',
    name: 'Thermal 1" x 1"',
    description: '1" x 1" — Square asset tag',
    width: '1in',
    height: '1in',
    barcodeHeight: 24,
    barcodeWidth: 0.8,
    nameFontSize: '6pt',
    subtitleFontSize: '5pt',
    padding: '0.03in',
    pageWidth: '1in',
    pageHeight: '1in',
    columns: 1,
  },
  {
    id: 'letter-grid',
    name: 'Letter Paper (Grid)',
    description: '8.5" x 11" — 30 labels per page (Avery 5160)',
    width: '2.625in',
    height: '1in',
    barcodeHeight: 35,
    barcodeWidth: 1.2,
    nameFontSize: '8pt',
    subtitleFontSize: '6.5pt',
    padding: '0.05in 0.1in',
    pageWidth: '8.5in',
    pageHeight: '11in',
    columns: 3,
  },
];

const DEFAULT_PRESET_ID = 'dymo-30252';

// ── Single barcode label ────────────────────────────────────────

interface BarcodeLabelProps {
  item: InventoryItem;
  preset: LabelPreset;
  onRendered?: () => void;
}

const BarcodeLabel: React.FC<BarcodeLabelProps> = ({ item, preset, onRendered }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const barcodeValue = item.barcode || item.asset_tag || item.serial_number || item.id.slice(0, 12);

  useEffect(() => {
    if (svgRef.current) {
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
        // Invalid barcode value — will show empty SVG
      }
    }
    onRendered?.();
  }, [barcodeValue, preset.barcodeWidth, preset.barcodeHeight, onRendered]);

  const subtitle = item.asset_tag
    ? `AT: ${item.asset_tag}`
    : item.serial_number
      ? `S/N: ${item.serial_number}`
      : null;

  return (
    <div
      className="barcode-label"
      style={{
        width: preset.width,
        height: preset.height,
        padding: preset.padding,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxSizing: 'border-box',
        pageBreakInside: 'avoid',
      }}
    >
      <div
        style={{
          fontSize: preset.nameFontSize,
          fontWeight: 600,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#000',
        }}
      >
        {item.name}
      </div>
      <svg
        ref={svgRef}
        style={{
          maxWidth: '100%',
          flexShrink: 0,
          display: 'block',
          colorAdjust: 'exact',
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        } as React.CSSProperties}
      />
      {subtitle && (
        <div
          style={{
            fontSize: preset.subtitleFontSize,
            color: '#444',
            textAlign: 'center',
            lineHeight: 1.1,
            marginTop: '1px',
          }}
        >
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
  const renderedCountRef = useRef(0);
  const totalLabelsRef = useRef(0);

  const preset = LABEL_PRESETS.find((p) => p.id === presetId) ?? LABEL_PRESETS[0] ?? DEFAULT_LABEL_PRESET;
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

  // Track barcode rendering — we compute the expected total synchronously
  // during render so it's set before child useEffects fire onRendered.
  const expectedTotal = items.length * copies;
  totalLabelsRef.current = expectedTotal;

  // Reset the rendered count when items or copies change.
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

  const handlePrint = () => {
    if (!barcodesReady) return;
    window.print();
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
      {/* Dynamic print styles — injected based on selected preset */}
      <style>
        {`
          @media print {
            /* Hide everything except labels */
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

            /* Ensure SVG barcodes are visible in print */
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

            /* For thermal printers, one label per page */
            ${isThermal ? `
              .barcode-label {
                page-break-after: always;
              }
              .barcode-label:last-child {
                page-break-after: auto;
              }
            ` : ''}

            /* Hide URL printing from links */
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
          {/* Back link */}
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
                onClick={handlePrint}
                disabled={!barcodesReady}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                Print Labels
              </button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="card p-4 mb-6 space-y-4">
              <h3 className="text-sm font-semibold text-theme-text-primary">Label Settings</h3>

              {/* Preset selector */}
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

              {/* Copies */}
              <div>
                <label
                  htmlFor="label-copies"
                  className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1"
                >
                  Copies per item
                </label>
                <input
                  id="label-copies"
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="w-24 px-3 py-2 border border-theme-input-border rounded-lg text-sm bg-theme-input-bg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Printer tips */}
              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-xs font-medium text-theme-text-primary mb-1">Printer Tips</p>
                {isThermal ? (
                  <ul className="text-xs text-theme-text-muted space-y-0.5">
                    <li>Set your printer&apos;s paper size to match the label size ({preset.width} x {preset.height})</li>
                    <li>In the print dialog, set margins to &quot;None&quot; or &quot;Minimum&quot;</li>
                    <li>Disable &quot;Scale to fit&quot; or set scaling to 100%</li>
                    <li>For Dymo: select the correct label type in Dymo Print Utility</li>
                    <li>For Rollo: the printer auto-detects label size</li>
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

          {/* Label preview */}
          <div className="card p-4">
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
      </div>
    </>
  );
};

export default InventoryBarcodePrintPage;
