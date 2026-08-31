/**
 * The one piece of the answering surface that is shared.
 *
 * This file used to test the four controls. They were deleted with `CheckLap`,
 * the only screen that rendered them, and the rules they enforced moved to
 * `checkAnswers.test.ts` — which asserts them against the module that owns
 * them rather than through whichever layout happened to be around.
 *
 * `FaultDetail` stayed, because both the sweep's function row and any future
 * surface record a fault the same way: a note and a photo, neither of them
 * blocking. It had no tests of its own while it lived inside FunctionControl.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FaultDetail, type CheckItemSpec } from './CheckItemControls';

const item: CheckItemSpec = { id: 'i1', name: 'Suction unit', checkType: 'function' };

describe('FaultDetail', () => {
  it('asks what happened, and records it against the item', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FaultDetail item={item} answer={undefined} onChange={onChange} />);

    await user.type(screen.getByTestId('function-note-i1'), 'x');
    expect(onChange).toHaveBeenLastCalledWith({ notes: 'x' });
  });

  it('holds nobody at a textarea', () => {
    // A crew mid-walk at 07:00 should not be stopped by a required field; the
    // finished check flags the gap instead. A check that blocks is a check
    // that gets abandoned.
    render(<FaultDetail item={item} answer={{ status: 'fail' }} onChange={vi.fn()} />);
    expect(screen.getByTestId('function-note-i1')).not.toBeRequired();
    expect(screen.getByText(/required to move on/i)).toBeInTheDocument();
  });

  it('takes photos, and adds rather than replaces', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const existing = new File(['a'], 'first.jpg', { type: 'image/jpeg' });
    render(<FaultDetail item={item} answer={{ photoFiles: [existing] }} onChange={onChange} />);

    await user.upload(screen.getByTestId('function-photo-i1'), new File(['b'], 'second.jpg', { type: 'image/jpeg' }));

    const patch = onChange.mock.calls[0]?.[0] as { photoFiles: File[] };
    expect(patch.photoFiles.map((f) => f.name)).toEqual(['first.jpg', 'second.jpg']);
  });

  it('says how many are attached, so a crew knows the tap landed', () => {
    const photo = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    render(<FaultDetail item={item} answer={{ photoFiles: [photo, photo] }} onChange={vi.fn()} />);
    expect(screen.getByText('2 photos attached')).toBeVisible();
  });

  it('can be locked while a check is submitting', () => {
    render(<FaultDetail item={item} answer={undefined} onChange={vi.fn()} disabled />);
    expect(screen.getByTestId('function-note-i1')).toBeDisabled();
    expect(screen.getByTestId('function-photo-i1')).toBeDisabled();
  });
});
