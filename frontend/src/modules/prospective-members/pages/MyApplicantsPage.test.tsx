/**
 * MyApplicantsPage — the applicants the signed-in member is assigned to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ApplicantListItem } from '../types';

const mocks = vi.hoisted(() => ({
  getMyApplicants: vi.fn(),
  getPipeline: vi.fn(),
  fetchApplicant: vi.fn(),
  remember: vi.fn(),
  dialogProps: [] as Array<{ isOpen: boolean }>,
}));

vi.mock('../services/api', () => ({
  applicantService: { getMyApplicants: (...a: unknown[]) => mocks.getMyApplicants(...a) as unknown },
  pipelineService: { getPipeline: (...a: unknown[]) => mocks.getPipeline(...a) as unknown },
}));

vi.mock('../store/prospectiveMembersStore', () => {
  const state = { currentApplicant: null, fetchApplicant: (...a: unknown[]) => mocks.fetchApplicant(...a) as unknown };
  return { useProspectiveMembersStore: (select: (s: typeof state) => unknown) => select(state) };
});

vi.mock('../hooks/useHasAssignedApplicants', () => ({
  useAssignedApplicantsStore: (select: (s: { remember: typeof mocks.remember }) => unknown) =>
    select({ remember: mocks.remember }),
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: 'board-1' } }),
}));

vi.mock('../components/ApplicantDetailDialog', () => ({
  ApplicantDetailDialog: (props: { isOpen: boolean }) => {
    mocks.dialogProps.push(props);
    return props.isOpen ? <div role="dialog" aria-label="Applicant details" /> : null;
  },
}));
vi.mock('../components/ConversionModal', () => ({ ConversionModal: () => null }));

import MyApplicantsPage from './MyApplicantsPage';

const item = (overrides: Partial<ApplicantListItem> = {}): ApplicantListItem =>
  ({
    id: 'app-1',
    pipeline_id: 'pipe-1',
    first_name: 'Riley',
    last_name: 'Bishop',
    email: 'riley@example.org',
    current_stage_id: 'step-2',
    current_stage_name: 'Interview',
    status: 'active',
    my_roles: ['interviewer'],
    ...overrides,
  }) as ApplicantListItem;

const renderAt = (url = '/prospective-members/my-applicants') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/prospective-members/my-applicants" element={<MyApplicantsPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('MyApplicantsPage', () => {
  beforeEach(() => {
    mocks.getMyApplicants.mockReset();
    mocks.getPipeline.mockReset();
    mocks.fetchApplicant.mockReset();
    mocks.remember.mockReset();
    mocks.dialogProps.length = 0;
    mocks.getMyApplicants.mockResolvedValue([item()]);
    mocks.getPipeline.mockResolvedValue({ id: 'pipe-1', stages: [] });
  });

  it('lists each applicant with the member’s roles and a way to the interview', async () => {
    renderAt();

    expect(await screen.findByRole('heading', { name: 'Riley Bishop' })).toBeInTheDocument();
    expect(screen.getByText('Interviewer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Interview/ })).toHaveAttribute(
      'href',
      '/prospective-members/app-1/interview'
    );
  });

  it('opens an applicant', async () => {
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(mocks.fetchApplicant).toHaveBeenCalledWith('app-1');
    expect(screen.getByRole('dialog', { name: 'Applicant details' })).toBeInTheDocument();
  });

  it('opens the applicant an assignment email links to', async () => {
    renderAt('/prospective-members/my-applicants?applicant=app-1');

    await waitFor(() => expect(mocks.fetchApplicant).toHaveBeenCalledWith('app-1'));
    expect(screen.getByRole('dialog', { name: 'Applicant details' })).toBeInTheDocument();
  });

  it('says so when the member is assigned to nobody, and tells the menu', async () => {
    mocks.getMyApplicants.mockResolvedValue([]);
    renderAt();

    expect(await screen.findByText('You are not assigned to any applicants')).toBeInTheDocument();
    expect(mocks.remember).toHaveBeenCalledWith('board-1', false);
  });

  it('tells the menu when the member has applicants', async () => {
    renderAt();

    await screen.findByRole('heading', { name: 'Riley Bishop' });
    expect(mocks.remember).toHaveBeenCalledWith('board-1', true);
  });
});
