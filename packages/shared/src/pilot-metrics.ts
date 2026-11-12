/**
 * Pilot Metrics & Impact Report domain logic.
 * Pure functions for water accounting, application ratios, engagement, and cost-to-serve.
 */

export type PeriodType = 'baseline' | 'advised';

export interface DailyPilotRecord {
  farmerId: string;
  farmerName: string;
  fieldId: string;
  fieldName: string;
  village: string;
  period: PeriodType;
  date: string; // YYYY-MM-DD
  rainMm: number;
  netCropNeedMm: number;
  waterAppliedMm: number;
  pumpMinutes: number;
  pumpCost: number;
  adviceSent: boolean;
  replyReceived: boolean;
  adviceFollowed: boolean;
}

export interface PeriodInput {
  periodLabel: PeriodType;
  startDate: string;
  endDate: string;
  records: DailyPilotRecord[];
}

export interface ApplicationRatioResult {
  status: 'valid' | 'not_enough_data';
  ratio: number | null;
  ratioFormatted: string; // e.g. "1.25" or "Not enough data" / "डेटा अपर्याप्त"
  waterAppliedMm: number;
  netCropNeedMm: number;
}

export interface PeriodSummary {
  periodLabel: PeriodType;
  startDate: string;
  endDate: string;
  days: number;
  weeks: number;
  totalRainMm: number;
  totalNetCropNeedMm: number;
  totalWaterAppliedMm: number;
  applicationRatio: ApplicationRatioResult;
  totalPumpHours: number;
  pumpHoursPerWeek: number;
  totalPumpCost: number;
  pumpCostPerWeek: number;
  adviceDelivered: number;
  repliesReceived: number;
  replyRate: number; // 0 to 1
  replyRatePercent: number; // 0 to 100
  daysFollowed: number;
  hasData: boolean;
}

export interface CostAssumptions {
  costPerMessage: number; // in currency units (e.g. ₹0.20)
  costPerGbStorage: number; // in currency units (e.g. ₹2.00 / GB / month)
  costPerThousandRequests: number; // in currency units (e.g. ₹0.10 / 1000 reqs)
  currencySymbol: string; // '₹'
}

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  costPerMessage: 0.20,
  costPerGbStorage: 2.00,
  costPerThousandRequests: 0.10,
  currencySymbol: '₹',
};

export interface UsageStats {
  messagesSent: number;
  storageGb: number;
  requestsCount: number;
  periodDays: number;
}

export interface CostToServeResult {
  monthlyTotalCost: number;
  costPerFarmerPerMonth: number;
  farmerCount: number;
  breakdown: {
    messageCost: number;
    storageCost: number;
    requestCost: number;
  };
  assumptions: CostAssumptions & {
    periodDays: number;
    isAssumption: true;
    notes: string;
  };
}

export interface SavingsWithContext {
  baselinePeriod: { start: string; end: string; days: number };
  advisedPeriod: { start: string; end: string; days: number };
  baselineRainMm: number;
  advisedRainMm: number;
  rainDifferenceMm: number;
  hasBaselineData: boolean;
  waterSavedMm: number | null;
  waterSavedPercent: number | null;
  costSavedPerWeek: number | null;
  statement: string;
}

export interface PilotCaveats {
  baselineSelfReported: string;
  weatherDifference: string;
  sampleSize: string;
  unitCostsAssumption: string;
  whatThisDoesNotProve: string;
}

export interface PilotImpactReportData {
  title: string;
  generatedAt: string;
  language: 'en' | 'hi';
  cohortSize: {
    farmersCount: number;
    fieldsCount: number;
  };
  baseline: PeriodSummary;
  advised: PeriodSummary;
  savingsWithContext: SavingsWithContext;
  costToServe: CostToServeResult;
  caveats: PilotCaveats;
  rawRecords: DailyPilotRecord[];
}

/**
 * Calculates total advice delivered.
 */
