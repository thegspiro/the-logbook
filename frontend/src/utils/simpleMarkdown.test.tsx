import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SimpleMarkdown } from './simpleMarkdown';

describe('SimpleMarkdown', () => {
  describe('inline formatting', () => {
    it('renders plain text', () => {
      render(<SimpleMarkdown text="hello world" />);
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    it('renders **bold** as <strong>', () => {
      render(<SimpleMarkdown text="a **bold** b" />);
      expect(screen.getByText('bold').tagName).toBe('STRONG');
    });

    it('renders *italic* as <em>', () => {
      render(<SimpleMarkdown text="a *word* b" />);
      expect(screen.getByText('word').tagName).toBe('EM');
    });

    it('treats ** as bold, not italic', () => {
      render(<SimpleMarkdown text="**bold**" />);
      // If it were parsed as italic the tag would be EM.
      expect(screen.getByText('bold').tagName).toBe('STRONG');
    });
  });

  describe('links', () => {
    it('renders a safe https link with safe rel/target', () => {
      render(<SimpleMarkdown text="[site](https://example.com)" />);
      const anchor = screen.getByRole('link', { name: 'site' });
      expect(anchor).toHaveAttribute('href', 'https://example.com');
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders a mailto link', () => {
      render(<SimpleMarkdown text="[mail](mailto:chief@dept.org)" />);
      expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute(
        'href',
        'mailto:chief@dept.org',
      );
    });

    it('downgrades a javascript: URL to plain text (no anchor)', () => {
      render(<SimpleMarkdown text="[click](javascript:alert(1))" />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText(/click/)).toBeInTheDocument();
      expect(screen.queryByText(/javascript/i)).not.toBeInTheDocument();
    });

    it('downgrades a data: URL to plain text (no anchor)', () => {
      render(<SimpleMarkdown text="[x](data:text/html,hi)" />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('x')).toBeInTheDocument();
    });
  });

  describe('XSS safety', () => {
    it('renders raw HTML in the text as literal text, not markup', () => {
      const raw = '<img src=x onerror=alert(1)>';
      render(<SimpleMarkdown text={raw} />);
      // If React had injected this as HTML, this exact string would not be
      // present as visible text — finding it proves it was escaped to a text node.
      expect(screen.getByText(raw)).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('does not execute a script tag embedded in the text', () => {
      const raw = '<script>alert(1)</script>';
      render(<SimpleMarkdown text={raw} />);
      expect(screen.getByText(raw)).toBeInTheDocument();
    });
  });

  describe('block formatting', () => {
    it('renders consecutive "- " lines as a single bullet list', () => {
      render(<SimpleMarkdown text={'- first\n- second'} />);
      expect(screen.getAllByRole('list')).toHaveLength(1);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(screen.getByText('first')).toBeInTheDocument();
      expect(screen.getByText('second')).toBeInTheDocument();
    });

    it('applies inline formatting inside list items', () => {
      render(<SimpleMarkdown text={'- a **bold** item'} />);
      expect(screen.getByText('bold').tagName).toBe('STRONG');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('renders adjacent non-list lines as separate text', () => {
      render(<SimpleMarkdown text={'line one\nline two'} />);
      expect(screen.getByText(/line one/)).toBeInTheDocument();
      expect(screen.getByText(/line two/)).toBeInTheDocument();
    });
  });
});
