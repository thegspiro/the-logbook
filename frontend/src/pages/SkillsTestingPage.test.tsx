import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { SkillsTestingPage } from './SkillsTestingPage';

// Mock the store
const mockLoadTemplates = vi.fn();
const mockLoadTests = vi.fn();
const mockLoadSummary = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockPublishTemplate = vi.fn();
const mockDuplicateTemplate = vi.fn();

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
          status: 'draft',
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
          overall_score: 95,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T10:30:00Z',
          created_at: '2026-01-15T10:00:00Z',
        },
      ],
      testsLoading: false,
      summary: {
        total_templates: 5,
        published_templates: 3,
        total_tests: 42,
        tests_this_month: 8,
        pass_rate: 85,
        average_score: 88,
      },
      summaryLoading: false,
      loadTemplates: mockLoadTemplates,
      loadTests: mockLoadTests,
      loadSummary: mockLoadSummary,
      deleteTemplate: mockDeleteTemplate,
      publishTemplate: mockPublishTemplate,
      duplicateTemplate: mockDuplicateTemplate,
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
    useSearchParams: () => [new URLSearchParams(''), vi.fn()],
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

    it('should display summary cards', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('Tests This Month')).toBeInTheDocument();
      expect(screen.getByText('Pass Rate')).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(screen.getByText('Avg Score')).toBeInTheDocument();
      expect(screen.getByText('88%')).toBeInTheDocument();
    });

    it('should display tab navigation', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getAllByText('Templates').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Test Records')).toBeInTheDocument();
    });

    it('should load summary on mount', () => {
      renderWithRouter(<SkillsTestingPage />);
      expect(mockLoadSummary).toHaveBeenCalled();
    });
  });

  describe('Templates Tab', () => {
    it('should display template list', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('SCBA Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
    });

    it('should display template status badges', () => {
      renderWithRouter(<SkillsTestingPage />);

      expect(screen.getByText('published')).toBeInTheDocument();
      expect(screen.getByText('draft')).toBeInTheDocument();
    });

    it('should have a New Template button', () => {
      renderWithRouter(<SkillsTestingPage />);

      const button = screen.getByRole('button', { name: /new template/i });
      expect(button).toBeInTheDocument();
    });

    it('should filter templates by search', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillsTestingPage />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      await user.type(searchInput, 'Ladder');

      expect(screen.getByText('Ladder Operations')).toBeInTheDocument();
      expect(screen.queryByText('SCBA Evaluation')).not.toBeInTheDocument();
    });
  });
});
