/**
 * Training setup forms, batch 1: the skill template builder follows the
 * owner's form rule (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With
 * an Error"). A new template is not created until every field is fixed; Save
 * on an existing template saves the rest and keeps the refused field flagged;
 * Publish stays refused until every error is fixed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const { mockCreateTemplate, mockUpdateTemplate, mockPublishTemplate, mockToastError, state } = vi.hoisted(() => ({
  mockCreateTemplate: vi.fn(),
  mockUpdateTemplate: vi.fn(),
  mockPublishTemplate: vi.fn(),
  mockToastError: vi.fn(),
  state: { routeId: undefined as string | undefined, template: null as Record<string, unknown> | null },
}));

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: () => ({
    currentTemplate: state.template,
    templateLoading: false,
    loadTemplate: vi.fn(),
    createTemplate: mockCreateTemplate,
    updateTemplate: mockUpdateTemplate,
    publishTemplate: mockPublishTemplate,
    clearCurrentTemplate: vi.fn(),
    clearError: vi.fn(),
    error: null,
  }),
}));

vi.mock('../services/api', () => ({
  trainingProgramService: { getRequirementsEnhanced: () => Promise.resolve([]) },
  roleService: { getRoles: () => Promise.resolve([]) },
  trainingModuleConfigService: { getConfig: () => Promise.resolve({}) },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: state.routeId }) };
});

import SkillTemplateBuilderPage from './SkillTemplateBuilderPage';

const stored = {
  id: 'tpl-1',
  name: 'SCBA Donning',
  description: 'Old description',
  category: 'SCBA',
  visibility: 'all_members',
  passing_percentage: 80,
  require_all_critical: true,
  status: 'draft',
  tags: [],
  sections: [{ name: 'Donning', sort_order: 0, criteria: [{ label: 'Mask seal', type: 'pass_fail', required: true }] }],
};

const unprocessable = (loc: (string | number)[], msg: string) =>
  Object.assign(new Error('Request failed with status code 422'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', ...loc], msg, type: 'value_error' }] } },
  });

describe('SkillTemplateBuilderPage save (training forms batch 1)', () => {
  beforeEach(() => {
    mockCreateTemplate.mockReset();
    mockUpdateTemplate.mockReset();
    mockUpdateTemplate.mockResolvedValue(stored);
    mockPublishTemplate.mockReset();
    mockToastError.mockReset();
    state.routeId = undefined;
    state.template = null;
  });

  it('marks a blank template name on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SkillTemplateBuilderPage />);

    await user.type(screen.getByRole('textbox', { name: 'Section name' }), 'Donning');
    await user.type(screen.getByLabelText(/^Criterion Label/), 'Mask seal');
    await user.click(screen.getByRole('button', { name: /Save Draft/ }));

    const name = screen.getByLabelText(/^Template Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Give the template a name/);
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  it('marks a blank criterion label on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SkillTemplateBuilderPage />);

    await user.type(screen.getByLabelText(/^Template Name/), 'Pump Ops');
    await user.type(screen.getByRole('textbox', { name: 'Section name' }), 'Priming');
    await user.click(screen.getByRole('button', { name: /Save Draft/ }));

    const label = screen.getByLabelText(/^Criterion Label/);
    expect(label).toHaveAttribute('aria-invalid', 'true');
    expect(label).toHaveAccessibleDescription(/Give the criterion a label/);
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  describe('on an existing template', () => {
    beforeEach(() => {
      state.routeId = 'tpl-1';
      state.template = stored;
    });

    it('saves the rest without a blank name, keeps what was typed, and flags it', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      const name = await screen.findByDisplayValue('SCBA Donning');
      await user.clear(name);
      const description = screen.getByPlaceholderText(/Brief description of the evaluation/);
      await user.clear(description);
      await user.type(description, 'New description');
      await user.click(screen.getByRole('button', { name: /Save Changes/ }));

      await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(1));
      const [id, body] = mockUpdateTemplate.mock.calls[0] as [string, Record<string, unknown>];
      expect(id).toBe('tpl-1');
      expect(body).not.toHaveProperty('name');
      expect(body.description).toBe('New description');
      expect(body).toHaveProperty('sections');

      expect(screen.getByLabelText(/^Template Name/)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText(/^Template Name/)).toHaveValue('');
      expect(screen.getByText(/Template saved, except template name/)).toBeInTheDocument();
    });

    it('saves the settings without a sheet that has a blank criterion label, and flags the label', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.clear(await screen.findByDisplayValue('Mask seal'));
      const category = screen.getByLabelText('Category');
      await user.clear(category);
      await user.type(category, 'PPE');
      await user.click(screen.getByRole('button', { name: /Save Changes/ }));

      await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(1));
      const [, body] = mockUpdateTemplate.mock.calls[0] as [string, Record<string, unknown>];
      // The sheet is replaced whole on every save, so a refused criterion
      // keeps the stored sheet rather than saving part of it.
      expect(body).not.toHaveProperty('sections');
      expect(body.category).toBe('PPE');
      expect(screen.getByLabelText(/^Criterion Label/)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText(/Template saved, except evaluation sections/)).toBeInTheDocument();
    });

    it('resends without a setting the server refuses, and flags it', async () => {
      mockUpdateTemplate.mockRejectedValueOnce(
        unprocessable(['passing_percentage'], 'Input should be less than or equal to 100')
      );
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await screen.findByDisplayValue('SCBA Donning');
      await user.click(screen.getByRole('button', { name: /Save Changes/ }));

      await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(2));
      const [, resent] = mockUpdateTemplate.mock.calls[1] as [string, Record<string, unknown>];
      expect(resent).not.toHaveProperty('passing_percentage');
      expect(resent.name).toBe('SCBA Donning');
      expect(screen.getByLabelText('Passing Percentage (%)')).toHaveAttribute('aria-invalid', 'true');
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it('still refuses to publish while a field is flagged', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillTemplateBuilderPage />);

      await user.clear(await screen.findByDisplayValue('SCBA Donning'));
      await user.click(screen.getByRole('button', { name: /^Publish$/ }));

      expect(screen.getByLabelText(/^Template Name/)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mockUpdateTemplate).not.toHaveBeenCalled();
      expect(mockPublishTemplate).not.toHaveBeenCalled();
    });
  });
});
