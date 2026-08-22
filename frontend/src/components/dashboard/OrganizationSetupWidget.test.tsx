import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrganizationSetupWidget from './OrganizationSetupWidget';

describe('OrganizationSetupWidget', () => {
  it('does not render after setup is complete', () => {
    const { container } = render(<OrganizationSetupWidget completed={8} total={8} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders progress while work remains', () => {
    render(<OrganizationSetupWidget completed={3} total={8} onOpen={vi.fn()} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByRole('button', { name: 'Continue setup' })).toBeInTheDocument();
  });
});
