/**
 * Member evaluation setup: templates for `evaluations.configure`, review
 * periods for `evaluations.manage`, each able to read the other's list, and a
 * page that says plainly that email notices have not arrived yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { EvaluationPeriod, EvaluationTemplateSummary } from '../types/evaluations';

let granted = new Set<string>(['evaluations.configure', 'evaluations.manage']);
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => granted.has(p) }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const listTemplates = vi.fn();
const createTemplate = vi.fn();
const listPeriods = vi.fn();
const createPeriod = vi.fn();
const updatePeriod = vi.fn();
const removePeriod = vi.fn();
const listStarters = vi.fn();
const draftOptions = vi.fn();
const bulkPreview = vi.fn();
const attention = vi.fn();
vi.mock('../services/evaluationsApi', () => ({
  evaluationTemplatesService: {
    list: (...a: unknown[]) => listTemplates(...a) as unknown,
    create: (...a: unknown[]) => createTemplate(...a) as unknown,
    starters: (...a: unknown[]) => listStarters(...a) as unknown,
  },
  evaluationsService: {
    draftOptions: (...a: unknown[]) => draftOptions(...a) as unknown,
    attention: (...a: unknown[]) => attention(...a) as unknown,
    bulkPreview: (...a: unknown[]) => bulkPreview(...a) as unknown,
  },
  evaluationPeriodsService: {
    list: (...a: unknown[]) => listPeriods(...a) as unknown,
    create: (...a: unknown[]) => createPeriod(...a) as unknown,
    update: (...a: unknown[]) => updatePeriod(...a) as unknown,
    remove: (...a: unknown[]) => removePeriod(...a) as unknown,
  },
}));

import EvaluationsPage from './EvaluationsPage';

function template(overrides: Partial<EvaluationTemplateSummary> = {}): EvaluationTemplateSummary {
  return {
    id: 't1',
    name: 'Operational Annual',
    description: null,
    kind: 'annual',
    member_class: 'operational',
    member_status: null,
    is_active: true,
    published_version: 3,
    has_draft: true,
    evaluations_count: 31,
    updated_at: null,
    ...overrides,
  };
}

function period(overrides: Partial<EvaluationPeriod> = {}): EvaluationPeriod {
  return {
    id: 'p1',
    name: '2026 Annual Review',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    is_closed: false,
    evaluations_count: 0,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('EvaluationsPage', () => {
  beforeEach(() => {
    granted = new Set(['evaluations.configure', 'evaluations.manage']);
    for (const m of [
      listTemplates,
      createTemplate,
      listPeriods,
      createPeriod,
      updatePeriod,
      removePeriod,
      navigate,
      listStarters,
      draftOptions,
      bulkPreview,
      attention,
    ]) {
      m.mockReset();
    }
    listTemplates.mockResolvedValue([template()]);
    listPeriods.mockResolvedValue([period()]);
    listStarters.mockResolvedValue([]);
    draftOptions.mockResolvedValue({ members: [], evaluators: [], periods: [] });
    bulkPreview.mockResolvedValue({ period: period(), kind: 'annual', rows: [], evaluators: [] });
    attention.mockResolvedValue({ mine: 0, overdue: 0 });
  });

  it('names the page in the strip, with the email wording one link away and the actions in the header', async () => {
    window.history.pushState({}, '', '/reports/evaluations');
    renderWithRouter(<EvaluationsPage />);

    const strip = await screen.findByRole('navigation', { name: 'Evaluations sections' });
    expect(within(strip).getByRole('link', { name: 'Templates & periods' })).toHaveAttribute('aria-current', 'page');
    // The strip already names the page, so from sm up the heading is for
    // screen readers only; on a phone the strip scrolls, so it stays visible.
    expect(screen.getByRole('heading', { level: 1, name: 'Templates & periods' })).toHaveClass('sm:sr-only');
    expect(screen.queryByText(/Where evaluations happen/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email Templates' })).toHaveAttribute(
      'href',
      '/communications/email-templates'
    );
    expect(screen.getByRole('button', { name: 'New review period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New template' })).toBeInTheDocument();
  });

  it('badges the strip with what waits in each section, as the server counts it', async () => {
    attention.mockResolvedValue({ mine: 2, overdue: 5 });
    window.history.pushState({}, '', '/reports/evaluations');
    renderWithRouter(<EvaluationsPage />);

    const strip = await screen.findByRole('navigation', { name: 'Evaluations sections' });
    expect(await within(strip).findByRole('link', { name: 'My evaluations, 2 waiting on you' })).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: 'All evaluations, 5 overdue' })).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: 'Templates & periods' })).toBeInTheDocument();
  });

  it('shows each template with who it applies to and its version', async () => {
    renderWithRouter(<EvaluationsPage />);

    await screen.findByRole('heading', { name: 'Operational Annual' });
    const templatesSection = screen.getByRole('region', { name: 'Templates' });
    const scope = within(within(templatesSection).getByRole('listitem'));
    expect(scope.getByText('Published v3')).toBeInTheDocument();
    expect(scope.getByText(/Operational members/)).toBeInTheDocument();
    expect(scope.getByText(/Unpublished changes · 31 evaluations/)).toBeInTheDocument();
    expect(scope.getByRole('link', { name: /open builder/i })).toHaveAttribute(
      'href',
      '/reports/evaluations/templates/t1'
    );
  });

  it('creates a template, omitting blank choices, and opens the builder', async () => {
    createTemplate.mockResolvedValue({ ...template(), id: 'new-1' });
    const user = userEvent.setup();
    renderWithRouter(<EvaluationsPage />);

    await user.click(await screen.findByRole('button', { name: /new template/i }));
    await user.type(screen.getByLabelText('Name'), 'Probationary');
    await user.selectOptions(screen.getByLabelText('Member status'), 'probationary');
    await user.click(screen.getByRole('button', { name: /create and open builder/i }));

    await waitFor(() =>
      expect(createTemplate).toHaveBeenCalledWith({
        name: 'Probationary',
        description: undefined,
        kind: 'annual',
        member_class: undefined,
        member_status: 'probationary',
      })
    );
    expect(navigate).toHaveBeenCalledWith('/reports/evaluations/templates/new-1');
  });

  it('opens a review period', async () => {
    createPeriod.mockResolvedValue(period({ id: 'p2' }));
    const user = userEvent.setup();
    renderWithRouter(<EvaluationsPage />);

    await user.click(await screen.findByRole('button', { name: /new review period/i }));
    await user.type(screen.getByLabelText('Name'), '2027 Annual Review');
    await user.type(screen.getByLabelText('Starts'), '2027-01-01');
    await user.type(screen.getByLabelText('Ends'), '2027-12-31');
    await user.click(screen.getByRole('button', { name: /open period/i }));

    await waitFor(() =>
      expect(createPeriod).toHaveBeenCalledWith({
        name: '2027 Annual Review',
        start_date: '2027-01-01',
        end_date: '2027-12-31',
      })
    );
  });

  it('locks the dates of a period that has evaluations, and offers no delete', async () => {
    listPeriods.mockResolvedValue([period({ evaluations_count: 4 })]);
    updatePeriod.mockResolvedValue(period({ evaluations_count: 4, name: 'Renamed' }));
    const user = userEvent.setup();
    renderWithRouter(<EvaluationsPage />);

    await screen.findByText('2026 Annual Review');
    expect(screen.queryByRole('button', { name: /delete 2026 annual review/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Starts')).toBeDisabled();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: /save period/i }));

    await waitFor(() => expect(updatePeriod).toHaveBeenCalledWith('p1', { name: 'Renamed' }));
  });

  it('asks before deleting an unused period', async () => {
    removePeriod.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithRouter(<EvaluationsPage />);

    await user.click(await screen.findByRole('button', { name: /delete 2026 annual review/i }));
    await user.click(await screen.findByRole('button', { name: /delete period/i }));

    await waitFor(() => expect(removePeriod).toHaveBeenCalledWith('p1'));
  });

  it('gives a period manager the periods but not the template controls', async () => {
    granted = new Set(['evaluations.manage']);
    renderWithRouter(<EvaluationsPage />);

    await screen.findByRole('heading', { name: 'Operational Annual' });
    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open builder/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new review period/i })).toBeInTheDocument();
  });

  it('draws the Evaluations sections the viewer may open, with setup marked current', async () => {
    window.history.pushState({}, '', '/reports/evaluations');
    renderWithRouter(<EvaluationsPage />);
    const strip = await screen.findByRole('navigation', { name: 'Evaluations sections' });
    expect(within(strip).getByRole('link', { name: 'My evaluations' })).toHaveAttribute(
      'href',
      '/reports/evaluations/mine'
    );
    expect(within(strip).getByRole('link', { name: 'All evaluations' })).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: 'Templates & periods' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers a builder only the sections their grants open', async () => {
    granted = new Set(['evaluations.configure']);
    window.history.pushState({}, '', '/reports/evaluations');
    renderWithRouter(<EvaluationsPage />);

    const strip = await screen.findByRole('navigation', { name: 'Evaluations sections' });
    expect(
      within(strip)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['My evaluations', 'Templates & periods']);
    expect(screen.queryByRole('button', { name: 'New review period' })).not.toBeInTheDocument();
  });

  it('gives a template builder read-only periods', async () => {
    granted = new Set(['evaluations.configure']);
    renderWithRouter(<EvaluationsPage />);

    await screen.findByText('2026 Annual Review');
    expect(screen.queryByRole('button', { name: /new review period/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('reports a failed load with a retry', async () => {
    listTemplates.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    renderWithRouter(<EvaluationsPage />);

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Operational Annual' })).toBeInTheDocument();
  });

  describe('starting from a ready-made form', () => {
    const annualStarter = {
      key: 'annual_member',
      name: 'Annual Member Evaluation',
      description: 'A yearly evaluation.',
      kind: 'annual',
      member_class: null,
      member_status: null,
      section_titles: ['Training and readiness', 'Development'],
    };
    const checkInStarter = {
      key: 'probationary_check_in',
      name: 'Probationary Check-in',
      description: 'A short check-in.',
      kind: 'interim',
      member_class: null,
      member_status: 'probationary',
      section_titles: ['Progress'],
    };

    beforeEach(() => {
      listTemplates.mockResolvedValue([]);
      listStarters.mockResolvedValue([annualStarter, checkInStarter]);
      createTemplate.mockResolvedValue({ id: 'new-1' });
    });

    it('offers each starter when there are no templates, and creates from the one chosen', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EvaluationsPage />);

      await user.click(await screen.findByRole('button', { name: 'Start from Probationary Check-in' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByLabelText('Start from')).toHaveValue('probationary_check_in');
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Probationary Check-in');
      await user.click(within(dialog).getByRole('button', { name: /create and open builder/i }));

      await waitFor(() =>
        expect(createTemplate).toHaveBeenCalledWith({
          name: 'Probationary Check-in',
          description: 'A short check-in.',
          kind: 'interim',
          member_class: undefined,
          member_status: 'probationary',
          starter: 'probationary_check_in',
        })
      );
      expect(navigate).toHaveBeenCalledWith('/reports/evaluations/templates/new-1');
    });

    it('drops a starter written for another kind when the kind changes', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EvaluationsPage />);

      await user.click(await screen.findByRole('button', { name: 'Start from Annual Member Evaluation' }));
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('Kind'), 'interim');
      expect(within(dialog).getByLabelText('Start from')).toHaveValue('');
      await user.click(within(dialog).getByRole('button', { name: /create and open builder/i }));

      await waitFor(() => expect(createTemplate).toHaveBeenCalled());
      expect(createTemplate.mock.calls[0]?.[0]).toMatchObject({ kind: 'interim', starter: undefined });
    });

    it('still offers a blank form when the starters cannot be loaded', async () => {
      listStarters.mockRejectedValue(new Error('offline'));
      renderWithRouter(<EvaluationsPage />);

      const templatesSection = await screen.findByRole('region', { name: 'Templates' });
      expect(await within(templatesSection).findByText('No templates yet')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(0);
    });
  });

  describe('the getting-started checklist', () => {
    const checklist = () => screen.findByRole('region', { name: 'Getting started' });

    it('starts at none done, pointing at the header buttons rather than repeating them', async () => {
      listTemplates.mockResolvedValue([]);
      listPeriods.mockResolvedValue([]);
      renderWithRouter(<EvaluationsPage />);

      const section = await checklist();
      expect(
        within(section).getByText('0 of 4 done. This goes away once evaluations are under way.')
      ).toBeInTheDocument();
      expect(within(section).queryByRole('button', { name: 'New template' })).not.toBeInTheDocument();
      expect(within(section).queryByRole('button', { name: 'New review period' })).not.toBeInTheDocument();
      expect(
        within(section).getByText(/build your own with New template at the top of this page\./)
      ).toBeInTheDocument();
      expect(
        within(section).getByText(/Open one with New review period at the top of this page\./)
      ).toBeInTheDocument();
      // The header still carries both.
      expect(screen.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'New review period' })).toBeInTheDocument();
      // Nothing to check against yet, so no draft preview is asked for.
      expect(bulkPreview).not.toHaveBeenCalled();
    });

    it('names only the header buttons this viewer is shown', async () => {
      granted = new Set(['evaluations.configure']);
      listTemplates.mockResolvedValue([]);
      listPeriods.mockResolvedValue([]);
      renderWithRouter(<EvaluationsPage />);

      const section = await checklist();
      expect(within(section).getByText(/with New template at the top of this page/)).toBeInTheDocument();
      expect(within(section).queryByText(/New review period at the top/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New review period' })).not.toBeInTheDocument();
    });

    it('marks the published form and the open period done, and lists who drafting would leave out', async () => {
      bulkPreview.mockResolvedValue({
        period: period(),
        kind: 'annual',
        evaluators: [],
        rows: [
          { member: { id: 'm1', name: 'Ann Able' }, skip_reason: 'No active, published template fits this member.' },
          { member: { id: 'm2', name: 'Bo Baker' }, skip_reason: 'No active, published template fits this member.' },
          { member: { id: 'm3', name: 'Cy Cole' }, skip_reason: 'Already has an evaluation for this period.' },
          {
            member: { id: 'm4', name: 'Di Dunn' },
            template: { id: 't1', name: 'Operational Annual' },
            evaluator: null,
          },
        ],
      });
      renderWithRouter(<EvaluationsPage />);

      const section = await checklist();
      const stepTitle = (text: string) =>
        within(section).getByText((_, element) => element?.tagName === 'P' && element.textContent === text);
      expect(stepTitle('Publish an evaluation form (done)')).toBeInTheDocument();
      expect(stepTitle('Open a review period (done)')).toBeInTheDocument();
      expect(stepTitle('Draft the evaluations (to do)')).toBeInTheDocument();
      expect(
        within(section).getByText('2 of 4 done. This goes away once evaluations are under way.')
      ).toBeInTheDocument();
      expect(
        await within(section).findByText('2 members would be left out: No active, published template fits this member.')
      ).toBeInTheDocument();
      expect(within(section).queryByText(/Already has an evaluation/)).not.toBeInTheDocument();
      expect(within(section).getByText(/1 member has no supervisor who can conduct evaluations/)).toBeInTheDocument();
      expect(bulkPreview).toHaveBeenCalledWith('p1', 'annual');
    });

    it('goes away once evaluations are under way', async () => {
      listPeriods.mockResolvedValue([period({ evaluations_count: 4 })]);
      draftOptions.mockResolvedValue({ members: [], evaluators: [{ id: 'capt-1', name: 'Captain' }], periods: [] });
      renderWithRouter(<EvaluationsPage />);

      await screen.findByRole('heading', { name: 'Operational Annual' });
      await waitFor(() => expect(draftOptions).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument());
    });
  });
});
