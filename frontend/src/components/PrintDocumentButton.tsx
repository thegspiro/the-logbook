/**
 * Print a station document — a shift roster, an apparatus check sheet — to the
 * receipt printer at the watch desk.
 *
 * Renders nothing at all when the organization has no receipt printer
 * configured. That is deliberate: most departments will have a label printer
 * and no receipt printer, and an always-visible button that can only ever
 * explain why it will not work is worse than no button.
 *
 * The preview is the same structure the printer is sent, so what somebody
 * checks before pressing print is what comes off the roll rather than a second
 * rendering free to disagree with it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
import { PrinterLanguage, labelPrinterService } from '../services/labelService';
import type { LabelPrinterConfig } from '../services/labelService';
import { stationDocumentService } from '../services/stationDocumentService';
import type { StationDocument, StationDocumentPreview } from '../services/stationDocumentService';
import { getErrorMessage } from '../utils/errorHandling';

interface PrintDocumentButtonProps {
  document: StationDocument;
  recordId: string;
  /** Button text; the icon is always shown. */
  label?: string;
  className?: string;
  /**
   * Notified as this button's print dialog opens and closes.
   *
   * For a caller that is itself a dialog carrying `aria-modal`: the print
   * dialog portals to the body, so the two are DOM siblings and both would
   * claim modality at once. The caller needs to go inert while this one is up,
   * and cannot see that state otherwise.
   *
   * Called synchronously with the state change rather than from an effect, so
   * the caller's update batches into the same commit. A commit later would
   * leave the caller inert while the closing dialog's focus trap restores
   * focus into it, and the browser would drop that focus request.
   */
  onOpenChange?: (open: boolean) => void;
}

const PREVIEW_COLUMNS = 48;

/** One preview line, laid out the way the renderer lays out the printed one. */
const PreviewRow: React.FC<{ row: StationDocumentPreview['sections'][number]['rows'][number] }> = ({ row }) => {
  const prefix = ' '.repeat(2 * Math.max(0, row.indent)) + (row.checkbox ? '[ ] ' : '');
  const width = PREVIEW_COLUMNS - prefix.length;
  const right = row.right ?? '';
  const room = right ? Math.max(1, width - right.length - 1) : width;
  const left = row.left.length > room ? `${row.left.slice(0, Math.max(0, room - 3))}...` : row.left;
  const body = right ? `${left.padEnd(room)} ${right}` : left;

  return (
    <div className={row.emphasis ? 'font-semibold' : undefined}>
      {prefix}
      {body}
    </div>
  );
};

export const PrintDocumentButton: React.FC<PrintDocumentButtonProps> = ({
  document,
  recordId,
  label = 'Print',
  className,
  onOpenChange,
}) => {
  const [printers, setPrinters] = useState<LabelPrinterConfig[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<StationDocumentPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState('');

  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await labelPrinterService.list();
        if (cancelled) return;
        // Documents are a column of text on continuous paper; a die-cut label
        // printer has nowhere to put one.
        const receipt = all.filter((p) => p.language === PrinterLanguage.ESCPOS);
        setPrinters(receipt);
        const first = receipt.find((p) => p.is_default) ?? receipt[0];
        if (first) setSelectedPrinterId(first.id);
      } catch {
        /* printing to a receipt printer is optional; the page works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setPreview(null);
    try {
      setPreview(await stationDocumentService.preview(document, recordId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not build the document'));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [document, recordId, setOpen]);

  const send = async () => {
    setPrinting(true);
    try {
      const result = await stationDocumentService.print(document, recordId, selectedPrinterId || undefined);
      toast.success(`Sent to ${result.printer_name}`);
      // Bytes reaching a socket is not a printed page: a printer that is out
      // of paper accepts the job and prints nothing.
      if (result.printer_errors.length > 0) {
        toast.error(`${result.printer_name}: ${result.printer_errors.join(', ')}`, { duration: 8000 });
      } else if (result.printer_warnings.length > 0) {
        toast(`${result.printer_name}: ${result.printer_warnings.join(', ')}`, { duration: 6000 });
      }
      setOpen(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to print'));
    } finally {
      setPrinting(false);
    }
  };

  if (printers.length === 0) return null;

  return (
    <>
      <button
        onClick={() => {
          void open();
        }}
        className={
          className ??
          'text-theme-text-muted mobile-touch-target gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors hover:bg-violet-500/10 hover:text-violet-500'
        }
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>

      <Modal isOpen={isOpen} onClose={() => setOpen(false)} title="Print to receipt printer" size="lg">
        <div className="modal-body space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
              <span className="text-theme-text-secondary text-sm">Building the document…</span>
            </div>
          ) : preview ? (
            <>
              {printers.length > 1 && (
                <div>
                  <label htmlFor="document-printer" className="form-label">
                    Printer
                  </label>
                  <select
                    id="document-printer"
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
                </div>
              )}

              <div className="border-theme-surface-border overflow-x-auto rounded-lg border bg-white p-4 dark:bg-neutral-900">
                <pre className="text-theme-text-primary font-mono text-xs leading-snug whitespace-pre">
                  <div className="text-center font-semibold">{preview.title}</div>
                  {preview.subtitle ? <div className="text-center">{preview.subtitle}</div> : null}
                  <div>{'-'.repeat(PREVIEW_COLUMNS)}</div>
                  {preview.sections.map((section, si) => (
                    <div key={si}>
                      {section.heading ? <div className="font-semibold">{section.heading.toUpperCase()}</div> : null}
                      {section.rows.map((row, ri) => (
                        <PreviewRow key={ri} row={row} />
                      ))}
                      <div>{' '}</div>
                    </div>
                  ))}
                  {preview.footer ? (
                    <>
                      <div>{'-'.repeat(PREVIEW_COLUMNS)}</div>
                      <div className="text-center">{preview.footer}</div>
                    </>
                  ) : null}
                </pre>
              </div>
              <p className="text-theme-text-muted text-xs">
                Shown at 48 characters wide — a 58mm roll fits 32, so lines may wrap differently on narrow paper.
              </p>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={() => setOpen(false)}
            className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg border px-3 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void send();
            }}
            disabled={printing || !preview}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print
          </button>
        </div>
      </Modal>
    </>
  );
};

export default PrintDocumentButton;
