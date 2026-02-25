import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SkillTemplateBuilderPage from './SkillTemplateBuilderPage';

// Mock the store
const mockCreateTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockPublishTemplate = vi.fn();
const mockLoadTemplate = vi.fn();
const mockClearCurrentTemplate = vi.fn();

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: vi.fn((selector) => {
    const state = {
      currentTemplate: null,
      templateLoading: false,
      loadTemplate: mockLoadTemplate,
      createTemplate: mockCreateTemplate,
      updateTemplate: mockUpdateTemplate,
      publishTemplate: mockPublishTemplate,
      clearCurrentTemplate: mockClearCurrentTemplate,
      error: null,
    };
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  }),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: undefined }),
  };
});

describe('SkillTemplateBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should display New Template heading for create mode', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New Template');
    });

    it('should display template settings form', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByText('Template Settings')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i)).toBeInTheDocument();
    });

    it('should display the evaluation sections header', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByText('Evaluation Sections')).toBeInTheDocument();
    });

    it('should start with one empty section', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByText('Section 1')).toBeInTheDocument();
    });

    it('should have Save Draft button', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument();
    });

    it('should have back navigation link', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByText('Back to Skills Testing')).toBeInTheDocument();
    });
  });

  describe('Section Management', () => {
    it('should add a new section when Add Section is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.click(screen.getByRole('button', { name: /add section/i }));

      expect(screen.getByText('Section 1')).toBeInTheDocument();
      expect(screen.getByText('Section 2')).toBeInTheDocument();
    });

    it('should add a criterion within a section', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.click(screen.getByRole('button', { name: /add criterion/i }));

      // Should now have 2 criterion editors (index 1 and 2)
      const criterionLabels = screen.getAllByPlaceholderText(/dons scba/i);
      expect(criterionLabels.length).toBe(2);
    });
  });

  describe('Validation', () => {
    it('should show validation errors when template name is empty', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      // Click save without entering a name
      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      const mainSaveButton = saveButtons[saveButtons.length - 1];
      if (mainSaveButton) {
        await user.click(mainSaveButton);
      }

      expect(screen.getByText(/template name is required/i)).toBeInTheDocument();
    });

    it('should show validation errors when section name is empty', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      // Fill template name but leave section name empty
      const nameInput = screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i);
      await user.type(nameInput, 'Test Template');

      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      const mainSaveButton = saveButtons[saveButtons.length - 1];
      if (mainSaveButton) {
        await user.click(mainSaveButton);
      }

      expect(screen.getByText(/section 1: name is required/i)).toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('should call createTemplate on successful save', async () => {
      mockCreateTemplate.mockResolvedValue({
        id: 'new-tpl-1',
        name: 'Test Template',
        sections: [{ name: 'Section 1', criteria: [{ label: 'Test criterion' }] }],
      });

      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      // Fill required fields
      const nameInput = screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i);
      await user.type(nameInput, 'Test Template');

      const sectionNameInput = screen.getByPlaceholderText(/section name/i);
      await user.type(sectionNameInput, 'Section 1');

      const criterionInput = screen.getByPlaceholderText(/dons scba/i);
      await user.type(criterionInput, 'Test criterion');

      // Save
      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      const mainSaveButton = saveButtons[saveButtons.length - 1];
      if (mainSaveButton) {
        await user.click(mainSaveButton);
      }

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Template',
        })
      );
    });
  });
});
