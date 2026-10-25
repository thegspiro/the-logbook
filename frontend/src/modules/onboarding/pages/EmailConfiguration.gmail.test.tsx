/**
 * The onboarding email step carries the same Gmail guidance as Settings →
 * Email: each note names a way an App Password stops sending with nothing in
 * The Logbook having changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import EmailConfiguration from './EmailConfiguration';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { GMAIL_SENDING_NOTES } from '@/constants/gmailSendingGuidance';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <EmailConfiguration />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('EmailConfiguration — Gmail sending guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists every Gmail note when Gmail is the platform', () => {
    useOnboardingStore.setState({ departmentName: 'Test FD', emailPlatform: 'gmail' });

    renderPage();

    for (const note of GMAIL_SENDING_NOTES) {
      expect(screen.getByText(note)).toBeInTheDocument();
    }
  });

  it('does not show the Gmail notes for another platform', () => {
    useOnboardingStore.setState({ departmentName: 'Test FD', emailPlatform: 'microsoft' });

    renderPage();

    expect(screen.queryByText(/revokes all of its App Passwords/i)).not.toBeInTheDocument();
  });
});
