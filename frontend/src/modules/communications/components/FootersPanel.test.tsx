import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetFooters = vi.fn();
const mockUpdateFooters = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getFooters: (...args: unknown[]) => mockGetFooters(...args) as unknown,
    updateFooters: (...args: unknown[]) => mockUpdateFooters(...args) as unknown,
  },
}));

// Imported after the mock so the store binds to it.
import FootersPanel from './FootersPanel';
import { useFootersStore } from '../store/footersStore';
import { renderWithRouter } from '../../../test/utils';
import type { EmailFooter } from '../types';

const makeFooter = (overrides: Partial<EmailFooter> = {}): EmailFooter => ({
  key: 'internal',
  name: 'Internal — members',
  description: 'Routine automated mail to members.',
  lines: ['This is an automated message from {{organization_name}}.'],
  show_contact: true,
  show_mailing_address: false,
  ...overrides,
});

const library = (footers: EmailFooter[], defaultKey = 'internal', usage: Record<string, number> = {}) => ({
  default_key: defaultKey,
  footers,
  variables: [{ name: 'organization_name', description: 'Organization name' }],
  usage,
});

describe('FootersPanel', () => {
  beforeEach(() => {
    useFootersStore.setState({
      footers: [],
      defaultKey: '',
      variables: [],
      usage: {},
      isLoading: false,
      isSaving: false,
      error: null,
      hasLoaded: false,
    });
    vi.clearAllMocks();
  });

  it('lists each footer with its lines and marks the default', async () => {
    mockGetFooters.mockResolvedValue(
      library([makeFooter(), makeFooter({ key: 'public', name: 'Public', lines: ['Sent by us.'] })])
    );

    renderWithRouter(<FootersPanel />);

    expect(await screen.findByDisplayValue('Internal — members')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Public')).toBeInTheDocument();
    expect(screen.getByDisplayValue('This is an automated message from {{organization_name}}.')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make default' })).toBeInTheDocument();
  });

  it('says how many templates close with each footer, so deleting one is an informed choice', async () => {
    mockGetFooters.mockResolvedValue(
      library([makeFooter(), makeFooter({ key: 'public', name: 'Public' })], 'internal', {
        internal: 30,
        public: 1,
      })
    );

    renderWithRouter(<FootersPanel />);

    expect(await screen.findByText('30 templates close with this footer.')).toBeInTheDocument();
    expect(screen.getByText('1 template closes with this footer.')).toBeInTheDocument();
  });

  it('refuses to save a duplicate key rather than letting the backend reject it', async () => {
    const user = userEvent.setup();
    mockGetFooters.mockResolvedValue(library([makeFooter(), makeFooter({ key: 'public', name: 'Public' })]));

    renderWithRouter(<FootersPanel />);
    await screen.findByDisplayValue('Public');

    // By its current value rather than by index — the label reads "Key" on
    // every card, so an index would silently follow a reordering.
    const secondKeyInput = screen.getByDisplayValue('public');
    await user.clear(secondKeyInput);
    await user.type(secondKeyInput, 'internal');

    // Flagged on both cards — neither one is "the" duplicate.
    expect(await screen.findAllByText('Another footer already uses this key.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(mockUpdateFooters).not.toHaveBeenCalled();
  });

  it('rejects a key the backend pattern would not accept', async () => {
    const user = userEvent.setup();
    mockGetFooters.mockResolvedValue(library([makeFooter()]));

    renderWithRouter(<FootersPanel />);
    await screen.findByDisplayValue('Internal — members');

    const keyInput = screen.getByLabelText('Key');
    await user.clear(keyInput);
    await user.type(keyInput, 'Not A Key');

    expect(await screen.findByText(/lowercase letters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('saves the whole library, default included', async () => {
    const user = userEvent.setup();
    mockGetFooters.mockResolvedValue(library([makeFooter(), makeFooter({ key: 'public', name: 'Public' })]));
    mockUpdateFooters.mockResolvedValue(library([makeFooter()], 'public'));

    renderWithRouter(<FootersPanel />);
    await screen.findByDisplayValue('Public');

    await user.click(screen.getByRole('button', { name: 'Make default' }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateFooters).toHaveBeenCalledTimes(1));
    const payload = mockUpdateFooters.mock.calls[0]?.[0] as {
      default_key: string;
      footers: EmailFooter[];
    };
    expect(payload.default_key).toBe('public');
    expect(payload.footers).toHaveLength(2);
  });

  it('keeps the default pointing at a footer whose key was renamed', async () => {
    // Otherwise the save is rejected for naming a footer that no longer exists.
    const user = userEvent.setup();
    mockGetFooters.mockResolvedValue(library([makeFooter()]));
    mockUpdateFooters.mockResolvedValue(library([makeFooter({ key: 'members' })], 'members'));

    renderWithRouter(<FootersPanel />);
    await screen.findByDisplayValue('Internal — members');

    const keyInput = screen.getByLabelText('Key');
    await user.clear(keyInput);
    await user.type(keyInput, 'members');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateFooters).toHaveBeenCalledTimes(1));
    const payload = mockUpdateFooters.mock.calls[0]?.[0] as { default_key: string };
    expect(payload.default_key).toBe('members');
  });

  it('will not let the default footer be deleted', async () => {
    mockGetFooters.mockResolvedValue(library([makeFooter(), makeFooter({ key: 'public', name: 'Public' })]));

    renderWithRouter(<FootersPanel />);
    await screen.findByDisplayValue('Public');

    expect(screen.getByRole('button', { name: 'Delete footer Internal — members' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete footer Public' })).toBeEnabled();
  });
});
