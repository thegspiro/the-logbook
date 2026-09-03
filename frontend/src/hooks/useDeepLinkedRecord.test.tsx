/**
 * The hook that makes the inventory hub's queue actions land on the record.
 *
 * Every "Review" and "Check in" link on that queue carried the record's id as
 * a query parameter, and none of the six target pages read it — the officer
 * clicked Review on a named request and arrived at an unfiltered list. This
 * covers the shared mechanism; the pages' own tests cover their wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import React, { useState } from 'react';
import { useDeepLinkedRecord } from './useDeepLinkedRecord';

interface Row {
  id: string;
  name: string;
}

const onOpen = vi.fn();

/** Loads its rows a tick late, the way a real page does. */
const Harness: React.FC<{ rows: Row[]; loadImmediately?: boolean }> = ({ rows, loadImmediately = true }) => {
  const [loaded, setLoaded] = useState<Row[]>(loadImmediately ? rows : []);
  useDeepLinkedRecord('request', loaded, (row) => row.id, onOpen);
  return (
    <div>
      <button type="button" onClick={() => setLoaded(rows)}>
        finish loading
      </button>
      <span data-testid="count">{loaded.length}</span>
    </div>
  );
};

const ROWS: Row[] = [
  { id: 'r-1', name: 'Gloves' },
  { id: 'r-2', name: 'Helmet' },
];

const renderAt = (url: string, ui: React.ReactElement) => {
  window.history.pushState({}, '', url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('useDeepLinkedRecord', () => {
  beforeEach(() => {
    onOpen.mockReset();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('opens the record the parameter names', async () => {
    renderAt('/write-offs?request=r-2', <Harness rows={ROWS} />);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(ROWS[1]));
  });

  it('does nothing when the parameter is absent', async () => {
    renderAt('/write-offs', <Harness rows={ROWS} />);
    await screen.findByTestId('count');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is a no-op for an id no loaded record carries', async () => {
    // Somebody else may have resolved the row between the queue rendering and
    // the click. Arriving at a working page is right; an error about a request
    // that no longer needs anyone is not.
    renderAt('/write-offs?request=gone', <Harness rows={ROWS} />);
    await screen.findByTestId('count');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('waits for the list rather than giving up on an empty first render', async () => {
    const user = userEvent.setup();
    renderAt('/write-offs?request=r-1', <Harness rows={ROWS} loadImmediately={false} />);
    expect(onOpen).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'finish loading' }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(ROWS[0]));
  });

  it('consumes the parameter, so the URL says where the reader is', async () => {
    renderAt('/write-offs?request=r-1', <Harness rows={ROWS} />);

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('leaves other parameters alone when it consumes its own', async () => {
    renderAt('/reorder?status=ordered&request=r-1', <Harness rows={ROWS} />);

    await waitFor(() => expect(window.location.search).toBe('?status=ordered'));
  });

  it('opens the record once, not on every render', async () => {
    const user = userEvent.setup();
    renderAt('/write-offs?request=r-1', <Harness rows={ROWS} />);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));

    // Force re-renders; the parameter is gone, so nothing reopens.
    await user.click(screen.getByRole('button', { name: 'finish loading' }));
    await user.click(screen.getByRole('button', { name: 'finish loading' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
