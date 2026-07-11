import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import { PullToRefreshProvider, usePullToRefreshContext } from './PullToRefreshContext';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';

// Surfaces the context's hasHandler flag and exposes runRefresh for assertions.
function ContextProbe({ onRun }: { onRun: (run: () => Promise<void>) => void }) {
  const ctx = usePullToRefreshContext();
  useEffect(() => {
    if (ctx) onRun(ctx.runRefresh);
  }, [ctx, onRun]);
  return <div data-testid="has-handler">{String(ctx?.hasHandler)}</div>;
}

function RegisteringPage({ onRefresh }: { onRefresh: () => Promise<void> }) {
  useRegisterPullToRefresh(onRefresh);
  return <div>page</div>;
}

describe('PullToRefreshContext', () => {
  it('reports no handler until a page registers one', () => {
    render(
      <PullToRefreshProvider>
        <ContextProbe onRun={() => {}} />
      </PullToRefreshProvider>
    );
    expect(screen.getByTestId('has-handler')).toHaveTextContent('false');
  });

  it('registers a page handler and invokes it via runRefresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    let run: (() => Promise<void>) | undefined;

    render(
      <PullToRefreshProvider>
        <ContextProbe onRun={(r) => { run = r; }} />
        <RegisteringPage onRefresh={refresh} />
      </PullToRefreshProvider>
    );

    expect(screen.getByTestId('has-handler')).toHaveTextContent('true');
    await act(async () => {
      await run?.();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the handler when the registering page unmounts', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <PullToRefreshProvider>
        <ContextProbe onRun={() => {}} />
        <RegisteringPage onRefresh={refresh} />
      </PullToRefreshProvider>
    );
    expect(screen.getByTestId('has-handler')).toHaveTextContent('true');

    rerender(
      <PullToRefreshProvider>
        <ContextProbe onRun={() => {}} />
      </PullToRefreshProvider>
    );
    expect(screen.getByTestId('has-handler')).toHaveTextContent('false');
  });

  it('useRegisterPullToRefresh is a no-op outside a provider', () => {
    expect(() =>
      render(<RegisteringPage onRefresh={() => Promise.resolve()} />)
    ).not.toThrow();
  });
});
