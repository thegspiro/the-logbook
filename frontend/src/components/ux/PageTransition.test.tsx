import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { PageTransition } from './PageTransition';

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
});
