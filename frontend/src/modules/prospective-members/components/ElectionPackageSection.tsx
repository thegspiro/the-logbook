/**
 * Election Package Section
 *
 * Displays and manages the election package for an applicant
 * that is on the election vote stage. Extracted from ApplicantDetailDrawer.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Vote, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant } from '../types';
import { isSafeUrl } from '../utils';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { formatDateTime } from '../../../utils/dateFormatting';
import { ElectionStatus } from '../../../constants/enums';
import { electionService } from '../../../services/electionService';
import type { ElectionListItem } from '../../../types/election';

interface ElectionPackageSectionProps {
  applicant: Applicant;
  tz: string;
}

const ElectionPackageSection: React.FC<ElectionPackageSectionProps> = ({
  applicant,
  tz,
}) => {
  const navigate = useNavigate();

  const {
    fetchElectionPackage,
    updateElectionPackage,
    submitElectionPackage,
    assignPackageToElection,
    currentElectionPackage,
    isLoadingElectionPackage,
  } = useProspectiveMembersStore();

  const [pkgNotes, setPkgNotes] = useState('');
  const [pkgStatement, setPkgStatement] = useState('');
  const [isSubmittingPackage, setIsSubmittingPackage] = useState(false);

  const [showElectionPicker, setShowElectionPicker] = useState(false);
  const [draftElections, setDraftElections] = useState<ElectionListItem[]>([]);
  const [isLoadingDraftElections, setIsLoadingDraftElections] = useState(false);
  const [selectedElectionId, setSelectedElectionId] = useState('');
  const [isAssigningToElection, setIsAssigningToElection] = useState(false);

  // Load election package when component mounts or applicant changes
  useEffect(() => {
    void fetchElectionPackage(applicant.id);
  }, [applicant.id, fetchElectionPackage]);

  // Sync package fields to local state when package loads
  useEffect(() => {
    if (currentElectionPackage) {
      setPkgNotes(currentElectionPackage.coordinator_notes ?? '');
      setPkgStatement(currentElectionPackage.supporting_statement ?? '');
    } else {
      setPkgNotes('');
      setPkgStatement('');
    }
  }, [currentElectionPackage]);

  const handleSavePackage = async () => {
    if (!currentElectionPackage) return;
    try {
      await updateElectionPackage(applicant.id, {
        coordinator_notes: pkgNotes || undefined,
        supporting_statement: pkgStatement || undefined,
      });
      toast.success('Election package saved');
    } catch {
      toast.error('Failed to save election package');
    }
  };

  const handleSubmitPackage = async () => {
    setIsSubmittingPackage(true);
    try {
      if (currentElectionPackage) {
        await updateElectionPackage(applicant.id, {
          coordinator_notes: pkgNotes || undefined,
          supporting_statement: pkgStatement || undefined,
        });
      }
      await submitElectionPackage(applicant.id);
      toast.success('Election package marked as ready for ballot');
    } catch {
      toast.error('Failed to submit election package');
    } finally {
      setIsSubmittingPackage(false);
    }
  };

  const handleOpenElectionPicker = async () => {
    setShowElectionPicker(true);
    setIsLoadingDraftElections(true);
    try {
      const elections = await electionService.getElections('draft');
      setDraftElections(elections);
    } catch {
      toast.error('Failed to load draft elections');
    } finally {
      setIsLoadingDraftElections(false);
    }
  };

  const handleAssignToElection = async () => {
    if (!selectedElectionId) return;
    setIsAssigningToElection(true);
    try {
      await assignPackageToElection(applicant.id, selectedElectionId);
      const electionTitle = draftElections.find(
        (e) => e.id === selectedElectionId
      )?.title ?? 'election';
      toast.success(`Application added to "${electionTitle}" ballot`);
      setShowElectionPicker(false);
      setSelectedElectionId('');
    } catch {
      toast.error('Failed to assign package to election');
    } finally {
      setIsAssigningToElection(false);
    }
  };

  return (
    <div className="p-4 border-b border-theme-surface-border">
      <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
        Election Package
      </h3>
      {isLoadingElectionPackage ? (
        <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
        </div>
      ) : currentElectionPackage ? (
        <div className="space-y-3">
          {/* Package status badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">Status</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              currentElectionPackage.status === ElectionStatus.DRAFT
                ? 'bg-theme-surface-secondary text-theme-text-muted'
                : currentElectionPackage.status === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                  : currentElectionPackage.status === 'added_to_ballot'
                    ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300'
                    : currentElectionPackage.status === 'elected'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                      : 'bg-red-500/20 text-red-600 dark:text-red-300'
            }`}>
              {currentElectionPackage.status.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Applicant snapshot info */}
          <div className="bg-theme-surface rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-theme-text-muted">Name</span>
              <span className="text-theme-text-secondary">{currentElectionPackage.applicant_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text-muted">Membership Type</span>
              <span className="text-theme-text-secondary capitalize">{currentElectionPackage.target_membership_type}</span>
            </div>
            {currentElectionPackage.target_role_name && (
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Target Role</span>
                <span className="text-theme-text-secondary">{currentElectionPackage.target_role_name}</span>
              </div>
            )}
            {currentElectionPackage.documents && currentElectionPackage.documents.length > 0 && (
              <div className="pt-1">
                <span className="text-theme-text-muted">Documents:</span>
                <div className="mt-1 space-y-0.5">
                  {currentElectionPackage.documents.map((doc, i) => (
                    <div key={i} className="flex items-center gap-1 text-blue-700 dark:text-blue-400">
                      <FileText className="w-3 h-3" />
                      {isSafeUrl(doc.url) ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {doc.name}
                        </a>
                      ) : (
                        <span>{doc.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Editable fields -- only for draft packages */}
          {currentElectionPackage.status === ElectionStatus.DRAFT && (
            <>
              <div>
                <label className="block text-xs text-theme-text-muted mb-1">
                  Coordinator Notes
                </label>
                <textarea
                  value={pkgNotes}
                  onChange={(e) => setPkgNotes(e.target.value)}
                  placeholder="Internal notes about this applicant..."
                  rows={2}
                  className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-theme-text-muted mb-1">
                  Supporting Statement
                </label>
                <textarea
                  value={pkgStatement}
                  onChange={(e) => setPkgStatement(e.target.value)}
                  placeholder="Statement shown to voters on the ballot..."
                  rows={2}
                  className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { void handleSavePackage(); }}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => { void handleSubmitPackage(); }}
                  disabled={isSubmittingPackage}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmittingPackage && <Loader2 className="w-3 h-3 animate-spin" />}
                  <Vote className="w-3 h-3" />
                  Mark Ready for Ballot
                </button>
              </div>
            </>
          )}

          {/* Ready state -- assign to election */}
          {currentElectionPackage.status === 'ready' && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-emerald-600 dark:text-emerald-300">
                This package is ready for the secretary to add to a ballot.
                {currentElectionPackage.submitted_at && (
                  <> Submitted {formatDateTime(currentElectionPackage.submitted_at, tz)}.</>
                )}
              </p>
              {currentElectionPackage.coordinator_notes && (
                <p className="text-xs text-theme-text-muted">
                  Notes: {currentElectionPackage.coordinator_notes}
                </p>
              )}
              {!showElectionPicker ? (
                <button
                  onClick={() => { void handleOpenElectionPicker(); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  <Vote className="w-3 h-3" />
                  Assign to Election
                </button>
              ) : (
                <div className="space-y-2">
                  {isLoadingDraftElections ? (
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted" role="status" aria-live="polite">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading draft elections...
                    </div>
                  ) : draftElections.length === 0 ? (
                    <p className="text-xs text-theme-text-muted">
                      No draft elections available. Create one in the Elections module first.
                    </p>
                  ) : (
                    <>
                      <select
                        value={selectedElectionId}
                        onChange={(e) => setSelectedElectionId(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary"
                      >
                        <option value="">Select a draft election...</option>
                        {draftElections.map((el) => (
                          <option key={el.id} value={el.id}>{el.title}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { void handleAssignToElection(); }}
                          disabled={!selectedElectionId || isAssigningToElection}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isAssigningToElection && <Loader2 className="w-3 h-3 animate-spin" />}
                          Add to Ballot
                        </button>
                        <button
                          onClick={() => { setShowElectionPicker(false); setSelectedElectionId(''); }}
                          className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Added to ballot / election outcome info */}
          {(currentElectionPackage.status === 'added_to_ballot' ||
            currentElectionPackage.status === 'elected' ||
            currentElectionPackage.status === 'not_elected') && (
            <div className={`border rounded-lg p-3 ${
              currentElectionPackage.status === 'elected'
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : currentElectionPackage.status === 'not_elected'
                  ? 'bg-red-500/5 border-red-500/20'
                  : 'bg-purple-500/5 border-purple-500/20'
            }`}>
              <p className={`text-xs ${
                currentElectionPackage.status === 'elected'
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : currentElectionPackage.status === 'not_elected'
                    ? 'text-red-600 dark:text-red-300'
                    : 'text-purple-600 dark:text-purple-300'
              }`}>
                {currentElectionPackage.status === 'added_to_ballot' &&
                  'This applicant has been added to a ballot and is awaiting election results.'}
                {currentElectionPackage.status === 'elected' &&
                  'This applicant was elected. They can now be converted to a member.'}
                {currentElectionPackage.status === 'not_elected' &&
                  'This applicant was not elected by the membership vote.'}
              </p>
              {currentElectionPackage.election_id && currentElectionPackage.election_title && (
                <button
                  type="button"
                  onClick={() => navigate(`/elections/${currentElectionPackage.election_id}`)}
                  className="mt-1.5 text-xs text-theme-primary hover:underline"
                >
                  {currentElectionPackage.election_title}
                  {currentElectionPackage.election_status === 'open' && ' — Voting in progress'}
                  {currentElectionPackage.election_status === 'closed' && ' — Closed'}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted">
          No election package has been created yet. It will be auto-generated when the applicant reaches this stage.
        </p>
      )}
    </div>
  );
};

export default ElectionPackageSection;
