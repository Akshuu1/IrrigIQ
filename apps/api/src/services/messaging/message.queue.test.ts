import { describe, it, expect } from 'vitest';
import { isWithinQuietHours } from './message.queue.js';

describe('Quiet Hours Utility Tests', () => {
  it('correctly detects quiet hours across midnight (22:00 to 06:00)', () => {
    const window = { start: '22:00', end: '06:00' };

    // During quiet hours
    expect(isWithinQuietHours('22:00', window)).toBe(true);
    expect(isWithinQuietHours('23:30', window)).toBe(true);
    expect(isWithinQuietHours('00:00', window)).toBe(true);
    expect(isWithinQuietHours('03:15', window)).toBe(true);
    expect(isWithinQuietHours('05:59', window)).toBe(true);

    // Outside quiet hours
    expect(isWithinQuietHours('06:00', window)).toBe(false);
    expect(isWithinQuietHours('10:00', window)).toBe(false);
    expect(isWithinQuietHours('17:45', window)).toBe(false);
    expect(isWithinQuietHours('21:59', window)).toBe(false);
  });

  it('correctly detects quiet hours within the same day (01:00 to 05:00)', () => {
    const window = { start: '01:00', end: '05:00' };

    expect(isWithinQuietHours('00:30', window)).toBe(false);
    expect(isWithinQuietHours('01:00', window)).toBe(true);
    expect(isWithinQuietHours('03:00', window)).toBe(true);
    expect(isWithinQuietHours('04:59', window)).toBe(true);
    expect(isWithinQuietHours('05:00', window)).toBe(false);
    expect(isWithinQuietHours('14:00', window)).toBe(false);
  });

  it('handles empty or disabled quiet hours gracefully', () => {
    expect(isWithinQuietHours('12:00', { start: '', end: '' })).toBe(false);
    expect(isWithinQuietHours('12:00', { start: '22:00', end: '22:00' })).toBe(false);
  });
});
