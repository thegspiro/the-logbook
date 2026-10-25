/**
 * Sign a walk-in guest in by hand from the event page.
 *
 * At an event that adds its guests to the prospective members pipeline, the
 * kiosk signs in only applicants it already recognises and sends everyone else
 * to staff. This is where staff then sign them in: the guest is entered and
 * checked in in one step, and the check-in opens (or links) their application
 * when the event feeds the pipeline and an email was given.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { eventService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';

interface AddGuestModalProps {
  isOpen: boolean;
  eventId: string;
  /** The event's "Add guests to the prospective members pipeline" switch. */
  addsGuestsToPipeline: boolean;
  onClose: () => void;
  /** Called whenever a guest row was written, even if the check-in then failed. */
  onSaved: () => void;
}

export const AddGuestModal: React.FC<AddGuestModalProps> = ({
  isOpen,
  eventId,
  addsGuestsToPipeline,
  onClose,
  onSaved,
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form on every open, so one guest's details cannot be filed
  // against the next person at the door.
  useEffect(() => {
    if (isOpen) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setError(null);
    }
  }, [isOpen]);

  const canSave = Boolean(firstName.trim() && lastName.trim()) && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const name = `${firstName.trim()} ${lastName.trim()}`;
    setSaving(true);
    setError(null);

    let attendeeId: string;
    try {
      const created = await eventService.addExternalAttendee(eventId, {
        name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      attendeeId = created.id;
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'The guest could not be added.'));
      setSaving(false);
      return;
    }

    try {
      const result = await eventService.checkInExternalAttendee(eventId, attendeeId);
      toast.success(result.prospect_id ? `${name} signed in and linked to their application.` : `${name} signed in.`);
      onSaved();
      onClose();
    } catch (err: unknown) {
      // The guest row exists; the list shows them as not signed in, with a
      // button to retry, rather than this form inviting a duplicate entry.
      toast.error(getErrorMessage(err, `${name} was added but could not be signed in.`));
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add guest"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" disabled={!canSave} className="btn-primary">
            {saving ? 'Signing in...' : 'Add and sign in'}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          {addsGuestsToPipeline
            ? 'With an email, a visitor who is not yet an applicant gets an application opened in the prospective members pipeline.'
            : 'The guest is listed on this event and not counted in member attendance.'}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-guest-first-name" className="form-label">
              First name <span className="text-red-600">*</span>
            </label>
            <input
              id="add-guest-first-name"
              type="text"
              required
              maxLength={100}
              autoComplete="off"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="add-guest-last-name" className="form-label">
              Last name <span className="text-red-600">*</span>
            </label>
            <input
              id="add-guest-last-name"
              type="text"
              required
              maxLength={100}
              autoComplete="off"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="form-input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="add-guest-email" className="form-label">
            Email
          </label>
          <input
            id="add-guest-email"
            type="email"
            maxLength={255}
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input"
          />
        </div>

        <div>
          <label htmlFor="add-guest-phone" className="form-label">
            Phone
          </label>
          <input
            id="add-guest-phone"
            type="tel"
            maxLength={20}
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="form-input"
          />
        </div>

        {error && (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default AddGuestModal;
