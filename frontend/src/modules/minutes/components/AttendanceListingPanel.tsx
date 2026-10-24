/**
 * How the department wants attendance listed on its minutes.
 *
 * The roll is always recorded in full: quorum and the attendance reports read
 * it. This only decides which statuses a reader of the minutes, the printed
 * copy, the published library copy and the public copy are shown. A set of
 * minutes can override it for itself.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { AttendanceListing, MinutesSettingsPanelProps } from '../types/minutes';
import { ATTENDANCE_LISTINGS, ATTENDANCE_LISTING_LABELS } from '../utils/attendance';
import { SettingsSaveBar } from './SettingsSaveBar';

const HELP: Record<AttendanceListing, string> = {
  present: 'Names who attended, including guests. Excused and absent members are not named.',
  present_excused: 'Names who attended, and who sent their regrets. Unexcused absences are not named.',
  all: 'Names every member with their status, as minutes have always done.',
};

export const AttendanceListingPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const [value, setValue] = useState<AttendanceListing>(settings.attendance_listing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(settings.attendance_listing);
  }, [settings.attendance_listing]);

  const save = async () => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ minutes: { attendance_listing: value } });
      await onSaved();
      toast.success('Attendance setting saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the attendance setting'));
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
          Every member&apos;s status is still recorded, because quorum and the attendance reports need it. This chooses
          who the minutes name, on screen, in the printed copy, in the library copy and on the public page. One set of
          minutes can choose differently for itself.
          {!canEdit && ' This is changed by a settings administrator.'}
        </legend>
        {ATTENDANCE_LISTINGS.map((option) => (
          <label key={option} className="flex items-start gap-3">
            <input
              type="radio"
              name="attendance-listing"
              className="form-checkbox mt-0.5"
              checked={value === option}
              onChange={() => setValue(option)}
            />
            <span>
              <span className="text-theme-text-primary block text-sm font-medium">
                {ATTENDANCE_LISTING_LABELS[option]}
              </span>
              <span className="text-theme-text-secondary block text-xs">{HELP[option]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SettingsSaveBar canEdit={canEdit} dirty={value !== settings.attendance_listing} saving={saving} />
    </form>
  );
};

export default AttendanceListingPanel;
