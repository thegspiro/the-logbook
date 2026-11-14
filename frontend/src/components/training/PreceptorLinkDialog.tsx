/**
 * Preceptor link dialog
 *
 * For a shift a member logged on an outside agency's unit: the link the
 * agency's preceptor opens, with no account, to fill out the member's
 * evaluation. Shown as a QR code to scan on the spot, a link to copy, or an
 * email to the preceptor. One link is open at a time: making a new one stops
 * the old one working. The member who logged the shift and a training
 * officer both open this; the server decides who may.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Link2, Loader2, Mail, RefreshCw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

import { Modal } from '../Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { shiftEvaluationService } from '../../services/api';
import type { PreceptorLink } from '../../types/training';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface PreceptorLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The logged outside shift. */
  entryId: string;
  /** "ACFD Medic 101 · Nov 10", for the dialog's own heading. */
  shiftLabel: string;
}

export const PreceptorLinkDialog: React.FC<PreceptorLinkDialogProps> = ({ isOpen, onClose, entryId, shiftLabel }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [link, setLink] = useState<PreceptorLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLink(await shiftEvaluationService.getPreceptorLink(entryId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The preceptor link could not be loaded'));
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const create = async () => {
    if (
      link &&
      !(await confirm({
        title: 'Make a new link?',
        message: 'The current link and QR code will stop working. Anyone you already gave them to needs the new one.',
        confirmLabel: 'Make a new link',
        cancelLabel: 'Keep the current link',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const made = await shiftEvaluationService.createPreceptorLink(entryId, email.trim() || undefined);
      setLink(made);
      if (email.trim()) {
        if (made.email_sent) toast.success('Link emailed to the preceptor');
        else toast.error('The link was made but the email could not be sent');
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The preceptor link could not be made'));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      setLink(await shiftEvaluationService.sendPreceptorLink(entryId, email.trim()));
      toast.success('Link emailed to the preceptor');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The email could not be sent'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (
      !(await confirm({
        title: 'Turn off this link?',
        message: 'The preceptor will no longer be able to open it. You can make a new one later.',
        confirmLabel: 'Turn off link',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await shiftEvaluationService.revokePreceptorLink(entryId);
      setLink(null);
      toast.success('Link turned off');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The link could not be turned off'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy the link from the box instead');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Preceptor link" size="md">
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          {shiftLabel}. The preceptor opens this link without an account, fills out the evaluation and submits it once.
        </p>

        {loading ? (
          <div className="flex justify-center py-6" aria-busy="true">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading link" />
          </div>
        ) : link ? (
          <>
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={link.url} size={208} level="M" aria-label="QR code for the preceptor link" />
            </div>
            <div>
              <label htmlFor="pl-url" className="form-label">
                Link
              </label>
              <div className="flex gap-2">
                <input id="pl-url" className="form-input min-w-0 flex-1" value={link.url} readOnly />
                <button
                  type="button"
                  className="btn-secondary inline-flex shrink-0 items-center gap-1"
                  onClick={() => void copy()}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" /> Copy
                </button>
              </div>
              <p className="text-theme-text-muted mt-1 text-xs">
                Works until {formatDateTime(link.expires_at, tz)}
                {link.last_sent_at && link.preceptor_email ? ` · Emailed to ${link.preceptor_email}` : ''}.
              </p>
            </div>
          </>
        ) : (
          <p className="text-theme-text-muted text-sm">No link is open for this shift.</p>
        )}

        <div>
          <label htmlFor="pl-email" className="form-label">
            Preceptor&apos;s email (optional)
          </label>
          <div className="flex gap-2">
            <input
              id="pl-email"
              type="email"
              className="form-input min-w-0 flex-1"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
            />
            {link && (
              <button
                type="button"
                className="btn-secondary inline-flex shrink-0 items-center gap-1"
                disabled={busy || !email.trim()}
                onClick={() => void send()}
              >
                <Mail className="h-4 w-4" aria-hidden="true" /> Email
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {link && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1"
              disabled={busy}
              onClick={() => void revoke()}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" /> Turn off link
            </button>
          )}
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1"
            disabled={busy || loading}
            onClick={() => void create()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : link ? (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            {link ? 'Make a new link' : email.trim() ? 'Make and email link' : 'Make link'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PreceptorLinkDialog;
