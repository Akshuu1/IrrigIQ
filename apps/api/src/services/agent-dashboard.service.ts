import { Types } from 'mongoose';
import { FarmerModel, IFarmerDocument } from '../models/farmer.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel, IRecommendationDocument } from '../models/recommendation.model.js';
import { PumpModel } from '../models/pump.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { ConsentRecordModel } from '../models/consent-record.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { PumpRunLogModel } from '../models/pump-run-log.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { WhatsAppShareLogModel } from '../models/whatsapp-share-log.model.js';
import { FarmerNoteModel } from '../models/farmer-note.model.js';
import { OrganisationRole } from '../models/membership.model.js';
import { processOutboundMessage } from './messaging/message.queue.js';
import { formatWaMePhone } from './whatsapp-share.service.js';
import { decryptExternalId } from '../utils/crypto.js';
import { CROPS, getCropName, type SupportedLanguage } from '@irrigiq/shared';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export type AdviceStatus =
  | 'not sent'
  | 'sent'
  | 'seen'
  | 'replied'
  | 'followed'
  | 'not followed';

export interface AgentTodayItem {
  id: string; // Composite fieldId or unique key
  fieldId: string;
  fieldName: string;
  farmerId: string;
  farmerName: string;
  farmerPhone: string;
  village: string;
  language: string;
  cropKey: string;
  cropName: string;
  areaHa: number;
  action: 'irrigate' | 'skip';
  pumpMinutes: number;
  litres: number;
  grossMm: number;
  powerWindow?: { start: string; end: string } | null;
  adviceStatus: AdviceStatus;
  lastReplyTime?: Date | null;
  lastReplyText?: string | null;
  notFollowedReason?: string | null;
  hasConsent: boolean;
  channelLinked: boolean;
  channelProvider?: string | null;
  channelId?: string | null;
  noReply2Days: boolean;
  digestText: string;
  waShareUrl: string;
}

export interface AgentTodayDashboardResult {
  date: string;
  summary: {
    total: number;
    needsWater: number;
    pendingSend: number;
    replied: number;
    followed: number;
    notFollowed: number;
  };
  villages: string[];
  items: AgentTodayItem[];
}

