/**
 * electionService — extracted from services/api.ts
 */

import api from './apiClient';
import type {
  Attendee,
  AttendeeCheckInResponse,
  BallotItem,
  BallotItemVote,
  BallotLookupResponse,
  BallotPreview,
  BallotSubmissionResponse,
  BallotTemplate,
  BulkVoteItem,
  Candidate,
  CandidateCreate,
  CandidateUpdate,
  Election,
  ElectionCreate,
  ElectionDeleteResponse,
  ElectionListItem,
  ElectionReportResponse,
  ElectionResults,
  ElectionSettings,
  ElectionStats,
  ElectionUpdate,
  EligibilityRoster,
  EmailBallot,
  EmailBallotResponse,
  ForensicsReport,
  ImportMeetingAttendeesResponse,
  ManualBallotBatch,
  PackageRecipient,
  PackageVariant,
  PreMeetingPackageResponse,
  PreMeetingPackageSend,
  ProxyAuthorization,
  ProxyAuthorizationCreate,
  ProxyVoteCreate,
  SavedBallotTemplate,
  Vote,
  VoteCreate,
  VoteIntegrityResult,
  VoteReceiptResponse,
  VoterEligibility,
  VoterOverride,
  VoterOverrideCreate,
  BulkVoterOverrideCreate,
} from '../types/election';
import { asArray } from '../utils/asArray';

