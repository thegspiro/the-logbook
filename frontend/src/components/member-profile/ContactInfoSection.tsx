import React from 'react';
import type {
  ContactInfoSettings,
  ContactInfoUpdate,
  NotificationPreferences,
  ProfileVisibility,
  ProfileVisibilityField,
} from '../../types/user';
import { VisibilityControl } from './VisibilityControl';
import { SaveStatusPill, type SaveState } from '../settings/SaveStatusPill';
import { orgHidesField } from '../../utils/profileVisibility';

interface ContactInfoSectionProps {
  user: {
    email?: string | undefined;
    phone?: string | undefined;
    mobile?: string | undefined;
    personal_email?: string | undefined;
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
  /**
   * Whether this member has SMS consent on record. Read-only here: consent is
   * the member's own TCPA record, so staff can see it but never set it.
   * `null` while it is still loading or could not be read.
   */
  smsConsentGranted: boolean | null;
  /**
   * Who-can-see-this markers. `toggle` for the member on their own profile,
   * `badge` for a members-manager reading someone else's, `none` (default)
   * for everyone else and for callers that predate the control.
   */
  visibilityMode?: 'toggle' | 'badge' | 'none' | undefined;
  visibility?: ProfileVisibility | null | undefined;
  /**
   * False until the stored choice is on hand. Switches stay disabled until
   * then: a save built on the defaults would overwrite a hidden field.
   */
  visibilityReady?: boolean | undefined;
  /** The stored choice could not be read; shown with a retry in toggle mode. */
  visibilityLoadError?: boolean | undefined;
  /** The field whose save is in flight, so only its switch is disabled. */
  visibilitySaving?: ProfileVisibilityField | null | undefined;
  visibilitySaveState?: SaveState | undefined;
  /**
   * The department's contact-visibility ceiling over the three work fields.
   * `null` when unknown; the markers then show the member's choice alone.
   */
  orgVisibility?: ContactInfoSettings | null | undefined;
  onVisibilityChange?: ((field: ProfileVisibilityField, next: boolean) => void) | undefined;
  onVisibilityRetry?: (() => void) | undefined;
}

interface ContactRow {
  field: ProfileVisibilityField;
  label: string;
  value: string | undefined;
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
  smsConsentGranted,
  visibilityMode = 'none',
  visibility,
  visibilityReady = true,
  visibilityLoadError = false,
  visibilitySaving,
  visibilitySaveState,
  orgVisibility,
  onVisibilityChange,
  onVisibilityRetry,
}) => {
  const rows: ContactRow[] = [
    { field: 'email', label: 'Email', value: user.email },
    { field: 'personal_email', label: 'Personal email', value: user.personal_email },
    { field: 'phone', label: 'Phone', value: user.phone },
    { field: 'mobile', label: 'Mobile', value: user.mobile },
  ];
  const showMarkers = visibilityMode !== 'none' && Boolean(visibility);
  const visibleRows = rows.filter((row) => row.value);

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-theme-text-primary text-lg font-semibold">Contact Information</h2>
        <div className="flex items-center gap-3">
          {visibilityMode === 'toggle' && visibilitySaveState && <SaveStatusPill state={visibilitySaveState} />}
          {canEdit && !isEditing && (
            <button
              onClick={onEditClick}
              className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div className="space-y-3">
          {visibleRows.length === 0 && <p className="text-theme-text-muted text-sm">No contact details shared.</p>}
          {visibleRows.map((row) => (
            <div key={row.field} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-theme-text-muted text-xs font-medium uppercase">{row.label}</p>
                <p className="text-theme-text-primary mt-1 text-sm break-words">{row.value}</p>
              </div>
              {showMarkers && visibility && (
                <VisibilityControl
                  field={row.field}
                  label={row.label}
                  visible={visibility[row.field]}
                  mode={visibilityMode === 'badge' ? 'badge' : 'toggle'}
                  orgHidden={orgHidesField(row.field, orgVisibility)}
                  disabled={!visibilityReady || visibilitySaving === row.field}
                  onChange={(next) => onVisibilityChange?.(row.field, next)}
                />
              )}
            </div>
          ))}
          {visibilityMode === 'toggle' && visibilityLoadError && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              Couldn&apos;t load what you currently share, so the switches are off until it loads.{' '}
              {onVisibilityRetry && (
                <button type="button" onClick={onVisibilityRetry} className="font-medium underline underline-offset-2">
                  Try again
                </button>
              )}
            </p>
          )}
          {visibilityMode === 'toggle' && (
            <p className="text-theme-text-muted pt-1 text-xs">
              Leadership can always see everything. The department can also turn email, phone and mobile off for
              everyone.
            </p>
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
              className="form-input px-3 text-sm"
            />
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Phone</label>
            <input
              type="tel"
              value={editForm.phone}
              onChange={(e) => onFormChange('phone', e.target.value)}
              className="form-input px-3 text-sm"
            />
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Mobile</label>
            <input
              type="tel"
              value={editForm.mobile}
              onChange={(e) => onFormChange('mobile', e.target.value)}
              className="form-input px-3 text-sm"
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
                  checked={editForm.notification_preferences?.email_notifications ?? true}
                  onChange={() => onNotificationToggle('email_notifications')}
                  className="form-checkbox border-theme-surface-border"
                />
                <span className="text-theme-text-secondary ml-2 text-sm">Email notifications</span>
              </label>
              {/* Disabled without consent on record, because there it would do
                nothing: the send path checks the member's TCPA consent, and no
                preference set here can switch texts on for a member who never
                granted it. Staff can still mute a consenting member. */}
              <label
                className={`flex items-center ${smsConsentGranted === true ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                <input
                  type="checkbox"
                  checked={(editForm.notification_preferences?.sms_notifications ?? true) && smsConsentGranted === true}
                  disabled={smsConsentGranted !== true}
                  onChange={() => onNotificationToggle('sms_notifications')}
                  className="form-checkbox border-theme-surface-border disabled:opacity-50"
                />
                <span className="text-theme-text-secondary ml-2 text-sm">
                  Urgent text messages (in addition to email)
                </span>
              </label>
              {smsConsentGranted === false && (
                <p className="text-theme-text-muted text-sm">
                  No text-message consent on record. Texts will not send until this member turns them on themselves
                  under Settings → Notifications — consent has to come from them, not from staff.
                </p>
              )}
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
              className="btn-secondary text-theme-text-secondary flex-1 text-sm font-medium"
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
