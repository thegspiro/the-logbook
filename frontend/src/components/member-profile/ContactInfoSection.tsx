import React from "react";
import type {
  ContactInfoUpdate,
  NotificationPreferences,
} from "../../types/user";

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
    <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-theme-text-primary">
          Contact Information
        </h2>
        {canEdit && !isEditing && (
          <button
            onClick={onEditClick}
            className="text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-3">
          {user.email && (
            <div>
              <p className="text-xs text-theme-text-muted uppercase font-medium">
                Email
              </p>
              <p className="text-sm text-theme-text-primary mt-1">
                {user.email}
              </p>
            </div>
          )}
          {user.phone && (
            <div>
              <p className="text-xs text-theme-text-muted uppercase font-medium">
                Phone
              </p>
              <p className="text-sm text-theme-text-primary mt-1">
                {user.phone}
              </p>
            </div>
          )}
          {user.mobile && (
            <div>
              <p className="text-xs text-theme-text-muted uppercase font-medium">
                Mobile
              </p>
              <p className="text-sm text-theme-text-primary mt-1">
                {user.mobile}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
              Email
            </label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) =>
                onFormChange("email", e.target.value)
              }
              className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={editForm.phone}
              onChange={(e) =>
                onFormChange("phone", e.target.value)
              }
              className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
              Mobile
            </label>
            <input
              type="tel"
              value={editForm.mobile}
              onChange={(e) =>
                onFormChange("mobile", e.target.value)
              }
              className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>

          <div className="pt-4 border-t border-theme-surface-border">
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-3">
              Notification Preferences
            </label>
            <div className="space-y-2">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.notification_preferences?.email}
                  onChange={() => onNotificationToggle("email")}
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="ml-2 text-sm text-theme-text-secondary">
                  Email notifications
                </span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.notification_preferences?.sms}
                  onChange={() => onNotificationToggle("sms")}
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="ml-2 text-sm text-theme-text-secondary">
                  SMS notifications
                </span>
              </label>
              <label className="flex items-center cursor-not-allowed opacity-50">
                <input
                  type="checkbox"
                  checked={false}
                  disabled
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="ml-2 text-sm text-theme-text-secondary">
                  Push notifications
                  <span className="ml-1 text-xs text-theme-text-muted">(coming soon)</span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              onClick={() => {
                void onSaveContact();
              }}
              disabled={saving}
              className="btn-info disabled:cursor-not-allowed flex-1 font-medium rounded-md text-sm"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={onCancelEdit}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-theme-surface text-theme-text-secondary text-sm font-medium border border-theme-surface-border rounded-md hover:bg-theme-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          {error && (
            <div className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContactInfoSection;
