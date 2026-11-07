/**
 * Where a payment stands with QuickBooks Online, on its detail page: accepted
 * (with QuickBooks' own record number), waiting, or refused and why.
 *
 * Read from `GET /finance/quickbooks/postings` (`finance.view`), filtered to
 * this payment. Renders nothing for a payment that was never sent live, so a
 * department that is not connected sees exactly what it saw before.
 */

import React, { useEffect, useState } from 'react';
import { useTimezone } from '@/hooks/useTimezone';
import { useAuthStore } from '@/stores/authStore';
import { formatDateTime } from '@/utils/dateFormatting';
import { quickBooksOnlineService } from '../services/api';
import { QUICKBOOKS_POSTING_STATUS_LABELS, QuickBooksPostingStatus } from '../types';
import type { QuickBooksPaymentType, QuickBooksPosting } from '../types';

interface QuickBooksPostingNoteProps {
  paymentType: QuickBooksPaymentType;
  paymentId: string;
}

export const QuickBooksPostingNote: React.FC<QuickBooksPostingNoteProps> = ({ paymentType, paymentId }) => {
  const tz = useTimezone();
  const canView = useAuthStore((s) => s.checkPermission('finance.view'));
  const [posting, setPosting] = useState<QuickBooksPosting | null>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    quickBooksOnlineService
      .postings({ paymentType, paymentId })
      .then((rows) => {
        if (!cancelled) setPosting(rows[0] ?? null);
      })
      // Supplementary: a failure leaves the page as it would be unconnected.
      .catch(() => {
        if (!cancelled) setPosting(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, paymentType, paymentId]);

  if (!posting) return null;
  const accepted = posting.status === QuickBooksPostingStatus.POSTED;
  return (
    <div>
      <p className="text-theme-text-secondary text-xs">QuickBooks Online</p>
      <p className="text-theme-text-primary text-sm">
        {QUICKBOOKS_POSTING_STATUS_LABELS[posting.status]}
        {accepted && posting.postedAt ? ` ${formatDateTime(posting.postedAt, tz)}` : ''}
        {accepted && posting.qbPurchaseId ? ` (#${posting.qbPurchaseId})` : ''}
      </p>
      {!accepted && posting.lastError && <p className="text-theme-text-secondary text-xs">{posting.lastError}</p>}
    </div>
  );
};

export default QuickBooksPostingNote;
