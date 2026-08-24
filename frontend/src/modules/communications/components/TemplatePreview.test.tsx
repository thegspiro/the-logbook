import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplatePreview } from './TemplatePreview';

describe('TemplatePreview', () => {
  it('renders empty state when no preview', () => {
    render(<TemplatePreview preview={null} isPreviewing={false} onRefresh={vi.fn()} />);

    expect(screen.getByText(/click "refresh" to generate a preview/i)).toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(<TemplatePreview preview={null} isPreviewing={true} onRefresh={vi.fn()} />);

    expect(screen.getByText('Loading preview...')).toBeInTheDocument();
  });

  it('renders subject line when preview is available', () => {
    const preview = {
      subject: 'Welcome to Sample Department',
      html_body: '<!DOCTYPE html><html><body><p>Hello John</p></body></html>',
      text_body: 'Hello John',
    };

    render(<TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />);

    expect(screen.getByText('Welcome to Sample Department')).toBeInTheDocument();
  });

  it('renders iframe for HTML preview', () => {
    const preview = {
      subject: 'Test Subject',
      html_body: '<!DOCTYPE html><html><body><p>Hello</p></body></html>',
      text_body: 'Hello',
    };

    render(<TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />);

    expect(screen.getByTitle('Email template preview')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(<TemplatePreview preview={null} isPreviewing={false} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('has desktop/mobile/plain-text preview modes', () => {
    render(<TemplatePreview preview={null} isPreviewing={false} onRefresh={vi.fn()} />);

    expect(screen.getByTitle('Desktop preview')).toBeInTheDocument();
    expect(screen.getByTitle('Mobile preview')).toBeInTheDocument();
    // The third mode is the half of every template nobody looks at, and the
    // half that silently stops matching the HTML the first time one is edited.
    expect(screen.getByTitle('Plain-text preview')).toBeInTheDocument();
  });

  it('shows the plain-text body in text mode', async () => {
    const user = userEvent.setup();
    const preview = {
      subject: 'Test Subject',
      html_body: '<!DOCTYPE html><html><body><p>Hello</p></body></html>',
      text_body: 'Hello John, in plain text.',
    };

    render(<TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />);
    await user.click(screen.getByTitle('Plain-text preview'));

    expect(screen.getByText('Hello John, in plain text.')).toBeInTheDocument();
    expect(screen.queryByTitle('Email template preview')).not.toBeInTheDocument();
  });

  it('says so when a template has no plain-text body at all', async () => {
    const user = userEvent.setup();
    const preview = { subject: 'S', html_body: '<html><body>x</body></html>', text_body: '' };

    render(<TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />);
    await user.click(screen.getByTitle('Plain-text preview'));

    expect(screen.getByText(/no plain-text body/i)).toBeInTheDocument();
  });

  it('marks the pane unsaved when it is showing a draft', () => {
    // The pane renders what you are typing, so without this an admin reading
    // a correct-looking preview cannot tell whether anyone would receive it.
    const preview = { subject: 'S', html_body: '<html><body>x</body></html>', text_body: 't' };

    const { rerender } = render(
      <TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} isDirty={false} />
    );
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();

    rerender(<TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} isDirty={true} />);
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('disables refresh when previewing', () => {
    render(<TemplatePreview preview={null} isPreviewing={true} onRefresh={vi.fn()} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    expect(refreshBtn).toBeDisabled();
  });
});
