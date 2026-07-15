import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import toast from 'react-hot-toast';
import TrainingProgramsPage from './TrainingProgramsPage';

const mockGetPrograms = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetRegistries = vi.fn();
const mockGetSampleTemplates = vi.fn();
const mockInstantiateSampleTemplate = vi.fn();
const mockImportRegistry = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    getPrograms: (...args: unknown[]) => mockGetPrograms(...args) as unknown,
    getRequirementsEnhanced: (...args: unknown[]) => mockGetRequirementsEnhanced(...args) as unknown,
    getRegistries: (...args: unknown[]) => mockGetRegistries(...args) as unknown,
    getSampleTemplates: (...args: unknown[]) => mockGetSampleTemplates(...args) as unknown,
    instantiateSampleTemplate: (...args: unknown[]) => mockInstantiateSampleTemplate(...args) as unknown,
    importRegistry: (...args: unknown[]) => mockImportRegistry(...args) as unknown,
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../utils/errorHandling', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
        role: { slug: 'member' },
        permissions: [],
      },
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

vi.mock('react-hot-toast', () => ({
  // Callable (neutral toasts) with .success/.error helpers.
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

describe('TrainingProgramsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrograms.mockResolvedValue([
      {
        id: 'prog-1',
        name: 'Probationary Firefighter',
        description: '12-month probationary program',
        structure_type: 'sequential',
        target_position: 'probationary',
        active: true,
        is_template: false,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetRequirementsEnhanced.mockResolvedValue([]);
    mockGetRegistries.mockResolvedValue([]);
    mockGetSampleTemplates.mockResolvedValue([
      {
        key: 'firefighter-recruit-school',
        name: 'Firefighter Recruit School (NFPA 1001 FF I & II)',
        description: 'Entry-level structural firefighter academy.',
        structure_type: 'phases',
        phase_count: 4,
        requirement_count: 21,
        time_limit_days: 180,
      },
    ]);
    mockInstantiateSampleTemplate.mockResolvedValue({
      id: 'prog-new',
      name: 'Firefighter Recruit School (NFPA 1001 FF I & II)',
      structure_type: 'phases',
      is_template: true,
      version: 1,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  it('renders the programs page', async () => {
    renderWithRouter(<TrainingProgramsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Training Programs');
    });
  });

  it('loads programs on mount', async () => {
    renderWithRouter(<TrainingProgramsPage />);
    await waitFor(() => {
      expect(mockGetPrograms).toHaveBeenCalledWith({ is_template: false });
    });
  });

  it('renders without crashing on empty data', async () => {
    mockGetPrograms.mockResolvedValue([]);
    const { container } = renderWithRouter(<TrainingProgramsPage />);
    expect(container).toBeInTheDocument();
  });

  it('shows the sample-template gallery on the Templates tab', async () => {
    mockGetPrograms.mockResolvedValue([]);
    renderWithRouter(<TrainingProgramsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Templates/i }));

    // The card only renders after getSampleTemplates resolves, so its presence
    // proves the gallery loaded.
    expect(await screen.findByText('Start from a sample template')).toBeInTheDocument();
    expect(
      screen.getByText('Firefighter Recruit School (NFPA 1001 FF I & II)'),
    ).toBeInTheDocument();
  });

  it('instantiates a sample template and navigates to the new program', async () => {
    mockGetPrograms.mockResolvedValue([]);
    renderWithRouter(<TrainingProgramsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Templates/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Add Firefighter Recruit School.*to my department/i }),
    );

    await waitFor(() =>
      expect(mockInstantiateSampleTemplate).toHaveBeenCalledWith('firefighter-recruit-school'),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/training/programs/prog-new'));
  });

  it('does not show a green success when a registry import returns 0', async () => {
    // One controlled registry so the import button is unambiguous.
    mockGetRegistries.mockResolvedValue([
      { key: 'emt', name: 'NREMT — EMT', description: '', requirement_count: 3 },
    ]);
    mockImportRegistry.mockResolvedValue({
      registry_name: 'NREMT — EMT', imported_count: 0, skipped_count: 0, errors: [],
    });
    renderWithRouter(<TrainingProgramsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Requirements/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Import NREMT — EMT/i }));

    await waitFor(() => expect(mockImportRegistry).toHaveBeenCalledWith('emt'));
    // Neutral toast (not success) with an explanatory message.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/No new requirements/i)),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('surfaces the error when a registry import reports one', async () => {
    mockGetRegistries.mockResolvedValue([
      { key: 'paramedic', name: 'NREMT — Paramedic', description: '', requirement_count: 5 },
    ]);
    mockImportRegistry.mockResolvedValue({
      registry_name: 'NREMT — Paramedic', imported_count: 0, skipped_count: 0,
      errors: ['Registry file not found'],
    });
    renderWithRouter(<TrainingProgramsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Requirements/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Import NREMT — Paramedic/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Registry file not found/i)),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
