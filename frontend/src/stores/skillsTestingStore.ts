/**
 * Skills Testing Store
 *
 * Manages state for the skills testing module using Zustand.
 * Handles templates, active tests, and testing summary data.
 */

import { create } from 'zustand';
import { skillsTestingService } from '../services/api';
import type {
  SkillTemplate,
  SkillTemplateCreate,
  SkillTemplateUpdate,
  SkillTemplateListItem,
  SkillTest,
  SkillTestCreate,
  SkillTestUpdate,
  SkillTestListItem,
  SkillTestingSummary,
  CriterionResult,
} from '../types/skillsTesting';
import { getErrorMessage } from '../utils/errorHandling';

interface SkillsTestingState {
  // Template state
  templates: SkillTemplateListItem[];
  currentTemplate: SkillTemplate | null;
  templatesLoading: boolean;
  templateLoading: boolean;

  // Test state
  tests: SkillTestListItem[];
  currentTest: SkillTest | null;
  testsLoading: boolean;
  testLoading: boolean;

  // Active test session state (for the mobile examiner screen)
  activeTestTimer: number;
  activeTestRunning: boolean;
  activeSectionIndex: number;

  // Summary
  summary: SkillTestingSummary | null;
  summaryLoading: boolean;

  // Error
  error: string | null;

  // Template actions
  loadTemplates: (params?: { status?: string; category?: string }) => Promise<void>;
  loadTemplate: (id: string) => Promise<void>;
  createTemplate: (data: SkillTemplateCreate) => Promise<SkillTemplate>;
  updateTemplate: (id: string, data: SkillTemplateUpdate) => Promise<SkillTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  publishTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<SkillTemplate>;

  // Test actions
  loadTests: (params?: { status?: string; candidate_id?: string; template_id?: string }) => Promise<void>;
  loadTest: (id: string) => Promise<void>;
  createTest: (data: SkillTestCreate) => Promise<SkillTest>;
  updateTest: (id: string, data: SkillTestUpdate) => Promise<SkillTest>;
  completeTest: (id: string) => Promise<SkillTest>;

  // Active test session actions
  setActiveSectionIndex: (index: number) => void;
  updateCriterionResult: (
    sectionId: string,
    criterionId: string,
    result: Partial<CriterionResult>,
    sectionName?: string,
    criterionLabel?: string,
  ) => void;
  setActiveTestTimer: (seconds: number) => void;
  setActiveTestRunning: (running: boolean) => void;

  // Summary actions
  loadSummary: () => Promise<void>;

  // General
  clearError: () => void;
  clearCurrentTemplate: () => void;
  clearCurrentTest: () => void;
}

