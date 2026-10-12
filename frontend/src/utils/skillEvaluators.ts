import type { Role } from '../types/role';
import type { SkillEvaluation } from '../types/skillEvaluation';

/** One line describing who may sign a skill off. */
export function describeEvaluators(skill: SkillEvaluation, roles: Role[]): string {
  const ev = skill.allowed_evaluators;
  if (!ev) return 'Anyone with training management';
  if (ev.type === 'roles') {
    const names = ev.roles.map((slug) => roles.find((r) => r.slug === slug)?.name ?? slug);
    return `Positions: ${names.join(', ')}`;
  }
  const names = skill.evaluator_members.map((m) => m.name);
  return names.length > 0 ? `Named: ${names.join(', ')}` : 'Named members';
}
