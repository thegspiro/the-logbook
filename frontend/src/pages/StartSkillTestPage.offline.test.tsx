import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

/**
 * Starting a skills test with no signal (owner decision: cold start). The
 * published list comes back empty, so the page offers the sheets this device
 * kept and the members this examiner has tested here.
 */

const mockCreateTest = vi.fn();
vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: vi.fn((selector) => {
    const state = {
      templates: [],
      templatesLoading: false,
      loadTemplates: () => Promise.resolve(),
      createTest: mockCreateTest,
    };
    return typeof selector === 'function' ? (selector as (s: typeof state) => unknown)(state) : state;
  }),
}));

vi.mock('../services/api', () => ({
  skillsTestingService: {
    searchCandidates: () => Promise.reject(Object.assign(new Error('Network Error'), { request: {} })),
    getTemplate: vi.fn(),
  },
  trainingProgramService: { getRequirementsEnhanced: () => Promise.resolve([]) },
}));

vi.mock('../utils/skillsTestOffline', () => ({
  cacheSkillTemplates: vi.fn(() => Promise.resolve()),
  listCachedSkillTemplates: () =>
    Promise.resolve([
      {
        id: 'tpl-1',
        organization_id: 'o1',
        name: 'SCBA Evaluation',
        version: 2,
        status: 'published',
        visibility: 'all_members',
        sections: [{ id: 's1', name: 'Donning', sort_order: 0, criteria: [] }],
        require_all_critical: true,
        created_at: '',
        updated_at: '',
      },
    ]),
  listRecentCandidates: () => Promise.resolve([{ id: 'c1', name: 'Casey Candidate' }]),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: 'officer-1', first_name: 'Olive', last_name: 'Officer' },
      checkPermission: () => true,
    };
    return typeof selector === 'function' ? (selector as (s: typeof state) => unknown)(state) : state;
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate, useSearchParams: () => [new URLSearchParams(''), vi.fn()] };
});

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { StartSkillTestPage } from './StartSkillTestPage';

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

describe('StartSkillTestPage with no signal', () => {
  beforeEach(() => {
    mockCreateTest.mockReset();
    mockNavigate.mockReset();
    setOnline(false);
  });
  afterEach(() => setOnline(true));

  it('offers the kept sheets and recent candidates, and starts the test labelled', async () => {
    mockCreateTest.mockResolvedValue({ id: 'local-1' });
    const user = userEvent.setup();
    renderWithRouter(<StartSkillTestPage />);

    await user.click(await screen.findByText('SCBA Evaluation'));
    expect(screen.getByText(/No signal — showing members you have examined on this device/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Casey Candidate/ }));
    await user.click(screen.getByRole('button', { name: 'Begin Evaluation' }));

    await waitFor(() => expect(mockCreateTest).toHaveBeenCalled());
    expect(mockCreateTest).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'tpl-1', candidate_id: 'c1' }), {
      candidateName: 'Casey Candidate',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/local-1/active');
  });
});
