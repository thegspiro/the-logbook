/**
 * Skill evaluation definitions — the department's list of skills that need a
 * sign-off. A shift report's skill score reaches competency history and
 * pipeline progress only when its name matches one of these (ignoring case).
 *
 * `/training/skill-evaluations` serializes snake_case (no alias generator).
 */

export interface SkillEvaluatorsByPosition {
  type: 'roles';
  /** Position slugs. */
  roles: string[];
}

export interface SkillEvaluatorsByMember {
  type: 'specific_users';
  user_ids: string[];
}

/** Null means "anyone holding training.manage". */
export type SkillEvaluators = SkillEvaluatorsByPosition | SkillEvaluatorsByMember;

export interface SkillEvaluation {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  category: string | null;
  evaluation_criteria: string[] | null;
  passing_requirements: string | null;
  allowed_evaluators: SkillEvaluators | null;
  active: boolean;
  /** Sign-offs recorded against it; a skill with any cannot be deleted. */
  checkoff_count: number;
  /** Names for a named-members rule, so the editor can show who is listed. */
  evaluator_members: { id: string; name: string }[];
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
}

export interface SkillEvaluationCreate {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  evaluation_criteria?: string[] | undefined;
  passing_requirements?: string | undefined;
  allowed_evaluators?: SkillEvaluators | null | undefined;
}

/** Update: omit to leave alone, null to clear. */
export interface SkillEvaluationUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  evaluation_criteria?: string[] | null | undefined;
  passing_requirements?: string | null | undefined;
  allowed_evaluators?: SkillEvaluators | null | undefined;
  active?: boolean | undefined;
}
