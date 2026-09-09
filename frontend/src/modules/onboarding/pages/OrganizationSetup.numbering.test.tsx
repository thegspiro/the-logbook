/**
 * Step 1 asks whether members carry numbers.
 *
 * The question is asked here and not on a members screen because the counter
 * only numbers members created after it is switched on: the System Owner is
 * created eight steps from here and the IT team nine, so a department that
 * answered later ended up with its first accounts holding no number and the
 * roster import starting at the number they should have had.
 *
 * This asserts the control is on the screen and reveals what it promises. What
 * the answer becomes on the wire is `memberNumbering.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/api-client', () => ({ apiClient: { saveOrganization: vi.fn() } }));
const saveOrganization = vi.fn();
vi.mock('../hooks/useOnboardingSession', () => ({
  useOnboardingSession: () => ({
    hasSession: true,
    isLoading: false,
    initializeSession: () => Promise.resolve(),
    saveOrganization: (...args: unknown[]) => saveOrganization(...args) as unknown,
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import OrganizationSetup from './OrganizationSetup';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const openIdentifiers = async () => {
  render(
    <ThemeProvider>
      <OrganizationSetup />
    </ThemeProvider>
  );
  // The identifiers panel is collapsed on arrival, like every other section.
  await userEvent.click(screen.getByRole('button', { name: /department identifiers/i }));
};

describe('OrganizationSetup — member numbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks whether members carry numbers', async () => {
    await openIdentifiers();

    expect(screen.getByLabelText(/our members have member numbers/i)).toBeInTheDocument();
  });

  it('does not ask for a prefix until the department says it numbers members', async () => {
    // A department that identifies members by name should not be shown a
    // sequence to configure.
    await openIdentifiers();

    expect(screen.queryByLabelText(/^prefix$/i)).not.toBeInTheDocument();
  });

  it('asks for the prefix and the starting number once it does', async () => {
    await openIdentifiers();

    await userEvent.click(screen.getByLabelText(/our members have member numbers/i));

    expect(screen.getByLabelText(/^prefix$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start numbering at/i)).toBeInTheDocument();
  });
});
