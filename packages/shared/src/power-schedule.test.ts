import { describe, it, expect } from 'vitest';
import {
  expandWindows,
  planPumpSegments,
  planPumpDay,
  formatHourAmPm,
  formatTimeRange,
  formatAdvisoryWithWindow,
  POWER_SCHEDULE_PRESETS,
  POWER_SCHEDULE_CONFIG,
  type PowerSchedule,
  type ConcreteInterval,
} from './power-schedule.js';

describe('Phase 17: Power Windows & Pump Schedule Pure Functions', () => {
  it('defines versioned power schedule configuration and presets', () => {
    expect(POWER_SCHEDULE_CONFIG.version).toBe('1.0.0');
    expect(POWER_SCHEDULE_CONFIG.windLimitKmh.value).toBe(20);
    expect(POWER_SCHEDULE_CONFIG.windLimitKmh.source).toBeTruthy();
    expect(POWER_SCHEDULE_CONFIG.windLimitKmh.verified).toBe(false);

    expect(POWER_SCHEDULE_PRESETS.night.type).toBe('night');
    expect(POWER_SCHEDULE_PRESETS.night.windows[0]?.start).toBe('22:00');
    expect(POWER_SCHEDULE_PRESETS.night.windows[0]?.end).toBe('06:00');

    expect(POWER_SCHEDULE_PRESETS.day.type).toBe('day');
    expect(POWER_SCHEDULE_PRESETS.day.windows[0]?.start).toBe('06:00');
    expect(POWER_SCHEDULE_PRESETS.day.windows[0]?.end).toBe('14:00');
  });

  const nightSchedule: PowerSchedule = {
    name: 'Night Schedule Preset',
    type: 'night',
    windows: [
      {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '22:00',
        end: '06:00',
      },
    ],
  };

  const daySchedule: PowerSchedule = {
    name: 'Day Schedule Preset',
    type: 'day',
    windows: [
      {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '06:00',
        end: '14:00',
      },
    ],
  };

  describe('expandWindows & Midnight Crossing', () => {
    it('splits a midnight-crossing window (22:00 to 06:00) into 22:00-24:00 on Day D and 00:00-06:00 on Day D+1', () => {
      const intervals = expandWindows(nightSchedule, '2026-11-04');

      expect(intervals).toHaveLength(2);

      // Piece 1: Day D (22:00 to 24:00)
      expect(intervals[0]).toMatchObject({
        day: '2026-11-04',
        startTime: '22:00',
        endTime: '24:00',
        durationMinutes: 120,
        period: 'night',
      });
      expect(intervals[0]?.start).toBe('2026-11-04T22:00:00+05:30');
      expect(intervals[0]?.end).toBe('2026-11-05T00:00:00+05:30');

      // Piece 2: Day D+1 (00:00 to 06:00)
      expect(intervals[1]).toMatchObject({
        day: '2026-11-05',
        startTime: '00:00',
        endTime: '06:00',
        durationMinutes: 360,
        period: 'night',
      });
      expect(intervals[1]?.start).toBe('2026-11-05T00:00:00+05:30');
      expect(intervals[1]?.end).toBe('2026-11-05T06:00:00+05:30');

      // Total power time: 120 + 360 = 480 minutes (8 hours)
      const totalMinutes = intervals.reduce((acc, inv) => acc + inv.durationMinutes, 0);
      expect(totalMinutes).toBe(480);
    });

    it('expands same-day window (06:00 to 14:00) into a single 8-hour interval on Day D', () => {
      const intervals = expandWindows(daySchedule, '2026-11-04');

      expect(intervals).toHaveLength(1);
      expect(intervals[0]).toMatchObject({
        day: '2026-11-04',
        startTime: '06:00',
        endTime: '14:00',
        durationMinutes: 480,
      });
      expect(intervals[0]?.start).toBe('2026-11-04T06:00:00+05:30');
      expect(intervals[0]?.end).toBe('2026-11-04T14:00:00+05:30');
    });

    it('returns empty intervals when schedule has no window on that weekday', () => {
      // 2026-11-01 was a Sunday (day 0)
      const weekdayOnlySchedule: PowerSchedule = {
        name: 'Mon-Fri Only',
        windows: [
          {
            days: [1, 2, 3, 4, 5], // Mon to Fri
            start: '06:00',
            end: '14:00',
          },
        ],
      };

      const intervals = expandWindows(weekdayOnlySchedule, '2026-11-01'); // Sunday
      expect(intervals).toEqual([]);
    });

    it('handles alternating rotation weeks (week A vs week B)', () => {
      const rotationSchedule: PowerSchedule = {
        name: 'Rotating Feeder Schedule',
        windows: [],
        rotation: {
          anchorDate: '2026-11-01', // Sunday, Week A anchor
          weekA: [
            {
              days: [0, 1, 2, 3, 4, 5, 6],
              start: '22:00',
              end: '06:00', // Night on Week A
            },
          ],
          weekB: [
            {
              days: [0, 1, 2, 3, 4, 5, 6],
              start: '06:00',
              end: '14:00', // Day on Week B
            },
          ],
        },
      };

      // Week 0 (2026-11-03, Tue) -> Week A (Night)
      const weekAIntervals = expandWindows(rotationSchedule, '2026-11-03');
      expect(weekAIntervals[0]?.startTime).toBe('22:00');

      // Week 1 (2026-11-10, Tue = 7 days later) -> Week B (Day)
      const weekBIntervals = expandWindows(rotationSchedule, '2026-11-10');
      expect(weekBIntervals).toHaveLength(1);
      expect(weekBIntervals[0]?.startTime).toBe('06:00');
      expect(weekBIntervals[0]?.endTime).toBe('14:00');

      // Week 2 (2026-11-17, Tue = 14 days later) -> back to Week A (Night)
      const weekA2Intervals = expandWindows(rotationSchedule, '2026-11-17');
      expect(weekA2Intervals[0]?.startTime).toBe('22:00');
    });
  });

  describe('planPumpSegments', () => {
    const mockNightIntervals: ConcreteInterval[] = [
      {
        start: '2026-11-04T22:00:00+05:30',
        end: '2026-11-05T00:00:00+05:30',
        durationMinutes: 120,
        period: 'night',
        day: '2026-11-04',
        startTime: '22:00',
        endTime: '24:00',
      },
      {
        start: '2026-11-05T00:00:00+05:30',
        end: '2026-11-05T06:00:00+05:30',
        durationMinutes: 360,
        period: 'night',
        day: '2026-11-05',
        startTime: '00:00',
        endTime: '06:00',
      },
    ];

    it('handles zero minutes required by returning 0 segments and 0 missing', () => {
      const plan = planPumpSegments(0, mockNightIntervals);
      expect(plan.segments).toEqual([]);
      expect(plan.missingMinutes).toBe(0);
      expect(plan.notes).toEqual([]);
    });

    it('exact fit in single interval without splits', () => {
      // 107 minutes run (canonical tomato example) fits entirely into the first 120 min interval (22:00 to 23:47)
      const plan = planPumpSegments(107, mockNightIntervals, { prefer: 'night' });
      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toMatchObject({
        start: '2026-11-04T22:00:00+05:30',
        end: '2026-11-04T23:47:00+05:30',
        durationMinutes: 107,
      });
      expect(plan.missingMinutes).toBe(0);
    });

    it('splits across two intervals when run is longer than the first window', () => {
      // 150 minutes run: 120 min in interval 1 (22:00-24:00), 30 min in interval 2 (00:00-00:30)
      const plan = planPumpSegments(150, mockNightIntervals, { prefer: 'night' });
      expect(plan.segments).toHaveLength(2);

      expect(plan.segments[0]).toMatchObject({
        start: '2026-11-04T22:00:00+05:30',
        end: '2026-11-05T00:00:00+05:30',
        durationMinutes: 120,
      });

      expect(plan.segments[1]).toMatchObject({
        start: '2026-11-05T00:00:00+05:30',
        end: '2026-11-05T00:30:00+05:30',
        durationMinutes: 30,
      });

      expect(plan.missingMinutes).toBe(0);
    });

    it('records missingMinutes when total available power time is less than needed', () => {
      const shortIntervals: ConcreteInterval[] = [
        {
          start: '2026-11-04T06:00:00+05:30',
          end: '2026-11-04T08:00:00+05:30',
          durationMinutes: 120,
          period: 'morning',
          day: '2026-11-04',
          startTime: '06:00',
          endTime: '08:00',
        },
      ];

      // Needs 200 minutes, only 120 min available
      const plan = planPumpSegments(200, shortIntervals);
      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]?.durationMinutes).toBe(120);
      expect(plan.missingMinutes).toBe(80); // 80 unmet minutes carry over
    });

    it('enforces wind rule for sprinklers: prefers calmer night window and adds note "plan.windy"', () => {
      const mixedIntervals: ConcreteInterval[] = [
        {
          start: '2026-11-04T10:00:00+05:30',
          end: '2026-11-04T14:00:00+05:30',
          durationMinutes: 240,
          period: 'day',
          day: '2026-11-04',
          startTime: '10:00',
          endTime: '14:00',
        },
        {
          start: '2026-11-04T22:00:00+05:30',
          end: '2026-11-05T00:00:00+05:30',
          durationMinutes: 120,
          period: 'night',
          day: '2026-11-04',
          startTime: '22:00',
          endTime: '24:00',
        },
      ];

      // Wind = 25 km/h (> 20 km/h threshold)
      const plan = planPumpSegments(90, mixedIntervals, {
        method: 'sprinkler',
        windSpeedMax: 25,
        windLimit: 20,
        prefer: 'morning', // Farmer originally preferred morning/day, but high wind overrides to night!
      });

      expect(plan.notes).toContain('plan.windy');
      // Should pick the night interval first
      expect(plan.segments[0]?.start).toBe('2026-11-04T22:00:00+05:30');
      expect(plan.segments[0]?.durationMinutes).toBe(90);
    });

    it('does not add wind note when wind is below threshold (e.g. 15 km/h <= 20 km/h)', () => {
      const plan = planPumpSegments(90, mockNightIntervals, {
        method: 'sprinkler',
        windSpeedMax: 15,
        windLimit: 20,
      });

      expect(plan.notes).not.toContain('plan.windy');
    });
  });

  describe('planPumpDay (Multiple fields on one pump, ordered by largest deficit)', () => {
    it('schedules several fields back to back, largest deficit first', () => {
      const continuousIntervals: ConcreteInterval[] = [
        {
          start: '2026-11-04T22:00:00+05:30',
          end: '2026-11-05T04:00:00+05:30',
          durationMinutes: 360, // 6 hours continuous
          period: 'night',
          day: '2026-11-04',
          startTime: '22:00',
          endTime: '04:00',
        },
      ];

      const fieldRuns = [
        { fieldId: 'field-1', deficitMm: 15, runMinutes: 60, fieldName: 'Field 1' },
        { fieldId: 'field-2', deficitMm: 40, runMinutes: 120, fieldName: 'Field 2' }, // Highest deficit
        { fieldId: 'field-3', deficitMm: 25, runMinutes: 90, fieldName: 'Field 3' },  // Second highest
      ];

      const result = planPumpDay('pump-101', fieldRuns, continuousIntervals);

      // Verify order by deficit: field-2 (40mm), then field-3 (25mm), then field-1 (15mm)
      expect(result.fieldPlans[0]?.fieldId).toBe('field-2');
      expect(result.fieldPlans[1]?.fieldId).toBe('field-3');
      expect(result.fieldPlans[2]?.fieldId).toBe('field-1');

      // Field 2 (120 min): 22:00 to 24:00 (00:00 next day)
      expect(result.fieldPlans[0]?.segments[0]).toMatchObject({
        start: '2026-11-04T22:00:00+05:30',
        end: '2026-11-05T00:00:00+05:30',
        durationMinutes: 120,
      });

      // Field 3 (90 min): Starts immediately back to back at 00:00 to 01:30
      expect(result.fieldPlans[1]?.segments[0]).toMatchObject({
        start: '2026-11-05T00:00:00+05:30',
        end: '2026-11-05T01:30:00+05:30',
        durationMinutes: 90,
      });

      // Field 1 (60 min): Starts immediately back to back at 01:30 to 02:30
      expect(result.fieldPlans[2]?.segments[0]).toMatchObject({
        start: '2026-11-05T01:30:00+05:30',
        end: '2026-11-05T02:30:00+05:30',
        durationMinutes: 60,
      });

      expect(result.totalRunMinutes).toBe(270);
      expect(result.totalMissingMinutes).toBe(0);
    });
  });

  describe('Time Formatting & Canonical Acceptance Advisory', () => {
    it('formats 24h times to 12h am/pm in English and Hindi', () => {
      expect(formatHourAmPm('22:00', 'en')).toBe('10 pm');
      expect(formatHourAmPm('06:00', 'en')).toBe('6 am');
      expect(formatHourAmPm('14:00', 'en')).toBe('2 pm');

      expect(formatHourAmPm('22:00', 'hi')).toBe('रात 10 बजे');
      expect(formatHourAmPm('06:00', 'hi')).toBe('सुबह 6 बजे');
      expect(formatHourAmPm('14:00', 'hi')).toBe('दोपहर 2 बजे');
    });

    it('formats time ranges correctly', () => {
      expect(formatTimeRange('22:00', '06:00', 'en')).toBe('between 10 pm and 6 am');
      expect(formatTimeRange('06:00', '14:00', 'en')).toBe('between 6 am and 2 pm');

      expect(formatTimeRange('22:00', '06:00', 'hi')).toBe('रात 10 बजे से सुबह 6 बजे के बीच');
    });

    it('matches Phase 17 acceptance criterion: tomato example shows "Run the pump 1 h 47 min, between 10 pm and 6 am"', () => {
      const advisoryEn = formatAdvisoryWithWindow('1 h 47 min', nightSchedule, 'en');
      expect(advisoryEn).toBe('Run the pump 1 h 47 min, between 10 pm and 6 am');

      const advisoryHi = formatAdvisoryWithWindow('1 घंटा 47 मिनट', nightSchedule, 'hi');
      expect(advisoryHi).toBe('आज रात 1 घंटा 47 मिनट पंप चलाएं, रात 10 बजे से सुबह 6 बजे के बीच');
    });
  });
});
