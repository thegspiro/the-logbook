/**
 * Shift Assignments Page
 *
 * Manages shift assignments, swap requests, and time-off requests.
 * Three tabs: Assignments, Swap Requests, Time Off.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  ArrowLeftRight,
  CalendarOff,
  Check,
  X,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Shield,
} from 'lucide-react';
import { schedulingService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatShortDateTime } from '../utils/dateFormatting';

// ============================================
// Interfaces
// ============================================

interface ShiftAssignment {
  id: string;
  organization_id: string;
  shift_id: string;
  user_id: string;
  user_name?: string;
  position: string;
  assignment_status: string;
  assigned_by?: string;
  confirmed_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface SwapRequest {
  id: string;
  organization_id: string;
  requesting_user_id: string;
  requesting_user_name?: string;
  target_user_id?: string;
  target_user_name?: string;
  offering_shift_id: string;
  offering_shift_date?: string;
  requesting_shift_id?: string;
  requesting_shift_date?: string;
  status: string;
  reason?: string;
  reviewed_by?: string;
  reviewer_notes?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

interface TimeOffRequest {
  id: string;
  organization_id: string;
  user_id: string;
  user_name?: string;
  start_date: string;
  end_date: string;
  status: string;
  reason?: string;
  reviewer_notes?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

interface ShiftRecord {
  id: string;
  shift_date: string;
  start_time: string;
  end_time?: string;
  notes?: string;
}

type TabView = 'assignments' | 'swaps' | 'timeoff';

const POSITIONS = [
  { value: 'officer', label: 'Officer' },
  { value: 'driver', label: 'Driver' },
  { value: 'firefighter', label: 'Firefighter' },
  { value: 'ems', label: 'EMS' },
  { value: 'captain', label: 'Captain' },
  { value: 'lieutenant', label: 'Lieutenant' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'other', label: 'Other' },
];

const statusStyles: Record<string, string> = {
  approved: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  confirmed: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  assigned: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  denied: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  declined: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
  no_show: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
};

// ============================================
// Assignment Form Modal
// ============================================

interface AssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  title: string;
  initialPosition?: string;
  initialNotes?: string;
  showUserField?: boolean;
}

const AssignmentFormModal: React.FC<AssignmentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  initialPosition,
  initialNotes,
  showUserField = true,
}) => {
  const [userId, setUserId] = useState('');
  const [position, setPosition] = useState(initialPosition || 'firefighter');
  const [notes, setNotes] = useState(initialNotes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setUserId('');
    setPosition(initialPosition || 'firefighter');
    setNotes(initialNotes || '');
  }, [isOpen, initialPosition, initialNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = { position };
      if (showUserField && userId) payload.user_id = userId;
      if (notes) payload.notes = notes;
      if (!showUserField) payload.assignment_status = position; // reuse for update
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save assignment'));
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
      aria-labelledby="assignment-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="assignment-modal-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {showUserField && (
            <div>
              <label htmlFor="assign-user" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Member User ID <span aria-hidden="true">*</span>
              </label>
              <input
                id="assign-user"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                placeholder="Enter member UUID"
                required
                aria-required="true"
              />
            </div>
          )}

          <div>
            <label htmlFor="assign-position" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Position <span aria-hidden="true">*</span>
            </label>
            <select
              id="assign-position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
            >
              {POSITIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="assign-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Notes
            </label>
            <textarea
              id="assign-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={2}
              placeholder="Optional notes"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Swap Request Form Modal
// ============================================

interface SwapFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

const SwapRequestFormModal: React.FC<SwapFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [offeringShiftId, setOfferingShiftId] = useState('');
  const [requestingShiftId, setRequestingShiftId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setOfferingShiftId('');
    setRequestingShiftId('');
    setTargetUserId('');
    setReason('');
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        offering_shift_id: offeringShiftId,
      };
      if (requestingShiftId) payload.requesting_shift_id = requestingShiftId;
      if (targetUserId) payload.target_user_id = targetUserId;
      if (reason) payload.reason = reason;
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create swap request'));
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
      aria-labelledby="swap-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="swap-modal-title" className="text-xl font-bold text-theme-text-primary">Request Shift Swap</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="swap-offering" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Offering Shift ID <span aria-hidden="true">*</span>
            </label>
            <input
              id="swap-offering"
              type="text"
              value={offeringShiftId}
              onChange={(e) => setOfferingShiftId(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Shift ID you want to swap"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="swap-requesting" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Requesting Shift ID
            </label>
            <input
              id="swap-requesting"
              type="text"
              value={requestingShiftId}
              onChange={(e) => setRequestingShiftId(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Shift ID you want in return (optional)"
            />
          </div>

          <div>
            <label htmlFor="swap-target" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Target Member ID
            </label>
            <input
              id="swap-target"
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Target member UUID (optional)"
            />
          </div>

          <div>
            <label htmlFor="swap-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Reason
            </label>
            <textarea
              id="swap-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={3}
              placeholder="Why are you requesting this swap?"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Time Off Form Modal
// ============================================

interface TimeOffFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

const TimeOffFormModal: React.FC<TimeOffFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setStartDate('');
    setEndDate('');
    setReason('');
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        start_date: startDate,
        end_date: endDate,
      };
      if (reason) payload.reason = reason;
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create time-off request'));
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
      aria-labelledby="timeoff-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="timeoff-modal-title" className="text-xl font-bold text-theme-text-primary">Request Time Off</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="timeoff-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Start Date <span aria-hidden="true">*</span>
              </label>
              <input
                id="timeoff-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
              />
            </div>
            <div>
              <label htmlFor="timeoff-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
                End Date <span aria-hidden="true">*</span>
              </label>
              <input
                id="timeoff-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="timeoff-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Reason
            </label>
            <textarea
              id="timeoff-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={3}
              placeholder="Reason for time off"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================
// Review Modal (for swap and time-off)
// ============================================

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (status: string, notes: string) => Promise<void>;
  title: string;
  itemDescription: string;
}

const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, onClose, onSubmit, title, itemDescription }) => {
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setReviewNotes('');
  }, [isOpen]);

  const handleAction = async (status: string) => {
    setIsSubmitting(true);
    try {
      await onSubmit(status, reviewNotes);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed to ${status} request`));
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
      aria-labelledby="review-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="review-modal-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
            <p className="text-sm text-theme-text-primary">{itemDescription}</p>
          </div>

          <div>
            <label htmlFor="review-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Reviewer Notes
            </label>
            <textarea
              id="review-notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={3}
              placeholder="Optional notes for this review"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={() => handleAction('denied')}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-red-700 dark:text-red-400 rounded-lg border border-theme-surface-border disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
              Deny
            </button>
            <button
              onClick={() => handleAction('approved')}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// Main Page
// ============================================

export const ShiftAssignmentsPage: React.FC = () => {
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<TabView>('assignments');
  const [loading, setLoading] = useState(true);

  // Assignments state
  const [shiftIdInput, setShiftIdInput] = useState('');
  const [currentShiftId, setCurrentShiftId] = useState('');
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<ShiftAssignment | null>(null);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Swap Requests state
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [swapStatusFilter, setSwapStatusFilter] = useState('');
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [reviewingSwap, setReviewingSwap] = useState<SwapRequest | null>(null);
  const [cancellingSwapId, setCancellingSwapId] = useState<string | null>(null);

  // Time Off state
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [timeOffStatusFilter, setTimeOffStatusFilter] = useState('');
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [reviewingTimeOff, setReviewingTimeOff] = useState<TimeOffRequest | null>(null);
  const [cancellingTimeOffId, setCancellingTimeOffId] = useState<string | null>(null);

  // Load assignments for a specific shift
  const loadAssignments = useCallback(async (shiftId: string) => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const data = await schedulingService.getShiftAssignments(shiftId);
      setAssignments(data as unknown as ShiftAssignment[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load assignments'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load swap requests
  const loadSwapRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (swapStatusFilter) params.status = swapStatusFilter;
      const data = await schedulingService.getSwapRequests(params as Record<string, string>);
      setSwapRequests(data as unknown as SwapRequest[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load swap requests'));
    } finally {
      setLoading(false);
    }
  }, [swapStatusFilter]);

  // Load time-off requests
  const loadTimeOffRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (timeOffStatusFilter) params.status = timeOffStatusFilter;
      const data = await schedulingService.getTimeOffRequests(params as Record<string, string>);
      setTimeOffRequests(data as unknown as TimeOffRequest[]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load time-off requests'));
    } finally {
      setLoading(false);
    }
  }, [timeOffStatusFilter]);

  // Effect to load data based on active tab
  useEffect(() => {
    if (activeTab === 'assignments' && currentShiftId) {
      loadAssignments(currentShiftId);
    } else if (activeTab === 'swaps') {
      loadSwapRequests();
    } else if (activeTab === 'timeoff') {
      loadTimeOffRequests();
    } else {
      setLoading(false);
    }
  }, [activeTab, currentShiftId, loadAssignments, loadSwapRequests, loadTimeOffRequests]);

  // Assignment handlers
  const handleLookupShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (shiftIdInput.trim()) {
      setCurrentShiftId(shiftIdInput.trim());
    }
  };

  const handleCreateAssignment = async (data: Record<string, unknown>) => {
    await schedulingService.createAssignment(currentShiftId, data);
    toast.success('Assignment created');
    loadAssignments(currentShiftId);
  };

  const handleUpdateAssignment = async (data: Record<string, unknown>) => {
    if (!editingAssignment) return;
    await schedulingService.updateAssignment(editingAssignment.id, data);
    toast.success('Assignment updated');
    setEditingAssignment(null);
    loadAssignments(currentShiftId);
  };

  const handleDeleteAssignment = async (id: string) => {
    setDeletingAssignmentId(id);
    try {
      await schedulingService.deleteAssignment(id);
      toast.success('Assignment removed');
      loadAssignments(currentShiftId);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove assignment'));
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  const handleConfirmAssignment = async (id: string) => {
    setConfirmingId(id);
    try {
      await schedulingService.confirmAssignment(id);
      toast.success('Assignment confirmed');
      loadAssignments(currentShiftId);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to confirm assignment'));
    } finally {
      setConfirmingId(null);
    }
  };

  // Swap handlers
  const handleCreateSwap = async (data: Record<string, unknown>) => {
    await schedulingService.createSwapRequest(data);
    toast.success('Swap request created');
    loadSwapRequests();
  };

  const handleReviewSwap = async (status: string, notes: string) => {
    if (!reviewingSwap) return;
    await schedulingService.reviewSwapRequest(reviewingSwap.id, {
      status,
      reviewer_notes: notes || undefined,
    });
    toast.success(`Swap request ${status}`);
    setReviewingSwap(null);
    loadSwapRequests();
  };

  const handleCancelSwap = async (id: string) => {
    setCancellingSwapId(id);
    try {
      await schedulingService.cancelSwapRequest(id);
      toast.success('Swap request cancelled');
      loadSwapRequests();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to cancel swap request'));
    } finally {
      setCancellingSwapId(null);
    }
  };

  // Time-off handlers
  const handleCreateTimeOff = async (data: Record<string, unknown>) => {
    await schedulingService.createTimeOff(data);
    toast.success('Time-off request created');
    loadTimeOffRequests();
  };

  const handleReviewTimeOff = async (status: string, notes: string) => {
    if (!reviewingTimeOff) return;
    await schedulingService.reviewTimeOff(reviewingTimeOff.id, {
      status,
      reviewer_notes: notes || undefined,
    });
    toast.success(`Time-off request ${status}`);
    setReviewingTimeOff(null);
    loadTimeOffRequests();
  };

  const handleCancelTimeOff = async (id: string) => {
    setCancellingTimeOffId(id);
    try {
      await schedulingService.cancelTimeOff(id);
      toast.success('Time-off request cancelled');
      loadTimeOffRequests();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to cancel time-off request'));
    } finally {
      setCancellingTimeOffId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
            <Users className="w-7 h-7" aria-hidden="true" />
            Assignments & Requests
          </h1>
          <p className="text-theme-text-muted mt-1">Manage shift assignments, swap requests, and time off</p>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'assignments') setShowAssignModal(true);
            else if (activeTab === 'swaps') setShowSwapModal(true);
            else setShowTimeOffModal(true);
          }}
          disabled={activeTab === 'assignments' && !currentShiftId}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          {activeTab === 'assignments' ? 'Assign Member' : activeTab === 'swaps' ? 'New Swap Request' : 'Request Time Off'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="Assignment management">
        <button
          onClick={() => setActiveTab('assignments')}
          role="tab"
          aria-selected={activeTab === 'assignments'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'assignments'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Users className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Assignments
        </button>
        <button
          onClick={() => setActiveTab('swaps')}
          role="tab"
          aria-selected={activeTab === 'swaps'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'swaps'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Swap Requests ({swapRequests.length})
        </button>
        <button
          onClick={() => setActiveTab('timeoff')}
          role="tab"
          aria-selected={activeTab === 'timeoff'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'timeoff'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <CalendarOff className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Time Off ({timeOffRequests.length})
        </button>
      </div>

      {/* ============================== */}
      {/* Assignments Tab */}
      {/* ============================== */}
      {activeTab === 'assignments' && (
        <div role="tabpanel">
          {/* Shift ID Lookup */}
          <form onSubmit={handleLookupShift} className="mb-6 flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="shift-lookup" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Shift ID
              </label>
              <input
                id="shift-lookup"
                type="text"
                value={shiftIdInput}
                onChange={(e) => setShiftIdInput(e.target.value)}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                placeholder="Enter a Shift ID to view its assignments"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
            >
              Look Up
            </button>
          </form>

          {!currentShiftId ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Enter a Shift ID</h3>
              <p className="text-theme-text-muted">Enter a shift ID above to view and manage its assignments</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading assignments...</span>
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Assignments</h3>
              <p className="text-theme-text-muted mb-4">No members assigned to this shift yet</p>
              <button
                onClick={() => setShowAssignModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Assign Member
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border">
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Member</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Position</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Confirmed</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Notes</th>
                    <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                      <td className="py-3 px-4 text-theme-text-primary font-medium">
                        {a.user_name || a.user_id}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                          <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
                          {POSITIONS.find(p => p.value === a.position)?.label || a.position}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          statusStyles[a.assignment_status] || statusStyles.pending
                        }`}>
                          {a.assignment_status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-theme-text-secondary">
                        {a.confirmed_at ? formatShortDateTime(a.confirmed_at, tz) : '-'}
                      </td>
                      <td className="py-3 px-4 text-theme-text-muted max-w-xs truncate">
                        {a.notes || '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {a.assignment_status === 'assigned' && (
                            <button
                              onClick={() => handleConfirmAssignment(a.id)}
                              disabled={confirmingId === a.id}
                              className="p-1 text-theme-text-muted hover:text-green-600 dark:hover:text-green-400 rounded"
                              aria-label="Confirm assignment"
                            >
                              {confirmingId === a.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Check className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => setEditingAssignment(a)}
                            className="p-1 text-theme-text-muted hover:text-theme-text-primary rounded"
                            aria-label="Edit assignment"
                          >
                            <Edit2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => handleDeleteAssignment(a.id)}
                            disabled={deletingAssignmentId === a.id}
                            className="p-1 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50"
                            aria-label="Remove assignment"
                          >
                            {deletingAssignmentId === a.id ? (
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
        </div>
      )}

      {/* ============================== */}
      {/* Swap Requests Tab */}
      {/* ============================== */}
      {activeTab === 'swaps' && (
        <div role="tabpanel">
          {/* Filter */}
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="swap-status-filter" className="text-sm text-theme-text-secondary">Filter by status:</label>
            <select
              id="swap-status-filter"
              value={swapStatusFilter}
              onChange={(e) => setSwapStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading swap requests...</span>
            </div>
          ) : swapRequests.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <ArrowLeftRight className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Swap Requests</h3>
              <p className="text-theme-text-muted mb-4">No shift swap requests found</p>
              <button
                onClick={() => setShowSwapModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Request Swap
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {swapRequests.map(sr => (
                <div
                  key={sr.id}
                  className="bg-theme-surface-secondary rounded-lg p-4 border border-theme-surface-border"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          statusStyles[sr.status] || statusStyles.pending
                        }`}>
                          {sr.status}
                        </span>
                        <span className="text-sm text-theme-text-muted">
                          Requested {formatDate(sr.created_at, tz)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-theme-text-muted">Requesting Member</p>
                          <p className="text-theme-text-primary font-medium">{sr.requesting_user_name || sr.requesting_user_id}</p>
                        </div>
                        {sr.target_user_name && (
                          <div>
                            <p className="text-theme-text-muted">Target Member</p>
                            <p className="text-theme-text-primary font-medium">{sr.target_user_name}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-theme-text-muted">Offering Shift</p>
                          <p className="text-theme-text-primary">
                            {sr.offering_shift_date ? formatDate(sr.offering_shift_date, tz) : sr.offering_shift_id.slice(0, 8) + '...'}
                          </p>
                        </div>
                        {sr.requesting_shift_id && (
                          <div>
                            <p className="text-theme-text-muted">Requesting Shift</p>
                            <p className="text-theme-text-primary">
                              {sr.requesting_shift_date ? formatDate(sr.requesting_shift_date, tz) : sr.requesting_shift_id.slice(0, 8) + '...'}
                            </p>
                          </div>
                        )}
                      </div>
                      {sr.reason && (
                        <p className="text-sm text-theme-text-muted mt-2">
                          <span className="font-medium text-theme-text-secondary">Reason:</span> {sr.reason}
                        </p>
                      )}
                      {sr.reviewer_notes && (
                        <p className="text-sm text-theme-text-muted mt-1">
                          <span className="font-medium text-theme-text-secondary">Reviewer notes:</span> {sr.reviewer_notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {sr.status === 'pending' && (
                        <>
                          <button
                            onClick={() => setReviewingSwap(sr)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
                            aria-label="Review swap request"
                          >
                            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                            Review
                          </button>
                          <button
                            onClick={() => handleCancelSwap(sr.id)}
                            disabled={cancellingSwapId === sr.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary text-sm rounded-lg disabled:opacity-50"
                            aria-label="Cancel swap request"
                          >
                            {cancellingSwapId === sr.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Time Off Tab */}
      {/* ============================== */}
      {activeTab === 'timeoff' && (
        <div role="tabpanel">
          {/* Filter */}
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="timeoff-status-filter" className="text-sm text-theme-text-secondary">Filter by status:</label>
            <select
              id="timeoff-status-filter"
              value={timeOffStatusFilter}
              onChange={(e) => setTimeOffStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading time-off requests...</span>
            </div>
          ) : timeOffRequests.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <CalendarOff className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Time-Off Requests</h3>
              <p className="text-theme-text-muted mb-4">No time-off requests found</p>
              <button
                onClick={() => setShowTimeOffModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Request Time Off
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border">
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Member</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Start</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">End</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Reason</th>
                    <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Reviewer Notes</th>
                    <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {timeOffRequests.map(tor => (
                    <tr key={tor.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                      <td className="py-3 px-4 text-theme-text-primary font-medium">
                        {tor.user_name || tor.user_id}
                      </td>
                      <td className="py-3 px-4 text-theme-text-secondary">{formatDate(tor.start_date, tz)}</td>
                      <td className="py-3 px-4 text-theme-text-secondary">{formatDate(tor.end_date, tz)}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          statusStyles[tor.status] || statusStyles.pending
                        }`}>
                          {tor.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-theme-text-muted max-w-xs truncate">{tor.reason || '-'}</td>
                      <td className="py-3 px-4 text-theme-text-muted max-w-xs truncate">{tor.reviewer_notes || '-'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {tor.status === 'pending' && (
                            <>
                              <button
                                onClick={() => setReviewingTimeOff(tor)}
                                className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                                aria-label="Review time-off request"
                              >
                                <Shield className="w-3 h-3" aria-hidden="true" />
                                Review
                              </button>
                              <button
                                onClick={() => handleCancelTimeOff(tor.id)}
                                disabled={cancellingTimeOffId === tor.id}
                                className="flex items-center gap-1 px-2 py-1 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary text-xs rounded disabled:opacity-50"
                                aria-label="Cancel time-off request"
                              >
                                {cancellingTimeOffId === tor.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                                ) : (
                                  <X className="w-3 h-3" aria-hidden="true" />
                                )}
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Modals */}
      {/* ============================== */}

      {/* Create Assignment */}
      <AssignmentFormModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onSubmit={handleCreateAssignment}
        title="Assign Member to Shift"
        showUserField={true}
      />

      {/* Edit Assignment */}
      <AssignmentFormModal
        isOpen={!!editingAssignment}
        onClose={() => setEditingAssignment(null)}
        onSubmit={handleUpdateAssignment}
        title="Edit Assignment"
        initialPosition={editingAssignment?.position}
        initialNotes={editingAssignment?.notes || ''}
        showUserField={false}
      />

      {/* Swap Request */}
      <SwapRequestFormModal
        isOpen={showSwapModal}
        onClose={() => setShowSwapModal(false)}
        onSubmit={handleCreateSwap}
      />

      {/* Review Swap */}
      <ReviewModal
        isOpen={!!reviewingSwap}
        onClose={() => setReviewingSwap(null)}
        onSubmit={handleReviewSwap}
        title="Review Swap Request"
        itemDescription={
          reviewingSwap
            ? `${reviewingSwap.requesting_user_name || 'Member'} wants to swap shift ${
                reviewingSwap.offering_shift_date
                  ? formatDate(reviewingSwap.offering_shift_date, tz)
                  : reviewingSwap.offering_shift_id.slice(0, 8) + '...'
              }${reviewingSwap.reason ? ` - Reason: ${reviewingSwap.reason}` : ''}`
            : ''
        }
      />

      {/* Time Off Request */}
      <TimeOffFormModal
        isOpen={showTimeOffModal}
        onClose={() => setShowTimeOffModal(false)}
        onSubmit={handleCreateTimeOff}
      />

      {/* Review Time Off */}
      <ReviewModal
        isOpen={!!reviewingTimeOff}
        onClose={() => setReviewingTimeOff(null)}
        onSubmit={handleReviewTimeOff}
        title="Review Time-Off Request"
        itemDescription={
          reviewingTimeOff
            ? `${reviewingTimeOff.user_name || 'Member'} requests time off from ${formatDate(reviewingTimeOff.start_date, tz)} to ${formatDate(reviewingTimeOff.end_date, tz)}${reviewingTimeOff.reason ? ` - Reason: ${reviewingTimeOff.reason}` : ''}`
            : ''
        }
      />
    </div>
  );
};

export default ShiftAssignmentsPage;
