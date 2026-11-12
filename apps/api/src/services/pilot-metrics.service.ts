import { Types } from 'mongoose';
import {
  type PilotImpactReportData,
  type DailyPilotRecord,
  type PeriodInput,
  type CostAssumptions,
  type UsageStats,
  buildPilotComparisonMetrics,
  generatePilotCsv,
} from '@irrigiq/shared';
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
import { WhatsAppShareLogModel } from '../models/whatsapp-share-log.model.js';
import { generatePdfFromHtml } from './report.service.js';
import { OrganisationRole } from '../models/membership.model.js';

export interface PilotMetricsQueryParams {
  orgId: string;
  agentId?: string;
  role?: OrganisationRole;
  baselineStart?: string;
  baselineEnd?: string;
  advisedStart?: string;
  advisedEnd?: string;
  lang?: 'en' | 'hi';
  unitPrices?: Partial<CostAssumptions>;
  customRecords?: {
    baselineRecords?: DailyPilotRecord[];
    advisedRecords?: DailyPilotRecord[];
    usage?: UsageStats;
  };
}

export class PilotMetricsService {
  /**
   * Computes comprehensive pilot impact metrics across baseline and advised periods.
   */
  async computeMetrics(params: PilotMetricsQueryParams): Promise<PilotImpactReportData> {
    const lang = params.lang === 'hi' ? 'hi' : 'en';

    // 1. If explicit custom records are provided (e.g. for testing / direct synthesis), use them directly
    if (params.customRecords?.baselineRecords && params.customRecords?.advisedRecords) {
      const baselineInput: PeriodInput = {
        periodLabel: 'baseline',
        startDate: params.baselineStart || params.customRecords.baselineRecords[0]?.date || '2026-09-01',
        endDate: params.baselineEnd || params.customRecords.baselineRecords[params.customRecords.baselineRecords.length - 1]?.date || '2026-09-14',
        records: params.customRecords.baselineRecords,
      };

      const advisedInput: PeriodInput = {
        periodLabel: 'advised',
        startDate: params.advisedStart || params.customRecords.advisedRecords[0]?.date || '2026-09-15',
        endDate: params.advisedEnd || params.customRecords.advisedRecords[params.customRecords.advisedRecords.length - 1]?.date || '2026-09-28',
        records: params.customRecords.advisedRecords,
      };

      const farmersSet = new Set<string>();
      const fieldsSet = new Set<string>();
      for (const r of [...baselineInput.records, ...advisedInput.records]) {
        if (r.farmerId) farmersSet.add(r.farmerId);
        if (r.fieldId) fieldsSet.add(r.fieldId);
      }

      const cohortSize = {
        farmersCount: Math.max(1, farmersSet.size),
        fieldsCount: Math.max(1, fieldsSet.size),
      };

      const usage: UsageStats = params.customRecords.usage || {
        messagesSent: advisedInput.records.filter((r) => r.adviceSent).length,
        storageGb: Number((fieldsSet.size * 0.05).toFixed(2)),
        requestsCount: advisedInput.records.length * 10,
        periodDays: 28,
      };

      return buildPilotComparisonMetrics(
        cohortSize,
        baselineInput,
        advisedInput,
        usage,
        params.unitPrices,
        lang,
      );
    }

    // 2. Otherwise query database
    const orgObjectId = new Types.ObjectId(params.orgId);

    // Scoping query
    const farmerQuery: Record<string, unknown> = {
      orgId: orgObjectId,
      status: { $ne: 'deleted' },
    };
    if (params.role === 'agent' && params.agentId) {
      farmerQuery.assignedAgentId = new Types.ObjectId(params.agentId);
    }

    const farmers = await FarmerModel.find(farmerQuery);
    const farmerIds = farmers.map((f) => f._id);
    const fields = await FieldModel.find({ farmerId: { $in: farmerIds } });
    const fieldIds = fields.map((f) => f._id);

    // Determine period dates
    const today = new Date().toISOString().split('T')[0]!;
    const advisedEnd = params.advisedEnd || today;

    // Default: 14 days advised, 14 days baseline
    const dAdvStart = new Date(advisedEnd);
    dAdvStart.setDate(dAdvStart.getDate() - 13);
    const advisedStart = params.advisedStart || dAdvStart.toISOString().split('T')[0]!;

    const dBaseEnd = new Date(advisedStart);
    dBaseEnd.setDate(dBaseEnd.getDate() - 1);
    const baselineEnd = params.baselineEnd || dBaseEnd.toISOString().split('T')[0]!;

    const dBaseStart = new Date(baselineEnd);
    dBaseStart.setDate(dBaseStart.getDate() - 13);
    const baselineStart = params.baselineStart || dBaseStart.toISOString().split('T')[0]!;

    // Fetch recommendations, logs, notes, and messages in both periods
    const allRecommendations = await RecommendationModel.find({
      fieldId: { $in: fieldIds },
      forDate: { $gte: baselineStart, $lte: advisedEnd },
    });

    const allIrrigationLogs = await IrrigationLogModel.find({
      fieldId: { $in: fieldIds },
      date: { $gte: baselineStart, $lte: advisedEnd },
    });

    const allPumpLogs = await PumpRunLogModel.find({
      fieldId: { $in: fieldIds },
      date: { $gte: baselineStart, $lte: advisedEnd },
    });

    const allNotes = await FarmerNoteModel.find({
      fieldId: { $in: fieldIds },
      date: { $gte: baselineStart, $lte: advisedEnd },
    });

    const farmerPhoneHashes = farmers
      .map((f) => f.phoneHash)
      .filter((h): h is string => Boolean(h));

    const [channels, whatsappShares, allOutbounds, allInbounds] = await Promise.all([
      MessageChannelModel.find({
        externalIdHash: { $in: farmerPhoneHashes },
      }),
      WhatsAppShareLogModel.find({
        farmerId: { $in: farmerIds },
      }),
      OutboundMessageModel.find({
        status: { $in: ['sent', 'delivered', 'seen'] },
        createdAt: {
          $gte: new Date(`${baselineStart}T00:00:00.000Z`),
          $lte: new Date(`${advisedEnd}T23:59:59.999Z`),
        },
      }),
      InboundMessageModel.find({
        externalIdHash: { $in: farmerPhoneHashes },
        createdAt: {
          $gte: new Date(`${baselineStart}T00:00:00.000Z`),
          $lte: new Date(`${advisedEnd}T23:59:59.999Z`),
        },
      }),
    ]);

    const channelMap = new Map<string, string>(); // farmerId -> channelId
    for (const farmer of farmers) {
      if (farmer.phoneHash) {
        const ch = channels.find((c) => c.externalIdHash === farmer.phoneHash);
        if (ch) {
          channelMap.set(farmer._id.toString(), ch._id.toString());
        }
      }
    }

    // Helper mappings
    const farmerMap = new Map<string, (typeof farmers)[0]>();
    for (const f of farmers) {
      farmerMap.set(f._id.toString(), f);
    }

    const fieldMap = new Map<string, (typeof fields)[0]>();
    for (const fld of fields) {
      fieldMap.set(fld._id.toString(), fld);
    }

    // Build day-by-day records
    const buildRecordsForPeriod = (start: string, end: string, periodType: 'baseline' | 'advised'): DailyPilotRecord[] => {
      const records: DailyPilotRecord[] = [];
      const cur = new Date(start);
      const stop = new Date(end);

      while (cur <= stop) {
        const dStr = cur.toISOString().split('T')[0]!;

        for (const fld of fields) {
          const farmer = fld.farmerId ? farmerMap.get(fld.farmerId.toString()) : null;
          const farmerName = farmer?.name || 'Farmer';
          const village = farmer?.village || 'Village';

          const dayRecs = allRecommendations.filter(
            (r) => r.fieldId.toString() === fld._id.toString() && r.forDate === dStr,
          );
          const dayIrrLogs = allIrrigationLogs.filter(
            (l) => l.fieldId.toString() === fld._id.toString() && l.date === dStr,
          );
          const dayPumpLogs = allPumpLogs.filter(
            (p) => p.fieldId.toString() === fld._id.toString() && p.date === dStr,
          );
          const dayNotes = allNotes.filter(
            (n) => n.fieldId?.toString() === fld._id.toString() && n.date === dStr,
          );

          const channelId = fld.farmerId ? channelMap.get(fld.farmerId.toString()) : null;
          const dayOutbounds = allOutbounds.filter((m) => {
            const mDate = (m.sentAt || m.createdAt).toISOString().split('T')[0]!;
            return channelId && m.channelId.toString() === channelId && mDate === dStr;
          });

          const dayShares = whatsappShares.filter((w) => {
            const wDate = w.sharedAt ? w.sharedAt.toISOString().split('T')[0]! : '';
            return fld.farmerId && w.farmerId.toString() === fld.farmerId.toString() && wDate === dStr;
          });

          const dayInbounds = allInbounds.filter((m) => {
            const mDate = m.createdAt ? m.createdAt.toISOString().split('T')[0]! : '';
            return farmer?.phoneHash && m.externalIdHash === farmer.phoneHash && mDate === dStr;
          });

          const rainMm = dayRecs.reduce((sum, r) => sum + (r.rainMm || 0), 0);
          const netCropNeedMm = dayRecs.reduce((sum, r) => sum + (r.netMm || 0), 0);

          let waterAppliedMm = dayIrrLogs.reduce((sum, l) => sum + (l.appliedMm || 0), 0);
          const pumpMinutes = dayPumpLogs.reduce((sum, p) => sum + (p.minutes || 0), 0);

          // If pump logs exist but no irrigation log, derive applied mm from litres and field area
          if (waterAppliedMm === 0 && dayPumpLogs.length > 0) {
            const totalLitres = dayPumpLogs.reduce((sum, p) => sum + (p.litres || 0), 0);
            if (fld.areaHa > 0) {
              waterAppliedMm = Number((totalLitres / (fld.areaHa * 10000)).toFixed(2));
            }
          }

          // Pump cost
          const pumpHours = pumpMinutes / 60;
          const pumpCost = Number((pumpHours * 25).toFixed(2)); // estimated baseline or pump rate

          const adviceSent =
            dayOutbounds.length > 0 ||
            dayShares.length > 0 ||
            (periodType === 'advised' && dayRecs.some((r) => r.action === 'irrigate'));
          const replyReceived = dayInbounds.length > 0;
          const adviceFollowed =
            dayNotes.some((n) => n.status === 'followed') ||
            waterAppliedMm > 0 ||
            dayPumpLogs.length > 0;

          // Push record if there is any activity or to track daily telemetry
          records.push({
            farmerId: fld.farmerId?.toString() || 'farmer-unknown',
            farmerName,
            fieldId: fld._id.toString(),
            fieldName: fld.name,
            village,
            period: periodType,
            date: dStr,
            rainMm,
            netCropNeedMm,
            waterAppliedMm,
            pumpMinutes,
            pumpCost,
            adviceSent,
            replyReceived,
            adviceFollowed,
          });
        }

        cur.setDate(cur.getDate() + 1);
      }

      return records;
    };

    const baselineRecords = buildRecordsForPeriod(baselineStart, baselineEnd, 'baseline');
    const advisedRecords = buildRecordsForPeriod(advisedStart, advisedEnd, 'advised');

    // Aggregate usage
    const usageQuery: Record<string, unknown> = { orgId: orgObjectId };
    if (params.advisedStart && params.advisedEnd) {
      usageQuery.date = { $gte: params.advisedStart, $lte: params.advisedEnd };
    }
    const usageLogs = await UsageLogModel.find(usageQuery);

    let messagesSent = usageLogs
      .filter((u) => u.type === 'message')
      .reduce((sum, u) => sum + u.quantity, 0);
    if (messagesSent === 0) {
      messagesSent = allOutbounds.length;
    }

    let storageGb = usageLogs
      .filter((u) => u.type === 'storage')
      .reduce((sum, u) => sum + u.quantity, 0);
    if (storageGb === 0) {
      storageGb = Number(((fields.length * 0.05) + (farmers.length * 0.02)).toFixed(2));
    }

    let requestsCount = usageLogs
      .filter((u) => u.type === 'request')
      .reduce((sum, u) => sum + u.quantity, 0);
    if (requestsCount === 0) {
      requestsCount = Math.max(100, (allRecommendations.length + allOutbounds.length + allInbounds.length) * 5);
    }

    const baselineInput: PeriodInput = {
      periodLabel: 'baseline',
      startDate: baselineStart,
      endDate: baselineEnd,
      records: baselineRecords,
    };

    const advisedInput: PeriodInput = {
      periodLabel: 'advised',
      startDate: advisedStart,
      endDate: advisedEnd,
      records: advisedRecords,
    };

    const totalDays = baselineRecords.length > 0 ? 28 : 14;

    const usage: UsageStats = {
      messagesSent,
      storageGb,
      requestsCount,
      periodDays: totalDays,
    };

    return buildPilotComparisonMetrics(
      {
        farmersCount: Math.max(1, farmers.length),
        fieldsCount: Math.max(1, fields.length),
      },
      baselineInput,
      advisedInput,
      usage,
      params.unitPrices,
      lang,
    );
  }

