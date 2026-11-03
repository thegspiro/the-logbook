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
vi.mock('../services/evaluationsApi', () => ({
  evaluationTemplatesService: {
    list: (...a: unknown[]) => listTemplates(...a) as unknown,
    create: (...a: unknown[]) => createTemplate(...a) as unknown,
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
    for (const m of [listTemplates, createTemplate, listPeriods, createPeriod, updatePeriod, removePeriod, navigate]) {
      m.mockReset();
    }
    listTemplates.mockResolvedValue([template()]);
    listPeriods.mockResolvedValue([period()]);
  });

  it('points to where evaluations are drafted and where their emails are worded', async () => {
    renderWithRouter(<EvaluationsPage />);
    expect(await screen.findByText(/Where evaluations happen/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evaluations' })).toHaveAttribute('href', '/reports/evaluations/conduct');
    expect(screen.getByRole('link', { name: 'Email Templates' })).toHaveAttribute(
      'href',
      '/communications/email-templates'
    );
  });

  it('shows each template with who it applies to and its version', async () => {
    renderWithRouter(<EvaluationsPage />);

    await screen.findByRole('heading', { name: 'Operational Annual' });
    const scope = within(screen.getByRole('listitem'));
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
});
