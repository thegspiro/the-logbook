/**
 * Accessibility tests for the public legal pages (privacy / terms).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) as unknown },
}));

import LegalPage from './LegalPage';

describe('LegalPage accessibility', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Test FD',
        privacyPolicy: null,
        termsOfService: null,
      },
    });
  });

  it('privacy policy page has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/privacy']}>
        <LegalPage />
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('terms page has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/terms']}>
        <LegalPage />
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'Terms of Service' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
