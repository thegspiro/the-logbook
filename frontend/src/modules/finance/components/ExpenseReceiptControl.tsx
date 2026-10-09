/**
 * One expense line's receipt: view it, and — on a draft the caller may edit —
 * attach, replace or remove it.
 *
 * Every line needs a receipt before its report can be submitted; the API
 * enforces that and the file rules (PDF, JPG or PNG up to 10 MB, scanned), and
 * its refusal is shown in its own words. The file is fetched through the
 * authenticated client as a blob, since a plain link carries no session.
 */

import React, { useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import { useConfirm } from '@/contexts/ConfirmContext';
import { expenseReportService } from '../services/api';
import type { ExpenseLineItem } from '../types';

/** What the file picker offers; the API decides from the file's contents. */
const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

const LINK_BUTTON =
  'inline-flex items-center gap-1 rounded text-xs font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400 touch:min-h-11';

interface ExpenseReceiptControlProps {
  reportId: string;
  item: ExpenseLineItem;
  /** A draft the caller may change. */
  editable: boolean;
  /** Called after a receipt is attached or removed; the caller re-fetches. */
  onChanged: () => void;
}

export const ExpenseReceiptControl: React.FC<ExpenseReceiptControlProps> = ({
  reportId,
  item,
  editable,
  onChanged,
}) => {
  const { confirm } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  const upload = async (file: File) => {
    setWorking(true);
    try {
      await expenseReportService.uploadReceipt(reportId, item.id, file);
      toast.success(`Receipt attached to ${item.description}`);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not attach the receipt'));
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: 'Remove receipt',
      message: `Remove the receipt from "${item.description}"? The report cannot be submitted until this line has one again.`,
      confirmLabel: 'Remove receipt',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    setWorking(true);
    try {
      await expenseReportService.removeReceipt(reportId, item.id);
      toast.success('Receipt removed');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not remove the receipt'));
    } finally {
      setWorking(false);
    }
  };

  const download = async () => {
    setWorking(true);
    try {
      const blob = await expenseReportService.getReceipt(reportId, item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.receiptFileName || 'receipt';
      link.click();
      // The click has handed the URL to the browser's download by now.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not open the receipt'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {item.hasReceipt ? (
        <button
          type="button"
          onClick={() => void download()}
          disabled={working}
          className={LINK_BUTTON}
          aria-label={`Download the receipt for ${item.description}`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[12rem] truncate">{item.receiptFileName || 'Receipt'}</span>
        </button>
      ) : (
        <span
          className={`inline-flex items-center gap-1 text-xs ${editable ? 'text-amber-800 dark:text-amber-300' : 'text-theme-text-secondary'}`}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          No receipt
        </span>
      )}
      {editable && (
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            tabIndex={-1}
            aria-label={`Receipt file for ${item.description}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button type="button" onClick={() => input.current?.click()} disabled={working} className={LINK_BUTTON}>
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {working ? 'Working…' : item.hasReceipt ? 'Replace' : 'Attach receipt'}
            <span className="sr-only"> for {item.description}</span>
          </button>
          {item.hasReceipt && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={working}
              className={LINK_BUTTON}
              aria-label={`Remove the receipt for ${item.description}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove
            </button>
          )}
        </>
      )}
    </div>
  );
};
