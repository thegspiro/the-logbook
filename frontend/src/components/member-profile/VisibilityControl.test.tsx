import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HIDDEN_LABEL, VISIBLE_LABEL, VisibilityControl } from './VisibilityControl';

describe('VisibilityControl', () => {
  it('names the consequence in badge mode', () => {
    const { rerender } = render(<VisibilityControl field="address" label="Mailing address" visible mode="badge" />);
    expect(screen.getByText(VISIBLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    rerender(<VisibilityControl field="address" label="Mailing address" visible={false} mode="badge" />);
    expect(screen.getByText(HIDDEN_LABEL)).toBeInTheDocument();
  });

  it('flips to the opposite value from a labelled switch', async () => {
    const onChange = vi.fn();
    render(<VisibilityControl field="phone" label="Phone" visible mode="toggle" onChange={onChange} />);

    const toggle = screen.getByRole('switch', { name: 'Phone visibility' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not flip while a save is in flight', async () => {
    const onChange = vi.fn();
    render(
      <VisibilityControl field="phone" label="Phone" visible={false} mode="toggle" onChange={onChange} disabled />
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Phone visibility' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(HIDDEN_LABEL)).toBeInTheDocument();
  });
});
