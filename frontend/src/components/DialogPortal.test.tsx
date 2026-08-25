import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DialogPortal } from './DialogPortal';

describe('DialogPortal', () => {
  it('renders its children outside the calling subtree', () => {
    render(
      <div data-testid="page">
        <DialogPortal>
          <div data-testid="shell">dialog</div>
        </DialogPortal>
      </div>
    );

    expect(screen.getByTestId('shell')).toBeInTheDocument();
    expect(within(screen.getByTestId('page')).queryByTestId('shell')).toBeNull();
  });

  it('escapes an ancestor that would capture a fixed-position descendant', () => {
    // `backdrop-filter`, `filter`, `transform`, `contain` and `will-change` all
    // make an element the containing block for `position: fixed` children. The
    // app's own `card` utility carries backdrop-blur for the dark-mode glass
    // surface, which is how a dialog declared inside a card came to be laid out
    // inside that card with its action row off the bottom of the screen.
    render(
      <div data-testid="card" className="card" style={{ backdropFilter: 'blur(4px)' }}>
        <DialogPortal>
          <div role="dialog" aria-label="Example" />
        </DialogPortal>
      </div>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByTestId('card')).queryByRole('dialog')).toBeNull();
  });
});