export function calculateAdviceDelivered(records: Pick<DailyPilotRecord, 'adviceSent'>[]): number {
  return records.filter((r) => r.adviceSent).length;
}

/**
 * Calculates reply rate from replies count and delivered advice.
 */
export function calculateReplyRate(
  repliesCount: number,
  adviceDelivered: number,
): { rate: number; percent: number; formatted: string } {
  if (adviceDelivered <= 0 || repliesCount < 0) {
    return { rate: 0, percent: 0, formatted: '0.0%' };
  }
  const rate = Math.min(1, repliesCount / adviceDelivered);
  const percent = Number((rate * 100).toFixed(1));
  return { rate, percent, formatted: `${percent}%` };
}

/**
 * Calculates distinct days on which advice was followed.
 */
export function calculateDaysFollowed(
  records: Pick<DailyPilotRecord, 'adviceFollowed' | 'date'>[],
): number {
  const followedDates = new Set<string>();
  for (const r of records) {
    if (r.adviceFollowed) {
      followedDates.add(r.date);
    }
  }
  return followedDates.size;
}

/**
 * Calculates pump hours and cost per week.
 */
export function calculatePumpHoursAndCostPerWeek(
  records: Pick<DailyPilotRecord, 'pumpMinutes' | 'pumpCost'>[],
  daysCount: number,
): {
  totalHours: number;
  hoursPerWeek: number;
  totalCost: number;
  costPerWeek: number;
} {
  const totalMinutes = records.reduce((sum, r) => sum + (r.pumpMinutes || 0), 0);
  const totalCost = Number(records.reduce((sum, r) => sum + (r.pumpCost || 0), 0).toFixed(2));
  const totalHours = Number((totalMinutes / 60).toFixed(2));

  const safeDays = Math.max(1, daysCount);
  const weeks = safeDays / 7;

  const hoursPerWeek = Number((totalHours / weeks).toFixed(2));
  const costPerWeek = Number((totalCost / weeks).toFixed(2));

  return { totalHours, hoursPerWeek, totalCost, costPerWeek };
}

/**
 * Calculates application ratio: Water Applied / Net Crop Need.
 * Produces a strict 'not enough data' state when baseline has no data.
 */
export function calculateApplicationRatio(
  waterAppliedMm: number,
  netCropNeedMm: number,
  hasData: boolean,
  lang: 'en' | 'hi' = 'en',
): ApplicationRatioResult {
  const notEnoughDataLabel = lang === 'hi' ? 'डेटा अपर्याप्त' : 'Not enough data';

  if (!hasData) {
    return {
      status: 'not_enough_data',
      ratio: null,
      ratioFormatted: notEnoughDataLabel,
      waterAppliedMm,
      netCropNeedMm,
    };
  }

  if (netCropNeedMm <= 0) {
    return {
      status: 'valid',
      ratio: 0,
      ratioFormatted: '0.00',
      waterAppliedMm,
      netCropNeedMm,
    };
  }

  const ratio = Number((waterAppliedMm / netCropNeedMm).toFixed(2));
  return {
    status: 'valid',
    ratio,
    ratioFormatted: ratio.toFixed(2),
    waterAppliedMm,
    netCropNeedMm,
  };
}

/**
 * Computes calendar days between two ISO date strings (inclusive).
 */
