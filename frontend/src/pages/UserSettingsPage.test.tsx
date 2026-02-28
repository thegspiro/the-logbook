import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/utils";
import { UserSettingsPage } from "./UserSettingsPage";
import * as apiModule from "../services/api";

// Mock the API module
vi.mock("../services/api", () => ({
  authService: {
    changePassword: vi.fn().mockResolvedValue(undefined),
  },
  userService: {
    getUserWithRoles: vi.fn(),
    updateUserProfile: vi.fn(),
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
  },
}));

const defaultProfile = {
  id: "user-123",
  username: "jdoe",
  email: "jdoe@example.com",
  first_name: "John",
  last_name: "Doe",
  phone: "555-1234",
  mobile: "",
  membership_number: "FD-0042",
  rank: "firefighter",
  station: "Station 1",
  address_street: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  address_country: "USA",
  emergency_contacts: [],
  roles: [],
};

// Mock auth store
vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: {
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
    },
    loadUser: vi.fn(),
    checkPermission: () => false,
  }),
}));

// Mock theme context
vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
  }),
}));

// Mock useRanks hook
vi.mock("../hooks/useRanks", () => ({
  useRanks: () => ({
    rankOptions: [{ value: "firefighter", label: "Firefighter" }],
  }),
}));

// Mock react-hot-toast
vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("UserSettingsPage", () => {
  const { userService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.getUserWithRoles).mockResolvedValue(
      defaultProfile as never,
    );
    vi.mocked(userService.getNotificationPreferences).mockResolvedValue({
      email_notifications: true,
      event_reminders: true,
      training_reminders: true,
      announcement_notifications: true,
    });
  });

  it("should render the page title", () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText("User Settings")).toBeInTheDocument();
  });

  it("should render all tabs including Emergency Contacts", () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Emergency Contacts")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("should default to the Account tab", () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText("Account Information")).toBeInTheDocument();
  });

  describe("Emergency Contacts Tab", () => {
    it("should show empty state when no contacts exist", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByText("No emergency contacts on file."),
        ).toBeInTheDocument();
      });
    });

    it("should show Add Emergency Contact button in empty state", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });
    });

    it("should add a contact form when Add button is clicked", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", { name: /add emergency contact/i }),
      );

      expect(screen.getByText("Contact 1")).toBeInTheDocument();
      expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Phone/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Relationship/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    });

    it("should allow adding multiple contacts", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });

      // Add first contact
      await user.click(
        screen.getByRole("button", { name: /add emergency contact/i }),
      );
      expect(screen.getByText("Contact 1")).toBeInTheDocument();

      // Add second contact
      await user.click(
        screen.getByRole("button", { name: /add another contact/i }),
      );
      expect(screen.getByText("Contact 2")).toBeInTheDocument();
    });

    it("should allow removing a contact", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });

      // Add a contact
      await user.click(
        screen.getByRole("button", { name: /add emergency contact/i }),
      );
      expect(screen.getByText("Contact 1")).toBeInTheDocument();

      // Remove it
      const removeButton = screen.getByRole("button", {
        name: /remove contact 1/i,
      });
      await user.click(removeButton);

      // Should be back to empty state
      expect(
        screen.getByText("No emergency contacts on file."),
      ).toBeInTheDocument();
    });

    it("should display existing contacts from the profile", async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue({
        ...defaultProfile,
        emergency_contacts: [
          {
            name: "Jane Doe",
            relationship: "Spouse",
            phone: "555-5678",
            email: "jane@example.com",
            is_primary: true,
          },
        ],
      } as never);

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByText("Contact 1")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Jane Doe")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Spouse")).toBeInTheDocument();
        expect(screen.getByDisplayValue("555-5678")).toBeInTheDocument();
        expect(
          screen.getByDisplayValue("jane@example.com"),
        ).toBeInTheDocument();
      });
    });

    it("should show save button when contacts exist", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", { name: /add emergency contact/i }),
      );

      expect(
        screen.getByRole("button", { name: /save emergency contacts/i }),
      ).toBeInTheDocument();
    });

    it("should call API when saving contacts", async () => {
      vi.mocked(userService.updateUserProfile).mockResolvedValue({
        ...defaultProfile,
        emergency_contacts: [
          {
            name: "Jane Doe",
            relationship: "",
            phone: "555-5678",
            email: "",
            is_primary: true,
          },
        ],
      } as never);

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add emergency contact/i }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", { name: /add emergency contact/i }),
      );

      // Fill in the form
      const nameInput = screen.getByLabelText(/^Name/);
      const phoneInput = screen.getByLabelText(/^Phone/);

      await user.type(nameInput, "Jane Doe");
      await user.type(phoneInput, "555-5678");

      // Save
      await user.click(
        screen.getByRole("button", { name: /save emergency contacts/i }),
      );

      await waitFor(() => {
        expect(userService.updateUserProfile).toHaveBeenCalledWith(
          "user-123",
          {
            emergency_contacts: [
              {
                name: "Jane Doe",
                relationship: "",
                phone: "555-5678",
                email: "",
                is_primary: true,
              },
            ],
          },
        );
      });
    });

    it("should show description text on the emergency tab", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText("Emergency Contacts");
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(
          screen.getByText(
            /Add emergency contacts so your department can reach someone/,
          ),
        ).toBeInTheDocument();
      });
    });
  });
});
