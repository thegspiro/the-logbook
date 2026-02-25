/**
 * Event Request Status Page (Public)
 *
 * Token-based public page for community members to check
 * the status of their event request. No authentication required.
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ClipboardList,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Loader2,
} from 'lucide-react';
import { eventRequestService } from '../services/api';
import type { EventRequestPublicStatus, EventRequestStatus, OutreachEventType } from '../types/event';

const OUTREACH_LABELS: Record<OutreachEventType, string> = {
  fire_safety_demo: 'Fire Safety Demo',
  station_tour: 'Station Tour',
  cpr_first_aid: 'CPR / First Aid Class',
  career_talk: 'Career Talk',
  other: 'Other',
};

const STATUS_STEPS: { key: EventRequestStatus; label: string; icon: React.ElementType }[] = [
  { key: 'submitted', label: 'Submitted', icon: ClipboardList },
  { key: 'under_review', label: 'Under Review', icon: Clock },
  { key: 'approved', label: 'Approved', icon: CheckCircle },
  { key: 'scheduled', label: 'Scheduled', icon: Calendar },
  { key: 'completed', label: 'Completed', icon: CheckCircle },
];

const STATUS_ORDER: Record<string, number> = {
  submitted: 0,
  under_review: 1,
  approved: 2,
  scheduled: 3,
  completed: 4,
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const EventRequestStatusPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<EventRequestPublicStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const fetchStatus = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await eventRequestService.checkPublicStatus(token);
        setData(result);
      } catch {
        setError('Request not found. Please check your status link and try again.');
      } finally {
        setLoading(false);
      }
    };

    void fetchStatus();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Request Not Found
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {error || 'Unable to find this event request.'}
          </p>
        </div>
      </div>
    );
  }

  const isTerminal = data.status === 'declined' || data.status === 'cancelled';
  const currentStep = STATUS_ORDER[data.status] ?? -1;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/20 mb-4">
            <ClipboardList className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Event Request Status
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            {OUTREACH_LABELS[data.outreach_type] || data.outreach_type} — requested by {data.contact_name}
          </p>
        </div>

        {/* Status card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          {/* Terminal states */}
          {isTerminal ? (
            <div className={`p-6 ${data.status === 'declined' ? 'bg-red-50 dark:bg-red-500/10' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
              <div className="flex items-center gap-3 mb-3">
                <XCircle className={`w-6 h-6 ${data.status === 'declined' ? 'text-red-500' : 'text-gray-500'}`} />
                <h2 className={`text-lg font-semibold ${data.status === 'declined' ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                  Request {data.status === 'declined' ? 'Declined' : 'Cancelled'}
                </h2>
              </div>
              {data.decline_reason && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  {data.decline_reason}
                </p>
              )}
            </div>
          ) : (
            /* Progress stepper */
            <div className="p-6">
              <div className="flex items-center justify-between">
                {STATUS_STEPS.map((step, idx) => {
                  const isActive = currentStep >= idx;
                  const isCurrent = currentStep === idx;
                  const StepIcon = step.icon;

                  return (
                    <React.Fragment key={step.key}>
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            isCurrent
                              ? 'bg-red-600 text-white ring-4 ring-red-100 dark:ring-red-500/20'
                              : isActive
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          <StepIcon className="w-5 h-5" />
                        </div>
                        <span
                          className={`text-xs mt-2 font-medium ${
                            isCurrent
                              ? 'text-red-600 dark:text-red-400'
                              : isActive
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div
                          className={`flex-1 h-0.5 mx-2 ${
                            currentStep > idx
                              ? 'bg-green-500'
                              : 'bg-gray-200 dark:bg-gray-600'
                          }`}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Submitted</span>
                <span className="text-gray-900 dark:text-white font-medium">
                  {formatDate(data.created_at)}
                </span>
              </div>
              <div>
                <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Last Updated</span>
                <span className="text-gray-900 dark:text-white font-medium">
                  {formatDate(data.updated_at)}
                </span>
              </div>
              {data.preferred_date_start && (
                <div>
                  <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Preferred Date</span>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {formatDate(data.preferred_date_start)}
                    {data.preferred_date_end && ` — ${formatDate(data.preferred_date_end)}`}
                  </span>
                </div>
              )}
              {data.event_date && (
                <div>
                  <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Scheduled Date</span>
                  <span className="text-green-700 dark:text-green-400 font-semibold">
                    {formatDate(data.event_date)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
          You will receive email updates when your request status changes.
        </p>
      </div>
    </div>
  );
};

export default EventRequestStatusPage;
