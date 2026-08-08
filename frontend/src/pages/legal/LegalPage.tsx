import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import axios from 'axios';

/**
 * Public privacy-policy / terms-of-service page (no auth).
 *
 * Departments can replace the built-in defaults with their own wording via
 * organization settings ("legal.privacy_policy" / "legal.terms_of_service",
 * served by GET /api/public/v1/legal). Custom text is rendered as plain
 * paragraphs — never HTML — so it cannot inject markup into a public page.
 */

interface LegalTextResponse {
  organizationName: string | null;
  privacyPolicy: string | null;
  termsOfService: string | null;
}

const sectionHeading = 'mt-8 text-xl font-semibold text-theme-text-primary';
const bodyText = 'mt-3 text-sm leading-6 text-theme-text-secondary';
const listClass = 'mt-3 list-disc space-y-1 pl-6 text-sm leading-6 text-theme-text-secondary';

const DefaultPrivacyPolicy: React.FC<{ orgName: string }> = ({ orgName }) => (
  <>
    <p className={bodyText}>
      {orgName} (&ldquo;the department&rdquo;, &ldquo;we&rdquo;) operates this member intranet to run department
      operations — membership, training, scheduling, events, and related record keeping. The department is the data
      controller for the information in this system; The Logbook is the software it runs on. This notice describes what
      the system stores about you as a member or applicant and how it is used.
    </p>

    <h2 className={sectionHeading}>Information we collect</h2>
    <ul className={listClass}>
      <li>
        <strong>Identity and contact details</strong> — name, email, phone, address, date of birth, photo, and
        membership identifiers.
      </li>
      <li>
        <strong>Emergency contacts</strong> — names and contact details you provide for use in an emergency.
      </li>
      <li>
        <strong>Operational records</strong> — training and certification history, event and shift attendance, service
        hours, equipment assignments, and meeting records.
      </li>
      <li>
        <strong>Health screening information</strong> — where your department uses the medical screening module,
        screening responses are stored encrypted and restricted to authorized medical/administrative roles.
      </li>
      <li>
        <strong>Technical data</strong> — sign-in timestamps, IP addresses, and security audit records kept to protect
        member accounts and satisfy record-keeping obligations.
      </li>
    </ul>

    <h2 className={sectionHeading}>How it is used</h2>
    <p className={bodyText}>
      Your information is used only to operate the department: verifying membership and qualifications, planning
      training and staffing, contacting you (including emergency contact use), meeting insurance and regulatory
      record-keeping requirements, and securing the system itself. It is not sold, and it is not used for advertising.
    </p>

    <h2 className={sectionHeading}>Who can see it</h2>
    <p className={bodyText}>
      Access is role-based: officers and administrators see what their role requires, and sensitive categories (such as
      health screening data) are further restricted and access-audited. Information may be shared with service providers
      that host or support the system, and where law, insurance requirements, or public-records obligations require it.
    </p>

    <h2 className={sectionHeading}>Security</h2>
    <p className={bodyText}>
      The system uses encrypted connections, encryption at rest for sensitive fields, role-based access control,
      multi-factor authentication, and a tamper-evident audit log. No system is perfectly secure, but security issues
      can be reported at any time via the address on our security page.
    </p>

    <h2 className={sectionHeading}>Retention</h2>
    <p className={bodyText}>
      Operational records (training, attendance, minutes) are retained per the department&rsquo;s records-retention
      schedule and applicable statutes, which commonly require multi-year retention for fire-service records. Security
      audit records are retained for seven years by default.
    </p>

    <h2 className={sectionHeading}>Your choices</h2>
    <ul className={listClass}>
      <li>You can review and update your profile and emergency contacts in Settings.</li>
      <li>You can request an export of your personal data from the department.</li>
      <li>
        When you leave the department, you can ask for your personal details to be anonymized; operational records the
        department must legally keep are retained without your identifying details where the law allows.
      </li>
    </ul>

    <h2 className={sectionHeading}>Cookies</h2>
    <p className={bodyText}>
      The system uses essential cookies only: secure, httpOnly session cookies for sign-in and a CSRF-protection cookie.
      There are no advertising or cross-site tracking cookies.
    </p>

    <h2 className={sectionHeading}>Questions</h2>
    <p className={bodyText}>
      Contact your department&rsquo;s administrators with any privacy question or request. They are responsible for this
      deployment and its records.
    </p>
  </>
);

