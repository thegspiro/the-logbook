import { describe, it, expect } from 'vitest';
import {
  ITEM_CONDITION_OPTIONS,
  RETURN_CONDITION_OPTIONS,
  UserStatus,
  ElectionStatus,
  RSVPStatus,
  EventType,
  FormStatus,
} from './enums';

describe('Inventory condition constants', () => {
  it('ITEM_CONDITION_OPTIONS includes out_of_service', () => {
    const values = ITEM_CONDITION_OPTIONS.map((o) => o.value);
    expect(values).toContain('out_of_service');
    expect(values).toContain('excellent');
    expect(values).toContain('good');
    expect(values).toContain('fair');
    expect(values).toContain('poor');
    expect(values).toContain('damaged');
    expect(values).toContain('retired');
    expect(values).toHaveLength(7);
  });

  it('RETURN_CONDITION_OPTIONS excludes out_of_service', () => {
    const values = RETURN_CONDITION_OPTIONS.map((o) => o.value);
    expect(values).not.toContain('out_of_service');
    expect(values).toContain('excellent');
    expect(values).toContain('good');
    expect(values).toContain('fair');
    expect(values).toContain('poor');
    expect(values).toContain('damaged');
    expect(values).toHaveLength(5);
  });

  it('RETURN_CONDITION_OPTIONS is a subset of ITEM_CONDITION_OPTIONS', () => {
    const allValues = ITEM_CONDITION_OPTIONS.map((o) => o.value);
    for (const opt of RETURN_CONDITION_OPTIONS) {
      expect(allValues).toContain(opt.value);
    }
  });

  it('all options have value and label', () => {
    for (const opt of ITEM_CONDITION_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
    for (const opt of RETURN_CONDITION_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});

describe('Enum value conventions', () => {
  it('all UserStatus values are lowercase strings', () => {
    for (const value of Object.values(UserStatus)) {
      expect(value).toBe(value.toLowerCase());
      expect(typeof value).toBe('string');
    }
  });

  it('all ElectionStatus values are lowercase strings', () => {
    for (const value of Object.values(ElectionStatus)) {
      expect(value).toBe(value.toLowerCase());
      expect(typeof value).toBe('string');
    }
  });

  it('all RSVPStatus values are lowercase strings', () => {
    for (const value of Object.values(RSVPStatus)) {
      expect(value).toBe(value.toLowerCase());
      expect(typeof value).toBe('string');
    }
  });

  it('all EventType values are lowercase strings', () => {
    for (const value of Object.values(EventType)) {
      expect(value).toBe(value.toLowerCase());
      expect(typeof value).toBe('string');
    }
  });

  it('all FormStatus values are lowercase strings', () => {
    for (const value of Object.values(FormStatus)) {
      expect(value).toBe(value.toLowerCase());
      expect(typeof value).toBe('string');
    }
  });

  it('enum values are unique within each enum', () => {
    const enums = { UserStatus, ElectionStatus, RSVPStatus, EventType, FormStatus };
    for (const [name, enumObj] of Object.entries(enums)) {
      const values = Object.values(enumObj);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    }
  });

  it('EventType contains expected event types', () => {
    expect(EventType.BUSINESS_MEETING).toBe('business_meeting');
    expect(EventType.TRAINING).toBe('training');
    expect(EventType.SOCIAL).toBe('social');
    expect(EventType.OTHER).toBe('other');
  });

  it('RSVPStatus contains expected statuses', () => {
    expect(RSVPStatus.GOING).toBe('going');
    expect(RSVPStatus.NOT_GOING).toBe('not_going');
    expect(RSVPStatus.MAYBE).toBe('maybe');
  });

  it('UserStatus contains expected statuses', () => {
    expect(UserStatus.ACTIVE).toBe('active');
    expect(UserStatus.INACTIVE).toBe('inactive');
    expect(UserStatus.SUSPENDED).toBe('suspended');
    expect(UserStatus.RETIRED).toBe('retired');
  });
});
