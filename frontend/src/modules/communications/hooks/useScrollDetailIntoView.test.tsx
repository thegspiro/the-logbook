import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollDetailIntoView } from './useScrollDetailIntoView';

function mockViewport(sideBySide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: sideBySide,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const Pane = ({ id }: { id: string | null }) => {
  const ref = useScrollDetailIntoView<HTMLDivElement>(id);
  return <div ref={ref} data-testid="pane" />;
};

describe('useScrollDetailIntoView', () => {
  const originalMatchMedia = window.matchMedia;
  const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);

  beforeEach(() => {
    scrollIntoView.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  it('scrolls the pane into view when an item opens on a phone', () => {
    mockViewport(false);
    const { rerender } = render(<Pane id={null} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<Pane id="s1" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<Pane id="s1" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<Pane id="s2" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('leaves the page alone where list and pane sit side by side', () => {
    mockViewport(true);
    render(<Pane id="s1" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
