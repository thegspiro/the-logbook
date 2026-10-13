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

  it('describes the control itself, not a wrapper', () => {
    render(
      <Tooltip content="Expires in 30 days" delay={0}>
        <button>Status</button>
      </Tooltip>
    );
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.focus(button);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(button).toHaveAccessibleDescription('Expires in 30 days');
  });

  it('dismisses on Escape without moving focus or pointer', () => {
    render(
      <Tooltip content="Info" delay={0}>
        <button>i</button>
      </Tooltip>
    );
    fireEvent.focus(screen.getByText('i'));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays open while the pointer moves onto it', () => {
    render(
      <Tooltip content="Info" delay={0}>
        <button>i</button>
      </Tooltip>
    );
    fireEvent.mouseOver(screen.getByText('i'));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const tooltip = screen.getByRole('tooltip');
    fireEvent.mouseOut(screen.getByText('i'), { relatedTarget: tooltip });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
