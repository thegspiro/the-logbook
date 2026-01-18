/**
 * Privacy Notice Component
 *
 * Displays a notice that contact information is for department purposes only.
 */

import React from 'react';

export const PrivacyNotice: React.FC = () => {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-blue-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-blue-800">
            Contact Information Privacy Notice
          </h3>
          <div className="mt-2 text-sm text-blue-700">
            <p>
              The contact information displayed on this page is for <strong>department purposes only</strong> and
              should <strong>not be used for commercial purposes</strong>. Please respect the privacy of your fellow members.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyNotice;
