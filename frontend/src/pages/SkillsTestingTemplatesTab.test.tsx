import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const storeState = {
  templates: [],
  templatesLoading: false,
  loadTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
  publishTemplate: vi.fn(),
  duplicateTemplate: vi.fn(),
  summary: null as null | Record<string, number | null>,
  summaryLoading: false,
  loadSummary: vi.fn(),
};

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: () => storeState,
}));

let canManage = false;
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => canManage && p === 'training.manage' }),
}));

import SkillsTestingTemplatesTab from './SkillsTestingTemplatesTab';

describe('SkillsTestingTemplatesTab summary', () => {
  beforeEach(() => {
    storeState.summary = null;
    canManage = false;
  });

  it('shows a dash, not 0%, for a figure the API could not compute', () => {
    storeState.summary = {
      total_templates: 1,
      published_templates: 1,
      total_tests: 1,
      tests_this_month: 1,
      pass_rate: 100,
      average_score: null,
      pending_validation: 0,
    };
    renderWithRouter(<SkillsTestingTemplatesTab />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('SkillsTestingTemplatesTab pending validation', () => {
  const summary = (pending: number) => ({
    total_templates: 4,
    published_templates: 3,
    total_tests: 20,
    tests_this_month: 5,
    pass_rate: 80,
    average_score: 72,
    pending_validation: pending,
  });

  beforeEach(() => {
    storeState.summary = null;
    canManage = false;
  });

  it('shows an officer the queue even when it is empty', () => {
    canManage = true;
    storeState.summary = summary(0);
    renderWithRouter(<SkillsTestingTemplatesTab />);

    expect(screen.getByText('Needs Validation')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('keeps the pass rate beside a non-empty queue', () => {
    canManage = true;
    storeState.summary = summary(3);
    renderWithRouter(<SkillsTestingTemplatesTab />);

    expect(screen.getByText('Needs Validation')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('does not show the card to a member who cannot validate', () => {
    storeState.summary = summary(0);
    renderWithRouter(<SkillsTestingTemplatesTab />);

    expect(screen.queryByText('Needs Validation')).not.toBeInTheDocument();
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
  });
});
