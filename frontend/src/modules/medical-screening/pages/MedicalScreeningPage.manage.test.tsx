/**
 * MS2-11: the write controls are offered only to someone who may write.
 *
 * The route opens on `medical_screening.view`, and every create, edit and
 * delete route requires `medical_screening.manage`. A view-only reader was
 * shown Add, Edit and Delete anyway, filled in a form and was refused by the
 * server at the end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ScreeningRecord, ScreeningRequirement } from '../types';
import { useAuthStore } from '../../../stores/authStore';

const listRequirements = vi.fn();
const listRecords = vi.fn();
const getExpiringScreenings = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listRequirements: (...a: unknown[]) => listRequirements(...a) as unknown,
    listRecords: (...a: unknown[]) => listRecords(...a) as unknown,
    getExpiringScreenings: (...a: unknown[]) => getExpiringScreenings(...a) as unknown,
  },
}));

import { MedicalScreeningPage } from './MedicalScreeningPage';

const requirement: ScreeningRequirement = {
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Annual physical',
  screening_type: 'physical_exam',
  frequency_months: 12,
  is_active: true,
  grace_period_days: 30,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const record: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  user_name: 'Devon Ellis',
  requirement_id: 'req-1',
  requirement_name: 'Annual physical',
  screening_type: 'physical_exam',
  status: 'passed',
  completed_date: '2026-10-01',
  self_recorded: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const signInWith = (permissions: string[]): void =>
  useAuthStore.setState({
    user: {
      id: 'me',
      username: 'officer',
      email: 'officer@example.com',
      organization_id: 'org-1',
      timezone: 'America/New_York',
      roles: [],
      positions: [],
      rank: null,
      membership_type: 'active',
      permissions,
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_expired: false,
      must_change_password: false,
      bottom_nav_slots: null,
    },
  });

const renderTab = (tab: 'requirements' | 'records') =>
  render(
    <MemoryRouter initialEntries={[`/medical-screening?tab=${tab}`]}>
      <MedicalScreeningPage />
    </MemoryRouter>
  );

describe('MedicalScreeningPage — write controls', () => {
  beforeEach(() => {
    listRequirements.mockReset();
    listRecords.mockReset();
    getExpiringScreenings.mockReset();
    listRequirements.mockResolvedValue([requirement]);
    listRecords.mockResolvedValue([record]);
    getExpiringScreenings.mockResolvedValue([]);
  });

  it('offers a view-only reader no add, edit or delete on requirements', async () => {
    signInWith(['medical_screening.view']);
    renderTab('requirements');

    expect(await screen.findByText('Annual physical')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Requirement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Annual physical' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Annual physical' })).not.toBeInTheDocument();
  });

  it('offers a view-only reader no add, edit or delete on records', async () => {
    signInWith(['medical_screening.view']);
    renderTab('records');

    expect(await screen.findByText(/Devon Ellis/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit Devon Ellis/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete Devon Ellis/ })).not.toBeInTheDocument();
  });

  it('offers a manager every write control on both tabs', async () => {
    signInWith(['medical_screening.view', 'medical_screening.manage']);
    const { unmount } = renderTab('requirements');

    expect(await screen.findByRole('button', { name: 'Add Requirement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Annual physical' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Annual physical' })).toBeInTheDocument();
    unmount();

    renderTab('records');
    expect(await screen.findByRole('button', { name: 'Add Record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit Devon Ellis/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Delete Devon Ellis/ })).toBeInTheDocument();
  });
});
