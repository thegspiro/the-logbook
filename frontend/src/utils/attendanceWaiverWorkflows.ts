/**
 * The two attendance waiver workflows the screens serve: training sessions
 * and business meetings. The backend runs both on one engine
 * (`attendance_waiver_service.py`, `WorkflowSpec`), so the screens are shared
 * too, and everything that differs between the two lives here: the API, where
 * the pages are, the words, and whether documents can be filed.
 *
 * The request and queue paths are the backend's `decider_path` for each
 * workflow, which the deciders' emails and in-app prompts link to; change one
 * only with the other.
 */

import type React from 'react';
import { GovernancePageHeader } from '../components/governance/GovernancePageHeader';
import type { PageHeaderProps } from '../components/layout/SectionPageHeader';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import {
  attendanceWaiverService,
  meetingWaiverService,
  type AttendanceWaiverService,
} from '../services/attendanceWaiverService';

export const AttendanceWaiverWorkflowKey = {
  TRAINING_SESSION: 'training_session',
  BUSINESS_MEETING: 'business_meeting',
} as const;
export type AttendanceWaiverWorkflowKey =
  (typeof AttendanceWaiverWorkflowKey)[keyof typeof AttendanceWaiverWorkflowKey];

export interface AttendanceWaiverWorkflow {
  key: AttendanceWaiverWorkflowKey;
  /** The API for this workflow. A getter, so a test that mocks only one service never touches the other. */
  readonly service: AttendanceWaiverService;
  /** "training session" / "business meeting", for sentences. */
  sessionNoun: string;
  /** "Session" / "Meeting", for a field label. */
  sessionLabel: string;
  /** "session" / "meeting", for "this session" in a sentence to the member. */
  sessionWord: string;
  /** What an approved request stops the session counting toward, for the member. */
  attendanceMeasure: string;
  /** The deciders' queue, and the module it belongs to. */
  queuePath: string;
  requestPath: (requestId: string) => string;
  /** The module a route needs enabled. */
  module: { key: string; label: string };
  /** The page header of the module the screens sit in. */
  PageHeader: React.FC<PageHeaderProps>;
  /** Whether a member may file documents with a request (the backend takes them for training only). */
  takesDocuments: boolean;
  /**
   * Where a member keeps track of all their requests, or null when the
   * workflow has no such list and the member works from the session's page.
   */
  memberListPath: string | null;
  /** Who decides when the chosen positions leave nobody, for the settings screen. */
  fallbackDeciders: string;
  /** The permission that saves the policy, names the alternate and is the routing's last step. */
  managePermission: string;
}

const encode = (id: string) => encodeURIComponent(id);

export const TRAINING_WAIVER_WORKFLOW: AttendanceWaiverWorkflow = {
  key: AttendanceWaiverWorkflowKey.TRAINING_SESSION,
  get service() {
    return attendanceWaiverService;
  },
  sessionNoun: 'training session',
  sessionLabel: 'Session',
  sessionWord: 'session',
  attendanceMeasure: 'your attendance requirement',
  queuePath: '/attendance-waivers',
  requestPath: (requestId) => `/attendance-waivers/${encode(requestId)}`,
  module: { key: 'training', label: 'Training' },
  PageHeader: TrainingPageHeader,
  takesDocuments: true,
  memberListPath: '/training/my-training',
  fallbackDeciders: 'the Chief, and failing a Chief the training managers',
  managePermission: 'training.manage',
};

export const MEETING_WAIVER_WORKFLOW: AttendanceWaiverWorkflow = {
  key: AttendanceWaiverWorkflowKey.BUSINESS_MEETING,
  get service() {
    return meetingWaiverService;
  },
  sessionNoun: 'business meeting',
  sessionLabel: 'Meeting',
  sessionWord: 'meeting',
  attendanceMeasure: 'your meeting attendance',
  queuePath: '/meetings/waiver-requests',
  requestPath: (requestId) => `/meetings/waiver-requests/${encode(requestId)}`,
  module: { key: 'minutes', label: 'Meeting Minutes' },
  PageHeader: GovernancePageHeader,
  takesDocuments: false,
  memberListPath: null,
  fallbackDeciders: 'the Secretary, and failing a Secretary the members who manage meetings',
  managePermission: 'meetings.manage',
};

/** The meeting workflow's policy screen, under the attendance dashboard. */
export const MEETING_WAIVER_SETTINGS_PATH = '/minutes/attendance/waiver-settings';
