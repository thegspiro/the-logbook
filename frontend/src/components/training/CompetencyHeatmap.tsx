/**
 * Department competency heat-map: members down the side, skills across the
 * top, each cell the member's current Dreyfus level.
 *
 * Every cell is a stored MemberCompetency row exactly as the member's own
 * competency view reports it — the same rows `/training/competency/members/
 * {id}` serves, fetched for the whole department in one request. Nothing here
 * grades or adjusts a level; an empty cell means no evaluation is on record.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { competencyService } from '../../services/trainingServices';
import useLoadData from '../../hooks/useLoadData';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';
import type { CompetencyHeatmap as HeatmapData, MemberCompetency } from '../../types/training';

const COMPETENCY_LEVELS = [
  { level: 'novice', label: 'Novice', short: 'N', color: 'bg-slate-300 text-slate-900' },
  { level: 'advanced_beginner', label: 'Advanced Beginner', short: 'AB', color: 'bg-blue-300 text-blue-950' },
  { level: 'competent', label: 'Competent', short: 'C', color: 'bg-green-300 text-green-950' },
  { level: 'proficient', label: 'Proficient', short: 'P', color: 'bg-yellow-300 text-yellow-950' },
  { level: 'expert', label: 'Expert', short: 'E', color: 'bg-red-300 text-red-950' },
] as const;

const levelInfo = (level: string) => COMPETENCY_LEVELS.find((l) => l.level === level);

const EMPTY: HeatmapData = { members: [], skills: [], competencies: [] };

const uniqueSorted = (values: (string | null | undefined)[]): string[] =>
  Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));

export const CompetencyHeatmap: React.FC = () => {
  const tz = useTimezone();
  const load = useCallback(() => competencyService.getDepartmentCompetencies(), []);
  const { data, loading } = useLoadData(load, EMPTY);
  const [station, setStation] = useState('');
  const [rank, setRank] = useState('');
  const [category, setCategory] = useState('');

  const cellByMemberSkill = useMemo(() => {
    const map = new Map<string, MemberCompetency>();
    for (const c of data.competencies) {
      // Newest first from the API, so the first row seen for a pair wins.
      const key = `${c.user_id}:${c.skill_evaluation_id}`;
      if (!map.has(key)) map.set(key, c);
    }
    return map;
  }, [data.competencies]);

  const stations = useMemo(() => uniqueSorted(data.members.map((m) => m.station)), [data.members]);
  const ranks = useMemo(() => uniqueSorted(data.members.map((m) => m.rank)), [data.members]);
  const categories = useMemo(() => uniqueSorted(data.skills.map((s) => s.category)), [data.skills]);

  const members = data.members.filter((m) => (!station || m.station === station) && (!rank || m.rank === rank));
  const skills = data.skills.filter((s) => !category || s.category === category);

  if (loading) {
    return (
      <div className="flex justify-center py-8" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="competency-heatmap-heading">
      <div>
        <h2 id="competency-heatmap-heading" className="text-theme-text-primary text-lg font-semibold">
          Department Readiness
        </h2>
        <p className="text-theme-text-muted text-sm">
          Each member&rsquo;s current level per skill, as recorded by their latest evaluation.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="heatmap-station" className="form-label">
            Station
          </label>
          <select
            id="heatmap-station"
            className="form-input"
            value={station}
            onChange={(e) => setStation(e.target.value)}
          >
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="heatmap-rank" className="form-label">
            Rank
          </label>
          <select id="heatmap-rank" className="form-input" value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">All ranks</option>
            {ranks.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="heatmap-category" className="form-label">
            Skill category
          </label>
          <select
            id="heatmap-category"
            className="form-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3" aria-label="Legend">
        {COMPETENCY_LEVELS.map((l) => (
          <span key={l.level} className="text-theme-text-muted flex items-center gap-1 text-xs">
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-semibold ${l.color}`}
            >
              {l.short}
            </span>
            {l.label}
          </span>
        ))}
        <span className="text-theme-text-muted flex items-center gap-1 text-xs">
          <span className="border-theme-surface-border inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[10px]">
            —
          </span>
          Not evaluated
        </span>
      </div>

      {skills.length === 0 || members.length === 0 ? (
        <p className="text-theme-text-muted text-sm">
          {data.skills.length === 0
            ? 'No skills are defined yet. Add skill evaluations to start tracking competency levels.'
            : 'No members or skills match these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-1 text-sm">
            <caption className="sr-only">Competency level by member and skill</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-theme-text-muted bg-theme-surface sticky left-0 text-left text-xs font-medium"
                >
                  Member
                </th>
                {skills.map((skill) => (
                  <th
                    key={skill.id}
                    scope="col"
                    className="text-theme-text-muted max-w-[8rem] text-left text-xs font-medium"
                  >
                    {skill.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <th
                    scope="row"
                    className="text-theme-text-primary bg-theme-surface sticky left-0 pr-2 text-left font-normal whitespace-nowrap"
                  >
                    {member.name}
                  </th>
                  {skills.map((skill) => {
                    const cell = cellByMemberSkill.get(`${member.user_id}:${skill.id}`);
                    const info = cell ? levelInfo(cell.current_level) : undefined;
                    const detail = cell
                      ? [
                          `${member.name} — ${skill.name}: ${info?.label ?? cell.current_level}`,
                          cell.last_evaluated_at ? `Last evaluated ${formatDate(cell.last_evaluated_at, tz)}` : null,
                          cell.next_evaluation_due
                            ? `Re-evaluation due ${formatDate(cell.next_evaluation_due, tz)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join('. ')
                      : `${member.name} — ${skill.name}: not evaluated`;
                    return (
                      <td key={skill.id} title={detail} aria-label={detail} className="p-0">
                        <span
                          className={`flex h-8 min-w-10 items-center justify-center rounded text-xs font-semibold ${
                            info ? info.color : 'border-theme-surface-border text-theme-text-muted border'
                          }`}
                        >
                          {info ? info.short : '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default CompetencyHeatmap;
