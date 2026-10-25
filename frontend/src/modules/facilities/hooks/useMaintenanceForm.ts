import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { MaintenanceRecordCreate } from '../../../services/facilitiesServices';
import type { MaintenanceRecord, MaintenanceType } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';

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

export const MAINTENANCE_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

interface UseMaintenanceFormOptions {
  facilityId?: string;
  initialStatusFilter?: StatusFilter;
}

export function useMaintenanceForm({ facilityId, initialStatusFilter = 'all' }: UseMaintenanceFormOptions = {}) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // What the server is asked to search for: the box, settled for a moment, so
  // typing a word is one request rather than one per letter.
  const [appliedSearch, setAppliedSearch] = useState('');
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<MaintenanceFormData>(emptyForm(facilityId));

  // A new filter or search starts again from the first page, so nobody is
  // left on page 4 of a result set that now has one page. Set in the same
  // update as the filter, so the stale page is never requested.
  const appliedSearchRef = useRef('');
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = searchQuery.trim();
      if (next === appliedSearchRef.current) return;
      appliedSearchRef.current = next;
      setAppliedSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const changeStatusFilter = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  }, []);

  // Responses can land out of order; only the latest request may write.
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void facilitiesService
      .getMaintenanceTypes()
      .then((types) => {
        if (!cancelled) setMaintenanceTypes(types);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRecords = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      // Status, search and paging are all applied by the server (FAC2-5). The
      // old list endpoint returned the 100 most recently created records and
      // the screen filtered those, so an old overdue record or a vendor named
      // only on an older record was missing with no sign the list was partial.
      const params: Parameters<typeof facilitiesService.getMaintenancePage>[0] = {
        skip: (page - 1) * MAINTENANCE_PAGE_SIZE,
        limit: MAINTENANCE_PAGE_SIZE,
      };
      if (facilityId) params.facility_id = facilityId;
      if (statusFilter === 'completed') params.is_completed = true;
      if (statusFilter === 'pending') params.is_completed = false;
      if (statusFilter === 'overdue') params.is_overdue = true;
      if (appliedSearch) params.search = appliedSearch;
      const result = await facilitiesService.getMaintenancePage(params);
      if (seq !== requestSeq.current) return;
      setRecords(result.items);
      setTotal(result.total);
    } catch {
      if (seq !== requestSeq.current) return;
      setLoadError(true);
      toast.error('Failed to load maintenance records');
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [facilityId, statusFilter, appliedSearch, page]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  // The server already filtered by status; repeating it here keeps a filter
  // change from showing the previous filter's rows while the request is out.
  const filtered = records.filter((r) => {
    if (statusFilter === 'completed' && !r.isCompleted) return false;
    if (statusFilter === 'pending' && r.isCompleted) return false;
    if (statusFilter === 'overdue' && !r.isOverdue) return false;
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
    // The server refuses a record with no type (its column is NOT NULL), and
    // that refusal used to arrive as a bare "Failed to save record".
    if (!formData.maintenance_type_id) {
      toast.error('Choose a maintenance type');
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save record'));
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
    page,
    setPage,
    total,
    pageSize: MAINTENANCE_PAGE_SIZE,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter: changeStatusFilter,
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
