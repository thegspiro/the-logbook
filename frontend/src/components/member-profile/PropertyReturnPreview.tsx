/**
 * Preview what dropping a member would ask them to return (owner decision
 * 2026-11-01).
 *
 * Shown on the profile to members.manage holders, the grant the drop itself
 * takes. It reads GET /users/{id}/property-return-report, which builds the
 * list with the same code as the drop's letter, so the preview and the letter
 * cannot disagree — this component lists what the server sends and computes
 * nothing of its own. Opening it saves no document, sends no email and leaves
 * the member's status alone.
 */

import React, { useRef, useState } from 'react';
import { ClipboardList, PackageCheck } from 'lucide-react';
import { Modal } from '../Modal';
import { EmptyState } from '../ux';
import { memberStatusService } from '../../services/api';
import type { PropertyReturnItem, PropertyReturnReport } from '../../types/user';
import { formatCurrency } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface PropertyReturnPreviewProps {
  userId: string;
  memberName: string;
}

const KIND_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  checked_out: 'Checked out',
  issued: 'Issued',
};

/** The letter prints "-" for an identifier the item does not have. */
const identifierOf = (item: PropertyReturnItem): string => {
  if (item.serial_number && item.serial_number !== '-') return `S/N ${item.serial_number}`;
  if (item.asset_tag && item.asset_tag !== '-') return `Tag ${item.asset_tag}`;
  return '—';
};

export const PropertyReturnPreview: React.FC<PropertyReturnPreviewProps> = ({ userId, memberName }) => {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<PropertyReturnReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may fill the dialog: reopening it quickly must
  // not let a slower earlier answer overwrite the current one.
  const requestRef = useRef(0);

  const load = async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await memberStatusService.getPropertyReturnPreview(userId);
      if (request === requestRef.current) setReport(result);
    } catch (err: unknown) {
      if (request === requestRef.current) setError(getErrorMessage(err, 'Unable to load the property return preview.'));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    void load();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="text-theme-text-secondary mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
      >
        <ClipboardList className="h-4 w-4" aria-hidden="true" />
        Preview property return
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={`Property return — ${memberName}`} size="lg">
        <div className="space-y-4">
          <p className="text-theme-text-secondary text-sm">
            What a drop would ask {memberName} to return. This is a preview: nothing is saved, sent or changed.
          </p>

          {loading && <p className="text-theme-text-muted text-sm">Loading…</p>}

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          {report && report.items.length === 0 && (
            <EmptyState
              icon={PackageCheck}
              title="Nothing to return"
              description={`${memberName} has no assigned, checked-out or issued department property on record.`}
              headingLevel={4}
            />
          )}

          {report && report.items.length > 0 && (
            <>
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b text-left">
                    <th scope="col" className="text-theme-text-muted px-3 py-2 font-medium">
                      Item
                    </th>
                    <th scope="col" className="text-theme-text-muted px-3 py-2 font-medium">
                      Identifier
                    </th>
                    <th scope="col" className="text-theme-text-muted px-3 py-2 font-medium">
                      How held
                    </th>
                    <th scope="col" className="text-theme-text-muted px-3 py-2 text-right font-medium">
                      Qty
                    </th>
                    <th scope="col" className="text-theme-text-muted px-3 py-2 text-right font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item, index) => (
                    <tr
                      key={`${item.type}-${item.name}-${index}`}
                      className="border-theme-surface-border border-b last:border-b-0"
                    >
                      <td className="rwd-table-lead text-theme-text-primary px-3 py-2" data-label="Item">
                        {item.name}
                      </td>
                      <td className="text-theme-text-secondary px-3 py-2" data-label="Identifier">
                        {identifierOf(item)}
                      </td>
                      <td className="text-theme-text-secondary px-3 py-2" data-label="How held">
                        {KIND_LABELS[item.type] ?? item.type}
                      </td>
                      <td className="text-theme-text-secondary px-3 py-2 text-right" data-label="Qty">
                        {item.quantity}
                      </td>
                      <td className="text-theme-text-primary px-3 py-2 text-right" data-label="Value">
                        {formatCurrency(item.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-theme-text-primary text-right text-sm font-semibold">
                {report.item_count} {report.item_count === 1 ? 'item' : 'items'} · Total{' '}
                {formatCurrency(report.total_value)}
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
};

export default PropertyReturnPreview;
