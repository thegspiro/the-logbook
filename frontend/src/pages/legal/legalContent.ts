/**
 * Structured source for the built-in privacy notice and terms.
 *
 * The same content is needed in two renderings: as the JSX of the public
 * /privacy and /terms pages, and as plain text seeded into a draft when a
 * department wants to adapt the wording to its own rules. Holding it as data
 * rather than as JSX is what keeps those two from drifting — a department that
 * edits a stale copy of the notice publishes a stale notice.
 *
 * `**bold**` markers are the only markup. They become <strong> on the public
 * page and are stripped from the plain-text export, because department-supplied
 * text is rendered as plain paragraphs (never HTML) and a literal `**` would
 * show up on the published page.
 *
 * `{org}` is replaced with the organization's name.
 */

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  /** Statements a reader must not skim past — rendered in a bordered callout. */
  | { kind: 'callout'; paragraphs: string[] };

export interface LegalSection {
  /** Rendered as an <h2>. Omitted on the lead-in section. */
  heading?: string;
  blocks: LegalBlock[];
}

export type LegalDocumentType = 'privacy_policy' | 'terms_of_service';

const ORG_PLACEHOLDER = '{org}';

/** Substitute the organization name into a content string. */
export const withOrgName = (text: string, orgName: string): string => text.split(ORG_PLACEHOLDER).join(orgName);

/**
 * Split a content string on its `**bold**` markers.
 *
 * Returns alternating plain/bold segments so a renderer can map them to text
 * nodes and <strong> without dangerouslySetInnerHTML.
 */
export const splitEmphasis = (text: string): { text: string; bold: boolean }[] =>
  text
    .split(/\*\*(.+?)\*\*/gs)
    .map((segment, i) => ({ text: segment, bold: i % 2 === 1 }))
    .filter((segment) => segment.text.length > 0);

/** Drop `**bold**` markers, leaving the words. */
export const stripEmphasis = (text: string): string => text.replace(/\*\*(.+?)\*\*/gs, '$1');

/**
 * Render sections as plain text, for seeding an editable draft.
 *
 * Paragraph breaks are blank lines because that is exactly what the public page
 * splits department-supplied text on — so what a drafter sees here is what
 * members will see if it is published unchanged.
 */
