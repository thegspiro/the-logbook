import { useEffect, useState } from 'react';
import { evaluationsService } from '../services/evaluationsApi';
import type { Grades, PartContent, TemplateDefinition } from '../types/evaluations';

/** Long enough that a burst of clicks across a section is one request. */
const DEBOUNCE_MS = 400;

/**
 * Section and overall grades for answers still being edited, from the
 * server's calculation (`POST /evaluations/grades`).
 *
 * The screen never works a grade out itself: the record and the PDF are
 * graded by the backend, and a second copy of the arithmetic here is how two
 * places come to disagree about the same evaluation (CLAUDE.md pitfall #29).
 *
 * `definition` is null while there is nothing being graded — no record
 * loaded yet, or the viewer is not the one editing the evaluator's part.
 *
 * `initial` is what the server last reported — the detail response's grades —
 * shown until the first recalculation lands. A form not graded by section
 * asks nothing and returns null. A failed request keeps the last grades and
 * sets `error`, so a dropped connection never blanks what was showing.
 */
export function useLiveGrades(
  definition: TemplateDefinition | null,
  content: PartContent,
  initial: Grades | null = null
): { grades: Grades | null; error: boolean } {
  const [grades, setGrades] = useState<Grades | null>(initial);
  const [error, setError] = useState(false);
  const graded = definition?.overall_mode === 'sectioned';

  useEffect(() => {
    if (!graded || definition === null) {
      setGrades(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      evaluationsService
        .grades(definition, content)
        .then((result) => {
          if (cancelled) return;
          setGrades(result);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [graded, definition, content]);

  return { grades: graded ? grades : null, error };
}
