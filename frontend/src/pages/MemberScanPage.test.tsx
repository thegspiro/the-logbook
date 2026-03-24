import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/utils";
import { MemberScanPage } from "./MemberScanPage";

// Mock html5-qrcode
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockGetCameras = vi.fn().mockResolvedValue([
  { id: "cam-1", label: "Front Camera" },
]);
vi.mock("html5-qrcode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("html5-qrcode")>();
  return {
    ...actual,
    Html5Qrcode: Object.assign(
      vi.fn().mockImplementation(function () {
        return { start: mockStart, stop: mockStop };
      }),
      { getCameras: (...args: unknown[]) => mockGetCameras(...args) as unknown },
    ),
  };
});

// Mock the API module
vi.mock("../services/api", () => ({
  userService: {
    getUsers: vi.fn().mockResolvedValue([]),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("MemberScanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCameras.mockResolvedValue([
      { id: "cam-1", label: "Front Camera" },
    ]);
  });

  it("should render the page title", () => {
    renderWithRouter(<MemberScanPage />);

    expect(screen.getByText("Scan Member ID")).toBeInTheDocument();
  });

  it("should render the back link to members", () => {
    renderWithRouter(<MemberScanPage />);

    const backLink = screen.getByRole("link", { name: /back to members/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/members");
  });

  it("should show the start scanning button initially", () => {
    renderWithRouter(<MemberScanPage />);

    expect(
      screen.getByRole("button", { name: /start scanning/i }),
    ).toBeInTheDocument();
  });

  it("should display instructions", () => {
    renderWithRouter(<MemberScanPage />);

    expect(screen.getByText("How to use")).toBeInTheDocument();
    expect(
      screen.getByText(/Point the camera at a member/),
    ).toBeInTheDocument();
  });

  it("should display the description text", () => {
    renderWithRouter(<MemberScanPage />);

    expect(
      screen.getByText(/Point your camera at a member/),
    ).toBeInTheDocument();
  });

  it("should show the scanner viewport container", () => {
    renderWithRouter(<MemberScanPage />);

    expect(screen.getByTestId("scanner-viewport")).toBeInTheDocument();
  });

  it("should show stop button after starting scanner", async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberScanPage />);

    const startButton = screen.getByRole("button", {
      name: /start scanning/i,
    });
    await user.click(startButton);

    expect(
      await screen.findByRole("button", { name: /stop scanning/i }),
    ).toBeInTheDocument();
  });

  it("should start scanner with camera device ID", async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberScanPage />);

    await user.click(
      screen.getByRole("button", { name: /start scanning/i }),
    );

    await waitFor(() => {
      expect(mockGetCameras).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(
        "cam-1",
        expect.any(Object),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  it("should show error when no cameras are found", async () => {
    mockGetCameras.mockResolvedValue([]);

    const user = userEvent.setup();
    renderWithRouter(<MemberScanPage />);

    await user.click(
      screen.getByRole("button", { name: /start scanning/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/No cameras found/i)).toBeInTheDocument();
    });
  });
});
