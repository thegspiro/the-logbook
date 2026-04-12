import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { MaintenanceRecordCreate } from '../../../services/facilitiesServices';
import type { MaintenanceRecord, MaintenanceType } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';

interface MaintenanceFormData {
  facility_id: string;
  maintenance_type_id: string;
  description: string;
  scheduled_date: string;
  due_date: string;
  performed_by: string;
  cost: string;
  vendor: string;
  work_order_number: string;
  notes: string;
}

const emptyForm = (facilityId?: string): MaintenanceFormData => ({
  facility_id: facilityId || '',
  maintenance_type_id: '',
  description: '',
  scheduled_date: '',
  due_date: '',
  performed_by: '',
  cost: '',
  vendor: '',
  work_order_number: '',
  notes: '',
});

function recordToForm(record: MaintenanceRecord): MaintenanceFormData {
  return {
    facility_id: record.facilityId,
    maintenance_type_id: record.maintenanceTypeId || '',
    description: record.description || '',
    scheduled_date: record.scheduledDate || '',
    due_date: record.dueDate || '',
    performed_by: record.performedBy || '',
    cost: record.cost?.toString() || '',
    vendor: record.vendor || '',
    work_order_number: record.workOrderNumber || '',
    notes: record.notes || '',
  };
}

function formToPayload(formData: MaintenanceFormData): MaintenanceRecordCreate {
  const payload: MaintenanceRecordCreate = {
    facility_id: formData.facility_id,
    description: formData.description.trim(),
  };
  if (formData.maintenance_type_id) payload.maintenance_type_id = formData.maintenance_type_id;
  if (formData.scheduled_date) payload.scheduled_date = formData.scheduled_date;
  if (formData.due_date) payload.due_date = formData.due_date;
  if (formData.performed_by.trim()) payload.performed_by = formData.performed_by.trim();
  if (formData.cost) payload.cost = Number(formData.cost);
  if (formData.vendor.trim()) payload.vendor = formData.vendor.trim();
  if (formData.work_order_number.trim()) payload.work_order_number = formData.work_order_number.trim();
  if (formData.notes.trim()) payload.notes = formData.notes.trim();
  return payload;
}

type StatusFilter = 'all' | 'pending' | 'completed' | 'overdue';

interface UseMaintenanceFormOptions {
  facilityId?: string;
  initialStatusFilter?: StatusFilter;
}

export function useMaintenanceForm({ facilityId, initialStatusFilter = 'all' }: UseMaintenanceFormOptions = {}) {
  const tz = useTimezone();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<MaintenanceFormData>(emptyForm(facilityId));

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const params: { facility_id?: string } = {};
      if (facilityId) params.facility_id = facilityId;
      const [data, types] = await Promise.all([
        facilitiesService.getMaintenanceRecords(params),
        facilitiesService.getMaintenanceTypes(),
      ]);
      setRecords(data);
      setMaintenanceTypes(types);
    } catch {
      setLoadError(true);
      toast.error('Failed to load maintenance records');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const filtered = records.filter(r => {
    if (statusFilter === 'completed' && !r.isCompleted) return false;
    if (statusFilter === 'pending' && r.isCompleted) return false;
    if (statusFilter === 'overdue' && !r.isOverdue) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return !!(
        r.description?.toLowerCase().includes(q) ||
        r.vendor?.toLowerCase().includes(q) ||
        r.workOrderNumber?.toLowerCase().includes(q) ||
        r.performedBy?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCreate = (defaultFacilityId?: string) => {
    setEditingRecord(null);
    setFormData(emptyForm(defaultFacilityId || facilityId));
    setShowModal(true);
  };

  const openEdit = (record: MaintenanceRecord) => {
    setEditingRecord(record);
    setFormData(recordToForm(record));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!facilityId && !formData.facility_id) { toast.error('Please select a facility'); return; }
    if (!formData.description.trim()) { toast.error('Description is required'); return; }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData);
      if (editingRecord) {
        await facilitiesService.updateMaintenanceRecord(editingRecord.id, payload);
        toast.success('Record updated');
      } else {
        await facilitiesService.createMaintenanceRecord(payload);
        toast.success('Record created');
      }
      setShowModal(false);
      void loadRecords();
    } catch {
      toast.error('Failed to save record');
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async (record: MaintenanceRecord) => {
    try {
      await facilitiesService.updateMaintenanceRecord(record.id, {
        is_completed: true,
        completed_date: getTodayLocalDate(tz),
      });
      toast.success('Marked as completed');
      void loadRecords();
    } catch {
      toast.error('Failed to update record');
    }
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    try {
      await facilitiesService.deleteMaintenanceRecord(record.id);
      toast.success('Record deleted');
      void loadRecords();
    } catch {
      toast.error('Failed to delete record');
    }
  };

  return {
    records: filtered,
    allRecords: records,
    maintenanceTypes,
    isLoading,
    loadError,
    reload: loadRecords,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    showModal,
    setShowModal,
    editingRecord,
    isSaving,
    formData,
    setFormData,
    openCreate,
    openEdit,
    handleSave,
    handleComplete,
    handleDelete,
  };
}
