import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';

/**
 * Custom render function that wraps components with common providers
 */
export function renderWithRouter(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return <BrowserRouter>{children}</BrowserRouter>;
  };

  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * Mock event data for testing
 */
export const mockEvent = {
  id: '1',
  name: 'Test Event',
  description: 'Test event description',
  event_type: 'business_meeting',
  location: 'Test Location',
  start_datetime: '2026-01-25T18:00:00Z',
  end_datetime: '2026-01-25T20:00:00Z',
  organization_id: '1',
  created_by_id: '1',
  requires_rsvp: true,
  capacity: 50,
  is_mandatory: false,
  is_cancelled: false,
  allowed_rsvp_statuses: ['going', 'not_going'],
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

/**
 * Mock QR check-in data
 */
export const mockQRCheckInData = {
  event_id: '1',
  event_name: 'Test Event',
  event_type: 'business_meeting',
  location: 'Test Location',
  start_datetime: '2026-01-25T18:00:00Z',
  end_datetime: '2026-01-25T20:00:00Z',
  check_in_start: '2026-01-25T17:00:00Z',
  check_in_end: '2026-01-25T20:00:00Z',
  is_valid: true,
  actual_end_time: null,
};

/**
 * Mock RSVP data
 */
export const mockRSVP = {
  id: '1',
  event_id: '1',
  user_id: '1',
  status: 'going',
  guest_count: 0,
  checked_in: true,
  checked_in_at: '2026-01-25T18:15:00Z',
  attendance_duration_minutes: null,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-25T18:15:00Z',
};

/**
 * Mock user data
 */
export const mockUser = {
  id: '1',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  organization_id: '1',
  roles: [],
};

/**
 * Create a mock API response
 */
export function createMockApiResponse<T>(data: T, delay = 0) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(data), delay);
  });
}

/**
 * Create a mock API error
 */
export function createMockApiError(message: string, status = 400, delay = 0) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error: any = new Error(message);
      error.response = {
        data: { detail: message },
        status,
      };
      reject(error);
    }, delay);
  });
}

/**
 * Mock navigation
 */
export const mockNavigate = vi.fn();
export const mockUseParams = vi.fn();

/**
 * Mock event service
 */
export const createMockEventService = () => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  cancelEvent: vi.fn(),
  getQRCheckInData: vi.fn(),
  selfCheckIn: vi.fn(),
  checkInAttendee: vi.fn(),
  getEligibleMembers: vi.fn(),
  createOrUpdateRSVP: vi.fn(),
  recordActualTimes: vi.fn(),
});

/**
 * Wait for async operations
 */
export const waitFor = (callback: () => void, timeout = 1000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      try {
        callback();
        clearInterval(interval);
        resolve(true);
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          reject(error);
        }
      }
    }, 50);
  });
};
