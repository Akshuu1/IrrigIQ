import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Types } from 'mongoose';
import { chromium, type Browser } from 'playwright';
import {
  CROPS,
  getCropName,
  type SupportedLanguage,
  computeSavings,
  calculateDaysInRange,
  IRRIGATION_EFFICIENCY,
  IrrigationMethod,
  mmToLitres,
} from '@irrigiq/shared';
import { FieldModel } from '../models/field.model.js';
import { UserModel } from '../models/user.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { ReportModel, IReportData, IReportDocument } from '../models/report.model.js';
import { CreateReportInput } from '../schemas/report.schema.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { checkFieldAccess } from './rbac.service.js';
import { OrganisationRole } from '../models/membership.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache base64 fonts in memory
const fontBase64Cache = new Map<string, string>();

function getFontBase64(fontName: string): string {
  if (fontBase64Cache.has(fontName)) return fontBase64Cache.get(fontName)!;
  const candidates = [
    path.resolve(process.cwd(), `apps/api/assets/fonts/${fontName}`),
    path.resolve(__dirname, `../../assets/fonts/${fontName}`),
    path.resolve(__dirname, `../assets/fonts/${fontName}`),
    path.resolve(__dirname, `../../../apps/api/assets/fonts/${fontName}`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const buf = fs.readFileSync(candidate);
        const b64 = buf.toString('base64');
        fontBase64Cache.set(fontName, b64);
        return b64;
      } catch (err) {
        logger.warn({ err, candidate }, 'Failed to read font file candidate');
      }
    }
  }

  logger.warn({ fontName }, 'Font file not found on disk, continuing without embedded font');
  return '';
}

/**
 * Builds structured report data for a field across a date range.
 * Pure aggregation from MongoDB collections and shared domain models.
 */
