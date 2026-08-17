import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkifiedText } from './LinkifiedText';

describe('LinkifiedText', () => {
  it('turns a URL into a link with safe target/rel', () => {
    render(
      <p>
        <LinkifiedText text="Sign up at https://example.com/form now" />
      </p>
    );
    const link = screen.getByRole('link', { name: 'https://example.com/form' });
    expect(link).toHaveAttribute('href', 'https://example.com/form');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('excludes trailing sentence punctuation from the href but keeps it in text', () => {
    render(
      <p data-testid="body">
        <LinkifiedText text="See https://example.com/sop." />
      </p>
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/sop');
    // The full original text is preserved, period included.
    expect(screen.getByTestId('body')).toHaveTextContent('See https://example.com/sop.');
  });

  it('linkifies multiple URLs in one body', () => {
    render(
      <p>
        <LinkifiedText text="Forms: https://a.co/1 and https://b.co/2" />
      </p>
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders plain text without any links', () => {
    render(
      <p data-testid="body">
        <LinkifiedText text="No links here, just text" />
      </p>
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('body')).toHaveTextContent('No links here, just text');
  });

  it('does not treat plain domains without a scheme as links', () => {
    render(
      <p>
        <LinkifiedText text="Visit example.com for details" />
      </p>
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  // Linkified bodies get embedded in clickable rows (dashboard feed); following
  // a link must not also fire the enclosing row's action, which would drag the
  // current tab off to another page while the link opens in a new one.
  it('does not let link clicks bubble into an enclosing clickable row', () => {
    const rowClick = vi.fn();
    render(
      <div role="button" tabIndex={0} onClick={rowClick}>
        <LinkifiedText text="Sign up at https://example.com/form now" />
      </div>
    );

    const link = screen.getByRole('link');
    // jsdom can't navigate; keep the click from hitting the default handler.
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);

    expect(rowClick).not.toHaveBeenCalled();

    // Clicking the row outside the link still fires the row action.
    fireEvent.click(screen.getByRole('button'));
    expect(rowClick).toHaveBeenCalledTimes(1);
  });
});
