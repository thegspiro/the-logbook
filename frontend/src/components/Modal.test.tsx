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

    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when closeOnClickOutside is false', () => {
    render(<Modal {...defaultProps} closeOnClickOutside={false} />);

    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  // ---- Footer ----

  it('renders footer when provided', () => {
    const footer = <button>Save</button>;
    render(<Modal {...defaultProps} footer={footer} />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps long form content in a dedicated scrolling region', () => {
    render(<Modal {...defaultProps} footer={<button>Save</button>} />);

    const panel = screen.getByTestId('modal-panel');
    const content = screen.getByTestId('modal-content');
    const footer = screen.getByTestId('modal-footer');

    expect(panel).toHaveClass('flex-col', 'overflow-hidden');
    expect(content).toHaveClass('modal-content');
    expect(footer).toHaveClass('modal-footer', 'shrink-0');
  });

  it('does not render footer section when not provided', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.queryByTestId('modal-footer')).not.toBeInTheDocument();
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
    const { rerender } = render(<Modal {...defaultProps} size="sm" />);
    let panel = screen.getByTestId('modal-panel');
    expect(panel).toHaveClass('sm:max-w-md');

    rerender(<Modal {...defaultProps} size="lg" />);
    panel = screen.getByTestId('modal-panel');
    expect(panel).toHaveClass('sm:max-w-2xl');

    rerender(<Modal {...defaultProps} size="xl" />);
    panel = screen.getByTestId('modal-panel');
    expect(panel).toHaveClass('sm:max-w-4xl');
  });

  it('defaults to md size when size prop is not provided', () => {
    render(<Modal {...defaultProps} />);
    const panel = screen.getByTestId('modal-panel');
    expect(panel).toHaveClass('sm:max-w-lg');
  });

  it('uses one internal scroller with pinned, safe actions', () => {
    render(<Modal {...defaultProps} footer={<button>Save</button>} />);
    expect(screen.getByTestId('modal-panel')).toHaveClass('modal-body', 'overflow-hidden');
    expect(screen.getByTestId('modal-content')).toHaveClass('overflow-y-auto', 'min-h-0');
    expect(screen.getByTestId('modal-footer')).toHaveClass('modal-footer-sticky');
  });

  it('can make its panel a form without disconnecting footer actions', () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    render(<Modal {...defaultProps} onSubmit={onSubmit} footer={<button type="submit">Save</button>} />);
    fireEvent.submit(screen.getByTestId('modal-panel'));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByTestId('modal-panel')).toContainElement(screen.getByRole('button', { name: 'Save' }));
  });

  // ---- Body scroll lock ----

  it('prevents body scroll when modal is open', () => {
    const { unmount } = render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('removes the page mask completely when closed', () => {
    const { rerender } = render(<Modal {...defaultProps} />);
    expect(screen.getByTestId('modal-backdrop')).toBeInTheDocument();

    rerender(<Modal {...defaultProps} isOpen={false} />);

    expect(screen.queryByTestId('modal-backdrop')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});
