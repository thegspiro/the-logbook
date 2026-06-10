/**
 * Generic barcode-label print page, shared by every module.
 *
 * A module mounts this with its `module` key and a `fetchItems` function that
 * resolves the records (by id, from `?ids=`) into { id, name, barcodeValue,
 * subtitle } for the preview. Format selection, the per-position/per-module
 * remembered printer (via labelService), copies, custom sizes, PDF download,
 * browser printing, and a test print are all handled here. The PDF itself is
 * generated server-side at the exact label size (recommended for thermal).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import {
  AlertCircle, ArrowLeft, Download, Loader2, Printer, RotateCw, Settings2, TestTube2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { labelService } from '../../services/labelService';
import { getErrorMessage } from '../../utils/errorHandling';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import {
  CUSTOM_PRESET_ID, DEFAULT_PRESET_ID, LABEL_PRESETS, LabelPreset,
  buildCustomPreset, isKnownPreset, sanitizeForCode128,
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

const presetKey = (preset: string, w: string, h: string) =>
  preset === CUSTOM_PRESET_ID ? `custom:${w}x${h}` : preset;

const BarcodeLabel: React.FC<{ item: LabelListItem; preset: LabelPreset }> = ({
  item, preset,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const value = sanitizeForCode128((item.barcodeValue || '').trim());
  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      const quietZone = Math.ceil(preset.barcodeWidth * 10);
      JsBarcode(svgRef.current, value, {
        format: 'CODE128', width: preset.barcodeWidth, height: preset.barcodeHeight,
        displayValue: true, fontSize: preset.barcodeFontSize, marginTop: 0,
        marginBottom: 1, marginLeft: quietZone, marginRight: quietZone,
        textMargin: 1, font: 'monospace',
      });
    } catch {
      /* invalid value — leave empty */
    }
  }, [value, preset.barcodeWidth, preset.barcodeHeight, preset.barcodeFontSize]);

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
      {item.subtitle ? (
        <div style={{ fontSize: preset.subtitleFontSize, textAlign: 'center', color: '#000' }}>
          {item.subtitle}
        </div>
      ) : null}
      {value ? <svg ref={svgRef} /> : (
        <div style={{ fontSize: preset.subtitleFontSize, color: '#999' }}>No barcode value</div>
      )}
    </div>
  );
};

