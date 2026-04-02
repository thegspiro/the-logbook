import React from "react";
import type { EmergencyContact } from "../../types/user";

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
  onContactChange: (
    index: number,
    field: keyof EmergencyContact,
    value: string | boolean,
  ) => void;
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
    <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-theme-text-primary">
          Emergency Contacts
        </h2>
        {canEdit && !editingContacts && (
          <button
            onClick={onEditEmergencyContacts}
            className="text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            Edit
          </button>
        )}
      </div>
      {!editingContacts ? (
        <div className="space-y-3">
          {user.emergency_contacts &&
          user.emergency_contacts.length > 0 ? (
            user.emergency_contacts.map((ec, i) => (
              <div
                key={i}
                className="border border-theme-surface-border rounded-lg p-3"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-theme-text-primary">
                    {ec.name}
                  </p>
                  {ec.is_primary && (
                    <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400 rounded-sm">
                      Primary
                    </span>
                  )}
                </div>
                <p className="text-xs text-theme-text-secondary mt-1">
                  {ec.relationship}
                </p>
                <p className="text-xs text-theme-text-secondary">
                  {ec.phone}
                </p>
                {ec.email && (
                  <p className="text-xs text-theme-text-secondary">
                    {ec.email}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-theme-text-muted">
              No emergency contacts on file.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {contactsForm.map((ec, i) => (
            <div
              key={i}
              className="border border-theme-surface-border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-theme-text-muted">
                  Contact {i + 1}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ec.is_primary}
                      onChange={(e) =>
                        onContactChange(
                          i,
                          "is_primary",
                          e.target.checked,
                        )
                      }
                      className="h-3 w-3 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border rounded-sm"
                    />
                    Primary
                  </label>
                  {contactsForm.length > 1 && (
                    <button
                      onClick={() => onRemoveContact(i)}
                      className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Name *"
                  value={ec.name}
                  onChange={(e) =>
                    onContactChange(i, "name", e.target.value)
                  }
                  className="px-2 py-1.5 border border-theme-surface-border rounded-sm text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <input
                  type="text"
                  placeholder="Relationship"
                  value={ec.relationship}
                  onChange={(e) =>
                    onContactChange(
                      i,
                      "relationship",
                      e.target.value,
                    )
                  }
                  className="px-2 py-1.5 border border-theme-surface-border rounded-sm text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="tel"
                  placeholder="Phone *"
                  value={ec.phone}
                  onChange={(e) =>
                    onContactChange(i, "phone", e.target.value)
                  }
                  className="px-2 py-1.5 border border-theme-surface-border rounded-sm text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={ec.email || ""}
                  onChange={(e) =>
                    onContactChange(i, "email", e.target.value)
                  }
                  className="px-2 py-1.5 border border-theme-surface-border rounded-sm text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
              </div>
            </div>
          ))}
          <button
            onClick={onAddContact}
            className="w-full px-3 py-2 text-sm text-blue-700 dark:text-blue-400 border border-dashed border-theme-surface-border rounded-md hover:bg-theme-surface-hover"
          >
            + Add Contact
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void onSaveEmergencyContacts();
              }}
              disabled={savingContacts}
              className="btn-info flex-1 font-medium rounded-md text-sm"
            >
              {savingContacts ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onCancelEditContacts}
              disabled={savingContacts}
              className="flex-1 px-4 py-2 bg-theme-surface text-theme-text-secondary text-sm font-medium border border-theme-surface-border rounded-md hover:bg-theme-surface-hover disabled:opacity-50"
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
