/**
 * How the department wants attendance listed on its minutes.
 *
 * The roll is always recorded in full: quorum and the attendance reports read
 * it. This only decides which statuses a reader of the minutes, the printed
 * copy, the published library copy and the public copy are shown. A set of
 * minutes can override it for itself. The value shown is what the server
 * applies (`GET /minutes-records/settings`); writing goes through the
 * organization settings and needs `settings.manage`.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { organizationService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { AttendanceListing } from '../types/minutes';
import { ATTENDANCE_LISTINGS, ATTENDANCE_LISTING_LABELS } from '../utils/attendance';

interface AttendanceListingDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const HELP: Record<AttendanceListing, string> = {
  present: 'Names who attended, including guests. Excused and absent members are not named.',
  present_excused: 'Names who attended, and who sent their regrets. Unexcused absences are not named.',
  all: 'Names every member with their status, as minutes have always done.',
};

export const AttendanceListingDialog: React.FC<AttendanceListingDialogProps> = ({ isOpen, onClose }) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');

  const [loaded, setLoaded] = useState<AttendanceListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState<AttendanceListing>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoaded(null);
    setLoadError(null);
    minutesService
      .getReminderSettings()
      .then((settings) => {
        setLoaded(settings.attendance_listing);
        setValue(settings.attendance_listing);
      })
      .catch((err: unknown) => setLoadError(getErrorMessage(err, 'Failed to load the attendance setting')));
  }, [isOpen]);

  const save = async () => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ minutes: { attendance_listing: value } });
      // Re-read rather than trusting what was sent, so the screen shows what the server applies.
      const settings = await minutesService.getReminderSettings();
      setLoaded(settings.attendance_listing);
      setValue(settings.attendance_listing);
      toast.success('Attendance setting saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the attendance setting'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="How attendance is listed"
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
            <button type="submit" disabled={saving || loaded === null || value === loaded} className="btn-primary">
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
      {loaded === null && !loadError && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {loaded !== null && (
        <fieldset className="space-y-3" disabled={!canEdit || saving}>
          <legend className="text-theme-text-secondary mb-2 text-sm">
            Every member&apos;s status is still recorded, because quorum and the attendance reports need it. This
            chooses who the minutes name, on screen, in the printed copy, in the library copy and on the public page.
            One set of minutes can choose differently for itself.
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
      )}
    </Modal>
  );
};

export default AttendanceListingDialog;