export async function buildReportData(
  fieldId: string,
  from: string,
  to: string,
  language: SupportedLanguage = 'en',
): Promise<IReportData> {
  if (!Types.ObjectId.isValid(fieldId)) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const field = await FieldModel.findById(fieldId);
  if (!field) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const user = await UserModel.findById(field.userId);
  const farmerFallback: Record<SupportedLanguage, string> = {
    en: 'Farmer',
    hi: 'किसान',
    mr: 'शेतकरी',
    pa: 'ਕਿਸਾਨ',
    te: 'రైతు',
  };
  const farmerName = user?.name || farmerFallback[language] || 'Farmer';

  const crop = CROPS.find((c) => c.key === field.cropKey);
  const cropNameEn = crop?.nameEn || field.cropKey;
  const cropNameHi = crop?.nameHi || field.cropKey;
  const cropNameMr = crop?.nameMr || field.cropKey;
  const cropNamePa = crop?.namePa || field.cropKey;
  const cropNameTe = crop?.nameTe || field.cropKey;
  const cropName = crop ? getCropName(crop, language) : field.cropKey;

  // 1. Calculate days and date list
  const daysInRange = calculateDaysInRange(from, to);
  const dateList: string[] = [];
  if (from && to && from <= to) {
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      dateList.push(cur.toISOString().split('T')[0]!);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // 2. Fetch recommendations and logs in range
  const recommendations = await RecommendationModel.find({
    fieldId: field._id,
    forDate: { $gte: from, $lte: to },
  }).sort({ forDate: 1 });

  const logs = await IrrigationLogModel.find({
    fieldId: field._id,
    date: { $gte: from, $lte: to },
  }).sort({ date: 1 });

  const recsByDate = new Map<string, (typeof recommendations)[0]>();
  for (const r of recommendations) {
    recsByDate.set(r.forDate, r);
  }

  const logsByDate = new Map<string, typeof logs>();
  for (const l of logs) {
    const existing = logsByDate.get(l.date) || [];
    existing.push(l);
    logsByDate.set(l.date, existing);
  }

  // 3. Compute water accounting totals
  const recommendedGrossMmList = recommendations
    .filter((r) => r.action === 'irrigate')
    .map((r) => r.grossMm);
  const actualGrossMmList = logs.map((l) => l.appliedMm);

  const savings = computeSavings({
    daysInRange,
    baseline: {
      everyDays: field.baseline.everyDays,
      depthMm: field.baseline.depthMm,
    },
    areaHa: field.areaHa,
    recommendedGrossMmList,
    actualGrossMmList,
  });

  const efficiency = IRRIGATION_EFFICIENCY[field.method as IrrigationMethod] ?? 0.75;

  // 4. Build daily table and chart data
  const dailyTable: IReportData['dailyTable'] = [];
  const chartData: IReportData['chartData'] = [];

  for (const d of dateList) {
    const rec = recsByDate.get(d);
    const dayLogs = logsByDate.get(d) || [];
    const actualGrossMm = dayLogs.reduce((acc, curr) => acc + curr.appliedMm, 0);
    const actualLitres = mmToLitres(actualGrossMm, field.areaHa);
    const logSource = dayLogs.length > 0 ? dayLogs[0]!.source : null;

    let reasonText = '';
    if (rec?.reasonKey) {
      reasonText = formatReasonText(rec.reasonKey, rec.params as Record<string, unknown>, language);
    } else if (language === 'hi') {
      reasonText = 'कोई सिफ़ारिश दर्ज नहीं';
    } else {
      reasonText = 'No advisory recorded';
    }

    const etcMm = rec?.etcMm ?? 0;
    const rainMm = rec?.rainMm ?? 0;
    const recommendedGrossMm = rec?.action === 'irrigate' ? rec.grossMm : 0;
    const recommendedLitres = rec?.action === 'irrigate' ? rec.litres : 0;

    dailyTable.push({
      date: d,
      et0Mm: rec?.et0Mm ?? 0,
      etcMm,
      rainMm,
      recommendedAction: rec?.action ?? '-',
      recommendedGrossMm,
      recommendedLitres,
      reasonText,
      actualGrossMm,
      actualLitres,
      logSource,
    });

    chartData.push({
      date: d,
      etcMm,
      rainMm,
      recommendedGrossMm,
      actualGrossMm,
    });
  }

  const baselineNotes: Record<SupportedLanguage, string> = {
    en: "Baseline water use is based on the farmer's own stated routine prior to using IrrigIQ.",
    hi: 'आधारभूत पानी का उपयोग किसान द्वारा IrrigIQ का उपयोग करने से पहले बताई गई दिनचर्या पर आधारित है।',
    mr: 'पारंपरिक पाणी वापर शेतकऱ्याने IrrigIQ वापरण्यापूर्वी नोंदवलेल्या सरासरी पद्धतीवर आधारित आहे.',
    pa: 'ਰਵਾਇਤੀ ਪਾਣੀ ਦੀ ਵਰਤੋਂ ਕਿਸਾਨ ਦੁਆਰਾ IrrigIQ ਵਰਤਣ ਤੋਂ ਪਹਿਲਾਂ ਦੱਸੀ ਗਈ ਆਦਤ ਤੇ ਆਧਾਰਿਤ ਹੈ।',
    te: 'సాంప్రదాయ నీటి వాడకం రైతు IrrigIQ వాడకముందు నమోదు చేసిన సాధారణ అలవాటుపై ఆధారపడి ఉంటుంది.',
  };
  const baselineNote = baselineNotes[language] || baselineNotes.en;

  const disclaimers: Record<SupportedLanguage, string> = {
    en: 'Savings are estimates against the baseline the farmer entered.',
    hi: 'बचत के आंकड़े किसान द्वारा दर्ज की गई आधारभूत दिनचर्या के विरुद्ध अनुमान हैं।',
    mr: 'पाणी बचतीचे आकडे शेतकऱ्याने नोंदवलेल्या पारंपरिक पद्धतीशी तुलनात्मक अंदाज आहेत.',
    pa: 'ਪਾਣੀ ਬੱਚਤ ਦੇ ਅੰਕੜੇ ਕਿਸਾਨ ਵੱਲੋਂ ਦਰਜ ਕੀਤੀ ਰਵਾਇਤੀ ਵਿਧੀ ਵਿਰੁੱਧ ਅੰਦਾਜ਼ਨ ਹਨ।',
    te: 'నీటి ఆదా గణాంకాలు రైతు నమోదు చేసిన సాధారణ అలవాటుతో పోల్చిన అంచనాలు మాత్రమే.',
  };
  const disclaimer = disclaimers[language] || disclaimers.en;

  const dataSourcesMap: Record<SupportedLanguage, string> = {
    en: 'Open-Meteo Forecast API (ET0 FAO-56 Penman-Monteith, precipitation), FAO-56 irrigation science model, and local soil parameters.',
    hi: 'Open-Meteo मौसम पूर्वानुमान API (FAO-56 पेनमैन-मोंटेइथ), ICAR/FAO-56 सिंचाई विज्ञान मॉडल, और स्थानीय मृदा मापदंड।',
    mr: 'Open-Meteo हवामान अंदाज API (FAO-56 पेनमन-माँटिथ), ICAR/FAO-56 सिंचन विज्ञान मॉडेल आणि स्थानिक माती मापदंड.',
    pa: 'Open-Meteo ਮੌਸਮ ਪੂਰਵ-ਅਨੁਮਾਨ API (FAO-56 ਪੈਨਮੈਨ-ਮੌਂਟੀਥ), ICAR/FAO-56 ਸਿੰਚਾਈ ਵਿਗਿਆਨ ਮਾਡਲ ਅਤੇ ਸਥਾਨਕ ਮਿੱਟੀ ਮਾਪਦੰਡ।',
    te: 'Open-Meteo వాతావరణ అంచనా API (FAO-56 పెన్‌మ్యాన్-మోంటెయిత్), ICAR/FAO-56 సాగునీటి శాస్త్రీయ మోడల్ మరియు స్థానిక నేల పారామితులు.',
  };
  const dataSources = dataSourcesMap[language] || dataSourcesMap.en;

  return {
    field: {
      id: field._id.toString(),
      name: field.name,
      farmerName,
      cropKey: field.cropKey,
      cropNameEn,
      cropNameHi,
      cropNameMr,
      cropNamePa,
      cropNameTe,
      cropName,
      sowingDate:
        field.sowingDate instanceof Date
          ? field.sowingDate.toISOString().split('T')[0]!
          : String(field.sowingDate),
      soilType: field.soilType,
      irrigationMethod: field.method,
      areaHa: field.areaHa,
    },
    assumptions: {
      method: field.method,
      efficiency,
      areaHa: field.areaHa,
      baselineEveryDays: field.baseline.everyDays,
      baselineDepthMm: field.baseline.depthMm,
      dataSources,
      baselineNote,
      disclaimer,
    },
    totals: {
      baseline: savings.baseline,
      recommended: savings.recommended,
      actual: savings.actual,
      potentialSaved: savings.potentialSaved,
      realisedSaved: savings.realisedSaved,
    },
    dailyTable,
    chartData,
  };
}

function formatReasonText(
  key: string,
  params: Record<string, unknown> | undefined,
  language: SupportedLanguage = 'en',
): string {
  if (language === 'hi') {
    switch (key) {
      case 'reason.rain_expected':
        return `बारिश होने की संभावना (${params?.mm ?? 0} मिमी) — प्राकृतिक नमी पर्याप्त रहेगी`;
      case 'reason.deficit_reached':
        return `मृदा नमी की कमी ${params?.mm ?? 0} मिमी की सीमा तक पहुंच गई है`;
      case 'reason.sensor_dry':
        return `मृदा सेंसर द्वारा सूखा दर्ज (${params?.pct ?? 0}% नमी) — तुरंत पानी दें`;
      case 'reason.sensor_wet':
        return `मृदा सेंसर द्वारा अत्यधिक नमी दर्ज (${params?.pct ?? 0}% नमी) — खेत में पानी पर्याप्त है`;
      case 'reason.not_needed':
        return 'फसल की जल आवश्यकता पूरी है। आज सिंचाई की आवश्यकता नहीं है।';
      default:
        return key;
    }
  }

  if (language === 'mr') {
    switch (key) {
      case 'reason.rain_expected':
        return `पाऊस पडण्याची शक्यता (${params?.mm ?? 0} मिमी) — नैसर्गिक ओलावा पुरेसा राहील`;
      case 'reason.deficit_reached':
        return `मातीतील ओलाव्याची कमतरता ${params?.mm ?? 0} मिमी मर्यादेवर पोहोचली आहे`;
      case 'reason.sensor_dry':
        return `माती सेन्सरनुसार कोरडेपणा (${params?.pct ?? 0}% ओलावा) — त्वरित पाणी द्या`;
      case 'reason.sensor_wet':
        return `माती सेन्सरनुसार जास्त ओलावा (${params?.pct ?? 0}% ओलावा) — शेतात पुरेसे पाणी आहे`;
      case 'reason.not_needed':
        return 'पिकाची पाण्याची गरज पूर्ण झाली आहे. आज सिंचनाची गरज नाही.';
      default:
        return key;
    }
  }

  if (language === 'pa') {
    switch (key) {
      case 'reason.rain_expected':
        return `ਮੀਂਹ ਪੈਣ ਦੀ ਸੰਭਾਵਨਾ (${params?.mm ?? 0} ਮਿ.ਮੀ.) — ਕੁਦਰਤੀ ਨਮੀ ਕਾਫ਼ੀ ਰਹੇਗੀ`;
      case 'reason.deficit_reached':
        return `ਮਿੱਟੀ ਵਿੱਚ ਨਮੀ ਦੀ ਘਾਟ ${params?.mm ?? 0} ਮਿ.ਮੀ. ਤੱਕ ਪਹੁੰਚ ਗਈ ਹੈ`;
      case 'reason.sensor_dry':
        return `ਮਿੱਟੀ ਸੈਂਸਰ ਅਨੁਸਾਰ ਸੁੱਕੀ (${params?.pct ?? 0}% ਨਮੀ) — ਤੁਰੰਤ ਪਾਣੀ ਲਗਾਓ`;
      case 'reason.sensor_wet':
        return `ਮਿੱਟੀ ਸੈਂਸਰ ਅਨੁਸਾਰ ਵੱਧ ਨਮੀ (${params?.pct ?? 0}% ਨਮੀ) — ਖੇਤ ਵਿੱਚ ਪਾਣੀ ਕਾਫ਼ੀ ਹੈ`;
      case 'reason.not_needed':
        return 'ਫ਼ਸਲ ਦੀ ਪਾਣੀ ਦੀ ਲੋੜ ਪੂਰੀ ਹੈ। ਅੱਜ ਸਿੰਚਾਈ ਦੀ ਲੋੜ ਨਹੀਂ।';
      default:
        return key;
    }
  }

  if (language === 'te') {
    switch (key) {
      case 'reason.rain_expected':
        return `వర్ష సూచన (${params?.mm ?? 0} మిమీ) — సహజ తేమ సరిపోతుంది`;
      case 'reason.deficit_reached':
        return `నేల తేమ లోటు ${params?.mm ?? 0} మిమీ స్థాయికి చేరింది`;
      case 'reason.sensor_dry':
        return `నేల సెన్సార్ పొడిబారినట్లు చూపుతోంది (${params?.pct ?? 0}% తేమ) — వెంటనే నీరు పెట్టండి`;
      case 'reason.sensor_wet':
        return `నేల సెన్సార్ అధిక తేమ చూపుతోంది (${params?.pct ?? 0}% తేమ) — సరిపడా నీరు ఉంది`;
      case 'reason.not_needed':
        return 'పంట నీటి అవసరం తీరింది. ఈరోజు సాగునీరు అవసరం లేదు.';
      default:
        return key;
    }
  }

  switch (key) {
    case 'reason.rain_expected':
      return `Rain expected (${params?.mm ?? 0} mm) — soil moisture will replenish naturally`;
    case 'reason.deficit_reached':
      return `Soil moisture deficit reached trigger (${params?.mm ?? 0} mm)`;
    case 'reason.sensor_dry':
      return `Soil sensor indicates dry soil (${params?.pct ?? 0}% moisture) — irrigate now`;
    case 'reason.sensor_wet':
      return `Soil sensor indicates high moisture (${params?.pct ?? 0}% moisture) — saturated`;
    case 'reason.not_needed':
      return 'Crop water requirement satisfied. No irrigation needed today.';
    default:
      return key;
  }
}

/**
 * Generates an SVG bar chart for daily crop need, rain, recommended and actual water.
 */
function renderSvgChart(chartData: IReportData['chartData'], language: SupportedLanguage = 'en'): string {
  if (chartData.length === 0) {
    const emptyMsg = {
      en: 'No chart data available for this range',
      hi: 'इस अवधि के लिए कोई चार्ट डेटा उपलब्ध नहीं है',
      mr: 'या कालावधीसाठी कोणताही चार्ट डेटा उपलब्ध नाही',
      pa: 'ਇਸ ਸਮੇਂ ਲਈ ਕੋਈ ਚਾਰਟ ਡੇਟਾ ਉਪਲਬਧ ਨਹੀਂ ਹੈ',
      te: 'ఈ కాలానికి చార్ట్ డేటా అందుబాటులో లేదు',
    }[language] || 'No chart data available for this range';
    return `<div style="text-align:center; padding:20px; color:#64748b;">${emptyMsg}</div>`;
  }

  const width = 760;
  const height = 230;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 45;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let maxVal = 10;
  for (const d of chartData) {
    maxVal = Math.max(maxVal, d.etcMm, d.rainMm, d.recommendedGrossMm, d.actualGrossMm);
  }
  maxVal = Math.ceil(maxVal * 1.15); // headroom

  const numDays = chartData.length;
  const groupW = plotW / numDays;
  const barW = Math.max(4, Math.min(14, (groupW - 8) / 4));

  // Y-axis ticks
  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const yGridLines = yTicks
    .map((val) => {
      const y = padTop + plotH - (val / maxVal) * plotH;
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3 3"/>
        <text x="${padLeft - 8}" y="${y + 4}" font-size="10" fill="#64748b" text-anchor="end">${val} mm</text>
      `;
    })
    .join('');

  // Day bars
  const dayElements = chartData
    .map((d, i) => {
      const groupX = padLeft + i * groupW + (groupW - barW * 4) / 2;
      const dateLabel = d.date.slice(5); // MM-DD

      const hEtc = (d.etcMm / maxVal) * plotH;
      const hRain = (d.rainMm / maxVal) * plotH;
      const hRec = (d.recommendedGrossMm / maxVal) * plotH;
      const hAct = (d.actualGrossMm / maxVal) * plotH;

      const yBase = padTop + plotH;

      return `
        <g>
          <!-- Crop ETc (Blue) -->
          <rect x="${groupX}" y="${yBase - hEtc}" width="${barW}" height="${hEtc}" fill="#38bdf8" rx="2"/>
          <!-- Rain (Indigo) -->
          <rect x="${groupX + barW + 1}" y="${yBase - hRain}" width="${barW}" height="${hRain}" fill="#818cf8" rx="2"/>
          <!-- Recommended (Emerald) -->
          <rect x="${groupX + (barW + 1) * 2}" y="${yBase - hRec}" width="${barW}" height="${hRec}" fill="#34d399" rx="2"/>
          <!-- Actual (Amber) -->
          <rect x="${groupX + (barW + 1) * 3}" y="${yBase - hAct}" width="${barW}" height="${hAct}" fill="#fbbf24" rx="2"/>
          <!-- Date label -->
          <text x="${groupX + barW * 2}" y="${height - 15}" font-size="9" fill="#64748b" text-anchor="middle">${dateLabel}</text>
        </g>
      `;
    })
    .join('');

  const legendMap: Record<SupportedLanguage, { etc: string; rain: string; rec: string; act: string }> = {
    hi: {
      etc: 'फसल आवश्यकता (ETc)',
      rain: 'बारिश (वर्षा)',
      rec: 'अनुशंसित सिंचाई',
      act: 'वास्तविक दी गई सिंचाई',
    },
    mr: {
      etc: 'पिकाची गरज (ETc)',
      rain: 'पाऊस',
      rec: 'शिफारस केलेले सिंचन',
      act: 'प्रत्यक्ष दिलेले पाणी',
    },
    pa: {
      etc: 'ਫ਼ਸਲ ਦੀ ਲੋੜ (ETc)',
      rain: 'ਮੀਂਹ',
      rec: 'ਸਿਫਾਰਸ਼ ਕੀਤੀ ਸਿੰਚਾਈ',
      act: 'ਅਸਲ ਲਗਾਇਆ ਪਾਣੀ',
    },
    te: {
      etc: 'పంట నీటి అవసరం (ETc)',
      rain: 'వర్షం',
      rec: 'సిఫార్సు చేసిన సాగునీరు',
      act: 'వాస్తవంగా ఇచ్చిన నీరు',
    },
    en: {
      etc: 'Crop Need (ETc)',
      rain: 'Rainfall',
      rec: 'Recommended Irrigation',
      act: 'Actual Applied',
    },
  };
  const legendText = legendMap[language] || legendMap.en;

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#ffffff; border-radius:12px; font-family:'Noto Sans Devanagari','Noto Sans Gurmukhi','Noto Sans Telugu',sans-serif;">
      <!-- Legend -->
      <g transform="translate(${padLeft}, 15)">
        <rect x="0" y="0" width="10" height="10" fill="#38bdf8" rx="2"/>
        <text x="14" y="9" font-size="10" fill="#475569">${legendText.etc}</text>

        <rect x="180" y="0" width="10" height="10" fill="#818cf8" rx="2"/>
        <text x="194" y="9" font-size="10" fill="#475569">${legendText.rain}</text>

        <rect x="310" y="0" width="10" height="10" fill="#34d399" rx="2"/>
        <text x="324" y="9" font-size="10" fill="#475569">${legendText.rec}</text>

        <rect x="490" y="0" width="10" height="10" fill="#fbbf24" rx="2"/>
        <text x="504" y="9" font-size="10" fill="#475569">${legendText.act}</text>
      </g>

      ${yGridLines}
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="#cbd5e1" stroke-width="1.5"/>
      ${dayElements}
    </svg>
  `;
}

/**
 * Formats numbers into readable Indian numbering string.
 */
function formatNum(val: number): string {
  return Math.round(val).toLocaleString('en-IN');
}

/**
 * Renders the HTML template containing all report sections across all 5 languages.
 */
export function renderReportHtml(data: IReportData, language: SupportedLanguage = 'en'): string {
  const fontDeva = getFontBase64('NotoSansDevanagari-Regular.ttf');
  const fontGuru = getFontBase64('NotoSansGurmukhi-Regular.ttf');
  const fontTelu = getFontBase64('NotoSansTelugu-Regular.ttf');

  const fontFaceCss = `
    ${fontDeva ? `@font-face { font-family: 'Noto Sans Devanagari'; src: url('data:font/ttf;base64,${fontDeva}') format('truetype'); font-weight: 100 900; font-style: normal; }` : ''}
    ${fontGuru ? `@font-face { font-family: 'Noto Sans Gurmukhi'; src: url('data:font/ttf;base64,${fontGuru}') format('truetype'); font-weight: 100 900; font-style: normal; }` : ''}
    ${fontTelu ? `@font-face { font-family: 'Noto Sans Telugu'; src: url('data:font/ttf;base64,${fontTelu}') format('truetype'); font-weight: 100 900; font-style: normal; }` : ''}
  `;

  const REPORT_I18N: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      title: 'Irrigation Advisory & Water Savings Report',
      subtitle: 'IrrigIQ Smart Water Management System',
      generatedOn: 'Generated On',
      period: 'Period',
      days: 'days',
      farmer: 'Farmer Name',
      field: 'Field Name',
      crop: 'Crop',
      area: 'Field Area',
      soil: 'Soil Type',
      method: 'Irrigation Method',
      sowing: 'Sowing Date',
      summaryTitle: 'Water Accounting & Savings Summary',
      baselineUse: 'Baseline Routine Water',
      recUse: 'Recommended Water',
      actUse: 'Actual Water Applied',
      potSavings: 'Potential Savings',
      realSavings: 'Realised Savings',
      chartTitle: 'Daily Water Requirement & Irrigation Schedule',
      tableTitle: 'Daily Breakdown Table',
      date: 'Date',
      et0: 'ET0 (mm)',
      etc: 'ETc (mm)',
      rain: 'Rain (mm)',
      advisory: 'Advisory',
      recGross: 'Rec. Water (L)',
      reason: 'Advisory Reason',
      actualWater: 'Actual (L)',
      source: 'Source',
      assumptionsTitle: 'Methodology & Engineering Assumptions',
      dataSources: 'Data Sources',
      disclaimerTitle: 'Important Disclaimer',
      irrigateAction: 'Irrigate',
      skipAction: 'Skip',
    },
    hi: {
      title: 'सिंचाई सलाहकार एवं जल बचत रिपोर्ट',
      subtitle: 'IrrigIQ स्मार्ट जल प्रबंधन प्रणाली',
      generatedOn: 'रिपोर्ट दिनांक',
      period: 'अवधि',
      days: 'दिन',
      farmer: 'किसान का नाम',
      field: 'खेत का नाम',
      crop: 'फसल',
      area: 'क्षेत्रफल',
      soil: 'मृदा का प्रकार',
      method: 'सिंचाई विधि',
      sowing: 'बुवाई तिथि',
      summaryTitle: 'जल बचत एवं उपयोग सारांश',
      baselineUse: 'पारंपरिक आधारभूत उपयोग',
      recUse: 'IrrigIQ अनुशंसित उपयोग',
      actUse: 'वास्तविक दिया गया पानी',
      potSavings: 'संभावित जल बचत',
      realSavings: 'वास्तविक जल बचत',
      chartTitle: 'दैनिक जल मांग एवं सिंचाई चार्ट',
      tableTitle: 'दैनिक विस्तृत विवरण',
      date: 'दिनांक',
      et0: 'ET0 (मिमी)',
      etc: 'ETc (मिमी)',
      rain: 'बारिश (मिमी)',
      advisory: 'सलाह',
      recGross: 'अनुशंसित (लीटर)',
      reason: 'वैज्ञानिक कारण',
      actualWater: 'वास्तविक (लीटर)',
      source: 'स्रोत',
      assumptionsTitle: 'मॉडल मान्यताएं एवं इंजीनियरिंग मापदंड',
      dataSources: 'डेटा स्रोत',
      disclaimerTitle: 'महत्वपूर्ण सूचना (अनिवार्य घोषणा)',
      irrigateAction: 'सिंचाई करें',
      skipAction: 'रोकें',
    },
    mr: {
      title: 'सिंचन सल्ला आणि पाणी बचत अहवाल',
      subtitle: 'IrrigIQ स्मार्ट जल व्यवस्थापन प्रणाली',
      generatedOn: 'अहवाल दिनांक',
      period: 'कालावधी',
      days: 'दिवस',
      farmer: 'शेतकऱ्याचे नाव',
      field: 'शेताचे नाव',
      crop: 'पीक',
      area: 'क्षेत्रफळ',
      soil: 'मातीचा प्रकार',
      method: 'सिंचन पद्धत',
      sowing: 'पेरणी दिनांक',
      summaryTitle: 'पाणी वापर आणि बचत सारांश',
      baselineUse: 'पारंपरिक सरासरी वापर',
      recUse: 'IrrigIQ शिफारस वापर',
      actUse: 'प्रत्यक्ष दिलेले पाणी',
      potSavings: 'संभाव्य पाणी बचत',
      realSavings: 'प्रत्यक्ष पाणी बचत',
      chartTitle: 'दैनिक पाणी गरज आणि सिंचन आलेख',
      tableTitle: 'दैनिक तपशील तक्ता',
      date: 'दिनांक',
      et0: 'ET0 (मिमी)',
      etc: 'ETc (मिमी)',
      rain: 'पाऊस (मिमी)',
      advisory: 'सल्ला',
      recGross: 'शिफारस पाणी (लिटर)',
      reason: 'वैज्ञानिक कारण',
      actualWater: 'प्रत्यक्ष (लिटर)',
      source: 'स्रोत',
      assumptionsTitle: 'मॉडेल गृहितके आणि अभियांत्रिकी निकष',
      dataSources: 'डेटा स्रोत',
      disclaimerTitle: 'महत्त्वाची सूचना (अस्वीकरण)',
      irrigateAction: 'पाणी द्या',
      skipAction: 'थांबवा',
    },
    pa: {
      title: 'ਸਿੰਚਾਈ ਸਲਾਹ ਅਤੇ ਪਾਣੀ ਬੱਚਤ ਰਿਪੋਰਟ',
      subtitle: 'IrrigIQ ਸਮਾਰਟ ਪਾਣੀ ਪ੍ਰਬੰਧਨ ਪ੍ਰਣਾਲੀ',
      generatedOn: 'ਰਿਪੋਰਟ ਮਿਤੀ',
      period: 'ਸਮਾਂ',
      days: 'ਦਿਨ',
      farmer: 'ਕਿਸਾਨ ਦਾ ਨਾਮ',
      field: 'ਖੇਤ ਦਾ ਨਾਮ',
      crop: 'ਫ਼ਸਲ',
      area: 'ਰਕਬਾ',
      soil: 'ਮਿੱਟੀ ਦੀ ਕਿਸਮ',
      method: 'ਸਿੰਚਾਈ ਵਿਧੀ',
      sowing: 'ਬਿਜਾਈ ਦੀ ਮਿਤੀ',
      summaryTitle: 'ਪਾਣੀ ਵਰਤੋਂ ਅਤੇ ਬੱਚਤ ਸਾਰ',
      baselineUse: 'ਰਵਾਇਤੀ ਪਾਣੀ ਵਰਤੋਂ',
      recUse: 'IrrigIQ ਸਿਫਾਰਸ਼ ਕੀਤੀ ਵਰਤੋਂ',
      actUse: 'ਅਸਲ ਲਗਾਇਆ ਪਾਣੀ',
      potSavings: 'ਸੰਭਾਵਿਤ ਪਾਣੀ ਬੱਚਤ',
      realSavings: 'ਅਸਲ ਪਾਣੀ ਬੱਚਤ',
      chartTitle: 'ਰੋਜ਼ਾਨਾ ਪਾਣੀ ਲੋੜ ਅਤੇ ਸਿੰਚਾਈ ਚਾਰਟ',
      tableTitle: 'ਰੋਜ਼ਾਨਾ ਵੇਰਵਾ ਸਾਰਣੀ',
      date: 'ਮਿਤੀ',
      et0: 'ET0 (ਮਿਮੀ)',
      etc: 'ETc (ਮਿਮੀ)',
      rain: 'ਮੀਂਹ (ਮਿਮੀ)',
      advisory: 'ਸਲਾਹ',
      recGross: 'ਸਿਫਾਰਸ਼ ਪਾਣੀ (ਲੀਟਰ)',
      reason: 'ਵਿਗਿਆਨਕ ਕਾਰਨ',
      actualWater: 'ਅਸਲ (ਲੀਟਰ)',
      source: 'ਸਰੋਤ',
      assumptionsTitle: 'ਮਾਡਲ ਮਾਨਤਾਵਾਂ ਅਤੇ ਇੰਜੀਨੀਅਰਿੰਗ ਮਾਪਦੰਡ',
      dataSources: 'ਡੇਟਾ ਸਰੋਤ',
      disclaimerTitle: 'ਮਹੱਤਵਪੂਰਨ ਸੂਚਨਾ (ਘੋਸ਼ਣਾ)',
      irrigateAction: 'ਪਾਣੀ ਲਗਾਓ',
      skipAction: 'ਰੋਕੋ',
    },
    te: {
      title: 'సాగునీటి సలహా మరియు నీటి ఆదా నివేదిక',
      subtitle: 'IrrigIQ స్మార్ట్ వాటర్ మేనేజ్‌మెంట్ సిస్టమ్',
      generatedOn: 'నివేదిక తేదీ',
      period: 'వ్యవధి',
      days: 'రోజులు',
      farmer: 'రైతు పేరు',
      field: 'పొలం పేరు',
      crop: 'పంట',
      area: 'విస్తీర్ణం',
      soil: 'నేల రకం',
      method: 'సాగునీటి పద్ధతి',
      sowing: 'విత్తిన తేదీ',
      summaryTitle: 'నీటి లెక్కింపు మరియు ఆదా సారాంశం',
      baselineUse: 'సాధారణ పద్ధతి నీటి వాడకం',
      recUse: 'IrrigIQ సిఫార్సు చేసిన నీరు',
      actUse: 'వాస్తవంగా ఇచ్చిన నీరు',
      potSavings: 'సాధ్యమైన నీటి ఆదా',
      realSavings: 'వాస్తవ నీటి ఆదా',
      chartTitle: 'రోజువారీ నీటి అవసరం మరియు సాగునీటి చార్ట్',
      tableTitle: 'రోజువారీ వివరాల పట్టిక',
      date: 'తేదీ',
      et0: 'ET0 (మి.మీ)',
      etc: 'ETc (మి.మీ)',
      rain: 'వర్షం (మి.మీ)',
      advisory: 'సలహా',
      recGross: 'సిఫార్సు నీరు (లీటర్లు)',
      reason: 'శాస్త్రీయ కారణం',
      actualWater: 'వాస్తవం (లీటర్లు)',
      source: 'మూలం',
      assumptionsTitle: 'మోడల్ అంచనాలు మరియు ఇంజనీరింగ్ ప్రమాణాలు',
      dataSources: 'డేటా వనరులు',
      disclaimerTitle: 'ముఖ్యమైన గమనిక (డిస్క్లైమర్)',
      irrigateAction: 'నీరు పెట్టండి',
      skipAction: 'వాయిదా',
    },
  };

  const t = REPORT_I18N[language] || REPORT_I18N.en;
  const totals = data.totals;

  const baselineDetails = {
    en: `Baseline Routine: ${data.assumptions.baselineDepthMm} mm depth every ${data.assumptions.baselineEveryDays} days.`,
    hi: `आधारभूत सिंचाई: हर ${data.assumptions.baselineEveryDays} दिन में ${data.assumptions.baselineDepthMm} मिमी गहराई।`,
    mr: `पारंपरिक सिंचन: दर ${data.assumptions.baselineEveryDays} दिवसांनी ${data.assumptions.baselineDepthMm} मिमी पाणी.`,
    pa: `ਰਵਾਇਤੀ ਸਿੰਚਾਈ: ਹਰ ${data.assumptions.baselineEveryDays} ਦਿਨਾਂ ਬਾਅਦ ${data.assumptions.baselineDepthMm} ਮਿਮੀ ਪਾਣੀ।`,
    te: `సాధారణ పద్ధతి: ప్రతి ${data.assumptions.baselineEveryDays} రోజులకు ${data.assumptions.baselineDepthMm} మి.మీ నీరు.`,
  }[language] || `Baseline Routine: ${data.assumptions.baselineDepthMm} mm depth every ${data.assumptions.baselineEveryDays} days.`;

  const efficiencyDetails = {
    en: `Application Efficiency: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% efficiency factor).`,
    hi: `सिंचाई दक्षता: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% दक्षता कारक)।`,
    mr: `सिंचन कार्यक्षमता: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% कार्यक्षमता घटक).`,
    pa: `ਸਿੰਚਾਈ ਸਮਰੱਥਾ: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% ਸਮਰੱਥਾ ਗੁਣਾਂਕ)।`,
    te: `సాగునీటి సామర్థ్యం: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% సామర్థ్యం).`,
  }[language] || `Application Efficiency: ${data.assumptions.method} (${Math.round(data.assumptions.efficiency * 100)}% efficiency factor).`;

  const svgChart = renderSvgChart(data.chartData, language);

  const tableRows = data.dailyTable
    .map((row) => {
      const actionBadge =
        row.recommendedAction === 'irrigate'
          ? `<span style="background:#dcfce7; color:#15803d; font-weight:bold; padding:2px 8px; border-radius:12px; font-size:11px;">${t.irrigateAction}</span>`
          : row.recommendedAction === 'skip'
            ? `<span style="background:#f1f5f9; color:#475569; font-weight:bold; padding:2px 8px; border-radius:12px; font-size:11px;">${t.skipAction}</span>`
            : '-';

      return `
        <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
          <td style="padding: 7px 6px; font-weight: 600; color: #1e293b;">${row.date}</td>
          <td style="padding: 7px 6px; color: #475569; text-align: right;">${row.et0Mm.toFixed(1)}</td>
          <td style="padding: 7px 6px; color: #0284c7; text-align: right; font-weight: 600;">${row.etcMm.toFixed(1)}</td>
          <td style="padding: 7px 6px; color: #4338ca; text-align: right; font-weight: 600;">${row.rainMm.toFixed(1)}</td>
          <td style="padding: 7px 6px; text-align: center;">${actionBadge}</td>
          <td style="padding: 7px 6px; text-align: right; font-weight: 600; color: #0f766e;">${formatNum(row.recommendedLitres)}</td>
          <td style="padding: 7px 6px; color: #334155; font-size: 10px;">${row.reasonText}</td>
          <td style="padding: 7px 6px; text-align: right; font-weight: 600; color: #b45309;">${formatNum(row.actualLitres)}</td>
          <td style="padding: 7px 6px; color: #64748b; font-size: 10px; text-align: center;">${row.logSource || '-'}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="${language}">
    <head>
      <meta charset="utf-8">
      <title>${t.title}</title>
      <style>
        ${fontFaceCss}
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Noto Sans Devanagari', 'Noto Sans Gurmukhi', 'Noto Sans Telugu', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #0f172a;
          background: #ffffff;
          line-height: 1.4;
          padding: 24px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #059669;
          padding-bottom: 12px;
          margin-bottom: 16px;
        }
        .logo-title h1 {
          font-size: 20px;
          color: #065f46;
          font-weight: 800;
        }
        .logo-title p {
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
        }
        .header-meta {
          text-align: right;
          font-size: 11px;
          color: #475569;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          margin-bottom: 16px;
        }
        .meta-item { font-size: 11px; }
        .meta-item .label { color: #64748b; font-weight: 600; font-size: 10px; text-transform: uppercase; }
        .meta-item .val { color: #0f172a; font-weight: 700; margin-top: 2px; }

        .summary-box {
          background: #ecfdf5;
          border: 1.5px solid #a7f3d0;
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 16px;
        }
        .summary-title {
          font-size: 13px;
          font-weight: 800;
          color: #065f46;
          margin-bottom: 10px;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        .summary-card {
          background: #ffffff;
          border: 1px solid #d1fae5;
          border-radius: 8px;
          padding: 8px 10px;
          text-align: center;
        }
        .summary-card.highlight {
          border-color: #34d399;
          background: #f0fdf4;
        }
        .summary-card .lbl { font-size: 10px; color: #475569; font-weight: 600; margin-bottom: 4px; }
        .summary-card .num { font-size: 13px; font-weight: 800; color: #065f46; }
        .summary-card .sub { font-size: 10px; font-weight: 700; color: #047857; margin-top: 2px; }
        .summary-card.negative .num, .summary-card.negative .sub { color: #dc2626; }

        .section-title {
          font-size: 12px;
          font-weight: 800;
          color: #1e293b;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .chart-container {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 16px;
          background: #ffffff;
        }
        .table-container {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        th {
          background: #f8fafc;
          padding: 8px 6px;
          font-size: 10px;
          font-weight: 700;
          color: #475569;
          border-bottom: 1px solid #cbd5e1;
          text-transform: uppercase;
        }

        .assumptions-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          margin-bottom: 12px;
          font-size: 10px;
          color: #475569;
        }
        .assumptions-box p { margin-bottom: 4px; }

        .disclaimer-box {
          background: #fffbeb;
          border-left: 4px solid #f59e0b;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 10px;
          color: #92400e;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <!-- Header -->
      <div class="header">
        <div class="logo-title">
          <h1>💧 IrrigIQ — ${t.title}</h1>
          <p>${t.subtitle}</p>
        </div>
        <div class="header-meta">
          <div><strong>${t.generatedOn}:</strong> ${new Date().toISOString().split('T')[0]}</div>
          <div><strong>${t.period}:</strong> ${data.dailyTable[0]?.date || '-'} to ${data.dailyTable[data.dailyTable.length - 1]?.date || '-'} (${data.dailyTable.length} ${t.days})</div>
        </div>
      </div>

      <!-- Field & Farmer Metadata -->
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">${t.farmer}</div>
          <div class="val">${data.field.farmerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.field}</div>
          <div class="val">${data.field.name}</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.crop}</div>
          <div class="val">${data.field.cropName}</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.area}</div>
          <div class="val">${data.field.areaHa} ha (${(data.field.areaHa * 2.47105).toFixed(2)} acres)</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.soil}</div>
          <div class="val" style="text-transform: capitalize;">${data.field.soilType}</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.method}</div>
          <div class="val" style="text-transform: capitalize;">${data.field.irrigationMethod} (${Math.round(data.assumptions.efficiency * 100)}%)</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.sowing}</div>
          <div class="val">${data.field.sowingDate}</div>
        </div>
        <div class="meta-item">
          <div class="label">${t.days}</div>
          <div class="val">${data.dailyTable.length}</div>
        </div>
      </div>

      <!-- Water Accounting Summary Box -->
      <div class="summary-box">
        <div class="summary-title">${t.summaryTitle}</div>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="lbl">${t.baselineUse}</div>
            <div class="num">${formatNum(totals.baseline.litres)} L</div>
            <div class="sub">${totals.baseline.totalMm.toFixed(1)} mm (${totals.baseline.count}x)</div>
          </div>
          <div class="summary-card">
            <div class="lbl">${t.recUse}</div>
            <div class="num">${formatNum(totals.recommended.litres)} L</div>
            <div class="sub">${totals.recommended.totalMm.toFixed(1)} mm (${totals.recommended.count}x)</div>
          </div>
          <div class="summary-card">
            <div class="lbl">${t.actUse}</div>
            <div class="num">${formatNum(totals.actual.litres)} L</div>
            <div class="sub">${totals.actual.totalMm.toFixed(1)} mm (${totals.actual.count}x)</div>
          </div>
          <div class="summary-card highlight">
            <div class="lbl">${t.potSavings}</div>
            <div class="num">${formatNum(totals.potentialSaved.litres)} L</div>
            <div class="sub">${totals.potentialSaved.pct >= 0 ? '+' : ''}${totals.potentialSaved.pct.toFixed(1)}%</div>
          </div>
          <div class="summary-card ${totals.realisedSaved.litres < 0 ? 'negative' : 'highlight'}">
            <div class="lbl">${t.realSavings}</div>
            <div class="num">${formatNum(totals.realisedSaved.litres)} L</div>
            <div class="sub">${totals.realisedSaved.pct >= 0 ? '+' : ''}${totals.realisedSaved.pct.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      <!-- SVG Bar Chart -->
      <div class="section-title">📊 ${t.chartTitle}</div>
      <div class="chart-container">
        ${svgChart}
      </div>

      <!-- Daily Table -->
      <div class="section-title">📋 ${t.tableTitle}</div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>${t.date}</th>
              <th style="text-align:right;">${t.et0}</th>
              <th style="text-align:right;">${t.etc}</th>
              <th style="text-align:right;">${t.rain}</th>
              <th style="text-align:center;">${t.advisory}</th>
              <th style="text-align:right;">${t.recGross}</th>
              <th>${t.reason}</th>
              <th style="text-align:right;">${t.actualWater}</th>
              <th style="text-align:center;">${t.source}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <!-- Assumptions Section -->
      <div class="assumptions-box">
        <strong>${t.assumptionsTitle}</strong>
        <p>• ${baselineDetails} ${data.assumptions.baselineNote}</p>
        <p>• ${efficiencyDetails}</p>
        <p>• ${t.dataSources}: ${data.assumptions.dataSources}</p>
      </div>

      <!-- Mandatory Statement Disclaimer -->
      <div class="disclaimer-box">
        <strong>⚠️ ${t.disclaimerTitle}:</strong> ${data.assumptions.disclaimer}
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF buffer from HTML using headless Chromium.
 */
export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    const executablePath =
      process.env.CHROMIUM_PATH ||
      (fs.existsSync('/usr/bin/chromium-browser')
        ? '/usr/bin/chromium-browser'
        : fs.existsSync('/usr/bin/chromium')
          ? '/usr/bin/chromium'
          : undefined);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      ...(executablePath ? { executablePath } : {}),
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        bottom: '12mm',
        left: '10mm',
        right: '10mm',
      },
    });
    return Buffer.from(buffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Report service handling report creation, background/inline processing, and retrieval.
 */
export class ReportService {
  /**
   * Generates report data and PDF buffer for an existing Report document.
   */
  async processReportGeneration(reportId: string): Promise<IReportDocument> {
    const report = await ReportModel.findById(reportId);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    try {
      report.status = 'processing';
      await report.save();

      const data = await buildReportData(
        report.fieldId.toString(),
        report.from,
        report.to,
        report.language,
      );

      const html = renderReportHtml(data, report.language);
      const pdfBuffer = await generatePdfFromHtml(html);

      report.data = data;
      report.pdfBuffer = pdfBuffer;
      report.status = 'completed';
      report.error = undefined;
      await report.save();

      return report;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown generation error';
      logger.error({ err, reportId }, 'Failed to generate report PDF');
      report.status = 'failed';
      report.error = message;
      await report.save();
      throw err;
    }
  }

  /**
   * Creates a Report entity, validates user ownership of the field,
   * and triggers generation.
   */
  async createReport(
    userId: string,
    fieldId: string,
    input: CreateReportInput,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<{ report: IReportDocument; isInstant: boolean }> {
    const field = await checkFieldAccess(fieldId, userId, orgId, role);

    // Default dates: last 7 days through today + 6 days if not provided
    const today = new Date();
    const d7Ago = new Date();
    d7Ago.setDate(today.getDate() - 7);
    const d6Ahead = new Date();
    d6Ahead.setDate(today.getDate() + 6);

    const from = input.from || d7Ago.toISOString().split('T')[0]!;
    const to = input.to || d6Ahead.toISOString().split('T')[0]!;
    const language = input.language || 'en';

    const report = await ReportModel.create({
      fieldId: field._id,
      userId: new Types.ObjectId(userId),
      status: 'pending',
      from,
      to,
      language,
      data: {},
    });

    return { report, isInstant: false };
  }

  /**
   * Retrieves report details by ID with strict user ownership validation.
   */
  async getReportById(userId: string, reportId: string): Promise<IReportDocument> {
    if (!Types.ObjectId.isValid(reportId)) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const report = await ReportModel.findOne({
      _id: new Types.ObjectId(reportId),
      userId: new Types.ObjectId(userId),
    });

    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    return report;
  }

  /**
   * Retrieves the generated PDF buffer with strict ownership validation.
   */
  async getReportPdf(
    userId: string,
    reportId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getReportById(userId, reportId);

    if (report.status !== 'completed' || !report.pdfBuffer) {
      throw new AppError('Report is still being generated', 409, 'REPORT_NOT_READY');
    }

    const filename = `irrigiq-report-${report.from}-to-${report.to}-${report.language}.pdf`;
    return { buffer: report.pdfBuffer, filename };
  }
}

export const reportService = new ReportService();
