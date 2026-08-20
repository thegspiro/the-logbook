import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { Suspense, useState } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteTitleManager } from './RouteTitleManager';

function RouterHarness({
  children,
  initialEntry = '/dashboard',
}: {
  children: React.ReactNode;
  initialEntry?: string;
}) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <RouteTitleManager />
      {children}
    </MemoryRouter>
  );
}

describe('RouteTitleManager', () => {
  afterEach(() => {
    document.title = '';
    vi.useRealTimers();
  });

  it('uses the visible page heading without waiting for an animation frame', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    render(
      <RouterHarness>
        <main>
          <h1>Dashboard</h1>
        </main>
      </RouterHarness>
    );

    expect(document.title).toBe('Dashboard | The Logbook');
  });

  it('prefers the page heading over an earlier header heading', () => {
    render(
      <RouterHarness>
        <header>
          <h1>Fire Department</h1>
        </header>
        <main>
          <h1>Choose Your Modules</h1>
        </main>
      </RouterHarness>
    );

    expect(document.title).toBe('Choose Your Modules | The Logbook');
  });

  it.each([
    ['pushes', false],
    ['replaces', true],
  ])('restores the title when a same-page query update %s history without changing the DOM', async (_, replace) => {
    window.history.replaceState(null, '', '/medical-screening');
    const Requirements = () => {
      const navigate = useNavigate();
      return (
        <main>
          <h1>Medical Screening</h1>
          <button type="button" onClick={() => void navigate('?tab=requirements', { replace })}>
            Requirements
          </button>
        </main>
      );
    };

    render(
      <BrowserRouter>
        <RouteTitleManager />
        <Routes>
          <Route path="/medical-screening" element={<Requirements />} />
        </Routes>
      </BrowserRouter>
    );

    expect(document.title).toBe('Medical Screening | The Logbook');
    fireEvent.click(screen.getByRole('button', { name: 'Requirements' }));
    await waitFor(() => expect(document.title).toBe('Medical Screening | The Logbook'));
    expect(window.location.search).toBe('?tab=requirements');
  });

  it('replaces a protected-page title when navigating to a public route', async () => {
    const Dashboard = () => {
      const navigate = useNavigate();
      return (
        <main>
          <h1>Dashboard</h1>
          <button type="button" onClick={() => void navigate('/login')}>
            Log out
          </button>
        </main>
      );
    };

    render(
      <RouterHarness>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route
            path="/login"
            element={
              <main>
                <h1>Welcome Back</h1>
              </main>
            }
          />
        </Routes>
      </RouterHarness>
    );

    expect(document.title).toBe('Dashboard | The Logbook');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(document.title).toBe('Welcome Back | The Logbook'));
  });

  it('keeps watching after five seconds for an unusually late heading', async () => {
    vi.useFakeTimers();

    const SlowPage = () => {
      const [ready, setReady] = useState(false);
      React.useEffect(() => {
        const timer = setTimeout(() => setReady(true), 6000);
        return () => clearTimeout(timer);
      }, []);
      return ready ? <h1>Medical Screening</h1> : <p>Loading records…</p>;
    };

    render(
      <RouterHarness>
        <main>
          <SlowPage />
        </main>
      </RouterHarness>
    );

    expect(document.title).toBe('The Logbook');
    await act(async () => vi.advanceTimersByTime(6000));
    expect(document.title).toBe('Medical Screening | The Logbook');
  });

  it('clears the source title while a lazy destination is suspended', async () => {
    window.history.replaceState(null, '', '/dashboard');
    let resolvePage!: (module: { default: React.ComponentType }) => void;
    const LazyPage = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType }>((resolve) => {
          resolvePage = resolve;
        })
    );
    const Dashboard = () => {
      const navigate = useNavigate();
      return (
        <main>
          <h1>Dashboard</h1>
          <button type="button" onClick={() => void navigate('/finance')}>
            Open finance
          </button>
        </main>
      );
    };

    render(
      <BrowserRouter>
        <RouteTitleManager />
        <Suspense fallback={<main aria-label="Loading page">Loading…</main>}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/finance" element={<LazyPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open finance' }));
    expect(document.title).toBe('The Logbook');

    await act(async () => resolvePage({ default: () => <h1>Finance</h1> }));
    await waitFor(() => expect(document.title).toBe('Finance | The Logbook'));
  });
});
