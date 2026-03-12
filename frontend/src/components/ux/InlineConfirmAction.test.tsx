import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineConfirmAction } from './InlineConfirmAction';

describe('InlineConfirmAction', () => {
  const defaultProps = {
    confirmLabel: 'Remove?',
    onConfirm: vi.fn(),
    trigger: (onClick: () => void) => (
      <button onClick={onClick}>Remove</button>
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the trigger button initially', () => {
    render(<InlineConfirmAction {...defaultProps} />);
    expect(screen.getByText('Remove')).toBeInTheDocument();
    expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
  });

  it('should show confirmation prompt when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<InlineConfirmAction {...defaultProps} />);

    await user.click(screen.getByText('Remove'));

    expect(screen.getByText('Remove?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('should call onConfirm when Yes is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<InlineConfirmAction {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByText('Remove'));
    await user.click(screen.getByText('Yes'));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('should close prompt and call onCancel when No is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<InlineConfirmAction {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByText('Remove'));
    expect(screen.getByText('Remove?')).toBeInTheDocument();

    await user.click(screen.getByText('No'));

    expect(onCancel).toHaveBeenCalledOnce();
    // Should revert to showing the trigger
    expect(screen.getByText('Remove')).toBeInTheDocument();
    expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
  });

  it('should show loading spinner when loading=true', async () => {
    render(<InlineConfirmAction {...defaultProps} loading={true} isOpen={true} />);

    // Yes button should be disabled with a spinner
    const yesButton = screen.getByLabelText('Confirm: Remove?');
    expect(yesButton).toBeDisabled();
    expect(screen.getByTestId('confirm-spinner')).toBeInTheDocument();
  });

  it('should handle async onConfirm', async () => {
    const user = userEvent.setup();
    const asyncConfirm = vi.fn().mockResolvedValue(undefined);
    render(<InlineConfirmAction {...defaultProps} onConfirm={asyncConfirm} />);

    await user.click(screen.getByText('Remove'));
    await user.click(screen.getByText('Yes'));

    await waitFor(() => {
      expect(asyncConfirm).toHaveBeenCalledOnce();
    });
  });

  it('should use amber variant styling', async () => {
    render(<InlineConfirmAction {...defaultProps} variant="amber" isOpen={true} />);

    const label = screen.getByText('Remove?');
    expect(label.className).toContain('text-amber-500');
  });

  it('should use red variant styling by default', () => {
    render(<InlineConfirmAction {...defaultProps} isOpen={true} />);

    const label = screen.getByText('Remove?');
    expect(label.className).toContain('text-red-500');
  });

  describe('controlled mode', () => {
    it('should respect external isOpen prop', () => {
      const { rerender } = render(
        <InlineConfirmAction {...defaultProps} isOpen={false} />
      );
      expect(screen.getByText('Remove')).toBeInTheDocument();
      expect(screen.queryByText('Remove?')).not.toBeInTheDocument();

      rerender(<InlineConfirmAction {...defaultProps} isOpen={true} />);
      expect(screen.getByText('Remove?')).toBeInTheDocument();
    });

    it('should call onOpenChange when trigger is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <InlineConfirmAction
          {...defaultProps}
          isOpen={false}
          onOpenChange={onOpenChange}
        />
      );

      await user.click(screen.getByText('Remove'));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('should call onOpenChange(false) when No is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <InlineConfirmAction
          {...defaultProps}
          isOpen={true}
          onOpenChange={onOpenChange}
        />
      );

      await user.click(screen.getByText('No'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should have proper aria-labels', () => {
    render(<InlineConfirmAction {...defaultProps} isOpen={true} />);

    expect(screen.getByLabelText('Confirm: Remove?')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel: Remove?')).toBeInTheDocument();
  });
});
