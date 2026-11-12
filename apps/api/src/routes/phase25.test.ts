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
import { ConsentRecordModel } from '../models/consent-record.model.js';
import { WhatsAppShareLogModel } from '../models/whatsapp-share-log.model.js';
import { PumpRunLogModel } from '../models/pump-run-log.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { handleReply } from '../services/messaging/reply-handler.service.js';
import { processOutboundMessage } from '../services/messaging/message.queue.js';
import { TelegramProvider } from '../services/messaging/telegram.provider.js';
import { hashExternalId, encryptExternalId } from '../utils/crypto.js';

describe('Phase 25: Farmer Import, Consent, Chat Diary & WhatsApp Share', () => {
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
    await WhatsAppShareLogModel.syncIndexes();
    await PumpRunLogModel.syncIndexes();
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
    await ConsentRecordModel.deleteMany({});
    await WhatsAppShareLogModel.deleteMany({});
    await PumpRunLogModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await MessageChannelModel.deleteMany({});
    await OutboundMessageModel.deleteMany({});
    await InboundMessageModel.deleteMany({});
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

  describe('1. CSV Import & Duplicate Prevention', () => {
    it('validates every row, supports --dry-run preview, and catches row errors', async () => {
      const admin = await registerUser('admin-import@example.com', 'Admin User');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Kisan FPO' });
      const orgId = orgRes.body.data.organisation.id;

      const csvData = [
        'name,phone,language,village,lat,lng,area,areaUnit,crop,sowingDate,soil,method,pumpLph,costPerHour',
        // Row 1: Valid
        'Ramesh Kumar,9876543210,hi,Sonipat,28.99,77.01,2.5,acre,wheat,2026-10-15,loam,drip,15000,85',
        // Row 2: Invalid crop and invalid area
        'Suresh Singh,9876543211,en,Karnal,29.68,76.99,-5,acre,space_crop,2026-10-15,sandy,sprinkler,,',
        // Row 3: Invalid phone
        'Mukesh Lal,123,hi,Panipat,29.39,76.96,1.0,acre,mustard,2026-10-15,clay,flood,20000,50',
      ].join('\n');

      // Test Dry Run Preview
      const previewRes = await request(app)
        .post(`/farmers/import?dryRun=true`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({ csv: csvData });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.dryRun).toBe(true);
      expect(previewRes.body.data.totalRows).toBe(3);
      expect(previewRes.body.data.validCount).toBe(1);
      expect(previewRes.body.data.invalidCount).toBe(2);
      expect(previewRes.body.data.preview).toHaveLength(3);
      expect(previewRes.body.data.preview[0].valid).toBe(true);
      expect(previewRes.body.data.preview[1].valid).toBe(false);
      expect(previewRes.body.data.preview[1].errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Area must be a positive number'),
          expect.stringContaining('Unknown crop'),
        ]),
      );
      expect(previewRes.body.data.preview[2].valid).toBe(false);
      expect(previewRes.body.data.preview[2].errors).toEqual(
        expect.arrayContaining([expect.stringContaining('phone')]),
      );

      // Verify no records were saved in this organisation during dry-run
      const farmerCount = await FarmerModel.countDocuments({ orgId: new Types.ObjectId(orgId) });
      expect(farmerCount).toBe(0);
    });

    it('rejects duplicate phone numbers across the organisation and within the same batch', async () => {
      const admin = await registerUser('admin-dup@example.com', 'Admin User');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Punjab Agro' });
      const orgId = orgRes.body.data.organisation.id;

      // Seed an existing farmer with phone 9876543210
      const phoneDigits = '9876543210';
      await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Existing Farmer',
        phoneEncrypted: encryptExternalId(phoneDigits),
        phoneHash: hashExternalId(phoneDigits),
        language: 'hi',
        status: 'active',
      });

      const csvData = [
        'name,phone,language,village,lat,lng,area,areaUnit,crop,sowingDate,soil,method,pumpLph,costPerHour',
        // Row 1: Duplicate of already existing farmer
        'Ram Duplicate,9876543210,hi,Ludhiana,30.90,75.85,2,acre,wheat,2026-10-15,loam,drip,15000,80',
        // Row 2: Fresh farmer
        'Harpreet Singh,9876543222,pa,Amritsar,31.63,74.87,3,acre,wheat,2026-10-15,clay,flood,25000,100',
        // Row 3: Duplicate of Row 2 within the same batch!
        'Harpreet Twin,9876543222,pa,Amritsar,31.63,74.87,1,acre,wheat,2026-10-15,clay,flood,,',
      ].join('\n');

      const res = await request(app)
        .post(`/farmers/import`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({ csv: csvData });

      expect(res.status).toBe(200);
      expect(res.body.data.validCount).toBe(1);
      expect(res.body.data.duplicateCount).toBe(2);
      expect(res.body.data.imported).toHaveLength(1);
      expect(res.body.data.imported[0].farmerName).toBe('Harpreet Singh');

      // Verify DB contains only the existing farmer + 1 new imported farmer
      const activeFarmers = await FarmerModel.find({ orgId: new Types.ObjectId(orgId) });
      expect(activeFarmers).toHaveLength(2);
    });
  });

  describe('2. Consent, Outbound Message Blocking, STOP & Delete Cascade', () => {
    it('blocks outbound message to a farmer without active consent, and sends when consent exists', async () => {
      const admin = await registerUser('admin-consent@example.com', 'Admin User');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Haryana Cooperative' });
      const orgId = orgRes.body.data.organisation.id;

      const phone = '9998887776';
      const farmer = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Virender Sehwag',
        phoneEncrypted: encryptExternalId(phone),
        phoneHash: hashExternalId(phone),
        language: 'hi',
        status: 'active',
      });

      const channel = await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone),
        externalIdHash: hashExternalId(phone),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // 1. Attempt to send outbound message without consent -> must be blocked
      const blockedRes = await processOutboundMessage({
        channelId: channel._id.toString(),
        userId: admin.user.id,
        text: 'Advisory: Irrigate wheat today',
        farmerId: farmer._id.toString(),
        ignoreQuietHours: true,
      });

      expect(blockedRes.success).toBe(false);
      expect(blockedRes.status).toBe('blocked_no_consent');

      const blockedLog = await OutboundMessageModel.findOne({
        channelId: channel._id,
        status: 'blocked_no_consent',
      });
      expect(blockedLog).toBeTruthy();

      // 2. Record consent via API
      const consentRes = await request(app)
        .post(`/farmers/${farmer._id}/consent`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({
          method: 'in-person',
          language: 'hi',
          textVersion: '1.0',
        });

      expect(consentRes.status).toBe(201);
      expect(consentRes.body.data.consent.textVersion).toBe('1.0');
      expect(consentRes.body.data.consent.method).toBe('in-person');

      // 3. Outbound message should now succeed through provider
      vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
        success: true,
        messageId: 'mock-telegram-msg-123',
      });

      const successRes = await processOutboundMessage({
        channelId: channel._id.toString(),
        userId: admin.user.id,
        text: 'Advisory: Irrigate wheat today',
        farmerId: farmer._id.toString(),
        ignoreQuietHours: true,
      });

      expect(successRes.success).toBe(true);
      expect(successRes.status).toBe('sent');
    });

    it('inbound STOP withdraws consent and sets farmer status to stopped', async () => {
      const user = await UserModel.create({
        email: 'farmer-stop@example.com',
        passwordHash: 'hash',
        name: 'Balwinder Singh',
        role: 'farmer',
        language: 'hi',
      });

      const phone = '9812345678';
      const org = await OrganisationModel.create({ name: 'Village Org' });
      const farmer = await FarmerModel.create({
        orgId: org._id,
        userId: user._id,
        name: 'Balwinder Singh',
        phoneEncrypted: encryptExternalId(phone),
        phoneHash: hashExternalId(phone),
        language: 'hi',
        status: 'active',
      });

      // Active consent record
      const consent = await ConsentRecordModel.create({
        farmerId: farmer._id,
        textVersion: '1.0',
        language: 'hi',
        method: 'telegram',
        recordedBy: user._id,
        recordedAt: new Date(),
        withdrawnAt: null,
      });
      expect(consent.withdrawnAt).toBeNull();

      const channel = await MessageChannelModel.create({
        userId: user._id,
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone),
        externalIdHash: hashExternalId(phone),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // Send STOP command
      const reply = await handleReply(channel, 'STOP');
      expect(reply.actionTaken).toBe('stopped');

      // Verify channel deactivated
      const updatedChannel = await MessageChannelModel.findById(channel._id);
      expect(updatedChannel?.status).toBe('deactivated');

      // Verify consent withdrawn
      const updatedConsent = await ConsentRecordModel.findById(consent._id);
      expect(updatedConsent?.withdrawnAt).toBeTruthy();

      // Verify farmer status is 'stopped'
      const updatedFarmer = await FarmerModel.findById(farmer._id);
      expect(updatedFarmer?.status).toBe('stopped');
    });

    it('delete-farmer removes the record, fields, logs, consent and messages', async () => {
      const admin = await registerUser('admin-del@example.com', 'Admin User');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Nashik Farmers Club' });
      const orgId = orgRes.body.data.organisation.id;

      const phone = '9422001122';
      const farmer = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'Shrikant Patil',
        phoneEncrypted: encryptExternalId(phone),
        phoneHash: hashExternalId(phone),
        language: 'mr',
        status: 'active',
      });

      // Create linked field
      const field = await FieldModel.create({
        userId: new Types.ObjectId(admin.user.id),
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer._id,
        name: 'Nashik Grape Field',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [73.78, 19.99] },
        location: { type: 'Point', coordinates: [73.78, 19.99] },
        geometry: null,
        areaHa: 1.5,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      // Create logs
      await PumpRunLogModel.create({
        fieldId: field._id,
        farmerId: farmer._id,
        date: '2026-11-12',
        minutes: 90,
        litres: 37500,
        source: 'chat',
      });
      await IrrigationLogModel.create({
        fieldId: field._id,
        userId: new Types.ObjectId(admin.user.id),
        date: '2026-11-12',
        appliedMm: 25,
        source: 'chat',
      });
      await ConsentRecordModel.create({
        farmerId: farmer._id,
        textVersion: '1.0',
        language: 'mr',
        method: 'in-person',
        recordedBy: new Types.ObjectId(admin.user.id),
        recordedAt: new Date(),
      });
      await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId(phone),
        externalIdHash: hashExternalId(phone),
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // Call delete-farmer endpoint as Admin
      const delRes = await request(app)
        .delete(`/farmers/${farmer._id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId);

      expect(delRes.status).toBe(200);

      // Verify everything is removed
      expect(await FarmerModel.findById(farmer._id)).toBeNull();
      expect(await FieldModel.findOne({ farmerId: farmer._id })).toBeNull();
      expect(await PumpRunLogModel.findOne({ farmerId: farmer._id })).toBeNull();
      expect(await IrrigationLogModel.findOne({ fieldId: field._id })).toBeNull();
      expect(await ConsentRecordModel.findOne({ farmerId: farmer._id })).toBeNull();
      expect(await MessageChannelModel.findOne({ externalIdHash: farmer.phoneHash })).toBeNull();
    });
  });

  describe('3. Chat Diary & Numeric Reply Parsing', () => {
    it('parses Latin digits and Devanagari digits as pumped minutes, computes litres, and keeps 1, 2, 4 intact', async () => {
      const user = await UserModel.create({
        email: 'diary-user@example.com',
        passwordHash: 'hash',
        name: 'Kisan Dev',
        language: 'hi',
      });

      const pump = await PumpModel.create({
        userId: user._id,
        name: '5HP Borewell',
        dischargeLph: 24000, // 400 litres / min
      });

      const field = await FieldModel.create({
        userId: user._id,
        name: 'Wheat Field 1',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [77.0, 28.0] },
        location: { type: 'Point', coordinates: [77.0, 28.0] },
        geometry: null,
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 15 },
        pumpId: pump._id,
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      const channel = await MessageChannelModel.create({
        userId: user._id,
        provider: 'telegram',
        externalIdEncrypted: encryptExternalId('9876500000'),
        externalIdHash: hashExternalId('9876500000'),
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // 1. Devanagari digits: '१२०' -> 120 minutes
      // 120 minutes * (24,000 / 60) = 48,000 litres
      const resDev = await handleReply(channel, '१२०');
      expect(resDev.actionTaken).toBe('pump_run_logged');
      expect(resDev.text).toContain('120 मिनट');
      expect(resDev.text).toContain('48,000 L');

      const pumpLog1 = await PumpRunLogModel.findOne({ fieldId: field._id, minutes: 120 });
      expect(pumpLog1).toBeTruthy();
      expect(pumpLog1?.litres).toBe(48000);
      expect(pumpLog1?.source).toBe('chat');

      // 2. Latin digits: '45' -> 45 minutes
      // 45 minutes * (24,000 / 60) = 18,000 litres
      const resLat = await handleReply(channel, '45');
      expect(resLat.actionTaken).toBe('pump_run_logged');
      expect(resLat.text).toContain('45 मिनट');
      expect(resLat.text).toContain('18,000 L');

      const pumpLog2 = await PumpRunLogModel.findOne({ fieldId: field._id, minutes: 45 });
      expect(pumpLog2).toBeTruthy();
      expect(pumpLog2?.litres).toBe(18000);

      // 3. Command 1 (Done), 2 (Skip), 4 (No power) continue working as before
      const resDone = await handleReply(channel, '1');
      expect(resDone.actionTaken).toBe('irrigation_logged');

      const resSkip = await handleReply(channel, '2');
      expect(resSkip.actionTaken).toBe('irrigation_skipped');

      const resPower = await handleReply(channel, '4');
      expect(resPower.actionTaken).toBe('no_power_rescheduled');

      // 4. Impossible values: > 1440 minutes rejected with friendly message
      const resExcessLatin = await handleReply(channel, '1500');
      expect(resExcessLatin.actionTaken).toBe('rejected_excessive_minutes');
      expect(resExcessLatin.text).toContain('1440 मिनट (24 घंटे) से अधिक');

      // Devanagari excess: '२000' -> 2000 min
      const resExcessDev = await handleReply(channel, '२000');
      expect(resExcessDev.actionTaken).toBe('rejected_excessive_minutes');

      // 0 minutes rejected
      const resZero = await handleReply(channel, '0');
      expect(resZero.actionTaken).toBe('rejected_zero_minutes');
    });
  });

  describe('4. WhatsApp Share Link & URL Encoding', () => {
    it('properly formats wa.me link with international phone and encodes spaces, newlines, and Hindi characters', async () => {
      const admin = await registerUser('agent-wa@example.com', 'Agent Rajesh');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Vidarbha Krishi' });
      const orgId = orgRes.body.data.organisation.id;

      // 10-digit Indian phone
      const rawPhone = '9876543210';
      const farmer = await FarmerModel.create({
        orgId: new Types.ObjectId(orgId),
        name: 'रामेश्वर शर्मा',
        phoneEncrypted: encryptExternalId(rawPhone),
        phoneHash: hashExternalId(rawPhone),
        language: 'hi',
        status: 'active',
      });

      const multilineHindiAdvisory =
        '🌾 नमस्ते रामेश्वर जी!\nआज की सिंचाई सलाह:\n• खेत: गेहूँ (उत्तर)\n• अनुशंसित पंप समय: 1 घंटा 30 मिनट\nधन्यवाद!';

      const shareRes = await request(app)
        .post(`/farmers/${farmer._id}/share-whatsapp`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({
          digestText: multilineHindiAdvisory,
        });

      expect(shareRes.status).toBe(200);
      const url = shareRes.body.data.url as string;

      // Expect proper wa.me format with 91 prefix
      expect(url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);

      // Verify correct URL encoding: spaces become %20, newlines become %0A, Hindi characters encoded
      expect(url).toContain('%20');
      expect(url).toContain('%0A');
      expect(url).toContain('%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87'); // 'नमस्ते'

      // Exact round-trip verification: decodeURIComponent recovers original string byte-identical
      const urlTextParam = url.split('?text=')[1];
      expect(decodeURIComponent(urlTextParam!)).toBe(multilineHindiAdvisory);

      // Verify that the agent share was recorded in database without calling WhatsApp API
      const log = await WhatsAppShareLogModel.findOne({
        orgId: new Types.ObjectId(orgId),
        farmerId: farmer._id,
      });
      expect(log).toBeTruthy();
      expect(log?.agentId.toString()).toBe(admin.user.id);
      expect(log?.url).toBe(url);
    });
  });

  describe('5. Acceptance Flow', () => {
    it('imports 10 farmers from a CSV, records consent, shares a digest on WhatsApp, and logs pumped minutes by reply', async () => {
      const admin = await registerUser('fpo-lead@example.com', 'FPO Lead');
      const orgRes = await request(app)
        .post('/organisations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Telangana Agri Consortium' });
      const orgId = orgRes.body.data.organisation.id;

      // 1. Generate CSV with 10 distinct farmers
      const header =
        'name,phone,language,village,lat,lng,area,areaUnit,crop,sowingDate,soil,method,pumpLph,costPerHour';
      const rows: string[] = [header];
      for (let i = 1; i <= 10; i++) {
        const phone = `98000000${i.toString().padStart(2, '0')}`;
        rows.push(
          `Farmer ${i},${phone},te,Warangal,17.96,79.59,${(1 + i * 0.2).toFixed(1)},acre,cotton,2026-10-10,clay,drip,18000,75`,
        );
      }
      const csv = rows.join('\n');

      // Import the 10 farmers
      const importRes = await request(app)
        .post('/farmers/import')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({ csv });

      expect(importRes.status).toBe(200);
      expect(importRes.body.data.totalRows).toBe(10);
      expect(importRes.body.data.validCount).toBe(10);
      expect(importRes.body.data.imported).toHaveLength(10);

      const firstImported = importRes.body.data.imported[0];
      const targetFarmerId = firstImported.farmerId;
      const targetFieldId = firstImported.fieldId;

      // 2. Record consent for target farmer
      const consentRes = await request(app)
        .post(`/farmers/${targetFarmerId}/consent`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({
          method: 'verbal',
          language: 'te',
          textVersion: '1.0',
        });
      expect(consentRes.status).toBe(201);
      expect(consentRes.body.data.consent.withdrawnAt).toBeNull();

      // 3. Share digest on WhatsApp (generates wa.me link & records share log)
      const shareRes = await request(app)
        .post(`/farmers/${targetFarmerId}/share-whatsapp`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Organisation-Id', orgId)
        .send({});
      expect(shareRes.status).toBe(200);
      expect(shareRes.body.data.url).toContain('https://wa.me/919800000001?text=');

      // Verify share log recorded
      const shareLog = await WhatsAppShareLogModel.findOne({ farmerId: new Types.ObjectId(targetFarmerId) });
      expect(shareLog).toBeTruthy();

      // 4. Log pumped minutes by reply (e.g. 90 minutes / '९०' Devanagari or '90' Latin)
      const targetFarmer = await FarmerModel.findById(targetFarmerId);
      const testChannel = await MessageChannelModel.create({
        userId: new Types.ObjectId(admin.user.id),
        provider: 'whatsapp',
        externalIdEncrypted: targetFarmer!.phoneEncrypted,
        externalIdHash: targetFarmer!.phoneHash,
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 0,
        planChangeAlertsEnabled: true,
      });

      // Farmer replies with '९०' (90 minutes in Devanagari numerals)
      const replyResult = await handleReply(testChannel, '९०');
      expect(replyResult.actionTaken).toBe('pump_run_logged');
      expect(replyResult.text).toContain('90');

      // Verify PumpRunLog and IrrigationLog stored
      const pumpRun = await PumpRunLogModel.findOne({ fieldId: new Types.ObjectId(targetFieldId) });
      expect(pumpRun).toBeTruthy();
      expect(pumpRun?.minutes).toBe(90);
      // 90 minutes * (18,000 / 60) = 27,000 litres
      expect(pumpRun?.litres).toBe(27000);
      expect(pumpRun?.source).toBe('chat');

      const irrigationLog = await IrrigationLogModel.findOne({ fieldId: new Types.ObjectId(targetFieldId) });
      expect(irrigationLog).toBeTruthy();
      expect(irrigationLog?.source).toBe('chat');
    });
  });
});
