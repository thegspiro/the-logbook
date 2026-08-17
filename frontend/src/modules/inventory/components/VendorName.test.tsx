import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VendorName } from './VendorName';

describe('VendorName', () => {
  it('prints a linked vendor in the primary text colour', () => {
    render(<VendorName record={{ vendor_name: 'Galls', vendor: 'galls inc' }} />);
    const name = screen.getByText('Galls');
    expect(name).toHaveClass('text-theme-text-primary');
    expect(name).not.toHaveClass('italic');
  });

  it('mutes a name that is only typed text', () => {
    render(<VendorName record={{ vendor: 'Corner Medical Supply' }} />);
    const name = screen.getByText(/Corner Medical Supply/);
    expect(name).toHaveClass('text-theme-text-muted');
    expect(name).toHaveClass('italic');
  });

  it('says why it is muted for anyone who cannot see the styling', () => {
    render(<VendorName record={{ vendor: 'Corner Medical Supply' }} />);
    expect(screen.getByText('(not on the vendor list)')).toBeInTheDocument();
  });

  it('does not mark a linked vendor as missing from the list', () => {
    render(<VendorName record={{ vendor_name: 'Galls' }} />);
    expect(screen.queryByText('(not on the vendor list)')).not.toBeInTheDocument();
  });

  it('shows the fallback when no vendor is named at all', () => {
    render(<VendorName record={{}} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('accepts a caller-supplied fallback', () => {
    render(<VendorName record={{}} fallback="--" />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });
});
