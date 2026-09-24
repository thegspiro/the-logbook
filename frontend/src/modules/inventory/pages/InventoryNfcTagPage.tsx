/**
 * Where an equipment NFC tag's written link lands: `/inventory/tag/:code`.
 *
 * Resolves the code to its item and replaces this page with the item's own,
 * so the back button skips it. The URL names the tag rather than the item on
 * purpose: unlinking the tag in the app stops the link working, which a URL
 * holding an item id never could.
 *
 * A tag is writable by anyone with a phone, so the code is treated as
 * untrusted: it is shape-checked here, looked up by exact match on the
 * server, and never used to build anything but the request body.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';

// The same bound `parseNfcTagPath` applies to every id read off a tag.
const TAG_CODE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export const InventoryNfcTagPage: React.FC = () => {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!TAG_CODE_PATTERN.test(code)) {
      setError('This does not look like one of this department’s equipment tags.');
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      try {
        const match = await inventoryService.resolveNfcTag({ code });
        if (!cancelled) void navigate(`/inventory/items/${encodeURIComponent(match.item.id)}`, { replace: true });
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not look up this tag.'));
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  if (!error) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="sr-only">Finding the tagged item…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="alert-danger flex items-start gap-2" role="alert">
        <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-theme-alert-danger-text text-sm font-medium">This NFC tag did not find an item</p>
          <p className="text-theme-alert-danger-text mt-1 text-sm">{error}</p>
        </div>
      </div>
      <Link to="/inventory/my-equipment" className="btn-secondary mt-4 inline-flex">
        Go to Inventory
      </Link>
    </div>
  );
};

export default InventoryNfcTagPage;
