/**
 * Member List Component
 *
 * Displays a list of organization members with optional contact information.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { User, ContactInfoSettings } from '../types/user';

interface MemberListProps {
  members: User[];
  contactSettings: ContactInfoSettings;
}

export const MemberList: React.FC<MemberListProps> = ({ members, contactSettings }) => {
  const showAnyContactInfo = contactSettings.enabled && (
    contactSettings.show_email || contactSettings.show_phone || contactSettings.show_mobile
  );

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Name
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Badge Number
              </th>
              {contactSettings.enabled && contactSettings.show_email && (
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Email
                </th>
              )}
              {contactSettings.enabled && contactSettings.show_phone && (
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Phone
                </th>
              )}
              {contactSettings.enabled && contactSettings.show_mobile && (
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Mobile
                </th>
              )}
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {members.length === 0 ? (
              <tr>
                <td
                  colSpan={showAnyContactInfo ? 6 : 3}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  No members found.
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
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
                        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                          <span className="text-gray-500 font-medium">
                            {(member.first_name?.[0] || member.username[0]).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600">
                          {member.full_name || member.username}
                        </div>
                        <div className="text-sm text-gray-500">@{member.username}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {member.badge_number || '-'}
                  </td>
                  {contactSettings.enabled && contactSettings.show_email && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : member.status === 'inactive'
                          ? 'bg-gray-100 text-gray-800'
                          : member.status === 'suspended'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
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
