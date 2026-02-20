/**
 * Shift Calls Panel
 *
 * A panel component for managing call records associated with a shift.
 * Supports creating, editing, and deleting call records.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  Phone,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Clock,
  AlertCircle,
  X,
} from 'lucide-react';
import { schedulingService } from '../services/api';

// ============================================
// Interfaces
// ============================================

interface ShiftCall {
  id: string;
  organization_id: string;
  shift_id: string;
  incident_number?: string;
  incident_type: string;
  dispatched_at?: string;
  on_scene_at?: string;
  cleared_at?: string;
  cancelled_en_route: boolean;
  medical_refusal: boolean;
  responding_members?: string[];
  notes?: string;
  created_at: string;
}

interface ShiftCallFormData {
  incident_number: string;
  incident_type: string;
  dispatched_at: string;
  on_scene_at: string;
  cleared_at: string;
  cancelled_en_route: boolean;
  medical_refusal: boolean;
  responding_members: string;
  notes: string;
}

interface ShiftCallsPanelProps {
  shiftId: string;
}

const INCIDENT_TYPES = [
  'Fire',
  'EMS',
  'MVA',
  'Hazmat',
  'Rescue',
  'Alarm',
  'Public Assist',
  'Mutual Aid',
  'Other',
];

const emptyFormData: ShiftCallFormData = {
  incident_number: '',
  incident_type: 'Fire',
  dispatched_at: '',
  on_scene_at: '',
  cleared_at: '',
  cancelled_en_route: false,
  medical_refusal: false,
  responding_members: '',
  notes: '',
};

// ============================================
// Call Form Modal
// ============================================

interface CallFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: ShiftCallFormData;
  title: string;
}

const CallFormModal: React.FC<CallFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
}) => {
  const [formData, setFormData] = useState<ShiftCallFormData>(initialData || emptyFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData(emptyFormData);
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        incident_type: formData.incident_type,
        cancelled_en_route: formData.cancelled_en_route,
        medical_refusal: formData.medical_refusal,
      };
      if (formData.incident_number) payload.incident_number = formData.incident_number;
      if (formData.dispatched_at) payload.dispatched_at = formData.dispatched_at;
      if (formData.on_scene_at) payload.on_scene_at = formData.on_scene_at;
      if (formData.cleared_at) payload.cleared_at = formData.cleared_at;
      if (formData.notes) payload.notes = formData.notes;
      if (formData.responding_members.trim()) {
        payload.responding_members = formData.responding_members.split(',').map(m => m.trim()).filter(Boolean);
      }
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save call'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-form-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="call-form-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-theme-text-muted hover:text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="call-incident-number" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Incident Number
              </label>
              <input
                id="call-incident-number"
                type="text"
                value={formData.incident_number}
                onChange={(e) => setFormData(prev => ({ ...prev, incident_number: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                placeholder="e.g., 2026-001"
              />
            </div>
            <div>
              <label htmlFor="call-incident-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Incident Type <span aria-hidden="true">*</span>
              </label>
              <select
                id="call-incident-type"
                value={formData.incident_type}
                onChange={(e) => setFormData(prev => ({ ...prev, incident_type: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
              >
                {INCIDENT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="call-dispatched" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Dispatched At
              </label>
              <input
                id="call-dispatched"
                type="datetime-local"
                step="900"
                value={formData.dispatched_at}
                onChange={(e) => setFormData(prev => ({ ...prev, dispatched_at: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="call-on-scene" className="block text-sm font-medium text-theme-text-secondary mb-1">
                On Scene At
              </label>
              <input
                id="call-on-scene"
                type="datetime-local"
                step="900"
                value={formData.on_scene_at}
                onChange={(e) => setFormData(prev => ({ ...prev, on_scene_at: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="call-cleared" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Cleared At
              </label>
              <input
                id="call-cleared"
                type="datetime-local"
                step="900"
                value={formData.cleared_at}
                onChange={(e) => setFormData(prev => ({ ...prev, cleared_at: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={formData.cancelled_en_route}
                onChange={(e) => setFormData(prev => ({ ...prev, cancelled_en_route: e.target.checked }))}
                className="rounded border-theme-input-border focus:ring-2 focus:ring-blue-500"
              />
              Cancelled En Route
            </label>
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={formData.medical_refusal}
                onChange={(e) => setFormData(prev => ({ ...prev, medical_refusal: e.target.checked }))}
                className="rounded border-theme-input-border focus:ring-2 focus:ring-blue-500"
              />
              Medical Refusal
            </label>
          </div>

          <div>
            <label htmlFor="call-responding" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Responding Members
            </label>
            <input
              id="call-responding"
              type="text"
              value={formData.responding_members}
              onChange={(e) => setFormData(prev => ({ ...prev, responding_members: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Comma-separated names or IDs"
            />
          </div>

          <div>
            <label htmlFor="call-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Notes
            </label>
            <textarea
              id="call-notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={3}
              placeholder="Optional notes about this call"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-theme-text-secondary hover:text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Main Panel
// ============================================

export const ShiftCallsPanel: React.FC<ShiftCallsPanelProps> = ({ shiftId }) => {
  const [calls, setCalls] = useState<ShiftCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCall, setEditingCall] = useState<ShiftCall | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schedulingService.getShiftCalls(shiftId);
      setCalls(data as unknown as ShiftCall[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load calls'));
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  const handleCreate = async (data: Record<string, unknown>) => {
    await schedulingService.createCall(shiftId, data);
    toast.success('Call record created');
    loadCalls();
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editingCall) return;
    await schedulingService.updateCall(editingCall.id, data);
    toast.success('Call record updated');
    setEditingCall(null);
    loadCalls();
  };

  const handleDelete = async (callId: string) => {
    setDeletingId(callId);
    try {
      await schedulingService.deleteCall(callId);
      toast.success('Call record deleted');
      loadCalls();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete call'));
    } finally {
      setDeletingId(null);
    }
  };

  const toFormData = (call: ShiftCall): ShiftCallFormData => ({
    incident_number: call.incident_number || '',
    incident_type: call.incident_type,
    dispatched_at: call.dispatched_at ? call.dispatched_at.slice(0, 16) : '',
    on_scene_at: call.on_scene_at ? call.on_scene_at.slice(0, 16) : '',
    cleared_at: call.cleared_at ? call.cleared_at.slice(0, 16) : '',
    cancelled_en_route: call.cancelled_en_route,
    medical_refusal: call.medical_refusal,
    responding_members: call.responding_members?.join(', ') || '',
    notes: call.notes || '',
  });

  const formatTime = (dt?: string) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <Phone className="w-5 h-5" aria-hidden="true" />
          Calls ({calls.length})
        </h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add Call
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-8" role="status" aria-live="polite">
          <RefreshCw className="w-6 h-6 text-theme-text-muted animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading calls...</span>
        </div>
      ) : calls.length === 0 ? (
        <div className="text-center py-8 bg-theme-surface rounded-lg border border-theme-surface-border">
          <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
          <p className="text-theme-text-muted">No calls recorded for this shift</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-theme-surface-border">
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">Incident #</th>
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">Type</th>
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">Dispatched</th>
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">On Scene</th>
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">Cleared</th>
                <th className="text-left py-2 px-3 text-theme-text-secondary font-medium">Flags</th>
                <th className="text-right py-2 px-3 text-theme-text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(call => (
                <tr key={call.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                  <td className="py-2 px-3 text-theme-text-primary">{call.incident_number || '-'}</td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                      {call.incident_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-theme-text-secondary">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {formatTime(call.dispatched_at)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-theme-text-secondary">{formatTime(call.on_scene_at)}</td>
                  <td className="py-2 px-3 text-theme-text-secondary">{formatTime(call.cleared_at)}</td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      {call.cancelled_en_route && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                          Cancelled
                        </span>
                      )}
                      {call.medical_refusal && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
                          Refusal
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingCall(call)}
                        className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Edit call ${call.incident_number || call.id}`}
                      >
                        <Edit2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => handleDelete(call.id)}
                        disabled={deletingId === call.id}
                        className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                        aria-label={`Delete call ${call.incident_number || call.id}`}
                      >
                        {deletingId === call.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      <CallFormModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
        title="Add Call Record"
      />

      {/* Edit Modal */}
      <CallFormModal
        isOpen={!!editingCall}
        onClose={() => setEditingCall(null)}
        onSubmit={handleUpdate}
        initialData={editingCall ? toFormData(editingCall) : undefined}
        title="Edit Call Record"
      />
    </div>
  );
};

export default ShiftCallsPanel;
