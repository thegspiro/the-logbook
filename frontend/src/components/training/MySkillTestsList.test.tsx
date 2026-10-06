import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MySkillTestsList } from './MySkillTestsList';
import type { SkillTestListItem, SkillTestListPage, SkillTestListParams } from '../../types/skillsTesting';

const mockGetTests = vi.fn<(params?: SkillTestListParams) => Promise<SkillTestListPage>>();
vi.mock('../../services/api', () => ({
  skillsTestingService: {
    getTests: (params?: SkillTestListParams) => mockGetTests(params),
  },
}));

const row: SkillTestListItem = {
  id: 'test-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'completed',
  result: 'pass',
  is_practice: false,
  completed_at: '2026-01-15T10:30:00Z',
  created_at: '2026-01-15T10:00:00Z',
};

// The member's own history is paged by the server (SKT3-2) rather than
// fetched whole on every visit to My Training.
describe('MySkillTestsList', () => {
  beforeEach(() => {
    mockGetTests.mockReset();
  });

  it('asks for one page of the member’s own tests', async () => {
    mockGetTests.mockResolvedValue({ items: [row], total: 1 });
    renderWithRouter(<MySkillTestsList userId="user-1" />);

    expect(await screen.findByText('SCBA Evaluation')).toBeInTheDocument();
    expect(mockGetTests).toHaveBeenCalledWith({
      candidate_id: 'user-1',
      include_practice: true,
      limit: 25,
      offset: 0,
    });
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
  });

  it('pages when the member has more than one page of results', async () => {
    const user = userEvent.setup();
    mockGetTests.mockResolvedValue({ items: [row], total: 30 });
    renderWithRouter(<MySkillTestsList userId="user-1" />);

    await user.click(await screen.findByRole('button', { name: /next page/i }));

    await waitFor(() =>
      expect(mockGetTests).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25, offset: 25 }))
    );
  });
});
