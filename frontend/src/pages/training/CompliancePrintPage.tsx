/**
 * Printable Compliance Matrix
 *
 * Paper-formatted department-wide compliance report showing all
 * members' training status against requirements. Designed for
 * annual reviews, audits, and regulatory compliance filing.
 *
 * URL: /training/print/compliance
 */

import React, { useState, useEffect } from 'react';
import { trainingService } from '../../services/api';
import type { ComplianceMatrix, ComplianceMatrixMember } from '../../services/communicationsServices';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import PrintPageStyles from '@/components/print/PrintPageStyles';

// A member's row carries a cell only for requirements that apply to them, so a
// missing cell is "does not apply". "Not started" printed the same dash, which
// made an unmet requirement indistinguishable from one the member is exempt from.
const cellMark = (status: string | undefined): string => {
  if (status === undefined) return '—';
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '◐';
  if (status === 'expired') return 'Exp';
  return '✗';
};

const CompliancePrintPage: React.FC = () => {
  const tz = useTimezone();
  const [matrix, setMatrix] = useState<ComplianceMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    trainingService
      .getComplianceMatrix()
      .then(setMatrix)
      .catch(() => setError('Failed to load compliance matrix'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading compliance data...</p>
      </div>
    );
  }
  if (error || !matrix) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{error || 'No data available'}</p>
      </div>
    );
  }

  const members: ComplianceMatrixMember[] = matrix.members || [];
  const requirements = matrix.requirements || [];
  // Counted from the standing the backend decided, as the on-screen matrix is.
  // Bucketing on completion_pct called a member with 4 of 6 hours "not
  // started", and ignored the department's thresholds entirely.
  const compliant = members.filter((m) => m.standing === 'compliant').length;
  const atRisk = members.filter((m) => m.standing === 'at_risk').length;
  const nonCompliant = members.filter((m) => m.standing === 'non_compliant').length;

  const cellStyle: React.CSSProperties = {
    border: '1px solid #ccc',
    padding: '3pt 6pt',
    fontSize: '8.5pt',
    verticalAlign: 'top',
  };
  const headerCell: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    backgroundColor: '#f5f5f5',
    fontSize: '7.5pt',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };

  return (
    <>
      <PrintPageStyles size="letter landscape" margin="0.4in 0.5in" />

      <div className="mx-auto my-8 max-w-[11in] bg-white shadow-lg print:my-0 print:shadow-none">
        <div
          className="p-6 print:p-0"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', fontSize: '9pt', lineHeight: '1.4' }}
        >
          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '8pt', marginBottom: '12pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '16pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>
                  Training Compliance Report
                </h1>
                <p style={{ fontSize: '10pt', color: '#555', margin: 0 }}>Department-Wide Compliance Matrix</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Generated: {formatDate(new Date(), tz)}</p>
                <p style={{ margin: 0 }}>Total Members: {members.length}</p>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12pt' }}>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '6pt 10pt', width: '25%', textAlign: 'center' }}>
                  <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#166534' }}>{compliant}</div>
                  <div style={{ fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Compliant
                  </div>
                </td>
                <td style={{ border: '1px solid #ccc', padding: '6pt 10pt', width: '25%', textAlign: 'center' }}>
                  <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#92400e' }}>{atRisk}</div>
                  <div style={{ fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    At Risk
                  </div>
                </td>
                <td style={{ border: '1px solid #ccc', padding: '6pt 10pt', width: '25%', textAlign: 'center' }}>
                  <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#991b1b' }}>{nonCompliant}</div>
                  <div style={{ fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Non-Compliant
                  </div>
                </td>
                <td style={{ border: '1px solid #ccc', padding: '6pt 10pt', width: '25%', textAlign: 'center' }}>
                  <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>{requirements.length}</div>
                  <div style={{ fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Requirements
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Member Matrix */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headerCell}>Member</th>
                <th style={{ ...headerCell, textAlign: 'center' }}>Completion</th>
                {requirements.map((r) => (
                  <th
                    key={r.id}
                    style={{
                      ...headerCell,
                      textAlign: 'center',
                      fontSize: '6.5pt',
                      maxWidth: '60pt',
                      // Wrapped, not truncated: paper has no tooltip to recover
                      // "ANNUAL HAZMA…".
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    }}
                    title={r.name}
                  >
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members
                .sort((a, b) => a.completion_pct - b.completion_pct)
                .map((m) => (
                  <tr key={m.user_id}>
                    <td style={cellStyle}>{m.member_name}</td>
                    <td
                      style={{
                        ...cellStyle,
                        textAlign: 'center',
                        fontWeight: 600,
                        color: m.completion_pct >= 100 ? '#166534' : m.completion_pct > 0 ? '#92400e' : '#991b1b',
                      }}
                    >
                      {Math.round(m.completion_pct)}%
                    </td>
                    {requirements.map((req) => {
                      const memberReq = m.requirements.find((r) => r.requirement_id === req.id);
                      return (
                        <td key={req.id} style={{ ...cellStyle, textAlign: 'center', fontSize: '8pt' }}>
                          {cellMark(memberReq?.status)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
          <p style={{ margin: '4pt 0 0', fontSize: '7.5pt', color: '#555' }}>
            ✓ met · ◐ in progress · ✗ not started · Exp expired · — does not apply to this member
          </p>

          {/* Signature Block */}
          <div style={{ marginTop: '24pt', pageBreakInside: 'avoid' }}>
            <div style={{ borderTop: '2px solid #111', paddingTop: '12pt' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '50%', paddingRight: '20pt', verticalAlign: 'bottom' }}>
                      <p
                        style={{
                          margin: '0 0 24pt 0',
                          fontSize: '8pt',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: '#555',
                        }}
                      >
                        Training Officer
                      </p>
                      <div style={{ borderBottom: '1px solid #999', marginBottom: '4pt' }} />
                      <p style={{ margin: 0, fontSize: '8pt', color: '#999' }}>Signature / Date</p>
                    </td>
                    <td style={{ width: '50%', paddingLeft: '20pt', verticalAlign: 'bottom' }}>
                      <p
                        style={{
                          margin: '0 0 24pt 0',
                          fontSize: '8pt',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: '#555',
                        }}
                      >
                        Chief / Department Head
                      </p>
                      <div style={{ borderBottom: '1px solid #999', marginBottom: '4pt' }} />
                      <p style={{ margin: 0, fontSize: '8pt', color: '#999' }}>Signature / Date</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: '12pt',
              borderTop: '1px solid #ddd',
              paddingTop: '4pt',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '7pt',
              color: '#aaa',
            }}
          >
            <span>The Logbook — Training Compliance Report</span>
            <span>Generated {formatDate(new Date(), tz)}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default CompliancePrintPage;
