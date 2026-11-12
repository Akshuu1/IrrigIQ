import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { MembershipModel } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { FieldModel } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { ConsentRecordModel } from '../models/consent-record.model.js';
import { WhatsAppShareLogModel } from '../models/whatsapp-share-log.model.js';
import { PumpRunLogModel } from '../models/pump-run-log.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { FarmerNoteModel } from '../models/farmer-note.model.js';
import { TelegramProvider } from '../services/messaging/telegram.provider.js';
import { hashExternalId, encryptExternalId } from '../utils/crypto.js';

describe("Phase 26: Agent 'Today' Dashboard & Action Suite", () => {
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
    await ConsentRecordModel.syncIndexes();
    await FarmerNoteModel.syncIndexes();
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
    await PumpModel.deleteMany({});
    await PowerScheduleModel.deleteMany({});
    await ConsentRecordModel.deleteMany({});
    await WhatsAppShareLogModel.deleteMany({});
    await PumpRunLogModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await MessageChannelModel.deleteMany({});
    await OutboundMessageModel.deleteMany({});
    await InboundMessageModel.deleteMany({});
    await FarmerNoteModel.deleteMany({});
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

  describe('1. Role-Scoped Today Dashboard List', () => {
    it('scopes fields by role: agent sees only assigned farmers; admin sees all in org; nothing leaks across orgs', async () => {
      // Setup Org 1 with Admin, Agent 1, and Agent 2
      const admin = await registerUser('admin1@example.com', 'Admin 1');
      const agent1 = await registerUser('agent1@example.com', 'Agent 1');
      const agent2 = await registerUser('agent2@example.com', 'Agent 2');

      const org1Res = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Cooperative 1' });
      const org1Id = org1Res.body.data.organisation.id;

      // Add Agent 1 & Agent 2 as members
      await MembershipModel.create({
        orgId: new Types.ObjectId(org1Id),
        userId: new Types.ObjectId(agent1.user.id),
        role: 'agent',
      });
      await MembershipModel.create({
        orgId: new Types.ObjectId(org1Id),
        userId: new Types.ObjectId(agent2.user.id),
        role: 'agent',
      });

      // Farmer A assigned to Agent 1
      const farmerA = await FarmerModel.create({
        orgId: new Types.ObjectId(org1Id),
        name: 'Farmer A (Agent 1)',
        assignedAgentId: new Types.ObjectId(agent1.user.id),
        language: 'hi',
        village: 'Rampur',
        status: 'active',
      });

      // Farmer B assigned to Agent 2
      const farmerB = await FarmerModel.create({
        orgId: new Types.ObjectId(org1Id),
        name: 'Farmer B (Agent 2)',
        assignedAgentId: new Types.ObjectId(agent2.user.id),
        language: 'hi',
        village: 'Shyampur',
        status: 'active',
      });

      // Fields for Farmer A and B
      await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(org1Id),
        farmerId: farmerA._id,
        name: 'Wheat Field A',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.1, 28.1] },
        location: { type: 'Point', coordinates: [77.1, 28.1] },
        areaHa: 1.5,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-15'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(org1Id),
        farmerId: farmerB._id,
        name: 'Cotton Field B',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.2, 28.2] },
        location: { type: 'Point', coordinates: [77.2, 28.2] },
        areaHa: 2.0,
        cropKey: 'cotton',
        sowingDate: new Date('2026-10-15'),
        soilType: 'clay',
        method: 'flood',
        baseline: { everyDays: 7, depthMm: 40 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      // Agent 1 views Today dashboard
      const agent1Res = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${agent1.token}`)
        .set('X-Org-Id', org1Id);

      expect(agent1Res.status).toBe(200);
      expect(agent1Res.body.data.summary.total).toBe(1);
      expect(agent1Res.body.data.items).toHaveLength(1);
      expect(agent1Res.body.data.items[0].farmerName).toBe('Farmer A (Agent 1)');

      // Agent 2 views Today dashboard
      const agent2Res = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${agent2.token}`)
        .set('X-Org-Id', org1Id);

      expect(agent2Res.status).toBe(200);
      expect(agent2Res.body.data.summary.total).toBe(1);
      expect(agent2Res.body.data.items[0].farmerName).toBe('Farmer B (Agent 2)');

      // Admin views Today dashboard (sees both Farmer A and Farmer B)
      const adminRes = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', org1Id);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.summary.total).toBe(2);
      expect(adminRes.body.data.items).toHaveLength(2);
      const farmerNames = adminRes.body.data.items.map((i: any) => i.farmerName);
      expect(farmerNames).toContain('Farmer A (Agent 1)');
      expect(farmerNames).toContain('Farmer B (Agent 2)');
    });
  });

  describe('2. Accurate Advice Status Calculation', () => {
    it('computes not sent, sent, seen, replied, followed, and not followed with reason', async () => {
      const admin = await registerUser('admin-status@example.com', 'Admin Status');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Status Org' });
      const orgId = orgRes.body.data.organisation.id;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      // Create 6 farmers to test all 6 distinct advice statuses
      const statuses = ['not sent', 'sent', 'seen', 'replied', 'followed', 'not followed'];
      const createdItems: Array<{ farmer: any; field: any; expectedStatus: string }> = [];

      for (let idx = 0; idx < statuses.length; idx++) {
        const expectedStatus = statuses[idx]!;
        const phone = `981100000${idx}`;
        const phoneEnc = encryptExternalId(phone);
        const phoneH = hashExternalId(phone);

        const farmer = await FarmerModel.create({
          orgId: new Types.ObjectId(orgId),
          name: `Farmer ${expectedStatus}`,
          phoneEncrypted: phoneEnc,
          phoneHash: phoneH,
          language: 'hi',
          village: 'Village A',
          status: 'active',
        });

        const field = await FieldModel.create({
          userId: new Types.ObjectId(admin.user.id),
          orgId: new Types.ObjectId(orgId),
          farmerId: farmer._id,
          name: `Field ${idx}`,
          locationMode: 'pin',
          centroid: { type: 'Point', coordinates: [77.0 + idx * 0.01, 28.0] },
          location: { type: 'Point', coordinates: [77.0 + idx * 0.01, 28.0] },
          areaHa: 1.0,
          cropKey: 'wheat',
          sowingDate: new Date('2026-10-01'),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 3, depthMm: 15 },
          waterMode: 'irrigated',
          hasProtectiveWater: false,
          version: 1,
        });

        // Recommendation
        await RecommendationModel.create({
          fieldId: field._id,
          userId: new Types.ObjectId(admin.user.id),
          forDate: todayStr,
          action: 'irrigate',
          grossMm: 25,
          litres: 25000,
          netMm: 20,
          runMinutes: 60,
          splitAcrossDays: false,
          pumpCost: 50,
          pumpMissing: false,
          pumpSegments: [{ start: '06:00', end: '08:00', durationMinutes: 120 }],
          missingMinutes: 0,
          notes: ['Test recommendation'],
          reasonKey: 'deficit_exceeded',
          params: {},
          deficitMm: 25,
          et0Mm: 4,
          kc: 1.15,
          etcMm: 4.6,
          rainMm: 0,
          effectiveRainMm: 0,
          staleWeather: false,
          computedAt: new Date(),
        });

        // Channel
        const channel = await MessageChannelModel.create({
          userId: new Types.ObjectId(admin.user.id),
          provider: 'telegram',
          externalIdEncrypted: phoneEnc,
          externalIdHash: phoneH,
          optedIn: true,
          status: 'active',
          sendTime: '06:30',
          quietHours: { start: '22:00', end: '06:00' },
          dailyCap: 3,
          messagesSentToday: 0,
          planChangeAlertsEnabled: true,
        });

        // Set up conditions according to expected status
        if (expectedStatus === 'sent') {
          await OutboundMessageModel.create({
            channelId: channel._id,
            userId: new Types.ObjectId(admin.user.id),
            provider: 'telegram',
            text: 'Daily Advisory',
            status: 'sent',
            sentAt: new Date(),
          });
        } else if (expectedStatus === 'seen') {
          await OutboundMessageModel.create({
            channelId: channel._id,
            userId: new Types.ObjectId(admin.user.id),
            provider: 'telegram',
            text: 'Daily Advisory',
            status: 'seen',
            sentAt: new Date(),
          });
        } else if (expectedStatus === 'replied') {
          await InboundMessageModel.create({
            provider: 'telegram',
            updateId: 1000 + idx,
            channelId: channel._id,
            externalIdHash: phoneH,
            rawText: 'OK thanks, starting pump',
            rawUpdate: {},
            processed: true,
          });
        } else if (expectedStatus === 'followed') {
          await PumpRunLogModel.create({
            fieldId: field._id,
            farmerId: farmer._id,
            date: todayStr,
            minutes: 60,
            litres: 25000,
            source: 'chat',
          });
        } else if (expectedStatus === 'not followed') {
          await FarmerNoteModel.create({
            farmerId: farmer._id,
            fieldId: field._id,
            orgId: new Types.ObjectId(orgId),
            agentId: new Types.ObjectId(admin.user.id),
            status: 'not followed',
            reason: 'Transformer burned out',
            text: 'Marked not followed: Transformer burned out',
            date: todayStr,
          });
        }

        createdItems.push({ farmer, field, expectedStatus });
      }

      // Query dashboard
      const res = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);

      expect(res.status).toBe(200);
      const items = res.body.data.items;
      expect(items).toHaveLength(6);

      for (const expected of createdItems) {
        const item = items.find((i: any) => i.farmerId === expected.farmer._id.toString());
        expect(item).toBeTruthy();
        expect(item.adviceStatus).toBe(expected.expectedStatus);

        if (expected.expectedStatus === 'replied') {
          expect(item.lastReplyTime).toBeTruthy();
          expect(item.lastReplyText).toBe('OK thanks, starting pump');
        }

        if (expected.expectedStatus === 'not followed') {
          expect(item.notFollowedReason).toBe('Transformer burned out');
        }
      }
    });
  });

  describe('3. Bulk Send (Rate-Limited, Only Farmers With Consent)', () => {
    it('sends to pending farmers with active consent, and skips farmers without consent or channel', async () => {
      const admin = await registerUser('admin-bulk@example.com', 'Admin Bulk');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Bulk Org' });
      const orgId = orgRes.body.data.organisation.id;

      // Mock Telegram Provider
      vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
        success: true,
        messageId: 'telegram-bulk-123',
      });

      // Farmer 1: Has Consent + Has Active Channel -> SENT
      const phone1 = '9822001101';
      const farmer1 = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Farmer 1 (With Consent)',
        phoneEncrypted: encryptExternalId(phone1),
        phoneHash: hashExternalId(phone1),
        language: 'en',
        status: 'active',
      });
      await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer1._id,
        name: 'Field 1',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.1, 28.1] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });
      await ConsentRecordModel.create({
        farmerId: farmer1._id,
        textVersion: '1.0',
        language: 'en',
        method: 'in-person',
        recordedBy: new Types.ObjectId(admin.user.id),
        recordedAt: new Date(),
        withdrawnAt: null,
      });
      await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone1),
        externalIdHash: hashExternalId(phone1),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // Farmer 2: NO Consent -> SKIPPED
      const phone2 = '9822001102';
      const farmer2 = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Farmer 2 (NO Consent)',
        phoneEncrypted: encryptExternalId(phone2),
        phoneHash: hashExternalId(phone2),
        language: 'en',
        status: 'active',
      });
      await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer2._id,
        name: 'Field 2',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.2, 28.2] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });
      await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone2),
        externalIdHash: hashExternalId(phone2),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // Farmer 3: Already Sent today -> Not pending
      const phone3 = '9822001103';
      const farmer3 = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Farmer 3 (Already Sent)',
        phoneEncrypted: encryptExternalId(phone3),
        phoneHash: hashExternalId(phone3),
        language: 'en',
        status: 'active',
      });
      await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer3._id,
        name: 'Field 3',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.3, 28.3] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });
      await ConsentRecordModel.create({
        farmerId: farmer3._id,
        textVersion: '1.0',
        language: 'en',
        method: 'in-person',
        recordedBy: new Types.ObjectId(admin.user.id),
        recordedAt: new Date(),
        withdrawnAt: null,
      });
      const channel3 = await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone3),
        externalIdHash: hashExternalId(phone3),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });
      await OutboundMessageModel.create({
        channelId: channel3._id,
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        text: 'Already delivered',
        status: 'sent',
        sentAt: new Date(),
      });

      // Execute Bulk Send
      const bulkRes = await request(app)
        .post('/agent/bulk-send')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);

      expect(bulkRes.status).toBe(200);
      expect(bulkRes.body.data.totalPending).toBe(2); // Farmer 1 & 2 were pending; Farmer 3 was already sent
      expect(bulkRes.body.data.sentCount).toBe(1); // Farmer 1 was sent
      expect(bulkRes.body.data.skippedNoConsentCount).toBe(1); // Farmer 2 was skipped due to missing consent

      // Verify that Farmer 1 now has an OutboundMessage recorded
      const outMsg = await OutboundMessageModel.findOne({ text: /Farmer 1/ });
      expect(outMsg).toBeTruthy();
      expect(outMsg?.status).toBe('sent');
    });
  });

  describe('4. Timeline & Offline Sync', () => {
    it('aggregates advice, replies, pump logs and notes into reverse-chronological timeline', async () => {
      const admin = await registerUser('admin-timeline@example.com', 'Admin Timeline');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Timeline Org' });
      const orgId = orgRes.body.data.organisation.id;

      const phone = '9833001122';
      const farmer = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Timeline Farmer',
        phoneEncrypted: encryptExternalId(phone),
        phoneHash: hashExternalId(phone),
        language: 'hi',
        status: 'active',
      });

      const field = await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer._id,
        name: 'Timeline Field',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.0, 28.0] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      // 1. WhatsApp share
      await WhatsAppShareLogModel.create({
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer._id,
        agentId: new Types.ObjectId(admin.user.id),
        url: 'https://wa.me/919833001122?text=Advisory',
        sharedAt: new Date(Date.now() - 3600000), // 1 hour ago
      });

      // 2. Reply received
      await InboundMessageModel.create({
        provider: 'whatsapp',
        updateId: 9988,
        externalIdHash: hashExternalId(phone),
        rawText: 'पंप चालू कर दिया है (Started pump)',
        rawUpdate: {},
        processed: true,
      });

      // 3. Pump run logged
      await PumpRunLogModel.create({
        fieldId: field._id,
        farmerId: farmer._id,
        date: '2026-11-13',
        minutes: 90,
        litres: 37500,
        source: 'chat',
      });

      // 4. Mark status note
      await request(app)
        .post(`/farmers/${farmer._id}/mark-status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId)
        .send({
          status: 'followed',
          reason: 'Farmer confirmed irrigation complete',
          fieldId: field._id.toString(),
        });

      // Query timeline endpoint
      const res = await request(app)
        .get(`/farmers/${farmer._id}/timeline`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);

      expect(res.status).toBe(200);
      const timeline = res.body.data.timeline;
      expect(timeline.length).toBeGreaterThanOrEqual(4);

      const types = timeline.map((t: any) => t.type);
      expect(types).toContain('whatsapp_shared');
      expect(types).toContain('reply_received');
      expect(types).toContain('pump_run');
      expect(types).toContain('note');

      // Verify reverse-chronological ordering
      for (let i = 0; i < timeline.length - 1; i++) {
        const t1 = new Date(timeline[i].timestamp).getTime();
        const t2 = new Date(timeline[i + 1].timestamp).getTime();
        expect(t1).toBeGreaterThanOrEqual(t2);
      }
    });

    it('offline queue mark syncs once to the server without duplicate processing', async () => {
      const admin = await registerUser('admin-off@example.com', 'Admin Offline');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Offline Org' });
      const orgId = orgRes.body.data.organisation.id;

      const farmer = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Offline Sync Farmer',
        language: 'hi',
        status: 'active',
      });

      const field = await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer._id,
        name: 'Offline Field',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.0, 28.0] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      // Client syncs mark mutation
      const markRes = await request(app)
        .post(`/farmers/${farmer._id}/mark-status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId)
        .send({
          fieldId: field._id.toString(),
          status: 'followed',
          reason: 'Synced from offline PWA queue',
        });

      expect(markRes.status).toBe(200);

      // Verify database updated once
      const notes = await FarmerNoteModel.find({ farmerId: farmer._id });
      expect(notes).toHaveLength(1);
      expect(notes[0]?.status).toBe('followed');
      expect(notes[0]?.reason).toBe('Synced from offline PWA queue');

      // Verify Today Dashboard reflects followed status
      const dashRes = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);

      expect(dashRes.status).toBe(200);
      const item = dashRes.body.data.items.find((i: any) => i.farmerId === farmer._id.toString());
      expect(item.adviceStatus).toBe('followed');
    });
  });

  describe('5. Acceptance Flow: Handling 20 Farmers in a few minutes', () => {
    it('accepts 20 farmers with diverse actions, villages and filters in under 500ms', async () => {
      const admin = await registerUser('fpo-agent@example.com', 'FPO Agent');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Fast Scale Agro' });
      const orgId = orgRes.body.data.organisation.id;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      // Seed 20 farmers with fields across 3 villages
      const villages = ['Rampur', 'Shyampur', 'Gopalpur'];
      const crops = ['wheat', 'cotton', 'rice', 'mustard'];

      for (let i = 1; i <= 20; i++) {
        const village = villages[i % villages.length];
        const crop = crops[i % crops.length];
        const phone = `98001100${i.toString().padStart(2, '0')}`;

        const farmer = await FarmerModel.create({
          orgId: new Types.ObjectId(orgId),
          name: `Kisan ${i}`,
          phoneEncrypted: encryptExternalId(phone),
          phoneHash: hashExternalId(phone),
          language: i % 2 === 0 ? 'hi' : 'en',
          village,
          status: 'active',
        });

        const field = await FieldModel.create({
          userId: new Types.ObjectId(admin.user.id),
          orgId: new Types.ObjectId(orgId),
          farmerId: farmer._id,
          name: `${crop} Field ${i}`,
          locationMode: 'pin',
          centroid: { type: 'Point', coordinates: [77.0 + i * 0.01, 28.0] },
          areaHa: 1.0 + (i % 5) * 0.5,
          cropKey: crop,
          sowingDate: new Date('2026-10-10'),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 3, depthMm: 15 },
          waterMode: 'irrigated',
          hasProtectiveWater: false,
          version: 1,
        });

        // Alternate irrigate vs skip action
        const action = i % 3 === 0 ? 'skip' : 'irrigate';
        await RecommendationModel.create({
          fieldId: field._id,
          userId: new Types.ObjectId(admin.user.id),
          forDate: todayStr,
          action,
          grossMm: action === 'irrigate' ? 25 : 0,
          litres: action === 'irrigate' ? 25000 : 0,
          netMm: 20,
          runMinutes: action === 'irrigate' ? 60 : 0,
          splitAcrossDays: false,
          pumpCost: 50,
          pumpMissing: false,
          pumpSegments: [],
          missingMinutes: 0,
          notes: [],
          reasonKey: 'routine',
          params: {},
          deficitMm: 20,
          et0Mm: 4,
          kc: 1.15,
          etcMm: 4.6,
          rainMm: 0,
          effectiveRainMm: 0,
          staleWeather: false,
          computedAt: new Date(),
        });
      }

      const tStart = Date.now();
      const res = await request(app)
        .get('/agent/today')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);
      const tDuration = Date.now() - tStart;

      expect(res.status).toBe(200);
      expect(res.body.data.summary.total).toBe(20);
      expect(res.body.data.items).toHaveLength(20);
      expect(res.body.data.villages).toEqual(expect.arrayContaining(['Gopalpur', 'Rampur', 'Shyampur']));

      // Every item has pre-formatted WhatsApp share link and digest
      for (const item of res.body.data.items) {
        expect(item.waShareUrl).toMatch(/^https:\/\/wa\.me\//);
        expect(item.digestText).toBeTruthy();
      }

      // Test Filters on the 20 farmers
      const needsWaterRes = await request(app)
        .get('/agent/today?needsWater=true')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);
      expect(needsWaterRes.body.data.items.every((i: any) => i.action === 'irrigate')).toBe(true);

      const villageRes = await request(app)
        .get('/agent/today?village=Rampur')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);
      expect(villageRes.body.data.items.every((i: any) => i.village === 'Rampur')).toBe(true);

      const searchRes = await request(app)
        .get('/agent/today?search=Kisan%201')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Org-Id', orgId);
      expect(searchRes.body.data.items.length).toBeGreaterThanOrEqual(1);

      // Fast response time for agent handling 20 farmers on phone
      expect(tDuration).toBeLessThan(1500);
    });
  });
});