export const toPlainText = (sections: LegalSection[], orgName: string): string => {
  const chunks: string[] = [];
  for (const section of sections) {
    if (section.heading) chunks.push(section.heading.toUpperCase());
    for (const block of section.blocks) {
      if (block.kind === 'p') {
        chunks.push(stripEmphasis(block.text));
      } else if (block.kind === 'ul') {
        chunks.push(block.items.map((item) => `- ${stripEmphasis(item)}`).join('\n'));
      } else {
        chunks.push(block.paragraphs.map((p) => stripEmphasis(p)).join('\n\n'));
      }
    }
  }
  return withOrgName(chunks.join('\n\n'), orgName).trim();
};

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    blocks: [
      {
        kind: 'p',
        text:
          '{org} (“the department”, “we”) operates this member intranet to run department operations — ' +
          'membership, training, scheduling, events, and related record keeping. The department is the data ' +
          'controller for the information in this system; The Logbook is the software it runs on. This notice ' +
          'describes what the system stores about you as a member or applicant, how it is used, and who decides.',
      },
    ],
  },
  {
    heading: 'The short version',
    blocks: [
      {
        kind: 'ul',
        items: [
          'The department owns this system, the records in it, and every account on it.',
          'Your access exists because of your status in the department, and it changes or ends when that status does.',
          'Information is collected to run the department — never sold, never used for advertising.',
          'Who sees what is set by role, and sensitive records are further restricted and access-audited.',
          'Much of what is stored here is an official department record, kept for as long as the law requires.',
          'Activity in the system is logged. Treat it as a department system, not a private one.',
        ],
      },
    ],
  },
  {
    heading: 'Who controls this system and your access',
    blocks: [
      {
        kind: 'callout',
        paragraphs: [
          '**{org} holds full control of this application and of the information in it.** The Logbook is only the ' +
            'software the department runs; it does not decide who is admitted, what any role may see, or what ' +
            'becomes of a record.',
          '**Access is based on your status within the department**, determined by the department under its own ' +
            'rules, bylaws, standard operating procedures, membership policies, and the state and local laws it ' +
            'operates under. The department decides who is granted an account, which role each account carries and ' +
            'therefore what it can see, and when access is expanded, reduced, suspended, or ended. A change in your ' +
            'status — probationary to active, a leave of absence, a change of rank or assignment, a suspension, or ' +
            'separation from the department — changes or ends your access accordingly, and may take effect without ' +
            'prior notice. Nothing in this notice creates a right of access to this system, or to any record in it, ' +
            'independent of your standing in the department.',
        ],
      },
    ],
  },
  {
    heading: 'Information we collect',
    blocks: [
      {
        kind: 'ul',
        items: [
          '**Identity and contact details** — name, email, phone, address, date of birth, photo, and membership identifiers.',
          '**Emergency contacts** — names and contact details you provide for use in an emergency.',
          '**Operational records** — training and certification history, event and shift attendance, service hours, ' +
            'equipment assignments, and meeting records.',
          '**Health screening information** — where your department uses the medical screening module, screening ' +
            'responses are stored encrypted and restricted to authorized medical/administrative roles.',
          '**Applicant information** — where you applied through the department, the application, references, and ' +
            'background-check status recorded during recruitment.',
          '**Technical data** — sign-in timestamps, IP addresses, device and browser information, and security audit ' +
            'records kept to protect member accounts and satisfy record-keeping obligations.',
        ],
      },
    ],
  },
  {
    heading: 'Where the information comes from',
    blocks: [
      {
        kind: 'p',
        text:
          'Most of it comes from you — what you enter in your profile, an application, or a form. The rest is created ' +
          'by the department in the ordinary course of business (attendance an officer records, a certification an ' +
          'instructor signs off, a role an administrator assigns), generated by the system itself (sign-in and audit ' +
          'records), or supplied by a third party the department uses, such as a certification registry, a ' +
          'background-check provider, or a training body.',
      },
    ],
  },
  {
    heading: 'How it is used, and why',
    blocks: [
      {
        kind: 'p',
        text:
          'Your information is used only to operate the department: verifying membership and qualifications, planning ' +
          'training and staffing, contacting you (including emergency contact use), meeting insurance and regulatory ' +
          'record-keeping requirements, and securing the system itself. The department relies on its need to run its ' +
          'operations, on the legal obligations it is subject to, and — for anything genuinely optional, such as ' +
          'text-message alerts — on your consent, which you can withdraw. It is not sold, and it is not used for ' +
          'advertising.',
      },
    ],
  },
  {
    heading: 'Who can see it',
    blocks: [
      {
        kind: 'p',
        text:
          'Access is role-based: officers and administrators see what their role requires, and sensitive categories ' +
          '(such as health screening data) are further restricted and access-audited. Information may be shared with ' +
          'service providers that host or support the system, and where law, insurance requirements, or ' +
          'public-records obligations require it. Service providers act on the department’s instructions and may not ' +
          'use member information for their own purposes.',
      },
    ],
  },
  {
    heading: 'Public records and legal disclosure',
    blocks: [
      {
        kind: 'p',
        text:
          'Fire departments and the agencies they serve under are frequently subject to public-records, sunshine, and ' +
          'open meetings laws. Records held in this system — meeting minutes, rosters, incident and training ' +
          'documentation — may have to be produced in response to a public-records request, a subpoena, a court ' +
          'order, a lawful government request, or an audit or accreditation review. The department applies whatever ' +
          'exemptions the law provides for personal, medical, and security-sensitive information, but it cannot ' +
          'withhold what the law requires it to release.',
      },
    ],
  },
  {
    heading: 'Monitoring',
    blocks: [
      {
        kind: 'p',
        text:
          'This is a department system, not a personal one. Sign-ins, record access, and changes are logged to a ' +
          'tamper-evident audit trail, and the department may review that trail for security, records, personnel, or ' +
          'legal purposes. You should not expect that your activity in this system, or content you place in it, is ' +
          'private from the department.',
      },
    ],
  },
  {
    heading: 'Security',
    blocks: [
      {
        kind: 'p',
        text:
          'The system uses encrypted connections, encryption at rest for sensitive fields, role-based access control, ' +
          'multi-factor authentication, and a tamper-evident audit log. No system is perfectly secure. If you believe ' +
          'member information has been exposed, or you have found a security weakness, tell a department ' +
          'administrator right away.',
      },
    ],
  },
  {
    heading: 'If something goes wrong',
    blocks: [
      {
        kind: 'p',
        text:
          'If a breach of member information occurs, the department will investigate, contain it, and notify affected ' +
          'people and any regulator or agency where notification is required — within the deadlines that apply to it, ' +
          'which for health information and for state breach-notification laws can be short.',
      },
    ],
  },
  {
    heading: 'Where information is stored',
    blocks: [
      {
        kind: 'p',
        text:
          'The department chooses where this system runs and where its data is held; ask an administrator if you need ' +
          'to know the specifics for your department. If information is ever handled outside the country it was ' +
          'collected in, the department remains responsible for protecting it to the same standard described here.',
      },
    ],
  },
  {
    heading: 'Retention',
    blocks: [
      {
        kind: 'p',
        text:
          'Operational records (training, attendance, minutes) are retained per the department’s records-retention ' +
          'schedule and applicable statutes, which commonly require multi-year retention for fire-service records — ' +
          'and for certain exposure and medical-surveillance records, decades. Security audit records are retained ' +
          'for seven years by default. Retention is set by the department, and records it is legally obliged to keep ' +
          'are kept even if you ask for their deletion.',
      },
    ],
  },
  {
    heading: 'Members under 18',
    blocks: [
      {
        kind: 'p',
        text:
          'Where the department runs a junior, cadet, or explorer program, accounts for members under 18 are created ' +
          'at the department’s discretion with parent or guardian consent, and the same protections in this notice ' +
          'apply. A parent or guardian may ask the department to review, correct, or remove a minor’s information, ' +
          'subject to the records the department must keep. This system is not directed to the general public and ' +
          'does not knowingly collect information from children outside a department program.',
      },
    ],
  },
  {
    heading: 'Your choices',
    blocks: [
      {
        kind: 'ul',
        items: [
          'You can review and update your profile and emergency contacts in Settings.',
          'You can control your notification preferences, and withdraw consent to text messages at any time.',
          'You can request an export of your personal data from the department.',
          'You can ask the department to correct information about you that is wrong.',
          'When you leave the department, you can ask for your personal details to be anonymized; operational records ' +
            'the department must legally keep are retained without your identifying details where the law allows.',
        ],
      },
      {
        kind: 'p',
        text:
          'Make any of these requests to a department administrator, who will respond within the time the applicable ' +
          'law allows. Requests are decided by the department, and may be limited by the records it is required to ' +
          'keep or produce. Depending on where you live you may have further rights under state or national privacy ' +
          'law, and the right to complain to your regulator.',
      },
    ],
  },
  {
    heading: 'What we do not do',
    blocks: [
      {
        kind: 'p',
        text:
          'We do not sell or share your personal information for money or for cross-context behavioral advertising, ' +
          'we run no advertising or third-party tracking in this system, and no decision that materially affects you ' +
          '— membership, discipline, qualification — is made by automation alone without a person reviewing it.',
      },
    ],
  },
  {
    heading: 'Cookies',
    blocks: [
      {
        kind: 'p',
        text:
          'The system uses essential cookies only: secure, httpOnly session cookies for sign-in and a CSRF-protection ' +
          'cookie. There are no advertising or cross-site tracking cookies.',
      },
    ],
  },
  {
    heading: 'Changes to this notice',
    blocks: [
      {
        kind: 'p',
        text:
          'The department may update this notice as its practices, its systems, or the law change. The date at the ' +
          'top of this page shows when it was last revised; material changes will be communicated through normal ' +
          'department channels. Review it periodically.',
      },
    ],
  },
  {
    heading: 'Questions',
    blocks: [
      {
        kind: 'p',
        text:
          'Contact your department’s administrators with any privacy question or request. They are responsible for ' +
          'this deployment and its records.',
      },
    ],
  },
];

