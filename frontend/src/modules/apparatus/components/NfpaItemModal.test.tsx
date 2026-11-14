import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { ApparatusNfpaCompliance } from '../types';

const mockCreateItem = vi.fn();
const mockUpdateItem = vi.fn();

vi.mock('../services/api', () => ({
  apparatusNfpaService: {
    createItem: (...args: unknown[]) => mockCreateItem(...args) as unknown,
    updateItem: (...args: unknown[]) => mockUpdateItem(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { NfpaItemModal } from './NfpaItemModal';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

const existing = {
  id: 'n-1',
  apparatusId: 'app-1',
  standardCode: 'NFPA 1911',
  sectionReference: 'Chapter 6',
  requirementDescription: 'Annual chassis inspection',
  complianceStatus: 'pending',
  lastCheckedDate: null,
  nextDueDate: null,
  notes: null,
  exemptionReason: null,
} as unknown as ApparatusNfpaCompliance;

describe('NfpaItemModal', () => {
  beforeEach(() => {
    mockCreateItem.mockReset();
    mockCreateItem.mockResolvedValue({});
    mockUpdateItem.mockReset();
    mockUpdateItem.mockResolvedValue({});
  });

  it('flags the required fields of a new item and adds nothing', async () => {
    const user = userEvent.setup();
    render(<NfpaItemModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" />);
    await user.click(screen.getByRole('button', { name: 'Add Item' }));

    expect(screen.getByLabelText('Section *')).toHaveAccessibleDescription('Enter the section it answers to.');
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('puts a server refusal on its field, announced', async () => {
    mockCreateItem.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'section_reference', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    render(<NfpaItemModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" />);
    await user.type(screen.getByLabelText('Section *'), 'Chapter 6');
    await user.type(screen.getByLabelText('Requirement *'), 'Annual inspection');
    await user.click(screen.getByRole('button', { name: 'Add Item' }));

    const section = screen.getByLabelText('Section *');
    await waitFor(() =>
      expect(section).toHaveAccessibleDescription('Section is too long — keep it to 100 characters.')
    );
    expect(section).toHaveAttribute('maxLength', '100');
  });

  it('saves the rest of an edit and keeps a refused field flagged, open', async () => {
    mockUpdateItem.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'next_due_date', message: 'Invalid date format' }] } },
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NfpaItemModal isOpen onClose={onClose} onSaved={onSaved} apparatusId="app-1" editItem={existing} />);
    await user.type(screen.getByLabelText('Notes'), 'Checked');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(2));
    expect(mockUpdateItem.mock.calls[1]?.[1]).not.toHaveProperty('nextDueDate');
    expect(mockUpdateItem.mock.calls[1]?.[1]).toMatchObject({ notes: 'Checked' });
    expect(screen.getByLabelText('Next due')).toHaveAccessibleDescription('Next due needs a valid date.');
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NfpaItemModal isOpen onClose={onClose} onSaved={vi.fn()} apparatusId="app-1" />);
    await user.type(screen.getByLabelText('Section *'), 'Chapter 6');
    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
