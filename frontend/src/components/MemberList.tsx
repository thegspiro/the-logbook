/**
 * Member List Component
 *
 * Displays a list of organization members with optional contact information.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { User, ContactInfoSettings } from '../types/user';
import { UserStatus } from '../constants/enums';

interface MemberListProps {
  members: User[];
  contactSettings: ContactInfoSettings;
}

export const MemberList: React.FC<MemberListProps> = ({ members, contactSettings }) => {
  const showAnyContactInfo = contactSettings.enabled && (
    contactSettings.show_email || contactSettings.show_phone || contactSettings.show_mobile
  );

  return (
    <div className="bg-theme-surface shadow overflow-hidden sm:rounded-lg">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-theme-surface-border">
          <thead className="bg-theme-surface-secondary">
            <tr>
              <th
                scope="col"
                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
              >
                Name
              </th>
              <th
                scope="col"
                className="hidden sm:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
              >
                Member #
              </th>
              {contactSettings.enabled && contactSettings.show_email && (
                <th
                  scope="col"
                  className="hidden md:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
                >
                  Email
                </th>
              )}
              {contactSettings.enabled && contactSettings.show_phone && (
                <th
                  scope="col"
                  className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
                >
                  Phone
                </th>
              )}
              {contactSettings.enabled && contactSettings.show_mobile && (
                <th
                  scope="col"
                  className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
                >
                  Mobile
                </th>
              )}
              <th
                scope="col"
                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-theme-surface divide-y divide-theme-surface-border">
            {members.length === 0 ? (
              <tr>
                <td
                  colSpan={showAnyContactInfo ? 6 : 3}
                  className="px-6 py-12 text-center text-sm text-theme-text-muted"
                >
                  No members found.
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className="hover:bg-theme-surface-hover">
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <Link to={`/members/${member.id}`} className="flex items-center group">
                      {member.photo_url ? (
                        <div className="flex-shrink-0 h-10 w-10">
                          <img
                            className="h-10 w-10 rounded-full"
                            src={member.photo_url}
                            alt={member.full_name || member.username}
                          />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-theme-surface-secondary flex items-center justify-center">
                          <span className="text-theme-text-muted font-medium">
                            {(member.first_name?.[0] ?? member.username?.[0] ?? '').toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="ml-3 sm:ml-4">
                        <div className="text-sm font-medium text-theme-text-primary group-hover:text-blue-600">
                          {member.full_name || member.username}
                        </div>
                        <div className="text-xs sm:text-sm text-theme-text-muted">@{member.username}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="hidden sm:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                    {member.membership_number || '-'}
                  </td>
                  {contactSettings.enabled && contactSettings.show_email && (
                    <td className="hidden md:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                      {member.email ? (
                        <a
                          href={`mailto:${member.email}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {member.email}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                  {contactSettings.enabled && contactSettings.show_phone && (
                    <td className="hidden lg:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                      {member.phone ? (
                        <a
                          href={`tel:${member.phone}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {member.phone}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                  {contactSettings.enabled && contactSettings.show_mobile && (
                    <td className="hidden lg:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                      {member.mobile ? (
                        <a
                          href={`tel:${member.mobile}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {member.mobile}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        member.status === UserStatus.ACTIVE
                          ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                          : member.status === UserStatus.INACTIVE
                          ? 'bg-theme-surface-secondary text-theme-text-primary'
                          : member.status === UserStatus.SUSPENDED
                          ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400'
                      }`}
                    >
                      {member.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MemberList;
