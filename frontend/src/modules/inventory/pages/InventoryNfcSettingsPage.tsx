/**
 * NFC tag tracking — Inventory Admin.
 *
 * One switch, stored in org.settings as ``inventory.nfc_tracking_enabled``.
 * The server reads it (``app/utils/inventory_nfc.py``) and refuses every NFC
 * tag call while it is off; this screen only writes it.
 *
 * The save sends **only** that key. The organization settings endpoint
 * deep-merges, so the rest of the ``inventory`` section (the write-off
 * threshold, which has no screen) is left alone.
 *
 * Turning it off does not delete anything: links already made are kept, and
 * come back into effect if it is turned on again.
 */

import React, { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, Nfc } from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { isNfcSupported } from '../../../constants/nfc';
import { Breadcrumbs } from '../../../components/ux';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';

export const InventoryNfcSettingsPage: React.FC = () => {
  const { enabled, loading, refresh } = useInventoryNfcEnabled();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (next: boolean) => {
      setSaving(true);
      try {
        await organizationService.updateSettings({ inventory: { nfc_tracking_enabled: next } });
        // Re-read from the server rather than trusting `next`, so the screen
        // shows what the server will actually enforce.
        await refresh();
        toast.success(next ? 'NFC tag tracking turned on' : 'NFC tag tracking turned off');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to save the NFC setting'));
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading NFC settings" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Breadcrumbs />

      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target mb-4 justify-start gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Inventory Administration
      </Link>

      <header className="mb-6">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Nfc className="h-5 w-5" /> NFC Tags
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Stick an NFC tag on a piece of equipment and link it to the item. Tapping the tag with a phone then finds that
          exact item: in the distribute and return scanner, or straight from the phone&rsquo;s home screen.
        </p>
      </header>

      <section className="card mb-6 p-5">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void save(e.target.checked)}
            disabled={saving}
            className="form-checkbox"
          />
          <div>
            <span className="text-theme-text-primary text-sm font-medium">Use NFC tags for inventory items</span>
            <p className="text-theme-text-muted text-xs">
              Turning this off hides the NFC controls and stops tags resolving. Links already made are kept and work
              again if you turn it back on.
            </p>
          </div>
        </label>
      </section>

      <section className="card p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">What works on which phone</h2>
        <ul className="text-theme-text-secondary mt-2 list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Linking and in-app tapping</strong> need Chrome on Android, over HTTPS. That is a browser limit: no
            other browser lets a web page use NFC.
          </li>
          <li>
            <strong>Tags with a written link</strong> work on any phone, iPhones included. Tapping one opens the item in
            the phone&rsquo;s browser, with no app needed. Use blank, writable tags (NTAG213/215/216) for these.
          </li>
          <li>
            <strong>Tags linked by their serial number</strong> can only be read from inside the app on Android. Use
            this for tags that cannot be written.
          </li>
          <li>
            At a desk, a USB NFC reader types a tag&rsquo;s serial into the item&rsquo;s NFC Tags box like a keyboard.
          </li>
        </ul>
        {!isNfcSupported() && (
          <p className="text-theme-text-muted mt-3 text-xs">
            This device cannot read or write NFC tags itself. You can still turn the setting on here and link tags from
            an Android phone.
          </p>
        )}
      </section>
    </div>
  );
};

export default InventoryNfcSettingsPage;
