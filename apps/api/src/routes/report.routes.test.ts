import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { ReportModel } from '../models/report.model.js';
import { irrigationLogService } from '../services/irrigation-log.service.js';

describe('Report API Integration Tests (/fields/:id/reports & /reports/:id/pdf)', () => {
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
    await FieldModel.syncIndexes();
    await ReportModel.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await ReportModel.deleteMany({});
  });

  async function createTestUser(email = 'farmer@example.com', name = 'Ramesh Patel') {
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

  async function createTestField(token: string) {
    const res = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Wheat North Field',
        cropKey: 'wheat',
        sowingDate: '2026-10-01',
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 4, depthMm: 20 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [75.8, 26.9],
              [75.81, 26.9],
              [75.81, 26.91],
              [75.8, 26.91],
              [75.8, 26.9],
            ],
          ],
        },
      });
    return res.body.data.field;
  }

  it('totals in the PDF data match calcSavings', async () => {
    const { token, user } = await createTestUser();
    const field = await createTestField(token);

    const from = '2026-10-10';
    const to = '2026-10-17'; // 8 days

    // Clear auto-generated recommendations from field creation
    await RecommendationModel.deleteMany({ fieldId: field.id });

    // Seed mock recommendations
    const fId = new Types.ObjectId(field.id as string);
    const uId = new Types.ObjectId(user.id as string);

    await RecommendationModel.create([
      {
        fieldId: fId,
        userId: uId,
        forDate: '2026-10-12',
        action: 'irrigate',
        netMm: 20,
        grossMm: 22.2,
        litres: Math.round(22.2 * field.areaHa * 10000),
        reasonKey: 'reason.deficit_reached',
        params: { mm: 20 },
        deficitMm: 20,
        et0Mm: 4.5,
        kc: 1.0,
        etcMm: 4.5,
        rainMm: 0,
        effectiveRainMm: 0,
        staleWeather: false,
        computedAt: new Date(),
      },
      {
        fieldId: fId,
        userId: uId,
        forDate: '2026-10-15',
        action: 'irrigate',
        netMm: 20,
        grossMm: 22.2,
        litres: Math.round(22.2 * field.areaHa * 10000),
        reasonKey: 'reason.deficit_reached',
        params: { mm: 20 },
        deficitMm: 20,
        et0Mm: 4.2,
        kc: 1.0,
        etcMm: 4.2,
        rainMm: 0,
        effectiveRainMm: 0,
        staleWeather: false,
        computedAt: new Date(),
      },
      {
        fieldId: fId,
        userId: uId,
        forDate: '2026-10-13',
        action: 'skip',
        netMm: 3.5,
        grossMm: 0,
        litres: 0,
        reasonKey: 'reason.not_needed',
        params: {},
        deficitMm: 8.0,
        et0Mm: 4.0,
        kc: 1.0,
        etcMm: 4.0,
        rainMm: 0,
        effectiveRainMm: 0,
        staleWeather: false,
        computedAt: new Date(),
      },
    ]);

    // Seed mock irrigation log
    await IrrigationLogModel.create({
      fieldId: fId,
      userId: uId,
      date: '2026-10-12',
      appliedMm: 22.2,
      source: 'recommended',
      note: 'Irrigated via drip',
    });

    // 1. Fetch reference savings from service
    const referenceSavings = await irrigationLogService.calcSavings(
      user.id,
      field.id as string,
      from,
      to,
    );

    // 2. Generate report via API
    const res = await request(app)
      .post(`/fields/${field.id}/reports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ from, to, language: 'en' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
    const reportData = res.body.report.data;

    // 3. Verify totals match calcSavings exactly
    expect(reportData.totals.baseline.totalMm).toBe(referenceSavings.totals.baseline.totalMm);
    expect(reportData.totals.baseline.litres).toBe(referenceSavings.totals.baseline.litres);
    expect(reportData.totals.baseline.count).toBe(referenceSavings.totals.baseline.count);

    expect(reportData.totals.recommended.totalMm).toBe(referenceSavings.totals.recommended.totalMm);
    expect(reportData.totals.recommended.litres).toBe(referenceSavings.totals.recommended.litres);

    expect(reportData.totals.actual.totalMm).toBe(referenceSavings.totals.actual.totalMm);
    expect(reportData.totals.actual.litres).toBe(referenceSavings.totals.actual.litres);

    expect(reportData.totals.potentialSaved.litres).toBe(
      referenceSavings.totals.potentialSaved.litres,
    );
    expect(reportData.totals.realisedSaved.litres).toBe(
      referenceSavings.totals.realisedSaved.litres,
    );
  });

  it('English and Hindi reports both generate valid PDFs with correct language text', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);

    const from = '2026-10-10';
    const to = '2026-10-15';

    // 1. Generate English report
    const enRes = await request(app)
      .post(`/fields/${field.id}/reports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ from, to, language: 'en' });

    expect(enRes.status).toBe(201);
    const enReportId = enRes.body.id;

    const enPdfRes = await request(app)
      .get(`/reports/${enReportId}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(enPdfRes.status).toBe(200);
    expect(enPdfRes.headers['content-type']).toBe('application/pdf');
    expect(enPdfRes.body.slice(0, 5).toString()).toBe('%PDF-');

    // 2. Generate Hindi report
    const hiRes = await request(app)
      .post(`/fields/${field.id}/reports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ from, to, language: 'hi' });

    expect(hiRes.status).toBe(201);
    const hiReportId = hiRes.body.id;
    expect(hiRes.body.report.data.field.cropName).toBe('गेहूं');

    const hiPdfRes = await request(app)
      .get(`/reports/${hiReportId}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(hiPdfRes.status).toBe(200);
    expect(hiPdfRes.headers['content-type']).toBe('application/pdf');
    expect(hiPdfRes.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(hiPdfRes.body.length).toBeGreaterThan(10000);
  });

  it('another user cannot download the PDF or create report on another user field', async () => {
    const userA = await createTestUser('userA@example.com', 'Farmer A');
    const userB = await createTestUser('userB@example.com', 'Farmer B');

    const fieldA = await createTestField(userA.token);

    // User A creates a report
    const repRes = await request(app)
      .post(`/fields/${fieldA.id}/reports`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ from: '2026-10-10', to: '2026-10-15', language: 'en' });

    expect(repRes.status).toBe(201);
    const reportId = repRes.body.id;

    // User B attempts to download User A's PDF
    const unauthorizedPdfRes = await request(app)
      .get(`/reports/${reportId}/pdf`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(unauthorizedPdfRes.status).toBe(404);

    // User B attempts to inspect User A's report details
    const unauthorizedGetRes = await request(app)
      .get(`/reports/${reportId}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(unauthorizedGetRes.status).toBe(404);

    // User B attempts to trigger report creation on User A's field
    const unauthorizedPostRes = await request(app)
      .post(`/fields/${fieldA.id}/reports`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ from: '2026-10-10', to: '2026-10-15' });

    expect(unauthorizedPostRes.status).toBe(404);
  });

  it('a report for an empty range still works', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);

    // Date range far in the future or past with no logs and no recommendations
    const from = '2029-01-01';
    const to = '2029-01-04';

    const res = await request(app)
      .post(`/fields/${field.id}/reports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ from, to, language: 'en' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
    expect(res.body.report.data.totals.actual.litres).toBe(0);
    expect(res.body.report.data.totals.recommended.litres).toBe(0);

    const pdfRes = await request(app)
      .get(`/reports/${res.body.id}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.body.slice(0, 5).toString()).toBe('%PDF-');
  });
});
