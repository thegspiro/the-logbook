import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactInfoSection from './ContactInfoSection';
import type { ContactInfoUpdate } from '../../types/user';

const onNotificationToggle = vi.fn();

const editForm: ContactInfoUpdate = {
  email: 'member@fd.example',
  phone: '555-0100',
  mobile: '555-0101',
  notification_preferences: {
    email_notifications: true,
    sms_notifications: true,
    event_reminders: true,
    training_reminders: true,
  },
};

const renderSection = (smsConsentGranted: boolean | null) =>
  render(
    <ContactInfoSection
      user={{ email: 'member@fd.example', phone: '555-0100', mobile: '555-0101' }}
      canEdit
      isEditing
      saving={false}
      error={null}
      editForm={editForm}
      onEditClick={vi.fn()}
      onCancelEdit={vi.fn()}
      onSaveContact={vi.fn()}
      onFormChange={vi.fn()}
      onNotificationToggle={onNotificationToggle}
      smsConsentGranted={smsConsentGranted}
    />
  );

const smsCheckbox = () => screen.getByRole('checkbox', { name: /urgent text messages/i });

describe('ContactInfoSection notification preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the email_notifications key, the one every sender reads', async () => {
    // Regression: this checkbox used to write a separate `email` key that only
    // certification alerts consulted, so unchecking it looked like a master
    // switch and suppressed almost nothing.
    const user = userEvent.setup();
    renderSection(true);

    await user.click(screen.getByRole('checkbox', { name: /email notifications/i }));

    expect(onNotificationToggle).toHaveBeenCalledWith('email_notifications');
  });

  describe('SMS, which staff can mute but never grant', () => {
    it('is editable and reflects the preference once consent is on record', () => {
      renderSection(true);

      expect(smsCheckbox()).toBeEnabled();
      expect(smsCheckbox()).toBeChecked();
      expect(screen.queryByText(/no text-message consent on record/i)).not.toBeInTheDocument();
    });

    it('reads as off and locked when the member never consented', async () => {
      // No preference set here can switch texts on for a member without
      // consent, so an editable box would be a lie about what saving does.
      const user = userEvent.setup();
      renderSection(false);

      expect(smsCheckbox()).toBeDisabled();
      expect(smsCheckbox()).not.toBeChecked();
      expect(screen.getByText(/no text-message consent on record/i)).toBeInTheDocument();

      await user.click(smsCheckbox());
      expect(onNotificationToggle).not.toHaveBeenCalled();
    });

    it('claims nothing about consent it could not read', () => {
      // null is "unknown", not "refused": stay locked, but do not tell staff
      // the member declined when the request simply failed.
      renderSection(null);

      expect(smsCheckbox()).toBeDisabled();
      expect(screen.queryByText(/no text-message consent on record/i)).not.toBeInTheDocument();
    });
  });
});
