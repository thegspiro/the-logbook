import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Modal',
    children: <p>Modal body content</p>,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    defaultProps.onClose = vi.fn();
  });

  // ---- Rendering ----

  it('does not render when isOpen is false', () => {
    render(<Modal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
    expect(screen.queryByText('Modal body content')).not.toBeInTheDocument();
  });

  it('renders with title and children when isOpen is true', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal body content')).toBeInTheDocument();
  });

  // ---- Escape key ----

  it('calls onClose when Escape is pressed', async () => {
    render(<Modal {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closeOnEscape is false', () => {
    render(<Modal {...defaultProps} closeOnEscape={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  // ---- Backdrop click ----

  it('calls onClose when clicking backdrop (outside modal)', async () => {
    render(<Modal {...defaultProps} />);

    // The backdrop handler is on the flex container div that wraps the overlay and modal panel.
    // We need to click the container, not the overlay itself.
    // The handler checks e.target === e.currentTarget, so we need to click
    // the exact element that has the onClick handler.
    const backdrop = screen.getByRole('dialog').querySelector('.flex.items-center');
    expect(backdrop).toBeTruthy();

    // fireEvent.click on the container triggers handler with target === currentTarget
    if (backdrop) fireEvent.click(backdrop);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when closeOnClickOutside is false', () => {
    render(<Modal {...defaultProps} closeOnClickOutside={false} />);

    const backdrop = screen.getByRole('dialog').querySelector('.flex.items-center');
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  // ---- Footer ----

  it('renders footer when provided', () => {
    const footer = <button>Save</button>;
    render(<Modal {...defaultProps} footer={footer} />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('does not render footer section when not provided', () => {
    const { container } = render(<Modal {...defaultProps} />);
    // The footer container has a specific class; when no footer, it should not appear
    const footerSection = container.querySelector('.bg-theme-surface-secondary');
    expect(footerSection).not.toBeInTheDocument();
  });

  // ---- ARIA attributes ----

  it('has proper ARIA attributes (role="dialog", aria-modal="true")', () => {
    render(<Modal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });

  // ---- Close button ----

  it('close button calls onClose', async () => {
    render(<Modal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /Close modal/i });
    await userEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  // ---- Size variants ----

  it('applies the correct size class based on size prop', () => {
    const { rerender, container } = render(<Modal {...defaultProps} size="sm" />);
    let panel = container.querySelector('[tabindex="-1"]');
    expect(panel?.className).toContain('sm:max-w-md');

    rerender(<Modal {...defaultProps} size="lg" />);
    panel = container.querySelector('[tabindex="-1"]');
    expect(panel?.className).toContain('sm:max-w-2xl');

    rerender(<Modal {...defaultProps} size="xl" />);
    panel = container.querySelector('[tabindex="-1"]');
    expect(panel?.className).toContain('sm:max-w-4xl');
  });

  it('defaults to md size when size prop is not provided', () => {
    const { container } = render(<Modal {...defaultProps} />);
    const panel = container.querySelector('[tabindex="-1"]');
    expect(panel?.className).toContain('sm:max-w-lg');
  });

  // ---- Body scroll lock ----

  it('prevents body scroll when modal is open', () => {
    const { unmount } = render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('unset');
  });
});
