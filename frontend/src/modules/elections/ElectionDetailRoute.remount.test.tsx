/**
 * ELEC2-14: the election page stayed mounted when the URL moved from one
 * election to another (the runoff chain's links, a clone), and kept the first
 * election's integrity result, forensics report, paper batches and pending
 * void in state — so election B showed "3 tampered votes" from election A, and
 * Attest/Void would have sent A's batch ids against B. The route keys the page
 * by the election id, so a new election is a new page.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';

let mounts = 0;

vi.mock('../../pages/ElectionDetailPage', () => ({
  ElectionDetailPage: () => {
    const [mount] = useState(() => {
      mounts += 1;
      return mounts;
    });
    const navigate = useNavigate();
    return (
      <>
        <p>page mount {mount}</p>
        <button type="button" onClick={() => void navigate('/elections/e-2')}>
          Open election B
        </button>
      </>
    );
  },
}));

import { ElectionDetailRoute } from './ElectionDetailRoute';

describe('ElectionDetailRoute moving to another election', () => {
  it('starts a fresh page, carrying nothing from the last election', async () => {
    mounts = 0;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/elections/e-1']}>
        <Routes>
          <Route path="/elections/:electionId/*" element={<ElectionDetailRoute />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('page mount 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open election B' }));

    expect(await screen.findByText('page mount 2')).toBeInTheDocument();
  });
});
