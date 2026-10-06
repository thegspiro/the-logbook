import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { MemberIdCardPage } from './MemberIdCardPage';
import * as apiModule from '../services/api';

// Mock the API module
vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: vi.fn(),
  },
  organizationService: {
    getProfile: vi.fn(),
  },
}));

// The card being opened and what the viewer holds; the viewer is user-123.
let routeUserId = 'user-123';
let grantedPermissions: string[] = [];

const BADGE = 'MB-23456789AB';
const mockGetBadge = vi.fn();
const mockReissue = vi.fn();
vi.mock('../services/memberBadgeService', () => ({
  memberBadgeService: {
    getBadge: (...args: unknown[]) => mockGetBadge(...args) as unknown,
    reissue: (...args: unknown[]) => mockReissue(...args) as unknown,
  },
}));

// Mock react-router
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useParams: () => ({ userId: routeUserId }),
  };
});

// Mock QRCodeSVG component
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value}>
      QR Code
    </div>
  ),
}));

// Mock JsBarcode
vi.mock('jsbarcode', () => ({
  default: vi.fn(),
}));

// Mock useTimezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock useRanks hook
vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    ranks: [
      { rank_code: 'firefighter', display_name: 'Firefighter' },
      { rank_code: 'emt', display_name: 'EMT' },
    ],
    rankOptions: [],
    loading: false,
    refetch: vi.fn(),
    formatRank: (code: string) => {
      const map: Record<string, string> = {
        firefighter: 'Firefighter',
        emt: 'EMT',
      };
      return map[code] ?? code.replace(/_/g, ' ');
    },
  }),
}));

// Mock auth store
const mockCurrentUser = {
  id: 'user-123',
  username: 'jdoe',
  email: 'jdoe@example.com',
  organization_id: 'org-456',
  timezone: 'America/New_York',
  roles: [],
  positions: [],
  rank: null,
  membership_type: 'active',
  permissions: [],
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
};

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: mockCurrentUser,
    checkPermission: (permission: string) => grantedPermissions.includes(permission),
  }),
}));

const mockMember = {
  id: 'user-123',
  organization_id: 'org-456',
  username: 'jdoe',
  email: 'jdoe@example.com',
  first_name: 'John',
  last_name: 'Doe',
  full_name: 'John Doe',
  membership_number: 'FD-0042',
  rank: 'firefighter',
  membership_type: 'active',
  station: 'Station 1',
  status: 'active',
  photo_url: null,
  hire_date: '2018-06-15',
  roles: [{ id: 'r1', name: 'Firefighter', is_system: false }],
};

const mockOrg = {
  name: 'Springfield Fire Department',
  timezone: 'America/New_York',
  phone: '555-0100',
  email: 'info@springfieldfd.org',
  website: 'https://springfieldfd.org',
  county: 'Springfield County',
  founded_year: 1920,
  logo: null,
  mailing_address: {
    line1: '100 Main St',
    line2: '',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
  },
  physical_address_same: true,
  physical_address: {
    line1: '100 Main St',
    line2: '',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
  },
};

