import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockReload = vi.fn();
vi.mock('./serviceWorkerUpdate', () => ({
  reloadForNewVersion: (...args: unknown[]) => mockReload(...args) as unknown,
}));

import { lazyOptional } from './lazyOptional';

const Greeting: React.FC<{ name: string }> = ({ name }) => <p>Hello {name}</p>;

describe('lazyOptional', () => {
  beforeEach(() => {
    mockReload.mockReset();
    sessionStorage.clear();
  });

  it('renders the loaded component with its props', async () => {
    const Lazy = lazyOptional(() => Promise.resolve({ default: Greeting }));
    render(
      <Suspense fallback={<p>loading</p>}>
        <Lazy name="Engine 1" />
      </Suspense>
    );
    expect(await screen.findByText('Hello Engine 1')).toBeInTheDocument();
  });

  it('renders nothing, and leaves the page alone, when the chunk will not load', async () => {
    const chunkError = new TypeError('Failed to fetch dynamically imported module: /assets/Card.js');
    const importFn = vi.fn(() => Promise.reject<{ default: typeof Greeting }>(chunkError));
    const Lazy = lazyOptional(importFn);
    render(
      <div>
        <p>The rest of the page</p>
        <Suspense fallback={<p>loading</p>}>
          <Lazy name="Engine 1" />
        </Suspense>
      </div>
    );
    await vi.waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    expect(screen.getByText('The rest of the page')).toBeInTheDocument();
    expect(screen.queryByText(/Hello/)).not.toBeInTheDocument();
    expect(mockReload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
  });
});
