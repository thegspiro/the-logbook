/**
 * Where the department publishes adopted minutes.
 *
 * Publishing always files a copy in the Documents library. Two further choices
 * are the department's to make: whether a public copy is also posted on the
 * public minutes page, and whether executive-session minutes may be published
 * at all. The effective result for executive sessions comes from the server, so
 * the screen cannot promise a page that will not appear.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { MinutesSettingsPanelProps } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

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

export const PublishingSettingsPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const { confirm } = useConfirm();
  const [publicPosting, setPublicPosting] = useState(settings.public_posting);
  const [executiveLibrary, setExecutiveLibrary] = useState(settings.executive_library_publishing);
  const [executivePublic, setExecutivePublic] = useState(settings.executive_public_posting);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPublicPosting(settings.public_posting);
    setExecutiveLibrary(settings.executive_library_publishing);
    setExecutivePublic(settings.executive_public_posting);
  }, [settings.public_posting, settings.executive_library_publishing, settings.executive_public_posting]);

  const save = async () => {
    // Posting executive-session minutes where anyone can read them is the one
    // choice here that cannot be quietly undone: a copy already read stays read.
    const newlyPublicExecutive =
      publicPosting && executiveLibrary && executivePublic && !settings.executive_effective_public;
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
      await onSaved();
      toast.success('Publishing settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the publishing settings'));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canEdit || saving;
  const dirty =
    publicPosting !== settings.public_posting ||
    executiveLibrary !== settings.executive_library_publishing ||
    executivePublic !== settings.executive_public_posting;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
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
          Right now executive-session minutes {settings.executive_effective_library ? 'can' : 'cannot'} be published to
          the library and {settings.executive_effective_public ? 'can' : 'cannot'} be posted publicly.
        </p>
      </fieldset>

      <SettingsSaveBar canEdit={canEdit} dirty={dirty} saving={saving} />
    </form>
  );
};

export default PublishingSettingsPanel;
