/**
 * Event Helper Utilities
 *
 * Centralized helper functions for event-related operations
 * including type labels, status colors, and badge styling.
 */

import type { RSVPStatus } from '../types/event';

/**
 * Get human-readable label for event type
 */
export const getEventTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    business_meeting: 'Business Meeting',
    public_education: 'Public Education',
    training: 'Training',
    social: 'Social',
    fundraiser: 'Fundraiser',
    ceremony: 'Ceremony',
    other: 'Other',
  };
  return labels[type] || type;
};

/**
 * Get Tailwind CSS classes for event type badge
 */
export const getEventTypeBadgeColor = (type: string): string => {
  const colors: Record<string, string> = {
    business_meeting: 'bg-blue-100 text-blue-800',
    public_education: 'bg-green-100 text-green-800',
    training: 'bg-purple-100 text-purple-800',
    social: 'bg-pink-100 text-pink-800',
    fundraiser: 'bg-yellow-100 text-yellow-800',
    ceremony: 'bg-indigo-100 text-indigo-800',
    other: 'bg-gray-100 text-gray-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
};

/**
 * Get human-readable label for RSVP status
 */
export const getRSVPStatusLabel = (status: RSVPStatus): string => {
  const labels: Record<RSVPStatus, string> = {
    going: 'Going',
    not_going: 'Not Going',
    maybe: 'Maybe',
  };
  return labels[status];
};

/**
 * Get Tailwind CSS classes for RSVP status badge
 */
export const getRSVPStatusColor = (status: RSVPStatus): string => {
  const colors: Record<RSVPStatus, string> = {
    going: 'bg-green-100 text-green-800',
    not_going: 'bg-red-100 text-red-800',
    maybe: 'bg-yellow-100 text-yellow-800',
  };
  return colors[status];
};

/**
 * Get expiration status for certifications/trainings
 */
export const getExpirationStatus = (
  expirationDate: string
): { status: string; color: string } => {
  const today = new Date();
  const expDate = new Date(expirationDate);
  const daysUntilExpiry = Math.floor(
    (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilExpiry < 0) {
    return { status: 'Expired', color: 'text-red-600 bg-red-50' };
  }
  if (daysUntilExpiry <= 30) {
    return { status: `${daysUntilExpiry} days`, color: 'text-red-600 bg-red-50' };
  }
  if (daysUntilExpiry <= 60) {
    return { status: `${daysUntilExpiry} days`, color: 'text-yellow-600 bg-yellow-50' };
  }
  return { status: `${daysUntilExpiry} days`, color: 'text-green-600 bg-green-50' };
};

/**
 * Get progress bar color based on completion percentage
 */
export const getProgressBarColor = (percentage: number): string => {
  if (percentage >= 75) return 'bg-green-500';
  if (percentage >= 50) return 'bg-blue-500';
  if (percentage >= 25) return 'bg-yellow-500';
  return 'bg-red-500';
};
