import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import NotFoundPage from './NotFoundPage';

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/dashboard" element={<div>Dashboard home</div>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('NotFoundPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says the page was not found, as the page heading', () => {
    renderAt('/scheduling/templates');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('names the address that matched nothing', () => {
    renderAt('/scheduling/templates');

    expect(screen.getByText(/There is no page at \/scheduling\/templates\./)).toBeInTheDocument();
  });

  it('does not echo a query string or fragment, which can carry a token', () => {
    renderAt('/reset/password?token=SECRET-VALUE#frag');

    const text = document.body.textContent ?? '';
    expect(text).toContain('/reset/password');
    expect(text).not.toContain('SECRET-VALUE');
    expect(text).not.toContain('frag');
  });

  it('shortens a very long address', () => {
    renderAt(`/${'a'.repeat(200)}`);

    expect((document.body.textContent ?? '').length).toBeLessThan(400);
  });

  it('offers a way back to the dashboard', async () => {
    const user = userEvent.setup();
    renderAt('/nowhere');

    await user.click(screen.getByRole('button', { name: 'Go to the dashboard' }));

    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });

  it('sends a visitor with no history to the dashboard instead of nowhere', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    renderAt('/nowhere');

    await user.click(screen.getByRole('button', { name: 'Go back' }));

    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });
});
