import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
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
  it('applies the shared CSS page-spacing boundary', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PageTransition>
          <h1>Dashboard</h1>
        </PageTransition>
      </MemoryRouter>
    );

    // The layout marker intentionally has no ARIA role; it is visual CSS plumbing.
    // eslint-disable-next-line testing-library/no-node-access
    expect(screen.getByRole('heading', { name: 'Dashboard' }).closest('[data-page-layout]')).toHaveAttribute(
      'data-page-layout',
      'application'
    );
  });

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
    expect(document.title).toBe('Members | The Logbook');
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

  // Assistive tech that queries the region — rather than waiting for the live
  // announcement — reads whatever it holds. Holding the previous page's
  // heading through the watch window told it the user was still on a page they
  // had already left, for up to five seconds.
  it('clears the previous page announcement while watching a page that opens on a skeleton', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const Roster: React.FC = () => {
      const navigate = useNavigate();
      return (
        <div>
          <h1>Roster</h1>
          <button type="button" onClick={() => void navigate('/members')}>
            Go to members
          </button>
        </div>
      );
    };

    render(
      <MemoryRouter initialEntries={['/roster']}>
        <PageTransition>
          <Routes>
            <Route path="/roster" element={<Roster />} />
            <Route path="/members" element={<LateHeading delayMs={50} />} />
          </Routes>
        </PageTransition>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Roster'));

    fireEvent.click(screen.getByRole('button', { name: 'Go to members' }));

    // Mid-navigation: the new page is still a skeleton, so nothing is claimed
    // about it — but the old page is no longer claimed either.
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByRole('status')).not.toHaveTextContent('Roster');
    expect(document.title).toBe('The Logbook');

    // …and the watch still settles on the heading when it lands: one
    // announcement per navigation, not permanent silence.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Members'));
    expect(document.title).toBe('Members | The Logbook');
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
      expect(document.title).toBe('The Logbook');
    } finally {
      vi.useRealTimers();
    }
  });
});
