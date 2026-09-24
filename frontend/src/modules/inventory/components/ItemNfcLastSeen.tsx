/**
 * An item's NFC "last seen" trail: the most recent staff taps, newest first.
 *
 * Only taps by inventory managers are recorded (a member opening a written tag
 * from their own phone leaves no row), so this is the quartermaster's trail of
 * the item, not a record of who walked past it.
 */

import React, { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { InventoryNfcScanAction } from '../../../constants/enums';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { InventoryNfcScan } from '../types/nfc';

const SHOWN = 10;

interface ItemNfcLastSeenProps {
  itemId: string;
}

function describeScan(scan: InventoryNfcScan): string {
  if (scan.action === InventoryNfcScanAction.PUT_AWAY) {
    const to = scan.storage_area_name ?? 'a storage area that has since been removed';
    if (scan.from_storage_area_id === scan.storage_area_id) return `Seen on ${to}`;
    return scan.from_storage_area_name ? `Moved from ${scan.from_storage_area_name} to ${to}` : `Put away on ${to}`;
  }
  return 'Tag tapped';
}

export const ItemNfcLastSeen: React.FC<ItemNfcLastSeenProps> = ({ itemId }) => {
  const tz = useTimezone();
  const [scans, setScans] = useState<InventoryNfcScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await inventoryService.getItemNfcScans(itemId, SHOWN);
        if (!cancelled) setScans(response.items);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the NFC trail.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return (
    <section className="card-secondary p-4 lg:col-span-2" aria-labelledby="item-nfc-last-seen-heading">
      <h3
        id="item-nfc-last-seen-heading"
        className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold"
      >
        <History className="h-4 w-4" aria-hidden="true" />
        Last Seen (NFC)
      </h3>
      {loading ? (
        <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-label="Loading NFC trail" />
      ) : error ? (
        <p className="text-theme-text-secondary text-sm">{error}</p>
      ) : scans.length === 0 ? (
        <p className="text-theme-text-muted text-sm">No NFC taps recorded for this item yet.</p>
      ) : (
        <ol className="divide-theme-surface-border divide-y">
          {scans.map((scan) => (
            <li key={scan.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
              <span className="text-theme-text-primary text-sm">{describeScan(scan)}</span>
              <span className="text-theme-text-secondary text-xs sm:text-right">
                {formatDateTime(scan.scanned_at, tz)}
                {scan.scanned_by_name ? ` · ${scan.scanned_by_name}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