export const useSkillsTestingStore = create<SkillsTestingState>((set, get) => ({
  // Initial state
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

  // Template actions
  loadTemplates: async (params) => {
    set({ templatesLoading: true, error: null });
    try {
      const templates = await skillsTestingService.getTemplates(params);
      set({ templates, templatesLoading: false });
    } catch (err: unknown) {
      set({
        templatesLoading: false,
        error: getErrorMessage(err, 'Failed to load templates'),
      });
    }
  },

  loadTemplate: async (id) => {
    set({ templateLoading: true, error: null });
    try {
      const template = await skillsTestingService.getTemplate(id);
      set({ currentTemplate: template, templateLoading: false });
    } catch (err: unknown) {
      set({
        templateLoading: false,
        error: getErrorMessage(err, 'Failed to load template'),
      });
    }
  },

  createTemplate: async (data) => {
    set({ error: null });
    try {
      const template = await skillsTestingService.createTemplate(data);
      set((state) => ({ templates: [{ ...template, section_count: template.sections.length, criteria_count: template.sections.reduce((sum, s) => sum + s.criteria.length, 0) }, ...state.templates] }));
      return template;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create template');
      set({ error: msg });
      throw err;
    }
  },

  updateTemplate: async (id, data) => {
    set({ error: null });
    try {
      const template = await skillsTestingService.updateTemplate(id, data);
      set({ currentTemplate: template });
      return template;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to update template');
      set({ error: msg });
      throw err;
    }
  },

  deleteTemplate: async (id) => {
    set({ error: null });
    try {
      await skillsTestingService.deleteTemplate(id);
      set((state) => ({
        templates: state.templates.filter((t) => t.id !== id),
      }));
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to delete template') });
      throw err;
    }
  },

  publishTemplate: async (id) => {
    set({ error: null });
    try {
      const template = await skillsTestingService.publishTemplate(id);
      set({ currentTemplate: template });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to publish template') });
      throw err;
    }
  },

  duplicateTemplate: async (id) => {
    set({ error: null });
    try {
      const template = await skillsTestingService.duplicateTemplate(id);
      return template;
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to duplicate template') });
      throw err;
    }
  },

  // Test actions
  loadTests: async (params) => {
    set({ testsLoading: true, error: null });
    try {
      const tests = await skillsTestingService.getTests(params);
      set({ tests, testsLoading: false });
    } catch (err: unknown) {
      set({
        testsLoading: false,
        error: getErrorMessage(err, 'Failed to load tests'),
      });
    }
  },

  loadTest: async (id) => {
    set({ testLoading: true, error: null });
    try {
      const test = await skillsTestingService.getTest(id);
      set({ currentTest: test, testLoading: false, activeSectionIndex: 0 });
    } catch (err: unknown) {
      set({
        testLoading: false,
        error: getErrorMessage(err, 'Failed to load test'),
      });
    }
  },

  createTest: async (data) => {
    set({ error: null });
    try {
      const test = await skillsTestingService.createTest(data);
      set({ currentTest: test });
      return test;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create test');
      set({ error: msg });
      throw err;
    }
  },

  updateTest: async (id, data) => {
    set({ error: null });
    try {
      const test = await skillsTestingService.updateTest(id, data);
      set({ currentTest: test });
      return test;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to save test progress');
      set({ error: msg });
      throw err;
    }
  },

  completeTest: async (id) => {
    set({ error: null });
    try {
      const test = await skillsTestingService.completeTest(id);
      set({ currentTest: test, activeTestRunning: false });
      return test;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to complete test');
      set({ error: msg });
      throw err;
    }
  },

  // Active test session actions
  setActiveSectionIndex: (index) => set({ activeSectionIndex: index }),

  updateCriterionResult: (sectionId, criterionId, result, sectionName?, criterionLabel?) => {
    const { currentTest } = get();
    if (!currentTest) return;

    const sectionResults = [...(currentTest.section_results || [])];
    let sectionResult = sectionResults.find((s) => s.section_id === sectionId);

    if (!sectionResult) {
      sectionResult = { section_id: sectionId, section_name: sectionName, criteria_results: [] };
      sectionResults.push(sectionResult);
    }

    const criteriaResults = [...sectionResult.criteria_results];
    const existingIndex = criteriaResults.findIndex((c) => c.criterion_id === criterionId);

    if (existingIndex >= 0) {
      const existing = criteriaResults[existingIndex];
      if (existing) {
        criteriaResults[existingIndex] = { ...existing, ...result };
      }
    } else {
      criteriaResults.push({
        criterion_id: criterionId,
        criterion_label: criterionLabel,
        passed: null,
        ...result,
      });
    }

    sectionResult = { ...sectionResult, criteria_results: criteriaResults };
    const sectionIdx = sectionResults.findIndex((s) => s.section_id === sectionId);
    if (sectionIdx >= 0) {
      sectionResults[sectionIdx] = sectionResult;
    }

    set({
      currentTest: {
        ...currentTest,
        section_results: sectionResults,
      },
    });
  },

  setActiveTestTimer: (seconds) => set({ activeTestTimer: seconds }),
  setActiveTestRunning: (running) => set({ activeTestRunning: running }),

  // Summary
  loadSummary: async () => {
    set({ summaryLoading: true, error: null });
    try {
      const summary = await skillsTestingService.getSummary();
      set({ summary, summaryLoading: false });
    } catch (err: unknown) {
      set({
        summaryLoading: false,
        error: getErrorMessage(err, 'Failed to load summary'),
      });
    }
  },

  // General
  clearError: () => set({ error: null }),
  clearCurrentTemplate: () => set({ currentTemplate: null }),
  clearCurrentTest: () => set({ currentTest: null, activeTestTimer: 0, activeTestRunning: false, activeSectionIndex: 0 }),
}));
