import React from 'react';

import { bodyText, calloutClass, listClass, sectionHeading } from './legalStyles';

/**
 * Built-in terms of use shown when a department has not published its own
 * wording via organization settings ("legal.terms_of_service").
 *
 * These are internal-system terms, not consumer terms: the reader is a member
 * of the department that owns the deployment, so the operative points are
 * department ownership, access tied to membership status, and the fact that
 * department policy and law outrank anything written here.
 */
const DefaultTermsOfService: React.FC<{ orgName: string }> = ({ orgName }) => (
  <>
    <p className={bodyText}>
      This system is provided by {orgName} for its members, applicants, and authorized personnel. By signing in you
      agree to use it consistent with these terms and your department&rsquo;s policies. If you do not agree, do not use
      the system.
    </p>

    <h2 className={sectionHeading}>Who this system belongs to</h2>
    <div className={calloutClass}>
      <p>
        <strong>{orgName} holds full control of this application, its configuration, and every record in it.</strong>{' '}
        The Logbook is the software the department runs; the department decides how it is used. Your account is a
        revocable, non-transferable permission to use a department system for department business — not property, and
        not a personal account.
      </p>
      <p className="mt-3">
        <strong>Access is based on your status within the department</strong>, as the department determines under its
        own rules, bylaws, standard operating procedures, membership policies, and applicable state and local law. The
        department alone decides who receives an account, what role it carries and therefore what it can see or do, and
        when access is expanded, reduced, suspended, or ended. It may change or revoke access at any time, with or
        without notice, including on a change of rank or assignment, a leave of absence, a disciplinary action, an
        investigation, or separation from the department. Access ends when your membership does.
      </p>
    </div>

    <h2 className={sectionHeading}>Accounts</h2>
    <p className={bodyText}>
      Your account is personal. Keep your credentials private, enable multi-factor authentication where required, and
      tell an administrator promptly if you believe your account has been compromised. Never share an account or use
      another member&rsquo;s. Administrators may suspend accounts to protect the system or department records.
    </p>

    <h2 className={sectionHeading}>Acceptable use</h2>
    <ul className={listClass}>
      <li>Use the system for department business only.</li>
      <li>
        Do not access records beyond your role, share other members&rsquo; personal or health information outside proper
        channels, or attempt to bypass security controls.
      </li>
      <li>
        Do not extract, copy, or export member data except as your duties require and department policy allows, and do
        not use it for any personal, commercial, or political purpose.
      </li>
      <li>
        Do not probe, scan, or test the system&rsquo;s security, use automated tools against it, or interfere with its
        operation, without written authorization from the department.
      </li>
      <li>
        Content you post (documents, minutes, form responses) must be accurate and appropriate for a department record —
        much of it may be an official record subject to retention and disclosure rules.
      </li>
      <li>
        Harassment, discrimination, and anything else your department&rsquo;s conduct policy prohibits is prohibited
        here too.
      </li>
    </ul>

    <h2 className={sectionHeading}>Confidential and protected information</h2>
    <p className={bodyText}>
      This system holds personal, medical, and personnel information about other members. Treat everything you can see
      as confidential: access it only when you have a job-related need, disclose it only through proper channels, and
      keep it off personal email, personal cloud storage, and social media. Health and patient information carries
      obligations under HIPAA and state law that continue after you leave the department.
    </p>

    <h2 className={sectionHeading}>Records you create belong to the department</h2>
    <p className={bodyText}>
      Information you enter, upload, or generate in the course of department business — reports, minutes, rosters,
      training records, attendance, messages — is a department record, owned and controlled by the department, and
      subject to its retention schedule and to public-records and legal-hold obligations. It does not leave with you.
    </p>

    <h2 className={sectionHeading}>Monitoring</h2>
    <p className={bodyText}>
      Sign-ins, record access, and changes are logged, and the department may review those logs and the content you
      place in the system for security, records, personnel, or legal purposes. You should have no expectation of privacy
      in your use of this system.
    </p>

    <h2 className={sectionHeading}>Your device</h2>
    <p className={bodyText}>
      If you use this system on a personal phone, tablet, or computer, secure that device: keep a screen lock on, keep
      the operating system current, do not save department information to unmanaged apps or storage, and report a lost
      or stolen device to an administrator immediately. Sign out on shared or public devices. Your carrier&rsquo;s data
      and message rates apply to notifications you receive.
    </p>

    <h2 className={sectionHeading}>Notifications</h2>
    <p className={bodyText}>
      Email is the department&rsquo;s channel of record; keeping a working email address on your profile is part of
      using the system. Text messages are an optional addition that you consent to and can stop at any time, and turning
      them off does not stop the emails the department must be able to send you.
    </p>

    <h2 className={sectionHeading}>Not for emergencies</h2>
    <div className={calloutClass}>
      <p>
        <strong>This system is not a dispatch, alerting, or emergency communications system.</strong> Never rely on it
        to report an emergency, to receive a call for service, or to make a time-critical operational decision. Use
        9-1-1, your dispatch center, and your department&rsquo;s radio and paging systems.
      </p>
    </div>

    <h2 className={sectionHeading}>Availability</h2>
    <p className={bodyText}>
      The department aims to keep the system available but does not guarantee uninterrupted or error-free service, and
      may change, suspend, or discontinue any part of it. Operational decisions must never depend solely on this
      system&rsquo;s availability. To the extent the law allows, the system is provided as-is and the department is not
      liable for indirect or consequential loss arising from its use or unavailability. Nothing here limits any
      liability that cannot lawfully be limited.
    </p>

    <h2 className={sectionHeading}>If you break these rules</h2>
    <p className={bodyText}>
      Misuse may lead to loss of access and to discipline under the department&rsquo;s policies, up to and including
      separation, and — where conduct involves unauthorized access, protected health information, or department records
      — referral to the appropriate authorities. These terms are in addition to your department&rsquo;s policies, not a
      replacement for them.
    </p>

    <h2 className={sectionHeading}>Which rules win</h2>
    <p className={bodyText}>
      If these terms conflict with your department&rsquo;s bylaws, standard operating procedures, personnel or
      collective bargaining agreements, or with applicable state or local law, those control. These terms are governed
      by the law of the jurisdiction the department operates in, and nothing in them alters the terms of your membership
      or employment.
    </p>

    <h2 className={sectionHeading}>Changes</h2>
    <p className={bodyText}>
      The department may update these terms; continued use after an update constitutes acceptance. The date at the top
      of this page shows when they were last revised, and material changes will be communicated through normal
      department channels.
    </p>

    <h2 className={sectionHeading}>Questions</h2>
    <p className={bodyText}>
      Contact your department&rsquo;s administrators with any question about these terms. They are responsible for this
      deployment and for the policies behind it.
    </p>
  </>
);

export default DefaultTermsOfService;
