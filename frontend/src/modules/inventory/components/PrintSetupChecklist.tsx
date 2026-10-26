/**
 * The step between "Print" and the browser's print dialog.
 *
 * A web page cannot choose the printer's paper: `@page { size }` sizes the
 * document, but the driver feeds whatever stock its own Paper size setting
 * names, and a Rollo left on its 4" x 6" default prints a 2" x 1" job onto
 * whatever is loaded, scaled, a label at a time. So the settings that matter
 * are named here, for the size actually chosen, right before the dialog opens.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Modal } from '../../../components/Modal';
import { rememberPrintChecklistSkipped } from '../utils/printChecklist';

interface PrintSetupChecklistProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  /** Identifies the label size for "don't show again", e.g. a preset id. */
  sizeKey: string;
  /** Inches, without the unit: "2" and "1". */
  widthIn: string;
  heightIn: string;
  /** A roll prints one label per page with no margins; a sheet keeps them. */
  isThermal: boolean;
  /** No network printer is registered, so pointing at that path can help. */
  offerNetworkPrinter: boolean;
}

export const PrintSetupChecklist: React.FC<PrintSetupChecklistProps> = ({
  isOpen,
  onClose,
  onContinue,
  sizeKey,
  widthIn,
  heightIn,
  isThermal,
  offerNetworkPrinter,
}) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (isOpen) setDontShowAgain(false);
  }, [isOpen]);

  const handleContinue = () => {
    if (dontShowAgain) rememberPrintChecklistSkipped(sizeKey);
    onContinue();
  };

  const paper = isThermal ? `${widthIn}" x ${heightIn}"` : 'Letter (8.5" x 11")';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Before you print"
      size="md"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            Don&apos;t show again for {paper} on this computer
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Back
            </button>
            <button type="button" onClick={handleContinue} className="btn-primary">
              Open print dialog
            </button>
          </div>
        </div>
      }
    >
      <p className="text-theme-text-secondary text-sm">
        The browser cannot tell the printer which labels are loaded. In the print dialog that opens next, set:
      </p>
      <ol className="text-theme-text-primary mt-3 list-decimal space-y-1.5 pl-5 text-sm">
        <li>
          <strong>Printer</strong>: your label printer
        </li>
        <li>
          <strong>Paper size</strong>: {paper}
          {isThermal && (
            <span className="text-theme-text-muted block text-xs">
              Under &ldquo;More settings&rdquo;. If {paper} is not listed, add it once in the printer driver&apos;s own
              preferences (on a Rollo: Printing Preferences &rarr; paper size), then reopen this page.
            </span>
          )}
        </li>
        <li>
          <strong>Margins</strong>: {isThermal ? 'None' : 'Default'}
        </li>
        <li>
          <strong>Scale</strong>: 100% (not &ldquo;Fit to page&rdquo;), or barcodes may not scan
        </li>
      </ol>
      {offerNetworkPrinter && (
        <p className="text-theme-text-muted mt-4 text-xs">
          Is this printer on the network (for example a Rollo Wireless or a Zebra)? An administrator can register it
          under{' '}
          <Link to="/settings?tab=labelPrinters" className="text-theme-text-primary underline">
            Settings &rarr; Label Printers
          </Link>
          , and this page will send labels to it at the right size without a print dialog.
        </p>
      )}
    </Modal>
  );
};
