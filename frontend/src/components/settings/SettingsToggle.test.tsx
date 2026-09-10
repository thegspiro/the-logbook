/**
 * The switch has a name, and its hit target is 44px.
 *
 * Both of these were absent for as long as the component existed, and both were
 * found the same way: by putting the settings screens on the mobile passes
 * rather than exempting them.
 *
 * `label` was optional and documented as required "whenever no visible label is
 * tied to the switch". That is every call site — the text beside a switch here
 * is a sibling `<p>`, never a `<label htmlFor>` — and nine of fifteen omitted
 * it. axe reported `button-name (critical)`: a screen reader announced "switch,
 * not pressed" and nothing else. The prop is required now, so TypeScript is the
 * real guard; this pins the behaviour that makes the prop worth requiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsToggle } from './SettingsToggle';

describe('SettingsToggle', () => {
  it('exposes its label as the switch name', () => {
    render(<SettingsToggle label="Show Email Addresses" checked={false} onChange={vi.fn()} />);

    // By role and name — the query a screen-reader user's experience actually
    // corresponds to, and the one that fails when the name is missing.
    expect(screen.getByRole('switch', { name: 'Show Email Addresses' })).toBeInTheDocument();
  });

  it('reports its on/off state to assistive technology', () => {
    const { rerender } = render(<SettingsToggle label="Auto-Generate IDs" checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Auto-Generate IDs' })).toHaveAttribute('aria-checked', 'false');

    rerender(<SettingsToggle label="Auto-Generate IDs" checked onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Auto-Generate IDs' })).toHaveAttribute('aria-checked', 'true');
  });

  it('hands the handler the value being switched to, not the one it had', async () => {
    const onChange = vi.fn();
    render(<SettingsToggle label="Show Phone Numbers" checked={false} onChange={onChange} />);

    void (await userEvent.click(screen.getByRole('switch', { name: 'Show Phone Numbers' })));

    return vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  });

  it('does not fire while disabled', async () => {
    const onChange = vi.fn();
    render(<SettingsToggle label="Enable Email Notifications" checked={false} disabled onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Enable Email Notifications' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries the 44px hit-target utilities rather than the bare 24px pill', () => {
    // jsdom computes no layout, so the geometry itself is verified by the mobile
    // presentation pass against a real browser. What is checkable here is that
    // the switch still routes through `toggle-track-md` — the utility that
    // carries the transparent border and `bg-clip-padding` making the border box
    // 44px while the painted pill stays 24px. A call site that hand-rolled its
    // own classes again would lose that silently.
    render(<SettingsToggle label="Show Contact Information" checked={false} onChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'Show Contact Information' })).toHaveClass('toggle-track-md');
  });
});
