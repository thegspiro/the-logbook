/**
 * Installation-level notices for administrators (GET /system-notices) — malware
 * scanning turned off, files stored before encryption still unencrypted, the
 * encryption key's safekeeping not yet confirmed.
 *
 * Mounted once in the app shell and shown only to holders of settings.manage.
 * There is deliberately no dismiss button: a notice goes away when its
 * condition does, which is what keeps a deliberate opt-out from becoming a
 * forgotten one. A failed fetch shows nothing rather than an error — the
 * notice is supplementary to the startup log and preflight warnings.
 *
 * One notice carries an action: confirming the encryption key is stored apart
 * from the server and its backups (FILE_STORAGE_HARDENING.md decision 25).
 * Confirming is the condition going away, recorded with who and when, so it is
 * not a dismissal; a replaced key brings the notice back.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { systemNoticesService } from '../services/systemNoticesService';
import { getErrorMessage } from '../utils/errorHandling';
import { useAuthStore } from '../stores/authStore';
import type { SystemNotice } from '../types/systemNotices';

export const SystemNoticesBanner: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const mayManageSettings = Boolean(userId) && checkPermission('settings.manage');
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [confirming, setConfirming] = useState(false);
  const { confirm } = useConfirm();

  useEffect(() => {
    if (!mayManageSettings) {
      setNotices([]);
      return;
    }
    let cancelled = false;
    systemNoticesService
      .list()
      .then((list) => {
        if (!cancelled) setNotices(list);
      })
      .catch(() => {
        if (!cancelled) setNotices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mayManageSettings, userId]);

  const confirmKeyCustody = useCallback(async () => {
    setConfirming(true);
    try {
      const status = await systemNoticesService.getKeyCustody();
      const agreed = await confirm({
        title: 'Confirm the encryption key is stored safely',
        message: (
          <div className="space-y-2">
            <p>
              Confirm that a copy of this server&apos;s ENCRYPTION_KEY and ENCRYPTION_SALT is kept somewhere other than
              the server and its backups — a password manager or a sealed record, not the backup drive.
            </p>
            <p>
              Key fingerprint: <code className="font-mono">{status.key_fingerprint}</code>
            </p>
            <p>Your name and the time are recorded in the audit log.</p>
          </div>
        ),
        confirmLabel: 'It is stored separately',
        cancelLabel: 'Not yet',
        variant: 'warning',
      });
      if (!agreed) return;
      await systemNoticesService.confirmKeyCustody(status.key_fingerprint);
      toast.success('Encryption key safekeeping confirmed');
      setNotices(await systemNoticesService.list());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the confirmation'));
    } finally {
      setConfirming(false);
    }
  }, [confirm]);

  if (notices.length === 0) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      {notices.map((notice) => (
        <section
          key={notice.key}
          role="alert"
          aria-labelledby={`system-notice-${notice.key}`}
          className={`${notice.severity === 'critical' ? 'alert-danger' : 'alert-warning'} mb-2 flex items-start gap-3 text-sm`}
        >
          <ShieldAlert
            className={`mt-0.5 h-5 w-5 shrink-0 ${
              notice.severity === 'critical' ? 'text-theme-alert-danger-icon' : 'text-theme-alert-warning-icon'
            }`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2
              id={`system-notice-${notice.key}`}
              className={`font-semibold ${
                notice.severity === 'critical' ? 'text-theme-alert-danger-title' : 'text-theme-alert-warning-title'
              }`}
            >
              {notice.title}
            </h2>
            <p
              className={
                notice.severity === 'critical' ? 'text-theme-alert-danger-text' : 'text-theme-alert-warning-text'
              }
            >
              {notice.detail}
            </p>
            {notice.action === 'confirm_key_custody' && (
              <button
                type="button"
                onClick={() => void confirmKeyCustody()}
                disabled={confirming}
                className="btn-primary mt-2 disabled:opacity-50"
              >
                {confirming ? 'Recording…' : 'Confirm the key is stored safely'}
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
};
