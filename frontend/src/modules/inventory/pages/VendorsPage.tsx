/**
 * VendorsPage — the department's supplier list.
 *
 * A vendor is the thing an item was bought from and the people to call about
 * it: warranty claims, reorders, and repairs all start with "who did we get
 * this from". Items and reorder requests link here, so the counts on each card
 * are live purchasing history rather than a static address book.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  RefreshCw,
  Search,
  Plus,
  Truck,
  Star,
  Phone,
  Mail,
  Globe,
  MapPin,
  Users,
  Package,
  Pencil,
  Archive,
  ArchiveRestore,
  Merge,
  AlertTriangle,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useAuthStore } from '../../../stores/authStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { blankToNull } from '../../../utils/formValues';
import { isSafeExternalUrl } from '../../../utils/safeUrl';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { formatVendorAddress, primaryContact } from '../utils/vendorHelpers';
import { EmptyState } from '../../../components/ux';
import type {
  InventoryVendor,
  InventoryVendorContact,
  InventoryVendorCreate,
  InventoryVendorUpdate,
  UnlinkedVendorName,
} from '../types';

const lbl = 'form-label';
const inp = 'form-input';

interface VendorFD {
  name: string;
  account_number: string;
  website: string;
  phone: string;
  email: string;
  fax: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  payment_terms: string;
  notes: string;
  is_preferred: boolean;
  // Create only: the rep to call, entered in the same pass as the vendor.
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_phone: string;
}

const EMPTY_VENDOR: VendorFD = {
  name: '',
  account_number: '',
  website: '',
  phone: '',
  email: '',
  fax: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  payment_terms: '',
  notes: '',
  is_preferred: false,
  contact_name: '',
  contact_title: '',
  contact_email: '',
  contact_phone: '',
};

type VendorField = Exclude<keyof VendorFD, 'is_preferred'>;

/**
 * How the vendor endpoints' field names land on this dialog (forms review
 * F-2), with each `max_length` from `InventoryVendorBase` and, for the
 * primary contact, `InventoryVendorContactBase`. Ordered as on screen, so the
 * first refusal takes focus.
 */
const VENDOR_FIELDS: Record<VendorField, ServerFieldSpec & { id: string }> = {
  name: { label: 'Vendor name', maxLength: 255, id: 'vendor-name' },
  account_number: { label: 'Account number', maxLength: 100, id: 'vendor-account' },
  payment_terms: { label: 'Payment terms', maxLength: 100, id: 'vendor-terms' },
  phone: { label: 'Phone', maxLength: 50, id: 'vendor-phone' },
  email: { label: 'Email', maxLength: 255, id: 'vendor-email' },
  fax: { label: 'Fax', maxLength: 50, id: 'vendor-fax' },
  website: { label: 'Website', maxLength: 255, id: 'vendor-website' },
  address_line1: { label: 'Street address', maxLength: 255, id: 'vendor-address1' },
  address_line2: { label: 'Suite / unit', maxLength: 255, id: 'vendor-address2' },
  city: { label: 'City', maxLength: 100, id: 'vendor-city' },
  state: { label: 'State', maxLength: 100, id: 'vendor-state' },
  postal_code: { label: 'Postal code', maxLength: 20, id: 'vendor-zip' },
  country: { label: 'Country', maxLength: 100, id: 'vendor-country' },
  contact_name: { label: 'Contact name', maxLength: 255, id: 'vendor-contact-name', api: 'contacts.0.name' },
  contact_title: { label: 'Contact title', maxLength: 150, id: 'vendor-contact-title', api: 'contacts.0.title' },
  contact_email: { label: 'Contact email', maxLength: 255, id: 'vendor-contact-email', api: 'contacts.0.email' },
  contact_phone: { label: 'Contact phone', maxLength: 50, id: 'vendor-contact-phone', api: 'contacts.0.phone' },
  // `FreeText` max_length.
  notes: { label: 'Notes', maxLength: 2000, id: 'vendor-notes' },
};

/** A loose shape check, so a typo is flagged on its field before it is sent. */
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Sends an update without the keys in `skip` and, if the server refuses
 * fields this form can name, sends it again without those too. A key left out
 * is "leave alone" to the backend, so a refused field keeps its stored value
 * while the rest saves (owner rule, 2026-11-05). Returns what was held back.
 */
async function saveExcept<K extends string>(
  payload: Record<string, unknown>,
  skip: Partial<Record<K, string>>,
  fields: Record<K, ServerFieldSpec>,
  send: (rest: Record<string, unknown>) => Promise<unknown>
): Promise<Partial<Record<K, string>>> {
  const without = (held: Partial<Record<K, string>>) => {
    const rest = { ...payload };
    for (const key of Object.keys(held)) delete rest[key];
    return rest;
  };
  try {
    await send(without(skip));
    return skip;
  } catch (err) {
    const mapped = mapServerFieldErrors(err, fields);
    if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
    const refused = { ...skip, ...mapped.fieldErrors };
    await send(without(refused));
    return refused;
  }
}

