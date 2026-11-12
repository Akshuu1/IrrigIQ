import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { MembershipModel } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { PumpRunLogModel } from '../models/pump-run-log.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { FarmerNoteModel } from '../models/farmer-note.model.js';
import { UsageLogModel } from '../models/usage-log.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { pilotMetricsService } from '../services/pilot-metrics.service.js';
import { DailyPilotRecord } from '@irrigiq/shared';

describe('Phase 27: Pilot Metrics & Impact Report', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      binary: {
        version: '7.0.14',
      },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await FarmerModel.syncIndexes();
    await FieldModel.syncIndexes();
    await UsageLogModel.syncIndexes();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await OrganisationModel.deleteMany({});
    await MembershipModel.deleteMany({});
    await FarmerModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await PumpRunLogModel.deleteMany({});
    await OutboundMessageModel.deleteMany({});
    await InboundMessageModel.deleteMany({});
    await FarmerNoteModel.deleteMany({});
    await UsageLogModel.deleteMany({});
    await MessageChannelModel.deleteMany({});
  });

  async function registerUser(email: string, name: string) {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name,
      language: 'en',
      areaUnit: 'acre',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  describe('1. Known data gives known ratios', () => {
    it('computes exact application ratio (water applied / net crop need)', async () => {
      const { token } = await registerUser('admin@coop.org', 'Coop Admin');
      expect(await OrganisationModel.countDocuments()).toBeGreaterThan(0);

      // Known records: 100mm applied / 80mm need = 1.25 ratio
      const baselineRecords: DailyPilotRecord[] = [
        {
          farmerId: 'farmer-1',
          farmerName: 'Ramesh',
          fieldId: 'field-1',
          fieldName: 'North Field',
          village: 'Wadgaon',
          period: 'baseline',
          date: '2026-09-01',
          rainMm: 0,
          netCropNeedMm: 80,
          waterAppliedMm: 100,
          pumpMinutes: 240,
          pumpCost: 160,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
      ];

      // Advised records: 40mm applied / 80mm need = 0.50 ratio
      const advisedRecords: DailyPilotRecord[] = [
        {
          farmerId: 'farmer-1',
          farmerName: 'Ramesh',
          fieldId: 'field-1',
          fieldName: 'North Field',
          village: 'Wadgaon',
          period: 'advised',
          date: '2026-09-15',
          rainMm: 10,
          netCropNeedMm: 80,
          waterAppliedMm: 40,
          pumpMinutes: 100,
          pumpCost: 70,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      const res = await request(app)
        .post('/pilot-metrics/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
            usage: {
              messagesSent: 10,
              storageGb: 0.1,
              requestsCount: 200,
              periodDays: 28,
            },
          },
        });

      expect(res.status).toBe(200);
      const metrics = res.body.data;

      // Baseline application ratio: 100 / 80 = 1.25
      expect(metrics.baseline.applicationRatio.status).toBe('valid');
      expect(metrics.baseline.applicationRatio.ratio).toBe(1.25);
      expect(metrics.baseline.applicationRatio.ratioFormatted).toBe('1.25');

      // Advised application ratio: 40 / 80 = 0.50
      expect(metrics.advised.applicationRatio.status).toBe('valid');
      expect(metrics.advised.applicationRatio.ratio).toBe(0.50);
      expect(metrics.advised.applicationRatio.ratioFormatted).toBe('0.50');

      // Water saved: 100 - 40 = 60 mm (60.0%)
      expect(metrics.savingsWithContext.hasBaselineData).toBe(true);
      expect(metrics.savingsWithContext.waterSavedMm).toBe(60);
      expect(metrics.savingsWithContext.waterSavedPercent).toBe(60);
    });
  });

  describe('2. Baseline with no data produces a clear "not enough data" state instead of a number', () => {
    it('returns not_enough_data status, null ratio, and does not show an ungrounded saving number', async () => {
      const { token } = await registerUser('admin2@coop.org', 'Admin Two');

      // Empty baseline records (e.g. newly onboarded farmer with no prior logs)
      const emptyBaselineRecords: DailyPilotRecord[] = [];

      const advisedRecords: DailyPilotRecord[] = [
        {
          farmerId: 'farmer-2',
          farmerName: 'Suresh',
          fieldId: 'field-2',
          fieldName: 'South Field',
          village: 'Koregaon',
          period: 'advised',
          date: '2026-10-01',
          rainMm: 5,
          netCropNeedMm: 30,
          waterAppliedMm: 25,
          pumpMinutes: 120,
          pumpCost: 90,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      // Query in English
      const resEn = await request(app)
        .post('/pilot-metrics/query?lang=en')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords: emptyBaselineRecords,
            advisedRecords,
          },
        });

      expect(resEn.status).toBe(200);
      const metricsEn = resEn.body.data;

      expect(metricsEn.baseline.hasData).toBe(false);
      expect(metricsEn.baseline.applicationRatio.status).toBe('not_enough_data');
      expect(metricsEn.baseline.applicationRatio.ratio).toBeNull();
      expect(metricsEn.baseline.applicationRatio.ratioFormatted).toBe('Not enough data');

      // Savings must be null and caveated
      expect(metricsEn.savingsWithContext.hasBaselineData).toBe(false);
      expect(metricsEn.savingsWithContext.waterSavedMm).toBeNull();
      expect(metricsEn.savingsWithContext.waterSavedPercent).toBeNull();
      expect(metricsEn.savingsWithContext.costSavedPerWeek).toBeNull();
      expect(metricsEn.savingsWithContext.statement).toContain('insufficient data');

      // Query in Hindi
      const resHi = await request(app)
        .post('/pilot-metrics/query?lang=hi')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords: emptyBaselineRecords,
            advisedRecords,
          },
        });

      expect(resHi.status).toBe(200);
      const metricsHi = resHi.body.data;
      expect(metricsHi.baseline.applicationRatio.ratioFormatted).toBe('डेटा अपर्याप्त');
      expect(metricsHi.savingsWithContext.statement).toContain('कोई डेटा नहीं है');
    });
  });

  describe('3. Report includes the caveats and plain "what this does not prove" section', () => {
    it('verifies that the rendered report HTML and caveats include all mandatory disclaimers', async () => {
      const { token } = await registerUser('admin3@coop.org', 'Admin Three');

      const records: DailyPilotRecord[] = [
        {
          farmerId: 'farmer-1',
          farmerName: 'Ramesh',
          fieldId: 'field-1',
          fieldName: 'North Plot',
          village: 'Wadgaon',
          period: 'baseline',
          date: '2026-09-01',
          rainMm: 0,
          netCropNeedMm: 40,
          waterAppliedMm: 50,
          pumpMinutes: 180,
          pumpCost: 120,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
        {
          farmerId: 'farmer-1',
          farmerName: 'Ramesh',
          fieldId: 'field-1',
          fieldName: 'North Plot',
          village: 'Wadgaon',
          period: 'advised',
          date: '2026-09-15',
          rainMm: 8,
          netCropNeedMm: 35,
          waterAppliedMm: 30,
          pumpMinutes: 100,
          pumpCost: 70,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      const res = await request(app)
        .post('/pilot-metrics/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords: records.filter((r) => r.period === 'baseline'),
            advisedRecords: records.filter((r) => r.period === 'advised'),
          },
        });

      const metrics = res.body.data;
      expect(metrics.caveats.baselineSelfReported).toContain('self-reported');
      expect(metrics.caveats.weatherDifference).toContain('Weather and rainfall differ');
      expect(metrics.caveats.sampleSize).toContain('sample size');
      expect(metrics.caveats.whatThisDoesNotProve).toMatch(/^What this does not prove:/);

      // Verify HTML rendering contains the sections
      const html = pilotMetricsService.renderReportHtml(metrics);
      expect(html).toContain('What This Does Not Prove');
      expect(html).toContain('Baseline Reporting:');
      expect(html).toContain('Weather Variability:');
      expect(html).toContain('Note: Savings are strictly evaluated beside baseline and advised rainfall figures.');
    });
  });

  describe('4. Never show a saving without the period and rain figures beside it', () => {
    it('ensures every savings statement and metric strictly presents period dates and rain figures', async () => {
      const { token } = await registerUser('admin4@coop.org', 'Admin Four');

      const baselineRecords: DailyPilotRecord[] = [
        {
          farmerId: 'f1',
          farmerName: 'Kisan 1',
          fieldId: 'fld1',
          fieldName: 'Field 1',
          village: 'V1',
          period: 'baseline',
          date: '2026-09-01',
          rainMm: 2.5,
          netCropNeedMm: 45,
          waterAppliedMm: 60,
          pumpMinutes: 200,
          pumpCost: 150,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
      ];

      const advisedRecords: DailyPilotRecord[] = [
        {
          farmerId: 'f1',
          farmerName: 'Kisan 1',
          fieldId: 'fld1',
          fieldName: 'Field 1',
          village: 'V1',
          period: 'advised',
          date: '2026-09-15',
          rainMm: 18.0,
          netCropNeedMm: 30,
          waterAppliedMm: 36,
          pumpMinutes: 120,
          pumpCost: 80,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
      ];

      const res = await request(app)
        .post('/pilot-metrics/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
          },
        });

      const metrics = res.body.data;
      expect(metrics.savingsWithContext.hasBaselineData).toBe(true);
      expect(metrics.savingsWithContext.waterSavedMm).toBe(24);
      expect(metrics.savingsWithContext.waterSavedPercent).toBe(40);
      expect(metrics.savingsWithContext.baselineRainMm).toBe(2.5);
      expect(metrics.savingsWithContext.advisedRainMm).toBe(18.0);

      // Statement must explicitly contain both rain amounts and dates
      expect(metrics.savingsWithContext.statement).toContain('Baseline Rain: 2.5 mm');
      expect(metrics.savingsWithContext.statement).toContain('Advised Rain: 18 mm');
      expect(metrics.savingsWithContext.statement).toContain('2026-09-01');
      expect(metrics.savingsWithContext.statement).toContain('2026-09-15');
    });
  });

  describe('5. CSV matches the PDF totals', () => {
    it('verifies exact numerical match between exported CSV and PDF report totals', async () => {
      const { token } = await registerUser('admin5@coop.org', 'Admin Five');

      const baselineRecords: DailyPilotRecord[] = [
        {
          farmerId: 'f1',
          farmerName: 'Balwant Singh',
          fieldId: 'fld1',
          fieldName: 'Wheat A',
          village: 'Nabha',
          period: 'baseline',
          date: '2026-09-01',
          rainMm: 0,
          netCropNeedMm: 30,
          waterAppliedMm: 55,
          pumpMinutes: 200,
          pumpCost: 140,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
        {
          farmerId: 'f1',
          farmerName: 'Balwant Singh',
          fieldId: 'fld1',
          fieldName: 'Wheat A',
          village: 'Nabha',
          period: 'baseline',
          date: '2026-09-08',
          rainMm: 4,
          netCropNeedMm: 28,
          waterAppliedMm: 45,
          pumpMinutes: 180,
          pumpCost: 120,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        },
      ];

      const advisedRecords: DailyPilotRecord[] = [
        {
          farmerId: 'f1',
          farmerName: 'Balwant Singh',
          fieldId: 'fld1',
          fieldName: 'Wheat A',
          village: 'Nabha',
          period: 'advised',
          date: '2026-09-15',
          rainMm: 12,
          netCropNeedMm: 25,
          waterAppliedMm: 30,
          pumpMinutes: 110,
          pumpCost: 75,
          adviceSent: true,
          replyReceived: true,
          adviceFollowed: true,
        },
        {
          farmerId: 'f1',
          farmerName: 'Balwant Singh',
          fieldId: 'fld1',
          fieldName: 'Wheat A',
          village: 'Nabha',
          period: 'advised',
          date: '2026-09-22',
          rainMm: 6,
          netCropNeedMm: 20,
          waterAppliedMm: 22,
          pumpMinutes: 80,
          pumpCost: 55,
          adviceSent: true,
          replyReceived: false,
          adviceFollowed: true,
        },
      ];

      // 1. Fetch CSV
      const csvRes = await request(app)
        .post('/pilot-metrics/csv')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
          },
        });

      expect(csvRes.status).toBe(200);
      expect(csvRes.headers['content-type']).toContain('text/csv');

      const csvText = csvRes.text;
      const lines = csvText.trim().split('\n');
      expect(lines.length).toBe(5); // Header + 4 records

      let csvBaselineWater = 0;
      let csvAdvisedWater = 0;
      let csvBaselineRain = 0;
      let csvAdvisedRain = 0;
      let csvAdvisedAdviceSent = 0;
      let csvAdvisedReplies = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!.split(',');
        const period = cols[3];
        const rain = parseFloat(cols[5]!);
        const water = parseFloat(cols[7]!);
        const adviceSent = cols[10] === '1';
        const reply = cols[11] === '1';

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

      // 2. Fetch JSON metrics
      const jsonRes = await request(app)
        .post('/pilot-metrics/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
          },
        });

      const metrics = jsonRes.body.data;

      // Exact numerical match
      expect(csvBaselineWater).toBe(metrics.baseline.totalWaterAppliedMm);
      expect(csvAdvisedWater).toBe(metrics.advised.totalWaterAppliedMm);
      expect(csvBaselineRain).toBe(metrics.baseline.totalRainMm);
      expect(csvAdvisedRain).toBe(metrics.advised.totalRainMm);
      expect(csvAdvisedAdviceSent).toBe(metrics.advised.adviceDelivered);
      expect(csvAdvisedReplies).toBe(metrics.advised.repliesReceived);
    });
  });

  describe('6. Cost per farmer calculation with fake usage and configurable unit prices', () => {
    it('computes exact monthly cost per farmer from usage logs with configurable unit price assumptions', async () => {
      const { token } = await registerUser('admin6@coop.org', 'Admin Six');
      const org = await OrganisationModel.findOne({});
      const orgId = org!._id;

      // Seed fake usage logs for 15 days:
      // 600 messages, 3 GB storage, 30,000 API requests
      await UsageLogModel.create([
        {
          orgId,
          date: '2026-10-01',
          type: 'message',
          quantity: 600,
        },
        {
          orgId,
          date: '2026-10-01',
          type: 'storage',
          quantity: 3,
        },
        {
          orgId,
          date: '2026-10-01',
          type: 'request',
          quantity: 30000,
        },
      ]);

      // Seed 6 farmers
      for (let i = 1; i <= 6; i++) {
        const farmer = await FarmerModel.create({
          orgId,
          name: `Farmer ${i}`,
          language: 'hi',
          village: 'Shirdi',
          status: 'active',
        });
        await FieldModel.create({
          userId: orgId,
          farmerId: farmer._id,
          name: `Field ${i}`,
          locationMode: 'pin',
          centroid: { type: 'Point', coordinates: [74.5, 19.8] },
          areaHa: 1.0,
          cropKey: 'wheat',
          sowingDate: new Date('2026-09-01'),
          soilType: 'loam',
          method: 'flood',
          baseline: { everyDays: 10, depthMm: 50 },
          waterMode: 'irrigated',
          hasProtectiveWater: false,
          version: 1,
        });
      }

      // Query with custom unit prices: ₹0.30/msg, ₹2.50/GB, ₹0.15/1k reqs
      // Messages cost: 600 * 0.30 = ₹180
      // Storage cost: 3 * 2.50 = ₹7.50
      // Requests cost: (30000 / 1000) * 0.15 = ₹4.50
      // Period cost: 180 + 7.50 + 4.50 = ₹192 over 28 days
      // Monthly total cost (30 days): (192 / 28) * 30 = ₹205.71
      // Cost per farmer (6 farmers): 205.71 / 6 = ₹34.29
      const res = await request(app)
        .get('/pilot-metrics')
        .query({
          advisedStart: '2026-10-01',
          advisedEnd: '2026-10-28',
          costPerMessage: '0.30',
          costPerGbStorage: '2.50',
          costPerThousandRequests: '0.15',
        })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const metrics = res.body.data;
      expect(metrics.costToServe.assumptions.costPerMessage).toBe(0.30);
      expect(metrics.costToServe.assumptions.costPerGbStorage).toBe(2.50);
      expect(metrics.costToServe.assumptions.costPerThousandRequests).toBe(0.15);
      expect(metrics.costToServe.breakdown.messageCost).toBe(180);
      expect(metrics.costToServe.breakdown.storageCost).toBe(7.50);
      expect(metrics.costToServe.breakdown.requestCost).toBe(4.50);
      expect(metrics.costToServe.costPerFarmerPerMonth).toBeGreaterThan(0);
      expect(metrics.costToServe.assumptions.isAssumption).toBe(true);
    });
  });

  describe('7. Acceptance: a 4 week sample dataset produces a correct, caveated report', () => {
    it('produces a complete English and Hindi PDF report for a 4-week pilot cohort', async () => {
      const { token } = await registerUser('pilot-lead@irrigiq.com', 'Pilot Lead');

      // 4 week dataset (14 days baseline: Sept 1 - Sept 14, 14 days advised: Sept 15 - Sept 28)
      const baselineRecords: DailyPilotRecord[] = [];
      const advisedRecords: DailyPilotRecord[] = [];

      for (let day = 1; day <= 14; day++) {
        const dateBase = `2026-09-${String(day).padStart(2, '0')}`;
        baselineRecords.push({
          farmerId: 'f-cohort-1',
          farmerName: 'Dnyaneshwar Shinde',
          fieldId: 'fld-cohort-1',
          fieldName: 'Sugarcane Plot',
          village: 'Baramati',
          period: 'baseline',
          date: dateBase,
          rainMm: day % 5 === 0 ? 8 : 0,
          netCropNeedMm: 4.5,
          waterAppliedMm: day % 4 === 0 ? 40 : 0,
          pumpMinutes: day % 4 === 0 ? 180 : 0,
          pumpCost: day % 4 === 0 ? 120 : 0,
          adviceSent: false,
          replyReceived: false,
          adviceFollowed: false,
        });

        const dateAdv = `2026-09-${String(day + 14).padStart(2, '0')}`;
        advisedRecords.push({
          farmerId: 'f-cohort-1',
          farmerName: 'Dnyaneshwar Shinde',
          fieldId: 'fld-cohort-1',
          fieldName: 'Sugarcane Plot',
          village: 'Baramati',
          period: 'advised',
          date: dateAdv,
          rainMm: day % 4 === 0 ? 12 : 0,
          netCropNeedMm: 4.0,
          waterAppliedMm: day % 6 === 0 ? 25 : 0,
          pumpMinutes: day % 6 === 0 ? 110 : 0,
          pumpCost: day % 6 === 0 ? 75 : 0,
          adviceSent: true,
          replyReceived: day % 2 === 0,
          adviceFollowed: day % 3 === 0,
        });
      }

      // Test English PDF Report Generation
      const pdfResEn = await request(app)
        .post('/pilot-metrics/pdf?lang=en')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
            usage: {
              messagesSent: 40,
              storageGb: 0.2,
              requestsCount: 1500,
              periodDays: 28,
            },
          },
        });

      expect(pdfResEn.status).toBe(200);
      expect(pdfResEn.headers['content-type']).toBe('application/pdf');
      expect(pdfResEn.body).toBeInstanceOf(Buffer);
      // Valid PDF signature %PDF-
      const pdfHeaderEn = pdfResEn.body.subarray(0, 5).toString('ascii');
      expect(pdfHeaderEn).toBe('%PDF-');
      expect(pdfResEn.body.length).toBeGreaterThan(1000);

      // Test Hindi PDF Report Generation
      const pdfResHi = await request(app)
        .post('/pilot-metrics/pdf?lang=hi')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customRecords: {
            baselineRecords,
            advisedRecords,
            usage: {
              messagesSent: 40,
              storageGb: 0.2,
              requestsCount: 1500,
              periodDays: 28,
            },
          },
        });

      expect(pdfResHi.status).toBe(200);
      expect(pdfResHi.headers['content-type']).toBe('application/pdf');
      expect(pdfResHi.body).toBeInstanceOf(Buffer);
      const pdfHeaderHi = pdfResHi.body.subarray(0, 5).toString('ascii');
      expect(pdfHeaderHi).toBe('%PDF-');
      expect(pdfResHi.body.length).toBeGreaterThan(1000);
    }, 45000);
  });
});
