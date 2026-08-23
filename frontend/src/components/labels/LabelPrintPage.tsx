/**
 * Generic barcode-label print page, shared by every module.
 *
 * A module mounts this with its `module` key and a `fetchItems` function that
 * resolves the records (by id, from `?ids=`) into { id, name, barcodeValue,
 * subtitle } for the preview. Format selection, the per-position/per-module
 * remembered printer (via labelService), copies, custom sizes, PDF download,
 * browser printing, and a test print are all handled here. The PDF itself is
 * generated server-side at the exact label size (recommended for thermal).
 *
 * When the organization has registered a network label printer, a third output
 * appears: **Send to Printer**, which renders ZPL server-side and writes it
 * straight to the printer. That path has no print dialog and therefore no
 * scaling step, which is what makes it the reliable one for barcodes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import JsBarcode from 'jsbarcode';
import {
  AlertCircle,
  ArrowLeft,
  Barcode,
  Download,
  Loader2,
  Printer,
  QrCode,
  RotateCw,
  Send,
  Settings2,
  TestTube2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { PrinterLanguage, labelPrinterService, labelService, Symbology } from '../../services/labelService';
import type { LabelPrinterConfig } from '../../services/labelService';
import { getErrorMessage } from '../../utils/errorHandling';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { prefersPdfOverBrowserPrint } from '../../utils/printEnvironment';
import { useTimezone } from '../../hooks/useTimezone';
import {
  CUSTOM_PRESET_ID,
  DEFAULT_PRESET_ID,
  LABEL_PRESETS,
  LabelPreset,
  buildCustomPreset,
  isKnownPreset,
  sanitizeForCode128,
} from './labelPresets';

export interface LabelListItem {
  id: string;
  name: string;
  barcodeValue: string;
  subtitle?: string;
}

interface LabelPrintPageProps {
  module: string;
  title: string;
  backTo: string;
  backLabel?: string;
}

// The symbology is part of the key so switching Code 128 <-> QR is a change
// worth persisting, not one the comparison swallows.
const presetKey = (preset: string, w: string, h: string, symbology: string) =>
  `${preset === CUSTOM_PRESET_ID ? `custom:${w}x${h}` : preset}:${symbology}`;

const BarcodeLabel: React.FC<{ item: LabelListItem; preset: LabelPreset; symbology: Symbology }> = ({
  item,
  preset,
  symbology,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const value = sanitizeForCode128((item.barcodeValue || '').trim());
  const isQr = symbology === Symbology.QR;
  useEffect(() => {
    if (isQr || !svgRef.current || !value) return;
    try {
      const quietZone = Math.ceil(preset.barcodeWidth * 10);
      JsBarcode(svgRef.current, value, {
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
      /* invalid value — leave empty */
    }
  }, [isQr, value, preset.barcodeWidth, preset.barcodeHeight, preset.barcodeFontSize]);

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
      {item.subtitle ? (
        <div style={{ fontSize: preset.subtitleFontSize, textAlign: 'center', color: '#000' }}>{item.subtitle}</div>
      ) : null}
      {value ? (
        isQr ? (
          <>
            <QRCodeSVG value={value} size={Math.round(preset.barcodeHeight * 1.6)} level="M" marginSize={2} />
            <div style={{ fontSize: preset.subtitleFontSize, fontFamily: 'monospace', color: '#000' }}>{value}</div>
          </>
        ) : (
          <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        )
      ) : (
        <div style={{ fontSize: preset.subtitleFontSize, color: '#999' }}>No barcode value</div>
      )}
    </div>
  );
};

