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

const mockSearchCandidates = vi.fn<(query: string) => Promise<{ id: string; name: string }[]>>();
vi.mock('../services/api', () => ({
  skillsTestingService: {
    searchCandidates: (query: string) => mockSearchCandidates(query),
  },
  trainingProgramService: {
    getRequirementsEnhanced: () => Promise.resolve([]),
  },
}));

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: 'user-1', first_name: 'Alex', last_name: 'Rivera' },
      checkPermission: (permission: string) => mockCheckPermission(permission),
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
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
    mockCheckPermission.mockReturnValue(false);
    mockSearchCandidates.mockResolvedValue([]);
  });

  describe('Template pre-selection from the ?template= hand-off', () => {
    /** The template step's own Change button. Both steps render a button
     *  reading "Change", so they are distinguished by aria-label — which is
     *  also what a screen-reader user needs to tell them apart. */
    const templateChangeButton = () => screen.queryByRole('button', { name: 'Change template' });

    /** The pre-selection waits on a template fetch and then an effect. Testing
     *  Library's 1s default is enough in isolation and marginal under a full
     *  parallel run, where this was the one test in 2,650 that flaked. */
    const SELECTION_TIMEOUT = { timeout: 5000 };

    it('should pre-select the template the user tapped', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-2&from=member');
      renderWithRouter(<StartSkillTestPage />);

      // The template name alone is not the signal — it is also a row in the
      // unselected picker. The step's Change button only exists once the
      // selection has applied, so wait on that.
      await waitFor(() => expect(templateChangeButton()).toBeInTheDocument(), SELECTION_TIMEOUT);

      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Search templates...')).not.toBeInTheDocument();
    });

    it('should let the user change a pre-selected template', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-2');
      const user = userEvent.setup();
      renderWithRouter(<StartSkillTestPage />);

      await waitFor(() => expect(templateChangeButton()).toBeInTheDocument(), SELECTION_TIMEOUT);
      await user.click(templateChangeButton() as HTMLElement);

      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
      expect(templateChangeButton()).not.toBeInTheDocument();
    });

    it('should warn when the hand-off points at an unavailable template', async () => {
      currentSearchParams = new URLSearchParams('template=tpl-missing');
      renderWithRouter(<StartSkillTestPage />);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('That test is no longer available — choose one below.');
      }, SELECTION_TIMEOUT);
      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
    });

    it('should show the picker when no template is passed', async () => {
      renderWithRouter(<StartSkillTestPage />);

      expect(await screen.findByPlaceholderText('Search templates...')).toBeInTheDocument();
      expect(templateChangeButton()).not.toBeInTheDocument();
    });
  });

  describe('Candidate lookup', () => {
    it('should not request anything below the search floor', async () => {
      const user = userEvent.setup();
      renderWithRouter(<StartSkillTestPage />);

      // Clear the self-default so the search box is on screen.
      await user.click(await screen.findByRole('button', { name: 'Change candidate' }));
      await user.type(screen.getByPlaceholderText('Type a name to search...'), 'a');

      // Long enough to outlast the debounce, so this is "never fired" rather
      // than "not fired yet".
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(mockSearchCandidates).not.toHaveBeenCalled();
      expect(screen.getByText(/Type at least 2 characters of a name/)).toBeInTheDocument();
    });

    it('should search server-side and render the matches', async () => {
      const user = userEvent.setup();
      mockSearchCandidates.mockResolvedValue([{ id: 'user-9', name: 'Dana Whitfield' }]);
      renderWithRouter(<StartSkillTestPage />);

      await user.click(await screen.findByRole('button', { name: 'Change candidate' }));
      await user.type(screen.getByPlaceholderText('Type a name to search...'), 'whit');

      expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
      // The query goes to the server — the page never holds a roster to filter.
      expect(mockSearchCandidates).toHaveBeenCalledWith('whit');
    });

    it('should keep the picked candidate after the results are cleared', async () => {
      const user = userEvent.setup();
      mockSearchCandidates.mockResolvedValue([{ id: 'user-9', name: 'Dana Whitfield' }]);
      renderWithRouter(<StartSkillTestPage />);

      await user.click(await screen.findByRole('button', { name: 'Change candidate' }));
      await user.type(screen.getByPlaceholderText('Type a name to search...'), 'whit');
      await user.click(await screen.findByText('Dana Whitfield'));

      // Selecting clears the search box, which empties the results — the name
      // has to survive that, since it is no longer in any list.
      expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Type a name to search...')).not.toBeInTheDocument();
    });

    it('should default a members practice run to themselves without a lookup', async () => {
      renderWithRouter(<StartSkillTestPage />);

      expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(mockSearchCandidates).not.toHaveBeenCalled();
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
