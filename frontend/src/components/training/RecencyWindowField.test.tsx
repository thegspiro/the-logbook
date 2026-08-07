import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecencyWindowField } from './RecencyWindowField';

const renderField = (value: number | undefined) => {
  const onChange = vi.fn();
  render(<RecencyWindowField idPrefix="test" value={value} onChange={onChange} />);
  return { onChange };
};

const TOGGLE = /Require a recent completion/;

describe('RecencyWindowField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is off when no window is set', () => {
    renderField(undefined);

    expect(screen.getByRole('checkbox', { name: TOGGLE })).not.toBeChecked();
    expect(screen.getByText(/a completion counts however long ago/)).toBeInTheDocument();
  });

  it('hides the day input while off', () => {
    renderField(undefined);

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('defaults to 180 days when switched on', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField(undefined);

    await user.click(screen.getByRole('checkbox', { name: TOGGLE }));

    expect(onChange).toHaveBeenCalledWith(180);
  });

  it('clears the window when switched off', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField(180);

    await user.click(screen.getByRole('checkbox', { name: TOGGLE }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('shows the active window in the explanation', () => {
    renderField(90);

    expect(screen.getByText(/Only completions from the last/)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(90);
  });

  it('applies a preset on click', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField(180);

    await user.click(screen.getByRole('button', { name: '1 year' }));

    expect(onChange).toHaveBeenCalledWith(365);
  });

  it('marks the matching preset as pressed', () => {
    renderField(365);

    expect(screen.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('treats a cleared day input as no window rather than zero', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField(180);

    await user.clear(screen.getByRole('spinbutton'));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