export interface TimelineEntry {
  id: string;
  type:
    | 'advice_sent'
    | 'whatsapp_shared'
    | 'reply_received'
    | 'pump_run'
    | 'irrigation_logged'
    | 'note';
  timestamp: Date;
  title: string;
  description: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export class AgentDashboardService {
  async getTodayDashboard(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    queryParams: {
      date?: string;
      village?: string;
      needsWater?: boolean;
      notYetSent?: boolean;
      noReply2Days?: boolean;
      search?: string;
    } = {},
  ): Promise<AgentTodayDashboardResult> {
    const todayStr =
      queryParams.date ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // 1. Scope farmers by organisation and role
    const farmerQuery: Record<string, unknown> = {
      orgId,
      status: { $ne: 'deleted' },
    };
    if (role === 'agent') {
      farmerQuery.assignedAgentId = userId;
    }

    const farmers = await FarmerModel.find(farmerQuery).sort({ name: 1 });
    if (!farmers.length) {
      return {
        date: todayStr,
        summary: {
          total: 0,
          needsWater: 0,
          pendingSend: 0,
          replied: 0,
          followed: 0,
          notFollowed: 0,
        },
        villages: [],
        items: [],
      };
    }

    const farmerMap = new Map<string, IFarmerDocument>();
    const farmerPhoneHashes: string[] = [];
    const farmerObjIds = farmers.map((f) => {
      farmerMap.set(f._id.toString(), f);
      if (f.phoneHash) {
        farmerPhoneHashes.push(f.phoneHash);
      }
      return f._id;
    });

    // 2. Fetch Fields belonging to these farmers
    const fields = await FieldModel.find({
      farmerId: { $in: farmerObjIds },
    }).sort({ name: 1 });

    const fieldObjIds = fields.map((f) => f._id);

    // 3. Parallel fetch supporting records:
    // Recommendations, Active Consents, Message Channels, PumpRunLogs, IrrigationLogs, Notes, Inbound, Outbound
    const [
      recommendations,
      activeConsents,
      channels,
      pumpRunLogs,
      irrigationLogs,
      farmerNotes,
      inboundMessages,
      outboundMessages,
      whatsappShares,
      pumps,
      schedules,
    ] = await Promise.all([
      RecommendationModel.find({
        fieldId: { $in: fieldObjIds },
        forDate: todayStr,
      }),
      ConsentRecordModel.find({
        farmerId: { $in: farmerObjIds },
        withdrawnAt: null,
      }),
      MessageChannelModel.find({
        externalIdHash: { $in: farmerPhoneHashes },
        status: 'active',
      }),
      PumpRunLogModel.find({
        fieldId: { $in: fieldObjIds },
        date: todayStr,
      }),
      IrrigationLogModel.find({
        fieldId: { $in: fieldObjIds },
        date: todayStr,
      }),
      FarmerNoteModel.find({
        farmerId: { $in: farmerObjIds },
        date: todayStr,
      }),
      InboundMessageModel.find({
        externalIdHash: { $in: farmerPhoneHashes },
      }).sort({ createdAt: -1 }),
      OutboundMessageModel.find({}).sort({ createdAt: -1 }),
      WhatsAppShareLogModel.find({
        farmerId: { $in: farmerObjIds },
      }).sort({ sharedAt: -1 }),
      PumpModel.find({}),
      PowerScheduleModel.find({}),
    ]);

    // Map helpers
    const recMap = new Map<string, IRecommendationDocument>();
    recommendations.forEach((r) => recMap.set(r.fieldId.toString(), r));

    const consentFarmerIds = new Set<string>(activeConsents.map((c) => c.farmerId.toString()));
    const channelMap = new Map<string, (typeof channels)[0]>();
    channels.forEach((c) => channelMap.set(c.externalIdHash, c));

    const pumpMap = new Map<string, (typeof pumps)[0]>();
    pumps.forEach((p) => pumpMap.set(p._id.toString(), p));

    const scheduleMap = new Map<string, (typeof schedules)[0]>();
    schedules.forEach((s) => scheduleMap.set(s._id.toString(), s));

    const pumpRunMap = new Map<string, (typeof pumpRunLogs)[0]>();
    pumpRunLogs.forEach((p) => pumpRunMap.set(p.fieldId.toString(), p));

    const irrigLogMap = new Map<string, (typeof irrigationLogs)[0]>();
    irrigationLogs.forEach((l) => irrigLogMap.set(l.fieldId.toString(), l));

    const noteMap = new Map<string, (typeof farmerNotes)[0]>();
    farmerNotes.forEach((n) => {
      const key = n.fieldId ? `${n.farmerId}_${n.fieldId}` : n.farmerId.toString();
      noteMap.set(key, n);
    });

    const villagesSet = new Set<string>();

    const items: AgentTodayItem[] = [];

    // Calculate beginning of today in IST
    const startOfToday = new Date(`${todayStr}T00:00:00.000+05:30`);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);

    for (const field of fields) {
      const farmer = farmerMap.get(field.farmerId?.toString() || '');
      if (!farmer) continue;

      if (farmer.village) {
        villagesSet.add(farmer.village);
      }

      const rec = recMap.get(field._id.toString());
      const action = rec?.action || 'skip';
      const grossMm = rec?.grossMm || 0;
      const litres = rec?.litres || 0;

      // Pump & Power window
      let pumpMinutes = 0;
      let powerWindow: { start: string; end: string } | null = null;

      if (rec?.runMinutes && rec.runMinutes > 0) {
        pumpMinutes = rec.runMinutes;
      } else if (field.pumpId) {
        const pump = pumpMap.get(field.pumpId.toString());
        if (pump?.dischargeLph && litres > 0) {
          pumpMinutes = Math.round((litres / pump.dischargeLph) * 60);
        }
        if (pump?.scheduleId) {
          const schedule = scheduleMap.get(pump.scheduleId.toString());
          if (schedule && schedule.windows && schedule.windows.length > 0) {
            powerWindow = {
              start: schedule.windows[0]!.start,
              end: schedule.windows[0]!.end,
            };
          }
        }
      }

      if (rec?.pumpSegments && rec.pumpSegments.length > 0) {
        powerWindow = {
          start: rec.pumpSegments[0]!.start,
          end: rec.pumpSegments[0]!.end,
        };
      }

      // Consent & Channel
      const hasConsent = consentFarmerIds.has(farmer._id.toString());
      const channel = farmer.phoneHash ? channelMap.get(farmer.phoneHash) : undefined;
      const channelLinked = Boolean(channel);
      const channelProvider = channel?.provider || null;
      const channelId = channel?._id.toString() || null;

      // Inbound Messages from this farmer
      const farmerInbounds = inboundMessages.filter((m) => m.externalIdHash === farmer.phoneHash);
      const todayInbound = farmerInbounds.find((m) => new Date(m.createdAt) >= startOfToday);
      const lastReplyTime = todayInbound?.createdAt || farmerInbounds[0]?.createdAt || null;
      const lastReplyText = todayInbound?.rawText || farmerInbounds[0]?.rawText || null;

      // Outbound messages for this farmer / channel
      const farmerOutbounds = channel
        ? outboundMessages.filter((m) => m.channelId.toString() === channel._id.toString())
        : [];
      const todayOutbound = farmerOutbounds.find(
        (m) =>
          m.status === 'sent' &&
          (new Date(m.sentAt || m.createdAt) >= startOfToday || m.createdAt >= startOfToday),
      );
      const todaySeenOutbound = farmerOutbounds.find(
        (m) => m.status === 'seen' && new Date(m.createdAt) >= startOfToday,
      );

      // WhatsApp share today
      const todayWaShare = whatsappShares.find(
        (w) => w.farmerId.toString() === farmer._id.toString() && w.sharedAt >= startOfToday,
      );

      // Status override from FarmerNote
      const note =
        noteMap.get(`${farmer._id}_${field._id}`) || noteMap.get(farmer._id.toString());
      const pumpRun = pumpRunMap.get(field._id.toString());
      const irrigLog = irrigLogMap.get(field._id.toString());

      // Advice status resolution:
      // ('not sent' | 'sent' | 'seen' | 'replied' | 'followed' | 'not followed')
      let adviceStatus: AdviceStatus = 'not sent';
      let notFollowedReason: string | null = null;

      if (note && note.status === 'followed') {
        adviceStatus = 'followed';
      } else if (note && note.status === 'not followed') {
        adviceStatus = 'not followed';
        notFollowedReason = note.reason || note.text || 'Marked as not followed by agent';
      } else if (pumpRun && pumpRun.minutes > 0) {
        adviceStatus = 'followed';
      } else if (irrigLog && irrigLog.appliedMm > 0) {
        adviceStatus = 'followed';
      } else if (irrigLog && irrigLog.note && /skip|not followed|छोड़/i.test(irrigLog.note)) {
        adviceStatus = 'not followed';
        notFollowedReason = irrigLog.note;
      } else if (todayInbound) {
        adviceStatus = 'replied';
      } else if (todaySeenOutbound) {
        adviceStatus = 'seen';
      } else if (todayOutbound || todayWaShare) {
        adviceStatus = 'sent';
      } else {
        adviceStatus = 'not sent';
      }

      // Check "no reply for 2 days" condition:
      // An advisory was sent >= 2 days ago, and no reply was received since that send time.
      let noReply2Days = false;
      const olderOutbound = farmerOutbounds.find(
        (m) => m.status === 'sent' && new Date(m.sentAt || m.createdAt) <= twoDaysAgo,
      );
      if (olderOutbound) {
        const outboundTime = new Date(olderOutbound.sentAt || olderOutbound.createdAt).getTime();
        const hasReplyAfter = farmerInbounds.some(
          (inb) => new Date(inb.createdAt).getTime() >= outboundTime,
        );
        if (!hasReplyAfter) {
          noReply2Days = true;
        }
      }

      // Crop name localized
      const lang = (['en', 'hi', 'mr', 'pa', 'te'].includes(farmer.language)
        ? farmer.language
        : 'en') as SupportedLanguage;
      const cropObj = CROPS.find((c) => c.key === field.cropKey);
      const cropName = cropObj ? getCropName(cropObj, lang) : field.cropKey;

      // Phone formatting & Decryption
      let cleanPhone = '';
      if (farmer.phoneEncrypted) {
        try {
          cleanPhone = decryptExternalId(farmer.phoneEncrypted);
        } catch {
          cleanPhone = '';
        }
      }
      const waPhone = formatWaMePhone(cleanPhone);

      // Localized advisory digest text
      const timeStr = powerWindow ? ` (${powerWindow.start} - ${powerWindow.end})` : '';
      const actionText =
        action === 'irrigate'
          ? lang === 'hi'
            ? `💧 सिंचाई आवश्यक: ${pumpMinutes > 0 ? `${pumpMinutes} मिनट` : ''} (${litres.toLocaleString()} L)${timeStr}`
            : `💧 Irrigation Needed: ${pumpMinutes > 0 ? `${pumpMinutes} min` : ''} (${litres.toLocaleString()} L)${timeStr}`
          : lang === 'hi'
            ? `⏭️ आज सिंचाई की आवश्यकता नहीं है।`
            : `⏭️ No irrigation needed today.`;

      const digestText =
        lang === 'hi'
          ? `🌾 नमस्ते ${farmer.name} जी!\nखेत: *${field.name}* (${cropName})\n${actionText}\n- IrrigIQ सलाह`
          : `🌾 Hello ${farmer.name}!\nField: *${field.name}* (${cropName})\n${actionText}\n- IrrigIQ Advisory`;

      const waShareUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(digestText)}`;

      const item: AgentTodayItem = {
        id: `${farmer._id}_${field._id}`,
        fieldId: field._id.toString(),
        fieldName: field.name,
        farmerId: farmer._id.toString(),
        farmerName: farmer.name,
        farmerPhone: cleanPhone,
        village: farmer.village || '',
        language: farmer.language,
        cropKey: field.cropKey,
        cropName,
        areaHa: field.areaHa,
        action,
        pumpMinutes,
        litres,
        grossMm,
        powerWindow,
        adviceStatus,
        lastReplyTime,
        lastReplyText,
        notFollowedReason,
        hasConsent,
        channelLinked,
        channelProvider,
        channelId,
        noReply2Days,
        digestText,
        waShareUrl,
      };

      items.push(item);
    }

    // Apply Filters
    let filteredItems = items;

    if (queryParams.needsWater) {
      filteredItems = filteredItems.filter((i) => i.action === 'irrigate');
    }
    if (queryParams.notYetSent) {
      filteredItems = filteredItems.filter((i) => i.adviceStatus === 'not sent');
    }
    if (queryParams.noReply2Days) {
      filteredItems = filteredItems.filter((i) => i.noReply2Days);
    }
    if (queryParams.village && queryParams.village.trim()) {
      const v = queryParams.village.trim().toLowerCase();
      filteredItems = filteredItems.filter((i) => i.village.toLowerCase() === v);
    }
    if (queryParams.search && queryParams.search.trim()) {
      const s = queryParams.search.trim().toLowerCase();
      filteredItems = filteredItems.filter(
        (i) => i.farmerName.toLowerCase().includes(s) || i.fieldName.toLowerCase().includes(s),
      );
    }

    // Summary calculation (over all assigned fields for today)
    const summary = {
      total: items.length,
      needsWater: items.filter((i) => i.action === 'irrigate').length,
      pendingSend: items.filter((i) => i.adviceStatus === 'not sent').length,
      replied: items.filter((i) => i.adviceStatus === 'replied').length,
      followed: items.filter((i) => i.adviceStatus === 'followed').length,
      notFollowed: items.filter((i) => i.adviceStatus === 'not followed').length,
    };

    return {
      date: todayStr,
      summary,
      villages: Array.from(villagesSet).sort(),
      items: filteredItems,
    };
  }

  async markStatus(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    input: {
      farmerId: string;
      fieldId?: string;
      status: 'followed' | 'not followed' | 'note';
      reason?: string;
      text?: string;
      date?: string;
    },
  ) {
    const farmerObjId = new Types.ObjectId(input.farmerId);
    const farmer = await FarmerModel.findOne({
      _id: farmerObjId,
      orgId,
      status: { $ne: 'deleted' },
    });

    if (!farmer) {
      throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
    }

    if (role === 'agent' && farmer.assignedAgentId?.toString() !== userId.toString()) {
      throw new AppError('Forbidden: farmer not assigned to you', 403, 'FORBIDDEN');
    }

    const todayStr =
      input.date ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    let fieldObjId: Types.ObjectId | null = null;
    if (input.fieldId && Types.ObjectId.isValid(input.fieldId)) {
      fieldObjId = new Types.ObjectId(input.fieldId);
    }

    const note = await FarmerNoteModel.create({
      farmerId: farmer._id,
      fieldId: fieldObjId,
      orgId,
      agentId: userId,
      status: input.status,
      reason: input.reason || null,
      text: input.text || (input.reason ? `Marked ${input.status}: ${input.reason}` : `Marked ${input.status}`),
      date: todayStr,
    });

    // If marked followed and fieldId is provided, also log into IrrigationLog
    if (input.status === 'followed' && fieldObjId) {
      const rec = await RecommendationModel.findOne({
        fieldId: fieldObjId,
        forDate: todayStr,
      });
      const appliedMm = rec?.grossMm && rec.grossMm > 0 ? rec.grossMm : 25;

      await IrrigationLogModel.create({
        fieldId: fieldObjId,
        userId,
        date: todayStr,
        appliedMm,
        source: 'manual',
        note: `Marked as followed by agent ${userId}`,
      });
    }

    return note;
  }

  async bulkSendPending(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
  ) {
    // 1. Fetch dashboard to get pending items
    const dashboard = await this.getTodayDashboard(orgId, userId, role);
    const pendingItems = dashboard.items.filter((i) => i.adviceStatus === 'not sent');

    let sentCount = 0;
    let skippedNoConsentCount = 0;
    let skippedNoChannelCount = 0;

    const results: Array<{ farmerId: string; status: string; channelId?: string }> = [];

    // Rate-limited dispatch (e.g. 50ms interval between calls)
    for (const item of pendingItems) {
      // Rule 1: ONLY send to farmers with active consent!
      if (!item.hasConsent) {
        skippedNoConsentCount++;
        results.push({ farmerId: item.farmerId, status: 'skipped_no_consent' });
        continue;
      }

      // Rule 2: Must have a linked active channel
      if (!item.channelLinked || !item.channelId) {
        skippedNoChannelCount++;
        results.push({ farmerId: item.farmerId, status: 'skipped_no_channel' });
        continue;
      }

      try {
        const sendResult = await processOutboundMessage({
          channelId: item.channelId,
          userId: userId.toString(),
          text: item.digestText,
          farmerId: item.farmerId,
          ignoreQuietHours: true,
        });

        if (sendResult.success) {
          sentCount++;
          results.push({ farmerId: item.farmerId, status: 'sent', channelId: item.channelId });
        } else {
          results.push({ farmerId: item.farmerId, status: sendResult.status });
        }
      } catch (err: unknown) {
        logger.error({ err, farmerId: item.farmerId }, 'Error in bulk send item');
        results.push({ farmerId: item.farmerId, status: 'error' });
      }

      // Small throttling delay to obey rate limit
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    return {
      totalPending: pendingItems.length,
      sentCount,
      skippedNoConsentCount,
      skippedNoChannelCount,
      results,
    };
  }

  async getFarmerTimeline(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    farmerId: string | Types.ObjectId,
  ): Promise<{ farmer: IFarmerDocument; timeline: TimelineEntry[] }> {
    const farmerObjId = typeof farmerId === 'string' ? new Types.ObjectId(farmerId) : farmerId;
    const farmer = await FarmerModel.findOne({
      _id: farmerObjId,
      orgId,
      status: { $ne: 'deleted' },
    });

    if (!farmer) {
      throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
    }

    if (role === 'agent' && farmer.assignedAgentId?.toString() !== userId.toString()) {
      throw new AppError('Forbidden: farmer not assigned to you', 403, 'FORBIDDEN');
    }

    const fields = await FieldModel.find({ farmerId: farmer._id });
    const fieldIds = fields.map((f) => f._id);

    // Parallel fetch timeline components:
    // 1. WhatsApp shares
    // 2. Outbounds
    // 3. Inbounds
    // 4. Pump logs
    // 5. Irrigation logs
    // 6. Notes
    const [shares, inbounds, pumpLogs, irrigationLogs, notes] = await Promise.all([
      WhatsAppShareLogModel.find({ farmerId: farmer._id }).sort({ sharedAt: -1 }),
      farmer.phoneHash
        ? InboundMessageModel.find({ externalIdHash: farmer.phoneHash }).sort({ createdAt: -1 })
        : [],
      PumpRunLogModel.find({
        $or: [{ farmerId: farmer._id }, { fieldId: { $in: fieldIds } }],
      }).sort({ createdAt: -1 }),
      IrrigationLogModel.find({ fieldId: { $in: fieldIds } }).sort({ createdAt: -1 }),
      FarmerNoteModel.find({ farmerId: farmer._id }).sort({ createdAt: -1 }),
    ]);

    const timeline: TimelineEntry[] = [];

    // 1. WhatsApp shares
    shares.forEach((s) => {
      timeline.push({
        id: s._id.toString(),
        type: 'whatsapp_shared',
        timestamp: s.sharedAt,
        title: 'WhatsApp Advisory Shared',
        description: `Agent shared advisory link: ${s.url.slice(0, 50)}...`,
        status: 'shared',
      });
    });

    // 2. Inbound replies
    inbounds.forEach((inb) => {
      timeline.push({
        id: inb._id.toString(),
        type: 'reply_received',
        timestamp: inb.createdAt,
        title: 'Farmer Reply Received',
        description: inb.rawText || 'Reply message',
        status: inb.processed ? 'processed' : 'pending',
      });
    });

    // 3. Pump run logs
    pumpLogs.forEach((p) => {
      timeline.push({
        id: p._id.toString(),
        type: 'pump_run',
        timestamp: p.createdAt,
        title: `Pump Run: ${p.minutes} min (${p.litres.toLocaleString()} L)`,
        description: `Date: ${p.date}, source: ${p.source}`,
        metadata: { minutes: p.minutes, litres: p.litres, date: p.date },
      });
    });

    // 4. Irrigation logs
    irrigationLogs.forEach((l) => {
      timeline.push({
        id: l._id.toString(),
        type: 'irrigation_logged',
        timestamp: l.createdAt || new Date(),
        title: `Irrigation Logged: ${l.appliedMm} mm`,
        description: l.note || `Source: ${l.source}, Date: ${l.date}`,
        metadata: { appliedMm: l.appliedMm, source: l.source, date: l.date },
      });
    });

    // 5. Notes & mark statuses
    notes.forEach((n) => {
      timeline.push({
        id: n._id.toString(),
        type: 'note',
        timestamp: n.createdAt,
        title: `Status Marked: ${n.status}`,
        description: n.reason || n.text || `Marked ${n.status}`,
        status: n.status,
      });
    });

    // Sort all events reverse-chronologically
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      farmer,
      timeline,
    };
  }
}

export const agentDashboardService = new AgentDashboardService();
