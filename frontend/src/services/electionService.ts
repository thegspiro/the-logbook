/**
 * electionService — extracted from services/api.ts
 */

import api from './apiClient';

export const electionService = {
  /**
   * Get all elections
   */
  async getElections(statusFilter?: string): Promise<import('../types/election').ElectionListItem[]> {
    const response = await api.get<import('../types/election').ElectionListItem[]>('/elections', {
      params: { status_filter: statusFilter },
    });
    return response.data;
  },

  /**
   * Get a specific election
   */
  async getElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.get<import('../types/election').Election>(`/elections/${electionId}`);
    return response.data;
  },

  /**
   * Create a new election
   */
  async createElection(electionData: import('../types/election').ElectionCreate): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>('/elections', electionData);
    return response.data;
  },

  /**
   * Update an election
   */
  async updateElection(electionId: string, electionData: import('../types/election').ElectionUpdate): Promise<import('../types/election').Election> {
    const response = await api.patch<import('../types/election').Election>(`/elections/${electionId}`, electionData);
    return response.data;
  },

  /**
   * Delete an election (reason required for non-draft elections)
   */
  async deleteElection(electionId: string, reason?: string): Promise<import('../types/election').ElectionDeleteResponse> {
    const response = await api.delete<import('../types/election').ElectionDeleteResponse>(`/elections/${electionId}`, {
      data: reason ? { reason } : undefined,
    });
    return response.data;
  },

  /**
   * Open an election for voting
   */
  async openElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/open`);
    return response.data;
  },

  /**
   * Close an election
   */
  async closeElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/close`);
    return response.data;
  },

  /**
   * Rollback an election to previous status
   */
  async rollbackElection(electionId: string, reason: string): Promise<{ success: boolean; election: import('../types/election').Election; message: string; notifications_sent: number }> {
    const response = await api.post<{ success: boolean; election: import('../types/election').Election; message: string; notifications_sent: number }>(`/elections/${electionId}/rollback`, { reason });
    return response.data;
  },

  /**
   * Get candidates for an election
   */
  async getCandidates(electionId: string): Promise<import('../types/election').Candidate[]> {
    const response = await api.get<import('../types/election').Candidate[]>(`/elections/${electionId}/candidates`);
    return response.data;
  },

  /**
   * Add a candidate to an election
   */
  async createCandidate(electionId: string, candidateData: import('../types/election').CandidateCreate): Promise<import('../types/election').Candidate> {
    const response = await api.post<import('../types/election').Candidate>(`/elections/${electionId}/candidates`, candidateData);
    return response.data;
  },

  /**
   * Update a candidate
   */
  async updateCandidate(electionId: string, candidateId: string, candidateData: import('../types/election').CandidateUpdate): Promise<import('../types/election').Candidate> {
    const response = await api.patch<import('../types/election').Candidate>(`/elections/${electionId}/candidates/${candidateId}`, candidateData);
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
  async checkEligibility(electionId: string): Promise<import('../types/election').VoterEligibility> {
    const response = await api.get<import('../types/election').VoterEligibility>(`/elections/${electionId}/eligibility`);
    return response.data;
  },

  /**
   * Cast a vote
   */
  async castVote(electionId: string, voteData: import('../types/election').VoteCreate): Promise<import('../types/election').Vote> {
    const response = await api.post<import('../types/election').Vote>(`/elections/${electionId}/vote`, voteData);
    return response.data;
  },

  /**
   * Get election results
   */
  async getResults(electionId: string): Promise<import('../types/election').ElectionResults> {
    const response = await api.get<import('../types/election').ElectionResults>(`/elections/${electionId}/results`);
    return response.data;
  },

  /**
   * Get election statistics
   */
  async getStats(electionId: string): Promise<import('../types/election').ElectionStats> {
    const response = await api.get<import('../types/election').ElectionStats>(`/elections/${electionId}/stats`);
    return response.data;
  },

  /**
   * Send ballot notification emails
   */
  async sendBallotEmail(electionId: string, emailData: import('../types/election').EmailBallot): Promise<import('../types/election').EmailBallotResponse> {
    const response = await api.post<import('../types/election').EmailBallotResponse>(`/elections/${electionId}/send-ballot`, emailData);
    return response.data;
  },

  /**
   * Cast votes in bulk
   */
  async bulkCastVotes(electionId: string, votes: import('../types/election').VoteCreate[]): Promise<{ success: boolean; votes_cast: number }> {
    const response = await api.post<{ success: boolean; votes_cast: number }>(`/elections/${electionId}/vote/bulk`, { votes });
    return response.data;
  },

  /**
   * Get ballot templates
   */
  async getBallotTemplates(): Promise<import('../types/election').BallotTemplate[]> {
    const response = await api.get<{ templates: import('../types/election').BallotTemplate[] }>('/elections/templates/ballot-items');
    return response.data.templates;
  },

  /**
   * Get attendees for an election meeting
   */
  async getAttendees(electionId: string): Promise<{ attendees: import('../types/election').Attendee[] }> {
    const response = await api.get<{ attendees: import('../types/election').Attendee[] }>(`/elections/${electionId}/attendees`);
    return response.data;
  },

  /**
   * Check in an attendee at an election meeting
   */
  async checkInAttendee(electionId: string, userId: string): Promise<import('../types/election').AttendeeCheckInResponse> {
    const response = await api.post<import('../types/election').AttendeeCheckInResponse>(`/elections/${electionId}/attendees`, { user_id: userId });
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
  async getBallotByToken(token: string): Promise<import('../types/election').Election> {
    const response = await api.get<import('../types/election').Election>('/elections/ballot', { params: { token } });
    return response.data;
  },

  /**
   * Get candidates for a ballot by voting token
   */
  async getBallotCandidates(token: string): Promise<import('../types/election').Candidate[]> {
    const response = await api.get<import('../types/election').Candidate[]>(`/elections/ballot/${token}/candidates`);
    return response.data;
  },

  /**
   * Submit a ballot using a voting token
   */
  async submitBallot(token: string, votes: import('../types/election').BallotItemVote[]): Promise<import('../types/election').BallotSubmissionResponse> {
    const response = await api.post<import('../types/election').BallotSubmissionResponse>('/elections/ballot/vote/bulk', { votes, token });
    return response.data;
  },

  /**
   * Verify vote integrity for an election
   */
  async verifyIntegrity(electionId: string): Promise<import('../types/election').VoteIntegrityResult> {
    const response = await api.get<import('../types/election').VoteIntegrityResult>(`/elections/${electionId}/integrity`);
    return response.data;
  },

  /**
   * Get forensics report for an election
   */
  async getForensics(electionId: string): Promise<import('../types/election').ForensicsReport> {
    const response = await api.get<import('../types/election').ForensicsReport>(`/elections/${electionId}/forensics`);
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
  async getVoterOverrides(electionId: string): Promise<import('../types/election').VoterOverride[]> {
    const response = await api.get<{ overrides: import('../types/election').VoterOverride[] }>(`/elections/${electionId}/voter-overrides`);
    return response.data.overrides;
  },

  /**
   * Add a voter override
   */
  async addVoterOverride(electionId: string, data: import('../types/election').VoterOverrideCreate): Promise<import('../types/election').VoterOverride> {
    const response = await api.post<import('../types/election').VoterOverride>(`/elections/${electionId}/voter-overrides`, data);
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
  async bulkAddVoterOverrides(electionId: string, data: import('../types/election').BulkVoterOverrideCreate): Promise<{ added: number; skipped: number }> {
    const response = await api.post<{ added: number; skipped: number }>(`/elections/${electionId}/voter-overrides/bulk`, data);
    return response.data;
  },

  /**
   * Get proxy authorizations for an election
   */
  async getProxyAuthorizations(electionId: string): Promise<{ authorizations: import('../types/election').ProxyAuthorization[]; proxy_voting_enabled: boolean }> {
    const response = await api.get<{ authorizations: import('../types/election').ProxyAuthorization[]; proxy_voting_enabled: boolean }>(`/elections/${electionId}/proxy-authorizations`);
    return response.data;
  },

  /**
   * Add a proxy authorization
   */
  async addProxyAuthorization(electionId: string, data: import('../types/election').ProxyAuthorizationCreate): Promise<import('../types/election').ProxyAuthorization> {
    const response = await api.post<import('../types/election').ProxyAuthorization>(`/elections/${electionId}/proxy-authorizations`, data);
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
  async castProxyVote(electionId: string, data: import('../types/election').ProxyVoteCreate): Promise<import('../types/election').Vote> {
    const response = await api.post<import('../types/election').Vote>(`/elections/${electionId}/proxy-vote`, data);
    return response.data;
  },

  /**
   * Get organization-level election settings
   */
  async getSettings(): Promise<import('../types/election').ElectionSettings> {
    const response = await api.get<import('../types/election').ElectionSettings>('/elections/settings');
    return response.data;
  },

  /**
   * Update organization-level election settings
   */
  async updateSettings(data: Partial<import('../types/election').ElectionSettings>): Promise<import('../types/election').ElectionSettings> {
    const response = await api.patch<import('../types/election').ElectionSettings>('/elections/settings', data);
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
  async previewBallot(electionId: string, userId: string): Promise<import('../types/election').BallotPreview> {
    const response = await api.get<import('../types/election').BallotPreview>(`/elections/${electionId}/preview-ballot`, {
      params: { user_id: userId },
    });
    return response.data;
  },
};