describe('MemberIdCardPage', () => {
  const { userService, organizationService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    routeUserId = 'user-123';
    grantedPermissions = [];
    mockGetBadge.mockReset();
    mockGetBadge.mockImplementation((id: string) => Promise.resolve({ user_id: id, badge_code: BADGE }));
    mockReissue.mockReset();
  });

  describe('Loading State', () => {
    it('should display loading message initially', () => {
      vi.mocked(userService.getUserWithRoles).mockImplementation(() => new Promise(() => {}));
      vi.mocked(organizationService.getProfile).mockImplementation(() => new Promise(() => {}));

      renderWithRouter(<MemberIdCardPage />);

      expect(screen.getByText('Loading ID card...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when API call fails', async () => {
      vi.mocked(userService.getUserWithRoles).mockRejectedValue(new Error('User not found'));
      vi.mocked(organizationService.getProfile).mockRejectedValue(new Error('Org not found'));

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('User not found')).toBeInTheDocument();
      });
    });

    it('should show back link when error occurs', async () => {
      vi.mocked(userService.getUserWithRoles).mockRejectedValue(new Error('Not found'));
      vi.mocked(organizationService.getProfile).mockRejectedValue(new Error('Not found'));

      renderWithRouter(<MemberIdCardPage />);

      let backLink!: HTMLElement;
      await waitFor(() => {
        backLink = screen.getByRole('link', { name: /back to profile/i });
        expect(backLink).toBeInTheDocument();
      });
      expect(backLink).toHaveAttribute('href', '/members/user-123');
    });
  });

  describe('ID Card Display', () => {
    beforeEach(() => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
    });

    it('should display member name', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });
    });

    it('shows the name the member goes by, and its initial', async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue({
        ...mockMember,
        preferred_name: 'Terry',
        display_name: 'Terry Doe',
      } as never);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Terry Doe' })).toBeInTheDocument();
      });
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.getByText('T')).toBeInTheDocument();
    });

    it('should display membership number', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('FD-0042')).toBeInTheDocument();
      });
    });

    it('should display rank using display name', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Rank')).toBeInTheDocument();
        expect(screen.getByText('Firefighter')).toBeInTheDocument();
      });
    });

    it('should display administrative member class instead of a rank', async () => {
      const administrativeMember = {
        ...mockMember,
        rank: undefined,
        membership_type: 'administrative',
      };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(administrativeMember as never);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Member Class')).toBeInTheDocument();
        expect(screen.getByText('Administrative')).toBeInTheDocument();
      });
      expect(screen.queryByText('Rank')).not.toBeInTheDocument();
    });

    it('should display station', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Station 1')).toBeInTheDocument();
      });
    });

    it('should display member since year from hire date', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Member Since')).toBeInTheDocument();
        expect(screen.getByText('2018')).toBeInTheDocument();
      });
    });

    it('should display member status badge', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('active')).toBeInTheDocument();
      });
    });

    it('should display organization name', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Springfield Fire Department')).toBeInTheDocument();
      });
    });

    it('encodes the server-issued badge code in the QR, never the member id', async () => {
      renderWithRouter(<MemberIdCardPage />);

      const qrCode = await screen.findByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-value', BADGE);
      expect(qrCode.getAttribute('data-value')).not.toContain('user-123');
      expect(mockGetBadge).toHaveBeenCalledWith('user-123');
    });

    it('should display "Member ID" header label', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Member ID')).toBeInTheDocument();
      });
    });

    it('should display scan hint text', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('Scan to identify member')).toBeInTheDocument();
      });
    });

    it('should display generated date in footer', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText(/Generated /)).toBeInTheDocument();
      });
    });

    it('should show initials when no photo is available', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('J')).toBeInTheDocument();
      });
    });

    it('renders the barcode from the badge code, not the membership number', async () => {
      const { default: JsBarcode } = await import('jsbarcode');
      renderWithRouter(<MemberIdCardPage />);

      expect(await screen.findByTestId('barcode-container')).toBeInTheDocument();
      expect(screen.getByTestId('barcode')).toBeInTheDocument();
      expect(screen.getByTestId('badge-code')).toHaveTextContent(BADGE);
      expect(vi.mocked(JsBarcode)).toHaveBeenCalledWith(expect.anything(), BADGE, expect.any(Object));
      expect(vi.mocked(JsBarcode)).not.toHaveBeenCalledWith(expect.anything(), 'FD-0042', expect.anything());
    });

    it('still renders a scannable badge for a member without a membership number', async () => {
      const memberNoNumber = { ...mockMember, membership_number: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberNoNumber as never);

      renderWithRouter(<MemberIdCardPage />);

      expect(await screen.findByTestId('barcode-container')).toBeInTheDocument();
      expect(screen.queryByText('Membership #')).not.toBeInTheDocument();
    });

    it('should show photo when available', async () => {
      const memberWithPhoto = { ...mockMember, photo_url: '/photos/jdoe.jpg' };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberWithPhoto as never);

      renderWithRouter(<MemberIdCardPage />);

      let img!: HTMLElement;
      await waitFor(() => {
        img = screen.getByAltText('John Doe');
        expect(img).toBeInTheDocument();
      });
      expect(img).toHaveAttribute('src', '/photos/jdoe.jpg');
    });
  });

  describe('Print Functionality', () => {
    it('should show print button', async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const printButton = screen.getByRole('button', {
          name: /print id card/i,
        });
        expect(printButton).toBeInTheDocument();
      });
    });

    it('should call window.print when print button is clicked', async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
      const user = userEvent.setup();

      renderWithRouter(<MemberIdCardPage />);

      // Click outside waitFor — an async side effect inside a retried
      // waitFor callback can land in an abandoned retry and flake.
      const printButton = await screen.findByRole('button', {
        name: /print id card/i,
      });
      await user.click(printButton);

      // window.print() genuinely takes no arguments, so the zero-arg
      // toHaveBeenCalledWith() is the precise assertion here.
      expect(window.print).toHaveBeenCalledWith();
    });
  });

  describe('Navigation', () => {
    it('should display back to profile link', async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      let backLink!: HTMLElement;
      await waitFor(() => {
        backLink = screen.getByRole('link', { name: /back to profile/i });
        expect(backLink).toBeInTheDocument();
      });
      expect(backLink).toHaveAttribute('href', '/members/user-123');
    });
  });

  describe('Edge Cases', () => {
    it('should handle member without membership number', async () => {
      const memberNoNumber = { ...mockMember, membership_number: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberNoNumber as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.queryByText('Membership #')).not.toBeInTheDocument();
      });
    });

    it('should handle member without rank', async () => {
      const memberNoRank = { ...mockMember, rank: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberNoRank as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.queryByText('Rank')).not.toBeInTheDocument();
      });
    });

    it('should handle member without hire date', async () => {
      const memberNoHireDate = { ...mockMember, hire_date: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberNoHireDate as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.queryByText('Member Since')).not.toBeInTheDocument();
      });
    });

    it('should fall back to username when no full name is available', async () => {
      const memberNoName = {
        ...mockMember,
        full_name: undefined,
        first_name: undefined,
        last_name: undefined,
      };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(memberNoName as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText('jdoe')).toBeInTheDocument();
      });
    });

    it('should show org logo when available', async () => {
      const orgWithLogo = { ...mockOrg, logo: '/logos/sfd.png' };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockResolvedValue(orgWithLogo);

      renderWithRouter(<MemberIdCardPage />);

      let logo!: HTMLElement;
      await waitFor(() => {
        logo = screen.getByAltText('Springfield Fire Department');
        expect(logo).toBeInTheDocument();
      });
      expect(logo).toHaveAttribute('src', '/logos/sfd.png');
    });
  });
  describe('Access to another member card', () => {
    beforeEach(() => {
      routeUserId = 'someone-else';
      vi.mocked(userService.getUserWithRoles).mockReset();
      vi.mocked(userService.getUserWithRoles).mockResolvedValue({ ...mockMember, id: 'someone-else' } as never);
      vi.mocked(organizationService.getProfile).mockReset();
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
    });

    it('refuses a plain member and never fetches the colleague', async () => {
      grantedPermissions = ['members.view', 'users.view', 'members.check_in'];
      renderWithRouter(<MemberIdCardPage />);

      expect(await screen.findByText('You can only view your own ID card.')).toBeInTheDocument();
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
      expect(screen.queryByTestId('barcode-container')).not.toBeInTheDocument();
      expect(userService.getUserWithRoles).not.toHaveBeenCalled();
      expect(mockGetBadge).not.toHaveBeenCalled();
    });

    it.each(['members.manage', 'members.manage_id_cards'])('shows the card to a holder of %s', async (permission) => {
      grantedPermissions = [permission];
      renderWithRouter(<MemberIdCardPage />);

      expect(await screen.findByTestId('qr-code')).toBeInTheDocument();
      expect(userService.getUserWithRoles).toHaveBeenCalledWith('someone-else');
    });
  });
  describe('Reissuing a badge', () => {
    beforeEach(() => {
      vi.mocked(userService.getUserWithRoles).mockReset();
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(mockMember as never);
      vi.mocked(organizationService.getProfile).mockReset();
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
      mockReissue.mockResolvedValue({ user_id: 'user-123', badge_code: 'MB-ZZZZZZZZZZ' });
    });

    it('is not offered to a member viewing their own card', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await screen.findByTestId('barcode-container');
      expect(screen.queryByRole('button', { name: /Reissue badge/ })).not.toBeInTheDocument();
    });

    it('lets a badge officer replace the code after confirming', async () => {
      grantedPermissions = ['members.manage_id_cards'];
      const user = userEvent.setup();
      renderWithRouter(<MemberIdCardPage />);

      await user.click(await screen.findByRole('button', { name: /Reissue badge/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reissue badge' }));

      expect(mockReissue).toHaveBeenCalledWith('user-123');
      expect(await screen.findByTestId('badge-code')).toHaveTextContent('MB-ZZZZZZZZZZ');
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', 'MB-ZZZZZZZZZZ');
    });

    it('keeps the current code when the officer backs out', async () => {
      grantedPermissions = ['members.manage'];
      const user = userEvent.setup();
      renderWithRouter(<MemberIdCardPage />);

      await user.click(await screen.findByRole('button', { name: /Reissue badge/ }));
      await user.click(await screen.findByRole('button', { name: 'Keep current badge' }));

      expect(mockReissue).not.toHaveBeenCalled();
      expect(screen.getByTestId('badge-code')).toHaveTextContent(BADGE);
    });
  });
});
