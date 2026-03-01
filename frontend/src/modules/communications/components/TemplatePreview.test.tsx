import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplatePreview } from './TemplatePreview';

describe('TemplatePreview', () => {
  it('renders empty state when no preview', () => {
    render(
      <TemplatePreview preview={null} isPreviewing={false} onRefresh={vi.fn()} />,
    );

    expect(
      screen.getByText(/click "refresh" to generate a preview/i),
    ).toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(
      <TemplatePreview preview={null} isPreviewing={true} onRefresh={vi.fn()} />,
    );

    expect(screen.getByText('Loading preview...')).toBeInTheDocument();
  });

  it('renders subject line when preview is available', () => {
    const preview = {
      subject: 'Welcome to Sample Department',
      html_body: '<!DOCTYPE html><html><body><p>Hello John</p></body></html>',
      text_body: 'Hello John',
    };

    render(
      <TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />,
    );

    expect(screen.getByText('Welcome to Sample Department')).toBeInTheDocument();
  });

  it('renders iframe for HTML preview', () => {
    const preview = {
      subject: 'Test Subject',
      html_body: '<!DOCTYPE html><html><body><p>Hello</p></body></html>',
      text_body: 'Hello',
    };

    render(
      <TemplatePreview preview={preview} isPreviewing={false} onRefresh={vi.fn()} />,
    );

    expect(screen.getByTitle('Email template preview')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <TemplatePreview preview={null} isPreviewing={false} onRefresh={onRefresh} />,
    );

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('has desktop/mobile viewport toggle', () => {
    render(
      <TemplatePreview preview={null} isPreviewing={false} onRefresh={vi.fn()} />,
    );

    expect(screen.getByTitle('Desktop preview')).toBeInTheDocument();
    expect(screen.getByTitle('Mobile preview')).toBeInTheDocument();
  });

  it('disables refresh when previewing', () => {
    render(
      <TemplatePreview preview={null} isPreviewing={true} onRefresh={vi.fn()} />,
    );

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    expect(refreshBtn).toBeDisabled();
  });
});