export const LabelPrintPage: React.FC<LabelPrintPageProps> = ({ module, title, backTo, backLabel = 'Back' }) => {
  const [searchParams] = useSearchParams();
  const tz = useTimezone();

  const [items, setItems] = useState<LabelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [copies, setCopies] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [autoRotateOverride, setAutoRotateOverride] = useState<boolean | null>(null);
  const [customWidth, setCustomWidth] = useState('2');
  const [customHeight, setCustomHeight] = useState('1');
  const [printers, setPrinters] = useState<LabelPrinterConfig[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [sendingToPrinter, setSendingToPrinter] = useState(false);
  const [symbology, setSymbology] = useState<Symbology>(Symbology.CODE128);

  const lastSavedKeyRef = useRef<string | null>(null);

  const isCustom = presetId === CUSTOM_PRESET_ID;
  const customW = parseFloat(customWidth);
  const customH = parseFloat(customHeight);
  const customValid =
    Number.isFinite(customW) &&
    Number.isFinite(customH) &&
    customW >= 0.5 &&
    customW <= 8 &&
    customH >= 0.5 &&
    customH <= 11;
  const firstPreset = LABEL_PRESETS[0] as LabelPreset;
  const preset = isCustom
    ? buildCustomPreset(customValid ? customW : 2, customValid ? customH : 1)
    : (LABEL_PRESETS.find((p) => p.id === presetId) ?? firstPreset);
  const effectiveAutoRotate = autoRotateOverride ?? preset.autoRotate;
  const isThermal = preset.columns === 1;
  const isLandscape = parseFloat(preset.width) > parseFloat(preset.height);

  const load = useCallback(async () => {
    const idsParam = searchParams.get('ids');
    const ids = (idsParam ?? '').split(',').filter(Boolean);
    if (ids.length === 0) {
      setError('No records specified. Go back and select items to print.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { items: previews } = await labelService.preview(module, ids);
      setItems(
        previews.map((p, i) => ({
          id: ids[i] ?? String(i),
          name: p.name,
          barcodeValue: p.barcode_value,
          ...(p.subtitle ? { subtitle: p.subtitle } : {}),
        }))
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load records'));
    } finally {
      setLoading(false);
    }
  }, [searchParams, module]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the position's saved preset for this module, applying it over the default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pref = await labelService.getPreset(module);
        if (cancelled) return;
        let w = customWidth;
        let h = customHeight;
        if (pref?.symbology === Symbology.QR || pref?.symbology === Symbology.CODE128) {
          setSymbology(pref.symbology);
        }
        if (pref?.preset && isKnownPreset(pref.preset)) {
          setPresetId(pref.preset);
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
          lastSavedKeyRef.current = presetKey(pref.preset, w, h, pref.symbology ?? symbology);
        } else {
          lastSavedKeyRef.current = presetKey(presetId, w, h, symbology);
        }
      } catch {
        lastSavedKeyRef.current = presetKey(presetId, customWidth, customHeight, symbology);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  // Registered network printers. Best-effort: an organization with none simply
  // does not see the direct-print option, which is the pre-existing behaviour.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await labelPrinterService.list();
        if (cancelled) return;
        setPrinters(list);
        const preferred = list.find((p) => p.is_default) ?? list[0];
        if (preferred) setSelectedPrinterId(preferred.id);
      } catch {
        /* printing to a network printer is optional; the PDF paths still work */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a deliberate change to the position (debounced, best-effort).
  useEffect(() => {
    if (lastSavedKeyRef.current === null) return;
    if (isCustom && !customValid) return;
    const key = presetKey(presetId, customWidth, customHeight, symbology);
    if (key === lastSavedKeyRef.current) return;
    const timer = setTimeout(() => {
      lastSavedKeyRef.current = key;
      void labelService
        .setPreset(module, {
          preset: presetId,
          symbology,
          ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
        })
        .catch(() => {
          /* best-effort */
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [module, presetId, customWidth, customHeight, isCustom, customValid, customW, customH, symbology]);

  const labelItems: LabelListItem[] = [];
  for (let c = 0; c < copies; c++) for (const it of items) labelItems.push(it);

  const selectedPrinter = printers.find((p) => p.id === selectedPrinterId) ?? null;
  // A receipt printer's stock is the roll loaded in it, so the size chosen on
  // this page does not apply and is not sent — which also means an Avery sheet
  // selection cannot block it.
  const isReceiptPrinter = selectedPrinter?.language === PrinterLanguage.ESCPOS;
  // Avery sheet layouts have no meaning on a roll-fed label printer; the
  // backend rejects them, so the button says so instead of offering a failure.
  const canSendToPrinter = selectedPrinter !== null && (isReceiptPrinter || isThermal);
  const printerStockMismatch =
    selectedPrinter !== null && !isReceiptPrinter && !isCustom && selectedPrinter.label_format !== preset.id;

  const sendToPrinter = async () => {
    if (!selectedPrinter || items.length === 0) return;
    setSendingToPrinter(true);
    try {
      const result = await labelPrinterService.print(
        module,
        items.map((i) => i.id),
        {
          printer_id: selectedPrinter.id,
          // Omitted for a receipt printer: its paper roll decides the size,
          // and sending this page's die-cut label size would mean nothing.
          ...(isReceiptPrinter
            ? {}
            : {
                label_format: isCustom ? CUSTOM_PRESET_ID : preset.id,
                ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
              }),
          copies,
          symbology,
        }
      );
      if (result.auto_populated > 0) {
        toast.success(
          `${result.auto_populated} record${result.auto_populated !== 1 ? 's' : ''} had a barcode generated`
        );
      }
      toast.success(`Sent ${result.labels_sent} label${result.labels_sent !== 1 ? 's' : ''} to ${result.printer_name}`);
      // A printer that is out of stock accepts the job and prints nothing, so
      // a bare success toast would be a lie. Report what it told us.
      if (result.printer_errors.length > 0) {
        toast.error(`${result.printer_name}: ${result.printer_errors.join(', ')}`, { duration: 8000 });
      } else if (result.printer_warnings.length > 0) {
        toast(`${result.printer_name}: ${result.printer_warnings.join(', ')}`, { duration: 6000 });
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send labels to the printer'));
    } finally {
      setSendingToPrinter(false);
    }
  };

  const downloadPdf = async (onlyFirst = false) => {
    const ids = (onlyFirst ? items.slice(0, 1) : items).map((i) => i.id);
    if (ids.length === 0) return;
    setDownloadingPdf(true);
    try {
      const { blob, autoPopulated } = await labelService.generate(module, ids, {
        label_format: isCustom ? CUSTOM_PRESET_ID : preset.id,
        ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
        auto_rotate: effectiveAutoRotate,
        symbology,
      });
      if (autoPopulated > 0) {
        toast.success(`${autoPopulated} record${autoPopulated !== 1 ? 's' : ''} had a barcode generated`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = onlyFirst ? `test-label-${preset.id}.pdf` : `labels-${getTodayLocalDate(tz)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success(onlyFirst ? 'Test label downloaded' : 'PDF downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate labels'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrint = () => {
    // On phones/tablets the hidden-iframe print pipeline is unreliable (mobile
    // Safari prints blank), so hand off to the server-generated PDF instead.
    if (prefersPdfOverBrowserPrint()) {
      void downloadPdf(false);
      return;
    }
    const container = document.getElementById(`label-print-container-${module}`);
    if (!container) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }

    const isThermalFmt = preset.columns === 1;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>
      @page { size: ${preset.pageWidth} ${preset.pageHeight}; margin: ${isThermalFmt ? '0' : '0.5in 0.19in'}; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: white; }
      .barcode-label { break-inside: avoid; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .barcode-label svg { display: block !important; max-width: 100% !important; height: auto !important; }
      .barcode-label svg rect { fill: #000 !important; }
      ${isThermalFmt ? '.barcode-label { page-break-after: always; } .barcode-label:last-child { page-break-after: auto; }' : ''}
    </style></head><body><div style="${(container.getAttribute('style') || '').replace(/"/g, '&quot;')}">${container.innerHTML}</div></body></html>`);
    doc.close();

    let printed = false;
    const removeFrame = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    const trigger = () => {
      if (printed) return;
      printed = true;
      const win = iframe.contentWindow;
      win?.focus();
      win?.addEventListener('afterprint', removeFrame, { once: true });
      setTimeout(removeFrame, 60000);
      win?.print();
    };
    iframe.onload = trigger;
    if (doc.readyState === 'complete') trigger();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        <span className="text-theme-text-secondary ml-2">Loading…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto mt-12 max-w-md p-6">
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
        <Link
          to={backTo}
          className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @page { size: ${preset.pageWidth} ${preset.pageHeight}; margin: ${isThermal ? '0' : '0.5in 0.19in'}; }
        @media print { .print-controls { display: none !important; } }
        @media screen { .barcode-label { border: 1px dashed #ccc; background: white; } }
      `}</style>

      <div className="print-controls min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-6">
          <Link
            to={backTo}
            className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>

          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">{title}</h1>
              <p className="text-theme-text-muted mt-1 text-sm">
                {items.length} record{items.length !== 1 ? 's' : ''} · {labelItems.length} label
                {labelItems.length !== 1 ? 's' : ''} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
              >
                <Settings2 className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Settings</span>
              </button>
              <button
                onClick={() => {
                  void downloadPdf(false);
                }}
                disabled={downloadingPdf || items.length === 0 || (isCustom && !customValid)}
                className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
              </button>
              <div>
                <label className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                  Barcode Style
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      id: Symbology.CODE128,
                      icon: Barcode,
                      name: 'Code 128',
                      hint: 'Scans with any handheld laser scanner',
                    },
                    {
                      id: Symbology.QR,
                      icon: QrCode,
                      name: 'QR code',
                      hint: 'Fits a long id on a small square label; scans with a phone',
                    },
                  ].map((option) => {
                    const Icon = option.icon;
                    const active = symbology === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setSymbology(option.id)}
                        className={`flex flex-1 items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors sm:flex-none ${active ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border hover:bg-theme-surface-secondary'}`}
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

              {printers.length > 0 && (
                <button
                  onClick={() => {
                    void sendToPrinter();
                  }}
                  disabled={sendingToPrinter || !canSendToPrinter || items.length === 0 || (isCustom && !customValid)}
                  title={
                    canSendToPrinter
                      ? `Send directly to ${selectedPrinter?.name ?? 'the label printer'}`
                      : 'Choose a thermal label size to send directly to a label printer'
                  }
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  {sendingToPrinter ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="hidden sm:inline">Send to</span> Printer
                </button>
              )}
              <button
                onClick={handlePrint}
                disabled={items.length === 0 || (isCustom && !customValid)}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Print</span> Labels
              </button>
            </div>
          </div>

          <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Set <strong>Scale</strong> to <strong>100%</strong> in the print dialog (disable &quot;Fit to page&quot;),
              margins to <strong>{isThermal ? 'None' : '0.5"/0.19"'}</strong>, and paper to{' '}
              <strong>
                {preset.pageWidth} x {preset.pageHeight}
              </strong>
              . For thermal/Rollo printers the <strong>PDF</strong> download prints most reliably.
            </p>
          </div>

          {showSettings && (
            <div className="card-secondary mb-6 space-y-4 p-4">
              <div>
                <label className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                  Label Size
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {LABEL_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPresetId(p.id)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${presetId === p.id ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border hover:bg-theme-surface-secondary'}`}
                    >
                      <span className="text-theme-text-primary block text-sm font-medium">{p.name}</span>
                      <span className="text-theme-text-muted block text-xs">{p.description}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setPresetId(CUSTOM_PRESET_ID)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${isCustom ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border hover:bg-theme-surface-secondary'}`}
                  >
                    <span className="text-theme-text-primary block text-sm font-medium">Custom size</span>
                    <span className="text-theme-text-muted block text-xs">
                      Enter exact dimensions for any sticker printer
                    </span>
                  </button>
                </div>
                {isCustom && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label
                        htmlFor="cw"
                        className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                      >
                        Width (in)
                      </label>
                      <input
                        id="cw"
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
                        htmlFor="ch"
                        className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                      >
                        Height (in)
                      </label>
                      <input
                        id="ch"
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
                        Enter 0.5–8&quot; wide and 0.5–11&quot; tall.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {printers.length > 0 && (
                <div>
                  <label
                    htmlFor="label-printer"
                    className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                  >
                    Label Printer
                  </label>
                  <select
                    id="label-printer"
                    value={selectedPrinterId}
                    onChange={(e) => setSelectedPrinterId(e.target.value)}
                    className="form-input w-full sm:w-80"
                  >
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.location ? ` — ${p.location}` : ''}
                      </option>
                    ))}
                  </select>
                  {printerStockMismatch && selectedPrinter ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        This printer is set up for{' '}
                        <strong>
                          {LABEL_PRESETS.find((lp) => lp.id === selectedPrinter.label_format)?.name ??
                            selectedPrinter.label_format}
                        </strong>
                        . Sending at a different size may not match the loaded labels.
                      </p>
                      <button
                        onClick={() => setPresetId(selectedPrinter.label_format)}
                        className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg border px-2 py-1 text-xs transition-colors"
                      >
                        Match printer
                      </button>
                    </div>
                  ) : (
                    <p className="text-theme-text-muted mt-1.5 text-xs">
                      {isReceiptPrinter
                        ? 'Receipt printer — prints on whatever roll is loaded, so the label size above does not apply.'
                        : 'Sends the label to the printer directly — no print dialog, and nothing can rescale the barcode.'}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="copies"
                  className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase"
                >
                  Copies per record
                </label>
                <input
                  id="copies"
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="form-input w-24"
                />
              </div>

              {isThermal && (
                <div>
                  <label className="text-theme-text-muted mb-2 block text-xs font-medium tracking-wider uppercase">
                    Label Orientation (PDF only)
                  </label>
                  <button
                    onClick={() => setAutoRotateOverride(effectiveAutoRotate ? false : true)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${effectiveAutoRotate ? 'text-theme-text-primary border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-secondary'}`}
                  >
                    <RotateCw className="h-4 w-4" /> Auto-rotate for roll-fed
                  </button>
                  <p className="text-theme-text-muted mt-1.5 text-xs">
                    {effectiveAutoRotate
                      ? 'On: content is pre-rotated for roll-fed printers (Rollo, Brother) that feed narrow-edge first.'
                      : 'Off: PDF matches the visual layout (Dymo drivers rotate themselves).'}
                    {isLandscape ? '' : ''}
                  </p>
                </div>
              )}

              {isThermal && items.length > 0 && (
                <button
                  onClick={() => {
                    void downloadPdf(true);
                  }}
                  disabled={downloadingPdf || (isCustom && !customValid)}
                  className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}{' '}
                  Print Test Label
                </button>
              )}
            </div>
          )}

          {/* On-screen + print preview. Labels have fixed inch widths, so on a
              narrow phone the grid preview can be wider than the viewport —
              scroll it horizontally instead of breaking the page layout.
              (Printing uses a separate iframe, so this wrapper is screen-only.) */}
          <div className="overflow-x-auto">
            <div
              id={`label-print-container-${module}`}
              className="barcode-labels-container"
              style={
                isThermal
                  ? { display: 'flex', flexDirection: 'column', gap: '4px' }
                  : { display: 'grid', gridTemplateColumns: `repeat(${preset.columns}, 1fr)`, gap: '2px' }
              }
            >
              {labelItems.map((item, i) => (
                <BarcodeLabel key={`${item.id}-${i}`} item={item} preset={preset} symbology={symbology} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default LabelPrintPage;
