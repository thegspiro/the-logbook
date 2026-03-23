/**
 * electionService — extracted from services/api.ts
 */

import api from './apiClient';
import type {
  Attendee,
  AttendeeCheckInResponse,
  BallotItemVote,
  BallotPreview,
  BallotSubmissionResponse,
  BallotTemplate,
  Candidate,
  CandidateCreate,
  CandidateUpdate,
  Election,
  ElectionCreate,
  ElectionDeleteResponse,
  ElectionListItem,
  ElectionResults,
  ElectionSettings,
  ElectionStats,
  ElectionUpdate,
  EligibilityRoster,
  EmailBallot,
  EmailBallotResponse,
  ForensicsReport,
  ProxyAuthorization,
  ProxyAuthorizationCreate,
  ProxyVoteCreate,
  Vote,
  VoteCreate,
  VoteIntegrityResult,
  VoterEligibility,
  VoterOverride,
  VoterOverrideCreate,
  BulkVoterOverrideCreate,
} from '../types/election';

export const electionService = {
  /**
   * Get all elections
   */
  async getElections(statusFilter?: string): Promise<ElectionListItem[]> {
    const response = await api.get<ElectionListItem[]>('/elections', {
      params: { status_filter: statusFilter },
    });
    return response.data;
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
  async rollbackElection(electionId: string, reason: string): Promise<{ success: boolean; election: Election; message: string; notifications_sent: number }> {
    const response = await api.post<{ success: boolean; election: Election; message: string; notifications_sent: number }>(`/elections/${electionId}/rollback`, { reason });
    return response.data;
  },

  /**
   * Get candidates for an election
   */
  async getCandidates(electionId: string): Promise<Candidate[]> {
    const response = await api.get<Candidate[]>(`/elections/${electionId}/candidates`);
    return response.data;
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
   * Cast votes in bulk
   */
  async bulkCastVotes(electionId: string, votes: VoteCreate[]): Promise<{ success: boolean; votes_cast: number }> {
    const response = await api.post<{ success: boolean; votes_cast: number }>(`/elections/${electionId}/vote/bulk`, { votes });
    return response.data;
  },

  /**
   * Get ballot templates
   */
  async getBallotTemplates(): Promise<BallotTemplate[]> {
    const response = await api.get<{ templates: BallotTemplate[] }>('/elections/templates/ballot-items');
    return response.data.templates;
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
   * Get ballot by voting token (public/anonymous access)
   */
  async getBallotByToken(token: string): Promise<Election> {
    const response = await api.get<Election>('/elections/ballot', { params: { token } });
    return response.data;
  },

  /**
   * Get candidates for a ballot by voting token
   */
  async getBallotCandidates(token: string): Promise<Candidate[]> {
    const response = await api.get<Candidate[]>(`/elections/ballot/${token}/candidates`);
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
    return response.data.overrides;
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
  async bulkAddVoterOverrides(electionId: string, data: BulkVoterOverrideCreate): Promise<{ added: number; skipped: number }> {
    const response = await api.post<{ added: number; skipped: number }>(`/elections/${electionId}/voter-overrides/bulk`, data);
    return response.data;
  },

  /**
   * Get proxy authorizations for an election
   */
  async getProxyAuthorizations(electionId: string): Promise<{ authorizations: ProxyAuthorization[]; proxy_voting_enabled: boolean }> {
    const response = await api.get<{ authorizations: ProxyAuthorization[]; proxy_voting_enabled: boolean }>(`/elections/${electionId}/proxy-authorizations`);
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
  async getNonVoters(electionId: string): Promise<{ non_voters: Array<{ id: string; full_name: string; email: string }>; count: number }> {
    const response = await api.get<{ non_voters: Array<{ id: string; full_name: string; email: string }>; count: number }>(`/elections/${electionId}/non-voters`);
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

};
