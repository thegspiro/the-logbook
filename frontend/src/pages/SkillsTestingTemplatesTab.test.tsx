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

import SkillsTestingTemplatesTab from './SkillsTestingTemplatesTab';

describe('SkillsTestingTemplatesTab summary', () => {
  beforeEach(() => {
    storeState.summary = null;
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
