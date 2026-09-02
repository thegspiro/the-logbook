import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import axios from 'axios';

import LegalSections from './LegalSections';
import { PRIVACY_POLICY_SECTIONS, TERMS_OF_SERVICE_SECTIONS } from './legalContent';
import { bodyText } from './legalStyles';

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
  privacyPolicyLastUpdated: string | null;
  termsOfServiceLastUpdated: string | null;
}

/**
 * Revision date of the built-in defaults. Reviewers of a privacy notice expect
 * to see when it last changed, so bump this whenever the text in
 * legalContent.ts is edited. A department publishing its own wording supplies
 * its own date, stored per document type (settings["legal"]["privacy_policy_
 * effective_date"] / "terms_of_service_effective_date") so publishing one
 * document never misdates the other.
 */
const DEFAULT_LEGAL_LAST_UPDATED = 'August 17, 2026';

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
  // A department's own wording carries its own revision date, per document;
  // the built-in date describes only the built-in text and would misdate
  // custom text.
  const customLastUpdated = isPrivacy ? legal?.privacyPolicyLastUpdated : legal?.termsOfServiceLastUpdated;
  const lastUpdated = customText ? customLastUpdated : DEFAULT_LEGAL_LAST_UPDATED;

  return (
    <main
      className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-12 sm:px-6 lg:px-8"
      id="main-content"
      tabIndex={-1}
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
        {lastUpdated ? <p className="text-theme-text-muted mt-2 text-xs">Last updated: {lastUpdated}</p> : null}

        {customText ? (
          <CustomText text={customText} />
        ) : (
          <LegalSections sections={isPrivacy ? PRIVACY_POLICY_SECTIONS : TERMS_OF_SERVICE_SECTIONS} orgName={orgName} />
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
