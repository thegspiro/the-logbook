/**
 * Applicant Access Context
 *
 * What the signed-in member may do with the applicant open in the dialog, as
 * the backend decided it (GET /prospects/{id}/my-access). Sections read it to
 * offer only the actions the backend will accept: a case manager works their
 * applicant but cannot reject them, an interviewer sees their details and
 * documents and nothing more.
 *
 * Outside a provider every action is offered. That is the pipeline page's
 * behaviour before assignments existed, and the backend refuses anything the
 * caller may not do, so a section rendered on its own (in a test, or by a page
 * that predates this) shows a button that answers 403 rather than hiding one
 * that would work.
 */

import { createContext, useContext } from 'react';
import type { ProspectAccess } from '../types';

export const FULL_ACCESS: ProspectAccess = {
  roles: [],
  view_all: true,
  can_work: true,
  can_manage: true,
  can_see_full: true,
  can_log_interview: true,
};

/** Shown while the caller's access is loading, or if it cannot be read. */
export const READ_ONLY_ACCESS: ProspectAccess = {
  roles: [],
  view_all: false,
  can_work: false,
  can_manage: false,
  can_see_full: false,
  can_log_interview: false,
};

export const ApplicantAccessContext = createContext<ProspectAccess>(FULL_ACCESS);

export const useApplicantAccess = (): ProspectAccess => useContext(ApplicantAccessContext);
