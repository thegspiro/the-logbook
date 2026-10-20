/**
 * Whether a closed election's result files itself with the minutes.
 *
 * On, a certified result goes into the minutes of the meeting the election was
 * held at: when the election closes if those minutes exist, otherwise when they
 * are made. Minutes already circulated or adopted take it as a permanent,
 * dated addendum. Off, a manager imports results by hand from the minutes page,
 * exactly as before.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { MinutesSettingsPanelProps } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

export const ElectionFilingPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const [enabled, setEnabled] = useState(settings.auto_file_election_results);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(settings.auto_file_election_results);
  }, [settings.auto_file_election_results]);

  const save = async () => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ minutes: { auto_file_election_results: enabled } });
      await onSaved();
      toast.success('Election filing saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the election filing setting'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-theme-text-secondary text-sm">
        Only elections tied to a meeting, through its calendar event or meeting record, are filed. The copy is taken
        when the election closes and does not change if the election is annotated later.
        {!canEdit && ' This is changed by a settings administrator.'}
      </p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="form-checkbox mt-0.5"
          checked={enabled}
          disabled={!canEdit || saving}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="text-theme-text-primary block text-sm font-medium">
            File election results with the meeting&apos;s minutes
          </span>
          <span className="text-theme-text-secondary block text-xs">
            Filed when the election closes, or when the minutes are made if it closed first. Minutes already circulated
            or adopted take it as a permanent addendum, labelled as one on screen, in print and in the published copy.
            Turn this off to import results by hand.
          </span>
        </span>
      </label>
      <SettingsSaveBar canEdit={canEdit} dirty={enabled !== settings.auto_file_election_results} saving={saving} />
    </form>
  );
};

export default ElectionFilingPanel;
