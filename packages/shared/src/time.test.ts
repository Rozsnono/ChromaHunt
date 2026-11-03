import { describe, expect, it } from 'vitest';
import {
  addDays,
  isValidTimeZone,
  isoWeekKey,
  isoWeekMonday,
  localDateString,
  weekEndInstant,
  zonedTimeToUtc,
} from './time';

describe('timezones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Budapest')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('converts wall-clock time to UTC in winter and summer', () => {
    expect(zonedTimeToUtc('2026-01-15', '08:00', 'Europe/Budapest').toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-15', '08:00', 'Europe/Budapest').toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });

  it('handles the spring-forward gap (02:30 does not exist on 2026-03-29 in Budapest)', () => {
    const utc = zonedTimeToUtc('2026-03-29', '02:30', 'Europe/Budapest');
    expect(utc.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localDateString(utc, 'Europe/Budapest')).toBe('2026-03-29');
  });

  it('computes the local date across the UTC day boundary', () => {
    const instant = new Date('2026-06-10T22:30:00Z');
    expect(localDateString(instant, 'Europe/Budapest')).toBe('2026-06-11');
    expect(localDateString(instant, 'America/New_York')).toBe('2026-06-10');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('ISO weeks', () => {
  it('computes week keys including year-boundary edge cases', () => {
    expect(isoWeekKey('2026-11-03')).toBe('2026-W45');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });

  it('round-trips a week key to its Monday', () => {
    expect(isoWeekMonday('2026-W45')).toBe('2026-11-02');
    expect(isoWeekKey(isoWeekMonday('2026-W53'))).toBe('2026-W53');
  });

  it('ends the week at the next Monday 00:00 local time', () => {
    expect(weekEndInstant('2026-W45', 'Europe/Budapest').toISOString()).toBe('2026-11-08T23:00:00.000Z');
  });
});
