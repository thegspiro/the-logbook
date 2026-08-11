import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SkillTemplateBuilderPage from './SkillTemplateBuilderPage';

// Mock the store
const mockCreateTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockPublishTemplate = vi.fn();
const mockLoadTemplate = vi.fn();
const mockClearCurrentTemplate = vi.fn();

let currentMockTemplate: Record<string, unknown> | null = null;
let mockRouteId: string | undefined = undefined;

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: vi.fn((selector) => {
    const state = {
      currentTemplate: currentMockTemplate,
      templateLoading: false,
      loadTemplate: mockLoadTemplate,
      createTemplate: mockCreateTemplate,
      updateTemplate: mockUpdateTemplate,
      publishTemplate: mockPublishTemplate,
      clearCurrentTemplate: mockClearCurrentTemplate,
      error: null,
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

// The builder loads requirements, positions and the org config on mount. Left
// unmocked these hit axios and are swallowed by the page's own try/catch, which
// would silently leave the position list empty.
const mockGetRoles = vi.fn();
const mockGetConfig = vi.fn();
vi.mock('../services/api', () => ({
  trainingProgramService: {
    getRequirementsEnhanced: () => Promise.resolve([]),
  },
  roleService: {
    getRoles: () => mockGetRoles() as Promise<unknown>,
  },
  trainingModuleConfigService: {
    getConfig: () => mockGetConfig() as Promise<unknown>,
  },
}));

// Mock react-router
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: mockRouteId }),
  };
});

