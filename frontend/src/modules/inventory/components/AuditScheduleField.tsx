/**
 * How often one storage area should be audited by NFC tap.
 *
 * Shown in the storage area editor beside the area's NFC tags, to inventory
 * managers, while NFC tracking is on. A change saves immediately, like the
 * tags card beside it, so the editor's own Save button stays about the area's
 * name and place.
 *
 * The current value is read from the schedule list: an area missing from it is
 * not on a schedule. That keeps the general storage-area API untouched.
 */

import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { InventoryAuditFrequency } from '../../../constants/enums';
import { AUDIT_FREQUENCY_LABELS } from '../../../constants/nfc';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { InventoryAuditScheduleRow } from '../types/nfc';

interface AuditScheduleFieldProps {
  storageAreaId: string;
}

const OPTIONS = Object.values(InventoryAuditFrequency);

export const AuditScheduleField: React.FC<AuditScheduleFieldProps> = ({ storageAreaId }) => {
  const tz = useTimezone();
  const [row, setRow] = useState<InventoryAuditScheduleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    inventoryService
      .getAuditSchedule()
      .then((response) => {
        if (!cancelled) setRow(response.items.find((r) => r.storage_area_id === storageAreaId) ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, 'Could not load the audit schedule.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storageAreaId]);

  const save = async (value: string) => {
    const frequency = (OPTIONS as string[]).includes(value) ? (value as InventoryAuditFrequency) : null;
    setSaving(true);
    try {
      const updated = await inventoryService.setAuditSchedule(storageAreaId, frequency);
      setRow(updated.audit_frequency ? updated : null);
      toast.success(frequency ? `Audit ${AUDIT_FREQUENCY_LABELS[frequency].toLowerCase()}` : 'Audit schedule removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the audit schedule.'));
    } finally {
      setSaving(false);
    }
  };

  let status = '';
  if (row?.audit_frequency) {
    if (!row.last_audited_at) status = 'Never audited: due now.';
    else if (row.overdue) status = `Overdue since ${formatDate(row.next_due_at ?? '', tz)}.`;
    else
      status = `Last audited ${formatDate(row.last_audited_at, tz)}; next due ${formatDate(row.next_due_at ?? '', tz)}.`;
  }

  return (
    <div className="card-secondary space-y-2 p-3">
      <label htmlFor={`audit-schedule-select-${storageAreaId}`} className="form-label flex items-center gap-2">
        <CalendarClock className="h-4 w-4" aria-hidden="true" /> Shelf audit schedule
      </label>
      {loading ? (
        <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-label="Loading" />
      ) : (
        <select
          id={`audit-schedule-select-${storageAreaId}`}
          className="form-input"
          value={row?.audit_frequency ?? ''}
          disabled={saving}
          onChange={(e) => void save(e.target.value)}
        >
          <option value="">Not scheduled</option>
          {OPTIONS.map((f) => (
            <option key={f} value={f}>
              {AUDIT_FREQUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      )}
      {status && <p className="text-theme-text-secondary text-xs">{status}</p>}
    </div>
  );
};

export default AuditScheduleField;
