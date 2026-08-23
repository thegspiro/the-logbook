/**
 * The unsaved state of one email template.
 *
 * Lifted out of `TemplateEditor` because two things outside the editor card
 * now need it: the sticky Save/Discard pair in the page header, and the live
 * preview, which renders the body you are typing rather than the one on the
 * server. Both were previously impossible — the draft only existed inside the
 * component that drew the form.
 */

import { useCallback, useMemo, useState, useEffect } from 'react';
import type { EmailTemplate, EmailTemplateUpdate } from '../types';
import { validateEmailList, parseEmailList } from '../../../hooks/useEmailListInput';

export interface TemplateDraft {
  subject: string;
  setSubject: (value: string) => void;
  htmlBody: string;
  setHtmlBody: (value: string | ((prev: string) => string)) => void;
  textBody: string;
  setTextBody: (value: string) => void;
  cssStyles: string;
  setCssStyles: (value: string) => void;
  footerKey: string;
  setFooterKey: (value: string) => void;
  headerAccent: string;
  setHeaderAccent: (value: string) => void;
  statusChip: string;
  setStatusChip: (value: string) => void;
  layout: string;
  setLayout: (value: string) => void;
  defaultCc: string;
  setDefaultCc: (value: string) => void;
  defaultBcc: string;
  setDefaultBcc: (value: string) => void;
  ccError: string | null;
  bccError: string | null;
  hasValidationErrors: boolean;
  isDirty: boolean;
  /** Fields that actually changed, ready to PATCH. */
  buildUpdate: () => EmailTemplateUpdate;
  discard: () => void;
}

const EMPTY_TEMPLATE = {
  id: '',
  subject: '',
  html_body: '',
  text_body: '',
  css_styles: '',
  footer_key: '',
  header_accent: '',
  status_chip: '',
  layout: '',
} as const;

export function useTemplateDraft(template: EmailTemplate | null): TemplateDraft {
  const source = template ?? (EMPTY_TEMPLATE as unknown as EmailTemplate);
  const origCc = (source.default_cc ?? []).join(', ');
  const origBcc = (source.default_bcc ?? []).join(', ');

  const [subject, setSubject] = useState(source.subject);
  const [htmlBody, setHtmlBody] = useState(source.html_body);
  const [textBody, setTextBody] = useState(source.text_body ?? '');
  const [cssStyles, setCssStyles] = useState(source.css_styles ?? '');
  const [footerKey, setFooterKey] = useState(source.footer_key ?? '');
  const [headerAccent, setHeaderAccent] = useState(source.header_accent ?? '');
  const [statusChip, setStatusChip] = useState(source.status_chip ?? '');
  const [layout, setLayout] = useState(source.layout ?? '');
  const [defaultCc, setDefaultCc] = useState(origCc);
  const [defaultBcc, setDefaultBcc] = useState(origBcc);

  const discard = useCallback(() => {
    setSubject(source.subject);
    setHtmlBody(source.html_body);
    setTextBody(source.text_body ?? '');
    setCssStyles(source.css_styles ?? '');
    setFooterKey(source.footer_key ?? '');
    setHeaderAccent(source.header_accent ?? '');
    setStatusChip(source.status_chip ?? '');
    setLayout(source.layout ?? '');
    setDefaultCc((source.default_cc ?? []).join(', '));
    setDefaultBcc((source.default_bcc ?? []).join(', '));
  }, [source]);

  // Re-seed when a different template is selected, or when a save comes back
  // and the server's copy is now the baseline.
  useEffect(() => {
    discard();
  }, [discard]);

  const ccError = validateEmailList(defaultCc);
  const bccError = validateEmailList(defaultBcc);

  const isDirty =
    subject !== source.subject ||
    htmlBody !== source.html_body ||
    textBody !== (source.text_body ?? '') ||
    cssStyles !== (source.css_styles ?? '') ||
    footerKey !== (source.footer_key ?? '') ||
    headerAccent !== (source.header_accent ?? '') ||
    statusChip !== (source.status_chip ?? '') ||
    layout !== (source.layout ?? '') ||
    defaultCc !== origCc ||
    defaultBcc !== origBcc;

  const buildUpdate = useCallback((): EmailTemplateUpdate => {
    const data: EmailTemplateUpdate = {};
    if (subject !== source.subject) data.subject = subject;
    if (htmlBody !== source.html_body) data.html_body = htmlBody;
    if (textBody !== (source.text_body ?? '')) data.text_body = textBody;
    if (cssStyles !== (source.css_styles ?? '')) data.css_styles = cssStyles;
    // Sent as '' rather than omitted when cleared: an omitted key means
    // "leave this alone" to the backend's exclude_unset update, so the
    // template would keep its old footer behind a success toast.
    if (footerKey !== (source.footer_key ?? '')) data.footer_key = footerKey;
    // These three have no "clear it" state the UI can reach — a template
    // always has an accent, a chip and a layout once it has been created —
    // so they are only ever sent as a value, never as null.
    if (headerAccent !== (source.header_accent ?? '')) data.header_accent = headerAccent;
    if (statusChip !== (source.status_chip ?? '')) data.status_chip = statusChip;
    if (layout !== (source.layout ?? '')) data.layout = layout;
    if (defaultCc !== (source.default_cc ?? []).join(', ')) {
      const parsed = parseEmailList(defaultCc);
      data.default_cc = parsed.length > 0 ? parsed : null;
    }
    if (defaultBcc !== (source.default_bcc ?? []).join(', ')) {
      const parsed = parseEmailList(defaultBcc);
      data.default_bcc = parsed.length > 0 ? parsed : null;
    }
    return data;
  }, [
    source,
    subject,
    htmlBody,
    textBody,
    cssStyles,
    footerKey,
    headerAccent,
    statusChip,
    layout,
    defaultCc,
    defaultBcc,
  ]);

  return useMemo(
    () => ({
      subject,
      setSubject,
      htmlBody,
      setHtmlBody,
      textBody,
      setTextBody,
      cssStyles,
      setCssStyles,
      footerKey,
      setFooterKey,
      headerAccent,
      setHeaderAccent,
      statusChip,
      setStatusChip,
      layout,
      setLayout,
      defaultCc,
      setDefaultCc,
      defaultBcc,
      setDefaultBcc,
      ccError,
      bccError,
      hasValidationErrors: ccError !== null || bccError !== null,
      isDirty,
      buildUpdate,
      discard,
    }),
    [
      subject,
      htmlBody,
      textBody,
      cssStyles,
      footerKey,
      headerAccent,
      statusChip,
      layout,
      defaultCc,
      defaultBcc,
      ccError,
      bccError,
      isDirty,
      buildUpdate,
      discard,
    ]
  );
}
