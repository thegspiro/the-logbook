/**
 * Printable Blank Skill Sheet
 *
 * A skill template laid out as the paper form an examiner carries on a
 * clipboard: marking boxes, a place to write the candidate and examiner, and
 * signature lines. Deliberately *blank* — this is not a record of a test, it is
 * the form you fill in with a pen.
 *
 * Why it exists. A skills evaluation happens at a burn tower, in the back of an
 * apparatus bay, or at a county training ground — places with no usable signal,
 * where `ActiveSkillTestPage` cannot save and every mark lives in browser
 * memory until it can. Full offline support is scoped separately
 * (docs/SKILLS_TESTING_OFFLINE_PLAN.md) and is blocked on policy decisions
 * about shared-station devices. Paper is what departments already fall back to,
 * and printing the department's own sheet — rather than a generic one — means
 * what gets marked in the field matches what gets transcribed afterwards.
 *
 * Everything here is laid out to be transcribed back into the app: sections and
 * criteria are numbered exactly as the examiner screen numbers them, and each
 * criterion type gets the marking affordance its on-screen control produces, so
 * a paper mark maps onto one field with no interpretation in between.
 *
 * URL: /training/skills-testing/print/template?id=<template_id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { skillsTestingService } from '../../services/trainingServices';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';
import { hydrateTemplateSections } from '../../utils/skillTemplateSections';
import type { SkillCriterion, SkillTemplate, SkillTemplateSection } from '../../types/skillsTesting';

/** An empty box to tick. Drawn rather than a character so it prints at a
 *  consistent size on every printer and in every font fallback. */
const Box: React.FC<{ label?: string }> = ({ label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3pt', whiteSpace: 'nowrap' }}>
    <span
      style={{
        display: 'inline-block',
        width: '10pt',
        height: '10pt',
        border: '1pt solid #333',
        verticalAlign: 'middle',
      }}
    />
    {label && <span style={{ fontSize: '8pt' }}>{label}</span>}
  </span>
);

/** A ruled blank for handwriting. `width` is a CSS length. */
const Rule: React.FC<{ width: string; label?: string }> = ({ width, label }) => (
  <span style={{ whiteSpace: 'nowrap' }}>
    {label && <span style={{ fontSize: '9pt', color: '#444' }}>{label} </span>}
    <span style={{ display: 'inline-block', width, borderBottom: '1pt solid #666', height: '11pt' }} />
  </span>
);

const cellStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '4pt 6pt',
  fontSize: '9pt',
  verticalAlign: 'top',
};

const headerCell: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  backgroundColor: '#f5f5f5',
  fontSize: '8pt',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const sectionHeading: React.CSSProperties = {
  fontSize: '11pt',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #ddd',
  paddingBottom: '3pt',
  marginBottom: '6pt',
  marginTop: '16pt',
};

/**
 * The marking affordance for one criterion, matching what the examiner screen
 * would render for that type.
 *
 * A `statement` gets none: it is read aloud and marks itself as the section
 * renders, and is excluded from every tally. Giving it a P/F box on paper would
 * invite a mark that has nowhere to go when the sheet is transcribed.
 */
const MarkingCell: React.FC<{ criterion: SkillCriterion }> = ({ criterion }) => {
  switch (criterion.type) {
    case 'score':
      return (
        <span style={{ whiteSpace: 'nowrap', fontSize: '9pt' }}>
          <Rule width="26pt" />
          {criterion.max_score != null && <span> / {criterion.max_score}</span>}
          {criterion.passing_score != null && (
            <span style={{ color: '#666', fontSize: '8pt' }}> (min {criterion.passing_score})</span>
          )}
        </span>
      );
    case 'time_limit':
      return (
        <span style={{ whiteSpace: 'nowrap', fontSize: '9pt' }}>
          <Rule width="30pt" /> <span style={{ fontSize: '8pt' }}>sec</span>
          {criterion.time_limit_seconds != null && (
            <span style={{ color: '#666', fontSize: '8pt' }}> (max {criterion.time_limit_seconds}s)</span>
          )}
        </span>
      );
    case 'checklist':
      return (
        <span style={{ display: 'inline-flex', gap: '8pt' }}>
          <Box label="P" />
          <Box label="F" />
        </span>
      );
    case 'statement':
      return <span style={{ fontSize: '8pt', color: '#888' }}>read aloud</span>;
    case 'pass_fail':
    default:
      return (
        <span style={{ display: 'inline-flex', gap: '8pt' }}>
          <Box label="P" />
          <Box label="F" />
        </span>
      );
  }
};

