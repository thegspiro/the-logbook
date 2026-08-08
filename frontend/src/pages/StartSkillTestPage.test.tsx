import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { StartSkillTestPage } from './StartSkillTestPage';

const mockLoadTemplates = vi.fn(() => Promise.resolve());
const mockCreateTest = vi.fn();

const mockTemplates = [
  {
    id: 'tpl-1',
    name: 'SCBA Evaluation',
    description: 'SCBA proficiency test',
    category: 'Fire Operations',
    status: 'published',
    visibility: 'all_members',
    version: 1,
    section_count: 3,
    criteria_count: 12,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'tpl-2',
    name: 'Ladder Operations',
    description: 'Ground and aerial ladder skills',
    category: 'Fire Operations',
    status: 'published',
    visibility: 'all_members',
    version: 1,
    section_count: 2,
    criteria_count: 8,
    tags: [],
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: vi.fn((selector) => {
    const state = {
      templates: mockTemplates,
      templatesLoading: false,
      loadTemplates: mockLoadTemplates,
      createTest: mockCreateTest,
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

vi.mock('../services/api', () => ({
  userService: {
    getUsers: () =>
      Promise.resolve([{ id: 'user-1', first_name: 'John', last_name: 'Smith', email: 'john@example.com' }]),
  },
  trainingProgramService: {
    getRequirementsEnhanced: () => Promise.resolve([]),
  },
}));

const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (message: string) => mockToastError(message),
  },
}));

// Search params are swapped per test to simulate the different entry points
// into this page.
let currentSearchParams = new URLSearchParams('');
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [currentSearchParams, vi.fn()],
  };
});

describe('StartSkillTestPage', () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams('');
    vi.clearAllMocks();
  });

  describe('Template pre-selection from the ?template= hand-off', () => {
    it('should pre-select the template the user tapped', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-2&from=member');
      renderWithRouter(<StartSkillTestPage />);

      // The selected-template summary replaces the picker, so a "Change"
      // affordance is the signal that step 1 is already answered.
      expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Search templates...')).not.toBeInTheDocument();
    });

    it('should let the user change a pre-selected template', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-2');
      const user = userEvent.setup();
      renderWithRouter(<StartSkillTestPage />);

      await user.click(await screen.findByRole('button', { name: 'Change' }));

      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    });

    it('should warn when the hand-off points at an unavailable template', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-missing');
      renderWithRouter(<StartSkillTestPage />);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('That test is no longer available — choose one below.');
      });
      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
    });

    it('should show the picker when no template is passed', async () => {
      renderWithRouter(<StartSkillTestPage />);

      expect(await screen.findByPlaceholderText('Search templates...')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    });
  });

  describe('Back navigation', () => {
    it('should return to the member list when launched from it', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-1&from=member');
      renderWithRouter(<StartSkillTestPage />);

      expect(await screen.findByRole('link', { name: /back/i })).toHaveAttribute('href', '/training/skills-testing');
    });

    it('should return to the admin hub by default', async () => {
      renderWithRouter(<StartSkillTestPage />);

      expect(await screen.findByRole('link', { name: /back/i })).toHaveAttribute(
        'href',
        '/training/admin?page=skills-testing&tab=tests'
      );
    });
  });
});
