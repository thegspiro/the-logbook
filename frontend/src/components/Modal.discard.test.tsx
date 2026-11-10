/**
 * Escape asks first (forms review F-6, owner decision 2026-11-06): a dialog
 * whose fields have changed asks before Escape or its X discards them; a clean
 * one still closes at once.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';
import { DialogPanel } from './ux/DialogPanel';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { useDiscardGuard } from '../hooks/useDiscardGuard';

const DirtyForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Add Item" isDirty={name !== ''}>
      <label htmlFor="item-name">Name</label>
      <input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
    </Modal>
  );
};

const renderDialog = (ui: React.ReactElement) => render(<ConfirmProvider>{ui}</ConfirmProvider>);

describe('Modal with isDirty', () => {
  const onClose = vi.fn();
  beforeEach(() => {
    onClose.mockReset();
  });

  it('closes on Escape at once while nothing has been typed', () => {
    renderDialog(<DirtyForm onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });

  it('asks before Escape discards a typed value, and Keep editing keeps it', async () => {
    const user = userEvent.setup();
    renderDialog(<DirtyForm onClose={onClose} />);
    await user.type(screen.getByLabelText('Name'), 'Helmet');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Helmet');
  });

  it('closes once the member chooses Discard changes', async () => {
    const user = userEvent.setup();
    renderDialog(<DirtyForm onClose={onClose} />);
    await user.type(screen.getByLabelText('Name'), 'Helmet');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks the same question from the header X', async () => {
    const user = userEvent.setup();
    renderDialog(<DirtyForm onClose={onClose} />);
    await user.type(screen.getByLabelText('Name'), 'Helmet');

    await user.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to render a dirty-tracking dialog without a provider to ask through', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Modal isOpen onClose={onClose} title="Add Item" isDirty={false}>
          body
        </Modal>
      )
    ).toThrow(/ConfirmProvider/);
    vi.mocked(console.error).mockRestore();
  });

  it('needs no provider when the dialog does not track changes', () => {
    render(
      <Modal isOpen onClose={onClose} title="Details">
        body
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DialogPanel and a Cancel button through useDiscardGuard', () => {
  const onClose = vi.fn();
  beforeEach(() => {
    onClose.mockReset();
  });

  const HandRolled: React.FC = () => {
    const [notes, setNotes] = useState('');
    const requestClose = useDiscardGuard({ isDirty: notes !== '', onClose });
    return (
      <DialogPanel onClose={requestClose} role="dialog" aria-label="Shift notes">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="button" onClick={requestClose}>
          Cancel
        </button>
      </DialogPanel>
    );
  };

  it('asks from Escape and from Cancel alike', async () => {
    const user = userEvent.setup();
    renderDialog(<HandRolled />);
    await user.type(screen.getByLabelText('Notes'), 'Pump 2 low on foam');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks from Escape when the panel itself is given isDirty', async () => {
    const user = userEvent.setup();
    const Panel: React.FC = () => {
      const [notes, setNotes] = useState('');
      return (
        <DialogPanel onClose={onClose} isDirty={notes !== ''} role="dialog" aria-label="Shift notes">
          <label htmlFor="notes2">Notes</label>
          <textarea id="notes2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </DialogPanel>
      );
    };
    renderDialog(<Panel />);
    await user.type(screen.getByLabelText('Notes'), 'x');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
