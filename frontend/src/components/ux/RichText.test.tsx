import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from './RichText';

describe('RichText', () => {
  it('shows plain text exactly as typed, markup characters included', () => {
    render(<RichText content={'Quorum was <5\nand <b>stayed</b> plain'} />);
    expect(screen.getByText(/Quorum was <5/)).toBeInTheDocument();
    expect(screen.queryByRole('strong')).not.toBeInTheDocument();
  });

  it('renders the rich subset with its structure', () => {
    render(
      <RichText
        format="html"
        content="<h2>Old business</h2><p>Moved <strong>hoses</strong></p><ul><li>Order hose</li></ul><ol><li>Test pump</li></ol>"
      />
    );
    expect(screen.getByRole('heading', { name: 'Old business', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('hoses').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('removes script, event handlers and unsafe links before they reach the page', () => {
    render(
      <RichText
        format="html"
        content={
          '<p onclick="x()">hello</p><script>window.__owned = true</script><a href="javascript:alert(1)">bad</a><a href="https://ok.example">good</a>'
        }
      />
    );
    expect((window as unknown as { __owned?: boolean }).__owned).toBeUndefined();
    expect(screen.getByText('hello')).not.toHaveAttribute('onclick');
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
    const good = screen.getByRole('link', { name: 'good' });
    expect(good).toHaveAttribute('href', 'https://ok.example');
    expect(good).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
