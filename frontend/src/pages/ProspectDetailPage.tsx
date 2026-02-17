/**
 * Prospect Detail Page
 *
 * Shows full details for a prospective member including their
 * personal information, pipeline progress, step completion controls,
 * notes, and activity log. Coordinators can complete steps,
 * advance the prospect, and transfer them to full membership.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { membershipPipelineService } from '../services/membershipPipelineApi';
import type {
  Prospect,
  StepProgress,
  ActivityLogEntry,
  TransferRequest,
} from '../services/membershipPipelineApi';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  SkipForward,
  ArrowRight,
  UserCheck,
  FileText,
  MessageSquare,
  Activity,
  X,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

export const ProspectDetailPage: React.FC = () => {
  const { prospectId } = useParams<{ prospectId: string }>();
  const navigate = useNavigate();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferData, setTransferData] = useState<TransferRequest>({
    username: '',
    rank: '',
    station: '',
    send_welcome_email: false,
  });
  const [transferError, setTransferError] = useState<string | null>(null);
  const [completingStepId, setCompletingStepId] = useState<string | null>(null);
  const [stepNotes, setStepNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'progress' | 'info' | 'activity'>('progress');

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('members.manage');

  const fetchProspect = useCallback(async () => {
    if (!prospectId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await membershipPipelineService.getProspect(prospectId);
      setProspect(data);
    } catch {
      setError('Failed to load prospect details');
    } finally {
      setLoading(false);
    }
  }, [prospectId]);

  const fetchActivityLog = useCallback(async () => {
    if (!prospectId) return;
    try {
      const data = await membershipPipelineService.getProspectActivity(prospectId);
      setActivityLog(data);
    } catch {
      // Non-critical, don't block the page
    }
  }, [prospectId]);

  useEffect(() => {
    fetchProspect();
    fetchActivityLog();
  }, [fetchProspect, fetchActivityLog]);

  const handleCompleteStep = async (stepId: string) => {
    if (!prospectId) return;
    try {
      await membershipPipelineService.completeStep(prospectId, stepId, stepNotes || undefined);
      setCompletingStepId(null);
      setStepNotes('');
      fetchProspect();
      fetchActivityLog();
    } catch {
      setError('Failed to complete step');
    }
  };

  const handleAdvance = async () => {
    if (!prospectId) return;
    try {
      await membershipPipelineService.advanceProspect(prospectId);
      fetchProspect();
      fetchActivityLog();
    } catch {
      setError('Failed to advance prospect');
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prospectId) return;
    try {
      setTransferError(null);
      const result = await membershipPipelineService.transferProspect(prospectId, transferData);
      if (result.success) {
        setShowTransferModal(false);
        fetchProspect();
        fetchActivityLog();
      }
    } catch (err: unknown) {
      setTransferError(getErrorMessage(err, 'Failed to transfer prospect'));
    }
  };

  const handleReject = async () => {
    if (!prospectId) return;
    try {
      await membershipPipelineService.updateProspect(prospectId, { status: 'rejected' });
      fetchProspect();
      fetchActivityLog();
    } catch {
      setError('Failed to update prospect status');
    }
  };

  const getStepIcon = (progress?: StepProgress) => {
    if (!progress) return <Circle className="h-5 w-5 text-theme-text-muted" />;
    switch (progress.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-700" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-700" />;
      case 'skipped':
        return <SkipForward className="h-5 w-5 text-yellow-700" />;
      default:
        return <Circle className="h-5 w-5 text-theme-text-muted" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-blue-500/20 text-blue-700 border-blue-500/30',
      approved: 'bg-green-500/20 text-green-700 border-green-500/30',
      rejected: 'bg-red-500/20 text-red-700 border-red-500/30',
      withdrawn: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
      transferred: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || styles.active}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-red-500" />
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="space-y-4">
        <Link to="/membership-pipeline" className="flex items-center gap-2 text-theme-text-muted hover:text-theme-text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to Pipeline
        </Link>
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-4">
          {error || 'Prospect not found'}
        </div>
      </div>
    );
  }

  const sortedProgress = (prospect.step_progress || []).sort((a, b) => {
    const aOrder = a.step?.sort_order ?? 0;
    const bOrder = b.step?.sort_order ?? 0;
    return aOrder - bOrder;
  });

  return (
    <div className="min-h-screen space-y-6">
      {/* Back link */}
      <Link to="/membership-pipeline" className="flex items-center gap-2 text-theme-text-muted hover:text-theme-text-primary transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Pipeline
      </Link>

      {/* Header */}
      <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 bg-theme-input-bg rounded-full flex items-center justify-center text-2xl font-bold text-theme-text-primary">
              {prospect.first_name[0]}{prospect.last_name[0]}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-text-primary">
                {prospect.first_name} {prospect.last_name}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                {getStatusBadge(prospect.status)}
                {prospect.pipeline_name && (
                  <span className="text-sm text-theme-text-muted">{prospect.pipeline_name}</span>
                )}
                {prospect.current_step && (
                  <>
                    <ChevronRight className="h-4 w-4 text-theme-text-muted" />
                    <span className="text-sm text-theme-text-secondary">{prospect.current_step.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {canManage && prospect.status === 'active' && (
            <div className="flex gap-2">
              <button
                onClick={handleAdvance}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <ArrowRight className="h-4 w-4" />
                Advance
              </button>
              <button
                onClick={() => setShowTransferModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
              >
                <UserCheck className="h-4 w-4" />
                Transfer to Member
              </button>
              <button
                onClick={handleReject}
                className="flex items-center gap-2 px-4 py-2 bg-theme-input-bg text-red-700 rounded-lg hover:bg-theme-surface-hover transition-colors text-sm"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}
          {prospect.status === 'transferred' && prospect.transferred_user_id && (
            <Link
              to={`/members/${prospect.transferred_user_id}`}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 text-purple-700 rounded-lg hover:bg-purple-600/30 transition-colors text-sm border border-purple-500/30"
            >
              <User className="h-4 w-4" />
              View Member Profile
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-theme-surface-border">
        <div className="flex gap-6">
          {(['progress', 'info', 'activity'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-red-500 text-theme-text-primary'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {tab === 'progress' && <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Pipeline Progress</span>}
              {tab === 'info' && <span className="flex items-center gap-2"><User className="h-4 w-4" />Personal Info</span>}
              {tab === 'activity' && <span className="flex items-center gap-2"><Activity className="h-4 w-4" />Activity Log</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'progress' && (
        <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Pipeline Steps</h2>
          <div className="space-y-1">
            {sortedProgress.map((progress, idx) => (
              <div
                key={progress.id}
                className={`flex items-start gap-4 p-4 rounded-lg transition-colors ${
                  progress.status === 'in_progress' ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-theme-input-bg/50'
                }`}
              >
                <div className="mt-0.5">{getStepIcon(progress)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-theme-text-primary">{progress.step?.name || 'Unknown Step'}</span>
                      {progress.step?.step_type && (
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                          progress.step.step_type === 'action'
                            ? 'bg-blue-500/20 text-blue-700'
                            : progress.step.step_type === 'note'
                            ? 'bg-yellow-500/20 text-yellow-700'
                            : 'bg-green-500/20 text-green-700'
                        }`}>
                          {progress.step.step_type}
                        </span>
                      )}
                      {progress.step?.required && (
                        <span className="ml-1 text-xs text-red-700">*</span>
                      )}
                    </div>
                    {progress.completed_at && (
                      <span className="text-xs text-theme-text-muted">
                        {new Date(progress.completed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {progress.step?.description && (
                    <p className="text-sm text-theme-text-muted mt-1">{progress.step.description}</p>
                  )}
                  {progress.notes && (
                    <div className="mt-2 bg-theme-input-bg/50 rounded-lg p-2 text-sm text-theme-text-secondary">
                      <MessageSquare className="h-3 w-3 inline mr-1 text-theme-text-muted" />
                      {progress.notes}
                    </div>
                  )}

                  {/* Complete Step action */}
                  {canManage && progress.status !== 'completed' && prospect.status === 'active' && (
                    <div className="mt-2">
                      {completingStepId === progress.step_id ? (
                        <div className="space-y-2">
                          <textarea
                            placeholder="Add notes (optional)..."
                            value={stepNotes}
                            onChange={e => setStepNotes(e.target.value)}
                            rows={2}
                            className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleCompleteStep(progress.step_id)}
                              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 transition-colors"
                            >
                              Complete Step
                            </button>
                            <button
                              onClick={() => { setCompletingStepId(null); setStepNotes(''); }}
                              className="px-3 py-1.5 bg-theme-input-bg text-theme-text-secondary rounded-lg text-xs hover:bg-theme-surface-hover transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setCompletingStepId(progress.step_id)}
                          className="text-xs text-blue-700 hover:text-blue-600 transition-colors"
                        >
                          Mark as complete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Contact Information</h2>
            <dl className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-theme-text-muted" />
                <dt className="text-sm text-theme-text-muted w-20">Email</dt>
                <dd className="text-sm text-theme-text-primary">{prospect.email}</dd>
              </div>
              {prospect.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-theme-text-muted" />
                  <dt className="text-sm text-theme-text-muted w-20">Phone</dt>
                  <dd className="text-sm text-theme-text-primary">{prospect.phone}</dd>
                </div>
              )}
              {prospect.mobile && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-theme-text-muted" />
                  <dt className="text-sm text-theme-text-muted w-20">Mobile</dt>
                  <dd className="text-sm text-theme-text-primary">{prospect.mobile}</dd>
                </div>
              )}
              {prospect.date_of_birth && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-theme-text-muted" />
                  <dt className="text-sm text-theme-text-muted w-20">DOB</dt>
                  <dd className="text-sm text-theme-text-primary">{new Date(prospect.date_of_birth).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Address</h2>
            {prospect.address_street ? (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-theme-text-muted mt-0.5" />
                <div className="text-sm text-theme-text-primary">
                  <div>{prospect.address_street}</div>
                  <div>{prospect.address_city}{prospect.address_state ? `, ${prospect.address_state}` : ''} {prospect.address_zip}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-theme-text-muted">No address provided</p>
            )}
          </div>
          <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Application Details</h2>
            <dl className="space-y-3">
              {prospect.interest_reason && (
                <div>
                  <dt className="text-sm text-theme-text-muted mb-1">Interest / Reason</dt>
                  <dd className="text-sm text-theme-text-primary bg-theme-input-bg/50 rounded-lg p-3">{prospect.interest_reason}</dd>
                </div>
              )}
              {prospect.referral_source && (
                <div>
                  <dt className="text-sm text-theme-text-muted">Referral Source</dt>
                  <dd className="text-sm text-theme-text-primary">{prospect.referral_source}</dd>
                </div>
              )}
              {prospect.notes && (
                <div>
                  <dt className="text-sm text-theme-text-muted mb-1">Notes</dt>
                  <dd className="text-sm text-theme-text-primary bg-theme-input-bg/50 rounded-lg p-3">{prospect.notes}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Dates</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-theme-text-muted">Added</dt>
                <dd className="text-sm text-theme-text-primary">{new Date(prospect.created_at).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-theme-text-muted">Last Updated</dt>
                <dd className="text-sm text-theme-text-primary">{new Date(prospect.updated_at).toLocaleString()}</dd>
              </div>
              {prospect.transferred_at && (
                <div className="flex justify-between">
                  <dt className="text-sm text-theme-text-muted">Transferred</dt>
                  <dd className="text-sm text-theme-text-primary">{new Date(prospect.transferred_at).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="bg-theme-input-bg/50 rounded-xl border border-theme-surface-border p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Activity Log</h2>
          {activityLog.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {activityLog.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-theme-input-bg/50">
                  <Activity className="h-4 w-4 text-theme-text-muted mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-theme-text-primary">
                        {entry.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                      <span className="text-xs text-theme-text-muted">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    {entry.performer_name && (
                      <span className="text-xs text-theme-text-muted">by {entry.performer_name}</span>
                    )}
                    {entry.details && (
                      <div className="mt-1 text-xs text-theme-text-muted">
                        {entry.details.notes ? <span>Note: {String(entry.details.notes)}</span> : null}
                        {entry.details.to_step_name ? <span>Moved to: {String(entry.details.to_step_name)}</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-surface rounded-xl border border-theme-surface-border w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-semibold text-theme-text-primary">Transfer to Membership</h2>
              <button onClick={() => setShowTransferModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleTransfer} className="p-6 space-y-4">
              <div className="bg-blue-900/30 border border-blue-700/30 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-700 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-700">
                  This will create a new member account for <strong>{prospect.first_name} {prospect.last_name}</strong> and
                  mark this prospect as transferred.
                </p>
              </div>
              {transferError && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm">
                  {transferError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Username</label>
                <input
                  type="text"
                  value={transferData.username || ''}
                  onChange={e => setTransferData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Auto-generated if left blank"
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Rank</label>
                  <input
                    type="text"
                    value={transferData.rank || ''}
                    onChange={e => setTransferData(prev => ({ ...prev, rank: e.target.value }))}
                    placeholder="e.g., Probationary"
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Station</label>
                  <input
                    type="text"
                    value={transferData.station || ''}
                    onChange={e => setTransferData(prev => ({ ...prev, station: e.target.value }))}
                    placeholder="e.g., Station 1"
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="send_welcome"
                  checked={transferData.send_welcome_email}
                  onChange={e => setTransferData(prev => ({ ...prev, send_welcome_email: e.target.checked }))}
                  className="rounded border-theme-input-border bg-theme-input-bg text-red-700 focus:ring-red-500"
                />
                <label htmlFor="send_welcome" className="text-sm text-theme-text-secondary">
                  Send welcome email with login credentials
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 bg-theme-input-bg text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Transfer to Membership
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProspectDetailPage;
