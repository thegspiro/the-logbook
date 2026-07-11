import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('reveals immediately on touch (no hover delay) and auto-dismisses', () => {
    render(
      <Tooltip content="Delete item">
        <button>x</button>
      </Tooltip>
    );

    fireEvent.touchStart(screen.getByText('x').parentElement as HTMLElement);
    // Shown right away — the hover delay is bypassed for touch.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete item');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not block the child tap handler', () => {
    const onClick = vi.fn();
    render(
      <Tooltip content="Edit">
        <button onClick={onClick}>edit</button>
      </Tooltip>
    );
    const btn = screen.getByText('edit');
    act(() => {
      fireEvent.touchStart(btn.parentElement as HTMLElement);
      fireEvent.click(btn);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still shows on hover after the configured delay', () => {
    render(
      <Tooltip content="Info" delay={300}>
        <button>i</button>
      </Tooltip>
    );
    const wrapper = screen.getByText('i').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Info');
  });
});
