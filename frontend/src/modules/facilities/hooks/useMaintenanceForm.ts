import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { MaintenanceRecordCreate } from '../../../services/facilitiesServices';
import type { MaintenanceRecord, MaintenanceType } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';

import { useConfirm } from '../../../contexts/ConfirmContext';
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

/**
 * On create a blank optional field is omitted; on edit it goes as an explicit
 * null, because the backend dumps update payloads with `exclude_unset` and an
 * omitted key means "leave this alone" — so clearing a vendor, a cost or a due
 * date used to be lost behind a success toast (CLAUDE.md pitfall #1).
 *
 * `maintenance_type_id` is the exception: its column is NOT NULL, so a blank
 * one is omitted in both modes rather than nulled.
 */
function formToPayload(formData: MaintenanceFormData, isEdit: boolean): MaintenanceRecordCreate {
  const { text, pick, num } = formCoercions(isEdit);
  return {
    facility_id: formData.facility_id,
    description: formData.description.trim(),
    maintenance_type_id: formData.maintenance_type_id || undefined,
    scheduled_date: pick(formData.scheduled_date),
    due_date: pick(formData.due_date),
    performed_by: text(formData.performed_by),
    cost: num(formData.cost),
    vendor: text(formData.vendor),
    work_order_number: text(formData.work_order_number),
    notes: text(formData.notes),
  };
}

type StatusFilter = 'all' | 'pending' | 'completed' | 'overdue';

interface UseMaintenanceFormOptions {
  facilityId?: string;
  initialStatusFilter?: StatusFilter;
}

export function useMaintenanceForm({ facilityId, initialStatusFilter = 'all' }: UseMaintenanceFormOptions = {}) {
  const { confirm } = useConfirm();
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
      // The status filter is applied by the server, not just in the browser.
      // The endpoint returns the 100 most recently *created* records, and an
      // overdue record is by nature an old one — so filtering a loaded page
      // client-side systematically hid the longest-overdue work, and the
      // dashboard's org-wide overdue count could point at a list rendering
      // "no records". The client-side pass below still runs, over the right
      // set, so a filter change shows no stale rows while the fetch is in
      // flight. Text search remains client-side: the endpoint has no search
      // parameter, so it matches within the returned page.
      const params: {
        facility_id?: string;
        is_completed?: boolean;
        is_overdue?: boolean;
      } = {};
      if (facilityId) params.facility_id = facilityId;
      if (statusFilter === 'completed') params.is_completed = true;
      if (statusFilter === 'pending') params.is_completed = false;
      if (statusFilter === 'overdue') params.is_overdue = true;
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
  }, [facilityId, statusFilter]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const filtered = records.filter((r) => {
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
    if (!facilityId && !formData.facility_id) {
      toast.error('Select a facility');
      return;
    }
    if (!formData.description.trim()) {
      toast.error('Description is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData, Boolean(editingRecord));
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
      toast.error('Failed to mark record completed');
    }
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    if (
      !(await confirm({
        title: 'Delete maintenance record',
        message: 'The record and its cost, vendor and work-order details are removed for good.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
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