export const LabelPrintPage: React.FC<LabelPrintPageProps> = ({
  module, title, backTo, backLabel = 'Back',
}) => {
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

  const lastSavedKeyRef = useRef<string | null>(null);

  const isCustom = presetId === CUSTOM_PRESET_ID;
  const customW = parseFloat(customWidth);
  const customH = parseFloat(customHeight);
  const customValid =
    Number.isFinite(customW) && Number.isFinite(customH) &&
    customW >= 0.5 && customW <= 8 && customH >= 0.5 && customH <= 11;
  const firstPreset = LABEL_PRESETS[0] as LabelPreset;
  const preset = isCustom
    ? buildCustomPreset(customValid ? customW : 2, customValid ? customH : 1)
    : LABEL_PRESETS.find((p) => p.id === presetId) ?? firstPreset;
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
        })),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load records'));
    } finally {
      setLoading(false);
    }
  }, [searchParams, module]);

  useEffect(() => { void load(); }, [load]);

  // Load the position's saved preset for this module, applying it over the default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pref = await labelService.getPreset(module);
        if (cancelled) return;
        let w = customWidth;
        let h = customHeight;
        if (pref?.preset && isKnownPreset(pref.preset)) {
          setPresetId(pref.preset);
          if (pref.preset === CUSTOM_PRESET_ID) {
            if (pref.custom_width != null) { w = String(pref.custom_width); setCustomWidth(w); }
            if (pref.custom_height != null) { h = String(pref.custom_height); setCustomHeight(h); }
          }
          lastSavedKeyRef.current = presetKey(pref.preset, w, h);
        } else {
          lastSavedKeyRef.current = presetKey(presetId, w, h);
        }
      } catch {
        lastSavedKeyRef.current = presetKey(presetId, customWidth, customHeight);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  // Persist a deliberate change to the position (debounced, best-effort).
  useEffect(() => {
    if (lastSavedKeyRef.current === null) return;
    if (isCustom && !customValid) return;
    const key = presetKey(presetId, customWidth, customHeight);
    if (key === lastSavedKeyRef.current) return;
    const timer = setTimeout(() => {
      lastSavedKeyRef.current = key;
      void labelService.setPreset(module, {
        preset: presetId,
        ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
      }).catch(() => { /* best-effort */ });
    }, 500);
    return () => clearTimeout(timer);
  }, [module, presetId, customWidth, customHeight, isCustom, customValid, customW, customH]);

  const labelItems: LabelListItem[] = [];
  for (let c = 0; c < copies; c++) for (const it of items) labelItems.push(it);

  const downloadPdf = async (onlyFirst = false) => {
    const ids = (onlyFirst ? items.slice(0, 1) : items).map((i) => i.id);
    if (ids.length === 0) return;
    setDownloadingPdf(true);
    try {
      const { blob, autoPopulated } = await labelService.generate(module, ids, {
        label_format: isCustom ? CUSTOM_PRESET_ID : preset.id,
        ...(isCustom ? { custom_width: customW, custom_height: customH } : {}),
        auto_rotate: effectiveAutoRotate,
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
    if (!doc) { document.body.removeChild(iframe); return; }

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
    const removeFrame = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
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
      <div className="flex items-center justify-center min-h-screen" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
        <span className="ml-2 text-theme-text-secondary">Loading…</span>
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
        <Link to={backTo} className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1">
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
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Link to={backTo} className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6">
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">{title}</h1>
              <p className="text-sm text-theme-text-muted mt-1">
                {items.length} record{items.length !== 1 ? 's' : ''} · {labelItems.length} label{labelItems.length !== 1 ? 's' : ''} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors">
                <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Settings</span>
              </button>
              <button onClick={() => { void downloadPdf(false); }} disabled={downloadingPdf || items.length === 0 || (isCustom && !customValid)} className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors disabled:opacity-50">
                {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
              </button>
              <button onClick={handlePrint} disabled={items.length === 0 || (isCustom && !customValid)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Print</span> Labels
              </button>
            </div>
          </div>

          <div className="mb-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Set <strong>Scale</strong> to <strong>100%</strong> in the print dialog (disable &quot;Fit to page&quot;), margins to <strong>{isThermal ? 'None' : '0.5"/0.19"'}</strong>, and paper to <strong>{preset.pageWidth} x {preset.pageHeight}</strong>. For thermal/Rollo printers the <strong>PDF</strong> download prints most reliably.
            </p>
          </div>

          {showSettings && (
            <div className="card-secondary p-4 mb-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Label Size</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {LABEL_PRESETS.map((p) => (
                    <button key={p.id} onClick={() => setPresetId(p.id)} className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${presetId === p.id ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border hover:bg-theme-surface-secondary'}`}>
                      <span className="block text-sm font-medium text-theme-text-primary">{p.name}</span>
                      <span className="block text-xs text-theme-text-muted">{p.description}</span>
                    </button>
                  ))}
                  <button onClick={() => setPresetId(CUSTOM_PRESET_ID)} className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${isCustom ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' : 'border-theme-surface-border hover:bg-theme-surface-secondary'}`}>
                    <span className="block text-sm font-medium text-theme-text-primary">Custom size</span>
                    <span className="block text-xs text-theme-text-muted">Enter exact dimensions for any sticker printer</span>
                  </button>
                </div>
                {isCustom && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="cw" className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">Width (in)</label>
                      <input id="cw" type="number" step="0.05" min={0.5} max={8} value={customWidth} onChange={(e) => setCustomWidth(e.target.value)} className="form-input w-24" />
                    </div>
                    <div>
                      <label htmlFor="ch" className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">Height (in)</label>
                      <input id="ch" type="number" step="0.05" min={0.5} max={11} value={customHeight} onChange={(e) => setCustomHeight(e.target.value)} className="form-input w-24" />
                    </div>
                    {!customValid && <p className="text-xs text-red-600 dark:text-red-400 pb-2">Enter 0.5–8&quot; wide and 0.5–11&quot; tall.</p>}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="copies" className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">Copies per record</label>
                <input id="copies" type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))} className="form-input w-24" />
              </div>

              {isThermal && (
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Label Orientation (PDF only)</label>
                  <button onClick={() => setAutoRotateOverride(effectiveAutoRotate ? false : true)} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${effectiveAutoRotate ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500 text-theme-text-primary' : 'border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-secondary'}`}>
                    <RotateCw className="h-4 w-4" /> Auto-rotate for roll-fed
                  </button>
                  <p className="text-xs text-theme-text-muted mt-1.5">
                    {effectiveAutoRotate ? 'On: content is pre-rotated for roll-fed printers (Rollo, Brother) that feed narrow-edge first.' : 'Off: PDF matches the visual layout (Dymo drivers rotate themselves).'}
                    {isLandscape ? '' : ''}
                  </p>
                </div>
              )}

              {isThermal && items.length > 0 && (
                <button onClick={() => { void downloadPdf(true); }} disabled={downloadingPdf || (isCustom && !customValid)} className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-secondary transition-colors disabled:opacity-50">
                  {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />} Print Test Label
                </button>
              )}
            </div>
          )}

          {/* On-screen + print preview */}
          <div
            id={`label-print-container-${module}`}
            className="barcode-labels-container"
            style={isThermal
              ? { display: 'flex', flexDirection: 'column', gap: '4px' }
              : { display: 'grid', gridTemplateColumns: `repeat(${preset.columns}, 1fr)`, gap: '2px' }}
          >
            {labelItems.map((item, i) => (
              <BarcodeLabel key={`${item.id}-${i}`} item={item} preset={preset} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default LabelPrintPage;
