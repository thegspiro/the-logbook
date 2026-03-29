import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient BEFORE importing the service
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// Import service AFTER mocks
import { electionService } from './electionService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('electionService', () => {
  // --- getElections ---
  describe('getElections', () => {
    it('should GET /elections with optional status filter', async () => {
      const elections = [{ id: 'el1', title: 'Board Election' }];
      mockGet.mockResolvedValueOnce({ data: elections });

      const result = await electionService.getElections('open');

      expect(mockGet).toHaveBeenCalledWith('/elections', { params: { status_filter: 'open' } });
      expect(result).toEqual(elections);
    });

    it('should GET /elections without filter', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const result = await electionService.getElections();

      expect(mockGet).toHaveBeenCalledWith('/elections', { params: { status_filter: undefined } });
      expect(result).toEqual([]);
    });
  });

  // --- getElection ---
  describe('getElection', () => {
    it('should GET /elections/:id', async () => {
      const election = { id: 'el1', title: 'Board Election', status: 'draft' };
      mockGet.mockResolvedValueOnce({ data: election });

      const result = await electionService.getElection('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1');
      expect(result).toEqual(election);
    });
  });

  // --- createElection ---
  describe('createElection', () => {
    it('should POST to /elections', async () => {
      const electionData = { title: 'New Election', election_type: 'officer' };
      const created = { id: 'el1', ...electionData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await electionService.createElection(electionData as never);

      expect(mockPost).toHaveBeenCalledWith('/elections', electionData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(electionService.createElection({} as never)).rejects.toThrow('Permission denied');
    });
  });

  // --- updateElection ---
  describe('updateElection', () => {
    it('should PATCH /elections/:id', async () => {
      const updateData = { title: 'Updated Title' };
      const updated = { id: 'el1', title: 'Updated Title' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await electionService.updateElection('el1', updateData as never);

      expect(mockPatch).toHaveBeenCalledWith('/elections/el1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteElection ---
  describe('deleteElection', () => {
    it('should DELETE /elections/:id without reason for draft', async () => {
      const response = { message: 'Deleted' };
      mockDelete.mockResolvedValueOnce({ data: response });

      const result = await electionService.deleteElection('el1');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1', { data: undefined });
      expect(result).toEqual(response);
    });

    it('should DELETE /elections/:id with reason for non-draft', async () => {
      const response = { message: 'Deleted' };
      mockDelete.mockResolvedValueOnce({ data: response });

      const result = await electionService.deleteElection('el1', 'No longer needed');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1', { data: { reason: 'No longer needed' } });
      expect(result).toEqual(response);
    });
  });

  // --- openElection ---
  describe('openElection', () => {
    it('should POST to /elections/:id/open', async () => {
      const election = { id: 'el1', status: 'open' };
      mockPost.mockResolvedValueOnce({ data: election });

      const result = await electionService.openElection('el1');

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/open');
      expect(result).toEqual(election);
    });
  });

  // --- closeElection ---
  describe('closeElection', () => {
    it('should POST to /elections/:id/close', async () => {
      const election = { id: 'el1', status: 'closed' };
      mockPost.mockResolvedValueOnce({ data: election });

      const result = await electionService.closeElection('el1');

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/close');
      expect(result).toEqual(election);
    });
  });

  // --- rollbackElection ---
  describe('rollbackElection', () => {
    it('should POST reason to /elections/:id/rollback', async () => {
      const response = { success: true, election: { id: 'el1' }, message: 'Rolled back', notifications_sent: 5 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.rollbackElection('el1', 'Error in setup');

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/rollback', { reason: 'Error in setup' });
      expect(result).toEqual(response);
    });
  });

  // --- getCandidates ---
  describe('getCandidates', () => {
    it('should GET /elections/:id/candidates', async () => {
      const candidates = [{ id: 'c1', name: 'John Smith' }];
      mockGet.mockResolvedValueOnce({ data: candidates });

      const result = await electionService.getCandidates('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/candidates');
      expect(result).toEqual(candidates);
    });
  });

  // --- createCandidate ---
  describe('createCandidate', () => {
    it('should POST candidate data to /elections/:id/candidates', async () => {
      const candidateData = { user_id: 'u1', position: 'President' };
      const candidate = { id: 'c1', ...candidateData };
      mockPost.mockResolvedValueOnce({ data: candidate });

      const result = await electionService.createCandidate('el1', candidateData as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/candidates', candidateData);
      expect(result).toEqual(candidate);
    });
  });

  // --- updateCandidate ---
  describe('updateCandidate', () => {
    it('should PATCH /elections/:electionId/candidates/:candidateId', async () => {
      const updateData = { bio: 'Updated bio' };
      const updated = { id: 'c1', bio: 'Updated bio' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await electionService.updateCandidate('el1', 'c1', updateData as never);

      expect(mockPatch).toHaveBeenCalledWith('/elections/el1/candidates/c1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteCandidate ---
  describe('deleteCandidate', () => {
    it('should DELETE /elections/:electionId/candidates/:candidateId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await electionService.deleteCandidate('el1', 'c1');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1/candidates/c1');
    });
  });

  // --- checkEligibility ---
  describe('checkEligibility', () => {
    it('should GET /elections/:id/eligibility', async () => {
      const eligibility = { eligible: true, reason: null };
      mockGet.mockResolvedValueOnce({ data: eligibility });

      const result = await electionService.checkEligibility('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/eligibility');
      expect(result).toEqual(eligibility);
    });
  });

  // --- castVote ---
  describe('castVote', () => {
    it('should POST vote data to /elections/:id/vote', async () => {
      const voteData = { candidate_id: 'c1', ballot_item_id: 'bi1' };
      const vote = { id: 'v1', ...voteData };
      mockPost.mockResolvedValueOnce({ data: vote });

      const result = await electionService.castVote('el1', voteData as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/vote', voteData);
      expect(result).toEqual(vote);
    });

    it('should propagate errors for ineligible voter', async () => {
      mockPost.mockRejectedValueOnce(new Error('Not eligible to vote'));

      await expect(electionService.castVote('el1', {} as never)).rejects.toThrow('Not eligible to vote');
    });
  });

  // --- getResults ---
  describe('getResults', () => {
    it('should GET /elections/:id/results', async () => {
      const results = { winners: [{ candidate_id: 'c1', votes: 10 }] };
      mockGet.mockResolvedValueOnce({ data: results });

      const result = await electionService.getResults('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/results');
      expect(result).toEqual(results);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should GET /elections/:id/stats', async () => {
      const stats = { total_votes: 50, turnout_percentage: 75 };
      mockGet.mockResolvedValueOnce({ data: stats });

      const result = await electionService.getStats('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/stats');
      expect(result).toEqual(stats);
    });
  });

  // --- sendBallotEmail ---
  describe('sendBallotEmail', () => {
    it('should POST email data to /elections/:id/send-ballot', async () => {
      const emailData = { subject: 'Vote Now', recipients: ['u1', 'u2'] };
      const response = { sent: 2, failed: 0 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.sendBallotEmail('el1', emailData as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/send-ballot', emailData);
      expect(result).toEqual(response);
    });
  });

  // --- bulkCastVotes ---
  describe('bulkCastVotes', () => {
    it('should POST bulk votes to /elections/:id/vote/bulk', async () => {
      const votes = [{ Chief: 'c1' }];
      const response = [{ id: 'v1', election_id: 'el1', candidate_id: 'c1', voted_at: '2026-01-01' }];
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.bulkCastVotes('el1', votes);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/vote/bulk', { election_id: 'el1', votes });
      expect(result).toEqual(response);
    });
  });

  // --- getBallotTemplates ---
  describe('getBallotTemplates', () => {
    it('should GET ballot templates from /elections/templates/ballot-items and unwrap', async () => {
      const templates = [{ id: 'bt1', name: 'Standard Ballot' }];
      mockGet.mockResolvedValueOnce({ data: { templates } });

      const result = await electionService.getBallotTemplates();

      expect(mockGet).toHaveBeenCalledWith('/elections/templates/ballot-items');
      expect(result).toEqual(templates);
    });
  });

  // --- getAttendees ---
  describe('getAttendees', () => {
    it('should GET /elections/:id/attendees', async () => {
      const data = { attendees: [{ user_id: 'u1', name: 'John' }] };
      mockGet.mockResolvedValueOnce({ data });

      const result = await electionService.getAttendees('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/attendees');
      expect(result).toEqual(data);
    });
  });

  // --- checkInAttendee ---
  describe('checkInAttendee', () => {
    it('should POST user_id to /elections/:id/attendees', async () => {
      const response = { success: true, user_id: 'u1' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.checkInAttendee('el1', 'u1');

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/attendees', { user_id: 'u1' });
      expect(result).toEqual(response);
    });
  });

  // --- removeAttendee ---
  describe('removeAttendee', () => {
    it('should DELETE /elections/:electionId/attendees/:userId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await electionService.removeAttendee('el1', 'u1');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1/attendees/u1');
    });
  });

  // --- getBallotByToken ---
  describe('getBallotByToken', () => {
    it('should GET /elections/ballot with token param', async () => {
      const election = { id: 'el1', title: 'Board Election' };
      mockGet.mockResolvedValueOnce({ data: election });

      const result = await electionService.getBallotByToken('tok-abc123');

      expect(mockGet).toHaveBeenCalledWith('/elections/ballot', { params: { token: 'tok-abc123' } });
      expect(result).toEqual(election);
    });
  });

  // --- getBallotCandidates ---
  describe('getBallotCandidates', () => {
    it('should GET /elections/ballot/:token/candidates', async () => {
      const candidates = [{ id: 'c1', name: 'Jane' }];
      mockGet.mockResolvedValueOnce({ data: candidates });

      const result = await electionService.getBallotCandidates('tok-abc123');

      expect(mockGet).toHaveBeenCalledWith('/elections/ballot/tok-abc123/candidates');
      expect(result).toEqual(candidates);
    });
  });

  // --- submitBallot ---
  describe('submitBallot', () => {
    it('should POST votes with token to /elections/ballot/vote/bulk', async () => {
      const votes = [{ ballot_item_id: 'bi1', candidate_id: 'c1' }];
      const response = { success: true, votes_cast: 1 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.submitBallot('tok-abc123', votes as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/ballot/vote/bulk', { votes, token: 'tok-abc123' });
      expect(result).toEqual(response);
    });
  });

  // --- verifyIntegrity ---
  describe('verifyIntegrity', () => {
    it('should GET /elections/:id/integrity', async () => {
      const integrityResult = { valid: true, issues: [] };
      mockGet.mockResolvedValueOnce({ data: integrityResult });

      const result = await electionService.verifyIntegrity('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/integrity');
      expect(result).toEqual(integrityResult);
    });
  });

  // --- getForensics ---
  describe('getForensics', () => {
    it('should GET /elections/:id/forensics', async () => {
      const report = { anomalies: [], summary: 'No issues found' };
      mockGet.mockResolvedValueOnce({ data: report });

      const result = await electionService.getForensics('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/forensics');
      expect(result).toEqual(report);
    });
  });

  // --- softDeleteVote ---
  describe('softDeleteVote', () => {
    it('should DELETE /elections/:electionId/votes/:voteId with reason param', async () => {
      mockDelete.mockResolvedValueOnce({});

      await electionService.softDeleteVote('el1', 'v1', 'Duplicate vote');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1/votes/v1', { params: { reason: 'Duplicate vote' } });
    });
  });

  // --- getVoterOverrides ---
  describe('getVoterOverrides', () => {
    it('should GET /elections/:id/voter-overrides and unwrap overrides', async () => {
      const overrides = [{ user_id: 'u1', override_type: 'allow' }];
      mockGet.mockResolvedValueOnce({ data: { overrides } });

      const result = await electionService.getVoterOverrides('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/voter-overrides');
      expect(result).toEqual(overrides);
    });
  });

  // --- addVoterOverride ---
  describe('addVoterOverride', () => {
    it('should POST to /elections/:id/voter-overrides', async () => {
      const data = { user_id: 'u1', override_type: 'allow' };
      const override = { id: 'vo1', ...data };
      mockPost.mockResolvedValueOnce({ data: override });

      const result = await electionService.addVoterOverride('el1', data as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/voter-overrides', data);
      expect(result).toEqual(override);
    });
  });

  // --- removeVoterOverride ---
  describe('removeVoterOverride', () => {
    it('should DELETE /elections/:electionId/voter-overrides/:userId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await electionService.removeVoterOverride('el1', 'u1');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1/voter-overrides/u1');
    });
  });

  // --- bulkAddVoterOverrides ---
  describe('bulkAddVoterOverrides', () => {
    it('should POST to /elections/:id/voter-overrides/bulk', async () => {
      const data = { user_ids: ['u1', 'u2'], override_type: 'allow' };
      const response = { added: 2, skipped: 0 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.bulkAddVoterOverrides('el1', data as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/voter-overrides/bulk', data);
      expect(result).toEqual(response);
    });
  });

  // --- getProxyAuthorizations ---
  describe('getProxyAuthorizations', () => {
    it('should GET /elections/:id/proxy-authorizations', async () => {
      const data = { authorizations: [{ id: 'pa1' }], proxy_voting_enabled: true };
      mockGet.mockResolvedValueOnce({ data });

      const result = await electionService.getProxyAuthorizations('el1');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/proxy-authorizations');
      expect(result).toEqual(data);
    });
  });

  // --- addProxyAuthorization ---
  describe('addProxyAuthorization', () => {
    it('should POST to /elections/:id/proxy-authorizations', async () => {
      const data = { voter_id: 'u1', proxy_id: 'u2' };
      const authorization = { id: 'pa1', ...data };
      mockPost.mockResolvedValueOnce({ data: authorization });

      const result = await electionService.addProxyAuthorization('el1', data as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/proxy-authorizations', data);
      expect(result).toEqual(authorization);
    });
  });

  // --- revokeProxyAuthorization ---
  describe('revokeProxyAuthorization', () => {
    it('should DELETE /elections/:electionId/proxy-authorizations/:authorizationId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await electionService.revokeProxyAuthorization('el1', 'pa1');

      expect(mockDelete).toHaveBeenCalledWith('/elections/el1/proxy-authorizations/pa1');
    });
  });

  // --- castProxyVote ---
  describe('castProxyVote', () => {
    it('should POST proxy vote data to /elections/:id/proxy-vote', async () => {
      const data = { voter_id: 'u1', candidate_id: 'c1' };
      const vote = { id: 'v1', ...data };
      mockPost.mockResolvedValueOnce({ data: vote });

      const result = await electionService.castProxyVote('el1', data as never);

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/proxy-vote', data);
      expect(result).toEqual(vote);
    });
  });

  // --- sendReport ---
  describe('sendReport', () => {
    it('should POST to /elections/:id/send-report', async () => {
      const response = { success: true, message: 'Report sent' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await electionService.sendReport('el1');

      expect(mockPost).toHaveBeenCalledWith('/elections/el1/send-report');
      expect(result).toEqual(response);
    });
  });

  // --- verifyReceipt ---
  describe('verifyReceipt', () => {
    it('should GET /elections/:id/verify-receipt with receipt param', async () => {
      const response = { verified: true, message: 'Vote recorded', voted_at: '2026-01-01T00:00:00', position: 'Chief' };
      mockGet.mockResolvedValueOnce({ data: response });

      const result = await electionService.verifyReceipt('el1', 'abc123hash');

      expect(mockGet).toHaveBeenCalledWith('/elections/el1/verify-receipt', { params: { receipt: 'abc123hash' } });
      expect(result).toEqual(response);
    });
  });
});
