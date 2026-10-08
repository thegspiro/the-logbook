/**
 * Installation-level notices for administrators (GET /system-notices) — today,
 * malware scanning being turned off on the server.
 *
 * Mounted once in the app shell and shown only to holders of settings.manage.
 * There is deliberately no dismiss button: a notice goes away when its
 * condition does, which is what keeps a deliberate opt-out from becoming a
 * forgotten one. A failed fetch shows nothing rather than an error — the
 * notice is supplementary to the startup log and preflight warnings.
 */

import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { systemNoticesService } from '../services/systemNoticesService';
import { useAuthStore } from '../stores/authStore';
import type { SystemNotice } from '../types/systemNotices';

export const SystemNoticesBanner: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const mayManageSettings = Boolean(userId) && checkPermission('settings.manage');
  const [notices, setNotices] = useState<SystemNotice[]>([]);

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
          </div>
        </section>
      ))}
    </div>
  );
};
