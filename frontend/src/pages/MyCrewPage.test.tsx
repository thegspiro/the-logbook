/**
 * MyCrewPage — the members the signed-in member supervises today, with their
 * training standing and the evaluations written about them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { CrewMember } from '../types/user';

const mocks = vi.hoisted(() => ({
  getMyCrew: vi.fn(),
  getComplianceSummary: vi.fn(),
  crewEvaluations: vi.fn(),
  remember: vi.fn(),
  modulesOn: new Set<string>(['training', 'reports']),
}));

vi.mock('../services/api', () => ({
  memberStatusService: { getMyCrew: (...a: unknown[]) => mocks.getMyCrew(...a) as unknown },
  trainingService: { getComplianceSummary: (...a: unknown[]) => mocks.getComplianceSummary(...a) as unknown },
}));

vi.mock('../modules/reports/services/evaluationsApi', () => ({
  evaluationsService: { crew: (...a: unknown[]) => mocks.crewEvaluations(...a) as unknown },
}));

vi.mock('../hooks/useHasCrew', () => ({
  useCrewStore: (select: (s: { remember: typeof mocks.remember }) => unknown) => select({ remember: mocks.remember }),
}));

vi.mock('../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: (m: string) => mocks.modulesOn.has(m), isLoading: false }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: 'captain-1' } }),
}));

import MyCrewPage from './MyCrewPage';

const member: CrewMember = {
  id: 'ff-1',
  name: 'Riley Bishop',
  rank: 'firefighter',
  station: 'Station 2',
  membership_number: '42',
  supervised_since: '2026-10-01',
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyCrewPage />
    </MemoryRouter>
  );

describe('MyCrewPage', () => {
  beforeEach(() => {
    mocks.getMyCrew.mockReset();
    mocks.getComplianceSummary.mockReset();
    mocks.crewEvaluations.mockReset();
    mocks.remember.mockReset();
    mocks.modulesOn = new Set(['training', 'reports']);
    mocks.getMyCrew.mockResolvedValue([member]);
    mocks.getComplianceSummary.mockResolvedValue({
      user_id: 'ff-1',
      requirements_met: 3,
      requirements_total: 4,
      certs_expiring_soon: 1,
      certs_expired: 0,
      compliance_status: 'yellow',
      compliance_label: 'At Risk',
      hours_this_year: 12,
      active_certifications: 2,
    });
    mocks.crewEvaluations.mockResolvedValue([
      {
        id: 'ev-1',
        member: { id: 'ff-1', name: 'Riley Bishop' },
        evaluator: null,
        period_id: 'p-1',
        period_name: '2026 Annual',
        period_start: '2026-01-01',
        period_end: '2026-12-31',
        template_name: 'Operational Annual',
        kind: 'annual',
        status: 'finalized',
        current_step: null,
        current_step_due: null,
        created_at: null,
      },
    ]);
  });

  it('lists the crew with their training standing and evaluations', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Riley Bishop' })).toHaveAttribute('href', '/members/ff-1');
    expect(await screen.findByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 requirements met')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Training records/ })).toHaveAttribute('href', '/members/ff-1/training');
    expect(await screen.findByText('Riley Bishop — Operational Annual')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/reports/evaluations/ev-1');
    expect(mocks.getComplianceSummary).toHaveBeenCalledWith('ff-1');
    expect(mocks.remember).toHaveBeenCalledWith('captain-1', true);
  });

  it('says so when nobody reports to the member, and asks for nothing else', async () => {
    mocks.getMyCrew.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nobody reports to you')).toBeInTheDocument();
    expect(mocks.getComplianceSummary).not.toHaveBeenCalled();
    expect(mocks.crewEvaluations).not.toHaveBeenCalled();
    expect(mocks.remember).toHaveBeenCalledWith('captain-1', false);
  });

  it('leaves out what a switched-off module would refuse', async () => {
    mocks.modulesOn = new Set();
    renderPage();

    expect(await screen.findByRole('link', { name: 'Riley Bishop' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Training records/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evaluations' })).not.toBeInTheDocument();
    expect(mocks.getComplianceSummary).not.toHaveBeenCalled();
    expect(mocks.crewEvaluations).not.toHaveBeenCalled();
  });

  it('shows a failed standing as unavailable rather than failing the page', async () => {
    mocks.getComplianceSummary.mockRejectedValue(new Error('403'));
    renderPage();

    expect(await screen.findByText('Training standing unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Riley Bishop' })).toBeInTheDocument();
  });
});
