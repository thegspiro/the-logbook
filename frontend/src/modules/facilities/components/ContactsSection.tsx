/**
 * ContactsSection — Emergency contacts for a single facility.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, Loader2, Pencil, Save, Phone, Mail, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type {
  EmergencyContact,
  EmergencyContactCreate,
  EmergencyContactUpdate,
} from '../../../services/facilitiesServices';
import { enumLabel } from '../types';
import { inputCls, labelCls, CONTACT_TYPE_OPTIONS } from '../constants';
import { blankToNull } from '../../../utils/formValues';
import { FormField } from '../../../components/ux/FormField';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { useConfirm } from '../../../contexts/ConfirmContext';

interface ContactForm {
  contact_type: string;
  company_name: string;
  contact_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  service_contract_number: string;
  priority: string;
}

type ContactField = keyof ContactForm;

const EMPTY_FORM: ContactForm = {
  contact_type: 'other',
  company_name: '',
  contact_name: '',
  phone: '',
  alt_phone: '',
  email: '',
  service_contract_number: '',
  priority: '',
};

/**
 * How the emergency-contact endpoints' field names land on this form (forms
 * review F-2); `max_length`s from `FacilityEmergencyContactBase`. The schema
 * takes camelCase and snake_case both. Ordered as on screen, so the first
 * refusal takes focus.
 */
const CONTACT_FIELDS: Record<ContactField, ServerFieldSpec & { id: string }> = {
  contact_type: { label: 'Type', id: 'facility-contact-type' },
  company_name: { label: 'Company name', maxLength: 200, id: 'facility-contact-company' },
  contact_name: { label: 'Contact name', maxLength: 200, id: 'facility-contact-name' },
  phone: { label: 'Phone', maxLength: 50, id: 'facility-contact-phone' },
  alt_phone: { label: 'Alternate phone', maxLength: 50, id: 'facility-contact-alt-phone' },
  email: { label: 'Email', maxLength: 200, id: 'facility-contact-email' },
  service_contract_number: { label: 'Contract #', maxLength: 100, id: 'facility-contact-contract' },
  priority: { label: 'Priority', id: 'facility-contact-priority' },
};