// -- Create/Edit Vendor Modal --
const VendorFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** An edit saved all but a refused field: refresh behind the dialog, which stays open. */
  onSavedExcept?: () => void;
  editVendor?: InventoryVendor | null;
}> = ({ isOpen, onClose, onSaved, onSavedExcept, editVendor }) => {
  const [f, setF] = useState<VendorFD>(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<VendorField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    const seeded: VendorFD = editVendor
      ? {
          ...EMPTY_VENDOR,
          name: editVendor.name,
          account_number: editVendor.account_number ?? '',
          website: editVendor.website ?? '',
          phone: editVendor.phone ?? '',
          email: editVendor.email ?? '',
          fax: editVendor.fax ?? '',
          address_line1: editVendor.address_line1 ?? '',
          address_line2: editVendor.address_line2 ?? '',
          city: editVendor.city ?? '',
          state: editVendor.state ?? '',
          postal_code: editVendor.postal_code ?? '',
          country: editVendor.country ?? '',
          payment_terms: editVendor.payment_terms ?? '',
          notes: editVendor.notes ?? '',
          is_preferred: editVendor.is_preferred,
        }
      : EMPTY_VENDOR;
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
    // Keyed on the vendor object the page holds, not on the refreshed list, so
    // a refresh behind the dialog after a partial save does not re-seed it.
  }, [editVendor, isOpen]);

  const up = (k: keyof VendorFD, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in VENDOR_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<VendorField, string>>) => {
    setErrors(next);
    const first = (Object.keys(VENDOR_FIELDS) as VendorField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(VENDOR_FIELDS[first].id)?.focus(), 0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Partial<Record<VendorField, string>> = {};
    if (!f.name.trim()) found.name = 'Give the vendor a name.';
    if (f.email.trim() && !looksLikeEmail(f.email)) found.email = 'Enter an email address like orders@vendor.com.';
    if (!editVendor) {
      // The primary contact is only created when it has a name, so a title,
      // email or phone typed without one was dropped behind a success toast.
      const contactDetailTyped = [f.contact_title, f.contact_email, f.contact_phone].some((v) => v.trim());
      if (contactDetailTyped && !f.contact_name.trim()) {
        found.contact_name = 'Contact name is required to save a contact';
      }
      if (f.contact_email.trim() && !looksLikeEmail(f.contact_email)) {
        found.contact_email = 'Enter an email address like rep@vendor.com.';
      }
    }
    // A new vendor is not created until every flagged field is fixed; an edit
    // saves the rest and keeps the stored value of a refused one (below).
    if (!editVendor && Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setSaving(true);
    try {
      if (editVendor) {
        // Update path: blanks go as explicit nulls so clearing a field sticks
        // (CLAUDE.md pitfall #1).
        const payload: InventoryVendorUpdate = {
          name: f.name.trim(),
          account_number: blankToNull(f.account_number),
          website: blankToNull(f.website),
          phone: blankToNull(f.phone),
          email: blankToNull(f.email),
          fax: blankToNull(f.fax),
          address_line1: blankToNull(f.address_line1),
          address_line2: blankToNull(f.address_line2),
          city: blankToNull(f.city),
          state: blankToNull(f.state),
          postal_code: blankToNull(f.postal_code),
          country: blankToNull(f.country),
          payment_terms: blankToNull(f.payment_terms),
          notes: blankToNull(f.notes),
          is_preferred: f.is_preferred,
        };
        const refused = await saveExcept({ ...payload }, found, VENDOR_FIELDS, (rest) =>
          inventoryService.updateVendor(editVendor.id, rest)
        );
        if (Object.keys(refused).length > 0) {
          // Saved but for the flagged fields: the list refreshes behind the
          // dialog, which stays open, and only those fields count as unsaved.
          onSavedExcept?.();
          showErrors(refused);
          const stored = JSON.parse(baseline) as VendorFD;
          const keys = Object.keys(refused) as VendorField[];
          setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
          const first = (Object.keys(VENDOR_FIELDS) as VendorField[]).find((k) => refused[k]);
          if (first) {
            toast.error(
              `Vendor saved, except ${VENDOR_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
            );
          }
          return;
        }
        toast.success('Vendor updated');
      } else {
        const payload: InventoryVendorCreate = {
          name: f.name.trim(),
          account_number: f.account_number.trim() || undefined,
          website: f.website.trim() || undefined,
          phone: f.phone.trim() || undefined,
          email: f.email.trim() || undefined,
          fax: f.fax.trim() || undefined,
          address_line1: f.address_line1.trim() || undefined,
          address_line2: f.address_line2.trim() || undefined,
          city: f.city.trim() || undefined,
          state: f.state.trim() || undefined,
          postal_code: f.postal_code.trim() || undefined,
          country: f.country.trim() || undefined,
          payment_terms: f.payment_terms.trim() || undefined,
          notes: f.notes.trim() || undefined,
          is_preferred: f.is_preferred,
          ...(f.contact_name.trim()
            ? {
                contacts: [
                  {
                    name: f.contact_name.trim(),
                    title: f.contact_title.trim() || undefined,
                    email: f.contact_email.trim() || undefined,
                    phone: f.contact_phone.trim() || undefined,
                    is_primary: true,
                  },
                ],
              }
            : {}),
        };
        await inventoryService.createVendor(payload);
        toast.success('Vendor added');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new vendor is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, VENDOR_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save vendor'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** One text box, labelled, limited and wired to its error. */
  const text = (
    key: VendorField,
    label: string,
    extra: { type?: string; placeholder?: string; required?: boolean; className?: string; autoComplete?: string } = {}
  ) => (
    <FormField
      label={label}
      required={extra.required}
      id={VENDOR_FIELDS[key].id}
      error={errors[key]}
      maxLength={VENDOR_FIELDS[key].maxLength}
      count={f[key].length}
      className={extra.className}
    >
      {(field) => (
        <input
          {...field}
          type={extra.type ?? 'text'}
          className={inp}
          value={f[key]}
          onChange={(e) => up(key, e.target.value)}
          placeholder={extra.placeholder}
          autoComplete={extra.autoComplete ?? 'off'}
        />
      )}
    </FormField>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editVendor ? 'Edit Vendor' : 'New Vendor'}
      size="lg"
      onSubmit={(e) => {
        void submit(e);
      }}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-info btn-md text-center disabled:opacity-50">
            {saving ? 'Saving...' : editVendor ? 'Save Changes' : 'Add Vendor'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text('name', 'Vendor Name', { placeholder: 'e.g. Galls', required: true, className: 'sm:col-span-2' })}
          {text('account_number', 'Account Number', { placeholder: 'Our account with them' })}
          {text('payment_terms', 'Payment Terms', { placeholder: 'e.g. Net 30' })}
        </div>

        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Contact Details</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('phone', 'Phone', { type: 'tel' })}
            {text('email', 'Email', { type: 'email', placeholder: 'orders@vendor.com' })}
            {text('fax', 'Fax', { type: 'tel' })}
            {text('website', 'Website', { type: 'url', placeholder: 'https://' })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Address</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('address_line1', 'Street Address', { className: 'sm:col-span-2' })}
            {text('address_line2', 'Suite / Unit', { className: 'sm:col-span-2' })}
            {text('city', 'City')}
            {text('state', 'State')}
            {text('postal_code', 'Postal Code')}
            {text('country', 'Country')}
          </div>
        </fieldset>

        {!editVendor && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">
              Primary Contact <span className="text-theme-text-muted font-normal">(optional)</span>
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text('contact_name', 'Name', { placeholder: 'Sales rep or service desk' })}
              {text('contact_title', 'Title')}
              {text('contact_email', 'Email', { type: 'email' })}
              {text('contact_phone', 'Phone', { type: 'tel' })}
            </div>
          </fieldset>
        )}

        <FormField
          label="Notes"
          id={VENDOR_FIELDS.notes.id}
          error={errors.notes}
          maxLength={VENDOR_FIELDS.notes.maxLength}
          count={f.notes.length}
        >
          {(field) => (
            <textarea
              {...field}
              className={inp}
              rows={2}
              value={f.notes}
              onChange={(e) => up('notes', e.target.value)}
              placeholder="Ordering quirks, contract numbers, lead times..."
            />
          )}
        </FormField>

        <label className="text-theme-text-primary flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={f.is_preferred}
            onChange={(e) => up('is_preferred', e.target.checked)}
          />
          Preferred vendor (sorts first when picking one)
        </label>
      </div>
    </Modal>
  );
};

interface ContactFD {
  name: string;
  title: string;
  email: string;
  phone: string;
  phone_extension: string;
  notes: string;
  is_primary: boolean;
}

const EMPTY_CONTACT: ContactFD = {
  name: '',
  title: '',
  email: '',
  phone: '',
  phone_extension: '',
  notes: '',
  is_primary: false,
};

type ContactField = Exclude<keyof ContactFD, 'is_primary'>;

/** `InventoryVendorContactBase` max_lengths, ordered as on screen. */
const CONTACT_FIELDS: Record<ContactField, ServerFieldSpec & { id: string }> = {
  name: { label: 'Name', maxLength: 255, id: 'contact-name' },
  title: { label: 'Title', maxLength: 150, id: 'contact-title' },
  email: { label: 'Email', maxLength: 255, id: 'contact-email' },
  phone: { label: 'Phone', maxLength: 50, id: 'contact-phone' },
  phone_extension: { label: 'Extension', maxLength: 20, id: 'contact-ext' },
  // `FreeText` max_length.
  notes: { label: 'Notes', maxLength: 2000, id: 'contact-notes' },
};

// -- Contacts Modal --
const VendorContactsModal: React.FC<{
  vendor: InventoryVendor | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ vendor, onClose, onSaved }) => {
  const { confirm } = useConfirm();
  const [f, setF] = useState<ContactFD>(EMPTY_CONTACT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  // The contact form's starting point — blank, or the contact being edited —
  // so Escape and the X ask before discarding what was typed (forms review F-6).
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_CONTACT));
  const isDirty = JSON.stringify(f) !== baseline;

  const resetForm = () => {
    setF(EMPTY_CONTACT);
    setEditingId(null);
    setErrors({});
    setBaseline(JSON.stringify(EMPTY_CONTACT));
  };

  useEffect(() => {
    setF(EMPTY_CONTACT);
    setEditingId(null);
    setErrors({});
    setBaseline(JSON.stringify(EMPTY_CONTACT));
  }, [vendor?.id]);

  const up = (k: keyof ContactFD, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in CONTACT_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<ContactField, string>>) => {
    setErrors(next);
    const first = (Object.keys(CONTACT_FIELDS) as ContactField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(CONTACT_FIELDS[first].id)?.focus(), 0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return;
    const found: Partial<Record<ContactField, string>> = {};
    if (!f.name.trim()) found.name = 'Give the contact a name.';
    if (f.email.trim() && !looksLikeEmail(f.email)) found.email = 'Enter an email address like rep@vendor.com.';
    // A new contact is not added until every flagged field is fixed; an edit
    // saves the rest and keeps the stored value of a refused one (below).
    if (!editingId && Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const contactId = editingId;
        const refused = await saveExcept(
          {
            name: f.name.trim(),
            title: blankToNull(f.title),
            email: blankToNull(f.email),
            phone: blankToNull(f.phone),
            phone_extension: blankToNull(f.phone_extension),
            notes: blankToNull(f.notes),
            is_primary: f.is_primary,
          },
          found,
          CONTACT_FIELDS,
          (rest) => inventoryService.updateVendorContact(vendor.id, contactId, rest)
        );
        if (Object.keys(refused).length > 0) {
          // Saved but for the flagged fields, which keep their stored values:
          // the list refreshes and the edit stays open with them marked.
          onSaved();
          showErrors(refused);
          const stored = JSON.parse(baseline) as ContactFD;
          const keys = Object.keys(refused) as ContactField[];
          setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
          const first = (Object.keys(CONTACT_FIELDS) as ContactField[]).find((k) => refused[k]);
          if (first) {
            toast.error(
              `Contact saved, except ${CONTACT_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
            );
          }
          return;
        }
        toast.success('Contact updated');
      } else {
        await inventoryService.addVendorContact(vendor.id, {
          name: f.name.trim(),
          title: f.title.trim() || undefined,
          email: f.email.trim() || undefined,
          phone: f.phone.trim() || undefined,
          phone_extension: f.phone_extension.trim() || undefined,
          notes: f.notes.trim() || undefined,
          is_primary: f.is_primary,
        });
        toast.success('Contact added');
      }
      resetForm();
      onSaved();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast (forms review F-2).
      const mapped = mapServerFieldErrors(err, CONTACT_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save contact'));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact: InventoryVendorContact) => {
    if (!vendor) return;
    const ok = await confirm({
      title: 'Remove contact',
      message: `Remove ${contact.name} from ${vendor.name}? Their details will no longer be on file.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep contact',
    });
    if (!ok) return;
    try {
      await inventoryService.deleteVendorContact(vendor.id, contact.id);
      toast.success('Contact removed');
      if (editingId === contact.id) resetForm();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove contact'));
    }
  };

  const startEdit = (contact: InventoryVendorContact) => {
    const seeded: ContactFD = {
      name: contact.name,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      phone_extension: contact.phone_extension ?? '',
      notes: contact.notes ?? '',
      is_primary: contact.is_primary,
    };
    setEditingId(contact.id);
    setErrors({});
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
  };

  /** One contact text box, labelled, limited and wired to its error. */
  const text = (
    key: ContactField,
    label: string,
    extra: { type?: string; placeholder?: string; required?: boolean } = {}
  ) => (
    <FormField
      label={label}
      required={extra.required}
      id={CONTACT_FIELDS[key].id}
      error={errors[key]}
      maxLength={CONTACT_FIELDS[key].maxLength}
      count={f[key].length}
      className={key === 'phone' ? 'flex-1' : key === 'phone_extension' ? 'w-24' : undefined}
    >
      {(field) => (
        <input
          {...field}
          type={extra.type ?? 'text'}
          className={inp}
          value={f[key]}
          onChange={(e) => up(key, e.target.value)}
          placeholder={extra.placeholder}
          autoComplete="off"
        />
      )}
    </FormField>
  );

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      isDirty={isDirty}
      title={vendor ? `Contacts — ${vendor.name}` : 'Contacts'}
      size="lg"
    >
      <div className="space-y-4 p-4">
        {vendor && vendor.contacts.length > 0 ? (
          <ul className="space-y-2">
            {vendor.contacts.map((contact) => (
              <li key={contact.id} className="split-row card-secondary gap-2 p-3 sm:items-center">
                <div className="split-row-main">
                  <p className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                    {contact.name}
                    {contact.is_primary && (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400">
                        Primary
                      </span>
                    )}
                  </p>
                  {contact.title && <p className="text-theme-text-muted text-xs">{contact.title}</p>}
                  <p className="text-theme-text-muted text-xs">
                    {[
                      contact.email,
                      contact.phone &&
                        `${contact.phone}${contact.phone_extension ? ` x${contact.phone_extension}` : ''}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No contact details'}
                  </p>
                </div>
                <div className="split-row-aside flex flex-wrap gap-1">
                  <button type="button" onClick={() => startEdit(contact)} className="btn-secondary btn-sm">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void remove(contact);
                    }}
                    className="btn-secondary btn-sm text-red-600 dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-theme-text-muted text-sm">No contacts on file for this vendor yet.</p>
        )}

        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          noValidate
          className="border-theme-surface-border space-y-3 border-t pt-4"
        >
          <p className="text-theme-text-primary text-sm font-semibold">
            {editingId ? 'Edit contact' : 'Add a contact'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('name', 'Name', { required: true })}
            {text('title', 'Title', { placeholder: 'e.g. Account Manager' })}
            {text('email', 'Email', { type: 'email' })}
            <div className="flex gap-2">
              {text('phone', 'Phone', { type: 'tel' })}
              {text('phone_extension', 'Ext.')}
            </div>
          </div>
          <FormField
            label="Notes"
            id={CONTACT_FIELDS.notes.id}
            error={errors.notes}
            maxLength={CONTACT_FIELDS.notes.maxLength}
            count={f.notes.length}
          >
            {(field) => (
              <textarea
                {...field}
                className={inp}
                rows={2}
                value={f.notes}
                onChange={(e) => up('notes', e.target.value)}
              />
            )}
          </FormField>
          <label className="text-theme-text-primary flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={f.is_primary}
              onChange={(e) => up('is_primary', e.target.checked)}
            />
            Primary contact for this vendor
          </label>
          <div className="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center">
            {editingId && (
              <button type="button" className="btn-secondary btn-md" onClick={resetForm}>
                Cancel Edit
              </button>
            )}
            <button type="submit" disabled={saving} className="btn-info btn-md text-center disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Save Contact' : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

// -- Merge Modal --
const MergeVendorModal: React.FC<{
  vendor: InventoryVendor | null;
  vendors: InventoryVendor[];
  onClose: () => void;
  onMerged: () => void;
}> = ({ vendor, vendors, onClose, onMerged }) => {
  const [sourceId, setSourceId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSourceId('');
  }, [vendor?.id]);

  // Every other vendor is a merge candidate; a vendor cannot absorb itself.
  const candidates = useMemo(
    () => vendors.filter((v) => v.id !== vendor?.id).sort((a, b) => a.name.localeCompare(b.name)),
    [vendors, vendor?.id]
  );
  const source = candidates.find((v) => v.id === sourceId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor || !source) {
      toast.error('Choose the duplicate to merge in');
      return;
    }
    setSaving(true);
    try {
      const result = await inventoryService.mergeVendors(vendor.id, source.id);
      toast.success(
        `Merged ${result.merged_name} into ${result.vendor_name} — ${result.items_moved} item${
          result.items_moved === 1 ? '' : 's'
        } and ${result.reorders_moved} reorder${result.reorders_moved === 1 ? '' : 's'} moved`
      );
      onMerged();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to merge vendors'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      title={vendor ? `Merge into ${vendor.name}` : 'Merge'}
      size="md"
      onSubmit={(e) => {
        void submit(e);
      }}
      footer={
        <>
          <button
            type="submit"
            disabled={saving || !source}
            className="btn-info btn-md text-center disabled:opacity-50"
          >
            {saving ? 'Merging...' : 'Merge Vendors'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <p className="text-theme-text-muted text-sm">
          The same supplier entered twice. Everything on the duplicate — items, reorder requests and contacts — moves to{' '}
          <span className="text-theme-text-primary font-medium">{vendor?.name}</span>, and the duplicate is removed.
        </p>

        <div>
          <label className={lbl} htmlFor="merge-source">
            Duplicate to merge in
          </label>
          <select id="merge-source" className={inp} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">— Select a vendor —</option>
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>

        {source && (
          <div className="card-secondary p-3 text-sm">
            <p className="text-theme-text-primary font-medium">Moving from {source.name}</p>
            <p className="text-theme-text-muted mt-1 text-xs">
              {source.item_count} item{source.item_count === 1 ? '' : 's'} · {source.open_reorder_count} open reorder
              {source.open_reorder_count === 1 ? '' : 's'} · {source.contacts.length} contact
              {source.contacts.length === 1 ? '' : 's'}
            </p>
            <p className="text-theme-text-muted mt-2 text-xs">
              Nothing on {vendor?.name} is overwritten — its own details are kept.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

// -- Unlinked names cleanup --
const UnlinkedNamesModal: React.FC<{
  isOpen: boolean;
  names: UnlinkedVendorName[];
  vendors: InventoryVendor[];
  onClose: () => void;
  onChanged: () => void;
}> = ({ isOpen, names, vendors, onClose, onChanged }) => {
  // Which vendor each row is being attached to, keyed by the typed-in name.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setTargets({});
  }, [isOpen]);

  const sorted = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name)), [vendors]);

  const attach = async (name: string, vendorId: string) => {
    setBusy(name);
    try {
      const result = await inventoryService.attachVendorName(vendorId, name);
      toast.success(
        `Linked ${result.items_linked} item${result.items_linked === 1 ? '' : 's'} and ${
          result.reorders_linked
        } reorder${result.reorders_linked === 1 ? '' : 's'}`
      );
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to attach the name'));
    } finally {
      setBusy(null);
    }
  };

  // Creating the vendor and attaching in one go is the common case: the name is
  // a real supplier nobody has entered yet.
  const createAndAttach = async (name: string) => {
    setBusy(name);
    try {
      const created = await inventoryService.createVendor({ name });
      const result = await inventoryService.attachVendorName(created.id, name);
      toast.success(
        `Added ${created.name} and linked ${result.items_linked} item${result.items_linked === 1 ? '' : 's'}`
      );
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the vendor'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Supplier names not on the list" size="lg">
      <div className="space-y-4 p-4">
        <p className="text-theme-text-muted text-sm">
          These names were typed onto items and reorder requests before the vendor list existed, so nothing sits behind
          them. Add each one as a vendor, or attach it to one already on the list.
        </p>

        {names.length === 0 ? (
          <p className="text-theme-text-muted text-sm">Every supplier name is on the list. Nothing to clean up.</p>
        ) : (
          <ul className="space-y-2">
            {names.map((entry) => (
              <li key={entry.name} className="card-secondary flex flex-col gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium">{entry.name}</p>
                  <p className="text-theme-text-muted text-xs">
                    {entry.item_count} item{entry.item_count === 1 ? '' : 's'} · {entry.reorder_count} reorder
                    {entry.reorder_count === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      void createAndAttach(entry.name);
                    }}
                    className="btn-info btn-sm shrink-0 disabled:opacity-50"
                  >
                    {busy === entry.name ? 'Working...' : 'Add as vendor'}
                  </button>
                  <div className="flex flex-1 gap-2">
                    <select
                      className={`${inp} flex-1`}
                      aria-label={`Attach ${entry.name} to an existing vendor`}
                      value={targets[entry.name] ?? ''}
                      onChange={(e) => setTargets((p) => ({ ...p, [entry.name]: e.target.value }))}
                    >
                      <option value="">— or attach to —</option>
                      {sorted.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy !== null || !targets[entry.name]}
                      onClick={() => {
                        const target = targets[entry.name];
                        if (target) void attach(entry.name, target);
                      }}
                      className="btn-secondary btn-sm shrink-0 disabled:opacity-50"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-theme-surface-border flex justify-end border-t pt-3">
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
};

// -- Main Page --
export const VendorsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');
  const [vendors, setVendors] = useState<InventoryVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editVendor, setEditVendor] = useState<InventoryVendor | null>(null);
  const [contactsVendorId, setContactsVendorId] = useState<string | null>(null);
  const [mergeVendorId, setMergeVendorId] = useState<string | null>(null);
  const [unlinked, setUnlinked] = useState<UnlinkedVendorName[]>([]);
  const [showUnlinked, setShowUnlinked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, names] = await Promise.all([
        inventoryService.getVendors({
          search: search || undefined,
          active_only: !includeInactive,
        }),
        // Never fatal: the list is worth showing even if the cleanup prompt
        // cannot be worked out.
        canManage
          ? inventoryService.getUnlinkedVendorNames().catch(() => [] as UnlinkedVendorName[])
          : Promise.resolve([] as UnlinkedVendorName[]),
      ]);
      setVendors(data);
      setUnlinked(names);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load vendors'));
    } finally {
      setLoading(false);
    }
  }, [search, includeInactive, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Kept as an id rather than the object so the open contacts modal shows the
  // freshly-loaded contact list after each add, edit or removal.
  const contactsVendor = useMemo(
    () => vendors.find((v) => v.id === contactsVendorId) ?? null,
    [vendors, contactsVendorId]
  );
  const mergeVendor = useMemo(() => vendors.find((v) => v.id === mergeVendorId) ?? null, [vendors, mergeVendorId]);

  const unlinkedTotals = useMemo(
    () => ({
      items: unlinked.reduce((sum, entry) => sum + entry.item_count, 0),
      reorders: unlinked.reduce((sum, entry) => sum + entry.reorder_count, 0),
    }),
    [unlinked]
  );

  const stats = useMemo(() => {
    const active = vendors.filter((v) => v.is_active).length;
    const preferred = vendors.filter((v) => v.is_preferred).length;
    const openOrders = vendors.reduce((sum, v) => sum + v.open_reorder_count, 0);
    return { active, preferred, openOrders };
  }, [vendors]);

  const setActive = async (vendor: InventoryVendor, active: boolean) => {
    if (!active) {
      const ok = await confirm({
        title: 'Deactivate vendor',
        message:
          `Deactivate ${vendor.name}? It stops appearing when picking a vendor, but the ` +
          `${vendor.item_count} item${vendor.item_count === 1 ? '' : 's'} bought from them keep their link.`,
        confirmLabel: 'Deactivate',
        cancelLabel: 'Keep active',
      });
      if (!ok) return;
    }
    try {
      if (active) {
        await inventoryService.updateVendor(vendor.id, { is_active: true });
        toast.success('Vendor reactivated');
      } else {
        await inventoryService.deactivateVendor(vendor.id);
        toast.success('Vendor deactivated');
      }
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update vendor'));
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl py-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h2 className="text-theme-text-primary text-2xl font-bold">Vendors</h2>
            <p className="text-theme-text-muted text-sm">Suppliers, their contacts, and what we buy from them</p>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <button
              onClick={() => {
                void load();
              }}
              className="btn-secondary btn-md"
              aria-label="Refresh vendors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setEditVendor(null);
                  setShowForm(true);
                }}
                className="btn-info btn-md flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                New Vendor
              </button>
            )}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="card-secondary p-3 text-center">
            <p className="text-theme-text-primary text-2xl font-bold">{stats.active}</p>
            <p className="text-theme-text-muted text-xs">Active Vendors</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.preferred}</p>
            <p className="text-theme-text-muted text-xs">Preferred</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.openOrders}</p>
            <p className="text-theme-text-muted text-xs">Open Reorders</p>
          </div>
        </div>

        {canManage && unlinked.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {unlinked.length} supplier name{unlinked.length === 1 ? '' : 's'} not on the list — named by{' '}
              {unlinkedTotals.items} item{unlinkedTotals.items === 1 ? '' : 's'} and {unlinkedTotals.reorders} reorder
              {unlinkedTotals.reorders === 1 ? '' : 's'}
            </p>
            <button
              onClick={() => setShowUnlinked(true)}
              className="text-xs font-medium text-amber-700 hover:underline sm:ml-auto dark:text-amber-300"
            >
              Review and attach &rarr;
            </button>
          </div>
        )}

        <div className="card-secondary mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative w-full sm:flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`${inp} pl-9`}
              aria-label="Search vendors"
              placeholder="Search name, account number, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="text-theme-text-muted mobile-touch-target flex shrink-0 items-center justify-start gap-3 text-sm max-md:ps-3.5">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
        </div>

        {loading && vendors.length === 0 ? (
          <div className="text-theme-text-muted py-12 text-center">Loading...</div>
        ) : vendors.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No vendors yet"
            description="Add the suppliers you buy equipment from, then link items and reorder requests to them."
            actions={
              canManage
                ? [
                    {
                      label: 'Add First Vendor',
                      onClick: () => {
                        setEditVendor(null);
                        setShowForm(true);
                      },
                    },
                  ]
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {vendors.map((vendor) => {
              const contact = primaryContact(vendor);
              const address = formatVendorAddress(vendor);
              return (
                <div key={vendor.id} className={`card-secondary p-4 ${vendor.is_active ? '' : 'opacity-60'}`}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
                        <span className="truncate">{vendor.name}</span>
                        {vendor.is_preferred && (
                          <Star
                            className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500"
                            aria-label="Preferred vendor"
                          />
                        )}
                        {!vendor.is_active && (
                          <span className="bg-theme-surface-secondary text-theme-text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                            Inactive
                          </span>
                        )}
                      </h2>
                      {vendor.account_number && (
                        <p className="text-theme-text-muted text-xs">Account {vendor.account_number}</p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditVendor(vendor);
                            setShowForm(true);
                          }}
                          className="btn-icon"
                          aria-label={`Edit ${vendor.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {vendors.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMergeVendorId(vendor.id)}
                            className="btn-icon"
                            aria-label={`Merge a duplicate into ${vendor.name}`}
                            title="Merge a duplicate into this vendor"
                          >
                            <Merge className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void setActive(vendor, !vendor.is_active);
                          }}
                          className="btn-icon"
                          aria-label={`${vendor.is_active ? 'Deactivate' : 'Reactivate'} ${vendor.name}`}
                        >
                          {vendor.is_active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="text-theme-text-muted space-y-1 text-xs">
                    {vendor.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${vendor.phone}`} className="hover:underline">
                          {vendor.phone}
                        </a>
                      </p>
                    )}
                    {vendor.email && (
                      <p className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a href={`mailto:${vendor.email}`} className="truncate hover:underline">
                          {vendor.email}
                        </a>
                      </p>
                    )}
                    {vendor.website && isSafeExternalUrl(vendor.website) && (
                      <p className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={vendor.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:underline"
                        >
                          {vendor.website}
                        </a>
                      </p>
                    )}
                    {address && (
                      <p className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{address}</span>
                      </p>
                    )}
                    {vendor.payment_terms && <p>Terms: {vendor.payment_terms}</p>}
                  </div>

                  <div className="border-theme-surface-border mt-3 border-t pt-3">
                    <p className="text-theme-text-muted text-xs">
                      {contact ? (
                        <>
                          <span className="text-theme-text-primary font-medium">{contact.name}</span>
                          {contact.title ? ` · ${contact.title}` : ''}
                          {contact.phone ? ` · ${contact.phone}` : ''}
                          {contact.email ? ` · ${contact.email}` : ''}
                        </>
                      ) : (
                        'No contact on file'
                      )}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <Link
                      to={`/inventory/admin/items?vendor_id=${vendor.id}`}
                      className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1"
                    >
                      <Package className="h-3.5 w-3.5" />
                      {vendor.item_count} item{vendor.item_count === 1 ? '' : 's'}
                    </Link>
                    <Link
                      to="/inventory/admin/reorder"
                      className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1"
                    >
                      <Truck className="h-3.5 w-3.5" />
                      {vendor.open_reorder_count} open reorder{vendor.open_reorder_count === 1 ? '' : 's'}
                    </Link>
                    {vendor.total_purchase_value != null && Number(vendor.total_purchase_value) > 0 && (
                      <span
                        className="text-theme-text-muted"
                        title="Purchase price of every item bought from this vendor, retired ones included"
                      >
                        {formatCurrency(Number(vendor.total_purchase_value))} purchased
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setContactsVendorId(vendor.id)}
                      className="text-theme-text-muted hover:text-theme-text-primary ml-auto flex items-center gap-1"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Contacts ({vendor.contacts.length})
                    </button>
                  </div>

                  {vendor.notes && <p className="text-theme-text-muted mt-3 text-xs italic">{vendor.notes}</p>}
                </div>
              );
            })}
          </div>
        )}

        <VendorFormModal
          isOpen={showForm}
          onClose={() => {
            setShowForm(false);
            setEditVendor(null);
          }}
          onSaved={() => {
            void load();
          }}
          onSavedExcept={() => {
            void load();
          }}
          editVendor={editVendor}
        />
        <VendorContactsModal
          vendor={contactsVendor}
          onClose={() => setContactsVendorId(null)}
          onSaved={() => {
            void load();
          }}
        />
        <MergeVendorModal
          vendor={mergeVendor}
          vendors={vendors}
          onClose={() => setMergeVendorId(null)}
          onMerged={() => {
            void load();
          }}
        />
        <UnlinkedNamesModal
          isOpen={showUnlinked}
          names={unlinked}
          vendors={vendors}
          onClose={() => setShowUnlinked(false)}
          onChanged={() => {
            void load();
          }}
        />
      </div>
    </div>
  );
};

export default VendorsPage;
