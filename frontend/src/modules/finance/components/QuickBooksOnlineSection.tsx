/**
 * QuickBooks Online connection — connect the department's QuickBooks company,
 * and see each payment it posted, is waiting to post, or was refused
 * (`/finance/quickbooks/*`; reading needs `finance.view`, changing needs
 * `finance.manage`).
 *
 * What posts, the account it posts to and whether a payment may post twice are
 * the backend's decisions (app/services/quickbooks_sync_service.py); this card
 * shows them and offers the actions. A department that never connects keeps
 * using the CSV export below, unchanged.
 *
 * Loaded on its own so a failure here never hides the mappings on the page.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Link2, RefreshCw, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency, formatDateTime, localToUTC, toLocalISODate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { quickBooksOnlineService } from '../services/api';
import { QUICKBOOKS_POSTING_STATUS_LABELS, QuickBooksConnectionStatus, QuickBooksPostingStatus } from '../types';
import type { QuickBooksConnection, QuickBooksPosting } from '../types';

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';

const POSTING_STATUS_COLORS: Record<QuickBooksPostingStatus, string> = {
  [QuickBooksPostingStatus.QUEUED]: 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-white',
  [QuickBooksPostingStatus.RETRYING]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [QuickBooksPostingStatus.POSTED]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [QuickBooksPostingStatus.FAILED]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [QuickBooksPostingStatus.SUPERSEDED]: 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-white',
};

/** What each `quickbooks_error` reason in the callback's redirect means. */
const CONNECT_ERRORS: Record<string, string> = {
  access_denied: 'The connection was cancelled on the QuickBooks page.',
  invalid_state: 'That connection attempt could not be verified. Start again from this page, in the same browser.',
  expired_state: 'That connection attempt took longer than ten minutes. Start again.',
  not_authorized: 'Connecting needs the finance management permission.',
  not_configured: 'QuickBooks Online is not configured on this server.',
  missing_company: 'QuickBooks did not say which company was chosen. Start again and pick a company.',
  token_exchange_failed:
    'QuickBooks did not complete the sign-in. Start again; if it keeps failing, check the app keys.',
};

const ENVIRONMENT_LABELS: Record<string, string> = {
  sandbox: 'Intuit sandbox (test company)',
  production: 'QuickBooks Online (live books)',
};