export const electionService = {
  /**
   * Get all elections
   */
  async getElections(statusFilter?: string): Promise<ElectionListItem[]> {
    const response = await api.get<ElectionListItem[]>('/elections', {
      params: { status_filter: statusFilter },
    });
    return asArray(response.data);
  },

  async getElectionsByEvent(eventId: string): Promise<ElectionListItem[]> {
    const response = await api.get<ElectionListItem[]>('/elections', {
      params: { event_id: eventId },
    });
    return asArray(response.data);
  },

  async getElectionsByMeeting(meetingId: string): Promise<ElectionListItem[]> {
    const response = await api.get<ElectionListItem[]>('/elections', {
      params: { meeting_id: meetingId },
    });
    return asArray(response.data);
  },

  /**
   * Get a specific election
   */
  async getElection(electionId: string): Promise<Election> {
    const response = await api.get<Election>(`/elections/${electionId}`);
    return response.data;
  },

  /**
   * Create a new election
   */
  async createElection(electionData: ElectionCreate): Promise<Election> {
    const response = await api.post<Election>('/elections', electionData);
    return response.data;
  },

  /**
   * Update an election
   */
  async updateElection(electionId: string, electionData: ElectionUpdate): Promise<Election> {
    const response = await api.patch<Election>(`/elections/${electionId}`, electionData);
    return response.data;
  },

  /**
   * Delete an election (reason required for non-draft elections)
   */
  async deleteElection(electionId: string, reason?: string): Promise<ElectionDeleteResponse> {
    const response = await api.delete<ElectionDeleteResponse>(`/elections/${electionId}`, {
      data: reason ? { reason } : undefined,
    });
    return response.data;
  },

  /**
   * Open an election for voting
   */
  async openElection(electionId: string): Promise<Election> {
    const response = await api.post<Election>(`/elections/${electionId}/open`);
    return response.data;
  },

  /**
   * Close an election
   */
  async closeElection(electionId: string): Promise<Election> {
    const response = await api.post<Election>(`/elections/${electionId}/close`);
    return response.data;
  },

  /**
   * Rollback an election to previous status
   */
  async rollbackElection(
    electionId: string,
    reason: string
  ): Promise<{ success: boolean; election: Election; message: string; notifications_sent: number }> {
    const response = await api.post<{
      success: boolean;
      election: Election;
      message: string;
      notifications_sent: number;
    }>(`/elections/${electionId}/rollback`, { reason });
    return response.data;
  },

  /**
   * Get candidates for an election
   */
  async getCandidates(electionId: string): Promise<Candidate[]> {
    const response = await api.get<Candidate[]>(`/elections/${electionId}/candidates`);
    return asArray(response.data);
  },

  /**
   * Add a candidate to an election
   */
  async createCandidate(electionId: string, candidateData: CandidateCreate): Promise<Candidate> {
    const response = await api.post<Candidate>(`/elections/${electionId}/candidates`, candidateData);
    return response.data;
  },

  /**
   * Update a candidate
   */
  async updateCandidate(electionId: string, candidateId: string, candidateData: CandidateUpdate): Promise<Candidate> {
    const response = await api.patch<Candidate>(`/elections/${electionId}/candidates/${candidateId}`, candidateData);
    return response.data;
  },

  /**
   * Delete a candidate
   */
  async deleteCandidate(electionId: string, candidateId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/candidates/${candidateId}`);
  },

  /**
   * Check voter eligibility
   */
  async checkEligibility(electionId: string): Promise<VoterEligibility> {
    const response = await api.get<VoterEligibility>(`/elections/${electionId}/eligibility`);
    return response.data;
  },

  /**
   * Cast a vote
   */
  async castVote(electionId: string, voteData: VoteCreate): Promise<Vote> {
    const response = await api.post<Vote>(`/elections/${electionId}/vote`, voteData);
    return response.data;
  },

  /**
   * Get election results
   */
  async getResults(electionId: string): Promise<ElectionResults> {
    const response = await api.get<ElectionResults>(`/elections/${electionId}/results`);
    return response.data;
  },

  /**
   * Get election statistics
   */
  async getStats(electionId: string): Promise<ElectionStats> {
    const response = await api.get<ElectionStats>(`/elections/${electionId}/stats`);
    return response.data;
  },

  /**
   * Send ballot notification emails
   */
  async sendBallotEmail(electionId: string, emailData: EmailBallot): Promise<EmailBallotResponse> {
    const response = await api.post<EmailBallotResponse>(`/elections/${electionId}/send-ballot`, emailData);
    return response.data;
  },

  /**
   * Cast votes atomically in bulk (approval / ranked-choice / multi-position).
   * Either every vote is recorded or none are.
   */
  async bulkCastVotes(electionId: string, votes: BulkVoteItem[]): Promise<Vote[]> {
    const response = await api.post<Vote[]>(`/elections/${electionId}/vote/bulk`, { election_id: electionId, votes });
    return asArray(response.data);
  },

  /**
   * Get ballot templates
   */
  async getBallotTemplates(): Promise<BallotTemplate[]> {
    const response = await api.get<{ templates: BallotTemplate[] }>('/elections/templates/ballot-items');
    return asArray(response.data?.templates);
  },

  async getSavedBallotTemplates(): Promise<SavedBallotTemplate[]> {
    const response = await api.get<SavedBallotTemplate[]>('/elections/templates/saved-ballots');
    return asArray(response.data);
  },

  async saveBallotTemplate(payload: {
    name: string;
    description?: string;
    ballot_items: BallotItem[];
  }): Promise<SavedBallotTemplate> {
    const response = await api.post<SavedBallotTemplate>('/elections/templates/saved-ballots', payload);
    return response.data;
  },

  async deleteSavedBallotTemplate(templateId: string): Promise<void> {
    await api.delete(`/elections/templates/saved-ballots/${templateId}`);
  },

  /**
   * Get attendees for an election meeting
   */
  async getAttendees(electionId: string): Promise<{ attendees: Attendee[] }> {
    const response = await api.get<{ attendees: Attendee[] }>(`/elections/${electionId}/attendees`);
    return response.data;
  },

  /**
   * Check in an attendee at an election meeting
   */
  async checkInAttendee(electionId: string, userId: string): Promise<AttendeeCheckInResponse> {
    const response = await api.post<AttendeeCheckInResponse>(`/elections/${electionId}/attendees`, { user_id: userId });
    return response.data;
  },

  /**
   * Remove an attendee from an election meeting
   */
  async removeAttendee(electionId: string, userId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/attendees/${userId}`);
  },

  /**
   * Import attendees from the linked meeting into the election
   */
  async importMeetingAttendees(electionId: string): Promise<ImportMeetingAttendeesResponse> {
    const response = await api.post<ImportMeetingAttendeesResponse>(
      `/elections/${electionId}/import-meeting-attendees`
    );
    return response.data;
  },

  /**
   * Look up a ballot by voting token (public/anonymous access).
   * Returns the minimal BallotElection view plus candidates in one call —
   * no roster/PII fields. POST with the token in the body so the live
   * credential never appears in a URL (server/proxy logs, history).
   */
  async lookupBallot(token: string): Promise<BallotLookupResponse> {
    const response = await api.post<BallotLookupResponse>('/elections/ballot/lookup', { token });
    return response.data;
  },

  /**
   * Submit a ballot using a voting token
   */
  async submitBallot(token: string, votes: BallotItemVote[]): Promise<BallotSubmissionResponse> {
    const response = await api.post<BallotSubmissionResponse>('/elections/ballot/vote/bulk', { votes, token });
    return response.data;
  },

  /**
   * Verify vote integrity for an election
   */
  async verifyIntegrity(electionId: string): Promise<VoteIntegrityResult> {
    const response = await api.get<VoteIntegrityResult>(`/elections/${electionId}/integrity`);
    return response.data;
  },

  /**
   * Get forensics report for an election
   */
  async getForensics(electionId: string): Promise<ForensicsReport> {
    const response = await api.get<ForensicsReport>(`/elections/${electionId}/forensics`);
    return response.data;
  },

  /**
   * Soft-delete (void) a vote
   */
  async softDeleteVote(electionId: string, voteId: string, reason: string): Promise<void> {
    await api.delete(`/elections/${electionId}/votes/${voteId}`, { params: { reason } });
  },

  /**
   * Get voter overrides for an election
   */
  async getVoterOverrides(electionId: string): Promise<VoterOverride[]> {
    const response = await api.get<{ overrides: VoterOverride[] }>(`/elections/${electionId}/voter-overrides`);
    return asArray(response.data?.overrides);
  },

  /**
   * Add a voter override
   */
  async addVoterOverride(electionId: string, data: VoterOverrideCreate): Promise<VoterOverride> {
    const response = await api.post<VoterOverride>(`/elections/${electionId}/voter-overrides`, data);
    return response.data;
  },

  /**
   * Remove a voter override
   */
  async removeVoterOverride(electionId: string, userId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/voter-overrides/${userId}`);
  },

  /**
   * Bulk add voter overrides
   */
  async bulkAddVoterOverrides(
    electionId: string,
    data: BulkVoterOverrideCreate
  ): Promise<{ added: number; skipped: number }> {
    const response = await api.post<{ added: number; skipped: number }>(
      `/elections/${electionId}/voter-overrides/bulk`,
      data
    );
    return response.data;
  },

  /**
   * Get proxy authorizations for an election
   */
  async getProxyAuthorizations(
    electionId: string
  ): Promise<{ authorizations: ProxyAuthorization[]; proxy_voting_enabled: boolean }> {
    const response = await api.get<{ authorizations: ProxyAuthorization[]; proxy_voting_enabled: boolean }>(
      `/elections/${electionId}/proxy-authorizations`
    );
    return response.data;
  },

  /**
   * Add a proxy authorization
   */
  async addProxyAuthorization(electionId: string, data: ProxyAuthorizationCreate): Promise<ProxyAuthorization> {
    const response = await api.post<ProxyAuthorization>(`/elections/${electionId}/proxy-authorizations`, data);
    return response.data;
  },

  /**
   * Revoke a proxy authorization
   */
  async revokeProxyAuthorization(electionId: string, authorizationId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/proxy-authorizations/${authorizationId}`);
  },

  /**
   * Cast a proxy vote
   */
  async castProxyVote(electionId: string, data: ProxyVoteCreate): Promise<Vote> {
    const response = await api.post<Vote>(`/elections/${electionId}/proxy-vote`, data);
    return response.data;
  },

  /**
   * Get organization-level election settings
   */
  async getSettings(): Promise<ElectionSettings> {
    const response = await api.get<ElectionSettings>('/elections/settings');
    return response.data;
  },

  /**
   * Update organization-level election settings
   */
  async updateSettings(data: Partial<ElectionSettings>): Promise<ElectionSettings> {
    const response = await api.patch<ElectionSettings>('/elections/settings', data);
    return response.data;
  },

  /**
   * Get non-voters for an election (eligible voters who haven't voted yet)
   */
  async getNonVoters(
    electionId: string
  ): Promise<{ non_voters: Array<{ id: string; full_name: string; email: string }>; count: number }> {
    const response = await api.get<{
      non_voters: Array<{ id: string; full_name: string; email: string }>;
      count: number;
    }>(`/elections/${electionId}/non-voters`);
    return response.data;
  },

  /**
   * Open the nomination phase for a draft positional election.
   */
  async openNominations(electionId: string): Promise<Election> {
    const response = await api.post<Election>(`/elections/${electionId}/open-nominations`);
    return response.data;
  },

  /**
   * Close the nomination phase, returning the election to draft.
   */
  async closeNominations(electionId: string): Promise<Election> {
    const response = await api.post<Election>(`/elections/${electionId}/close-nominations`);
    return response.data;
  },

  /**
   * Nominate a member (or yourself — omit nominee_user_id) for a position.
   */
  async createNomination(
    electionId: string,
    payload: { position: string; nominee_user_id?: string | undefined; statement?: string | undefined }
  ): Promise<Candidate> {
    const response = await api.post<Candidate>(`/elections/${electionId}/nominations`, payload);
    return response.data;
  },

  /**
   * Accept your own nomination.
   */
  async acceptNomination(electionId: string, candidateId: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post<{ success: boolean; message: string }>(
      `/elections/${electionId}/nominations/${candidateId}/accept`
    );
    return response.data;
  },

  /**
   * Decline your own nomination (removes the candidate entry).
   */
  async declineNomination(electionId: string, candidateId: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post<{ success: boolean; message: string }>(
      `/elections/${electionId}/nominations/${candidateId}/decline`
    );
    return response.data;
  },

  /**
   * Record an in-room paper-ballot tally (one vote row per ballot,
   * attributed to the recording officer).
   */
  async recordManualBallots(
    electionId: string,
    payload: {
      entries: Array<{ candidate_id: string; count: number }>;
      notes?: string | undefined;
      allow_over_count?: boolean | undefined;
    }
  ): Promise<{
    recorded: number;
    batch_id?: string;
    status?: string;
    attestations_required?: number;
    message: string;
  }> {
    const response = await api.post<{
      recorded: number;
      batch_id?: string;
      status?: string;
      attestations_required?: number;
      message: string;
    }>(`/elections/${electionId}/manual-ballots`, payload);
    return response.data;
  },

  /**
   * Create a fresh draft election from an existing election's setup
   * (positions, method, quorum, eligibility, reminders) with new dates.
   */
  async cloneElection(
    electionId: string,
    payload: {
      title: string;
      start_date: string;
      end_date: string;
      nomination_deadline?: string | undefined;
      include_candidates?: boolean | undefined;
    }
  ): Promise<Election> {
    const response = await api.post<Election>(`/elections/${electionId}/clone`, payload);
    return response.data;
  },

  /**
   * Consolidate write-in spelling variants under one candidate. Votes are
   * never mutated — results count merged variants under the target.
   */
  async mergeWriteIns(
    electionId: string,
    payload: { source_candidate_ids: string[]; target_candidate_id: string }
  ): Promise<{ merged: number; message: string }> {
    const response = await api.post<{ merged: number; message: string }>(
      `/elections/${electionId}/write-ins/merge`,
      payload
    );
    return response.data;
  },

  /**
   * Download the official blank paper ballot (PDF) for in-room voting.
   */
  async downloadPrintableBallot(electionId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/elections/${electionId}/printable-ballot`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Download the certified results package (PDF) for a closed election.
   */
  async downloadCertifiedResults(electionId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/elections/${electionId}/certified-results`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * List paper-ballot batches with their attestation trail.
   */
  async getManualBallotBatches(electionId: string): Promise<{ batches: ManualBallotBatch[] }> {
    const response = await api.get<{ batches: ManualBallotBatch[] }>(`/elections/${electionId}/manual-ballots`);
    return response.data;
  },

  /**
   * Attest that a paper-ballot batch matches the physical count. The
   * recording officer cannot attest their own batch; once the required
   * number of officers have attested, the batch's votes count in results.
   */
  async attestManualBallots(
    electionId: string,
    batchId: string
  ): Promise<{ attestations: number; required: number; status: string; message: string }> {
    const response = await api.post<{
      attestations: number;
      required: number;
      status: string;
      message: string;
    }>(`/elections/${electionId}/manual-ballots/${batchId}/attest`);
    return response.data;
  },

  /**
   * Void (soft-delete) every paper ballot recorded in one batch — the
   * correction path for a mis-keyed tally.
   */
  async voidManualBallots(
    electionId: string,
    batchId: string,
    reason: string
  ): Promise<{ voided: number; message: string }> {
    const response = await api.post<{ voided: number; message: string }>(
      `/elections/${electionId}/manual-ballots/${batchId}/void`,
      { reason }
    );
    return response.data;
  },

  /**
   * Send a reminder ballot email (fresh voting link) to eligible voters
   * who have not voted yet. Stamps reminder_sent_at server-side, which
   * also suppresses the automatic pre-close reminder.
   */
  async remindNonVoters(
    electionId: string,
    payload?: { subject?: string; message?: string }
  ): Promise<EmailBallotResponse> {
    const response = await api.post<EmailBallotResponse>(`/elections/${electionId}/remind-non-voters`, payload ?? {});
    return response.data;
  },

  /**
   * Send a test ballot to the current user
   */
  async sendTestBallot(electionId: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post<{ success: boolean; message: string }>(`/elections/${electionId}/send-test-ballot`);
    return response.data;
  },

  /**
   * Preview a ballot for a specific user (secretary view)
   */
  async previewBallot(electionId: string, userId: string): Promise<BallotPreview> {
    const response = await api.get<BallotPreview>(`/elections/${electionId}/preview-ballot`, {
      params: { user_id: userId },
    });
    return response.data;
  },

  /**
   * Get full eligibility roster for an election (secretary view)
   */
  async getEligibilityRoster(electionId: string): Promise<EligibilityRoster> {
    const response = await api.get<EligibilityRoster>(`/elections/${electionId}/eligibility-roster`);
    return response.data;
  },

  /**
   * Send an election report email with results, ballot recipients, and skip reasons
   */
  async sendReport(electionId: string): Promise<ElectionReportResponse> {
    const response = await api.post<ElectionReportResponse>(`/elections/${electionId}/send-report`);
    return response.data;
  },

  /**
   * Prefill recipient list for the pre-meeting package modal
   * (mode: 'leadership' | 'eligible_voters'). The secretary edits the
   * list freely before sending.
   */
  async getPackageRecipients(electionId: string, mode: string): Promise<PackageRecipient[]> {
    const response = await api.get<{ recipients: PackageRecipient[] }>(`/elections/${electionId}/package-recipients`, {
      params: { mode },
    });
    return asArray(response.data?.recipients);
  },

  /**
   * Download the pre-meeting package PDF (no email sent).
   */
  async downloadPackagePdf(electionId: string, variant: PackageVariant): Promise<Blob> {
    const response = await api.get(`/elections/${electionId}/package-pdf`, {
      params: { variant },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  /**
   * Email the pre-meeting package PDF to a secretary-edited email list.
   */
  async sendPreMeetingPackage(electionId: string, payload: PreMeetingPackageSend): Promise<PreMeetingPackageResponse> {
    const response = await api.post<PreMeetingPackageResponse>(`/elections/${electionId}/send-package`, payload);
    return response.data;
  },

  /**
   * Verify a vote receipt hash (public — no auth required)
   */
  async verifyReceipt(electionId: string, receipt: string): Promise<VoteReceiptResponse> {
    const response = await api.get<VoteReceiptResponse>(`/elections/${electionId}/verify-receipt`, {
      params: { receipt },
    });
    return response.data;
  },
};
