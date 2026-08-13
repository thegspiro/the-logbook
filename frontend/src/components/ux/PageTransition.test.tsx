import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React, { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { PageTransition } from './PageTransition';

/** A page that renders a loading state first and its heading only after async
 *  content lands — without re-rendering PageTransition itself, exactly like a
 *  route component swapping a skeleton for fetched data. */
const LateHeading: React.FC<{ delayMs?: number }> = ({ delayMs = 20 }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return ready ? <h1>Members</h1> : <p>Loading…</p>;
};

describe('PageTransition accessibility', () => {
  it('announces the page heading without making the whole page a live region', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const { container } = render(
      <MemoryRouter>
        <PageTransition>
          <section>
            <h1>Members</h1>
            <button type="button">Add member</button>
          </section>
        </PageTransition>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Members'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-live');
    expect(await axe(container)).toHaveNoViolations();
  });

  // The announcement used to be captured on the first frame and never looked
  // again, so any page opening on a spinner or skeleton announced "Page
  // loaded" forever, whatever heading its data eventually brought.
  it('announces the real heading once async content replaces a loading state', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <MemoryRouter>
        <PageTransition>
          <LateHeading />
        </PageTransition>
      </MemoryRouter>
    );

    // Nothing generic is announced while the heading may still arrive.
    expect(screen.getByRole('status')).not.toHaveTextContent('Page loaded');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Members'));
    expect(screen.getByRole('status')).not.toHaveTextContent('Page loaded');
  });

  it('falls back to a generic announcement when no heading ever arrives', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <PageTransition>
            <p>No heading on this page</p>
          </PageTransition>
        </MemoryRouter>
      );

      expect(screen.getByRole('status')).toHaveTextContent('');
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('Page loaded');
    } finally {
      vi.useRealTimers();
    }
  });
});
