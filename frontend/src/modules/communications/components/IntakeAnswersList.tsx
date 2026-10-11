/**
 * A submission's answers to its box's intake questions, worded as the member
 * saw them when they answered.
 */

import React from 'react';
import type { IntakeAnswer } from '../types/suggestions';

interface IntakeAnswersListProps {
  answers: readonly IntakeAnswer[] | undefined;
}

const IntakeAnswersList: React.FC<IntakeAnswersListProps> = ({ answers }) => {
  if (!answers || answers.length === 0) return null;
  return (
    <dl className="border-theme-surface-border grid gap-x-4 gap-y-2 rounded-md border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      {answers.map((answer) => (
        <React.Fragment key={answer.questionId}>
          <dt className="text-theme-text-secondary font-medium">{answer.label}</dt>
          <dd className="text-theme-text-primary whitespace-pre-wrap">{answer.display}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

export default IntakeAnswersList;
