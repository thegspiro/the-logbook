import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { STORAGE_KEY, useTestingChecklist } from './useTestingChecklist';

describe('useTestingChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with everything untested', () => {
    const { result } = renderHook(() => useTestingChecklist());
    expect(result.current.summary.pass).toBe(0);
    expect(result.current.summary.untested).toBe(result.current.summary.total);
    expect(result.current.summary.progress).toBe(0);
  });

  it('records a pass against the page and the signed-in tester', () => {
    const { result } = renderHook(() => useTestingChecklist());
    act(() => result.current.setStatus('/dashboard', 'pass', 'chief'));

    expect(result.current.results['/dashboard']?.status).toBe('pass');
    expect(result.current.results['/dashboard']?.checkedBy).toBe('chief');
    expect(result.current.results['/dashboard']?.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.current.summary.pass).toBe(1);
  });

  it('clears the mark when the same result is chosen twice', () => {
    const { result } = renderHook(() => useTestingChecklist());
    act(() => result.current.setStatus('/dashboard', 'fail'));
    act(() => result.current.setStatus('/dashboard', 'fail'));

    expect(result.current.results['/dashboard']?.status).toBe('untested');
    expect(result.current.summary.fail).toBe(0);
  });

  it('keeps notes and sample ids alongside the mark', () => {
    const { result } = renderHook(() => useTestingChecklist());
    act(() => result.current.setNote('/events/:id', 'roster column empty'));
    act(() => result.current.setParam('/events/:id', 'id', 'evt-7'));
    act(() => result.current.setStatus('/events/:id', 'fail'));

    expect(result.current.results['/events/:id']).toMatchObject({
      status: 'fail',
      note: 'roster column empty',
      params: { id: 'evt-7' },
    });
  });

  it('survives a reload', () => {
    const first = renderHook(() => useTestingChecklist());
    act(() => first.result.current.setStatus('/dashboard', 'pass'));

    const second = renderHook(() => useTestingChecklist());
    expect(second.result.current.results['/dashboard']?.status).toBe('pass');
  });

  it('opens on a corrupt saved run rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    const { result } = renderHook(() => useTestingChecklist());
    expect(result.current.results).toEqual({});
  });

  it('opens when the browser refuses site data', () => {
    // A browser set to block storage throws on read, not just on write, and
    // the checklist has to render anyway.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTestingChecklist());
    expect(result.current.results).toEqual({});
  });

  it('clears the run', () => {
    const { result } = renderHook(() => useTestingChecklist());
    act(() => result.current.setStatus('/dashboard', 'pass'));
    act(() => result.current.clearAll());

    expect(result.current.results).toEqual({});
    expect(result.current.summary.pass).toBe(0);
  });

  it('exports the run as Markdown', () => {
    const { result } = renderHook(() => useTestingChecklist());
    act(() => result.current.setStatus('/dashboard', 'fail', 'chief'));
    act(() => result.current.setNote('/dashboard', 'widgets never load'));

    const markdown = result.current.toMarkdown({
      testedBy: 'Chief Spiro',
      formatTimestamp: () => 'Aug 27, 2026, 9:00 AM',
    });

    expect(markdown).toContain('- Tested by: Chief Spiro');
    expect(markdown).toContain('[ ] FAIL `/dashboard` Dashboard — Aug 27, 2026, 9:00 AM by chief');
    expect(markdown).toContain('  - widgets never load');
    expect(markdown).toContain('## Core');
  });
});