interface Props {
  facilityId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export default function ContactsSection({ facilityId, canCreate, canEdit, canDelete }: Props) {
  const { confirm } = useConfirm();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<ContactForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});

  const up = (k: ContactField, v: string) => {
    setFormData((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<ContactField, string>>) => {
    setErrors(next);
    const first = (Object.keys(CONTACT_FIELDS) as ContactField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(CONTACT_FIELDS[first].id)?.focus(), 0);
  };

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getEmergencyContacts({ facility_id: facilityId });
      setContacts(data);
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setErrors({});
    setEditingContact(null);
    setShowForm(false);
  };

  const openEdit = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setFormData({
      contact_type: contact.contactType || 'other',
      company_name: contact.companyName || '',
      contact_name: contact.contactName || '',
      phone: contact.phone || '',
      alt_phone: contact.altPhone || '',
      email: contact.email || '',
      service_contract_number: contact.serviceContractNumber || '',
      priority: contact.priority != null ? String(contact.priority) : '',
    });
    setErrors({});
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<ContactField, string>> = {};
    if (!formData.company_name.trim() && !formData.contact_name.trim()) {
      missing.company_name = 'Enter a company name or a contact name.';
    }
    // A new contact is not added until it is fixed. An edit saves the rest
    // and keeps the stored names (below); the backend re-checks the rule
    // against the merged row.
    if (!editingContact && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setIsSaving(true);
    try {
      if (editingContact) {
        // Update: send every field the form owns, with an explicit null for
        // the blank ones, or clearing a field silently does nothing (the
        // backend applies update payloads with exclude_unset).
        const payload: EmergencyContactUpdate = {
          contact_type: formData.contact_type,
          company_name: blankToNull(formData.company_name),
          contact_name: blankToNull(formData.contact_name),
          phone: blankToNull(formData.phone),
          alt_phone: blankToNull(formData.alt_phone),
          email: blankToNull(formData.email),
          service_contract_number: blankToNull(formData.service_contract_number),
        };
        if (formData.priority) payload.priority = Number(formData.priority);
        // Single-save rule (owner, 2026-11-05): a refused value's key is left
        // out, which the backend reads as "leave alone", so its stored value
        // is kept while the rest saves, and the field stays flagged.
        let refused: Partial<Record<ContactField, string>> = { ...missing };
        // Both names are cleared together or neither is: holding back one
        // blank name alone would still send the other as null.
        if (refused.company_name) refused.contact_name = refused.company_name;
        const send = (skip: Partial<Record<ContactField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return facilitiesService.updateEmergencyContact(editingContact.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, CONTACT_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          // The list refreshes behind the form, which stays open with the
          // refused fields flagged.
          void loadContacts();
          const shown = { ...refused };
          if (missing.company_name) delete shown.contact_name;
          showErrors(shown);
          const first = (Object.keys(CONTACT_FIELDS) as ContactField[]).find((k) => shown[k]);
          if (first) {
            toast.error(
              `Contact saved, except ${CONTACT_FIELDS[first].label.toLowerCase()}: ${shown[first] ?? ''} Fix it and save again.`
            );
          }
          return;
        }
        toast.success('Contact updated');
      } else {
        // Create: omit the blanks so "" never reaches a Pydantic validator.
        const payload: EmergencyContactCreate = {
          facility_id: facilityId,
          contact_type: formData.contact_type,
        };
        if (formData.company_name.trim()) payload.company_name = formData.company_name.trim();
        if (formData.contact_name.trim()) payload.contact_name = formData.contact_name.trim();
        if (formData.phone.trim()) payload.phone = formData.phone.trim();
        if (formData.alt_phone.trim()) payload.alt_phone = formData.alt_phone.trim();
        if (formData.email.trim()) payload.email = formData.email.trim();
        if (formData.service_contract_number.trim())
          payload.service_contract_number = formData.service_contract_number.trim();
        if (formData.priority) payload.priority = Number(formData.priority);
        await facilitiesService.createEmergencyContact(payload);
        toast.success('Contact added');
      }
      resetForm();
      void loadContacts();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new contact is not added until it is fixed.
      const mapped = mapServerFieldErrors(err, CONTACT_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save contact'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (contact: EmergencyContact) => {
    if (
      !(await confirm({
        title: 'Delete contact',
        message: `Delete "${contact.companyName || contact.contactName}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteEmergencyContact(contact.id);
      toast.success('Contact deleted');
      void loadContacts();
    } catch {
      toast.error('Failed to delete contact');
    }
  };

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          Emergency Contacts {!isLoading && `(${contacts.length})`}
        </h2>
        {canCreate && (
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add Contact
          </button>
        )}
      </div>

      <div className="p-4">
        {showForm && (editingContact ? canEdit : canCreate) && (
          <form
            onSubmit={(e) => void handleSave(e)}
            noValidate
            className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4"
          >
            <h3 className="text-theme-text-primary text-sm font-medium">
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField
                label="Type"
                labelClassName={labelCls}
                id={CONTACT_FIELDS.contact_type.id}
                error={errors.contact_type}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.contact_type}
                    onChange={(e) => up('contact_type', e.target.value)}
                    className={inputCls}
                  >
                    {CONTACT_TYPE_OPTIONS.map((ct) => (
                      <option key={ct} value={ct}>
                        {enumLabel(ct)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              {(
                [
                  ['company_name', 'Company Name', 'text', 'off'],
                  ['contact_name', 'Contact Name', 'text', 'off'],
                  ['phone', 'Phone', 'tel', 'off'],
                  ['alt_phone', 'Alternate Phone', 'tel', 'off'],
                  ['email', 'Email', 'email', 'off'],
                  ['service_contract_number', 'Contract #', 'text', 'off'],
                ] as const
              ).map(([key, label, type, autoComplete]) => (
                <FormField
                  key={key}
                  label={label}
                  labelClassName={labelCls}
                  id={CONTACT_FIELDS[key].id}
                  error={errors[key]}
                  maxLength={CONTACT_FIELDS[key].maxLength}
                  count={formData[key].length}
                  hint={key === 'company_name' ? 'A company name or a contact name is needed.' : undefined}
                >
                  {(field) => (
                    <input
                      {...field}
                      type={type}
                      autoComplete={autoComplete}
                      value={formData[key]}
                      onChange={(e) => up(key, e.target.value)}
                      className={inputCls}
                    />
                  )}
                </FormField>
              ))}
              <FormField
                label="Priority (1 = highest)"
                labelClassName={labelCls}
                id={CONTACT_FIELDS.priority.id}
                error={errors.priority}
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={formData.priority}
                    onChange={(e) => up('priority', e.target.value)}
                    min="1"
                    className={inputCls}
                  />
                )}
              </FormField>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingContact ? 'Save Changes' : 'Save Contact'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-8 text-center">
            <Users className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No emergency contacts recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="bg-theme-surface-hover/30 group flex items-center justify-between rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="text-theme-text-muted h-4 w-4" />
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">
                      {contact.companyName || contact.contactName || 'Unnamed contact'}
                    </p>
                    <div className="text-theme-text-muted flex items-center gap-3 text-xs">
                      <span>{enumLabel(contact.contactType)}</span>
                      {contact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </span>
                      )}
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.priority != null && (
                        <span className={contact.priority === 1 ? 'font-medium text-red-500' : ''}>
                          Priority {contact.priority}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                    {canEdit && (
                      <button
                        onClick={() => openEdit(contact)}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                        aria-label={`Edit ${contact.companyName || contact.contactName || 'contact'}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => {
                          void handleDelete(contact);
                        }}
                        className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                        aria-label={`Delete ${contact.companyName || contact.contactName || 'contact'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
