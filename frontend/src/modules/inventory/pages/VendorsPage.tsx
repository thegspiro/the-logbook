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
  ArrowLeft,
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
import { Modal } from '../../../components/Modal';
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

// -- Create/Edit Vendor Modal --
const VendorFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editVendor?: InventoryVendor | null;
}> = ({ isOpen, onClose, onSaved, editVendor }) => {
  const [f, setF] = useState<VendorFD>(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editVendor) {
      setF({
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
      });
    } else {
      setF(EMPTY_VENDOR);
    }
  }, [editVendor, isOpen]);

  const up = (k: keyof VendorFD, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      toast.error('Vendor name is required');
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
        await inventoryService.updateVendor(editVendor.id, payload);
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
      toast.error(getErrorMessage(err, 'Failed to save vendor'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editVendor ? 'Edit Vendor' : 'New Vendor'} size="lg">
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="space-y-4 p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={lbl} htmlFor="vendor-name">
              Vendor Name *
            </label>
            <input
              id="vendor-name"
              className={inp}
              value={f.name}
              onChange={(e) => up('name', e.target.value)}
              placeholder="e.g. Galls"
              required
            />
          </div>
          <div>
            <label className={lbl} htmlFor="vendor-account">
              Account Number
            </label>
            <input
              id="vendor-account"
              className={inp}
              value={f.account_number}
              onChange={(e) => up('account_number', e.target.value)}
              placeholder="Our account with them"
            />
          </div>
          <div>
            <label className={lbl} htmlFor="vendor-terms">
              Payment Terms
            </label>
            <input
              id="vendor-terms"
              className={inp}
              value={f.payment_terms}
              onChange={(e) => up('payment_terms', e.target.value)}
              placeholder="e.g. Net 30"
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Contact Details</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl} htmlFor="vendor-phone">
                Phone
              </label>
              <input
                id="vendor-phone"
                type="tel"
                className={inp}
                value={f.phone}
                onChange={(e) => up('phone', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-email">
                Email
              </label>
              <input
                id="vendor-email"
                type="email"
                className={inp}
                value={f.email}
                onChange={(e) => up('email', e.target.value)}
                placeholder="orders@vendor.com"
              />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-fax">
                Fax
              </label>
              <input id="vendor-fax" className={inp} value={f.fax} onChange={(e) => up('fax', e.target.value)} />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-website">
                Website
              </label>
              <input
                id="vendor-website"
                className={inp}
                value={f.website}
                onChange={(e) => up('website', e.target.value)}
                placeholder="https://"
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Address</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="vendor-address1">
                Street Address
              </label>
              <input
                id="vendor-address1"
                className={inp}
                value={f.address_line1}
                onChange={(e) => up('address_line1', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="vendor-address2">
                Suite / Unit
              </label>
              <input
                id="vendor-address2"
                className={inp}
                value={f.address_line2}
                onChange={(e) => up('address_line2', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-city">
                City
              </label>
              <input id="vendor-city" className={inp} value={f.city} onChange={(e) => up('city', e.target.value)} />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-state">
                State
              </label>
              <input id="vendor-state" className={inp} value={f.state} onChange={(e) => up('state', e.target.value)} />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-zip">
                Postal Code
              </label>
              <input
                id="vendor-zip"
                className={inp}
                value={f.postal_code}
                onChange={(e) => up('postal_code', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl} htmlFor="vendor-country">
                Country
              </label>
              <input
                id="vendor-country"
                className={inp}
                value={f.country}
                onChange={(e) => up('country', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {!editVendor && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">
              Primary Contact <span className="text-theme-text-muted font-normal">(optional)</span>
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="vendor-contact-name">
                  Name
                </label>
                <input
                  id="vendor-contact-name"
                  className={inp}
                  value={f.contact_name}
                  onChange={(e) => up('contact_name', e.target.value)}
                  placeholder="Sales rep or service desk"
                />
              </div>
              <div>
                <label className={lbl} htmlFor="vendor-contact-title">
                  Title
                </label>
                <input
                  id="vendor-contact-title"
                  className={inp}
                  value={f.contact_title}
                  onChange={(e) => up('contact_title', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="vendor-contact-email">
                  Email
                </label>
                <input
                  id="vendor-contact-email"
                  type="email"
                  className={inp}
                  value={f.contact_email}
                  onChange={(e) => up('contact_email', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="vendor-contact-phone">
                  Phone
                </label>
                <input
                  id="vendor-contact-phone"
                  type="tel"
                  className={inp}
                  value={f.contact_phone}
                  onChange={(e) => up('contact_phone', e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        )}

        <div>
          <label className={lbl} htmlFor="vendor-notes">
            Notes
          </label>
          <textarea
            id="vendor-notes"
            className={inp}
            rows={2}
            value={f.notes}
            onChange={(e) => up('notes', e.target.value)}
            placeholder="Ordering quirks, contract numbers, lead times..."
          />
        </div>

        <label className="text-theme-text-primary flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={f.is_preferred}
            onChange={(e) => up('is_preferred', e.target.checked)}
          />
          Preferred vendor (sorts first when picking one)
        </label>

        <div className="border-theme-surface-border flex flex-col-reverse items-stretch justify-end gap-2 border-t pt-2 sm:flex-row sm:items-center">
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-info btn-md text-center disabled:opacity-50">
            {saving ? 'Saving...' : editVendor ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </form>
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

  useEffect(() => {
    setF(EMPTY_CONTACT);
    setEditingId(null);
  }, [vendor?.id]);

  const up = (k: keyof ContactFD, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return;
    if (!f.name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await inventoryService.updateVendorContact(vendor.id, editingId, {
          name: f.name.trim(),
          title: blankToNull(f.title),
          email: blankToNull(f.email),
          phone: blankToNull(f.phone),
          phone_extension: blankToNull(f.phone_extension),
          notes: blankToNull(f.notes),
          is_primary: f.is_primary,
        });
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
      setF(EMPTY_CONTACT);
      setEditingId(null);
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save contact'));
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
      if (editingId === contact.id) {
        setEditingId(null);
        setF(EMPTY_CONTACT);
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove contact'));
    }
  };

  const startEdit = (contact: InventoryVendorContact) => {
    setEditingId(contact.id);
    setF({
      name: contact.name,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      phone_extension: contact.phone_extension ?? '',
      notes: contact.notes ?? '',
      is_primary: contact.is_primary,
    });
  };

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      title={vendor ? `Contacts — ${vendor.name}` : 'Contacts'}
      size="lg"
    >
      <div className="space-y-4 p-4">
        {vendor && vendor.contacts.length > 0 ? (
          <ul className="space-y-2">
            {vendor.contacts.map((contact) => (
              <li
                key={contact.id}
                className="card-secondary flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
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
                <div className="flex shrink-0 gap-1">
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
          className="border-theme-surface-border space-y-3 border-t pt-4"
        >
          <p className="text-theme-text-primary text-sm font-semibold">
            {editingId ? 'Edit contact' : 'Add a contact'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl} htmlFor="contact-name">
                Name *
              </label>
              <input
                id="contact-name"
                className={inp}
                value={f.name}
                onChange={(e) => up('name', e.target.value)}
                required
              />
            </div>
            <div>
              <label className={lbl} htmlFor="contact-title">
                Title
              </label>
              <input
                id="contact-title"
                className={inp}
                value={f.title}
                onChange={(e) => up('title', e.target.value)}
                placeholder="e.g. Account Manager"
              />
            </div>
            <div>
              <label className={lbl} htmlFor="contact-email">
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                className={inp}
                value={f.email}
                onChange={(e) => up('email', e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={lbl} htmlFor="contact-phone">
                  Phone
                </label>
                <input
                  id="contact-phone"
                  type="tel"
                  className={inp}
                  value={f.phone}
                  onChange={(e) => up('phone', e.target.value)}
                />
              </div>
              <div className="w-24">
                <label className={lbl} htmlFor="contact-ext">
                  Ext.
                </label>
                <input
                  id="contact-ext"
                  className={inp}
                  value={f.phone_extension}
                  onChange={(e) => up('phone_extension', e.target.value)}
                />
              </div>
            </div>
          </div>
          <div>
            <label className={lbl} htmlFor="contact-notes">
              Notes
            </label>
            <textarea
              id="contact-notes"
              className={inp}
              rows={2}
              value={f.notes}
              onChange={(e) => up('notes', e.target.value)}
            />
          </div>
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
              <button
                type="button"
                className="btn-secondary btn-md"
                onClick={() => {
                  setEditingId(null);
                  setF(EMPTY_CONTACT);
                }}
              >
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
    <Modal isOpen={vendor !== null} onClose={onClose} title={vendor ? `Merge into ${vendor.name}` : 'Merge'} size="md">
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="space-y-4 p-4"
      >
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

        <div className="border-theme-surface-border flex flex-col-reverse items-stretch justify-end gap-2 border-t pt-2 sm:flex-row sm:items-center">
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !source}
            className="btn-info btn-md text-center disabled:opacity-50"
          >
            {saving ? 'Merging...' : 'Merge Vendors'}
          </button>
        </div>
      </form>
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
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/inventory/admin"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Admin
        </Link>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h1 className="text-theme-text-primary text-2xl font-bold">Vendors</h1>
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
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.preferred}</p>
            <p className="text-theme-text-muted text-xs">Preferred</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.openOrders}</p>
            <p className="text-theme-text-muted text-xs">Open Reorders</p>
          </div>
        </div>

        {canManage && unlinked.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
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
          <label className="text-theme-text-muted flex shrink-0 items-center gap-3 text-sm max-md:ps-3.5">
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
                    {vendor.website && (
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
