import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScrollCueRow } from './ScrollCueRow';

/**
 * jsdom lays nothing out, so each test supplies the geometry: a 300px row
 * whose content is `contentWidth` wide, scrolled to `scrollLeft`. Restored
 * after each test so no other block inherits it.
 */
const layOut = (contentWidth: number, scrollLeft = 0) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(contentWidth);
  let left = scrollLeft;
  vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(() => left);
  vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'set').mockImplementation((value: number) => {
    left = value;
  });
  return { setScrollLeft: (value: number) => (left = value), getScrollLeft: () => left };
};

const renderRow = (revealKey?: string) =>
  render(
    <ScrollCueRow className="flex" role="tablist" aria-label="Sections" revealKey={revealKey}>
      <button type="button" role="tab" aria-selected="false">
        One
      </button>
      <button type="button" role="tab" aria-selected={revealKey === 'last'}>
        Last
      </button>
    </ScrollCueRow>
  );

const cue = (side: 'left' | 'right') => screen.queryByTestId(`scroll-cue-${side}`);

describe('ScrollCueRow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws no cue when everything fits', () => {
    layOut(300);
    renderRow();

    expect(cue('left')).toBeNull();
    expect(cue('right')).toBeNull();
    expect(screen.getByRole('tablist')).not.toHaveAttribute('data-scroll-fade');
  });

  it('cues the right edge, and fades it, when more lies past it', () => {
    layOut(700);
    renderRow();

    expect(cue('right')).not.toBeNull();
    expect(cue('left')).toBeNull();
    expect(screen.getByRole('tablist')).toHaveAttribute('data-scroll-fade', 'right');
  });

  it('moves the cue to the left edge once the row is scrolled to its end', () => {
    const geometry = layOut(700);
    renderRow();

    geometry.setScrollLeft(400);
    fireEvent.scroll(screen.getByRole('tablist'));

    expect(cue('left')).not.toBeNull();
    expect(cue('right')).toBeNull();
    expect(screen.getByRole('tablist')).toHaveAttribute('data-scroll-fade', 'left');
  });

  it('cues both edges in the middle of the row', () => {
    const geometry = layOut(900);
    renderRow();

    geometry.setScrollLeft(200);
    fireEvent.scroll(screen.getByRole('tablist'));

    expect(cue('left')).not.toBeNull();
    expect(cue('right')).not.toBeNull();
    expect(screen.getByRole('tablist')).toHaveAttribute('data-scroll-fade', 'both');
  });

  it('pages the row most of a screen in the cue direction', () => {
    layOut(700);
    const scrollBy = vi.fn();
    HTMLElement.prototype.scrollBy = scrollBy;
    renderRow();

    fireEvent.click(screen.getByTestId('scroll-cue-right'));

    expect(scrollBy).toHaveBeenCalledWith({ left: 225, behavior: 'smooth' });
  });

  // The row's own items are the keyboard and screen-reader route; a second,
  // invisible-to-them way to scroll would only add stops.
  it('keeps the cue out of the tab order and away from assistive technology', () => {
    layOut(700);
    renderRow();

    expect(cue('right')).toHaveAttribute('tabindex', '-1');
    expect(cue('right')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: /scroll/i })).not.toBeInTheDocument();
  });

  it('scrolls a selected item that starts off screen into view', () => {
    const geometry = layOut(700);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (left: number, width: number) => ({ left, width, right: left + width }) as DOMRect;
      if (this.getAttribute('role') === 'tablist') return box(0, 300);
      if (this.textContent === 'Last') return box(600, 100);
      return box(0, 100);
    });

    renderRow('last');

    // Centred: 600 - 0 - (300 - 100) / 2.
    expect(geometry.getScrollLeft()).toBe(500);
  });

  // Inside the row but under the right chevron is not visible: the button
  // covers it.
  it('treats a selected item under a chevron as hidden', () => {
    const geometry = layOut(700);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (left: number, width: number) => ({ left, width, right: left + width }) as DOMRect;
      if (this.getAttribute('role') === 'tablist') return box(0, 300);
      if (this.textContent === 'Last') return box(220, 70);
      return box(0, 100);
    });

    renderRow('last');

    // 220 - 0 - (300 - 70) / 2.
    expect(geometry.getScrollLeft()).toBe(105);
  });

  it('passes its attributes to the scrolling element', () => {
    layOut(300);
    renderRow();

    expect(screen.getByRole('tablist', { name: 'Sections' })).toHaveClass('hscroll', 'flex');
  });
});
