/**
 * Medical Screening Page
 *
 * Main page for managing medical screening requirements,
 * records, and compliance tracking.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Stethoscope,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Shield,
  Trash2,
  Edit2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useMedicalScreeningStore } from '../store/medicalScreeningStore';
import { ScreeningRequirementForm } from '../components/ScreeningRequirementForm';
import { ScreeningRecordForm } from '../components/ScreeningRecordForm';
import { ComplianceDashboard } from '../components/ComplianceDashboard';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { getErrorMessage } from '../../../utils/errorHandling';
import {
  SCREENING_TYPE_LABELS,
  SCREENING_STATUS_LABELS,
  SCREENING_STATUS_COLORS,
} from '../types';
import type {
  ScreeningRequirement,
  ScreeningRecord,
  ScreeningRequirementCreate,
  ScreeningRequirementUpdate,
  ScreeningRecordCreate,
  ScreeningRecordUpdate,
} from '../types';

type Tab = 'requirements' | 'records' | 'compliance';

export const MedicalScreeningPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('requirements');
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<ScreeningRequirement | null>(null);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ScreeningRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'requirement' | 'record'; id: string; name: string } | null>(null);

  const {
    requirements,
    records,
    expiringScreenings,
    isLoading,
    error,
    fetchRequirements,
    createRequirement,
    updateRequirement,
    deleteRequirement,
    fetchRecords,
    createRecord,
    updateRecord,
    deleteRecord,
    fetchExpiringScreenings,
  } = useMedicalScreeningStore();

  useEffect(() => {
    void fetchRequirements();
    void fetchRecords();
    void fetchExpiringScreenings(30);
  }, [fetchRequirements, fetchRecords, fetchExpiringScreenings]);

  const handleSaveRequirement = useCallback(
    async (data: ScreeningRequirementCreate | ScreeningRequirementUpdate) => {
      try {
        if (editingRequirement) {
          await updateRequirement(editingRequirement.id, data as ScreeningRequirementUpdate);
          toast.success('Requirement updated');
        } else {
          await createRequirement(data as ScreeningRequirementCreate);
          toast.success('Requirement created');
        }
        setShowRequirementForm(false);
        setEditingRequirement(null);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to save requirement'));
      }
    },
    [editingRequirement, createRequirement, updateRequirement]
  );

  const handleSaveRecord = useCallback(
    async (data: ScreeningRecordCreate | ScreeningRecordUpdate) => {
      try {
        if (editingRecord) {
          await updateRecord(editingRecord.id, data as ScreeningRecordUpdate);
          toast.success('Record updated');
        } else {
          await createRecord(data as ScreeningRecordCreate);
          toast.success('Record created');
        }
        setShowRecordForm(false);
        setEditingRecord(null);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to save record'));
      }
    },
    [editingRecord, createRecord, updateRecord]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'requirement') {
        await deleteRequirement(deleteTarget.id);
        toast.success('Requirement deleted');
      } else {
        await deleteRecord(deleteTarget.id);
        toast.success('Record deleted');
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete'));
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteRequirement, deleteRecord]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'requirements', label: 'Requirements', icon: Shield },
    { id: 'records', label: 'Records', icon: Stethoscope },
    { id: 'compliance', label: 'Compliance', icon: CheckCircle },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope className="text-theme-text-muted h-6 w-6" />
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Medical Screening</h1>
            <p className="text-theme-text-muted text-sm">
              Manage medical requirements, track screenings, and monitor compliance.
            </p>
          </div>
        </div>
        {activeTab === 'requirements' && (
          <button
            onClick={() => {
              setEditingRequirement(null);
              setShowRequirementForm(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            Add Requirement
          </button>
        )}
        {activeTab === 'records' && (
          <button
            onClick={() => {
              setEditingRecord(null);
              setShowRecordForm(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            Add Record
          </button>
        )}
      </div>

      {/* Expiring Soon Alert */}
      {expiringScreenings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {expiringScreenings.length} screening{expiringScreenings.length === 1 ? '' : 's'} expiring in
              the next 30 days
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-theme-surface-border mb-6 border-b">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-red-500 text-red-700 dark:text-red-400'
                    : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Requirements Tab */}
      {activeTab === 'requirements' && !isLoading && (
        <div className="space-y-3">
          {requirements.length === 0 ? (
            <div className="border-theme-surface-border rounded-lg border border-dashed py-12 text-center">
              <Shield className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
              <p className="text-theme-text-muted mb-1">No screening requirements configured.</p>
              <p className="text-theme-text-muted text-sm">
                Add requirements to define what medical screenings members need.
              </p>
            </div>
          ) : (
            requirements.map((req) => (
              <div
                key={req.id}
                className="border-theme-surface-border bg-theme-surface flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-theme-text-primary text-sm font-medium">{req.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        req.is_active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                      }`}
                    >
                      {req.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {SCREENING_TYPE_LABELS[req.screening_type] ?? req.screening_type}
                    {req.frequency_months
                      ? ` — Every ${req.frequency_months} month${req.frequency_months === 1 ? '' : 's'}`
                      : ' — One-time'}
                    {req.applies_to_roles && req.applies_to_roles.length > 0
                      ? ` — ${req.applies_to_roles.join(', ')}`
                      : ''}
                  </p>
                  {req.description && (
                    <p className="text-theme-text-muted mt-1 text-xs">{req.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingRequirement(req);
                      setShowRequirementForm(true);
                    }}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    aria-label={`Edit ${req.name}`}
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ type: 'requirement', id: req.id, name: req.name })}
                    className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                    aria-label={`Delete ${req.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Records Tab */}
      {activeTab === 'records' && !isLoading && (
        <div className="space-y-3">
          {records.length === 0 ? (
            <div className="border-theme-surface-border rounded-lg border border-dashed py-12 text-center">
              <Stethoscope className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
              <p className="text-theme-text-muted mb-1">No screening records yet.</p>
              <p className="text-theme-text-muted text-sm">
                Add records as members complete their screenings.
              </p>
            </div>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                className="border-theme-surface-border bg-theme-surface flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-theme-text-primary text-sm font-medium">
                      {SCREENING_TYPE_LABELS[record.screening_type] ?? record.screening_type}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        SCREENING_STATUS_COLORS[record.status] ?? ''
                      }`}
                    >
                      {SCREENING_STATUS_LABELS[record.status] ?? record.status}
                    </span>
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {record.user_name ?? record.prospect_name ?? 'Unknown'}
                    {record.provider_name ? ` — ${record.provider_name}` : ''}
                    {record.scheduled_date ? ` — Scheduled: ${record.scheduled_date}` : ''}
                    {record.expiration_date ? ` — Expires: ${record.expiration_date}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingRecord(record);
                      setShowRecordForm(true);
                    }}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    aria-label="Edit record"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      setDeleteTarget({
                        type: 'record',
                        id: record.id,
                        name: SCREENING_TYPE_LABELS[record.screening_type] ?? record.screening_type,
                      })
                    }
                    className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                    aria-label="Delete record"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Compliance Tab */}
      {activeTab === 'compliance' && !isLoading && <ComplianceDashboard />}

      {/* Requirement Form Modal */}
      {showRequirementForm && (
        <ScreeningRequirementForm
          requirement={editingRequirement}
          onSave={handleSaveRequirement}
          onClose={() => {
            setShowRequirementForm(false);
            setEditingRequirement(null);
          }}
        />
      )}

      {/* Record Form Modal */}
      {showRecordForm && (
        <ScreeningRecordForm
          record={editingRecord}
          requirements={requirements}
          onSave={handleSaveRecord}
          onClose={() => {
            setShowRecordForm(false);
            setEditingRecord(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={`Delete ${deleteTarget?.type === 'requirement' ? 'Requirement' : 'Record'}`}
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};
