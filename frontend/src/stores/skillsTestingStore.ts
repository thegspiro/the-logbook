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
  SkillTestListParams,
  SkillTestingSummary,
  CriterionResult,
} from '../types/skillsTesting';
import { getErrorMessage, isNetworkError } from '../utils/errorHandling';
import { useAuthStore } from './authStore';
import { displayNameOf } from '../utils/memberName';
import {
  SKILLS_OFFLINE_QUEUED_EVENT,
  applyPending,
  buildOfflineSkillTest,
  cacheSkillTest,
  enqueueSkillsComplete,
  enqueueSkillsCreate,
  enqueueSkillsUpdate,
  getCachedSkillTemplate,
  getCachedSkillTest,
  getOwnSkillsPending,
  mintTestId,
  rememberCandidate,
  type SkillsPendingEntry,
} from '../utils/skillsTestOffline';

interface SkillsTestingState {
  // Template state
  templates: SkillTemplateListItem[];
  currentTemplate: SkillTemplate | null;
  templatesLoading: boolean;
  templateLoading: boolean;

  // Test state — `tests` is the page last loaded, `testsTotal` every row the
  // same filters match, so a screen can page without fetching the rest.
  tests: SkillTestListItem[];
  testsTotal: number;
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

  /**
   * Offline state of the test on screen (see utils/skillsTestOffline.ts):
   * whether its scoring is waiting on this device to sync, whether a
   * submission is, and why the server refused it if it did. Null when the
   * test has nothing waiting.
   */
  offlineState: SkillsOfflineState | null;

  // Template actions
  loadTemplates: (params?: { status?: string; category?: string }) => Promise<void>;
  loadTemplate: (id: string) => Promise<void>;
  createTemplate: (data: SkillTemplateCreate) => Promise<SkillTemplate>;
  updateTemplate: (id: string, data: SkillTemplateUpdate) => Promise<SkillTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  publishTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<SkillTemplate>;

  // Test actions
  loadTests: (params?: SkillTestListParams) => Promise<void>;
  loadTest: (id: string) => Promise<void>;
  /** `candidateName` lets a test started with no signal be labelled. */
  createTest: (data: SkillTestCreate, offline?: { candidateName: string }) => Promise<SkillTest>;
  updateTest: (id: string, data: SkillTestUpdate) => Promise<SkillTest>;
  completeTest: (id: string) => Promise<SkillTest>;
  deleteTest: (id: string) => Promise<void>;
  discardPracticeTest: (id: string) => Promise<void>;
  voidTest: (id: string, reason: string) => Promise<SkillTest>;
  returnTest: (id: string, reason: string) => Promise<SkillTest>;
  bulkValidateTests: (
    ids: string[]
  ) => Promise<{ validated: string[]; skipped: { test_id: string; reason: string }[] }>;
  cancelTest: (id: string, reason?: string) => Promise<SkillTest>;
  validateTest: (id: string) => Promise<SkillTest>;
  releaseTest: (id: string) => Promise<SkillTest>;
  emailTestResults: (id: string) => Promise<string>;

  // Active test session actions
  setActiveSectionIndex: (index: number) => void;
  updateCriterionResult: (
    sectionId: string,
    criterionId: string,
    result: Partial<CriterionResult>,
    sectionName?: string,
    criterionLabel?: string
  ) => void;
  setActiveTestTimer: (seconds: number) => void;
  setActiveTestRunning: (running: boolean) => void;

  // Summary actions
  loadSummary: () => Promise<void>;

  /** Called by the sync engine after the offline queue sent a test's work. */
  handleSynced: (testId: string, test: SkillTest | null, completed: boolean) => Promise<void>;

  // General
  clearError: () => void;
  clearCurrentTemplate: () => void;
  clearCurrentTest: () => void;
}

export interface SkillsOfflineState {
  testId: string;
  /** Scoring is saved on this device and has not reached the server. */
  queued: boolean;
  /** The examiner submitted; it is scored once it reaches the server. */
  completionQueued: boolean;
  /** The server refused the queued work; the payload is kept. */
  failed: string | null;
}

const offlineStateFor = (testId: string, entry: SkillsPendingEntry | null): SkillsOfflineState | null =>
  entry
    ? {
        testId,
        queued: true,
        completionQueued: entry.complete,
        failed: entry.failed?.message ?? null,
      }
    : null;

