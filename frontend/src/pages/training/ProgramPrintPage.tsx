/**
 * Printable Training Program / Pipeline Record
 *
 * Paper-formatted training program details showing structure,
 * phases, requirements, and enrolled members with progress.
 *
 * URL: /training/print/program?id=<program_id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trainingProgramService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom } from '../../utils/dateFormatting';
import type {
  ProgramWithDetails,
  ProgramEnrollment,
} from '../../types/training';

const ProgramPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const programId = searchParams.get('id') || '';
  const tz = useTimezone();

  const [program, setProgram] = useState<(ProgramWithDetails & { enrollments?: ProgramEnrollment[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!programId) {
      setError('No program ID provided');
      setLoading(false);
      return;
    }
    trainingProgramService.getProgram(programId)
      .then(p => setProgram(p as ProgramWithDetails & { enrollments?: ProgramEnrollment[] }))
      .catch(() => setError('Failed to load program'))
      .finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => {
    if (loading || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Loading program...</p></div>;
  }
  if (error || !program) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-red-600">{error || 'Program not found'}</p></div>;
  }

  const fmtDate = (d?: string) => d ? formatDateCustom(d, { month: 'short', day: 'numeric', year: 'numeric' }, tz) : '—';

  const phases = program.phases || [];
  const requirements = program.requirements || [];
  const enrollments = program.enrollments || [];

  const sectionHeading: React.CSSProperties = {
    fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', borderBottom: '1px solid #ddd',
    paddingBottom: '3pt', marginBottom: '6pt', marginTop: '16pt',
  };
  const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '3pt 6pt', fontSize: '9pt', verticalAlign: 'top' };
  const headerCell: React.CSSProperties = { ...cellStyle, fontWeight: 600, backgroundColor: '#f5f5f5', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.03em' };

  return (
    <>
      <style>{`
        @media print { @page { size: letter; margin: 0.5in 0.6in; } body { margin: 0; } }
        @media screen { body { background: #f3f4f6; } }
      `}</style>

      <div className="max-w-[8.5in] mx-auto bg-white print:shadow-none shadow-lg my-8 print:my-0">
        <div className="p-8 print:p-0" style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', fontSize: '10pt', lineHeight: '1.5' }}>

          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '10pt', marginBottom: '14pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>Training Program</h1>
                <p style={{ fontSize: '14pt', margin: '0 0 4pt 0' }}>{program.name}</p>
                {program.description && (
                  <p style={{ fontSize: '10pt', color: '#555', margin: 0, maxWidth: '5in' }}>{program.description}</p>
                )}
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Generated: {new Date().toLocaleDateString()}</p>
                {program.code && <p style={{ margin: 0 }}>Code: {program.code}</p>}
                {program.version && <p style={{ margin: 0 }}>Version: {program.version}</p>}
              </div>
            </div>
          </div>

          {/* Program Details Grid */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14pt' }}>
            <tbody>
              <tr>
                <td style={cellStyle}><strong>Structure:</strong> {program.structure_type?.replace(/_/g, ' ') || '—'}</td>
                <td style={cellStyle}><strong>Target Position:</strong> {program.target_position || 'All'}</td>
                <td style={cellStyle}><strong>Time Limit:</strong> {program.time_limit_days ? `${program.time_limit_days} days` : 'None'}</td>
                <td style={cellStyle}><strong>Enrolled:</strong> {enrollments.length}</td>
              </tr>
            </tbody>
          </table>

          {/* Phases */}
          {phases.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Program Phases</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCell, width: '40pt' }}>#</th>
                    <th style={headerCell}>Phase Name</th>
                    <th style={headerCell}>Description</th>
                    <th style={{ ...headerCell, width: '80pt' }}>Time Limit</th>
                    <th style={{ ...headerCell, width: '80pt' }}>Requirements</th>
                  </tr>
                </thead>
                <tbody>
                  {phases
                    .sort((a, b) => a.phase_number - b.phase_number)
                    .map(phase => {
                      const phaseReqs = requirements.filter(r => r.phase_id === phase.id);
                      return (
                        <tr key={phase.id}>
                          <td style={{ ...cellStyle, textAlign: 'center' }}>{phase.phase_number}</td>
                          <td style={{ ...cellStyle, fontWeight: 600 }}>{phase.name}</td>
                          <td style={cellStyle}>{phase.description || '—'}</td>
                          <td style={{ ...cellStyle, textAlign: 'center' }}>{phase.time_limit_days ? `${phase.time_limit_days}d` : '—'}</td>
                          <td style={{ ...cellStyle, textAlign: 'center' }}>{phaseReqs.length}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Requirements */}
          {requirements.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Program Requirements</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Requirement</th>
                    <th style={headerCell}>Phase</th>
                    <th style={{ ...headerCell, width: '60pt' }}>Required</th>
                    <th style={headerCell}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map(req => {
                      const phase = phases.find(p => p.id === req.phase_id);
                      return (
                        <tr key={req.id}>
                          <td style={cellStyle}>{req.requirement?.name || '—'}</td>
                          <td style={cellStyle}>{phase?.name || '—'}</td>
                          <td style={{ ...cellStyle, textAlign: 'center' }}>{req.is_required ? 'Yes' : 'Optional'}</td>
                          <td style={cellStyle}>{req.program_specific_description || req.requirement?.description || '—'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Enrolled Members */}
          {enrollments.length > 0 && (
            <div style={{ pageBreakBefore: phases.length > 3 ? 'always' : 'auto' }}>
              <h2 style={sectionHeading}>Enrolled Members</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Member</th>
                    <th style={headerCell}>Status</th>
                    <th style={{ ...headerCell, width: '70pt' }}>Progress</th>
                    <th style={headerCell}>Enrolled</th>
                    <th style={headerCell}>Target</th>
                    <th style={headerCell}>Current Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map(e => (
                    <tr key={e.id}>
                      <td style={cellStyle}>{(e as unknown as { user_name?: string }).user_name || e.user_id}</td>
                      <td style={{ ...cellStyle, textTransform: 'capitalize' }}>{e.status}</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        {Math.round(e.progress_percentage)}%
                      </td>
                      <td style={cellStyle}>{fmtDate(e.enrolled_at)}</td>
                      <td style={cellStyle}>{fmtDate(e.target_completion_date)}</td>
                      <td style={cellStyle}>{e.current_phase?.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: '24pt', borderTop: '1px solid #ddd', paddingTop: '6pt', display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#aaa' }}>
            <span>The Logbook — Training Program Record</span>
            <span>Generated {new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProgramPrintPage;