export const TERMS_OF_SERVICE_SECTIONS: LegalSection[] = [
  {
    blocks: [
      {
        kind: 'p',
        text:
          'This system is provided by {org} for its members, applicants, and authorized personnel. By signing in you ' +
          'agree to use it consistent with these terms and your department’s policies. If you do not agree, do not ' +
          'use the system.',
      },
    ],
  },
  {
    heading: 'Who this system belongs to',
    blocks: [
      {
        kind: 'callout',
        paragraphs: [
          '**{org} holds full control of this application, its configuration, and every record in it.** The Logbook ' +
            'is the software the department runs; the department decides how it is used. Your account is a revocable, ' +
            'non-transferable permission to use a department system for department business — not property, and not a ' +
            'personal account.',
          '**Access is based on your status within the department**, as the department determines under its own ' +
            'rules, bylaws, standard operating procedures, membership policies, and applicable state and local law. ' +
            'The department alone decides who receives an account, what role it carries and therefore what it can see ' +
            'or do, and when access is expanded, reduced, suspended, or ended. It may change or revoke access at any ' +
            'time, with or without notice, including on a change of rank or assignment, a leave of absence, a ' +
            'disciplinary action, an investigation, or separation from the department. Access ends when your ' +
            'membership does.',
        ],
      },
    ],
  },
  {
    heading: 'Accounts',
    blocks: [
      {
        kind: 'p',
        text:
          'Your account is personal. Keep your credentials private, enable multi-factor authentication where ' +
          'required, and tell an administrator promptly if you believe your account has been compromised. Never share ' +
          'an account or use another member’s. Administrators may suspend accounts to protect the system or ' +
          'department records.',
      },
    ],
  },
  {
    heading: 'Acceptable use',
    blocks: [
      {
        kind: 'ul',
        items: [
          'Use the system for department business only.',
          'Do not access records beyond your role, share other members’ personal or health information outside proper ' +
            'channels, or attempt to bypass security controls.',
          'Do not extract, copy, or export member data except as your duties require and department policy allows, ' +
            'and do not use it for any personal, commercial, or political purpose.',
          'Do not probe, scan, or test the system’s security, use automated tools against it, or interfere with its ' +
            'operation, without written authorization from the department.',
          'Content you post (documents, minutes, form responses) must be accurate and appropriate for a department ' +
            'record — much of it may be an official record subject to retention and disclosure rules.',
          'Harassment, discrimination, and anything else your department’s conduct policy prohibits is prohibited ' +
            'here too.',
        ],
      },
    ],
  },
  {
    heading: 'Confidential and protected information',
    blocks: [
      {
        kind: 'p',
        text:
          'This system holds personal, medical, and personnel information about other members. Treat everything you ' +
          'can see as confidential: access it only when you have a job-related need, disclose it only through proper ' +
          'channels, and keep it off personal email, personal cloud storage, and social media. Health and patient ' +
          'information carries obligations under HIPAA and state law that continue after you leave the department.',
      },
    ],
  },
  {
    heading: 'Records you create belong to the department',
    blocks: [
      {
        kind: 'p',
        text:
          'Information you enter, upload, or generate in the course of department business — reports, minutes, ' +
          'rosters, training records, attendance, messages — is a department record, owned and controlled by the ' +
          'department, and subject to its retention schedule and to public-records and legal-hold obligations. It ' +
          'does not leave with you.',
      },
    ],
  },
  {
    heading: 'Monitoring',
    blocks: [
      {
        kind: 'p',
        text:
          'Sign-ins, record access, and changes are logged, and the department may review those logs and the content ' +
          'you place in the system for security, records, personnel, or legal purposes. You should have no ' +
          'expectation of privacy in your use of this system.',
      },
    ],
  },
  {
    heading: 'Your device',
    blocks: [
      {
        kind: 'p',
        text:
          'If you use this system on a personal phone, tablet, or computer, secure that device: keep a screen lock ' +
          'on, keep the operating system current, do not save department information to unmanaged apps or storage, ' +
          'and report a lost or stolen device to an administrator immediately. Sign out on shared or public devices. ' +
          'Your carrier’s data and message rates apply to notifications you receive.',
      },
    ],
  },
  {
    heading: 'Notifications',
    blocks: [
      {
        kind: 'p',
        text:
          'Email is the department’s channel of record; keeping a working email address on your profile is part of ' +
          'using the system. Text messages are an optional addition that you consent to and can stop at any time, and ' +
          'turning them off does not stop the emails the department must be able to send you.',
      },
    ],
  },
  {
    heading: 'Not for emergencies',
    blocks: [
      {
        kind: 'callout',
        paragraphs: [
          '**This system is not a dispatch, alerting, or emergency communications system.** Never rely on it to ' +
            'report an emergency, to receive a call for service, or to make a time-critical operational decision. Use ' +
            '9-1-1, your dispatch center, and your department’s radio and paging systems.',
        ],
      },
    ],
  },
  {
    heading: 'Availability',
    blocks: [
      {
        kind: 'p',
        text:
          'The department aims to keep the system available but does not guarantee uninterrupted or error-free ' +
          'service, and may change, suspend, or discontinue any part of it. Operational decisions must never depend ' +
          'solely on this system’s availability. To the extent the law allows, the system is provided as-is and the ' +
          'department is not liable for indirect or consequential loss arising from its use or unavailability. ' +
          'Nothing here limits any liability that cannot lawfully be limited.',
      },
    ],
  },
  {
    heading: 'If you break these rules',
    blocks: [
      {
        kind: 'p',
        text:
          'Misuse may lead to loss of access and to discipline under the department’s policies, up to and including ' +
          'separation, and — where conduct involves unauthorized access, protected health information, or department ' +
          'records — referral to the appropriate authorities. These terms are in addition to your department’s ' +
          'policies, not a replacement for them.',
      },
    ],
  },
  {
    heading: 'Which rules win',
    blocks: [
      {
        kind: 'p',
        text:
          'If these terms conflict with your department’s bylaws, standard operating procedures, personnel or ' +
          'collective bargaining agreements, or with applicable state or local law, those control. These terms are ' +
          'governed by the law of the jurisdiction the department operates in, and nothing in them alters the terms ' +
          'of your membership or employment.',
      },
    ],
  },
  {
    heading: 'Changes',
    blocks: [
      {
        kind: 'p',
        text:
          'The department may update these terms; continued use after an update constitutes acceptance. The date at ' +
          'the top of this page shows when they were last revised, and material changes will be communicated through ' +
          'normal department channels.',
      },
    ],
  },
  {
    heading: 'Questions',
    blocks: [
      {
        kind: 'p',
        text:
          'Contact your department’s administrators with any question about these terms. They are responsible for ' +
          'this deployment and for the policies behind it.',
      },
    ],
  },
];

export const LEGAL_SECTIONS: Record<LegalDocumentType, LegalSection[]> = {
  privacy_policy: PRIVACY_POLICY_SECTIONS,
  terms_of_service: TERMS_OF_SERVICE_SECTIONS,
};