const DefaultTermsOfService: React.FC<{ orgName: string }> = ({ orgName }) => (
  <>
    <p className={bodyText}>
      This system is provided by {orgName} for its members, applicants, and authorized personnel. By signing in you
      agree to use it consistent with these terms and your department&rsquo;s policies.
    </p>

    <h2 className={sectionHeading}>Accounts</h2>
    <p className={bodyText}>
      Your account is personal. Keep your credentials private, enable multi-factor authentication where required, and
      tell an administrator promptly if you believe your account has been compromised. Administrators may suspend
      accounts to protect the system or department records.
    </p>

    <h2 className={sectionHeading}>Acceptable use</h2>
    <ul className={listClass}>
      <li>Use the system for department business only.</li>
      <li>
        Do not access records beyond your role, share other members&rsquo; personal or health information outside proper
        channels, or attempt to bypass security controls.
      </li>
      <li>
        Content you post (documents, minutes, form responses) must be accurate and appropriate for a department record —
        much of it may be an official record subject to retention and disclosure rules.
      </li>
    </ul>

    <h2 className={sectionHeading}>Availability</h2>
    <p className={bodyText}>
      The department aims to keep the system available but does not guarantee uninterrupted service. Operational
      decisions must never depend solely on this system&rsquo;s availability.
    </p>

    <h2 className={sectionHeading}>Changes</h2>
    <p className={bodyText}>
      The department may update these terms; continued use after an update constitutes acceptance. Material changes will
      be communicated through normal department channels.
    </p>
  </>
);

const CustomText: React.FC<{ text: string }> = ({ text }) => (
  <div className="mt-4">
    {text.split(/\n{2,}/).map((paragraph, i) => (
      <p key={i} className={`${bodyText} whitespace-pre-line`}>
        {paragraph}
      </p>
    ))}
  </div>
);

const LegalPage: React.FC = () => {
  const location = useLocation();
  const isPrivacy = location.pathname.startsWith('/privacy');
  const [legal, setLegal] = useState<LegalTextResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<LegalTextResponse>('/api/public/v1/legal')
      .then((res) => {
        if (!cancelled) setLegal(res.data);
      })
      .catch(() => {
        // Defaults render fine without the endpoint.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const orgName = legal?.organizationName || 'the department';
  const customText = isPrivacy ? legal?.privacyPolicy : legal?.termsOfService;
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';

  return (
    <main
      className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-12 sm:px-6 lg:px-8"
      id="main-content"
    >
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Legal pages">
          <Link to="/login" className="text-theme-accent-red text-sm font-medium hover:underline">
            &larr; Back to sign in
          </Link>
          <span className="text-theme-text-muted mx-3">|</span>
          <Link
            to={isPrivacy ? '/terms' : '/privacy'}
            className="text-theme-accent-red text-sm font-medium hover:underline"
          >
            {isPrivacy ? 'Terms of Service' : 'Privacy Policy'}
          </Link>
        </nav>

        <h1 className="text-theme-text-primary mt-6 text-3xl font-extrabold">{title}</h1>

        {customText ? (
          <CustomText text={customText} />
        ) : isPrivacy ? (
          <DefaultPrivacyPolicy orgName={orgName} />
        ) : (
          <DefaultTermsOfService orgName={orgName} />
        )}

        <footer className="border-theme-surface-border mt-12 border-t pt-4">
          <p className="text-theme-text-muted text-xs">
            &copy; {new Date().getFullYear()} {legal?.organizationName || 'Your Organization'}. Powered by The Logbook.
          </p>
        </footer>
      </div>
    </main>
  );
};

export default LegalPage;
