import React from 'react';
import type { ContactInfoUpdate, NotificationPreferences } from '../../types/user';

interface ContactInfoSectionProps {
  user: {
    email?: string | undefined;
    phone?: string | undefined;
    mobile?: string | undefined;
  };
  canEdit: boolean;
  isEditing: boolean;
  saving: boolean;
  error: string | null;
  editForm: ContactInfoUpdate;
  onEditClick: () => void;
  onCancelEdit: () => void;
  onSaveContact: () => Promise<void>;
  onFormChange: (field: keyof ContactInfoUpdate, value: string) => void;
  onNotificationToggle: (type: keyof NotificationPreferences) => void;
}

const ContactInfoSection: React.FC<ContactInfoSectionProps> = ({
  user,
  canEdit,
  isEditing,
  saving,
  error,
  editForm,
  onEditClick,
  onCancelEdit,
  onSaveContact,
  onFormChange,
  onNotificationToggle,
}) => {
  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-lg font-semibold">Contact Information</h2>
        {canEdit && !isEditing && (
          <button
            onClick={onEditClick}
            className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-3">
          {user.email && (
            <div>
              <p className="text-theme-text-muted text-xs font-medium uppercase">Email</p>
              <p className="text-theme-text-primary mt-1 text-sm">{user.email}</p>
            </div>
          )}
          {user.phone && (
            <div>
              <p className="text-theme-text-muted text-xs font-medium uppercase">Phone</p>
              <p className="text-theme-text-primary mt-1 text-sm">{user.phone}</p>
            </div>
          )}
          {user.mobile && (
            <div>
              <p className="text-theme-text-muted text-xs font-medium uppercase">Mobile</p>
              <p className="text-theme-text-primary mt-1 text-sm">{user.mobile}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => onFormChange('email', e.target.value)}
              className="form-input border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Phone</label>
            <input
              type="tel"
              value={editForm.phone}
              onChange={(e) => onFormChange('phone', e.target.value)}
              className="form-input border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Mobile</label>
            <input
              type="tel"
              value={editForm.mobile}
              onChange={(e) => onFormChange('mobile', e.target.value)}
              className="form-input border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            />
          </div>

          <div className="border-theme-surface-border border-t pt-4">
            <label className="text-theme-text-muted mb-3 block text-xs font-medium uppercase">
              Notification Preferences
            </label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editForm.notification_preferences?.email}
                  onChange={() => onNotificationToggle('email')}
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="text-theme-text-secondary ml-2 text-sm">Email notifications</span>
              </label>
              <label className="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editForm.notification_preferences?.sms_notifications}
                  onChange={() => onNotificationToggle('sms_notifications')}
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="text-theme-text-secondary ml-2 text-sm">Urgent text messages</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              onClick={() => {
                void onSaveContact();
              }}
              disabled={saving}
              className="btn-info flex-1 rounded-md text-sm font-medium disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={onCancelEdit}
              disabled={saving}
              className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex-1 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          {error && <div className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
};

export default ContactInfoSection;
