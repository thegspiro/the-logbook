import React from 'react';
import type { EmergencyContact } from '../../types/user';

interface EmergencyContactsSectionProps {
  user: {
    emergency_contacts?: EmergencyContact[] | undefined;
  };
  canEdit: boolean;
  editingContacts: boolean;
  savingContacts: boolean;
  error: string | null;
  contactsForm: EmergencyContact[];
  onEditEmergencyContacts: () => void;
  onSaveEmergencyContacts: () => Promise<void>;
  onCancelEditContacts: () => void;
  onAddContact: () => void;
  onRemoveContact: (index: number) => void;
  onContactChange: (index: number, field: keyof EmergencyContact, value: string | boolean) => void;
}

const EmergencyContactsSection: React.FC<EmergencyContactsSectionProps> = ({
  user,
  canEdit,
  editingContacts,
  savingContacts,
  error,
  contactsForm,
  onEditEmergencyContacts,
  onSaveEmergencyContacts,
  onCancelEditContacts,
  onAddContact,
  onRemoveContact,
  onContactChange,
}) => {
  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-lg font-semibold">Emergency Contacts</h2>
        {canEdit && !editingContacts && (
          <button
            onClick={onEditEmergencyContacts}
            className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Edit
          </button>
        )}
      </div>
      {!editingContacts ? (
        <div className="space-y-3">
          {user.emergency_contacts && user.emergency_contacts.length > 0 ? (
            user.emergency_contacts.map((ec, i) => (
              <div key={i} className="border-theme-surface-border rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="text-theme-text-primary text-sm font-medium">{ec.name}</p>
                  {ec.is_primary && (
                    <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                      Primary
                    </span>
                  )}
                </div>
                <p className="text-theme-text-secondary mt-1 text-xs">{ec.relationship}</p>
                <p className="text-theme-text-secondary text-xs">{ec.phone}</p>
                {ec.email && <p className="text-theme-text-secondary text-xs">{ec.email}</p>}
              </div>
            ))
          ) : (
            <p className="text-theme-text-muted text-sm">No emergency contacts on file.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {contactsForm.map((ec, i) => (
            <div key={i} className="border-theme-surface-border space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted text-xs font-medium">Contact {i + 1}</span>
                <div className="flex items-center gap-2">
                  <label className="text-theme-text-secondary flex cursor-pointer items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={ec.is_primary}
                      onChange={(e) => onContactChange(i, 'is_primary', e.target.checked)}
                      className="focus:ring-theme-focus-ring border-theme-surface-border h-3 w-3 rounded-sm text-blue-600"
                    />
                    Primary
                  </label>
                  {contactsForm.length > 1 && (
                    <button
                      onClick={() => onRemoveContact(i)}
                      className="text-xs text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Name *"
                  value={ec.name}
                  onChange={(e) => onContactChange(i, 'name', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring rounded-sm border px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
                />
                <input
                  type="text"
                  placeholder="Relationship"
                  value={ec.relationship}
                  onChange={(e) => onContactChange(i, 'relationship', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring rounded-sm border px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="tel"
                  placeholder="Phone *"
                  value={ec.phone}
                  onChange={(e) => onContactChange(i, 'phone', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring rounded-sm border px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={ec.email || ''}
                  onChange={(e) => onContactChange(i, 'email', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring rounded-sm border px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
            </div>
          ))}
          <button
            onClick={onAddContact}
            className="border-theme-surface-border hover:bg-theme-surface-hover w-full rounded-md border border-dashed px-3 py-2 text-sm text-blue-700 dark:text-blue-400"
          >
            + Add Contact
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void onSaveEmergencyContacts();
              }}
              disabled={savingContacts}
              className="btn-info flex-1 rounded-md text-sm font-medium"
            >
              {savingContacts ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onCancelEditContacts}
              disabled={savingContacts}
              className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex-1 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error && <div className="text-sm text-red-700 dark:text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
};

export default EmergencyContactsSection;
