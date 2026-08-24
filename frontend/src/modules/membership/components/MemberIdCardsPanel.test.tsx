import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockList = vi.fn();
const mockRegister = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockIsConnected = vi.fn();

vi.mock('../services/nfcCardService', () => ({
  nfcCardService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    register: (...args: unknown[]) => mockRegister(...args) as unknown,
    update: (...args: unknown[]) => mockUpdate(...args) as unknown,
    remove: (...args: unknown[]) => mockRemove(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => mockIsConnected(type) as boolean,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { MemberIdCardsPanel } from './MemberIdCardsPanel';

const card = {
  id: 'card-1',
  organizationId: 'org-1',
  userId: 'u1',
  uidPreview: '245B',
  credentialType: 'serial' as const,
  label: 'Blue ID card',
  status: 'active' as const,
  issuedAt: '2026-08-01T12:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  revokedReason: null,
  issuedBy: 'admin-1',
  createdAt: '2026-08-01T12:00:00Z',
  updatedAt: '2026-08-01T12:00:00Z',
  memberName: 'Dana Ruiz',
  issuedByName: 'Chief Ellis',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ items: [card], total: 1 });
  mockIsConnected.mockReturnValue(true);
  mockRegister.mockResolvedValue(card);
  mockUpdate.mockResolvedValue({ ...card, status: 'suspended' });
  mockRemove.mockResolvedValue(undefined);
});

describe('MemberIdCardsPanel', () => {
  it('shows a card by its label and the tail of its serial', async () => {
    renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    expect(await screen.findByText('Blue ID card')).toBeInTheDocument();
    expect(screen.getByText(/…245B/)).toBeInTheDocument();
  });

  it('renders nothing at all while the organization has cards turned off', async () => {
    // An empty "ID Cards" panel would read as "none issued", which is a
    // different statement from "this department does not use cards".
    mockIsConnected.mockReturnValue(false);
    const { container } = renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(mockList).not.toHaveBeenCalled());
  });

  it('registers a typed serial without sending a blank label', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberIdCardsPanel userId="u1" memberName="Dana Ruiz" />);
    await screen.findByText('Blue ID card');

    await user.click(screen.getByRole('button', { name: /issue card/i }));
    await user.type(screen.getByLabelText(/card serial number/i), '04a2245b7c1180');
    await user.click(screen.getByRole('button', { name: /register card/i }));

    // Create payload: a blank optional field is omitted rather than sent as "",
    // which a Pydantic validator would reject with a 422.
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        user_id: 'u1',
        tag_uid: '04A2245B7C1180',
        credential_type: 'serial',
        label: undefined,
      })
    );
  });

  it('refuses to register something that is not a card serial', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    await screen.findByText('Blue ID card');

    await user.click(screen.getByRole('button', { name: /issue card/i }));
    await user.type(screen.getByLabelText(/card serial number/i), '4');
    await user.click(screen.getByRole('button', { name: /register card/i }));

    expect(await screen.findByText(/no card has been read yet/i)).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('suspends a card', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    await screen.findByText('Blue ID card');

    await user.click(screen.getByRole('button', { name: /suspend/i }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('card-1', {
        status: 'suspended',
        revoked_reason: 'Suspended by an officer',
      })
    );
  });

  it('asks before reporting a card lost', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    await screen.findByText('Blue ID card');

    await user.click(screen.getByRole('button', { name: /^lost$/i }));

    // Reporting lost is terminal — the card can never be reactivated — so it
    // goes through the app's confirm dialog rather than firing on one tap.
    expect(await screen.findByText(/report this card lost\?/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^report lost$/i }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('card-1', { status: 'lost', revoked_reason: 'Reported lost' })
    );
  });

  it('surfaces a duplicate-card refusal in the dialog', async () => {
    const user = userEvent.setup();
    mockRegister.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'This card is already registered to another member.' } },
    });
    renderWithRouter(<MemberIdCardsPanel userId="u1" />);
    await screen.findByText('Blue ID card');

    await user.click(screen.getByRole('button', { name: /issue card/i }));
    await user.type(screen.getByLabelText(/card serial number/i), '04a2245b7c1180');
    await user.click(screen.getByRole('button', { name: /register card/i }));

    expect(await screen.findByText(/already registered to another member/i)).toBeInTheDocument();
  });
});