export const QuickBooksOnlineSection: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission('finance.manage'));
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<QuickBooksConnection | null>(null);
  const [postings, setPostings] = useState<QuickBooksPosting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postFrom, setPostFrom] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await quickBooksOnlineService.connection();
      setConnection(next);
      setPostFrom(next.postFrom ? toLocalISODate(next.postFrom, tz) : '');
      if (next.status !== QuickBooksConnectionStatus.DISCONNECTED || next.counts.posted > 0) {
        setPostings(await quickBooksOnlineService.postings());
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the QuickBooks connection.'));
    }
  }, [tz]);

  useEffect(() => {
    void load();
  }, [load]);

  // The callback redirects back here with its outcome; say it once.
  useEffect(() => {
    const connected = searchParams.get('quickbooks');
    const failure = searchParams.get('quickbooks_error');
    if (!connected && !failure) return;
    if (connected === 'connected') toast.success('Connected to QuickBooks Online');
    if (failure) setError(CONNECT_ERRORS[failure] ?? `QuickBooks did not connect (${failure}).`);
    const next = new URLSearchParams(searchParams);
    next.delete('quickbooks');
    next.delete('quickbooks_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await quickBooksOnlineService.startConnect());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not start connecting to QuickBooks.'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect QuickBooks Online?',
      message:
        'Payments stop posting to QuickBooks. Those still waiting to post go back to the CSV export; what QuickBooks already accepted stays there.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Stay connected',
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const { revoked } = await quickBooksOnlineService.disconnect();
      if (revoked) {
        toast.success('Disconnected from QuickBooks Online');
      } else {
        toast.error(
          'Disconnected here, but QuickBooks did not confirm. Remove the app in QuickBooks under Settings › Apps if it is still listed.'
        );
      }
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not disconnect QuickBooks.'));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await quickBooksOnlineService.syncNow();
      if (result.skipped === 'busy') {
        toast.success('Payments are being posted right now; refresh in a minute.');
      } else if (result.skipped) {
        setError(`Nothing was posted (${result.skipped.replace(/_/g, ' ')}).`);
      } else {
        toast.success(`Posted ${result.posted}, refused ${result.failed}, retrying ${result.retrying}`);
      }
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not post to QuickBooks.'));
    } finally {
      setBusy(false);
    }
  };

  const savePostFrom = async () => {
    if (!postFrom) return;
    setBusy(true);
    setError(null);
    try {
      const next = await quickBooksOnlineService.setPostFrom(localToUTC(`${postFrom}T00:00`, tz));
      setConnection(next);
      toast.success('Saved');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the date.'));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (posting: QuickBooksPosting) => {
    setBusy(true);
    setError(null);
    try {
      await quickBooksOnlineService.retry(posting.id);
      toast.success(`${posting.documentNumber} will be sent with the next run`);
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not send it again.'));
    } finally {
      setBusy(false);
    }
  };

  const status = connection?.status ?? QuickBooksConnectionStatus.DISCONNECTED;
  const connected = status === QuickBooksConnectionStatus.CONNECTED;

  return (
    <section aria-labelledby="qbo-heading" className="card space-y-4 p-6">
      <div>
        <h2 id="qbo-heading" className="text-theme-text-primary text-lg font-semibold">
          QuickBooks Online connection
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Connected, each paid purchase request, issued check and paid expense report posts to QuickBooks as an expense
          to its vendor, paid from the bank account mapped below. Cash advances, dues and voided checks still go in the
          CSV export, as does any payment QuickBooks refuses.
        </p>
      </div>

      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}

      {connection && !connection.configured && (
        <p className="text-theme-text-primary text-sm">
          Not configured on this server. An administrator sets QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI to
          turn it on. The CSV export below works without it.
        </p>
      )}

      {connection?.configured && (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-theme-text-secondary text-xs">Status</dt>
              <dd className="text-theme-text-primary">
                {connected
                  ? 'Connected'
                  : status === QuickBooksConnectionStatus.RECONNECT_REQUIRED
                    ? 'Reconnect required'
                    : 'Not connected'}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-secondary text-xs">Environment</dt>
              <dd className="text-theme-text-primary">
                {ENVIRONMENT_LABELS[connection.environment ?? ''] ?? connection.environment}
              </dd>
            </div>
            {connection.realmId && status !== QuickBooksConnectionStatus.DISCONNECTED && (
              <div>
                <dt className="text-theme-text-secondary text-xs">QuickBooks company ID</dt>
                <dd className="text-theme-text-primary">{connection.realmId}</dd>
              </div>
            )}
            {connection.connectedAt && status !== QuickBooksConnectionStatus.DISCONNECTED && (
              <div>
                <dt className="text-theme-text-secondary text-xs">Connected</dt>
                <dd className="text-theme-text-primary">
                  {formatDateTime(connection.connectedAt, tz)}
                  {connection.connectedByName ? ` by ${connection.connectedByName}` : ''}
                </dd>
              </div>
            )}
            {connection.lastSyncAt && (
              <div>
                <dt className="text-theme-text-secondary text-xs">Last posted</dt>
                <dd className="text-theme-text-primary">{formatDateTime(connection.lastSyncAt, tz)}</dd>
              </div>
            )}
          </dl>

          {(status === QuickBooksConnectionStatus.RECONNECT_REQUIRED || connection.lastError) && (
            <div role="status" className="alert-warning flex items-start gap-3 rounded-lg p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                {connection.lastError ??
                  'QuickBooks no longer accepts this connection. Connect again; payments wait until then.'}
              </p>
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              {!connected && (
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={busy}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {status === QuickBooksConnectionStatus.RECONNECT_REQUIRED
                    ? 'Reconnect to QuickBooks'
                    : 'Connect to QuickBooks'}
                </button>
              )}
              {connected && (
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  disabled={busy}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Post now
                </button>
              )}
              {status !== QuickBooksConnectionStatus.DISCONNECTED && (
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <Unplug className="h-4 w-4" aria-hidden="true" />
                  Disconnect
                </button>
              )}
            </div>
          )}

          {canManage && status !== QuickBooksConnectionStatus.DISCONNECTED && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="qbo-post-from" className="form-label">
                  Post payments made on or after
                </label>
                <input
                  id="qbo-post-from"
                  type="date"
                  className="form-input"
                  value={postFrom}
                  onChange={(e) => setPostFrom(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => void savePostFrom()}
                disabled={busy || !postFrom}
                className="btn-secondary"
              >
                Save date
              </button>
              <p className="text-theme-text-secondary w-full text-xs">
                Earlier payments stay on the CSV export, so books that already hold them are not posted to twice.
              </p>
            </div>
          )}
        </>
      )}

      {postings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="rwd-table min-w-full">
            <caption className="sr-only">Payments sent to QuickBooks Online</caption>
            <thead>
              <tr>
                <th scope="col" className={HEADER_CELL}>
                  Payment
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Vendor
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Amount
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Status
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {postings.map((posting) => (
                <tr key={posting.id}>
                  <td className={CELL} data-label="Payment">
                    {posting.documentNumber}
                  </td>
                  <td className={CELL} data-label="Vendor">
                    {posting.vendorName ?? '—'}
                  </td>
                  <td className={CELL} data-label="Amount">
                    {posting.amount != null ? formatCurrency(Number(posting.amount)) : '—'}
                  </td>
                  <td className={CELL} data-label="Status">
                    <span className={`badge ${POSTING_STATUS_COLORS[posting.status]}`}>
                      {QUICKBOOKS_POSTING_STATUS_LABELS[posting.status]}
                    </span>
                  </td>
                  <td className={CELL} data-label="Detail">
                    {posting.status === QuickBooksPostingStatus.POSTED && posting.postedAt
                      ? `${formatDateTime(posting.postedAt, tz)}${
                          posting.qbPurchaseId ? ` · QuickBooks #${posting.qbPurchaseId}` : ''
                        }`
                      : (posting.lastError ?? '')}
                    {posting.status === QuickBooksPostingStatus.RETRYING && posting.nextAttemptAt && (
                      <span className="text-theme-text-secondary block text-xs">
                        Next try {formatDateTime(posting.nextAttemptAt, tz)}
                      </span>
                    )}
                    {canManage && posting.status === QuickBooksPostingStatus.FAILED && (
                      <button
                        type="button"
                        onClick={() => void retry(posting)}
                        disabled={busy}
                        className="btn-secondary mt-2 block text-xs"
                      >
                        Send again
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default QuickBooksOnlineSection;
