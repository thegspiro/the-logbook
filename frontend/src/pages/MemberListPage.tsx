/**
 * Member List Page
 *
 * Displays all members with conditional contact information.
 */

import React, { useEffect, useState } from 'react';
import MemberList from '../components/MemberList';
import PrivacyNotice from '../components/PrivacyNotice';
import { userService } from '../services/api';
import type { User, ContactInfoSettings } from '../types/user';

export const MemberListPage: React.FC = () => {
  const [members, setMembers] = useState<User[]>([]);
  const [contactSettings, setContactSettings] = useState<ContactInfoSettings>({
    enabled: false,
    show_email: false,
    show_phone: false,
    show_mobile: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch contact settings and users in parallel
        const [settings, users] = await Promise.all([
          userService.checkContactInfoEnabled(),
          userService.getUsers(),
        ]);

        setContactSettings(settings);
        setMembers(users);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load members. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const showContactInfo = contactSettings.enabled && (
    contactSettings.show_email || contactSettings.show_phone || contactSettings.show_mobile
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading members...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Department Members</h2>
        <p className="mt-1 text-sm text-gray-500">
          A list of all members in your department.
          {showContactInfo && ' Contact information is displayed below.'}
        </p>
      </div>

      {showContactInfo && <PrivacyNotice />}

      <MemberList members={members} contactSettings={contactSettings} />

      <div className="mt-6 text-sm text-gray-500">
        Showing {members.length} {members.length === 1 ? 'member' : 'members'}
      </div>
    </div>
  );
};

export default MemberListPage;
