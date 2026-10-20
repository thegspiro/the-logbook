/**
 * Medical stock rows, on the shelves and aboard the apparatus.
 *
 * One table for the Expiring tab and the lot lookup, which return the same
 * row shape (MedicalExpiringStockRow), so a unit reads the same in both.
 */

import React from 'react';
import { Package, Truck } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { expiryLabel, expiryTone, supplyLabel } from '../types';
import type { MedicalExpiringStockRow } from '../types';

interface StockRowsTableProps {
  rows: MedicalExpiringStockRow[];
}

const headClass = 'text-theme-text-muted px-4 py-3 text-xs font-semibold uppercase';

export const StockRowsTable: React.FC<StockRowsTableProps> = ({ rows }) => {
  const tz = useTimezone();
  return (
    <div className="card overflow-x-auto p-0">
      <table className="rwd-table w-full text-sm">
        <thead>
          <tr className="border-theme-surface-border border-b">
            <th className={`${headClass} text-left`}>Item</th>
            <th className={`${headClass} text-left`}>Where</th>
            <th className={`${headClass} text-left`}>Lot</th>
            <th className={`${headClass} text-left`}>Expires</th>
            <th className={`${headClass} text-right`}>On hand</th>
            <th className={`${headClass} text-left`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lot) => (
            <tr key={lot.key} className="border-theme-surface-border border-b last:border-0">
              <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                {lot.item_name ? supplyLabel({ name: lot.item_name, size: lot.item_size }) : '—'}
              </td>
              <td data-label="Where" className="text-theme-text-secondary px-4 py-3">
                <span className="inline-flex items-start gap-1">
                  {lot.location === 'apparatus' ? (
                    <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="On an apparatus" />
                  ) : (
                    <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="In storage" />
                  )}
                  <span>{lot.where || (lot.location === 'apparatus' ? 'On an apparatus' : 'In storage')}</span>
                </span>
              </td>
              <td data-label="Lot" className="text-theme-text-muted px-4 py-3 font-mono text-xs">
                {lot.lot_number || '—'}
              </td>
              <td data-label="Expires" className="text-theme-text-muted px-4 py-3">
                {lot.expiration_date ? formatDate(lot.expiration_date, tz) : '—'}
              </td>
              <td data-label="On hand" className="text-theme-text-primary px-4 py-3 text-right tabular-nums">
                {formatNumber(lot.quantity)}
              </td>
              <td
                data-label="Status"
                className={`px-4 py-3 font-medium ${expiryTone(lot.days_until_expiration ?? undefined)}`}
              >
                {expiryLabel(lot.days_until_expiration ?? undefined)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default StockRowsTable;
