import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { SkillsTestingPage } from './SkillsTestingPage';

// Mock the store
const mockLoadTemplates = vi.fn();
const mockLoadTests = vi.fn();

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: vi.fn((selector) => {
    const state = {
      templates: [
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
          tags: ['NFPA 1001'],
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
      ],
      templatesLoading: false,
      tests: [
        {
          id: 'test-1',
          template_name: 'SCBA Evaluation',
          candidate_name: 'John Smith',
          examiner_name: 'Captain Jones',
          status: 'completed',
          result: 'pass',
          is_practice: false,
          overall_score: 95,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T10:30:00Z',
          created_at: '2026-01-15T10:00:00Z',
        },
      ],
      testsLoading: false,
      loadTemplates: mockLoadTemplates,
      loadTests: mockLoadTests,
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

// Mock auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: 'user-1', first_name: 'Test', last_name: 'User' },
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('SkillsTestingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should display the page heading', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Skills Testing');
    });

    it('should display tab navigation with Available Tests and My Results', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('Available Tests')).toBeInTheDocument();
      expect(screen.getByText('My Results')).toBeInTheDocument();
    });

    it('should load templates on mount', () => {
      renderWithRouter(<SkillsTestingPage />);
      expect(mockLoadTemplates).toHaveBeenCalledWith({ status: 'published' });
    });

    it('should load user test history on mount', () => {
      renderWithRouter(<SkillsTestingPage />);
      expect(mockLoadTests).toHaveBeenCalledWith({ candidate_id: 'user-1' });
    });
  });

  describe('Available Tests Tab', () => {
    it('should display template list', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('SCBA Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
    });

    it('should display template descriptions', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('SCBA proficiency test')).toBeInTheDocument();
      expect(screen.getByText('Ground and aerial ladder skills')).toBeInTheDocument();
    });

    it('should filter templates by search', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillsTestingPage />);

      const searchInput = screen.getByPlaceholderText('Search available tests...');
      await user.type(searchInput, 'Ladder');

      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
      expect(screen.queryByText('SCBA Evaluation')).not.toBeInTheDocument();
    });
  });

  describe('My Results Tab', () => {
    it('should switch to My Results tab', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillsTestingPage />);

      await user.click(screen.getByText('My Results'));

      expect(screen.getByPlaceholderText('Search your results...')).toBeInTheDocument();
    });
  });
});
