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

import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Barcode,
  QrCode,
  Printer,
  Loader2,
  AlertCircle,
  Settings2,
  Download,
  AlertTriangle,
  RotateCw,
  TestTube2,
  Send,
  ScanLine,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import type { InventoryItem } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatNumber, getTodayLocalDate } from '../../../utils/dateFormatting';
import { asArray } from '../../../utils/asArray';
import { getErrorMessage } from '../../../utils/errorHandling';
import { prefersPdfOverBrowserPrint } from '../../../utils/printEnvironment';
import toast from 'react-hot-toast';
import { LabelScopePicker } from '../components/LabelScopePicker';
import { LabelScanConfirm } from '../components/LabelScanConfirm';
import { PrinterLanguage, Symbology, labelPrinterService } from '../../../services/labelService';
import type { LabelPrinterConfig, PrintLabelsResult } from '../../../services/labelService';
import {
  EMPTY_LABEL_NAMES,
  HIDE_ASSET_TAG,
  HIDE_SERIAL_NUMBER,
  LABEL_EXTRA_FIELDS,
  labelExtraLine,
  labelIdentifierLine,
  sanitizeLabelLines,
  storageAreaPaths,
} from '../utils/labelLines';
import type { LabelNames } from '../utils/labelLines';
import {
  buildLabelFilterPath,
  MAX_LABEL_BATCH,
  MAX_LABEL_ITEMS_TOTAL,
  parseLabelPrintQuery,
} from '../utils/labelPrintQuery';

// ── Label size presets ──────────────────────────────────────────

interface LabelPreset {
  id: string;
  name: string;
  description: string;
  width: string;
  height: string;
  barcodeHeight: number;
  barcodeWidth: number;
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
    width: '3.5in',
    height: '1.125in',
    barcodeHeight: 40,
    barcodeWidth: 1.5,
    barcodeFontSize: 10,
    nameFontSize: '9pt',
    subtitleFontSize: '7pt',
    padding: '0.06in 0.1in',
    pageWidth: '3.5in',
    pageHeight: '1.125in',
    columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30256',
    name: 'Dymo 30256',
    description: '2.3125" x 4" — Shipping label',
    width: '4in',
    height: '2.3125in',
    barcodeHeight: 50,
    barcodeWidth: 1.8,
    barcodeFontSize: 14,
    nameFontSize: '11pt',
    subtitleFontSize: '8pt',
    padding: '0.08in 0.12in',
    pageWidth: '4in',
    pageHeight: '2.3125in',
    columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30334',
    name: 'Dymo 30334',
    description: '2.25" x 1.25" — Multi-purpose label',
    width: '2.25in',
    height: '1.25in',
    barcodeHeight: 35,
    barcodeWidth: 1.1,
    barcodeFontSize: 9,
    nameFontSize: '8pt',
    subtitleFontSize: '6.5pt',
    padding: '0.05in 0.08in',
    pageWidth: '2.25in',
    pageHeight: '1.25in',
    columns: 1,
    autoRotate: false,
  },
  {
    id: 'dymo_30336',
    name: 'Dymo 30336',
    description: '1" x 2.125" — Small multipurpose label',
    width: '2.125in',
    height: '1in',
    barcodeHeight: 30,
    barcodeWidth: 1,
    barcodeFontSize: 8,
    nameFontSize: '7pt',
    subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2.125in',
    pageHeight: '1in',
    columns: 1,
    autoRotate: false,
  },
  {
    id: 'rollo_4x6',
    name: 'Rollo 4" x 6"',
    description: '4" x 6" — Shipping label',
    width: '4in',
    height: '6in',
    barcodeHeight: 60,
    barcodeWidth: 2,
    barcodeFontSize: 16,
    nameFontSize: '14pt',
    subtitleFontSize: '10pt',
    padding: '0.12in 0.2in',
    pageWidth: '4in',
    pageHeight: '6in',
    columns: 1,
    autoRotate: true,
  },
  {
    id: 'rollo_2x1',
    name: 'Rollo / Thermal 2" x 1"',
    description: '2" x 1" — Small thermal label',
    width: '2in',
    height: '1in',
    barcodeHeight: 32,
    barcodeWidth: 1,
    barcodeFontSize: 8,
    nameFontSize: '7pt',
    subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2in',
    pageHeight: '1in',
    columns: 1,
    autoRotate: true,
  },
  {
    id: 'thermal_1x1',
    name: 'Thermal 1" x 1"',
    description: '1" x 1" — Square asset tag',
    width: '1in',
    height: '1in',
    barcodeHeight: 24,
    barcodeWidth: 0.8,
    barcodeFontSize: 6,
    nameFontSize: '6pt',
    subtitleFontSize: '5pt',
    padding: '0.03in',
    pageWidth: '1in',
    pageHeight: '1in',
    columns: 1,
    autoRotate: true,
  },
  {
    id: 'letter',
    name: 'Letter Paper (Grid)',
    description: '8.5" x 11" — 30 labels per page (Avery 5160)',
    width: '2.625in',
    height: '1in',
    barcodeHeight: 35,
    barcodeWidth: 1.2,
    barcodeFontSize: 8,
    nameFontSize: '8pt',
    subtitleFontSize: '6.5pt',
    padding: '0.05in 0.1in',
    pageWidth: '8.5in',
    pageHeight: '11in',
    columns: 3,
    autoRotate: false,
  },
];

const DEFAULT_PRESET_ID = 'dymo_30252';

// Sentinel id for the user-defined label size. Matches the backend
// LABEL_FORMATS "custom" key, which accepts custom_width / custom_height.
const CUSTOM_PRESET_ID = 'custom';

// Remember the chosen label printer/size across visits (non-sensitive UI
// preference) so a department that uses, e.g., a Rollo doesn't have to
// re-select it every time they print.
const PRESET_STORAGE_KEY = 'inventory:labelPreset';
const CUSTOM_DIMS_STORAGE_KEY = 'inventory:labelCustomDims';
// The network printer last used from this page, on this browser. Per-viewer: a
// quartermaster at the station and one at the warehouse want different rolls.
const PRINTER_STORAGE_KEY = 'inventory:labelPrinterId';
// The barcode style is also saved on the member's position with the label
// size; this local copy covers a member with no position to save it on.
const SYMBOLOGY_STORAGE_KEY = 'inventory:labelSymbology';
// What prints besides the code; also saved on the position with the size.
const LINES_STORAGE_KEY = 'inventory:labelLines';

