import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { InspectionCreate } from '../../../services/facilitiesServices';
import type { Inspection } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';

interface InspectionFormData {
  facility_id: string;
  inspection_type: string;
  title: string;
  description: string;
  inspection_date: string;
  next_inspection_date: string;
  inspector_name: string;
  inspector_organization: string;
  passed: string;
  findings: string;
  corrective_actions: string;
  corrective_action_deadline: string;
  notes: string;
}

const emptyForm = (tz: string, facilityId?: string): InspectionFormData => ({
  facility_id: facilityId || '',
  inspection_type: 'routine',
  title: '',
  description: '',
  inspection_date: getTodayLocalDate(tz),
  next_inspection_date: '',
  inspector_name: '',
  inspector_organization: '',
  passed: '',
  findings: '',
  corrective_actions: '',
  corrective_action_deadline: '',
  notes: '',
});

function inspectionToForm(insp: Inspection): InspectionFormData {
  return {
    facility_id: insp.facilityId,
    inspection_type: insp.inspectionType || 'routine',
    title: insp.title || '',
    description: insp.description || '',
    inspection_date: insp.inspectionDate || '',
    next_inspection_date: insp.nextInspectionDate || '',
    inspector_name: insp.inspectorName || '',
    inspector_organization: insp.inspectorOrganization || '',
    passed: insp.passed === true ? 'true' : insp.passed === false ? 'false' : '',
    findings: insp.findings || '',
    corrective_actions: insp.correctiveActions || '',
    corrective_action_deadline: insp.correctiveActionDeadline || '',
    notes: insp.notes || '',
  };
}

function formToPayload(formData: InspectionFormData): InspectionCreate {
  const payload: InspectionCreate = {
    facility_id: formData.facility_id,
    inspection_type: formData.inspection_type,
    title: formData.title.trim(),
    inspection_date: formData.inspection_date,
    passed: formData.passed === 'true' ? true : formData.passed === 'false' ? false : null,
  };
  if (formData.description.trim()) payload.description = formData.description.trim();
  if (formData.next_inspection_date) payload.next_inspection_date = formData.next_inspection_date;
  if (formData.inspector_name.trim()) payload.inspector_name = formData.inspector_name.trim();
  if (formData.inspector_organization.trim()) payload.inspector_organization = formData.inspector_organization.trim();
  if (formData.findings.trim()) payload.findings = formData.findings.trim();
  if (formData.corrective_actions.trim()) payload.corrective_actions = formData.corrective_actions.trim();
  if (formData.corrective_action_deadline) payload.corrective_action_deadline = formData.corrective_action_deadline;
  if (formData.notes.trim()) payload.notes = formData.notes.trim();
  return payload;
}

type ResultFilter = 'all' | 'passed' | 'failed' | 'pending';

interface UseInspectionFormOptions {
  facilityId?: string;
}

export function useInspectionForm({ facilityId }: UseInspectionFormOptions = {}) {
  const tz = useTimezone();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<InspectionFormData>(emptyForm(tz, facilityId));

  const loadInspections = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const params: { facility_id?: string } = {};
      if (facilityId) params.facility_id = facilityId;
      const data = await facilitiesService.getInspections(params);
      setInspections(data);
    } catch {
      setLoadError(true);
      toast.error('Failed to load inspections');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => { void loadInspections(); }, [loadInspections]);

  const filtered = inspections.filter(i => {
    if (resultFilter === 'passed' && i.passed !== true) return false;
    if (resultFilter === 'failed' && i.passed !== false) return false;
    if (resultFilter === 'pending' && i.passed !== null && i.passed !== undefined) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return !!(
        i.title?.toLowerCase().includes(q) ||
        i.inspectorName?.toLowerCase().includes(q) ||
        i.inspectorOrganization?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCreate = (defaultFacilityId?: string) => {
    setEditingInspection(null);
    setFormData(emptyForm(tz, defaultFacilityId || facilityId));
    setShowModal(true);
  };

  const openEdit = (insp: Inspection) => {
    setEditingInspection(insp);
    setFormData(inspectionToForm(insp));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!facilityId && !formData.facility_id) { toast.error('Please select a facility'); return; }
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!formData.inspection_date) { toast.error('Inspection date is required'); return; }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData);
      if (editingInspection) {
        await facilitiesService.updateInspection(editingInspection.id, payload);
        toast.success('Inspection updated');
      } else {
        await facilitiesService.createInspection(payload);
        toast.success('Inspection created');
      }
      setShowModal(false);
      void loadInspections();
    } catch {
      toast.error('Failed to save inspection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (insp: Inspection) => {
    if (!window.confirm(`Delete inspection "${insp.title}"?`)) return;
    try {
      await facilitiesService.deleteInspection(insp.id);
      toast.success('Inspection deleted');
      void loadInspections();
    } catch {
      toast.error('Failed to delete inspection');
    }
  };

  return {
    inspections: filtered,
    allInspections: inspections,
    isLoading,
    loadError,
    reload: loadInspections,
    searchQuery,
    setSearchQuery,
    resultFilter,
    setResultFilter,
    showModal,
    setShowModal,
    editingInspection,
    isSaving,
    formData,
    setFormData,
    openCreate,
    openEdit,
    handleSave,
    handleDelete,
  };
}