  /**
   * Generates a beautifully formatted HTML report string.
   */
  renderReportHtml(data: PilotImpactReportData): string {
    const isHi = data.language === 'hi';

    const t = isHi
      ? {
          title: 'IrrigIQ पायलट प्रभाव एवं जल प्रबंधन रिपोर्ट',
          subtitle: 'कृषि जल अनुकूलन एवं परिचालन टेलीमेट्री सारांश',
          generatedOn: 'रिपोर्ट दिनांक',
          cohort: 'परीक्षण समूह',
          farmers: 'किसान',
          fields: 'खेत',
          summaryTitle: 'जल लेखांकन एवं प्रभाव सारांश',
          metric: 'मापदंड',
          baseline: 'आधारभूत अवधि (Baseline)',
          advised: 'सलाह अवधि (Advised)',
          difference: 'अंतर / प्रभाव',
          periodDates: 'अवधि दिनांक',
          rainfall: 'कुल वर्षा',
          netCropNeed: 'शुद्ध फसल जल मांग',
          waterApplied: 'कुल दिया गया पानी',
          applicationRatio: 'जल अनुप्रयोग अनुपात (Applied / Need)',
          pumpHoursWeek: 'पंप घंटे प्रति सप्ताह',
          pumpCostWeek: 'पंप ऊर्जा लागत प्रति सप्ताह',
          savingsTitle: 'जल बचत एवं मौसम संदर्भ (अनिवार्य घोषणा)',
          savingsNote: 'नोट: जल बचत को केवल संबंधित अवधियों की वर्षा के साथ देखा जाना चाहिए।',
          engagementTitle: 'पायलट सहभागिता एवं परिचालन मेट्रिक्स',
          adviceDelivered: 'सलाह संदेश वितरित',
          replyRate: 'किसान प्रत्युत्तर दर',
          daysFollowed: 'सलाह अनुपालन के दिन',
          costToServeTitle: 'प्रति किसान सेवा लागत (Cost-to-Serve)',
          costAssumptionNote: 'सभी दरें अपरिक्षीत इंजीनियरिंग धारणाएं हैं:',
          monthlyCostPerFarmer: 'प्रति किसान मासिक सेवा लागत',
          totalMonthlyCost: 'कुल मासिक परिचालन लागत',
          breakdownTitle: 'लागत विवरण',
          messagesCost: 'संदेश लागत',
          storageCost: 'डेटाबेस स्टोरेज',
          requestCost: 'API एवं सर्वर अनुरोध',
          chartTitle: 'जल उपयोग एवं वर्षा तुलना चार्ट',
          assumptionsTitle: 'पद्धति एवं इंजीनियरिंग मान्यताएं (Assumptions)',
          whatThisDoesNotProveTitle: '⚠️ यह क्या सिद्ध नहीं करता (What This Does Not Prove)',
        }
      : {
          title: 'IrrigIQ Pilot Impact & Water Management Report',
          subtitle: 'Agricultural Water Accounting & Operational Telemetry',
          generatedOn: 'Generated On',
          cohort: 'Pilot Cohort',
          farmers: 'Farmers',
          fields: 'Fields',
          summaryTitle: 'Water Accounting & Pilot Summary',
          metric: 'Metric',
          baseline: 'Baseline Period',
          advised: 'Advised Period',
          difference: 'Difference / Impact',
          periodDates: 'Period Dates',
          rainfall: 'Total Rainfall',
          netCropNeed: 'Net Crop Water Need',
          waterApplied: 'Total Water Applied',
          applicationRatio: 'Application Ratio (Applied / Need)',
          pumpHoursWeek: 'Pump Hours per Week',
          pumpCostWeek: 'Pump Energy Cost per Week',
          savingsTitle: 'Water Savings & Contextual Climate Figures',
          savingsNote: 'Note: Savings are strictly evaluated beside baseline and advised rainfall figures.',
          engagementTitle: 'Pilot Engagement & Advisory Telemetry',
          adviceDelivered: 'Advice Delivered',
          replyRate: 'Farmer Reply Rate',
          daysFollowed: 'Days Advice Followed',
          costToServeTitle: 'Cost-to-Serve per Farmer per Month',
          costAssumptionNote: 'Configurable cloud infrastructure unit price assumptions:',
          monthlyCostPerFarmer: 'Monthly Cost per Farmer',
          totalMonthlyCost: 'Total Monthly Cloud Cost',
          breakdownTitle: 'Cost Breakdown',
          messagesCost: 'Messaging Cost',
          storageCost: 'Storage Cost',
          requestCost: 'API Requests Cost',
          chartTitle: 'Water Accounting & Precipitation Comparison',
          assumptionsTitle: 'Methodology & Engineering Assumptions',
          whatThisDoesNotProveTitle: '⚠️ What This Does Not Prove',
        };

    const currencySymbol = data.costToServe.assumptions.currencySymbol || '₹';

    // SVG Chart comparison for Water Applied vs Need and Rain
    const maxBar = Math.max(
      data.baseline.totalWaterAppliedMm,
      data.advised.totalWaterAppliedMm,
      data.baseline.totalNetCropNeedMm,
      data.advised.totalNetCropNeedMm,
      data.baseline.totalRainMm,
      data.advised.totalRainMm,
      10,
    );

    const calcBarHeight = (val: number) => Math.min(120, Math.max(4, Math.round((val / maxBar) * 120)));

    const hBaseWater = calcBarHeight(data.baseline.totalWaterAppliedMm);
    const hAdvWater = calcBarHeight(data.advised.totalWaterAppliedMm);
    const hBaseNeed = calcBarHeight(data.baseline.totalNetCropNeedMm);
    const hAdvNeed = calcBarHeight(data.advised.totalNetCropNeedMm);
    const hBaseRain = calcBarHeight(data.baseline.totalRainMm);
    const hAdvRain = calcBarHeight(data.advised.totalRainMm);

    return `<!DOCTYPE html>
<html lang="${data.language}">
<head>
  <meta charset="UTF-8">
  <title>${data.title}</title>
  <style>
    @page {
      size: A4;
      margin: 12mm 10mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Devanagari", Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.45;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }
    .header {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .title {
      font-size: 18pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .subtitle {
      font-size: 10pt;
      color: #64748b;
      margin: 0;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 9pt;
      color: #475569;
    }
    .section-title {
      font-size: 13pt;
      font-weight: 600;
      color: #0369a1;
      margin: 14px 0 8px 0;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      font-size: 9.5pt;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #334155;
    }
    td.num, th.num {
      text-align: right;
    }
    .badge-nodata {
      background-color: #fef3c7;
      color: #b45309;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 8.5pt;
    }
    .savings-box {
      background-color: #f0fdf4;
      border: 1.5px solid #22c55e;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
    }
    .savings-header {
      font-weight: 700;
      color: #15803d;
      margin-bottom: 6px;
      font-size: 11pt;
    }
    .savings-statement {
      font-size: 10pt;
      color: #166534;
      margin-bottom: 4px;
    }
    .savings-climate-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 9pt;
      color: #14532d;
      background: #dcfce7;
      padding: 6px 8px;
      border-radius: 4px;
      margin-top: 6px;
    }
    .chart-container {
      display: flex;
      justify-content: space-around;
      align-items: flex-end;
      height: 140px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 14px;
      background-color: #fafafa;
    }
    .chart-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 75px;
    }
    .chart-bar-wrap {
      display: flex;
      align-items: flex-end;
      height: 120px;
      gap: 4px;
    }
    .chart-bar {
      width: 28px;
      border-radius: 3px 3px 0 0;
      text-align: center;
      color: #fff;
      font-size: 7.5pt;
      font-weight: 600;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 2px;
      box-sizing: border-box;
    }
    .bar-water { background-color: #0284c7; }
    .bar-need { background-color: #f59e0b; }
    .bar-rain { background-color: #10b981; }
    .chart-label {
      font-size: 8pt;
      color: #475569;
      margin-top: 4px;
      text-align: center;
    }
    .assumptions-box {
      background-color: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 9pt;
      color: #334155;
      margin-bottom: 12px;
    }
    .caveat-box {
      background-color: #fef2f2;
      border: 1.5px solid #ef4444;
      border-radius: 6px;
      padding: 10px 12px;
      margin-top: 14px;
    }
    .caveat-title {
      font-weight: 700;
      color: #b91c1c;
      margin-bottom: 4px;
      font-size: 10.5pt;
    }
    .caveat-text {
      color: #991b1b;
      font-size: 9pt;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">${data.title}</h1>
    <p class="subtitle">${t.subtitle}</p>
    <div class="meta-bar">
      <span><strong>${t.cohort}:</strong> ${data.cohortSize.farmersCount} ${t.farmers}, ${data.cohortSize.fieldsCount} ${t.fields}</span>
      <span><strong>${t.generatedOn}:</strong> ${data.generatedAt.split('T')[0]}</span>
    </div>
  </div>

  <!-- Summary Table -->
  <div class="section-title">${t.summaryTitle}</div>
  <table>
    <thead>
      <tr>
        <th>${t.metric}</th>
        <th>${t.baseline}</th>
        <th>${t.advised}</th>
        <th class="num">${t.difference}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${t.periodDates}</strong></td>
        <td>${data.baseline.startDate} to ${data.baseline.endDate} (${data.baseline.days}d)</td>
        <td>${data.advised.startDate} to ${data.advised.endDate} (${data.advised.days}d)</td>
        <td class="num">-</td>
      </tr>
      <tr>
        <td><strong>${t.rainfall}</strong></td>
        <td>${data.baseline.totalRainMm} mm</td>
        <td>${data.advised.totalRainMm} mm</td>
        <td class="num">${data.savingsWithContext.rainDifferenceMm >= 0 ? '+' : ''}${data.savingsWithContext.rainDifferenceMm} mm</td>
      </tr>
      <tr>
        <td><strong>${t.netCropNeed}</strong></td>
        <td>${data.baseline.totalNetCropNeedMm} mm</td>
        <td>${data.advised.totalNetCropNeedMm} mm</td>
        <td class="num">${(data.advised.totalNetCropNeedMm - data.baseline.totalNetCropNeedMm).toFixed(2)} mm</td>
      </tr>
      <tr>
        <td><strong>${t.waterApplied}</strong></td>
        <td>${data.baseline.totalWaterAppliedMm} mm</td>
        <td>${data.advised.totalWaterAppliedMm} mm</td>
        <td class="num">${data.savingsWithContext.waterSavedMm !== null ? `${data.savingsWithContext.waterSavedMm} mm` : '<span class="badge-nodata">N/A</span>'}</td>
      </tr>
      <tr>
        <td><strong>${t.applicationRatio}</strong></td>
        <td>${data.baseline.applicationRatio.status === 'not_enough_data' ? `<span class="badge-nodata">${data.baseline.applicationRatio.ratioFormatted}</span>` : data.baseline.applicationRatio.ratioFormatted}</td>
        <td>${data.advised.applicationRatio.status === 'not_enough_data' ? `<span class="badge-nodata">${data.advised.applicationRatio.ratioFormatted}</span>` : data.advised.applicationRatio.ratioFormatted}</td>
        <td class="num">-</td>
      </tr>
      <tr>
        <td><strong>${t.pumpHoursWeek}</strong></td>
        <td>${data.baseline.pumpHoursPerWeek} hrs/wk</td>
        <td>${data.advised.pumpHoursPerWeek} hrs/wk</td>
        <td class="num">${(data.baseline.pumpHoursPerWeek - data.advised.pumpHoursPerWeek).toFixed(2)} hrs/wk</td>
      </tr>
      <tr>
        <td><strong>${t.pumpCostWeek}</strong></td>
        <td>${currencySymbol}${data.baseline.pumpCostPerWeek}/wk</td>
        <td>${currencySymbol}${data.advised.pumpCostPerWeek}/wk</td>
        <td class="num">${data.savingsWithContext.costSavedPerWeek !== null ? `${currencySymbol}${data.savingsWithContext.costSavedPerWeek}/wk` : '<span class="badge-nodata">N/A</span>'}</td>
      </tr>
    </tbody>
  </table>

  <!-- Savings with Climate Context (Strictly beside period and rain figures) -->
  <div class="savings-box">
    <div class="savings-header">🌿 ${t.savingsTitle}</div>
    <div class="savings-statement">${data.savingsWithContext.statement}</div>
    <div class="savings-climate-grid">
      <div><strong>${t.baseline}:</strong> ${data.savingsWithContext.baselinePeriod.start} - ${data.savingsWithContext.baselinePeriod.end} (${data.savingsWithContext.baselinePeriod.days}d) | <strong>Rain:</strong> ${data.savingsWithContext.baselineRainMm} mm</div>
      <div><strong>${t.advised}:</strong> ${data.savingsWithContext.advisedPeriod.start} - ${data.savingsWithContext.advisedPeriod.end} (${data.savingsWithContext.advisedPeriod.days}d) | <strong>Rain:</strong> ${data.savingsWithContext.advisedRainMm} mm</div>
    </div>
    <div style="font-size: 8pt; color: #166534; margin-top: 4px;">${t.savingsNote}</div>
  </div>

  <!-- Visual Charts Comparison -->
  <div class="section-title">${t.chartTitle}</div>
  <div class="chart-container">
    <div class="chart-col">
      <div class="chart-bar-wrap">
        <div class="chart-bar bar-water" style="height: ${hBaseWater}px;">${data.baseline.totalWaterAppliedMm > 0 ? `${Math.round(data.baseline.totalWaterAppliedMm)}` : ''}</div>
        <div class="chart-bar bar-need" style="height: ${hBaseNeed}px;">${Math.round(data.baseline.totalNetCropNeedMm)}</div>
      </div>
      <div class="chart-label">Baseline Water/Need</div>
    </div>
    <div class="chart-col">
      <div class="chart-bar-wrap">
        <div class="chart-bar bar-water" style="height: ${hAdvWater}px;">${data.advised.totalWaterAppliedMm > 0 ? `${Math.round(data.advised.totalWaterAppliedMm)}` : ''}</div>
        <div class="chart-bar bar-need" style="height: ${hAdvNeed}px;">${Math.round(data.advised.totalNetCropNeedMm)}</div>
      </div>
      <div class="chart-label">Advised Water/Need</div>
    </div>
    <div class="chart-col">
      <div class="chart-bar-wrap">
        <div class="chart-bar bar-rain" style="height: ${hBaseRain}px;">${Math.round(data.baseline.totalRainMm)}</div>
        <div class="chart-bar bar-rain" style="height: ${hAdvRain}px;">${Math.round(data.advised.totalRainMm)}</div>
      </div>
      <div class="chart-label">Baseline vs Advised Rain</div>
    </div>
  </div>

  <!-- Pilot Engagement Table -->
  <div class="section-title">${t.engagementTitle}</div>
  <table>
    <thead>
      <tr>
        <th>${t.adviceDelivered}</th>
        <th>${t.replyRate}</th>
        <th>${t.daysFollowed}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${data.advised.adviceDelivered}</strong> advisories</td>
        <td><strong>${data.advised.replyRatePercent}%</strong> (${data.advised.repliesReceived} replies)</td>
        <td><strong>${data.advised.daysFollowed}</strong> distinct days</td>
      </tr>
    </tbody>
  </table>

  <!-- Cost-to-Serve per Farmer per Month -->
  <div class="section-title">${t.costToServeTitle}</div>
  <table>
    <thead>
      <tr>
        <th>${t.monthlyCostPerFarmer}</th>
        <th>${t.totalMonthlyCost}</th>
        <th>${t.messagesCost}</th>
        <th>${t.storageCost}</th>
        <th>${t.requestCost}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong style="color: #0369a1; font-size: 11pt;">${currencySymbol}${data.costToServe.costPerFarmerPerMonth} / farmer / mo</strong></td>
        <td><strong>${currencySymbol}${data.costToServe.monthlyTotalCost} / mo</strong></td>
        <td>${currencySymbol}${data.costToServe.breakdown.messageCost}</td>
        <td>${currencySymbol}${data.costToServe.breakdown.storageCost}</td>
        <td>${currencySymbol}${data.costToServe.breakdown.requestCost}</td>
      </tr>
    </tbody>
  </table>
  <div style="font-size: 8pt; color: #64748b; margin-top: -8px; margin-bottom: 12px;">
    <strong>ℹ️ ${t.costAssumptionNote}</strong> ${data.costToServe.assumptions.notes}
  </div>

  <!-- Methodology & Engineering Assumptions -->
  <div class="section-title">${t.assumptionsTitle}</div>
  <div class="assumptions-box">
    <p style="margin: 0 0 4px 0;">• <strong>Baseline Reporting:</strong> ${data.caveats.baselineSelfReported}</p>
    <p style="margin: 0 0 4px 0;">• <strong>Weather Variability:</strong> ${data.caveats.weatherDifference}</p>
    <p style="margin: 0 0 4px 0;">• <strong>Cohort Scope:</strong> ${data.caveats.sampleSize}</p>
    <p style="margin: 0;">• <strong>Unit Pricing:</strong> ${data.caveats.unitCostsAssumption}</p>
  </div>

  <!-- Mandatory Plain 'What this does not prove' section -->
  <div class="caveat-box">
    <div class="caveat-title">${t.whatThisDoesNotProveTitle}</div>
    <p class="caveat-text">${data.caveats.whatThisDoesNotProve}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Generates a PDF Buffer reusing the report pipeline.
   */
  async generatePdf(data: PilotImpactReportData): Promise<Buffer> {
    const html = this.renderReportHtml(data);
    return generatePdfFromHtml(html);
  }

  /**
   * Generates CSV export matching PDF totals.
   */
  generateCsv(data: PilotImpactReportData): string {
    return generatePilotCsv(data);
  }
}

export const pilotMetricsService = new PilotMetricsService();