const CriterionRow: React.FC<{ criterion: SkillCriterion; index: number }> = ({ criterion, index }) => (
  <tr style={{ pageBreakInside: 'avoid' }}>
    <td style={{ ...cellStyle, width: '22pt', textAlign: 'center', color: '#666' }}>{index + 1}</td>
    <td style={cellStyle}>
      <span style={{ fontWeight: criterion.required ? 600 : 400 }}>{criterion.label}</span>
      {/* Critical steps decide the outcome on their own when the template
          requires all of them, so they have to be unmissable on paper. */}
      {criterion.required && <span style={{ color: '#b00', fontWeight: 700, fontSize: '8pt' }}> ★ CRITICAL</span>}
      {criterion.description && (
        <div style={{ color: '#555', fontSize: '8pt', marginTop: '2pt' }}>{criterion.description}</div>
      )}
      {criterion.type === 'statement' && criterion.statement_text && (
        <div
          style={{
            marginTop: '3pt',
            padding: '3pt 5pt',
            borderLeft: '2pt solid #888',
            background: '#fafafa',
            fontStyle: 'italic',
            fontSize: '8.5pt',
          }}
        >
          {criterion.statement_text}
          {criterion.starts_timer && <strong style={{ fontStyle: 'normal' }}> — START THE CLOCK</strong>}
        </div>
      )}
      {criterion.type === 'checklist' && (criterion.checklist_items?.length ?? 0) > 0 && (
        <div style={{ marginTop: '3pt', display: 'flex', flexDirection: 'column', gap: '2pt' }}>
          {(criterion.checklist_items ?? []).map((item, i) => (
            <span key={i} style={{ fontSize: '8.5pt' }}>
              <Box /> <span style={{ marginLeft: '2pt' }}>{item}</span>
            </span>
          ))}
        </div>
      )}
    </td>
    <td style={{ ...cellStyle, width: '86pt', textAlign: 'center' }}>
      <MarkingCell criterion={criterion} />
    </td>
    <td style={{ ...cellStyle, width: '150pt' }} />
  </tr>
);

const SectionBlock: React.FC<{
  section: SkillTemplateSection;
  sectionNumber: number;
  sectionCount: number;
}> = ({ section, sectionNumber, sectionCount }) => (
  <div style={{ pageBreakInside: 'avoid' }}>
    <h2 style={sectionHeading}>
      Section {sectionNumber} of {sectionCount} — {section.name}
    </h2>
    {section.description && (
      <p style={{ fontSize: '9pt', color: '#555', margin: '0 0 6pt 0' }}>{section.description}</p>
    )}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...headerCell, width: '22pt' }}>#</th>
          <th style={headerCell}>Step</th>
          <th style={{ ...headerCell, width: '86pt', textAlign: 'center' }}>Result</th>
          <th style={{ ...headerCell, width: '150pt' }}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {section.criteria.map((criterion, index) => (
          <CriterionRow key={criterion.id} criterion={criterion} index={index} />
        ))}
      </tbody>
    </table>
  </div>
);

const SkillSheetPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('id') || '';
  const tz = useTimezone();

  const [template, setTemplate] = useState<SkillTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!templateId) {
      setError('No template ID provided');
      setLoading(false);
      return;
    }
    skillsTestingService
      .getTemplate(templateId)
      .then(setTemplate)
      .catch(() => setError('Failed to load skill sheet'))
      .finally(() => setLoading(false));
  }, [templateId]);

  useEffect(() => {
    if (loading || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading skill sheet...</p>
      </div>
    );
  }
  if (error || !template) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{error || 'Skill sheet not found'}</p>
      </div>
    );
  }

  // The same hydration the examiner screen uses, so the numbering on paper is
  // the numbering on screen — and an unrenderable stored type falls back to
  // pass/fail here exactly as it does there, rather than printing a step with
  // no way to mark it.
  const sections = hydrateTemplateSections(template.sections as unknown as Record<string, unknown>[]);
  const totalCriteria = sections.reduce((sum, s) => sum + s.criteria.length, 0);
  const criticalCount = sections.reduce(
    (sum, s) => sum + s.criteria.filter((c) => c.required && c.type !== 'statement').length,
    0
  );

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in 0.6in; }
        @media print { body { margin: 0; } }
        @media screen { body { background: #f3f4f6; } }
      `}</style>

      <div className="mx-auto my-8 max-w-[8.5in] bg-white shadow-lg print:my-0 print:shadow-none">
        <div
          className="p-8 print:p-0"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: '#111',
            fontSize: '10pt',
            lineHeight: '1.5',
          }}
        >
          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '10pt', marginBottom: '12pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>Skill Evaluation Sheet</h1>
                <p style={{ fontSize: '14pt', margin: '0 0 4pt 0' }}>{template.name}</p>
                {template.description && (
                  <p style={{ fontSize: '10pt', color: '#555', margin: 0, maxWidth: '5in' }}>{template.description}</p>
                )}
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Printed: {formatDate(new Date(), tz)}</p>
                {template.category && <p style={{ margin: 0 }}>{template.category}</p>}
                <p style={{ margin: 0 }}>Template version: {template.version}</p>
              </div>
            </div>
          </div>

          {/* Who this sheet is for. A blank form with nowhere to write the
              candidate's name is the single fastest way to end up with an
              unattributable scorecard at the end of a drill night. */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10pt' }}>
            <tbody>
              <tr>
                <td style={{ ...cellStyle, width: '50%' }}>
                  <Rule label="Candidate:" width="2.2in" />
                </td>
                <td style={cellStyle}>
                  <Rule label="Examiner:" width="2.2in" />
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>
                  <Rule label="Date:" width="1in" /> <Rule label="Start:" width="0.6in" />{' '}
                  <Rule label="Stop:" width="0.6in" />
                </td>
                <td style={cellStyle}>
                  <span style={{ display: 'inline-flex', gap: '14pt', alignItems: 'center' }}>
                    <Box label="Official evaluation" />
                    <Box label="Practice run" />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Scoring rules — the same ones the examiner screen states out loud
              before a test is submitted. On paper they have to be read before
              the first mark, not after. */}
          <div
            style={{
              border: '1pt solid #333',
              padding: '6pt 8pt',
              marginBottom: '6pt',
              fontSize: '9pt',
              background: '#fafafa',
            }}
          >
            <strong style={{ textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em' }}>
              Scoring rules
            </strong>
            <div style={{ marginTop: '3pt' }}>
              {template.passing_percentage != null ? (
                <span>
                  Passing score: <strong>{template.passing_percentage}%</strong>.{' '}
                </span>
              ) : (
                <span>No overall percentage threshold. </span>
              )}
              {template.time_limit_seconds != null && (
                <span>
                  Overall time limit: <strong>{Math.round(template.time_limit_seconds / 60)} min</strong>.{' '}
                </span>
              )}
              <span>
                {totalCriteria} step{totalCriteria === 1 ? '' : 's'} across {sections.length} section
                {sections.length === 1 ? '' : 's'}
                {criticalCount > 0 && <span>, {criticalCount} marked critical</span>}.
              </span>
            </div>
            {template.require_all_critical && criticalCount > 0 && (
              <div style={{ marginTop: '3pt', color: '#b00' }}>
                Every step marked <strong>★ CRITICAL</strong> must pass. Leaving one unmarked counts the same as a fail.
              </div>
            )}
          </div>

          {sections.map((section, index) => (
            <SectionBlock key={section.id} section={section} sectionNumber={index + 1} sectionCount={sections.length} />
          ))}

          {/* Outcome and signatures */}
          <div style={{ marginTop: '18pt', pageBreakInside: 'avoid' }}>
            <h2 style={sectionHeading}>Outcome</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={cellStyle}>
                    <span style={{ display: 'inline-flex', gap: '16pt', alignItems: 'center' }}>
                      <strong style={{ fontSize: '9pt' }}>Result:</strong>
                      <Box label="PASS" />
                      <Box label="FAIL" />
                      <Box label="INCOMPLETE" />
                    </span>
                  </td>
                  <td style={{ ...cellStyle, width: '40%' }}>
                    <Rule label="Score:" width="0.7in" /> <span style={{ fontSize: '9pt' }}>%</span>
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ ...cellStyle, height: '46pt' }}>
                    <span style={{ fontSize: '8pt', color: '#666' }}>Examiner comments</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ ...cellStyle, height: '34pt' }}>
                    <Rule label="Examiner signature:" width="1.6in" />
                  </td>
                  <td style={{ ...cellStyle, height: '34pt' }}>
                    <Rule label="Candidate signature:" width="1.5in" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* A paper sheet is a fallback, not a record. Nothing on it counts
              toward a certification, credits a pipeline requirement or reaches
              the candidate until someone enters it — so the sheet says so. */}
          <div
            style={{
              marginTop: '10pt',
              border: '1pt dashed #999',
              padding: '5pt 8pt',
              fontSize: '8.5pt',
              color: '#444',
            }}
          >
            <strong>This sheet is not the record.</strong> Enter the result in The Logbook under Training → Skills
            Testing. Until it is entered and validated by a training officer it credits no requirement, consumes no
            attempt, and the candidate sees nothing.
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: '16pt',
              borderTop: '1px solid #ddd',
              paddingTop: '6pt',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '8pt',
              color: '#aaa',
            }}
          >
            <span>The Logbook — Skill Evaluation Sheet</span>
            <span>
              {template.name} (v{template.version}) — printed {formatDate(new Date(), tz)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default SkillSheetPrintPage;
