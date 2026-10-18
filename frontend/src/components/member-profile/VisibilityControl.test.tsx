import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HIDDEN_LABEL,
  ORG_HIDDEN_LABEL,
  ORG_PENDING_LABEL,
  VISIBLE_LABEL,
  VisibilityControl,
} from './VisibilityControl';

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

  it('says the department has a field off rather than promising visibility', () => {
    render(<VisibilityControl field="email" label="Email" visible mode="badge" orgHidden />);
    expect(screen.getByText(ORG_HIDDEN_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(VISIBLE_LABEL)).not.toBeInTheDocument();
  });

  it('never puts a switch that reads on beside a label that says off', () => {
    // A fresh install is exactly this state: the department's contact
    // visibility starts disabled, and a member's work-field choices start on.
    const { rerender } = render(<VisibilityControl field="email" label="Email" visible mode="toggle" orgHidden />);
    expect(screen.getByRole('switch', { name: 'Email visibility' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(ORG_HIDDEN_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(VISIBLE_LABEL)).not.toBeInTheDocument();
    expect(screen.getByText(ORG_PENDING_LABEL)).toBeInTheDocument();

    rerender(<VisibilityControl field="email" label="Email" visible={false} mode="toggle" orgHidden />);
    expect(screen.getByRole('switch', { name: 'Email visibility' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(HIDDEN_LABEL)).toBeInTheDocument();
  });

  it("still records the member's choice while the department has the field off", async () => {
    const onChange = vi.fn();
    render(
      <VisibilityControl field="phone" label="Phone" visible={false} mode="toggle" orgHidden onChange={onChange} />
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Phone visibility' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
