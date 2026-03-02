import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getEventTypeLabel,
  getEventTypeBadgeColor,
  getRSVPStatusLabel,
  getRSVPStatusColor,
  getExpirationStatus,
  getProgressBarColor,
} from './eventHelpers';
import type { RSVPStatus } from '../types/event';

describe('eventHelpers', () => {
  // ---- getEventTypeLabel ----

  describe('getEventTypeLabel', () => {
    it('returns "Business Meeting" for business_meeting', () => {
      expect(getEventTypeLabel('business_meeting')).toBe('Business Meeting');
    });

    it('returns "Public Education" for public_education', () => {
      expect(getEventTypeLabel('public_education')).toBe('Public Education');
    });

    it('returns "Training" for training', () => {
      expect(getEventTypeLabel('training')).toBe('Training');
    });

    it('returns "Social" for social', () => {
      expect(getEventTypeLabel('social')).toBe('Social');
    });

    it('returns "Fundraiser" for fundraiser', () => {
      expect(getEventTypeLabel('fundraiser')).toBe('Fundraiser');
    });

    it('returns "Ceremony" for ceremony', () => {
      expect(getEventTypeLabel('ceremony')).toBe('Ceremony');
    });

    it('returns "Other" for other', () => {
      expect(getEventTypeLabel('other')).toBe('Other');
    });

    it('returns the input string as-is for unknown event types', () => {
      expect(getEventTypeLabel('unknown_type')).toBe('unknown_type');
    });

    it('returns an empty string as-is for empty string input', () => {
      expect(getEventTypeLabel('')).toBe('');
    });
  });

  // ---- getEventTypeBadgeColor ----

  describe('getEventTypeBadgeColor', () => {
    it('returns blue classes for business_meeting', () => {
      const result = getEventTypeBadgeColor('business_meeting');
      expect(result).toContain('bg-blue-100');
      expect(result).toContain('text-blue-800');
    });

    it('returns green classes for public_education', () => {
      const result = getEventTypeBadgeColor('public_education');
      expect(result).toContain('bg-green-100');
      expect(result).toContain('text-green-800');
    });

    it('returns purple classes for training', () => {
      const result = getEventTypeBadgeColor('training');
      expect(result).toContain('bg-purple-100');
      expect(result).toContain('text-purple-800');
    });

    it('returns pink classes for social', () => {
      const result = getEventTypeBadgeColor('social');
      expect(result).toContain('bg-pink-100');
      expect(result).toContain('text-pink-800');
    });

    it('returns yellow classes for fundraiser', () => {
      const result = getEventTypeBadgeColor('fundraiser');
      expect(result).toContain('bg-yellow-100');
      expect(result).toContain('text-yellow-800');
    });

    it('returns indigo classes for ceremony', () => {
      const result = getEventTypeBadgeColor('ceremony');
      expect(result).toContain('bg-indigo-100');
      expect(result).toContain('text-indigo-800');
    });

    it('returns gray classes for other', () => {
      const result = getEventTypeBadgeColor('other');
      expect(result).toContain('bg-gray-100');
      expect(result).toContain('text-gray-800');
    });

    it('returns gray fallback classes for unknown event types', () => {
      const result = getEventTypeBadgeColor('nonexistent');
      expect(result).toContain('bg-gray-100');
      expect(result).toContain('text-gray-800');
    });

    it('includes dark mode classes for known types', () => {
      const result = getEventTypeBadgeColor('training');
      expect(result).toContain('dark:bg-purple-500/20');
      expect(result).toContain('dark:text-purple-400');
    });

    it('includes dark mode classes in the fallback for unknown types', () => {
      const result = getEventTypeBadgeColor('mystery');
      expect(result).toContain('dark:bg-gray-500/20');
      expect(result).toContain('dark:text-gray-300');
    });
  });

  // ---- getRSVPStatusLabel ----

  describe('getRSVPStatusLabel', () => {
    it('returns "Going" for going status', () => {
      expect(getRSVPStatusLabel('going')).toBe('Going');
    });

    it('returns "Not Going" for not_going status', () => {
      expect(getRSVPStatusLabel('not_going')).toBe('Not Going');
    });

    it('returns "Maybe" for maybe status', () => {
      expect(getRSVPStatusLabel('maybe')).toBe('Maybe');
    });
  });

  // ---- getRSVPStatusColor ----

  describe('getRSVPStatusColor', () => {
    it('returns green classes for going status', () => {
      const result = getRSVPStatusColor('going');
      expect(result).toContain('bg-green-100');
      expect(result).toContain('text-green-800');
    });

    it('returns red classes for not_going status', () => {
      const result = getRSVPStatusColor('not_going');
      expect(result).toContain('bg-red-100');
      expect(result).toContain('text-red-800');
    });

    it('returns yellow classes for maybe status', () => {
      const result = getRSVPStatusColor('maybe');
      expect(result).toContain('bg-yellow-100');
      expect(result).toContain('text-yellow-800');
    });

    it('includes dark mode classes for all RSVP statuses', () => {
      const statuses: RSVPStatus[] = ['going', 'not_going', 'maybe'];
      for (const status of statuses) {
        const result = getRSVPStatusColor(status);
        expect(result).toMatch(/dark:/);
      }
    });
  });

  // ---- getExpirationStatus ----

  describe('getExpirationStatus', () => {
    beforeEach(() => {
      // Pin "today" to 2026-06-15T00:00:00.000Z for deterministic tests
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Expired" with red color for past dates', () => {
      const result = getExpirationStatus('2026-06-14');
      expect(result.status).toBe('Expired');
      expect(result.color).toContain('text-red-600');
      expect(result.color).toContain('bg-red-50');
    });

    it('returns "Expired" for a date far in the past', () => {
      const result = getExpirationStatus('2020-01-01');
      expect(result.status).toBe('Expired');
      expect(result.color).toContain('text-red-600');
    });

    it('returns red color with days count for expiration within 30 days', () => {
      // 15 days from now: 2026-06-30
      const result = getExpirationStatus('2026-06-30');
      expect(result.status).toBe('15 days');
      expect(result.color).toContain('text-red-600');
      expect(result.color).toContain('bg-red-50');
    });

    it('returns red color with "0 days" for expiration today (edge case)', () => {
      const result = getExpirationStatus('2026-06-15');
      expect(result.status).toBe('0 days');
      expect(result.color).toContain('text-red-600');
      expect(result.color).toContain('bg-red-50');
    });

    it('returns red color for exactly 30 days until expiry', () => {
      const result = getExpirationStatus('2026-07-15');
      expect(result.status).toBe('30 days');
      expect(result.color).toContain('text-red-600');
    });

    it('returns yellow color for expiration within 31-60 days', () => {
      // 45 days from now: 2026-07-30
      const result = getExpirationStatus('2026-07-30');
      expect(result.status).toBe('45 days');
      expect(result.color).toContain('text-yellow-600');
      expect(result.color).toContain('bg-yellow-50');
    });

    it('returns yellow color for exactly 60 days until expiry', () => {
      const result = getExpirationStatus('2026-08-14');
      expect(result.status).toBe('60 days');
      expect(result.color).toContain('text-yellow-600');
    });

    it('returns green color for expiration more than 60 days away', () => {
      // 90 days from now: 2026-09-13
      const result = getExpirationStatus('2026-09-13');
      expect(result.status).toBe('90 days');
      expect(result.color).toContain('text-green-600');
      expect(result.color).toContain('bg-green-50');
    });

    it('returns green color for exactly 61 days until expiry', () => {
      const result = getExpirationStatus('2026-08-15');
      expect(result.status).toBe('61 days');
      expect(result.color).toContain('text-green-600');
    });

    it('returns green color for far-future dates', () => {
      const result = getExpirationStatus('2030-12-31');
      expect(result.color).toContain('text-green-600');
      expect(result.status).toMatch(/\d+ days/);
    });
  });

  // ---- getProgressBarColor ----

  describe('getProgressBarColor', () => {
    it('returns green for 75% and above', () => {
      expect(getProgressBarColor(75)).toBe('bg-green-500');
      expect(getProgressBarColor(100)).toBe('bg-green-500');
      expect(getProgressBarColor(99)).toBe('bg-green-500');
    });

    it('returns blue for 50% to 74%', () => {
      expect(getProgressBarColor(50)).toBe('bg-blue-500');
      expect(getProgressBarColor(74)).toBe('bg-blue-500');
      expect(getProgressBarColor(60)).toBe('bg-blue-500');
    });

    it('returns yellow for 25% to 49%', () => {
      expect(getProgressBarColor(25)).toBe('bg-yellow-500');
      expect(getProgressBarColor(49)).toBe('bg-yellow-500');
      expect(getProgressBarColor(30)).toBe('bg-yellow-500');
    });

    it('returns red for below 25%', () => {
      expect(getProgressBarColor(0)).toBe('bg-red-500');
      expect(getProgressBarColor(24)).toBe('bg-red-500');
      expect(getProgressBarColor(10)).toBe('bg-red-500');
    });

    it('handles boundary values precisely', () => {
      expect(getProgressBarColor(24.9)).toBe('bg-red-500');
      expect(getProgressBarColor(25)).toBe('bg-yellow-500');
      expect(getProgressBarColor(49.9)).toBe('bg-yellow-500');
      expect(getProgressBarColor(50)).toBe('bg-blue-500');
      expect(getProgressBarColor(74.9)).toBe('bg-blue-500');
      expect(getProgressBarColor(75)).toBe('bg-green-500');
    });

    it('handles negative percentages by returning red', () => {
      expect(getProgressBarColor(-10)).toBe('bg-red-500');
    });

    it('handles percentages over 100 by returning green', () => {
      expect(getProgressBarColor(150)).toBe('bg-green-500');
    });
  });
});
