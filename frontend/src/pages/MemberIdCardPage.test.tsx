import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/utils";
import { MemberIdCardPage } from "./MemberIdCardPage";
import * as apiModule from "../services/api";

// Mock the API module
vi.mock("../services/api", () => ({
  userService: {
    getUserWithRoles: vi.fn(),
  },
  organizationService: {
    getProfile: vi.fn(),
  },
}));

// Mock react-router-dom
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ userId: "user-123" }),
  };
});

// Mock QRCodeSVG component
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value}>
      QR Code
    </div>
  ),
}));

// Mock JsBarcode
vi.mock("jsbarcode", () => ({
  default: vi.fn(),
}));

// Mock auth store
const mockCurrentUser = {
  id: "user-123",
  username: "jdoe",
  email: "jdoe@example.com",
  organization_id: "org-456",
  timezone: "America/New_York",
  roles: [],
  positions: [],
  rank: null,
  membership_type: "active",
  permissions: [],
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
};

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: mockCurrentUser,
    checkPermission: () => true,
  }),
}));

const mockMember = {
  id: "user-123",
  organization_id: "org-456",
  username: "jdoe",
  email: "jdoe@example.com",
  first_name: "John",
  last_name: "Doe",
  full_name: "John Doe",
  membership_number: "FD-0042",
  rank: "firefighter",
  station: "Station 1",
  status: "active",
  photo_url: null,
  hire_date: "2018-06-15",
  roles: [{ id: "r1", name: "Firefighter", is_system: false }],
};

const mockOrg = {
  name: "Springfield Fire Department",
  timezone: "America/New_York",
  phone: "555-0100",
  email: "info@springfieldfd.org",
  website: "https://springfieldfd.org",
  county: "Springfield County",
  founded_year: 1920,
  logo: null,
  mailing_address: {
    line1: "100 Main St",
    line2: "",
    city: "Springfield",
    state: "IL",
    zip: "62701",
  },
};

