/**
 * Who the department counts toward quorum.
 *
 * Bylaws differ on a member who arrived after the call to order, one who left
 * before the vote, and proxies, so the department chooses. A member marked
 * present always counts and a guest never does. The server applies these when
 * it calculates quorum (`QuorumService`); this screen only records the choice
 * and shows what the server read back.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { MinutesSettingsPanelProps } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

interface Choice {
  quorum_counts_late: boolean;
  quorum_counts_left_early: boolean;
  proxy_attendance: boolean;
}

const OPTIONS: { key: keyof Choice; label: string; help: string }[] = [
  {
    key: 'quorum_counts_late',
    label: 'Members who arrived late count',
    help: 'A member marked Late on the roll call is counted toward quorum.',
  },
  {
    key: 'quorum_counts_left_early',
    label: 'Members who left early count',
    help: 'A member marked Left early is counted toward quorum. Turn this off if your bylaws need members in the room for the vote.',
  },
  {
    key: 'proxy_attendance',
    label: 'Use proxies',
    help: 'The roll call offers "Represented by proxy" for a member who sent a proxy, and that member counts toward quorum. A proxy does not vote in a roll-call vote and is not counted as a member present.',
  },
];

export const QuorumCountingPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const fromServer: Choice = {
    quorum_counts_late: settings.quorum_counts_late,
    quorum_counts_left_early: settings.quorum_counts_left_early,
    proxy_attendance: settings.proxy_attendance,
  };
  const [value, setValue] = useState<Choice>(fromServer);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue({
      quorum_counts_late: settings.quorum_counts_late,
      quorum_counts_left_early: settings.quorum_counts_left_early,
      proxy_attendance: settings.proxy_attendance,
    });
  }, [settings.quorum_counts_late, settings.quorum_counts_left_early, settings.proxy_attendance]);

  const dirty = OPTIONS.some(({ key }) => value[key] !== fromServer[key]);

  const save = async () => {
    setSaving(true);
    try {
      // Every switch this panel owns is sent, so what is saved is what is shown.
      await organizationService.updateSettings({ minutes: { ...value } });
      await onSaved();
      toast.success('Quorum setting saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the quorum setting'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="space-y-3" disabled={!canEdit || saving}>
        <legend className="text-theme-text-secondary mb-2 text-sm">
          A member marked present always counts toward quorum and a guest never does. Minutes already adopted keep the
          quorum they were adopted with; a draft is counted again when its quorum is next checked.
          {!canEdit && ' This is changed by a settings administrator.'}
        </legend>
        {OPTIONS.map(({ key, label, help }) => (
          <label key={key} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={value[key]}
              onChange={(e) => setValue((current) => ({ ...current, [key]: e.target.checked }))}
            />
            <span>
              <span className="text-theme-text-primary block text-sm font-medium">{label}</span>
              <span className="text-theme-text-secondary block text-xs">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SettingsSaveBar canEdit={canEdit} dirty={dirty} saving={saving} />
    </form>
  );
};

export default QuorumCountingPanel;
