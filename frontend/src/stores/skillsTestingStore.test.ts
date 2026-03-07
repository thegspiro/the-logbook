import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsTestingStore } from './skillsTestingStore';
import * as apiModule from '../services/api';

// Mock the API service
vi.mock('../services/api', () => ({
  skillsTestingService: {
    getTemplates: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    publishTemplate: vi.fn(),
    duplicateTemplate: vi.fn(),
    getTests: vi.fn(),
    getTest: vi.fn(),
    createTest: vi.fn(),
    updateTest: vi.fn(),
    completeTest: vi.fn(),
    deleteTest: vi.fn(),
    discardPracticeTest: vi.fn(),
    emailTestResults: vi.fn(),
    getSummary: vi.fn(),
  },
  userService: {
    getUsers: vi.fn().mockResolvedValue([]),
  },
}));

const { skillsTestingService } = apiModule;

const mockTemplate = {
  id: 'tpl-1',
  organization_id: 'org-1',
  name: 'SCBA Evaluation',
  description: 'SCBA proficiency test',
  category: 'Fire Operations',
  version: 1,
  status: 'draft' as const,
  visibility: 'all_members' as const,
  sections: [
    {
      id: 'sec-1',
      name: 'Donning',
      sort_order: 0,
      criteria: [
        {
          id: 'crit-1',
          label: 'Don SCBA in under 60 seconds',
          type: 'pass_fail' as const,
          required: true,
          sort_order: 0,
        },
      ],
    },
  ],
  time_limit_seconds: 300,
  passing_percentage: 80,
  require_all_critical: true,
  tags: ['NFPA 1001'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockTemplateListItem = {
  id: 'tpl-1',
  name: 'SCBA Evaluation',
  description: 'SCBA proficiency test',
  category: 'Fire Operations',
  status: 'draft' as const,
  visibility: 'all_members' as const,
  version: 1,
  section_count: 1,
  criteria_count: 1,
  tags: ['NFPA 1001'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockTest = {
  id: 'test-1',
  organization_id: 'org-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'in_progress' as const,
  result: 'incomplete' as const,
  is_practice: false,
  section_results: [],
  overall_score: undefined,
  elapsed_seconds: 0,
  notes: '',
  started_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockSummary = {
  total_templates: 5,
  published_templates: 3,
  total_tests: 42,
  tests_this_month: 8,
  pass_rate: 85,
  average_score: 88,
};

describe('skillsTestingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useSkillsTestingStore.setState({
      templates: [],
      currentTemplate: null,
      templatesLoading: false,
      templateLoading: false,
      tests: [],
      currentTest: null,
      testsLoading: false,
      testLoading: false,
      activeTestTimer: 0,
      activeTestRunning: false,
      activeSectionIndex: 0,
      summary: null,
      summaryLoading: false,
      error: null,
    });
  });

  describe('Template actions', () => {
    it('should load templates', async () => {
      vi.mocked(skillsTestingService.getTemplates).mockResolvedValue([mockTemplateListItem]);

      await useSkillsTestingStore.getState().loadTemplates();

      expect(skillsTestingService.getTemplates).toHaveBeenCalled();
      expect(useSkillsTestingStore.getState().templates).toHaveLength(1);
      expect(useSkillsTestingStore.getState().templates[0]?.name).toBe('SCBA Evaluation');
      expect(useSkillsTestingStore.getState().templatesLoading).toBe(false);
    });

    it('should load templates with filters', async () => {
      vi.mocked(skillsTestingService.getTemplates).mockResolvedValue([]);

      await useSkillsTestingStore.getState().loadTemplates({ status: 'published' });

      expect(skillsTestingService.getTemplates).toHaveBeenCalledWith({ status: 'published' });
    });

    it('should handle template loading error', async () => {
      vi.mocked(skillsTestingService.getTemplates).mockRejectedValue(new Error('Network error'));

      await useSkillsTestingStore.getState().loadTemplates();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
      expect(useSkillsTestingStore.getState().templatesLoading).toBe(false);
    });

    it('should load a single template', async () => {
      vi.mocked(skillsTestingService.getTemplate).mockResolvedValue(mockTemplate);

      await useSkillsTestingStore.getState().loadTemplate('tpl-1');

      expect(skillsTestingService.getTemplate).toHaveBeenCalledWith('tpl-1');
      expect(useSkillsTestingStore.getState().currentTemplate?.name).toBe('SCBA Evaluation');
    });

    it('should create a template', async () => {
      vi.mocked(skillsTestingService.createTemplate).mockResolvedValue(mockTemplate);

      const result = await useSkillsTestingStore.getState().createTemplate({
        name: 'SCBA Evaluation',
        sections: mockTemplate.sections.map((s) => ({
          name: s.name,
          sort_order: s.sort_order,
          criteria: s.criteria.map((c) => ({
            label: c.label,
            type: c.type,
            required: c.required,
            sort_order: c.sort_order,
          })),
        })),
      });

      expect(result.name).toBe('SCBA Evaluation');
      expect(useSkillsTestingStore.getState().templates).toHaveLength(1);
    });

    it('should delete a template', async () => {
      useSkillsTestingStore.setState({ templates: [mockTemplateListItem] });
      vi.mocked(skillsTestingService.deleteTemplate).mockResolvedValue(undefined);

      await useSkillsTestingStore.getState().deleteTemplate('tpl-1');

      expect(useSkillsTestingStore.getState().templates).toHaveLength(0);
    });

    it('should publish a template', async () => {
      vi.mocked(skillsTestingService.publishTemplate).mockResolvedValue({
        ...mockTemplate,
        status: 'published',
      });

      await useSkillsTestingStore.getState().publishTemplate('tpl-1');

      expect(useSkillsTestingStore.getState().currentTemplate?.status).toBe('published');
    });

    it('should duplicate a template', async () => {
      const duplicated = { ...mockTemplate, id: 'tpl-2', name: 'SCBA Evaluation (Copy)' };
      vi.mocked(skillsTestingService.duplicateTemplate).mockResolvedValue(duplicated);

      const result = await useSkillsTestingStore.getState().duplicateTemplate('tpl-1');

      expect(result.id).toBe('tpl-2');
    });

    it('should handle single template loading error', async () => {
      vi.mocked(skillsTestingService.getTemplate).mockRejectedValue(new Error('Not found'));

      await useSkillsTestingStore.getState().loadTemplate('tpl-1');

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
      expect(useSkillsTestingStore.getState().templateLoading).toBe(false);
    });

    it('should handle create template error and re-throw', async () => {
      vi.mocked(skillsTestingService.createTemplate).mockRejectedValue(new Error('Validation error'));

      await expect(useSkillsTestingStore.getState().createTemplate({
        name: 'Bad Template',
        sections: [],
      })).rejects.toThrow();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle update template error and re-throw', async () => {
      vi.mocked(skillsTestingService.updateTemplate).mockRejectedValue(new Error('Update failed'));

      await expect(useSkillsTestingStore.getState().updateTemplate('tpl-1', {
        name: 'Updated Name',
      })).rejects.toThrow();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle delete template error and re-throw', async () => {
      vi.mocked(skillsTestingService.deleteTemplate).mockRejectedValue(new Error('Delete failed'));

      await expect(useSkillsTestingStore.getState().deleteTemplate('tpl-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle publish template error and re-throw', async () => {
      vi.mocked(skillsTestingService.publishTemplate).mockRejectedValue(new Error('Publish failed'));

      await expect(useSkillsTestingStore.getState().publishTemplate('tpl-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle duplicate template error and re-throw', async () => {
      vi.mocked(skillsTestingService.duplicateTemplate).mockRejectedValue(new Error('Duplicate failed'));

      await expect(useSkillsTestingStore.getState().duplicateTemplate('tpl-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });
  });

  describe('Test actions', () => {
    it('should load tests', async () => {
      vi.mocked(skillsTestingService.getTests).mockResolvedValue([
        {
          id: 'test-1',
          template_name: 'SCBA Evaluation',
          candidate_name: 'John Smith',
          examiner_name: 'Captain Jones',
          status: 'in_progress',
          result: 'incomplete',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]);

      await useSkillsTestingStore.getState().loadTests();

      expect(useSkillsTestingStore.getState().tests).toHaveLength(1);
    });

    it('should load a single test', async () => {
      vi.mocked(skillsTestingService.getTest).mockResolvedValue(mockTest);

      await useSkillsTestingStore.getState().loadTest('test-1');

      expect(useSkillsTestingStore.getState().currentTest?.candidate_name).toBe('John Smith');
      expect(useSkillsTestingStore.getState().activeSectionIndex).toBe(0);
    });

    it('should create a test', async () => {
      vi.mocked(skillsTestingService.createTest).mockResolvedValue(mockTest);

      const result = await useSkillsTestingStore.getState().createTest({
        template_id: 'tpl-1',
        candidate_id: 'user-1',
      });

      expect(result.id).toBe('test-1');
      expect(useSkillsTestingStore.getState().currentTest?.id).toBe('test-1');
    });

    it('should complete a test', async () => {
      const completedTest = { ...mockTest, status: 'completed' as const, result: 'pass' as const, overall_score: 95 };
      vi.mocked(skillsTestingService.completeTest).mockResolvedValue(completedTest);

      useSkillsTestingStore.setState({ activeTestRunning: true });
      const result = await useSkillsTestingStore.getState().completeTest('test-1');

      expect(result.result).toBe('pass');
      expect(useSkillsTestingStore.getState().activeTestRunning).toBe(false);
    });

    it('should delete a test and remove it from the list', async () => {
      useSkillsTestingStore.setState({
        tests: [{ id: 'test-1', template_name: 'T', candidate_name: 'C', examiner_name: 'E', status: 'completed', result: 'pass', created_at: '' }],
        currentTest: mockTest,
      });
      vi.mocked(skillsTestingService.deleteTest).mockResolvedValue(undefined);

      await useSkillsTestingStore.getState().deleteTest('test-1');

      expect(useSkillsTestingStore.getState().tests).toHaveLength(0);
      expect(useSkillsTestingStore.getState().currentTest).toBeNull();
    });

    it('should discard a practice test', async () => {
      useSkillsTestingStore.setState({
        tests: [{ id: 'test-1', template_name: 'T', candidate_name: 'C', examiner_name: 'E', status: 'in_progress', result: 'incomplete', created_at: '' }],
        currentTest: mockTest,
      });
      vi.mocked(skillsTestingService.discardPracticeTest).mockResolvedValue(undefined);

      await useSkillsTestingStore.getState().discardPracticeTest('test-1');

      expect(useSkillsTestingStore.getState().tests).toHaveLength(0);
      expect(useSkillsTestingStore.getState().currentTest).toBeNull();
    });

    it('should email test results', async () => {
      vi.mocked(skillsTestingService.emailTestResults).mockResolvedValue({ message: 'Email sent' });

      const result = await useSkillsTestingStore.getState().emailTestResults('test-1');

      expect(result).toBe('Email sent');
    });

    it('should handle delete test error', async () => {
      vi.mocked(skillsTestingService.deleteTest).mockRejectedValue(new Error('Delete failed'));

      await expect(useSkillsTestingStore.getState().deleteTest('test-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle email test results error', async () => {
      vi.mocked(skillsTestingService.emailTestResults).mockRejectedValue(new Error('Email failed'));

      await expect(useSkillsTestingStore.getState().emailTestResults('test-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });
  });

  describe('Active test session actions', () => {
    it('should set active section index', () => {
      useSkillsTestingStore.getState().setActiveSectionIndex(2);
      expect(useSkillsTestingStore.getState().activeSectionIndex).toBe(2);
    });

    it('should set active test timer', () => {
      useSkillsTestingStore.getState().setActiveTestTimer(120);
      expect(useSkillsTestingStore.getState().activeTestTimer).toBe(120);
    });

    it('should set active test running', () => {
      useSkillsTestingStore.getState().setActiveTestRunning(true);
      expect(useSkillsTestingStore.getState().activeTestRunning).toBe(true);
    });

    it('should update criterion result for existing section', () => {
      useSkillsTestingStore.setState({
        currentTest: {
          ...mockTest,
          section_results: [
            {
              section_id: 'sec-1',
              criteria_results: [
                { criterion_id: 'crit-1', passed: null },
              ],
            },
          ],
        },
      });

      useSkillsTestingStore.getState().updateCriterionResult('sec-1', 'crit-1', { passed: true });

      const sectionResult = useSkillsTestingStore.getState().currentTest?.section_results[0];
      const criterionResult = sectionResult?.criteria_results[0];
      expect(criterionResult?.passed).toBe(true);
    });

    it('should create section result if not existing', () => {
      useSkillsTestingStore.setState({
        currentTest: { ...mockTest, section_results: [] },
      });

      useSkillsTestingStore.getState().updateCriterionResult('sec-new', 'crit-new', { passed: false });

      const sectionResults = useSkillsTestingStore.getState().currentTest?.section_results ?? [];
      expect(sectionResults).toHaveLength(1);
      expect(sectionResults[0]?.section_id).toBe('sec-new');
    });

    it('should not update if no current test', () => {
      useSkillsTestingStore.setState({ currentTest: null });
      useSkillsTestingStore.getState().updateCriterionResult('sec-1', 'crit-1', { passed: true });
      expect(useSkillsTestingStore.getState().currentTest).toBeNull();
    });
  });

  describe('Summary', () => {
    it('should load summary', async () => {
      vi.mocked(skillsTestingService.getSummary).mockResolvedValue(mockSummary);

      await useSkillsTestingStore.getState().loadSummary();

      expect(useSkillsTestingStore.getState().summary?.pass_rate).toBe(85);
      expect(useSkillsTestingStore.getState().summaryLoading).toBe(false);
    });

    it('should handle summary loading error', async () => {
      vi.mocked(skillsTestingService.getSummary).mockRejectedValue(new Error('Summary error'));

      await useSkillsTestingStore.getState().loadSummary();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
      expect(useSkillsTestingStore.getState().summaryLoading).toBe(false);
    });

    it('should handle test loading error', async () => {
      vi.mocked(skillsTestingService.getTests).mockRejectedValue(new Error('Tests error'));

      await useSkillsTestingStore.getState().loadTests();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
      expect(useSkillsTestingStore.getState().testsLoading).toBe(false);
    });

    it('should handle single test loading error', async () => {
      vi.mocked(skillsTestingService.getTest).mockRejectedValue(new Error('Test error'));

      await useSkillsTestingStore.getState().loadTest('test-1');

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
      expect(useSkillsTestingStore.getState().testLoading).toBe(false);
    });

    it('should handle create test error and re-throw', async () => {
      vi.mocked(skillsTestingService.createTest).mockRejectedValue(new Error('Create error'));

      await expect(useSkillsTestingStore.getState().createTest({
        template_id: 'tpl-1',
        candidate_id: 'user-1',
      })).rejects.toThrow();

      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });

    it('should handle complete test error and re-throw', async () => {
      vi.mocked(skillsTestingService.completeTest).mockRejectedValue(new Error('Complete error'));

      await expect(useSkillsTestingStore.getState().completeTest('test-1')).rejects.toThrow();
      expect(useSkillsTestingStore.getState().error).toBeTruthy();
    });
  });

  describe('General actions', () => {
    it('should clear error', () => {
      useSkillsTestingStore.setState({ error: 'Some error' });
      useSkillsTestingStore.getState().clearError();
      expect(useSkillsTestingStore.getState().error).toBeNull();
    });

    it('should clear current template', () => {
      useSkillsTestingStore.setState({ currentTemplate: mockTemplate });
      useSkillsTestingStore.getState().clearCurrentTemplate();
      expect(useSkillsTestingStore.getState().currentTemplate).toBeNull();
    });

    it('should clear current test and reset session state', () => {
      useSkillsTestingStore.setState({
        currentTest: mockTest,
        activeTestTimer: 120,
        activeTestRunning: true,
        activeSectionIndex: 3,
      });
      useSkillsTestingStore.getState().clearCurrentTest();
      expect(useSkillsTestingStore.getState().currentTest).toBeNull();
      expect(useSkillsTestingStore.getState().activeTestTimer).toBe(0);
      expect(useSkillsTestingStore.getState().activeTestRunning).toBe(false);
      expect(useSkillsTestingStore.getState().activeSectionIndex).toBe(0);
    });
  });
});
