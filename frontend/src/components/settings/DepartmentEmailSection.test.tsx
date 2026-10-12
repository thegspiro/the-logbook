/**
 * The Department Email settings section: it loads what is stored, refuses to
 * save "on" without a usable domain, normalizes what is typed, and saves only
 * when something changed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateDepartmentEmailSettings: (...args: unknown[]) => mockUpdate(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import DepartmentEmailSection from './DepartmentEmailSection';
import { domainError, normalizeDomain } from './departmentEmailDomain';

const save = () => screen.getByRole('button', { name: 'Save' });
const toggle = () => screen.getByRole('switch', { name: 'Create department email addresses' });
const domainBox = () => screen.getByLabelText('Domain');

describe('DepartmentEmailSection', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdate.mockReset();
    mockGetSettings.mockResolvedValue({
      contact_info_visibility: {},
      department_email: { enabled: false, domain: '', format: 'first.last' },
    });
    mockUpdate.mockImplementation((s: unknown) => Promise.resolve(s));
  });

  it('shows the stored settings and keeps Save disabled until something changes', async () => {
    mockGetSettings.mockResolvedValue({
      contact_info_visibility: {},
      department_email: { enabled: true, domain: 'firedept.org', format: 'flast' },
    });
    render(<DepartmentEmailSection />);

    await waitFor(() => expect(domainBox()).toHaveValue('firedept.org'));
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Address format')).toHaveValue('flast');
    expect(screen.getByText('jdoe@firedept.org')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('will not save "on" without a domain', async () => {
    const user = userEvent.setup();
    render(<DepartmentEmailSection />);
    await waitFor(() => expect(toggle()).toBeEnabled());

    await user.click(toggle());

    expect(screen.getByText(/Enter the domain/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('saves the normalized domain and the chosen format', async () => {
    const user = userEvent.setup();
    render(<DepartmentEmailSection />);
    await waitFor(() => expect(toggle()).toBeEnabled());

    await user.click(toggle());
    await user.type(domainBox(), '  @FireDept.org ');
    await user.selectOptions(screen.getByLabelText('Address format'), 'last.first');
    await user.click(save());

    expect(mockUpdate).toHaveBeenCalledWith({ enabled: true, domain: 'firedept.org', format: 'last.first' });
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('rejects a URL in place of a domain', async () => {
    const user = userEvent.setup();
    render(<DepartmentEmailSection />);
    await waitFor(() => expect(toggle()).toBeEnabled());

    await user.click(toggle());
    await user.type(domainBox(), 'https://firedept.org');

    expect(screen.getByText(/without "@" or "https:\/\/"/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('offers a retry when the settings fail to load', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<DepartmentEmailSection />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Domain')).toBeInTheDocument();
  });
});

describe('domain helpers', () => {
  it('normalizes what an admin types', () => {
    expect(normalizeDomain('  @@FireDept.ORG ')).toBe('firedept.org');
  });

  it('accepts a blank domain only while switched off', () => {
    expect(domainError('', false)).toBeNull();
    expect(domainError('', true)).not.toBeNull();
    expect(domainError('mail.firedept.org', true)).toBeNull();
    expect(domainError('firedept', true)).not.toBeNull();
  });
});
