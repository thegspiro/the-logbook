/**
 * Covers the create-pipeline wizard's requirement step: the "Link Existing"
 * path (a phase attaches a requirement the department already tracks instead of
 * defining a duplicate), the one-list structure that has no phases at all, and
 * the pre-submit checks that name the offending phase rather than letting the
 * build endpoint return an unattributable 422.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockBuildProgram = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetCourses = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    buildProgram: (...a: unknown[]) => mockBuildProgram(...a) as unknown,
    getRequirementsEnhanced: (...a: unknown[]) => mockGetRequirementsEnhanced(...a) as unknown,
  },
  trainingService: {
    getCourses: (...a: unknown[]) => mockGetCourses(...a) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import CreatePipelinePage from './CreatePipelinePage';

const cprRequirement = {
  id: 'req-cpr',
  organization_id: 'org-1',
  name: 'CPR/BLS Certification',
  requirement_type: 'certification' as const,
  source: 'department' as const,
  frequency: 'biannual' as const,
  applies_to_all: true,
  due_date_type: 'calendar_period' as const,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Walks the wizard to the Requirements step with one named phase defined. */
const goToRequirementsWithAPhase = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/Program Name/), 'Recruit School');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await user.click(await screen.findByRole('button', { name: /Add Phase/ }));
  await user.type(await screen.findByPlaceholderText(/Engine Company Operations/), 'Orientation');
  await user.click(screen.getByRole('button', { name: /Next/ }));
};

describe('CreatePipelinePage — linking existing requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement]);
    mockGetCourses.mockResolvedValue([]);
    mockBuildProgram.mockResolvedValue({ id: 'prog-1' });
  });

  it('sends a linked requirement as an id, with no definition fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));

    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: { requirements: Record<string, unknown>[] }[];
    };
    expect(payload.phases[0]?.requirements[0]).toEqual({
      requirement_id: 'req-cpr',
      is_required: true,
      sort_order: 0,
    });
  });

  it('refuses to submit a link with nothing picked, naming the phase', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    // Deliberately skip picking one.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Phase 1'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });

  it('refuses to submit an unnamed phase instead of letting the server 422', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Recruit School');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Add Phase/ }));
    await user.click(screen.getByRole('button', { name: /Next/ })); // requirements
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Phase 1 needs a name'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });

  it('refuses an hours requirement with no target, which nobody could complete', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /New Requirement/ }));
    await user.type(await screen.findByPlaceholderText(/Hose Operations Skills/), 'Ride-alongs');
    // Leave "Required Hours" blank.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('needs a number to count toward'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });
});

describe('CreatePipelinePage — a one-list program', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement]);
    mockGetCourses.mockResolvedValue([]);
    mockBuildProgram.mockResolvedValue({ id: 'prog-2' });
  });

  it('skips the Phases step and sends requirements at the program level', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Annual CE');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    // No Phases step to pass through — Next goes straight to Requirements.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: unknown[];
      requirements: Record<string, unknown>[];
    };
    expect(payload.phases).toEqual([]);
    expect(payload.requirements[0]).toEqual({
      requirement_id: 'req-cpr',
      is_required: true,
      sort_order: 0,
    });
  });
});