function loadStoredLabelLines(): string[] {
  try {
    const raw = localStorage.getItem(LINES_STORAGE_KEY);
    if (raw) return sanitizeLabelLines(JSON.parse(raw)) ?? [];
  } catch {
    // Unavailable or malformed storage: print the default lines.
  }
  return [];
}

// Avery 5160, the one sheet layout: 3 columns by 10 rows.
const SHEET_LABELS_PER_PAGE = 30;

function isSymbology(value: unknown): value is Symbology {
  return value === Symbology.CODE128 || value === Symbology.QR;
}

function loadStoredSymbology(): Symbology {
  try {
    const stored = localStorage.getItem(SYMBOLOGY_STORAGE_KEY);
    if (isSymbology(stored)) return stored;
  } catch {
    // Unavailable storage falls back to the symbology every label had before.
  }
  return Symbology.CODE128;
}

function loadStoredPrinterId(): string | null {
  try {
    return localStorage.getItem(PRINTER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadStoredPresetId(): string {
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    if (stored && (stored === CUSTOM_PRESET_ID || LABEL_PRESETS.some((p) => p.id === stored))) {
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to the default.
  }
  return DEFAULT_PRESET_ID;
}

function loadStoredCustomDims(): { width: string; height: string } {
  try {
    const raw = localStorage.getItem(CUSTOM_DIMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
      const width = typeof parsed.width === 'string' ? parsed.width : '2';
      const height = typeof parsed.height === 'string' ? parsed.height : '1';
      return { width, height };
    }
  } catch {
    // Ignore malformed/unavailable storage.
  }
  return { width: '2', height: '1' };
}

function isKnownPreset(id: string): boolean {
  return id === CUSTOM_PRESET_ID || LABEL_PRESETS.some((p) => p.id === id);
}

/** A stable key for a preset choice, used to detect real changes worth saving. */
function presetKey(preset: string, width: string, height: string, symbology: Symbology, lines: string[]): string {
  return `${preset === CUSTOM_PRESET_ID ? `custom:${width}x${height}` : preset}:${symbology}:${lines.join(',')}`;
}

/** QR side length in inches: square, so bounded by both label dimensions,
 *  leaving room for the name above and the value below. */
function qrSizeInches(preset: LabelPreset): number {
  const width = parseFloat(preset.width);
  const height = parseFloat(preset.height);
  return Math.min(height * 0.5, width * 0.8, 1.5);
}

/** Synthesize a preset for an arbitrary width × height (inches) sticker so the
 *  on-screen preview and @page size track the entered dimensions. The PDF is
 *  generated by the backend at the exact custom size. */
function buildCustomPreset(widthIn: number, heightIn: number): LabelPreset {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const minDim = Math.min(widthIn, heightIn);
  return {
    id: CUSTOM_PRESET_ID,
    name: 'Custom size',
    description: `${widthIn}" × ${heightIn}" — custom label`,
    width: `${widthIn}in`,
    height: `${heightIn}in`,
    barcodeHeight: Math.round(clamp(heightIn * 36, 20, 70)),
    barcodeWidth: 1.2,
    barcodeFontSize: Math.round(clamp(minDim * 9, 6, 14)),
    nameFontSize: `${Math.round(clamp(heightIn * 8, 6, 12))}pt`,
    subtitleFontSize: `${Math.round(clamp(heightIn * 6, 5, 10))}pt`,
    padding: '0.05in 0.08in',
    pageWidth: `${widthIn}in`,
    pageHeight: `${heightIn}in`,
    columns: 1,
    autoRotate: true,
  };
}

/** Code128 supports ASCII 0-127. Return null rather than changing identifiers. */
function normalizeForCode128(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]+$/.test(trimmed) ? trimmed : null;
}

/** Gets a printable barcode value for an item, using the same fallback chain as the backend */
function getBarcodeValue(item: InventoryItem): string | null {
  // Never strip characters from an identifier: the printed value must still
  // match a value the scanner lookup can find. Fall back only to identifiers
  // that are themselves stored and searchable.
  const candidates = [item.barcode, item.asset_tag, item.serial_number];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeForCode128(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function labelToggleClass(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-secondary'
  }`;
}

// ── Single barcode label ────────────────────────────────────────

interface BarcodeLabelProps {
  item: InventoryItem;
  preset: LabelPreset;
  symbology: Symbology;
  labelLines: string[];
  names: LabelNames;
  onRendered?: () => void;
}

const BarcodeLabel: React.FC<BarcodeLabelProps> = ({ item, preset, symbology, labelLines, names, onRendered }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const barcodeValue = getBarcodeValue(item);
  const isQr = symbology === Symbology.QR;

  useEffect(() => {
    // QRCodeSVG draws during render, so a QR label is complete by now.
    if (isQr || !svgRef.current || !barcodeValue) {
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
  }, [isQr, barcodeValue, preset.barcodeWidth, preset.barcodeHeight, preset.barcodeFontSize, onRendered]);

  if (!barcodeValue) {
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
        <div style={{ fontSize: preset.nameFontSize, fontWeight: 600, textAlign: 'center', color: '#000' }}>
          {item.name}
        </div>
        <div style={{ fontSize: preset.subtitleFontSize, color: '#999', textAlign: 'center', marginTop: '4px' }}>
          No barcode value
        </div>
      </div>
    );
  }

  const subtitle = labelIdentifierLine(item, barcodeValue, labelLines);

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
      {isQr ? (
        <>
          <QRCodeSVG
            value={barcodeValue}
            level="M"
            marginSize={2}
            style={{
              width: `${qrSizeInches(preset)}in`,
              height: `${qrSizeInches(preset)}in`,
              flexShrink: 0,
              display: 'block',
            }}
          />
          <div style={{ fontSize: preset.subtitleFontSize, fontFamily: 'monospace', color: '#000', lineHeight: 1.1 }}>
            {barcodeValue}
          </div>
        </>
      ) : (
        <svg
          ref={svgRef}
          style={{
            maxWidth: '100%',
            flexShrink: 0,
            display: 'block',
            colorAdjust: 'exact',
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          }}
        />
      )}
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
      {(() => {
        const extra = labelExtraLine(item, labelLines, names);
        if (!extra) return null;
        const smallerSize = `calc(${preset.subtitleFontSize} - 1pt)`;
        return (
          <div
            style={{
              fontSize: smallerSize,
              color: '#666',
              textAlign: 'center',
              lineHeight: 1.1,
              marginTop: '1px',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {extra}
          </div>
        );
      })()}
    </div>
  );
};

// ── Main page component ─────────────────────────────────────────

const InventoryBarcodePrintPage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Everything the request named; `items` below is the part being printed.
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [part, setPart] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(loadStoredPresetId);
  const [symbology, setSymbology] = useState<Symbology>(loadStoredSymbology);
  // Where the first label lands on an Avery sheet, so a sheet with some
  // labels already peeled off goes back in the printer instead of the bin.
  const [startPosition, setStartPosition] = useState(1);
  const [copies, setCopies] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [barcodesReady, setBarcodesReady] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // After a print or PDF, ask whether the labels actually came out. Only a
  // confirmation takes items off the "needs a label" list: a cancelled print
  // dialog or a jammed roll looks identical to success from in here.
  const [labelConfirm, setLabelConfirm] = useState<'idle' | 'asking' | 'scanning' | 'saving' | 'done'>('idle');
  const [markedCount, setMarkedCount] = useState(0);
  const [printers, setPrinters] = useState<LabelPrinterConfig[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [sendingToPrinter, setSendingToPrinter] = useState(false);
  const [printResult, setPrintResult] = useState<PrintLabelsResult | null>(null);
  const [autoRotateOverride, setAutoRotateOverride] = useState<boolean | null>(null);
  const [labelLines, setLabelLines] = useState<string[]>(loadStoredLabelLines);
  const [labelNames, setLabelNames] = useState<LabelNames>(EMPTY_LABEL_NAMES);
  const [{ width: initialCustomWidth, height: initialCustomHeight }] = useState(loadStoredCustomDims);
  const [customWidth, setCustomWidth] = useState(initialCustomWidth);
  const [customHeight, setCustomHeight] = useState(initialCustomHeight);
  const renderedCountRef = useRef(0);
  const totalLabelsRef = useRef(0);
  // Mirror the current selection so the once-on-mount sync can read it without
  // becoming a dependency. null lastSavedKey = position preset not loaded yet.
  const presetStateRef = useRef({ presetId, customWidth, customHeight, symbology, labelLines });
  presetStateRef.current = { presetId, customWidth, customHeight, symbology, labelLines };
  const lastSavedKeyRef = useRef<string | null>(null);

  const firstPreset = LABEL_PRESETS[0];
  if (!firstPreset) throw new Error('LABEL_PRESETS must not be empty');
  const isCustom = presetId === CUSTOM_PRESET_ID;
  const customW = parseFloat(customWidth);
  const customH = parseFloat(customHeight);
  // Bound to what reportlab/printers handle sanely: 0.5"–8" wide, 0.5"–11" tall.
  const customValid =
    Number.isFinite(customW) &&
    Number.isFinite(customH) &&
    customW >= 0.5 &&
    customW <= 8 &&
    customH >= 0.5 &&
    customH <= 11;
  const preset = isCustom
    ? buildCustomPreset(customValid ? customW : 2, customValid ? customH : 1)
    : (LABEL_PRESETS.find((p) => p.id === presetId) ?? firstPreset);
  const effectiveAutoRotate = autoRotateOverride ?? preset.autoRotate;
  const isLandscape = parseFloat(preset.width) > parseFloat(preset.height);
  const isThermal = preset.columns === 1;
  // The label API accepts at most 500 records per PDF. Keep the copies control
  // inside that batch limit while retaining the existing per-item cap of 50.
  // Copies stay capped at 50 per item. A batch whose labels (items × copies)
  // exceed one job is printed in parts, each at most MAX_LABEL_BATCH labels,
  // so every print, PDF, network send and confirmation acts on one part.
  const maxCopies = 50;
  const itemsPerPart = Math.max(1, Math.floor(MAX_LABEL_BATCH / copies));
  const partCount = Math.max(1, Math.ceil(allItems.length / itemsPerPart));
  const currentPart = Math.min(part, partCount - 1);
  const items = useMemo(
    () => allItems.slice(currentPart * itemsPerPart, (currentPart + 1) * itemsPerPart),
    [allItems, currentPart, itemsPerPart]
  );
  // Another part is another print run: its confirmation starts over.
  const goToPart = (next: number) => {
    setPart(Math.max(0, next));
    setLabelConfirm('idle');
    setPrintResult(null);
    // A position describes the sheet in the printer for this run, not the next.
    setStartPosition(1);
  };

  const printRequest = useMemo(() => parseLabelPrintQuery(searchParams), [searchParams]);

  const fetchItems = useCallback(async () => {
    // A new batch has not been printed yet, whatever the last one was.
    setLabelConfirm('idle');
    setPrintResult(null);
    setPart(0);
    if (printRequest.kind === 'none') {
      // Nothing addressed: the picker renders instead of the labels.
      setLoading(false);
      return;
    }

    if (printRequest.kind === 'filter') {
      try {
        setLoading(true);
        setError(null);
        // Pages of 500, the list endpoint's own `limit` cap. The first page's
        // `total` says whether the set fits under the page's ceiling before
        // any more is fetched.
        const first = await inventoryService.getItems({
          ...printRequest.filters,
          skip: 0,
          limit: MAX_LABEL_BATCH,
        });
        const total = first.total ?? 0;
        if (total > MAX_LABEL_ITEMS_TOTAL) {
          setError(
            `${formatNumber(total)} items match. One print run can hold up to ${formatNumber(MAX_LABEL_ITEMS_TOTAL)} — narrow the filters and try again.`
          );
          return;
        }
        const matched = asArray(first.items);
        for (let skip = MAX_LABEL_BATCH; skip < total; skip += MAX_LABEL_BATCH) {
          const page = await inventoryService.getItems({ ...printRequest.filters, skip, limit: MAX_LABEL_BATCH });
          const rows = asArray(page.items);
          matched.push(...rows);
          if (rows.length < MAX_LABEL_BATCH) break;
        }
        if (matched.length === 0) {
          setError('No active items match these filters.');
          return;
        }
        // An item added while paging shifts the offsets and can repeat a row
        // across two pages; a label per item, not per page appearance.
        const seen = new Set<string>();
        setAllItems(matched.filter((item) => !seen.has(item.id) && seen.add(item.id)));
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to load inventory items'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const { ids } = printRequest;
    if (ids.length === 0) {
      setError('No valid item IDs provided.');
      setLoading(false);
      return;
    }
    if (ids.length > MAX_LABEL_BATCH) {
      setError('A maximum of 500 inventory items can be printed in one batch. Select fewer items and try again.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const fetched = await Promise.all(ids.map((id) => inventoryService.getItem(id)));
      setAllItems(fetched);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load inventory items'));
    } finally {
      setLoading(false);
    }
  }, [printRequest]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Remember the selected label size (and custom dimensions) so the printer
  // a department uses is the default next time they open this page.
  useEffect(() => {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, presetId);
    } catch {
      // Persisting a UI preference is best-effort.
    }
  }, [presetId]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_DIMS_STORAGE_KEY, JSON.stringify({ width: customWidth, height: customHeight }));
    } catch {
      // Best-effort.
    }
  }, [customWidth, customHeight]);

  useEffect(() => {
    try {
      localStorage.setItem(SYMBOLOGY_STORAGE_KEY, symbology);
    } catch {
      // Best-effort.
    }
  }, [symbology]);

  useEffect(() => {
    try {
      localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(labelLines));
    } catch {
      // Best-effort.
    }
  }, [labelLines]);

  // Names for the extra line, which items carry only as ids. Each list is
  // best-effort: a failure leaves that field reading as the printed PDF's
  // fallback rather than blocking the page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, locs, areas] = await Promise.allSettled([
        inventoryService.getCategories(),
        locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      if (cancelled) return;
      setLabelNames({
        categories: new Map(cats.status === 'fulfilled' ? cats.value.map((c) => [c.id, c.name]) : []),
        locations: new Map(locs.status === 'fulfilled' ? locs.value.map((l) => [l.id, l.name]) : []),
        areaPaths: areas.status === 'fulfilled' ? storageAreaPaths(areas.value) : new Map<string, string>(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // On mount, load the label preset saved for the member's position (server)
  // and apply it over the local default. The position's printer choice follows
  // whoever fills the role, on any computer. Falls back silently to the local
  // selection if there's no saved preset or the request fails.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pref = await inventoryService.getLabelPreset();
        if (cancelled) return;
        if (pref?.preset && isKnownPreset(pref.preset)) {
          setPresetId(pref.preset);
          const sym = isSymbology(pref.symbology) ? pref.symbology : presetStateRef.current.symbology;
          setSymbology(sym);
          const lines = sanitizeLabelLines(pref.extra_lines) ?? presetStateRef.current.labelLines;
          setLabelLines(lines);
          let w = presetStateRef.current.customWidth;
          let h = presetStateRef.current.customHeight;
          if (pref.preset === CUSTOM_PRESET_ID) {
            if (pref.custom_width != null) {
              w = String(pref.custom_width);
              setCustomWidth(w);
            }
            if (pref.custom_height != null) {
              h = String(pref.custom_height);
              setCustomHeight(h);
            }
          }
          lastSavedKeyRef.current = presetKey(pref.preset, w, h, sym, lines);
        } else {
          const s = presetStateRef.current;
          lastSavedKeyRef.current = presetKey(s.presetId, s.customWidth, s.customHeight, s.symbology, s.labelLines);
        }
      } catch {
        const s = presetStateRef.current;
        lastSavedKeyRef.current = presetKey(s.presetId, s.customWidth, s.customHeight, s.symbology, s.labelLines);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a deliberate change to the member's position (debounced,
  // best-effort — localStorage already holds the local copy).
  useEffect(() => {
    if (lastSavedKeyRef.current === null) return; // position preset not loaded yet
    if (isCustom && !customValid) return; // don't save invalid custom dimensions
    const key = presetKey(presetId, customWidth, customHeight, symbology, labelLines);
    if (key === lastSavedKeyRef.current) return;
    const timer = setTimeout(() => {
      lastSavedKeyRef.current = key;
      void inventoryService
        .setLabelPreset({
          preset: presetId,
          symbology,
          extra_lines: labelLines,
          ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
        })
        .catch(() => {
          // Best-effort; the local copy in localStorage still applies.
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [presetId, customWidth, customHeight, symbology, labelLines, isCustom, customValid, customW, customH]);

  // Track barcode rendering — compute expected total synchronously during
  // render so it's set before child useEffects fire onRendered callbacks.
  const expectedLabelCount = items.length * copies;
  totalLabelsRef.current = expectedLabelCount;

  // Reset rendered count when items, copies, or preset change so the
  // print button is gated until all labels have re-rendered.
  const prevItemsRef = useRef(items);
  const prevCopiesRef = useRef(copies);
  const prevPresetRef = useRef(presetId);
  const prevSymbologyRef = useRef(symbology);
  if (
    prevItemsRef.current !== items ||
    prevCopiesRef.current !== copies ||
    prevPresetRef.current !== presetId ||
    prevSymbologyRef.current !== symbology
  ) {
    // Capture before updating refs so the comparison works correctly.
    const presetChanged = prevPresetRef.current !== presetId;
    renderedCountRef.current = 0;
    setBarcodesReady(false);
    prevItemsRef.current = items;
    prevCopiesRef.current = copies;
    prevPresetRef.current = presetId;
    prevSymbologyRef.current = symbology;
    // Reset rotation override when switching presets so each preset
    // uses its own default until the user explicitly overrides it.
    if (presetChanged) {
      setAutoRotateOverride(null);
    }
  }

  const handleLabelRendered = useCallback(() => {
    renderedCountRef.current += 1;
    if (renderedCountRef.current >= totalLabelsRef.current) {
      setBarcodesReady(true);
    }
  }, []);

  const itemsWithoutBarcodes = items.filter((item) => !getBarcodeValue(item));

  // Registered network printers. Best-effort: an organization with none keeps
  // the browser-print and PDF paths, which is all this page offered before.
  useEffect(() => {
    let cancelled = false;
    labelPrinterService
      .list()
      .then((list) => {
        if (cancelled) return;
        setPrinters(list);
        const stored = loadStoredPrinterId();
        const initial = list.find((p) => p.id === stored) ?? list.find((p) => p.is_default) ?? list[0];
        if (initial) setSelectedPrinterId(initial.id);
      })
      .catch(() => {
        /* no printers, or no access to the list: the other print paths still work */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPrinter = printers.find((p) => p.id === selectedPrinterId) ?? null;
  // A receipt printer's roll decides the size, so this page's choice is not
  // sent and cannot mismatch. A die-cut label printer must be loaded with the
  // stock chosen here; an Avery sheet layout means nothing on a roll.
  const isReceiptPrinter = selectedPrinter?.language === PrinterLanguage.ESCPOS;
  const printerStockMismatch =
    selectedPrinter !== null && !isReceiptPrinter && !isCustom && selectedPrinter.label_format !== preset.id;
  // The network path renders labels read-only and never assigns a missing
  // barcode (the PDF path does), so a batch with an unlabelable item would be
  // refused by the server. Say so up front instead.
  const networkPrintBlocker =
    selectedPrinter === null
      ? 'Choose a printer'
      : !isReceiptPrinter && !isThermal
        ? 'Choose a thermal label size to print to a label printer'
        : printerStockMismatch
          ? `${selectedPrinter.name} is set up for different label stock — match the label size to it first`
          : itemsWithoutBarcodes.length > 0
            ? 'Some items have no barcode yet — download the PDF once to assign them'
            : isCustom && !customValid
              ? 'Enter a valid custom size'
              : null;

  const sendToPrinter = async () => {
    if (!selectedPrinter || items.length === 0) return;
    setSendingToPrinter(true);
    setPrintResult(null);
    try {
      const result = await labelPrinterService.print(
        'inventory',
        items.map((item) => item.id),
        {
          printer_id: selectedPrinter.id,
          ...(isReceiptPrinter
            ? {}
            : {
                label_format: isCustom ? CUSTOM_PRESET_ID : preset.id,
                ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
              }),
          copies,
          symbology,
          ...(labelLines.length > 0 ? { extra_lines: labelLines } : {}),
        }
      );
      setPrintResult(result);
      toast.success(`Sent ${result.labels_sent} label${result.labels_sent !== 1 ? 's' : ''} to ${result.printer_name}`);
      // A printer that is out of stock accepts the job and prints nothing, so
      // the confirmation below still asks rather than assuming success.
      setLabelConfirm('asking');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send labels to the printer'));
    } finally {
      setSendingToPrinter(false);
    }
  };

  const handlePrint = () => {
    if (!barcodesReady) {
      toast.error('Barcodes are still rendering. Please wait a moment.');
      return;
    }
    // On phones/tablets the hidden-iframe print pipeline is unreliable (mobile
    // Safari prints blank), so hand off to the server-generated PDF instead.
    // Do the same for legacy items without a printable stored identifier: the
    // PDF path assigns and persists a canonical barcode before it is printed.
    if (prefersPdfOverBrowserPrint() || itemsWithoutBarcodes.length > 0) {
      void handleDownloadPdf();
      return;
    }
    const container = document.querySelector('.barcode-labels-container');
    if (!container) {
      toast.error('Label container not found.');
      return;
    }
    const svgs = container.querySelectorAll('.barcode-label svg');
    const emptyCount = Array.from(svgs).filter((svg) => !svg.innerHTML || svg.innerHTML.trim().length < 20).length;
    if (svgs.length === 0 || emptyCount > 0) {
      toast.error('One or more barcodes did not render. Download the PDF instead to avoid printing blank labels.');
      return;
    }

    // Iframe-based printing: Chrome reliably applies @page size when it's
    // part of a static document parsed at load time, rather than injected
    // dynamically into the current page.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      toast.error('Could not create print frame.');
      return;
    }

    const labelsHtml = container.innerHTML;
    const containerStyle = container.getAttribute('style') || '';

    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html>
<html>
<head>
<style>
  @page {
    size: ${preset.pageWidth} ${preset.pageHeight};
    margin: ${isThermal ? '0' : '0.5in 0.19in'};
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; }
  .barcode-labels-container { padding: 0; margin: 0; }
  .barcode-label {
    break-inside: avoid;
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
  ${
    isThermal
      ? `
    .barcode-label { page-break-after: always; }
    .barcode-label:last-child { page-break-after: auto; }
  `
      : ''
  }
</style>
</head>
<body>
  <div class="barcode-labels-container" style="${containerStyle.replace(/"/g, '&quot;')}">${labelsHtml}</div>
</body>
</html>`);
    iframeDoc.close();

    let printed = false;
    const removeFrame = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      const win = iframe.contentWindow;
      win?.focus();
      // Remove the frame once the print dialog closes rather than on a fixed
      // timer — a slow dialog could otherwise tear down the document mid-print.
      // A long timeout backstops the case where afterprint never fires.
      win?.addEventListener('afterprint', removeFrame, { once: true });
      setTimeout(removeFrame, 60000);
      win?.print();
      setLabelConfirm('asking');
    };

    iframe.onload = triggerPrint;
    // document.write + close can complete synchronously, firing
    // readyState=complete before onload is wired up
    if (iframeDoc.readyState === 'complete') {
      triggerPrint();
    }
  };

  const recordLabelsPrinted = async (ids: string[]) => {
    const { marked } = await inventoryService.markLabelsPrinted(Array.from(new Set(ids)));
    setMarkedCount(marked);
    setLabelConfirm('done');
  };

  const confirmLabelsPrinted = async () => {
    setLabelConfirm('saving');
    try {
      await recordLabelsPrinted(items.map((item) => item.id));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the printed labels'));
      setLabelConfirm('asking');
    }
  };

  // Scan mode records only what was scanned. A failure is reported and
  // re-thrown so the scan panel stays open with every scan intact.
  const confirmScannedLabels = async (ids: string[]) => {
    try {
      await recordLabelsPrinted(ids);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the printed labels'));
      throw err;
    }
  };

  const handleDownloadPdf = async () => {
    if (items.length === 0) return;
    setDownloadingPdf(true);
    try {
      // Preserve the on-screen copy count in the server-rendered PDF. This is
      // also the print path used by phones and tablets, so sending each id only
      // once would silently issue fewer labels than the preview promises.
      const itemIds = Array.from({ length: copies }, () => items.map((item) => item.id)).flat();
      // preset.id matches backend LABEL_FORMATS keys directly ('custom' too).
      const { blob, autoPopulated } = await inventoryService.generateBarcodeLabels(
        itemIds,
        preset.id,
        isCustom ? customW : undefined,
        isCustom ? customH : undefined,
        effectiveAutoRotate,
        labelLines,
        { symbology, ...(isThermal ? {} : { startPosition }) }
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
      setLabelConfirm('asking');
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
        isCustom ? customW : undefined,
        isCustom ? customH : undefined,
        effectiveAutoRotate,
        labelLines,
        { symbology }
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

  // Blank cells ahead of the first label, so the preview and a browser print
  // lay the sheet out exactly as the PDF does. Rolls have no positions.
  const skippedPositions = isThermal ? 0 : startPosition - 1;
  const toggleLabelLine = (key: string) =>
    setLabelLines((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const labelItems: InventoryItem[] = [];
  for (let c = 0; c < copies; c++) {
    for (const item of items) {
      labelItems.push(item);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        <span className="text-theme-text-secondary ml-2">Loading items...</span>
      </div>
    );
  }

  if (printRequest.kind === 'none') {
    return <LabelScopePicker onChoose={(filters) => void navigate(buildLabelFilterPath(filters))} />;
  }

  if (error) {
    return (
      <div className="mx-auto mt-12 max-w-md p-6">
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
        <Link
          to="/inventory"
          className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Inventory
        </Link>
        {printRequest.kind === 'filter' && (
          <Link
            to="/inventory/print-labels"
            className="text-theme-text-muted hover:text-theme-text-secondary mt-2 flex items-center gap-1 text-sm"
          >
            <Settings2 className="h-4 w-4" />
            Choose different items
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Dynamic print styles */}
      <style>
        {`
          /* @page must be top-level — browsers ignore size when nested in @media */
          @page {
            size: ${preset.pageWidth} ${preset.pageHeight};
            margin: ${isThermal ? '0' : '0.5in 0.19in'};
          }

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

            ${
              isThermal
                ? `
              .barcode-label {
                page-break-after: always;
              }
              .barcode-label:last-child {
                page-break-after: auto;
              }
            `
                : ''
            }

            /* Suppress the global rule that appends link URLs after text */
            a[href]:after { content: "" !important; }
          }

          @media screen {
            .barcode-label {
              border: 1px dashed #ccc;
              background: white;
            }
            .barcode-label-skipped {
              border: 1px dashed #ddd;
              background: repeating-linear-gradient(45deg, #f5f5f5 0 6px, #fff 6px 12px);
            }
          }
        `}
      </style>

      {/* Screen-only controls */}
      <div className="print-controls min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-6">
          <Link
            to="/inventory"
            className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Inventory
          </Link>

          {/* Header */}
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Print Barcode Labels</h1>
              <p className="text-theme-text-muted mt-1 text-sm">
                {items.length} item{items.length !== 1 ? 's' : ''} &middot; {labelItems.length} label
                {labelItems.length !== 1 ? 's' : ''} {partCount > 1 ? 'in this part' : 'total'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
              >
                <Settings2 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Settings</span>
              </button>
              <button
                onClick={() => {
                  void handleDownloadPdf();
                }}
                disabled={downloadingPdf || items.length === 0 || (isCustom && !customValid)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                PDF
              </button>
              <button
                onClick={handlePrint}
                disabled={!barcodesReady || (isCustom && !customValid)}
                className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Print</span> Labels
              </button>
            </div>
          </div>

          {partCount > 1 && (
            <div className="card-secondary mb-4 flex flex-wrap items-center gap-3 p-3" aria-live="polite">
              <p className="text-theme-text-primary text-sm">
                <span className="font-medium">
                  Part {currentPart + 1} of {partCount}
                </span>{' '}
                &middot; items {formatNumber(currentPart * itemsPerPart + 1)}&ndash;
                {formatNumber(currentPart * itemsPerPart + items.length)} of {formatNumber(allItems.length)}
                <span className="text-theme-text-muted block text-xs">
                  A print job holds at most {formatNumber(MAX_LABEL_BATCH)} labels, so this run prints in parts. Print
                  and confirm each part in turn.
                </span>
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => goToPart(currentPart - 1)}
                  disabled={currentPart === 0}
                  className="btn-secondary btn-sm"
                >
                  Previous part
                </button>
                <button
                  type="button"
                  onClick={() => goToPart(currentPart + 1)}
                  disabled={currentPart >= partCount - 1}
                  className="btn-secondary btn-sm"
                >
                  Next part
                </button>
              </div>
            </div>
          )}

          {!isThermal && (
            <div className="card-secondary mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <label htmlFor="sheet-start-position" className="form-label">
                  Start at label
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="sheet-start-position"
                    type="number"
                    min={1}
                    max={SHEET_LABELS_PER_PAGE}
                    value={startPosition}
                    onChange={(e) =>
                      setStartPosition(Math.max(1, Math.min(SHEET_LABELS_PER_PAGE, parseInt(e.target.value) || 1)))
                    }
                    aria-describedby="sheet-start-position-help"
                    className="form-input w-24"
                  />
                  <span className="text-theme-text-secondary text-sm">of {SHEET_LABELS_PER_PAGE}</span>
                </div>
                <p id="sheet-start-position-help" className="text-theme-text-muted mt-1 text-xs">
                  {startPosition > 1
                    ? `Labels 1–${startPosition - 1} are left blank, so a partly used sheet can go back in the printer.`
                    : 'Reusing a sheet with some labels already peeled off? Start at the first label still on it, counting across each row.'}
                </p>
              </div>
              <div
                className="grid shrink-0 grid-cols-3 gap-0.5 self-center rounded border border-slate-300 bg-white p-1"
                aria-hidden="true"
              >
                {Array.from({ length: SHEET_LABELS_PER_PAGE }, (_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 w-4 rounded-[1px] ${
                      index < startPosition - 1
                        ? 'bg-slate-300'
                        : index === startPosition - 1
                          ? 'bg-emerald-700'
                          : 'border border-slate-300'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {printers.length > 0 && (
            <div className="card-secondary mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="inventory-label-printer" className="form-label">
                  Label printer
                </label>
                <select
                  id="inventory-label-printer"
                  className="form-input"
                  value={selectedPrinterId}
                  onChange={(e) => {
                    setSelectedPrinterId(e.target.value);
                    setPrintResult(null);
                    try {
                      localStorage.setItem(PRINTER_STORAGE_KEY, e.target.value);
                    } catch {
                      // Unavailable storage only costs remembering the choice.
                    }
                  }}
                >
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.location ? ` — ${p.location}` : ''}
                    </option>
                  ))}
                </select>
                {networkPrintBlocker && selectedPrinter && (
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{networkPrintBlocker}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void sendToPrinter()}
                disabled={sendingToPrinter || items.length === 0 || networkPrintBlocker !== null}
                className="flex items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-800 disabled:opacity-50"
              >
                {sendingToPrinter ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {selectedPrinter ? `Print to ${selectedPrinter.name}` : 'Print to label printer'}
              </button>
            </div>
          )}

          {printResult && (
            <div
              className={`mb-4 rounded-lg border p-3 ${
                printResult.printer_errors.length > 0
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
              }`}
              role="status"
            >
              <p className="text-theme-text-primary text-sm font-medium">
                {formatNumber(printResult.labels_sent)} label{printResult.labels_sent === 1 ? '' : 's'} sent to{' '}
                {printResult.printer_name}
              </p>
              {printResult.printer_errors.length > 0 ? (
                <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                  Printer fault: {printResult.printer_errors.join(', ')}
                </p>
              ) : printResult.printer_warnings.length > 0 ? (
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                  Printer warning: {printResult.printer_warnings.join(', ')}
                </p>
              ) : !printResult.status_known ? (
                <p className="text-theme-text-muted mt-1 text-sm">
                  This printer does not report its status, so delivery could not be confirmed. Check the labels.
                </p>
              ) : (
                <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">The printer reported no faults.</p>
              )}
            </div>
          )}

          {labelConfirm === 'scanning' && (
            <LabelScanConfirm
              items={items}
              labelValueOf={getBarcodeValue}
              onConfirm={confirmScannedLabels}
              onCancel={() => setLabelConfirm('asking')}
            />
          )}

          {labelConfirm !== 'idle' && labelConfirm !== 'scanning' && (
            <div
              className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
              role="status"
            >
              {labelConfirm === 'done' ? (
                <>
                  <p className="text-sm text-emerald-800 dark:text-emerald-300">
                    {formatNumber(markedCount)} {markedCount === 1 ? 'item' : 'items'} marked as labelled.
                  </p>
                  {currentPart < partCount - 1 && (
                    <button type="button" onClick={() => goToPart(currentPart + 1)} className="btn-success btn-sm">
                      Next part ({currentPart + 2} of {partCount})
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-emerald-800 dark:text-emerald-300">
                    Did the labels print correctly? Confirming takes these items off the &ldquo;needs a label&rdquo;
                    list. If only some came out, scan those to confirm just them.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmLabelsPrinted()}
                      disabled={labelConfirm === 'saving'}
                      className="btn-success btn-sm"
                    >
                      {labelConfirm === 'saving'
                        ? 'Saving…'
                        : `Mark ${formatNumber(items.length)} ${items.length === 1 ? 'item' : 'items'} as labelled`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabelConfirm('scanning')}
                      disabled={labelConfirm === 'saving'}
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                    >
                      <ScanLine className="h-3.5 w-3.5" /> Scan labels to confirm
                    </button>
                    <button type="button" onClick={() => setLabelConfirm('idle')} className="btn-secondary btn-sm">
                      Not yet
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Warning for items without barcodes */}
          {itemsWithoutBarcodes.length > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                  {itemsWithoutBarcodes.length} item{itemsWithoutBarcodes.length !== 1 ? 's' : ''} missing barcode
                  values
                </p>
                <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                  These items have no barcode, asset tag, or serial number and will print without a scannable barcode:{' '}
                  {itemsWithoutBarcodes.map((i) => i.name).join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Print scaling warning — scaling barcodes makes them unscannable */}
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Set scaling to 100% in the print dialog
              </p>
              <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                Barcodes must print at exact size to scan correctly. In the print dialog, set <strong>Scale</strong> to{' '}
                <strong>100%</strong> (or disable &quot;Fit to page&quot; / &quot;Shrink to fit&quot;). Set margins to{' '}
                <strong>{isThermal ? 'None' : '0.5" top/bottom, 0.19" sides'}</strong> and paper size to{' '}
                <strong>
                  {preset.pageWidth} x {preset.pageHeight}
                </strong>
                . For thermal printers, the <strong>PDF</strong> download often produces better results than browser
                printing.
              </p>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="card-secondary mb-6 space-y-4 p-4">
              <h3 className="text-theme-text-primary text-sm font-semibold">Label Settings</h3>

              <div>
                <label className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                  Label Size
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {LABEL_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPresetId(p.id)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        presetId === p.id
                          ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                          : 'border-theme-surface-border hover:bg-theme-surface-secondary'
                      }`}
                    >
                      <span className="text-theme-text-primary block text-sm font-medium">{p.name}</span>
                      <span className="text-theme-text-muted block text-xs">{p.description}</span>
                    </button>
                  ))}
                  <button
                    key={CUSTOM_PRESET_ID}
                    onClick={() => setPresetId(CUSTOM_PRESET_ID)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isCustom
                        ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                        : 'border-theme-surface-border hover:bg-theme-surface-secondary'
                    }`}
                  >
                    <span className="text-theme-text-primary block text-sm font-medium">Custom size</span>
                    <span className="text-theme-text-muted block text-xs">
                      Enter exact label dimensions for any sticker printer
                    </span>
                  </button>
                </div>

                {isCustom && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label
                        htmlFor="custom-width"
                        className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                      >
                        Width (in)
                      </label>
                      <input
                        id="custom-width"
                        type="number"
                        step="0.05"
                        min={0.5}
                        max={8}
                        value={customWidth}
                        onChange={(e) => setCustomWidth(e.target.value)}
                        className="form-input w-24"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="custom-height"
                        className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                      >
                        Height (in)
                      </label>
                      <input
                        id="custom-height"
                        type="number"
                        step="0.05"
                        min={0.5}
                        max={11}
                        value={customHeight}
                        onChange={(e) => setCustomHeight(e.target.value)}
                        className="form-input w-24"
                      />
                    </div>
                    {!customValid && (
                      <p className="pb-2 text-xs text-red-600 dark:text-red-400">
                        Enter a width of 0.5–8&quot; and a height of 0.5–11&quot;.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <p className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                  Barcode Style
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Barcode style">
                  {[
                    {
                      id: Symbology.CODE128,
                      icon: Barcode,
                      name: 'Code 128',
                      hint: 'The usual barcode; scans with any handheld scanner',
                    },
                    {
                      id: Symbology.QR,
                      icon: QrCode,
                      name: 'QR code',
                      hint: 'Fits a small square tag, survives scuffs, scans with a phone',
                    },
                  ].map((option) => {
                    const Icon = option.icon;
                    const active = symbology === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSymbology(option.id)}
                        className={`flex flex-1 items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors sm:flex-none ${
                          active
                            ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                            : 'border-theme-surface-border hover:bg-theme-surface-secondary'
                        }`}
                      >
                        <Icon className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="text-theme-text-primary block text-sm font-medium">{option.name}</span>
                          <span className="text-theme-text-muted block text-xs">{option.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="label-copies"
                  className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                >
                  Copies per item
                </label>
                <input
                  id="label-copies"
                  type="number"
                  min={1}
                  max={maxCopies}
                  value={copies}
                  onChange={(e) => {
                    setCopies(Math.max(1, Math.min(maxCopies, parseInt(e.target.value) || 1)));
                    // Parts are cut by label count, so a new copy count re-cuts them.
                    goToPart(0);
                  }}
                  className="form-input w-24"
                />
              </div>

              {/* Label content */}
              <div>
                <p className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                  What Prints on the Label
                </p>
                <p className="text-theme-text-muted mb-2 text-xs">
                  The item name and its code always print. An asset tag or serial number that repeats the code is left
                  off anyway.
                </p>
                <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Identifiers">
                  {[
                    { hideKey: HIDE_ASSET_TAG, label: 'Asset tag' },
                    { hideKey: HIDE_SERIAL_NUMBER, label: 'Serial number' },
                  ].map(({ hideKey, label }) => {
                    const shown = !labelLines.includes(hideKey);
                    return (
                      <button
                        key={hideKey}
                        type="button"
                        aria-pressed={shown}
                        onClick={() => toggleLabelLine(hideKey)}
                        className={labelToggleClass(shown)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-theme-text-muted mb-2 text-xs">
                  Extra details print on one line, in the order you pick them, space permitting.
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Extra details">
                  {LABEL_EXTRA_FIELDS.map(({ key, label }) => {
                    const active = labelLines.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleLabelLine(key)}
                        className={labelToggleClass(active)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {LABEL_EXTRA_FIELDS.some(({ key }) => labelLines.includes(key)) && (
                  <p className="text-theme-text-muted mt-1.5 text-xs">
                    On small labels, extra text may be truncated or omitted if it doesn&apos;t fit.
                  </p>
                )}
              </div>

              {/* Rotation control — only relevant for thermal presets with landscape labels */}
              {isThermal && (
                <div>
                  <label className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                    Label Orientation (PDF only)
                  </label>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => setAutoRotateOverride(effectiveAutoRotate ? false : true)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        effectiveAutoRotate
                          ? 'text-theme-text-primary border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                          : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-secondary'
                      }`}
                    >
                      <RotateCw className="h-4 w-4" />
                      Auto-rotate for roll-fed
                    </button>
                    <div className="text-theme-text-muted flex-1 text-xs">
                      {effectiveAutoRotate ? (
                        <p>
                          <strong className="text-theme-text-primary">On:</strong> PDF content is rotated to match how
                          roll-fed printers (Rollo, Brother, generic thermal) feed labels narrow-edge first.
                          {isLandscape && ' The landscape content will be rotated 90° in the PDF.'}
                        </p>
                      ) : (
                        <p>
                          <strong className="text-theme-text-primary">Off:</strong> PDF matches the visual layout. Use
                          this for Dymo printers whose driver handles rotation automatically.
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Feed direction diagram */}
                  {isLandscape && (
                    <div className="bg-theme-surface-secondary mt-2 flex items-center gap-3 rounded-lg p-2.5">
                      <div
                        className="border-theme-surface-border flex shrink-0 items-center justify-center rounded border bg-white"
                        style={{
                          width: effectiveAutoRotate ? '24px' : '60px',
                          height: effectiveAutoRotate ? '60px' : '24px',
                        }}
                      >
                        <span className="font-mono text-[6px] text-gray-400">ABC</span>
                      </div>
                      <div className="text-theme-text-muted text-xs">
                        <span className="text-theme-text-primary font-medium">
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
                    onClick={() => {
                      void handleTestPrint();
                    }}
                    disabled={downloadingPdf || (isCustom && !customValid)}
                    className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
                  >
                    {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                    Download Test Label
                  </button>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Downloads a single-label PDF to verify orientation and alignment before printing the full batch.
                  </p>
                </div>
              )}

              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-theme-text-primary mb-1 text-xs font-medium">Printer Tips</p>
                {isThermal ? (
                  <ul className="text-theme-text-muted space-y-0.5 text-xs">
                    <li>
                      Set your printer&apos;s paper size to match ({preset.width} x {preset.height})
                    </li>
                    <li>In the print dialog, set margins to &quot;None&quot; or &quot;Minimum&quot;</li>
                    <li>Disable &quot;Scale to fit&quot; or set scaling to 100%</li>
                    <li>For Dymo: select the correct label type in Dymo Print Utility</li>
                    <li>For Rollo: the printer auto-detects label size</li>
                    <li>
                      Alternatively, use the <strong>PDF</strong> button above for better thermal printer compatibility
                    </li>
                  </ul>
                ) : (
                  <ul className="text-theme-text-muted space-y-0.5 text-xs">
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
      <div className="mx-auto max-w-4xl px-4 pb-6 print:max-w-none print:p-0">
        <div className="card-secondary p-4 print:border-0 print:bg-white print:p-0 print:shadow-none">
          <h3 className="text-theme-text-muted mb-3 text-sm font-medium print:hidden">Preview</h3>
          {/* Fixed inch-width label grid can exceed a phone's viewport — scroll
              it horizontally on screen. print:overflow-visible keeps a direct
              browser print from clipping the sheet. */}
          <div className="overflow-x-auto print:overflow-visible">
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
              {Array.from({ length: skippedPositions }, (_, index) => (
                <div
                  key={`skipped-${index}`}
                  className="barcode-label-skipped"
                  data-testid="skipped-label-position"
                  aria-hidden="true"
                  style={{ width: preset.width, height: preset.height, boxSizing: 'border-box' }}
                />
              ))}
              {labelItems.map((item, index) => (
                <BarcodeLabel
                  key={`${item.id}-${index}`}
                  item={item}
                  preset={preset}
                  symbology={symbology}
                  labelLines={labelLines}
                  names={labelNames}
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
