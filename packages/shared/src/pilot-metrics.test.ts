import { describe, it, expect } from 'vitest';
import {
  calculateApplicationRatio,
  calculateAdviceDelivered,
  calculateReplyRate,
  calculateDaysFollowed,
  calculatePumpHoursAndCostPerWeek,
  calculateCostToServe,
  calculatePeriodSummary,
  formatSavingsWithContext,
  buildPilotComparisonMetrics,
  generatePilotCsv,
  DailyPilotRecord,
  PeriodInput,
} from './pilot-metrics.js';

describe('Phase 27: Pilot Metrics & Impact Report (Domain Logic)', () => {
  describe('1. Known data gives known ratios', () => {
    it('computes exact application ratio (water applied / net crop need)', () => {
      // 100mm applied / 80mm net crop need = 1.25
      const res1 = calculateApplicationRatio(100, 80, true);
      expect(res1.status).toBe('valid');
      expect(res1.ratio).toBe(1.25);
      expect(res1.ratioFormatted).toBe('1.25');

      // 40mm applied / 80mm net crop need = 0.50
      const res2 = calculateApplicationRatio(40, 80, true);
      expect(res2.status).toBe('valid');
      expect(res2.ratio).toBe(0.50);
      expect(res2.ratioFormatted).toBe('0.50');

      // Zero net crop need
      const res3 = calculateApplicationRatio(50, 0, true);
      expect(res3.status).toBe('valid');
      expect(res3.ratio).toBe(0);
      expect(res3.ratioFormatted).toBe('0.00');
    });
  });

  describe('2. Baseline with no data produces a clear "not enough data" state instead of a number', () => {
    it('returns not_enough_data status, null ratio, and localized label', () => {
      // When baseline has no data
      const resEn = calculateApplicationRatio(0, 0, false, 'en');
      expect(resEn.status).toBe('not_enough_data');
      expect(resEn.ratio).toBeNull();
      expect(resEn.ratioFormatted).toBe('Not enough data');

      const resHi = calculateApplicationRatio(0, 0, false, 'hi');
      expect(resHi.status).toBe('not_enough_data');
      expect(resHi.ratio).toBeNull();
      expect(resHi.ratioFormatted).toBe('डेटा अपर्याप्त');
    });

    it('does not calculate invalid savings numbers when baseline has no data', () => {
      const emptyBaseline: PeriodInput = {
        periodLabel: 'baseline',
        startDate: '2026-09-01',
        endDate: '2026-09-14',
        records: [],
      };

      const advised: PeriodInput = {
        periodLabel: 'advised',
        startDate: '2026-09-15',
        endDate: '2026-09-28',
        records: [
          {
            farmerId: 'f1',
            farmerName: 'Ramesh',
            fieldId: 'fld1',
            fieldName: 'North Plot',
            village: 'Wadgaon',
            period: 'advised',
            date: '2026-09-15',
            rainMm: 5,
            netCropNeedMm: 25,
            waterAppliedMm: 20,
            pumpMinutes: 120,
            pumpCost: 80,
            adviceSent: true,
            replyReceived: true,
            adviceFollowed: true,
          },
        ],
      };

      const baseSummary = calculatePeriodSummary(emptyBaseline, 'en');
      const advSummary = calculatePeriodSummary(advised, 'en');

      expect(baseSummary.hasData).toBe(false);
      expect(baseSummary.applicationRatio.status).toBe('not_enough_data');
      expect(baseSummary.applicationRatio.ratio).toBeNull();

      const savings = formatSavingsWithContext(baseSummary, advSummary, 'en');
      expect(savings.hasBaselineData).toBe(false);
      expect(savings.waterSavedMm).toBeNull();
      expect(savings.waterSavedPercent).toBeNull();
      expect(savings.costSavedPerWeek).toBeNull();
      expect(savings.statement).toContain('insufficient data');
      expect(savings.statement).toContain('Rain: 0 mm');
    });
  });

  describe('3. Caveats & "What this does not prove" section', () => {
    it('includes all mandatory caveats and plain disclaimers in English and Hindi', () => {
      const baseInput: PeriodInput = {
        periodLabel: 'baseline',
        startDate: '2026-09-01',
        endDate: '2026-09-14',
        records: [
          {
            farmerId: 'f1',
            farmerName: 'Ramesh',
            fieldId: 'fld1',
            fieldName: 'North Plot',
            village: 'Wadgaon',
            period: 'baseline',
            date: '2026-09-01',
            rainMm: 0,
            netCropNeedMm: 30,
            waterAppliedMm: 45,
            pumpMinutes: 200,
            pumpCost: 150,
            adviceSent: false,
            replyReceived: false,
            adviceFollowed: false,
          },
        ],
      };

      const advInput: PeriodInput = {
        periodLabel: 'advised',
        startDate: '2026-09-15',
        endDate: '2026-09-28',
        records: [
          {
            farmerId: 'f1',
            farmerName: 'Ramesh',
            fieldId: 'fld1',
            fieldName: 'North Plot',
            village: 'Wadgaon',
            period: 'advised',
            date: '2026-09-15',
            rainMm: 12,
            netCropNeedMm: 20,
            waterAppliedMm: 25,
            pumpMinutes: 100,
            pumpCost: 75,
            adviceSent: true,
            replyReceived: true,
            adviceFollowed: true,
          },
        ],
      };

      const usage = { messagesSent: 50, storageGb: 0.5, requestsCount: 1200, periodDays: 14 };

      const metricsEn = buildPilotComparisonMetrics({ farmersCount: 1, fieldsCount: 1 }, baseInput, advInput, usage, undefined, 'en');
      expect(metricsEn.caveats.whatThisDoesNotProve).toMatch(/^What this does not prove:/);
      expect(metricsEn.caveats.baselineSelfReported).toContain('self-reported');
      expect(metricsEn.caveats.weatherDifference).toContain('Weather and rainfall differ');
      expect(metricsEn.caveats.sampleSize).toContain('sample size');

      const metricsHi = buildPilotComparisonMetrics({ farmersCount: 1, fieldsCount: 1 }, baseInput, advInput, usage, undefined, 'hi');
      expect(metricsHi.caveats.whatThisDoesNotProve).toMatch(/^यह क्या सिद्ध नहीं करता:/);
      expect(metricsHi.caveats.baselineSelfReported).toContain('स्वयं रिपोर्ट');
      expect(metricsHi.caveats.weatherDifference).toContain('मौसम और वर्षा में अंतर');
    });
  });

  describe('4. Never show a saving without period and rain figures beside it', () => {
    it('bundles period dates and rainfall figures directly alongside saving statistics', () => {
      const baseSummary = calculatePeriodSummary(
        {
          periodLabel: 'baseline',
          startDate: '2026-09-01',
          endDate: '2026-09-14',
          records: [
            {
              farmerId: 'f1',
              farmerName: 'Ramesh',
              fieldId: 'fld1',
              fieldName: 'North Plot',
              village: 'Wadgaon',
              period: 'baseline',
              date: '2026-09-01',
              rainMm: 2,
              netCropNeedMm: 40,
              waterAppliedMm: 60,
              pumpMinutes: 300,
              pumpCost: 200,
              adviceSent: false,
              replyReceived: false,
              adviceFollowed: false,
            },
          ],
        },
        'en',
      );

      const advSummary = calculatePeriodSummary(
        {
          periodLabel: 'advised',
          startDate: '2026-09-15',
          endDate: '2026-09-28',
          records: [
            {
              farmerId: 'f1',
              farmerName: 'Ramesh',
              fieldId: 'fld1',
              fieldName: 'North Plot',
              village: 'Wadgaon',
              period: 'advised',
              date: '2026-09-15',
              rainMm: 15,
              netCropNeedMm: 30,
              waterAppliedMm: 35,
              pumpMinutes: 180,
              pumpCost: 120,
              adviceSent: true,
              replyReceived: true,
              adviceFollowed: true,
            },
          ],
        },
        'en',
      );

      const savings = formatSavingsWithContext(baseSummary, advSummary, 'en');
      expect(savings.hasBaselineData).toBe(true);
      expect(savings.waterSavedMm).toBe(25); // 60 - 35
      expect(savings.baselineRainMm).toBe(2);
      expect(savings.advisedRainMm).toBe(15);
      expect(savings.baselinePeriod.start).toBe('2026-09-01');
      expect(savings.advisedPeriod.start).toBe('2026-09-15');

      // Statement must explicitly contain both rain amounts and dates
      expect(savings.statement).toContain('Baseline Rain: 2 mm');
      expect(savings.statement).toContain('Advised Rain: 15 mm');
      expect(savings.statement).toContain('2026-09-01');
      expect(savings.statement).toContain('2026-09-15');
    });
  });

  describe('5. Cost to serve per farmer per month with configurable unit prices', () => {
    it('computes exact monthly cost and per-farmer cost with default unit prices', () => {
      // 10 farmers, 30 days
      // 1,000 messages @ ₹0.20 = ₹200
      // 5 GB storage @ ₹2.00 = ₹10
      // 50,000 requests @ ₹0.10/1k = ₹5
      // Total = ₹215 / month. Per farmer = ₹21.50
      const usage = {
        messagesSent: 1000,
        storageGb: 5,
        requestsCount: 50000,
        periodDays: 30,
      };

      const result = calculateCostToServe(usage, 10);
      expect(result.monthlyTotalCost).toBe(215);
      expect(result.costPerFarmerPerMonth).toBe(21.50);
      expect(result.breakdown.messageCost).toBe(200);
      expect(result.breakdown.storageCost).toBe(10);
      expect(result.breakdown.requestCost).toBe(5);
      expect(result.assumptions.isAssumption).toBe(true);
      expect(result.assumptions.costPerMessage).toBe(0.20);
    });

    it('supports custom configurable unit prices', () => {
      const usage = {
        messagesSent: 500,
        storageGb: 2,
        requestsCount: 20000,
        periodDays: 15, // 15 days period -> normalized to 30 days (x2)
      };

      // Custom prices: ₹0.50/msg, ₹3.00/GB, ₹0.25/1k reqs
      // 15 days cost:
      // messages: 500 * 0.50 = 250
      // storage: 2 * 3.00 = 6
      // reqs: 20 * 0.25 = 5
      // period total = 261. Normalized to 30d (261 / 15 * 30) = 522
      // For 5 farmers: 522 / 5 = 104.40
      const customPrices = {
        costPerMessage: 0.50,
        costPerGbStorage: 3.00,
        costPerThousandRequests: 0.25,
      };

      const result = calculateCostToServe(usage, 5, customPrices);
      expect(result.monthlyTotalCost).toBe(522);
      expect(result.costPerFarmerPerMonth).toBe(104.40);
      expect(result.assumptions.costPerMessage).toBe(0.50);
      expect(result.assumptions.costPerGbStorage).toBe(3.00);
    });
  });

  describe('6. CSV matches the PDF totals', () => {
    it('exports all records to CSV and verified column sums match period totals', () => {
      const records: DailyPilotRecord[] = [
        {
          farmerId: 'farmer-1',
          farmerName: 'Anil Patil',
          fieldId: 'field-1',
          fieldName: 'Sugarcane West',
          village: 'Koregaon',
          period: 'baseline',
          date: '2026-09-01',
          rainMm: 0,
          netCropNeedMm: 35,
          waterAppliedMm: 50,
          pumpMinutes: 180,
          pumpCost: 120,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
        {
          farmerId: 'farmer-1',
          farmerName: 'Anil Patil',
          fieldId: 'field-1',
          fieldName: 'Sugarcane West',
          village: 'Koregaon',
          period: 'baseline',
          date: '2026-09-08',
          rainMm: 5,
          netCropNeedMm: 30,
          waterAppliedMm: 45,
          pumpMinutes: 160,
          pumpCost: 110,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
        {
          farmerId: 'farmer-1',
          farmerName: 'Anil Patil',
          fieldId: 'field-1',
          fieldName: 'Sugarcane West',
          village: 'Koregaon',
          period: 'advised',
          date: '2026-09-15',
          rainMm: 10,
          netCropNeedMm: 25,
          waterAppliedMm: 30,
          pumpMinutes: 110,
          pumpCost: 75,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
        {
          farmerId: 'farmer-1',
          farmerName: 'Anil Patil',
          fieldId: 'field-1',
          fieldName: 'Sugarcane West',
          village: 'Koregaon',
          period: 'advised',
          date: '2026-09-22',
          rainMm: 8,
          netCropNeedMm: 22,
          waterAppliedMm: 25,
          pumpMinutes: 90,
          pumpCost: 60,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      const baselineInput: PeriodInput = {
        periodLabel: 'baseline',
        startDate: '2026-09-01',
        endDate: '2026-09-14',
        records: records.filter((r) => r.period === 'baseline'),
      };

      const advisedInput: PeriodInput = {
        periodLabel: 'advised',
        startDate: '2026-09-15',
        endDate: '2026-09-28',
        records: records.filter((r) => r.period === 'advised'),
      };

      const usage = { messagesSent: 20, storageGb: 0.1, requestsCount: 500, periodDays: 28 };
      const metrics = buildPilotComparisonMetrics(
        { farmersCount: 1, fieldsCount: 1 },
        baselineInput,
        advisedInput,
        usage,
      );

      const csv = generatePilotCsv(metrics);
      expect(csv).toContain('Farmer,Village,Field,Period,Date,Rain_mm,NetCropNeed_mm,WaterApplied_mm');

      const lines = csv.trim().split('\n');
      expect(lines.length).toBe(5); // 1 header + 4 rows

      // Parse CSV rows and calculate sums
      let csvBaselineWater = 0;
      let csvAdvisedWater = 0;
      let csvBaselineRain = 0;
      let csvAdvisedRain = 0;
      let csvAdvisedAdviceSent = 0;
      let csvAdvisedReplies = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i]!.split(',');
        const period = parts[3];
        const rain = parseFloat(parts[5]!);
        const water = parseFloat(parts[7]!);
        const adviceSent = parts[10] === '1';
        const reply = parts[11] === '1';

        if (period === 'baseline') {
          csvBaselineWater += water;
          csvBaselineRain += rain;
        } else if (period === 'advised') {
          csvAdvisedWater += water;
          csvAdvisedRain += rain;
          if (adviceSent) csvAdvisedAdviceSent++;
          if (reply) csvAdvisedReplies++;
        }
      }

      // Check 1:1 match with summary metrics in report
      expect(csvBaselineWater).toBe(metrics.baseline.totalWaterAppliedMm);
      expect(csvAdvisedWater).toBe(metrics.advised.totalWaterAppliedMm);
      expect(csvBaselineRain).toBe(metrics.baseline.totalRainMm);
      expect(csvAdvisedRain).toBe(metrics.advised.totalRainMm);
      expect(csvAdvisedAdviceSent).toBe(metrics.advised.adviceDelivered);
      expect(csvAdvisedReplies).toBe(metrics.advised.repliesReceived);
    });
  });

  describe('7. Engagement: advice delivered, reply rate, days followed, pump hours and cost per week', () => {
    it('computes correct engagement and weekly rates', () => {
      const records: DailyPilotRecord[] = [
        {
          farmerId: 'f1',
          farmerName: 'Sita',
          fieldId: 'fld1',
          fieldName: 'P1',
          village: 'V1',
          period: 'advised',
          date: '2026-10-01',
          rainMm: 0,
          netCropNeedMm: 10,
          waterAppliedMm: 12,
          pumpMinutes: 60,
          pumpCost: 50,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
        {
          farmerId: 'f1',
          farmerName: 'Sita',
          fieldId: 'fld1',
          fieldName: 'P1',
          village: 'V1',
          period: 'advised',
          date: '2026-10-02',
          rainMm: 0,
          netCropNeedMm: 10,
          waterAppliedMm: 0,
          pumpMinutes: 0,
          pumpCost: 0,
          adviceSent: true,
          replyReceived: false,
          adviceFollowed: false,
        },
        {
          farmerId: 'f1',
          farmerName: 'Sita',
          fieldId: 'fld1',
          fieldName: 'P1',
          village: 'V1',
          period: 'advised',
          date: '2026-10-03',
          rainMm: 0,
          netCropNeedMm: 10,
          waterAppliedMm: 12,
          pumpMinutes: 60,
          pumpCost: 50,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      expect(calculateAdviceDelivered(records)).toBe(3);
      const replyStats = calculateReplyRate(2, 3);
      expect(replyStats.percent).toBe(66.7);
      expect(calculateDaysFollowed(records)).toBe(2);

      // 14 days (2 weeks)
      const weekly = calculatePumpHoursAndCostPerWeek(records, 14);
      // total minutes: 120 -> 2 hours
      // 2 weeks -> 1 hour per week
      // total cost: 100 -> 50 per week
      expect(weekly.totalHours).toBe(2);
      expect(weekly.hoursPerWeek).toBe(1);
      expect(weekly.totalCost).toBe(100);
      expect(weekly.costPerWeek).toBe(50);
    });
  });
});

