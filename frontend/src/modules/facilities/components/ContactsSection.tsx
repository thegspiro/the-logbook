/**
 * ContactsSection — Emergency contacts for a single facility.
 */

import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, Loader2, Pencil, Save, Phone, Mail, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { EmergencyContact, EmergencyContactCreate } from '../../../services/facilitiesServices';
import { enumLabel } from '../types';
import { inputCls, labelCls, CONTACT_TYPE_OPTIONS } from '../constants';

interface Props {
  facilityId: string;
}

export default function ContactsSection({ facilityId }: Props) {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    contact_type: 'other',
    company_name: '',
    contact_name: '',
    phone: '',
    alt_phone: '',
    email: '',
    service_contract_number: '',
    priority: '',
  });

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

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const resetForm = () => {
    setFormData({ contact_type: 'other', company_name: '', contact_name: '', phone: '', alt_phone: '', email: '', service_contract_number: '', priority: '' });
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
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.company_name.trim() && !formData.contact_name.trim()) {
      toast.error('Company name or contact name is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload: EmergencyContactCreate = {
        facility_id: facilityId,
        contact_type: formData.contact_type,
      };
      if (formData.company_name.trim()) payload.company_name = formData.company_name.trim();
      if (formData.contact_name.trim()) payload.contact_name = formData.contact_name.trim();
      if (formData.phone.trim()) payload.phone = formData.phone.trim();
      if (formData.alt_phone.trim()) payload.alt_phone = formData.alt_phone.trim();
      if (formData.email.trim()) payload.email = formData.email.trim();
      if (formData.service_contract_number.trim()) payload.service_contract_number = formData.service_contract_number.trim();
      if (formData.priority) payload.priority = Number(formData.priority);

      if (editingContact) {
        await facilitiesService.updateEmergencyContact(editingContact.id, payload);
        toast.success('Contact updated');
      } else {
        await facilitiesService.createEmergencyContact(payload);
        toast.success('Contact added');
      }
      resetForm();
      void loadContacts();
    } catch {
      toast.error('Failed to save contact');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (contact: EmergencyContact) => {
    if (!window.confirm(`Delete contact "${contact.companyName || contact.contactName}"?`)) return;
    try {
      await facilitiesService.deleteEmergencyContact(contact.id);
      toast.success('Contact deleted');
      void loadContacts();
    } catch {
      toast.error('Failed to delete contact');
    }
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Emergency Contacts {!isLoading && `(${contacts.length})`}
        </h2>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Contact
        </button>
      </div>

      <div className="p-5">
        {showForm && (
          <div className="mb-5 p-4 bg-theme-surface-hover/50 rounded-lg space-y-3">
            <h3 className="text-sm font-medium text-theme-text-primary">{editingContact ? 'Edit Contact' : 'Add Contact'}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Type</label>
                <select value={formData.contact_type} onChange={e => setFormData(p => ({...p, contact_type: e.target.value}))} className={inputCls}>
                  {CONTACT_TYPE_OPTIONS.map(ct => <option key={ct} value={ct}>{enumLabel(ct)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Company Name</label>
                <input type="text" value={formData.company_name} onChange={e => setFormData(p => ({...p, company_name: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Contact Name</label>
                <input type="text" value={formData.contact_name} onChange={e => setFormData(p => ({...p, contact_name: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" value={formData.phone} onChange={e => setFormData(p => ({...p, phone: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Alt Phone</label>
                <input type="tel" value={formData.alt_phone} onChange={e => setFormData(p => ({...p, alt_phone: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={formData.email} onChange={e => setFormData(p => ({...p, email: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Contract #</label>
                <input type="text" value={formData.service_contract_number} onChange={e => setFormData(p => ({...p, service_contract_number: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Priority (1=highest)</label>
                <input type="number" value={formData.priority} onChange={e => setFormData(p => ({...p, priority: e.target.value}))} min="1" className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { void handleSave(); }} disabled={isSaving} className="btn-primary flex gap-1.5 items-center px-3 py-1.5 text-xs">
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingContact ? 'Update' : 'Add'}
              </button>
              <button onClick={resetForm} className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
            <p className="text-sm text-theme-text-muted">No emergency contacts recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map(contact => (
              <div key={contact.id} className="flex items-center justify-between p-3 bg-theme-surface-hover/30 rounded-lg group">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-theme-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">
                      {contact.companyName || contact.contactName || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                      <span>{enumLabel(contact.contactType)}</span>
                      {contact.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>}
                      {contact.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>}
                      {contact.priority != null && (
                        <span className={contact.priority === 1 ? 'text-red-500 font-medium' : ''}>Priority {contact.priority}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(contact)} className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors" aria-label={`Edit ${contact.companyName || contact.contactName || 'contact'}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { void handleDelete(contact); }} className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" aria-label={`Delete ${contact.companyName || contact.contactName || 'contact'}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