describe("MemberIdCardPage", () => {
  const { userService, organizationService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading State", () => {
    it("should display loading message initially", () => {
      vi.mocked(userService.getUserWithRoles).mockImplementation(
        () => new Promise(() => {}),
      );
      vi.mocked(organizationService.getProfile).mockImplementation(
        () => new Promise(() => {}),
      );

      renderWithRouter(<MemberIdCardPage />);

      expect(screen.getByText("Loading ID card...")).toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should display error message when API call fails", async () => {
      vi.mocked(userService.getUserWithRoles).mockRejectedValue(
        new Error("User not found"),
      );
      vi.mocked(organizationService.getProfile).mockRejectedValue(
        new Error("Org not found"),
      );

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("User not found")).toBeInTheDocument();
      });
    });

    it("should show back link when error occurs", async () => {
      vi.mocked(userService.getUserWithRoles).mockRejectedValue(
        new Error("Not found"),
      );
      vi.mocked(organizationService.getProfile).mockRejectedValue(
        new Error("Not found"),
      );

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const backLink = screen.getByRole("link", { name: /back to profile/i });
        expect(backLink).toBeInTheDocument();
        expect(backLink).toHaveAttribute("href", "/members/user-123");
      });
    });
  });

  describe("ID Card Display", () => {
    beforeEach(() => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        mockMember as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
    });

    it("should display member name", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });
    });

    it("should display membership number", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("FD-0042")).toBeInTheDocument();
      });
    });

    it("should display rank", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("Rank")).toBeInTheDocument();
        expect(screen.getByText("firefighter")).toBeInTheDocument();
      });
    });

    it("should display station", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("Station 1")).toBeInTheDocument();
      });
    });

    it("should display member since year from hire date", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("Member Since")).toBeInTheDocument();
        expect(screen.getByText("2018")).toBeInTheDocument();
      });
    });

    it("should display member status badge", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("active")).toBeInTheDocument();
      });
    });

    it("should display organization name", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Springfield Fire Department"),
        ).toBeInTheDocument();
      });
    });

    it("should display QR code with member data", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const qrCode = screen.getByTestId("qr-code");
        expect(qrCode).toBeInTheDocument();

        const qrValue = JSON.parse(
          qrCode.getAttribute("data-value") ?? "{}",
        ) as Record<string, unknown>;
        expect(qrValue).toEqual({
          type: "member_id",
          id: "user-123",
          membership_number: "FD-0042",
          org: "org-456",
        });
      });
    });

    it('should display "Member ID" header label', async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("Member ID")).toBeInTheDocument();
      });
    });

    it("should display scan hint text", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("Scan to identify member")).toBeInTheDocument();
      });
    });

    it("should show initials when no photo is available", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("J")).toBeInTheDocument();
      });
    });

    it("should render barcode container when membership number exists", async () => {
      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByTestId("barcode-container")).toBeInTheDocument();
        expect(screen.getByTestId("barcode")).toBeInTheDocument();
      });
    });

    it("should not render barcode when membership number is absent", async () => {
      const memberNoNumber = { ...mockMember, membership_number: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberNoNumber as never,
      );

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("barcode-container")).not.toBeInTheDocument();
    });

    it("should show photo when available", async () => {
      const memberWithPhoto = { ...mockMember, photo_url: "/photos/jdoe.jpg" };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberWithPhoto as never,
      );

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const img = screen.getByAltText("John Doe");
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute("src", "/photos/jdoe.jpg");
      });
    });
  });

  describe("Print Functionality", () => {
    it("should show print button", async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        mockMember as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const printButton = screen.getByRole("button", {
          name: /print id card/i,
        });
        expect(printButton).toBeInTheDocument();
      });
    });

    it("should call window.print when print button is clicked", async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        mockMember as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);
      const user = userEvent.setup();

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(async () => {
        const printButton = screen.getByRole("button", {
          name: /print id card/i,
        });
        await user.click(printButton);
      });

      expect(window.print).toHaveBeenCalled();
    });
  });

  describe("Navigation", () => {
    it("should display back to profile link", async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        mockMember as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const backLink = screen.getByRole("link", { name: /back to profile/i });
        expect(backLink).toBeInTheDocument();
        expect(backLink).toHaveAttribute("href", "/members/user-123");
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle member without membership number", async () => {
      const memberNoNumber = { ...mockMember, membership_number: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberNoNumber as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
        expect(screen.queryByText("Membership #")).not.toBeInTheDocument();
      });
    });

    it("should handle member without rank", async () => {
      const memberNoRank = { ...mockMember, rank: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberNoRank as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
        expect(screen.queryByText("Rank")).not.toBeInTheDocument();
      });
    });

    it("should handle member without hire date", async () => {
      const memberNoHireDate = { ...mockMember, hire_date: undefined };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberNoHireDate as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
        expect(screen.queryByText("Member Since")).not.toBeInTheDocument();
      });
    });

    it("should fall back to username when no full name is available", async () => {
      const memberNoName = {
        ...mockMember,
        full_name: undefined,
        first_name: undefined,
        last_name: undefined,
      };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        memberNoName as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(mockOrg);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        expect(screen.getByText("jdoe")).toBeInTheDocument();
      });
    });

    it("should show org logo when available", async () => {
      const orgWithLogo = { ...mockOrg, logo: "/logos/sfd.png" };
      vi.mocked(userService.getUserWithRoles).mockResolvedValue(
        mockMember as never,
      );
      vi.mocked(organizationService.getProfile).mockResolvedValue(orgWithLogo);

      renderWithRouter(<MemberIdCardPage />);

      await waitFor(() => {
        const logo = screen.getByAltText("Springfield Fire Department");
        expect(logo).toBeInTheDocument();
        expect(logo).toHaveAttribute("src", "/logos/sfd.png");
      });
    });
  });
});
