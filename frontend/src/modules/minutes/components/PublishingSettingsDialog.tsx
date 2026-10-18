/**
 * Where the department publishes adopted minutes.
 *
 * Publishing always files a copy in the Documents library. Two further choices
 * are the department's to make: whether a public copy is also posted on the
 * public minutes page, and whether executive-session minutes may be published
 * at all. The values shown are what the server applies (`GET /minutes-records/
 * settings`), including the effective result for executive sessions, so the
 * screen cannot promise a page that will not appear. Writing goes through the
 * organization settings and needs `settings.manage`.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { organizationService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { MinutesReminderSettings } from '../types/minutes';

interface PublishingSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SwitchProps {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  title: string;
  help: string;
}

const Switch: React.FC<SwitchProps> = ({ id, checked, disabled, onChange, title, help }) => (
  <label htmlFor={id} className="flex items-start gap-3">
    <input
      id={id}
      type="checkbox"
      className="form-checkbox mt-0.5"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="text-theme-text-primary block text-sm font-medium">{title}</span>
      <span className="text-theme-text-secondary block text-xs">{help}</span>
    </span>
  </label>
);

export const PublishingSettingsDialog: React.FC<PublishingSettingsDialogProps> = ({ isOpen, onClose }) => {
  const { confirm } = useConfirm();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');

  const [loaded, setLoaded] = useState<MinutesReminderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publicPosting, setPublicPosting] = useState(false);
  const [executiveLibrary, setExecutiveLibrary] = useState(false);
  const [executivePublic, setExecutivePublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const adopt = (next: MinutesReminderSettings) => {
    setLoaded(next);
    setPublicPosting(next.public_posting);
    setExecutiveLibrary(next.executive_library_publishing);
    setExecutivePublic(next.executive_public_posting);
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoaded(null);
    setLoadError(null);
    minutesService
      .getReminderSettings()
      .then(adopt)
      .catch((err: unknown) => setLoadError(getErrorMessage(err, 'Failed to load the publishing settings')));
  }, [isOpen]);

  const save = async () => {
    if (!loaded) return;
    // Posting executive-session minutes where anyone can read them is the one
    // choice here that cannot be quietly undone: a copy already read stays read.
    const newlyPublicExecutive =
      publicPosting && executiveLibrary && executivePublic && !loaded.executive_effective_public;
    if (newlyPublicExecutive) {
      const ok = await confirm({
        title: 'Post executive-session minutes publicly?',
        message:
          'Executive-session minutes can contain personnel, legal and other confidential matters. With this on, they are posted on the public minutes page as soon as they are published. You can switch it off or withdraw a copy later, but anyone who has already read it keeps what they read.',
        confirmLabel: 'Allow public posting',
        cancelLabel: 'Keep them private',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Every switch the form owns is sent, so each save states the whole choice.
      await organizationService.updateSettings({
        minutes: {
          public_posting: publicPosting,
          executive_library_publishing: executiveLibrary,
          executive_public_posting: executivePublic,
        },
      });
      adopt(await minutesService.getReminderSettings());
      toast.success('Publishing settings saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the publishing settings'));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canEdit || saving;
  const dirty =
    !!loaded &&
    (publicPosting !== loaded.public_posting ||
      executiveLibrary !== loaded.executive_library_publishing ||
      executivePublic !== loaded.executive_public_posting);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Publishing minutes"
      size="md"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button type="submit" disabled={saving || !loaded || !dirty} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </>
      }
    >
      {loadError && (
        <p className="alert-danger text-sm" role="alert">
          {loadError}
        </p>
      )}
      {!loaded && !loadError && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {loaded && (
        <div className="space-y-4">
          <p className="text-theme-text-secondary text-sm">
            Publishing adopted minutes always files a copy in the Documents library. Publishing them again replaces that
            copy and notes which version it replaced.
            {!canEdit && ' These settings are changed by a settings administrator.'}
          </p>

          <Switch
            id="publishing-public"
            checked={publicPosting}
            disabled={disabled}
            onChange={setPublicPosting}
            title="Also post a public copy on the public minutes page"
            help="Anyone with the link can read it, without signing in. The public copy is narrower than the printed one: attendance is counts and officers present, individual votes and discussion notes are left out, closed sessions show the reason and authority only, and attachments are not linked."
          />

          <fieldset className="border-theme-surface-border space-y-3 rounded-md border p-3">
            <legend className="text-theme-text-primary px-1 text-sm font-medium">Executive-session minutes</legend>
            <p className="text-theme-text-secondary text-xs">
              Off by default. Executive-session minutes can only be published when the department allows it here.
            </p>
            <Switch
              id="publishing-exec-library"
              checked={executiveLibrary}
              disabled={disabled}
              onChange={setExecutiveLibrary}
              title="Allow publishing to the library"
              help="They are filed in a separate folder that only library managers can open."
            />
            <Switch
              id="publishing-exec-public"
              checked={executivePublic}
              disabled={disabled || !executiveLibrary}
              onChange={setExecutivePublic}
              title="Allow posting them on the public minutes page"
              help="Needs both switches above to be on. Think hard before turning this on."
            />
            <p className="text-theme-text-muted text-xs" data-testid="executive-effective">
              Right now executive-session minutes {loaded.executive_effective_library ? 'can' : 'cannot'} be published
              to the library and {loaded.executive_effective_public ? 'can' : 'cannot'} be posted publicly.
            </p>
          </fieldset>
        </div>
      )}
    </Modal>
  );
};

export default PublishingSettingsDialog;
