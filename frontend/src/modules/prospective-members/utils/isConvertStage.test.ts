/**
 * The drawer offers Convert on the stage the backend flags final, not on
 * whichever stage sorts last; a pipeline with no flagged stage keeps Convert
 * on its highest stage (owner decision, prospects-final-step-flag).
 */
import { describe, it, expect } from 'vitest';
import type { PipelineStage } from '../types';
import { isConvertStage } from './index';

const stage = (id: string, sort_order: number, is_final_step?: boolean): PipelineStage =>
  ({
    id,
    pipeline_id: 'p1',
    name: id,
    stage_type: 'manual_approval',
    config: {},
    sort_order,
    is_required: true,
    is_final_step,
    notify_prospect_on_completion: false,
    public_visible: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as PipelineStage;

describe('isConvertStage', () => {
  it('follows the flag on the last stage, the usual case', () => {
    const stages = [stage('a', 0), stage('b', 1), stage('c', 2, true)];
    expect(isConvertStage(stages, 'c')).toBe(true);
    expect(isConvertStage(stages, 'b')).toBe(false);
  });

  it('follows the flag when it sits mid-pipeline, where completing converts', () => {
    const stages = [stage('a', 0), stage('b', 1, true), stage('c', 2)];
    expect(isConvertStage(stages, 'b')).toBe(true);
    expect(isConvertStage(stages, 'c')).toBe(false);
  });

  it('keeps Convert on the highest stage when nothing is flagged', () => {
    // Unsorted on purpose: the API order is not the pipeline order.
    const stages = [stage('c', 2), stage('a', 0), stage('b', 1)];
    expect(isConvertStage(stages, 'c')).toBe(true);
    expect(isConvertStage(stages, 'a')).toBe(false);
  });

  it('treats an explicit false the same as no flag', () => {
    const stages = [stage('a', 0, false), stage('b', 1, false)];
    expect(isConvertStage(stages, 'b')).toBe(true);
  });

  it('is false with no stage or no stages', () => {
    expect(isConvertStage([], 'a')).toBe(false);
    expect(isConvertStage([stage('a', 0)], undefined)).toBe(false);
    expect(isConvertStage([stage('a', 0)], '')).toBe(false);
  });
});
