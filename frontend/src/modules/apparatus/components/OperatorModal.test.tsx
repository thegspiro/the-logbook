/**
 * Editing an operator must be able to clear a field.
 *
 * The update endpoint dumps its payload with `exclude_unset`, so an omitted
 * key means "leave this alone". The edit path used to spread blank fields out
 * of the payload (`...(f.x ? { x } : {})`), which turned "I emptied the box"
 * into "keep the old value" behind a success toast (CLAUDE.md pitfall #1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApparatusOperator, OperatorRestriction } from '../types';

const mockGetUsers = vi.fn();
const mockGetLevels = vi.fn();
const mockCreateOperator = vi.fn();
const mockUpdateOperator = vi.fn();

vi.mock('../../../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown },
}));

vi.mock('../services/api', () => ({
  apparatusOperatorService: {
    createOperator: (...args: unknown[]) => mockCreateOperator(...args) as unknown,
    updateOperator: (...args: unknown[]) => mockUpdateOperator(...args) as unknown,
  },
  evocLevelService: { getLevels: (...args: unknown[]) => mockGetLevels(...args) as unknown },
}));

import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { OperatorModal } from './OperatorModal';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

const operator = (overrides: Partial<ApparatusOperator> = {}): ApparatusOperator => ({
  id: 'op-1',
  organizationId: 'org-1',
  apparatusId: 'app-1',
  userId: 'user-1',
  userName: 'Marcus Bell',
  evocLevelId: 'evoc-2',
  isCertified: true,
  certificationDate: '2026-01-15',
  certificationExpiration: '2027-01-15',
  certifiedBy: null,
  licenseTypeRequired: 'CDL Class B',
  licenseVerified: true,
  licenseVerifiedDate: '2026-02-01',
  hasRestrictions: true,
  restrictions: null,
  restrictionNotes: 'Daylight only',
  isActive: true,
  notes: 'Probationary driver',
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  evocLevel: null,
  ...overrides,
});

const renderModal = (editOperator: ApparatusOperator | null = null) =>
  render(<OperatorModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" editOperator={editOperator} />);

describe('OperatorModal payloads', () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue([{ id: 'user-1', first_name: 'Marcus', last_name: 'Bell', username: 'mbell' }]);
    mockGetLevels.mockReset();
    mockGetLevels.mockResolvedValue([{ id: 'evoc-2', levelNumber: 2, name: 'Engine' }]);
    mockCreateOperator.mockReset();
    mockCreateOperator.mockResolvedValue({});
    mockUpdateOperator.mockReset();
    mockUpdateOperator.mockResolvedValue({});
  });

  it('sends an explicit null for every field emptied on edit, and the rest unchanged', async () => {
    const user = userEvent.setup();
    renderModal(operator());

    await user.selectOptions(await screen.findByRole('combobox'), '');
    await user.clear(screen.getByDisplayValue('CDL Class B'));
    await user.clear(screen.getByDisplayValue('2026-01-15'));
    await user.clear(screen.getByDisplayValue('Probationary driver'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockUpdateOperator).toHaveBeenCalledWith('op-1', {
      evocLevelId: null,
      isCertified: true,
      certificationDate: null,
      certificationExpiration: '2027-01-15',
      licenseTypeRequired: null,
      licenseVerified: true,
      licenseVerifiedDate: '2026-02-01',
      hasRestrictions: true,
      restrictionNotes: 'Daylight only',
      isActive: true,
      notes: null,
    });
  });

  it('still omits blank fields on create', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(await screen.findByLabelText('Member *'), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Add Operator' }));

    expect(mockCreateOperator).toHaveBeenCalledWith({
      apparatusId: 'app-1',
      userId: 'user-1',
      evocLevelId: undefined,
      isCertified: false,
      licenseVerified: false,
      hasRestrictions: false,
      isActive: true,
    });
  });
});

describe('OperatorModal errors and discarding', () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue([{ id: 'user-1', first_name: 'Marcus', last_name: 'Bell', username: 'mbell' }]);
    mockGetLevels.mockReset();
    mockGetLevels.mockResolvedValue([]);
    mockCreateOperator.mockReset();
    mockCreateOperator.mockResolvedValue({});
    mockUpdateOperator.mockReset();
    mockUpdateOperator.mockResolvedValue({});
  });

  it('saves the rest of an edit, keeps the stored license type the server refused and flags it', async () => {
    mockUpdateOperator.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'license_type_required', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    renderModal(operator());

    await user.type(screen.getByLabelText('License Type Required'), ' plus tanker');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateOperator).toHaveBeenCalledTimes(2));
    expect(mockUpdateOperator.mock.calls[1]?.[1]).not.toHaveProperty('licenseTypeRequired');
    const field = screen.getByLabelText('License Type Required');
    expect(field).toHaveAccessibleDescription('License type required is too long — keep it to 50 characters.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OperatorModal isOpen onClose={onClose} onSaved={vi.fn()} apparatusId="app-1" />);
    await user.type(screen.getByLabelText('Notes'), 'New driver');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('OperatorRestriction', () => {
  it('matches the snake_case keys the API serializes nested restrictions with', () => {
    // ApparatusOperatorResponse nests the plain OperatorRestriction model,
    // which carries no alias generator, so `is_active` reaches the browser
    // as-is while the operator's own fields are camelCase.
    const fromApi = operator({
      restrictions: [{ type: 'weather', description: 'No icy roads', is_active: false }],
    });
    const restriction: OperatorRestriction | undefined = fromApi.restrictions?.[0];
    expect(restriction?.is_active).toBe(false);
  });
});
