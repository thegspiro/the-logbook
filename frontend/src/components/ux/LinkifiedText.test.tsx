import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkifiedText } from './LinkifiedText';

describe('LinkifiedText', () => {
  it('turns a URL into a link with safe target/rel', () => {
    render(
      <p>
        <LinkifiedText text="Sign up at https://example.com/form now" />
      </p>,
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
      </p>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/sop');
    // The full original text is preserved, period included.
    expect(screen.getByTestId('body')).toHaveTextContent('See https://example.com/sop.');
  });

  it('linkifies multiple URLs in one body', () => {
    render(
      <p>
        <LinkifiedText text="Forms: https://a.co/1 and https://b.co/2" />
      </p>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders plain text without any links', () => {
    render(
      <p data-testid="body">
        <LinkifiedText text="No links here, just text" />
      </p>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('body')).toHaveTextContent('No links here, just text');
  });

  it('does not treat plain domains without a scheme as links', () => {
    render(
      <p>
        <LinkifiedText text="Visit example.com for details" />
      </p>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