const testLabel = (test: { template_name?: string | undefined; candidate_name?: string | undefined } | null) =>
  [test?.template_name, test?.candidate_name].filter(Boolean).join(' — ') || 'Skills evaluation';

/** Tell the sync engine there is something to send (it decides whether it can). */
const announceQueued = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SKILLS_OFFLINE_QUEUED_EVENT));
};

/** Only the examiner's own live tests are kept on the device. */
const cacheIfExamining = (test: SkillTest) => {
  if (test.examiner_id === useAuthStore.getState().user?.id) void cacheSkillTest(test);
};

/** Drop a deleted test from the loaded page, and from the count behind it, so
 *  the pager does not offer a page that no longer has anything on it. */
const removeListedTest = (state: SkillsTestingState, id: string): Partial<SkillsTestingState> => {
  const tests = state.tests.filter((t) => t.id !== id);
  return {
    tests,
    testsTotal: Math.max(0, state.testsTotal - (state.tests.length - tests.length)),
    currentTest: state.currentTest?.id === id ? null : state.currentTest,
  };
};

export const useSkillsTestingStore = create<SkillsTestingState>((set, get) => ({
  // Initial state
  templates: [],
  currentTemplate: null,
  templatesLoading: false,
  templateLoading: false,
  tests: [],
  testsTotal: 0,
  currentTest: null,
  testsLoading: false,
  testLoading: false,
  activeTestTimer: 0,
  activeTestRunning: false,
  activeSectionIndex: 0,
  summary: null,
  summaryLoading: false,
  error: null,
  offlineState: null,

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
      set((state) => ({
        templates: [
          {
            ...template,
            section_count: template.sections.length,
            criteria_count: template.sections.reduce((sum, s) => sum + s.criteria.length, 0),
          },
          ...state.templates,
        ],
      }));
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
      const page = await skillsTestingService.getTests(params);
      set({ tests: page.items, testsTotal: page.total, testsLoading: false });
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
      let test: SkillTest;
      try {
        test = await skillsTestingService.getTest(id);
        cacheIfExamining(test);
      } catch (err: unknown) {
        // The read path (offline plan, phase 3): with no signal, the copy kept
        // when the test was last opened here is what the examiner scores into.
        if (!isNetworkError(err)) throw err;
        const cached = await getCachedSkillTest(id);
        if (!cached) {
          throw new Error(
            'You are offline, and this test has not been opened on this device yet. Open it once with signal to score it offline.',
            { cause: err }
          );
        }
        test = cached;
      }
      // Work still waiting to sync is newer than either copy.
      const entry = await getOwnSkillsPending(id);
      test = applyPending(test, entry);
      // Only a *different* test starts at section 1. Re-loading the one
      // already open — a second in-flight load, a retry after a failed save,
      // a manual refresh — used to reset the index unconditionally, and it
      // resolved after the screen had already jumped the examiner to the
      // first section with blank steps. The jump ran, then this overwrote it,
      // and a half-scored evaluation reopened at section 1 with no clue why.
      const sameTest = get().currentTest?.id === test.id;
      set({
        currentTest: test,
        testLoading: false,
        offlineState: offlineStateFor(test.id, entry),
        ...(sameTest ? {} : { activeSectionIndex: 0 }),
      });
    } catch (err: unknown) {
      set({
        testLoading: false,
        error: getErrorMessage(err, 'Failed to load test'),
      });
    }
  },

  createTest: async (data, offline) => {
    set({ error: null });
    // The id is minted here, not by the server (owner decision: cold start).
    // Online it changes nothing; with no signal it is what lets the test be
    // scored now and created when the device reconnects, under the same id.
    const payload = { ...data, id: mintTestId() };
    try {
      const test = await skillsTestingService.createTest(payload);
      set({ currentTest: test, offlineState: null });
      cacheIfExamining(test);
      void rememberCandidate({ id: test.candidate_id, name: test.candidate_name });
      return test;
    } catch (err: unknown) {
      if (!isNetworkError(err)) {
        set({ error: getErrorMessage(err, 'Failed to create test') });
        throw err;
      }
    }
    // Cold start: no signal at all.
    try {
      const template = await getCachedSkillTemplate(data.template_id);
      const user = useAuthStore.getState().user;
      if (!template || !user) {
        throw new Error(
          'This skill sheet is not saved on this device. Open Start a Skill Test once with signal to save the published sheets for offline use.'
        );
      }
      const candidateName = offline?.candidateName ?? '';
      const local = buildOfflineSkillTest(template, payload, {
        examinerId: user.id,
        examinerName: displayNameOf(user),
        candidateName,
      });
      await enqueueSkillsCreate({ ...payload, expected_template_version: template.version }, testLabel(local));
      await cacheSkillTest(local);
      set({ currentTest: local, offlineState: offlineStateFor(local.id, await getOwnSkillsPending(local.id)) });
      announceQueued();
      return local;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create test');
      set({ error: msg });
      throw err;
    }
  },

  updateTest: async (id, data) => {
    set({ error: null });
    const current = get().currentTest?.id === id ? get().currentTest : null;
    // Once anything for this test is waiting, every later save joins the
    // queue too: sent directly, it could land before the older queued one and
    // be overwritten by it on reconnect.
    const waiting = await getOwnSkillsPending(id);
    if (!waiting) {
      try {
        const test = await skillsTestingService.updateTest(id, data);
        set({ currentTest: test });
        cacheIfExamining(test);
        return test;
      } catch (err: unknown) {
        if (!isNetworkError(err) || !current) {
          set({ error: getErrorMessage(err, 'Failed to save test progress') });
          throw err;
        }
      }
    }
    try {
      const entry = await enqueueSkillsUpdate(
        { id, label: waiting?.label ?? testLabel(current), version: current?.version },
        data
      );
      const base = current ?? (await getCachedSkillTest(id));
      if (!base) throw new Error('This test is not open on this device');
      const local = applyPending(base, entry);
      set({ currentTest: local, offlineState: offlineStateFor(id, entry) });
      announceQueued();
      return local;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to save test progress');
      set({ error: msg });
      throw err;
    }
  },

  completeTest: async (id) => {
    set({ error: null });
    const current = get().currentTest?.id === id ? get().currentTest : null;
    const waiting = await getOwnSkillsPending(id);
    if (!waiting) {
      try {
        const test = await skillsTestingService.completeTest(id);
        set({ currentTest: test, activeTestRunning: false });
        cacheIfExamining(test);
        return test;
      } catch (err: unknown) {
        if (!isNetworkError(err) || !current) {
          set({ error: getErrorMessage(err, 'Failed to complete test') });
          throw err;
        }
      }
    }
    // Queued behind the test's last save; scoring happens server-side when it
    // lands, never on the device. A completion whose response was lost on the
    // way back is recognised by the drain rather than reported as a failure.
    try {
      await enqueueSkillsComplete({ id, label: waiting?.label ?? testLabel(current) });
      set({
        activeTestRunning: false,
        offlineState: offlineStateFor(id, await getOwnSkillsPending(id)),
      });
      announceQueued();
      const shown = current ?? (await getCachedSkillTest(id));
      if (!shown) throw new Error('This test is not open on this device');
      return shown;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to complete test');
      set({ error: msg });
      throw err;
    }
  },

  deleteTest: async (id: string) => {
    set({ error: null });
    try {
      await skillsTestingService.deleteTest(id);
      set((state: SkillsTestingState) => removeListedTest(state, id));
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to delete test') });
      throw err;
    }
  },

  discardPracticeTest: async (id: string) => {
    set({ error: null });
    try {
      await skillsTestingService.discardPracticeTest(id);
      set((state: SkillsTestingState) => removeListedTest(state, id));
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to discard practice test') });
      throw err;
    }
  },

  emailTestResults: async (id: string) => {
    set({ error: null });
    try {
      const { message } = await skillsTestingService.emailTestResults(id);
      return message;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to email results');
      set({ error: msg });
      throw err;
    }
  },

  voidTest: async (id: string, reason: string) => {
    set({ error: null });
    try {
      const voided = await skillsTestingService.voidTest(id, reason);
      // The row stays in the list — voiding withdraws a result, it does not
      // remove the record — so patch it in place rather than filtering it out.
      set((state: SkillsTestingState) => ({
        tests: state.tests.map((t: SkillTestListItem) =>
          t.id === id ? { ...t, status: voided.status, voided_at: voided.voided_at } : t
        ),
        currentTest: state.currentTest?.id === id ? voided : state.currentTest,
      }));
      return voided;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to void test');
      set({ error: msg });
      throw err;
    }
  },

  returnTest: async (id: string, reason: string) => {
    set({ error: null });
    try {
      const returned = await skillsTestingService.returnTest(id, reason);
      // The row leaves the review queue but stays in the list: it is back with
      // its examiner at in_progress, not withdrawn. Patched in place with the
      // reopened status so a queue filtered to pending drops it on the next
      // render without a refetch.
      set((state: SkillsTestingState) => ({
        tests: state.tests.map((t: SkillTestListItem) =>
          t.id === id
            ? {
                ...t,
                status: returned.status,
                result: returned.result,
                completed_at: returned.completed_at,
                pending_validation: false,
              }
            : t
        ),
        currentTest: state.currentTest?.id === id ? returned : state.currentTest,
      }));
      return returned;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to return test');
      set({ error: msg });
      throw err;
    }
  },

  bulkValidateTests: async (ids: string[]) => {
    set({ error: null });
    try {
      // The caller refetches: partial success means the rows that did validate
      // must leave the queue while the ones that did not stay, and patching
      // that in place would have to reimplement the server's per-id verdict.
      return await skillsTestingService.bulkValidateTests(ids);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to accept results');
      set({ error: msg });
      throw err;
    }
  },

  validateTest: async (id: string) => {
    set({ error: null });
    try {
      const validated = await skillsTestingService.validateTest(id);
      set((state: SkillsTestingState) => ({
        tests: state.tests.map((t: SkillTestListItem) =>
          t.id === id
            ? {
                ...t,
                validated_at: validated.validated_at,
                pending_validation: false,
                // The list row carried a withheld outcome while the test was
                // pending; the validated response is the first time this reader
                // sees the real one.
                result: validated.result,
                overall_score: validated.overall_score,
              }
            : t
        ),
        currentTest: state.currentTest?.id === id ? validated : state.currentTest,
      }));
      return validated;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to validate test');
      set({ error: msg });
      throw err;
    }
  },

  releaseTest: async (id: string) => {
    set({ error: null });
    try {
      const released = await skillsTestingService.releaseTest(id);
      set((state: SkillsTestingState) => ({
        tests: state.tests.map((t: SkillTestListItem) =>
          t.id === id ? { ...t, released_at: released.released_at } : t
        ),
        currentTest: state.currentTest?.id === id ? released : state.currentTest,
      }));
      return released;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to release results');
      set({ error: msg });
      throw err;
    }
  },

  cancelTest: async (id: string, reason?: string) => {
    set({ error: null });
    try {
      const cancelled = await skillsTestingService.cancelTest(id, reason);
      // Like voiding, this closes a test out rather than removing it, so the
      // row is patched in place.
      set((state: SkillsTestingState) => ({
        tests: state.tests.map((t: SkillTestListItem) => (t.id === id ? { ...t, status: cancelled.status } : t)),
        currentTest: state.currentTest?.id === id ? cancelled : state.currentTest,
      }));
      return cancelled;
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to cancel test');
      set({ error: msg });
      throw err;
    }
  },

  // Active test session actions
  setActiveSectionIndex: (index: number) => set({ activeSectionIndex: index }),

  updateCriterionResult: (
    sectionId: string,
    criterionId: string,
    result: Partial<CriterionResult>,
    sectionName?: string,
    criterionLabel?: string
  ) => {
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

  setActiveTestTimer: (seconds: number) => set({ activeTestTimer: seconds }),
  setActiveTestRunning: (running: boolean) => set({ activeTestRunning: running }),

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

  handleSynced: async (testId, test, completed) => {
    const current = get().currentTest;
    if (current?.id !== testId) return;
    const entry = await getOwnSkillsPending(testId);
    if (completed && test) {
      set({ currentTest: test, offlineState: null, activeTestRunning: false });
      return;
    }
    // Still on screen and partly or wholly sent: adopt the server's version so
    // the next save is made against it, keep the local scoring (it is at least
    // as new as what was sent), and re-read what is still waiting.
    set({
      currentTest: test ? applyPending({ ...current, version: test.version }, entry) : current,
      offlineState: offlineStateFor(testId, entry),
    });
  },

  // General
  clearError: () => set({ error: null }),
  clearCurrentTemplate: () => set({ currentTemplate: null }),
  clearCurrentTest: () =>
    set({
      currentTest: null,
      offlineState: null,
      activeTestTimer: 0,
      activeTestRunning: false,
      activeSectionIndex: 0,
    }),
}));
