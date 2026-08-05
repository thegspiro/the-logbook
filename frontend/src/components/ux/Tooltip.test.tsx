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

    // Fired on the child: the handlers live on Tooltip's wrapper and React
    // delegates, which is exactly how a real tap reaches them.
    fireEvent.touchStart(screen.getByText('x'));
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
    fireEvent.touchStart(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still shows on hover after the configured delay', () => {
    render(
      <Tooltip content="Info" delay={300}>
        <button>i</button>
      </Tooltip>
    );
    // mouseOver, not mouseEnter: React derives onMouseEnter from the native
    // mouseover it delegates, so this is the event a real pointer produces.
    fireEvent.mouseOver(screen.getByText('i'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Info');
  });
});