describe('SkillTemplateBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoles.mockResolvedValue([]);
    mockGetConfig.mockResolvedValue({});
    currentMockTemplate = null;
    mockRouteId = undefined;
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
      expect(saveButtons.length).toBeGreaterThanOrEqual(1);
      const mainSaveButton = saveButtons[saveButtons.length - 1] as HTMLElement;
      await user.click(mainSaveButton);

      expect(screen.getByText(/template name is required/i)).toBeInTheDocument();
    });

    it('should show validation errors when section name is empty', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      // Fill template name but leave section name empty
      const nameInput = screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i);
      await user.type(nameInput, 'Test Template');

      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      expect(saveButtons.length).toBeGreaterThanOrEqual(1);
      const mainSaveButton = saveButtons[saveButtons.length - 1] as HTMLElement;
      await user.click(mainSaveButton);

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
      expect(saveButtons.length).toBeGreaterThanOrEqual(1);
      const mainSaveButton = saveButtons[saveButtons.length - 1] as HTMLElement;
      await user.click(mainSaveButton);

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Template',
        })
      );
    });
  });

  // The per-template override of the department's disclosure policy. Left on
  // "Inherit" a template follows the organization, so the common case is to
  // touch nothing here — but the labels have to say what inheriting means.
  describe('Result disclosure', () => {
    const fillMinimalTemplate = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i), 'T');
      await user.type(screen.getByPlaceholderText(/section name/i), 'S');
      await user.type(screen.getByPlaceholderText(/dons scba/i), 'C');
    };

    const save = async (user: ReturnType<typeof userEvent.setup>) => {
      const buttons = screen.getAllByRole('button', { name: /save|create template/i });
      await user.click(buttons[buttons.length - 1] as HTMLElement);
    };

    it('names the inherited department default in the Inherit option', async () => {
      mockGetConfig.mockResolvedValue({
        skills_result_disclosure: 'scores',
        skills_result_release: 'on_release',
      });
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(await screen.findByRole('option', { name: /Inherit — Scores only/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Inherit — Only after an officer releases/i })).toBeInTheDocument();
    });

    it('falls back to the platform default when the org config cannot be read', async () => {
      mockGetConfig.mockRejectedValue(new Error('nope'));
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(await screen.findByRole('option', { name: /Inherit — Full results/i })).toBeInTheDocument();
    });

    // Nothing to time when results are never shown at all.
    it('hides the release question when disclosure is set to nothing', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.getByLabelText(/when they see it/i)).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/what the member sees/i), 'none');

      expect(screen.queryByLabelText(/when they see it/i)).not.toBeInTheDocument();
    });

    it('sends null for the fields left on Inherit', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await fillMinimalTemplate(user);
      await save(user);

      // null rather than undefined: the backend drops unset fields, so an
      // undefined would leave a previous override in place instead of clearing it.
      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          result_disclosure: null,
          result_release: null,
          result_viewer_positions: null,
        })
      );
    });

    // Deliberately changed *last*, after the rest of the form is filled. The
    // payload builder is memoized, so setting these first would let unrelated
    // dependencies rebuild it and mask a missing dependency on these fields.
    it('sends the chosen overrides', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await fillMinimalTemplate(user);
      await user.selectOptions(screen.getByLabelText(/what the member sees/i), 'scores');
      await user.selectOptions(screen.getByLabelText(/when they see it/i), 'on_release');
      await save(user);

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          result_disclosure: 'scores',
          result_release: 'on_release',
        })
      );
    });

    // The API returns roles ordered by `priority DESC`, which is an
    // authorization ranking rather than an org chart — IT Manager is seeded at
    // 100, above Fire Chief at 95 — so rank order opens the list with the most
    // privileged account rather than the most senior officer. In a checkbox
    // list someone is scanning for a title, alphabetical is what they can
    // predict before they look.
    it('lists positions alphabetically, not in the order the API returns', async () => {
      mockGetRoles.mockResolvedValue([
        { id: 'r1', name: 'IT Manager', slug: 'it-manager', priority: 100 },
        { id: 'r2', name: 'Fire Chief', slug: 'fire-chief', priority: 95 },
        { id: 'r3', name: 'Deputy Chief', slug: 'deputy-chief', priority: 90 },
        { id: 'r4', name: 'Assistant Chief', slug: 'assistant-chief', priority: 85 },
      ]);
      renderWithRouter(<SkillTemplateBuilderPage />);

      await screen.findByRole('checkbox', { name: 'Fire Chief' });
      const picker = screen.getByRole('group', { name: /also visible to these positions/i });
      const names = within(picker)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('aria-label') || (box as HTMLInputElement).labels?.[0]?.textContent?.trim());

      expect(names).toEqual(['Assistant Chief', 'Deputy Chief', 'Fire Chief', 'IT Manager']);
    });

    it('sends selected position slugs, not names or ids', async () => {
      mockGetRoles.mockResolvedValue([
        { id: 'r1', name: 'Preceptor', slug: 'preceptor' },
        { id: 'r2', name: 'Captain', slug: 'captain' },
      ]);
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await fillMinimalTemplate(user);
      await user.click(await screen.findByRole('checkbox', { name: 'Preceptor' }));
      await save(user);

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ result_viewer_positions: ['preceptor'] })
      );
    });

    // Opening an existing template must show the override it actually has, not
    // "Inherit" — otherwise saving an untouched form would silently clear it.
    it('hydrates the overrides of the template being edited', async () => {
      mockRouteId = 'tpl-1';
      currentMockTemplate = {
        id: 'tpl-1',
        name: 'Promotional Evaluation',
        visibility: 'all_members',
        require_all_critical: true,
        sections: [],
        tags: [],
        result_disclosure: 'none',
        result_release: 'on_release',
        result_viewer_positions: ['preceptor'],
      };
      mockGetRoles.mockResolvedValue([{ id: 'r1', name: 'Preceptor', slug: 'preceptor' }]);

      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(await screen.findByLabelText(/what the member sees/i)).toHaveValue('none');
      const preceptor = await screen.findByRole('checkbox', { name: 'Preceptor' });
      expect(preceptor).toBeChecked();
      // 'none' hides the release question, so its stored value is not rendered.
      expect(screen.queryByLabelText(/when they see it/i)).not.toBeInTheDocument();
    });

    it('omits the position picker when the org has no positions to offer', () => {
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.queryByText(/also visible to these positions/i)).not.toBeInTheDocument();
    });
  });

  // A passing threshold only means anything on a critical criterion: a
  // non-critical one contributes points to the overall score and cannot fail
  // the test on its own, so the field previously asked for a number that was
  // then ignored.
  describe('Passing Points visibility', () => {
    // The page mounts with one section holding one pass/fail criterion, so
    // there is nothing to add — just switch that criterion to a scored one.
    const makeCriterionScored = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.selectOptions(screen.getByDisplayValue('Pass / Fail'), 'score');
    };

    it('hides Passing Points on a non-critical score criterion', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await makeCriterionScored(user);

      expect(screen.getByText('Max Points')).toBeInTheDocument();
      expect(screen.queryByText('Passing Points')).not.toBeInTheDocument();
    });

    it('shows Passing Points once the criterion is marked critical', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await makeCriterionScored(user);
      await user.click(screen.getByRole('checkbox', { name: /must pass to pass the test/i }));

      expect(screen.getByText('Passing Points')).toBeInTheDocument();
    });

    it('hides it again when Critical is unchecked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await makeCriterionScored(user);
      const critical = screen.getByRole('checkbox', { name: /must pass to pass the test/i });

      await user.click(critical);
      expect(screen.getByText('Passing Points')).toBeInTheDocument();

      await user.click(critical);
      expect(screen.queryByText('Passing Points')).not.toBeInTheDocument();
    });
  });

  // Where a statement sits relative to the clock is a property of the sheet:
  // an opening brief is read before the candidate is in position, a
  // mid-evolution prompt runs against the time limit.
  describe('Statement timing', () => {
    const makeCriterionAStatement = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.selectOptions(screen.getByDisplayValue('Pass / Fail'), 'statement');
    };

    const timingCheckbox = () => screen.getByRole('checkbox', { name: /read inside the time limit/i });

    it('offers the timing choice only on a statement', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      expect(screen.queryByRole('checkbox', { name: /read inside the time limit/i })).not.toBeInTheDocument();

      await makeCriterionAStatement(user);

      expect(timingCheckbox()).toBeInTheDocument();
    });

    it('defaults to off, so a statement is read off the clock', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await makeCriterionAStatement(user);

      expect(timingCheckbox()).not.toBeChecked();
    });

    it('sends starts_timer with the statement when ticked', async () => {
      mockCreateTemplate.mockResolvedValue({ id: 'new-tpl-1', name: 'T', sections: [] });
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.type(screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i), 'Timed Statement Template');
      await user.type(screen.getByPlaceholderText(/section name/i), 'Section 1');
      await user.type(screen.getByPlaceholderText(/dons scba/i), 'Opening statement');
      await makeCriterionAStatement(user);
      await user.type(screen.getByPlaceholderText(/statement the evaluator must read/i), 'Your time starts now.');
      await user.click(timingCheckbox());

      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      await user.click(saveButtons[saveButtons.length - 1] as HTMLElement);

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [
            expect.objectContaining({
              criteria: [expect.objectContaining({ type: 'statement', starts_timer: true })],
            }),
          ],
        })
      );
    });

    it('does not carry the flag over to a step that is no longer a statement', async () => {
      mockCreateTemplate.mockResolvedValue({ id: 'new-tpl-1', name: 'T', sections: [] });
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.type(screen.getByPlaceholderText(/SCBA Proficiency Evaluation/i), 'Switched Template');
      await user.type(screen.getByPlaceholderText(/section name/i), 'Section 1');
      await user.type(screen.getByPlaceholderText(/dons scba/i), 'Was a statement');
      await makeCriterionAStatement(user);
      await user.click(timingCheckbox());
      // Author changes their mind: it becomes a scored step instead.
      await user.selectOptions(screen.getByDisplayValue('Statement'), 'score');

      const saveButtons = screen.getAllByRole('button', { name: /save|create template/i });
      await user.click(saveButtons[saveButtons.length - 1] as HTMLElement);

      expect(mockCreateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [
            expect.objectContaining({
              criteria: [expect.objectContaining({ type: 'score', starts_timer: false })],
            }),
          ],
        })
      );
    });
  });
});
