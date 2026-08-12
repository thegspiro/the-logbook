/**
 * Tests for the apparatus Operators tab and its modal.
 *
 * Two things the screenshot pass caught:
 *
 *  - the roster labelled every row "Operator ID: a8c2c854-7bb9-…". The backend
 *    eager-loads the operator's user but never projected a name, so the only
 *    identifier the tab had was the raw uuid — a roster that names nobody.
 *  - the add form asked for that uuid by hand, in a free-text box placeheld
 *    "Enter user ID". Nothing in the UI shows a member's id, so the control
 *    was unusable without going to the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApparatusOperator } from '../types';

const mockGetUsers = vi.fn();
vi.mock('../../../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown },
}));

vi.mock('../services/api', () => ({
  apparatusOperatorService: {
    deleteOperator: vi.fn(),
    createOperator: vi.fn(),
    updateOperator: vi.fn(),
  },
  evocLevelService: { getLevels: vi.fn(() => Promise.resolve([])) },
}));

import { OperatorsTab } from './OperatorsTab';

const operator = (overrides: Partial<ApparatusOperator> = {}): ApparatusOperator => ({
  id: 'op-1',
  organizationId: 'org-1',
  apparatusId: 'app-1',
  userId: 'a8c2c854-7bb9-458c-bba4-dd99d88e5167',
  userName: 'Marcus Bell',
  evocLevelId: null,
  isCertified: true,
  certificationDate: null,
  certificationExpiration: null,
  certifiedBy: null,
  licenseTypeRequired: null,
  licenseVerified: false,
  licenseVerifiedDate: null,
  hasRestrictions: false,
  restrictions: null,
  restrictionNotes: null,
  isActive: true,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  evocLevel: null,
  ...overrides,
});

const renderTab = (operators: ApparatusOperator[]) =>
  render(
    <OperatorsTab
      operators={operators}
      loadingTab={false}
      timezone="America/New_York"
      apparatusId="app-1"
      onRefresh={vi.fn()}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUsers.mockResolvedValue([
    { id: 'u-1', first_name: 'Marcus', last_name: 'Bell' },
    { id: 'u-2', first_name: 'Nadia', last_name: 'Belhaj' },
  ]);
});

describe('OperatorsTab', () => {
  it('labels a row with the operator name', () => {
    renderTab([operator()]);
    expect(screen.getByText('Marcus Bell')).toBeInTheDocument();
  });

  it('never renders the "Operator ID:" prefix the uuid label used', () => {
    renderTab([operator()]);
    expect(screen.queryByText(/Operator ID:/)).not.toBeInTheDocument();
  });

  it('falls back to the id when the backend sent no name', () => {
    // Better a uuid than an empty row — but only as a fallback.
    renderTab([operator({ userName: null })]);
    expect(screen.getByText('a8c2c854-7bb9-458c-bba4-dd99d88e5167')).toBeInTheDocument();
  });
});

describe('OperatorModal member picker', () => {
  it('offers members to choose from rather than a free-text id box', async () => {
    const user = userEvent.setup();
    renderTab([]);
    await user.click(screen.getByRole('button', { name: 'Add Operator' }));

    const picker = await screen.findByLabelText(/Member \*/);
    expect(picker.tagName).toBe('SELECT');
    expect(await screen.findByRole('option', { name: 'Marcus Bell' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Nadia Belhaj' })).toBeInTheDocument();
  });

  it('does not ask the user to type a user id', async () => {
    const user = userEvent.setup();
    renderTab([]);
    await user.click(screen.getByRole('button', { name: 'Add Operator' }));

    await screen.findByLabelText(/Member \*/);
    expect(screen.queryByPlaceholderText('Enter user ID')).not.toBeInTheDocument();
  });
});
