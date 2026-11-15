import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

// The page itself is not what is under test: the route element decides
// between forwarding a `?tab=` link and rendering it.
vi.mock('../../pages/ElectionDetailPage', () => ({ ElectionDetailPage: () => <p>election page</p> }));

import { ElectionDetailRoute } from './ElectionDetailRoute';

const Where = () => {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
};

const open = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/elections/:electionId/*"
          element={
            <>
              <ElectionDetailRoute />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('ElectionDetailRoute', () => {
  // The backend puts this exact link in nomination notification emails.
  it('forwards the emailed nominations link to the Nominations section', () => {
    open('/elections/e-1?tab=nominations');
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/elections\/e-1\/nominations$/);
    expect(screen.getByText('election page')).toBeInTheDocument();
  });

  it('forwards every old section name to its path', () => {
    open('/elections/e-1?tab=eligibility');
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/elections\/e-1\/eligibility$/);
  });

  it('sends an unknown or retired tab to the Overview', () => {
    open('/elections/e-1?tab=overview');
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/elections\/e-1$/);
  });

  it('carries any other query parameter and the hash along', () => {
    open('/elections/e-1?tab=results&from=email#race-2');
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/elections\/e-1\/results\?from=email#race-2$/);
  });

  it('renders the page untouched when there is no tab to forward', () => {
    open('/elections/e-1/results');
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/elections\/e-1\/results$/);
    expect(screen.getByText('election page')).toBeInTheDocument();
  });
});
