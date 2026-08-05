/**
 * Notification Preview Modal
 *
 * Shows what one of the store's notices actually looks like in a member's
 * inbox. The body is rendered in an iframe rather than injected into the page:
 * email HTML carries its own layout and colours, and letting it loose in the
 * app's DOM would both mangle the preview and let template markup reach into
 * the admin screen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mail, Monitor, Smartphone } from 'lucide-react';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { storefrontService } from '../services/api';
import type { StoreNotificationPreview } from '../types';

interface NotificationPreviewModalProps {
  notice: string;
  onClose: () => void;
}

export const NotificationPreviewModal: React.FC<NotificationPreviewModalProps> = ({
  notice,
  onClose,
}) => {
  const [preview, setPreview] = useState<StoreNotificationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const frameRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await storefrontService.previewNotification(notice));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not render that notice'));
    } finally {
      setLoading(false);
    }
  }, [notice]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (preview?.htmlBody && doc) {
      doc.open();
      doc.write(preview.htmlBody);
      doc.close();
    }
  }, [preview, viewport]);

  return (
    <Modal isOpen onClose={onClose} title={preview?.label ?? 'Notification preview'} size="xl">
      <div className="modal-body space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        )}

        {error && !loading && <div className="alert-danger text-sm">{error}</div>}

        {preview && !loading && (
          <>
            <div className="card-secondary space-y-1 p-3">
              <p className="text-theme-text-primary text-sm font-medium">
                <Mail className="mr-1 inline h-4 w-4" aria-hidden="true" />
                {preview.subject}
              </p>
              <p className="text-theme-text-secondary text-xs">Goes to: {preview.audience}</p>
              {preview.alsoGoverns.length > 0 && (
                <p className="text-theme-text-secondary text-xs">
                  The same switch also controls: {preview.alsoGoverns.join(', ')}
                </p>
              )}
            </div>

            {!preview.enabled && (
              <div className="alert-warning text-sm">
                This notice is currently switched off, so members are not receiving it.
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-theme-text-muted text-xs">
                Sample order and window; your own payment details, wording and branding.
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setViewport('desktop')}
                  aria-pressed={viewport === 'desktop'}
                  className={`btn-icon ${viewport === 'desktop' ? 'bg-theme-surface-secondary' : ''}`}
                  title="Desktop width"
                >
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Desktop width</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('mobile')}
                  aria-pressed={viewport === 'mobile'}
                  className={`btn-icon ${viewport === 'mobile' ? 'bg-theme-surface-secondary' : ''}`}
                  title="Phone width"
                >
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Phone width</span>
                </button>
              </div>
            </div>

            <div className="border-theme-surface-border flex justify-center overflow-x-auto rounded-md border bg-white p-2">
              <iframe
                ref={frameRef}
                title={`${preview.label} preview`}
                // Email HTML is trusted (we compose it) but sandboxing costs
                // nothing and keeps scripts out of an admin screen.
                sandbox=""
                className="h-[28rem] border-0"
                style={{ width: viewport === 'mobile' ? '390px' : '100%' }}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
