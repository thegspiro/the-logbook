/**
 * Online knowledge tests. `/training/knowledge-tests` serializes snake_case.
 *
 * A member sitting a test receives `KnowledgeQuestionDelivered`, which has no
 * field for the answer: the server keeps the answers until the attempt is
 * submitted, and grades it itself.
 */

export type KnowledgeQuestionType = 'single_choice' | 'multiple_choice' | 'true_false';
export type KnowledgeTestStatus = 'draft' | 'published' | 'archived';

export interface KnowledgeOptionAdmin {
  id: string;
  text: string;
  correct: boolean;
}

export interface KnowledgeQuestionAdmin {
  id: string;
  prompt: string;
  question_type: KnowledgeQuestionType;
  options: KnowledgeOptionAdmin[];
  explanation: string | null;
  points: number;
  sort_order: number;
  active: boolean;
}

export interface KnowledgeAttemptSummary {
  id: string;
  test_id: string;
  user_id: string;
  user_name: string | null;
  status: 'in_progress' | 'submitted';
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  score: number | null;
  passed: boolean | null;
  credited: boolean;
  credit_note: string | null;
}

export interface KnowledgeTest {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  requirement_id: string | null;
  requirement_name: string | null;
  passing_score: number | null;
  effective_passing_score: number;
  time_limit_minutes: number | null;
  question_count: number | null;
  shuffle_questions: boolean;
  show_correct_answers: boolean;
  status: KnowledgeTestStatus;
  /** Officers: active questions in the bank. Members: questions per attempt. */
  active_question_count: number;
  attempt_count: number;
  my_latest_attempt: KnowledgeAttemptSummary | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface KnowledgeTestDetail extends KnowledgeTest {
  questions: KnowledgeQuestionAdmin[];
}

export interface KnowledgeTestCreate {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  requirement_id?: string | undefined;
  passing_score?: number | undefined;
  time_limit_minutes?: number | undefined;
  question_count?: number | undefined;
  shuffle_questions?: boolean | undefined;
  show_correct_answers?: boolean | undefined;
}

/** Omit to leave alone; null to clear. */
export interface KnowledgeTestUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  instructions?: string | null | undefined;
  requirement_id?: string | null | undefined;
  passing_score?: number | null | undefined;
  time_limit_minutes?: number | null | undefined;
  question_count?: number | null | undefined;
  shuffle_questions?: boolean | undefined;
  show_correct_answers?: boolean | undefined;
  status?: KnowledgeTestStatus | undefined;
}

export interface KnowledgeQuestionWrite {
  prompt: string;
  question_type: KnowledgeQuestionType;
  options: { id?: string | undefined; text: string; correct: boolean }[];
  explanation?: string | null | undefined;
  points: number;
  sort_order?: number | undefined;
  active: boolean;
}

export interface KnowledgeQuestionDelivered {
  id: string;
  prompt: string;
  question_type: KnowledgeQuestionType;
  options: { id: string; text: string }[];
  points: number;
}

export interface KnowledgeQuestionReviewed extends KnowledgeQuestionDelivered {
  correct: boolean;
  correct_option_ids: string[];
  explanation: string | null;
}

export interface KnowledgeAttempt extends KnowledgeAttemptSummary {
  test_name: string;
  instructions: string | null;
  passing_score: number;
  points_earned: number | null;
  points_possible: number | null;
  answers: Record<string, string[]>;
  /** Filled while the attempt is open (and after submission when answers stay hidden). */
  questions: KnowledgeQuestionDelivered[];
  /** Filled after submission when the test shows answers, or for an officer. */
  review: KnowledgeQuestionReviewed[] | null;
  seconds_remaining: number | null;
}