export function countDaysBetween(startDate: string, endDate: string): number {
  if (!startDate || !endDate || startDate > endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Summarizes a single period (baseline or advised).
 */
export function calculatePeriodSummary(
  input: PeriodInput,
  lang: 'en' | 'hi' = 'en',
): PeriodSummary {
  const days = Math.max(1, countDaysBetween(input.startDate, input.endDate));
  const weeks = Number((days / 7).toFixed(2));

  // Determine if period has actual data
  const hasData = input.records.length > 0 && input.records.some((r) => r.waterAppliedMm > 0 || r.netCropNeedMm > 0);

  const totalRainMm = Number(input.records.reduce((sum, r) => sum + (r.rainMm || 0), 0).toFixed(2));
  const totalNetCropNeedMm = Number(
    input.records.reduce((sum, r) => sum + (r.netCropNeedMm || 0), 0).toFixed(2),
  );
  const totalWaterAppliedMm = Number(
    input.records.reduce((sum, r) => sum + (r.waterAppliedMm || 0), 0).toFixed(2),
  );

  const applicationRatio = calculateApplicationRatio(
    totalWaterAppliedMm,
    totalNetCropNeedMm,
    hasData,
    lang,
  );

  const { totalHours, hoursPerWeek, totalCost, costPerWeek } = calculatePumpHoursAndCostPerWeek(
    input.records,
    days,
  );

  const adviceDelivered = calculateAdviceDelivered(input.records);
  const repliesReceived = input.records.filter((r) => r.replyReceived).length;
  const replyRateStats = calculateReplyRate(repliesReceived, adviceDelivered);
  const daysFollowed = calculateDaysFollowed(input.records);

  return {
    periodLabel: input.periodLabel,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    weeks,
    totalRainMm,
    totalNetCropNeedMm,
    totalWaterAppliedMm,
    applicationRatio,
    totalPumpHours: totalHours,
    pumpHoursPerWeek: hoursPerWeek,
    totalPumpCost: totalCost,
    pumpCostPerWeek: costPerWeek,
    adviceDelivered,
    repliesReceived,
    replyRate: replyRateStats.rate,
    replyRatePercent: replyRateStats.percent,
    daysFollowed,
    hasData,
  };
}

/**
 * Calculates cost-to-serve per farmer per month from usage logs.
 * All unit prices are marked as configurable assumptions.
 */
export function calculateCostToServe(
  usage: UsageStats,
  farmerCount: number,
  customAssumptions?: Partial<CostAssumptions>,
): CostToServeResult {
  const assumptions: CostAssumptions = {
    ...DEFAULT_COST_ASSUMPTIONS,
    ...customAssumptions,
  };

  const safeFarmers = Math.max(1, farmerCount);
  const safeDays = Math.max(1, usage.periodDays);

  const messageCost = usage.messagesSent * assumptions.costPerMessage;
  const storageCost = usage.storageGb * assumptions.costPerGbStorage;
  const requestCost = (usage.requestsCount / 1000) * assumptions.costPerThousandRequests;

  const totalPeriodCost = messageCost + storageCost + requestCost;

  // Normalize to 30 days (1 month)
  const monthlyTotalCost = Number(((totalPeriodCost / safeDays) * 30).toFixed(2));
  const costPerFarmerPerMonth = Number((monthlyTotalCost / safeFarmers).toFixed(2));

  return {
    monthlyTotalCost,
    costPerFarmerPerMonth,
    farmerCount: safeFarmers,
    breakdown: {
      messageCost: Number(messageCost.toFixed(2)),
      storageCost: Number(storageCost.toFixed(2)),
      requestCost: Number(requestCost.toFixed(2)),
    },
    assumptions: {
      ...assumptions,
      periodDays: safeDays,
      isAssumption: true,
      notes: `Unit prices (${assumptions.currencySymbol}${assumptions.costPerMessage}/msg, ${assumptions.currencySymbol}${assumptions.costPerGbStorage}/GB-mo, ${assumptions.currencySymbol}${assumptions.costPerThousandRequests}/1k reqs) are unverified engineering assumptions.`,
    },
  };
}

/**
 * Formats savings strictly coupled with period and rain figures.
 * Rule: Never show a saving without the period and rain figures beside it.
 */
export function formatSavingsWithContext(
  baseline: PeriodSummary,
  advised: PeriodSummary,
  lang: 'en' | 'hi' = 'en',
): SavingsWithContext {
  const baselinePeriod = { start: baseline.startDate, end: baseline.endDate, days: baseline.days };
  const advisedPeriod = { start: advised.startDate, end: advised.endDate, days: advised.days };
  const baselineRainMm = baseline.totalRainMm;
  const advisedRainMm = advised.totalRainMm;
  const rainDifferenceMm = Number((advisedRainMm - baselineRainMm).toFixed(2));

  if (!baseline.hasData) {
    const statement =
      lang === 'hi'
        ? `आधारभूत अवधि (${baseline.startDate} से ${baseline.endDate}, वर्षा: ${baselineRainMm} मिमी) में कोई डेटा नहीं है; सलाह अवधि (${advised.startDate} से ${advised.endDate}, वर्षा: ${advisedRainMm} मिमी) के लिए जल बचत की गणना नहीं की जा सकती।`
        : `Baseline period (${baseline.startDate} to ${baseline.endDate}, Rain: ${baselineRainMm} mm) has insufficient data; water savings cannot be computed against advised period (${advised.startDate} to ${advised.endDate}, Rain: ${advisedRainMm} mm).`;

    return {
      baselinePeriod,
      advisedPeriod,
      baselineRainMm,
      advisedRainMm,
      rainDifferenceMm,
      hasBaselineData: false,
      waterSavedMm: null,
      waterSavedPercent: null,
      costSavedPerWeek: null,
      statement,
    };
  }

  const waterSavedMm = Number((baseline.totalWaterAppliedMm - advised.totalWaterAppliedMm).toFixed(2));
  const waterSavedPercent =
    baseline.totalWaterAppliedMm > 0
      ? Number(((waterSavedMm / baseline.totalWaterAppliedMm) * 100).toFixed(1))
      : 0;

  const costSavedPerWeek = Number((baseline.pumpCostPerWeek - advised.pumpCostPerWeek).toFixed(2));

  const statement =
    lang === 'hi'
      ? `जल उपयोग अंतर: ${waterSavedMm} मिमी (${waterSavedPercent}%) [आधारभूत वर्षा: ${baselineRainMm} मिमी (${baseline.startDate} से ${baseline.endDate}) बनाम सलाह अवधि वर्षा: ${advisedRainMm} मिमी (${advised.startDate} से ${advised.endDate})]।`
      : `Water difference: ${waterSavedMm} mm (${waterSavedPercent}%) [Baseline Rain: ${baselineRainMm} mm (${baseline.startDate} to ${baseline.endDate}) vs Advised Rain: ${advisedRainMm} mm (${advised.startDate} to ${advised.endDate})].`;

  return {
    baselinePeriod,
    advisedPeriod,
    baselineRainMm,
    advisedRainMm,
    rainDifferenceMm,
    hasBaselineData: true,
    waterSavedMm,
    waterSavedPercent,
    costSavedPerWeek,
    statement,
  };
}

export const PILOT_CAVEATS_EN: PilotCaveats = {
  baselineSelfReported:
    'Baseline water use is based on self-reported farmer routines prior to pilot deployment, not calibrated tamper-proof water meters.',
  weatherDifference:
    'Weather and rainfall differ between baseline and advised periods. Observed differences in water application are strongly influenced by precipitation variations.',
  sampleSize:
    'Pilot sample size is localized to the cohort and represents observational operational telemetry rather than a randomized multi-season trial.',
  unitCostsAssumption:
    'Cost-to-serve figures rely on configurable cloud infrastructure unit price assumptions (SMS/WhatsApp, DB storage, API calls).',
  whatThisDoesNotProve:
    'What this does not prove: This observational pilot does not prove causal yield increase or randomized controlled trial (RCT) efficiency. Differences in weather, natural rainfall timing, farmer crop stages, and self-reported baseline logs affect results and prevent definitive causal attribution without an unadvised randomized control group.',
};

export const PILOT_CAVEATS_HI: PilotCaveats = {
  baselineSelfReported:
    'आधारभूत जल उपयोग पायलट से पहले किसान द्वारा स्वयं रिपोर्ट की गई सामान्य दिनचर्या पर आधारित है, किसी प्रमाणित जल मीटर पर नहीं।',
  weatherDifference:
    'आधारभूत और सलाह अवधि के बीच मौसम और वर्षा में अंतर है। जल अनुप्रयोग में अंतर काफी हद तक प्राकृतिक वर्षा भिन्नता से प्रभावित है।',
  sampleSize:
    'पायलट नमूना आकार स्थानीय समूह तक सीमित है और यह बहु-मौसमी यादृच्छिक परीक्षण के बजाय प्रारंभिक परिचालन टेलीमेट्री दर्शाता है।',
  unitCostsAssumption:
    'सेवा लागत के आंकड़े कॉन्फ़िगर करने योग्य क्लाउड इन्फ्रास्ट्रक्चर इकाई मूल्य मान्यताओं (संदेश, डेटाबेस स्टोरेज, API अनुरोध) पर आधारित हैं।',
  whatThisDoesNotProve:
    'यह क्या सिद्ध नहीं करता: यह अवलोकन पायलट उपज में कारण संबंधी वृद्धि या यादृच्छिक नियंत्रित परीक्षण (RCT) दक्षता को सिद्ध नहीं करता है। मौसम, प्राकृतिक वर्षा का समय, फसल की अवस्था और स्वयं-रिपोर्ट किए गए बेसलाइन डेटा में अंतर परिणामों को प्रभावित करते हैं और बिना समानांतर यादृच्छिक नियंत्रण समूह के कारण-संबंध सिद्ध नहीं किया जा सकता।',
};

/**
 * Builds the comprehensive Pilot Impact Report Data object.
 */
export function buildPilotComparisonMetrics(
  cohort: { farmersCount: number; fieldsCount: number },
  baselineInput: PeriodInput,
  advisedInput: PeriodInput,
  usage: UsageStats,
  customAssumptions?: Partial<CostAssumptions>,
  lang: 'en' | 'hi' = 'en',
): PilotImpactReportData {
  const baseline = calculatePeriodSummary(baselineInput, lang);
  const advised = calculatePeriodSummary(advisedInput, lang);
  const savingsWithContext = formatSavingsWithContext(baseline, advised, lang);
  const costToServe = calculateCostToServe(usage, cohort.farmersCount, customAssumptions);
  const caveats = lang === 'hi' ? PILOT_CAVEATS_HI : PILOT_CAVEATS_EN;

  const rawRecords = [...baselineInput.records, ...advisedInput.records];

  const title =
    lang === 'hi'
      ? 'IrrigIQ पायलट प्रभाव एवं जल प्रबंधन रिपोर्ट'
      : 'IrrigIQ Pilot Impact & Water Management Report';

  return {
    title,
    generatedAt: new Date().toISOString(),
    language: lang,
    cohortSize: cohort,
    baseline,
    advised,
    savingsWithContext,
    costToServe,
    caveats,
    rawRecords,
  };
}

/**
 * Generates raw CSV export matching the PDF totals exactly.
 */
export function generatePilotCsv(data: PilotImpactReportData): string {
  const header = [
    'Farmer',
    'Village',
    'Field',
    'Period',
    'Date',
    'Rain_mm',
    'NetCropNeed_mm',
    'WaterApplied_mm',
    'PumpMinutes',
    'PumpCost',
    'AdviceSent',
    'ReplyReceived',
    'AdviceFollowed',
  ].join(',');

  const rows = data.rawRecords.map((r) =>
    [
      `"${r.farmerName.replace(/"/g, '""')}"`,
      `"${r.village.replace(/"/g, '""')}"`,
      `"${r.fieldName.replace(/"/g, '""')}"`,
      r.period,
      r.date,
      r.rainMm.toFixed(2),
      r.netCropNeedMm.toFixed(2),
      r.waterAppliedMm.toFixed(2),
      r.pumpMinutes,
      r.pumpCost.toFixed(2),
      r.adviceSent ? '1' : '0',
      r.replyReceived ? '1' : '0',
      r.adviceFollowed ? '1' : '0',
    ].join(','),
  );

  return [header, ...rows].join('\n');
}
