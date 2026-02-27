import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/utils";
import { MemberScanPage } from "./MemberScanPage";

// Mock html5-qrcode
vi.mock("html5-qrcode", () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

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

    const viewport = document.getElementById("scanner-viewport");
    expect(viewport).toBeInTheDocument();
  });

  it("should show stop button after starting scanner", async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberScanPage />);

    const startButton = screen.getByRole("button", {
      name: /start scanning/i,
    });
    await user.click(startButton);

    expect(
      screen.getByRole("button", { name: /stop scanning/i }),
    ).toBeInTheDocument();
  });
});
