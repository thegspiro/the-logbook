/**
 * The reason recorded for a member's last status change, and a way to correct it.
 *
 * Shown to members.manage holders under the member's status. The reason was
 * write-once from the Change status dialog; a typo or a vague note stayed on
 * the record for good. Editing rewords it only — the status, the date it
 * changed and the original audit entry stay as they were.
 */

import React, { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberStatusService } from '../../services/api';
import type { StatusChangeRecord } from '../../types/user';
import { PromptDialog } from '../ux/PromptDialog';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface StatusChangeReasonProps {
  userId: string;
  tz: string;
  /** Changes whenever the member's status does, so a new change is re-read. */
  refreshKey?: string | undefined;
}

export const StatusChangeReason: React.FC<StatusChangeReasonProps> = ({ userId, tz, refreshKey }) => {
  const [record, setRecord] = useState<StatusChangeRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    memberStatusService
      .getStatusChange(userId)
      .then((result) => {
        if (!cancelled) setRecord(result);
      })
      .catch(() => {
        // Nothing shown when it cannot be read; the status itself is above.
        if (!cancelled) setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  if (!record?.status_changed_at) return null;

  const handleSave = async (value: string) => {
    setSaving(true);
    try {
      setRecord(await memberStatusService.updateStatusChangeReason(userId, value || null));
      setEditing(false);
      toast.success('Reason updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the reason'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 text-sm" data-testid="status-change-reason">
      <p className="text-theme-text-muted text-xs">Changed {formatDateTime(record.status_changed_at, tz)}</p>
      <div className="mt-1 flex items-start gap-2">
        <p className="text-theme-text-primary min-w-0 break-words whitespace-pre-line">
          {record.status_change_reason ?? <span className="text-theme-text-muted">No reason recorded</span>}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-theme-text-muted shrink-0 transition hover:text-blue-500"
          title="Edit status change reason"
          aria-label="Edit status change reason"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <PromptDialog
        isOpen={editing}
        onClose={() => setEditing(false)}
        onSubmit={(value) => void handleSave(value)}
        title="Edit status change reason"
        label="Reason"
        defaultValue={record.status_change_reason ?? ''}
        required={false}
        multiline
        hint="Corrects the wording only. The status and the date it changed stay as they are, and the original reason stays in the audit log."
        loading={saving}
      />
    </div>
  );
};

export default StatusChangeReason;
