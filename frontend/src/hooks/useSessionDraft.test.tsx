import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionDraft } from './useSessionDraft';
import { useAuthStore } from '../stores/authStore';
import { clearAllSessionDrafts, sessionDraftKey } from '../utils/sessionDrafts';
import { DraftRestoredNotice } from '../components/ux/DraftRestoredNotice';

const setUser = (id: string | null) => {
  useAuthStore.setState({ user: id ? ({ id } as never) : null });
};

const Notes: React.FC<{ recordId?: string; ready?: boolean }> = ({ recordId, ready }) => {
  const [notes, setNotes] = useState('');
  const draft = useSessionDraft({
    form: 'notes',
    recordId,
    value: { notes },
    onRestore: (v) => setNotes(v.notes),
    ready,
  });
  return (
    <div>
      {draft.restored && (
        <DraftRestoredNotice
          onDiscard={() => {
            draft.discard();
            setNotes('');
          }}
        />
      )}
      <label htmlFor="n">Notes</label>
      <input id="n" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" onClick={draft.clear}>
        Saved
      </button>
    </div>
  );
};

describe('useSessionDraft', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setUser('u1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing for an untouched form', () => {
    render(<Notes />);
    expect(sessionStorage.length).toBe(0);
  });

  it('restores what was typed when the form is opened again, and says so', async () => {
    const user = userEvent.setup();
    const view = render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Hose testing');
    view.unmount();

    render(<Notes />);
    expect(screen.getByLabelText('Notes')).toHaveValue('Hose testing');
    expect(screen.getByText('Restored your unsaved draft.')).toBeInTheDocument();
  });

  it('keys the draft by user, so another member never sees it', async () => {
    const user = userEvent.setup();
    const view = render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Mine');
    view.unmount();

    act(() => setUser('u2'));
    render(<Notes />);
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(sessionStorage.getItem(sessionDraftKey('u1', 'notes'))).toContain('Mine');
  });

  it('keys an edit form by record', async () => {
    const user = userEvent.setup();
    const view = render(<Notes recordId="r1" />);
    await user.type(screen.getByLabelText('Notes'), 'For r1');
    view.unmount();

    render(<Notes recordId="r2" />);
    expect(screen.getByLabelText('Notes')).toHaveValue('');
  });

  it('Discard removes the draft and the notice', async () => {
    const user = userEvent.setup();
    const view = render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Throw away');
    view.unmount();

    render(<Notes />);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByText('Restored your unsaved draft.')).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
  });

  it('clear after a save leaves nothing behind, even with the values still on screen', async () => {
    const user = userEvent.setup();
    const view = render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Submitted');
    await user.click(screen.getByRole('button', { name: 'Saved' }));
    expect(sessionStorage.length).toBe(0);
    view.unmount();

    render(<Notes />);
    expect(screen.getByLabelText('Notes')).toHaveValue('');
  });

  it('waits for ready before restoring', async () => {
    const user = userEvent.setup();
    const view = render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Later');
    view.unmount();

    const { rerender } = render(<Notes ready={false} />);
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    rerender(<Notes ready />);
    expect(screen.getByLabelText('Notes')).toHaveValue('Later');
  });

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'Still typing');
    expect(screen.getByLabelText('Notes')).toHaveValue('Still typing');
  });

  it('clearAllSessionDrafts removes every form draft and nothing else', async () => {
    const user = userEvent.setup();
    render(<Notes />);
    await user.type(screen.getByLabelText('Notes'), 'x');
    sessionStorage.setItem('unrelated', '1');
    expect(clearAllSessionDrafts()).toBe(1);
    expect(sessionStorage.getItem('unrelated')).toBe('1');
  });
});
