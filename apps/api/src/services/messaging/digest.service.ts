import {
  CROPS,
  formatDuration,
  getCropName,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@irrigiq/shared';
import { FieldModel } from '../../models/field.model.js';
import { RecommendationModel, IRecommendationDocument } from '../../models/recommendation.model.js';
import type { InlineButton } from './provider.interface.js';

const RAINFED_STATUS_LABELS: Record<string, Record<SupportedLanguage, string>> = {
  'rainfed.wait_to_sow': {
    en: 'Wait for Sowing Rains',
    hi: 'बुवाई की बारिश का इंतज़ार करें',
    mr: 'पेरणीयोग्य पावसाची वाट पहा',
    pa: 'ਬਿਜਾਈ ਯੋਗ ਮੀਂਹ ਦੀ ਉਡੀਕ ਕਰੋ',
    te: 'విత్తన వర్షం కోసం వేచి ఉండండి',
  },
  'rainfed.good_to_sow': {
    en: 'Good to Sow',
    hi: 'बुवाई के लिए अनुकूल',
    mr: 'पेरणीसाठी अनुकूल वेळ',
    pa: 'ਬਿਜਾਈ ਲਈ ਅਨੁਕੂਲ ਸਮਾਂ',
    te: 'విత్తడానికి అనుకూల సమయం',
  },
  'rainfed.outside_window': {
    en: 'Outside Sowing Window',
    hi: 'बुवाई समय सीमा समाप्त',
    mr: 'पेरणीची वेळ संपली',
    pa: 'ਬਿਜਾਈ ਦਾ ਸਮਾਂ ਸਮਾਪਤ',
    te: 'విత్తే కాలం ముగిసింది',
  },
  'rainfed.ok': {
    en: 'Adequate Moisture',
    hi: 'पर्याप्त नमी उपलब्ध',
    mr: 'मातीत पुरेसा ओलावा',
    pa: 'ਲੋੜੀਂਦੀ ਮਿੱਟੀ ਨਮੀ',
    te: 'తగినంత నేల తేమ',
  },
  'rainfed.watch_dry': {
    en: 'Dry Spell Watch',
    hi: 'शुष्क अवधि चेतावनी',
    mr: 'पावसाचा खंड (ड्राई स्पेल) लक्ष ठेवा',
    pa: 'ਸੁੱਕਾ ਦੌਰ ਚਿਤਾਵਨੀ',
    te: 'వర్షాభావ కాలం హెచ్చరిక',
  },
  'rainfed.stress_risk': {
    en: 'Drought Stress Risk',
    hi: 'सूखा/तनाव का जोखिम',
    mr: 'दुष्काळ / पिकावर ताणाचा धोका',
    pa: 'ਪਾਣੀ ਤਣਾਅ / ਸੋਕੇ ਦਾ ਖਤਰਾ',
    te: 'నీటి ఎద్దడి / బెట్ట ప్రమాదం',
  },
  'rainfed.no_calendar': {
    en: 'No Calendar Configured',
    hi: 'कैलेंडर उपलब्ध नहीं',
    mr: 'या राज्यासाठी कॅलेंडर उपलब्ध नाही',
    pa: 'ਇਸ ਸੂਬੇ ਲਈ ਕੈਲੰਡਰ ਉਪਲਬਧ ਨਹੀਂ',
    te: 'క్యాలెండర్ అందుబాటులో లేదు',
  },
};

const MESSAGES_I18N = {
  empty: {
    en: (name: string) => `🌾 Hello ${name}! You haven't added any fields in IrrigIQ yet.`,
    hi: (name: string) => `🌾 नमस्ते ${name}! IrrigIQ में अभी कोई खेत नहीं जुड़ा है।`,
    mr: (name: string) => `🌾 नमस्कार ${name}! IrrigIQ मध्ये अद्याप कोणतेही शेत जोडलेले नाही.`,
    pa: (name: string) => `🌾 ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ${name}! IrrigIQ ਵਿੱਚ ਅਜੇ ਕੋਈ ਖੇਤ ਨਹੀਂ ਜੋੜਿਆ ਗਿਆ।`,
    te: (name: string) => `🌾 నమస్కారం ${name}! IrrigIQ లో ఇంకా పొలాలు జోడించబడలేదు.`,
  },
  header: {
    en: (date: string, name: string) =>
      `🌾 *IrrigIQ Daily Advisory (${date})*\nHello ${name}, here is your irrigation plan for today:\n`,
    hi: (date: string, name: string) =>
      `🌾 *IrrigIQ दैनिक कृषि सलाह (${date})*\nनमस्ते ${name}, आज के लिए आपके खेतों की योजना:\n`,
    mr: (date: string, name: string) =>
      `🌾 *IrrigIQ दैनिक शेती सल्ला (${date})*\nनमस्कार ${name}, आजसाठी तुमच्या शेतांची योजना:\n`,
    pa: (date: string, name: string) =>
      `🌾 *IrrigIQ ਰੋਜ਼ਾਨਾ ਖੇਤੀ ਸਲਾਹ (${date})*\nਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ${name}, ਅੱਜ ਲਈ ਤੁਹਾਡੇ ਖੇਤਾਂ ਦੀ ਯੋਜਨਾ:\n`,
    te: (date: string, name: string) =>
      `🌾 *IrrigIQ రోజువారీ వ్యవసాయ సలహా (${date})*\nనమస్కారం ${name}, నేటి మీ పొలాల సాగునీటి ప్రణాళిక:\n`,
  },
  rainfedHeader: {
    en: 'Rain-fed',
    hi: 'वर्षा आधारित',
    mr: 'कोरडवाहू',
    pa: 'ਮੀਂਹ ਤੇ ਨਿਰਭਰ',
    te: 'వర్షాధారం',
  },
  statusLabel: {
    en: 'Status',
    hi: 'स्थिति',
    mr: 'स्थिती',
    pa: 'ਸਥਿਤੀ',
    te: 'పరిస్థితి',
  },
  moistureLabel: {
    en: 'Available Soil Moisture',
    hi: 'उपलब्ध मृदा नमी',
    mr: 'उपलब्ध मातीतील ओलावा',
    pa: 'ਉਪਲਬਧ ਮਿੱਟੀ ਨਮੀ',
    te: 'అందుబాటులో ఉన్న నేల తేమ',
  },
  drySpellLabel: {
    en: 'Forecast Dry Spell',
    hi: 'शुष्क अवधि पूर्वानुमान',
    mr: 'पावसाचा खंड अंदाज',
    pa: 'ਅੰਦਾਜ਼ਨ ਸੁੱਕਾ ਦੌਰ',
    te: 'అంచనా వర్షాభావ కాలం',
  },
  days: {
    en: 'days',
    hi: 'दिन',
    mr: 'दिवस',
    pa: 'ਦਿਨ',
    te: 'రోజులు',
  },
  computing: {
    en: '• Advisory is being computed...',
    hi: '• सलाह की गणना की जा रही है...',
    mr: '• सल्ल्याची गणना केली जात आहे...',
    pa: '• ਸਲਾਹ ਦੀ ਗਣਨਾ ਕੀਤੀ ਜਾ ਰਹੀ ਹੈ...',
    te: '• సలహా లెక్కించబడుతోంది...',
  },
  actionIrrigate: {
    en: 'Action: *Irrigate*',
    hi: 'कार्य: *सिंचाई करें*',
    mr: 'कृती: *पाणी द्या*',
    pa: 'ਕਾਰਵਾਈ: *ਸਿੰਚਾਈ ਕਰੋ*',
    te: 'సూచన: *నీరు పెట్టండి*',
  },
  runPump: {
    en: 'Run Pump',
    hi: 'पंप चलाएं',
    mr: 'पंप चालवा',
    pa: 'ਪੰਪ ਚਲਾਓ',
    te: 'పంపు నడపండి',
  },
  addPumpPrompt: {
    en: '(Add a pump in IrrigIQ to view pump run hours)',
    hi: '(पंप समय देखने के लिए IrrigIQ में पंप जोड़ें)',
    mr: '(पंप वेळ पाहण्यासाठी IrrigIQ मध्ये पंप जोडा)',
    pa: '(ਪੰਪ ਦੇ ਘੰਟੇ ਵੇਖਣ ਲਈ IrrigIQ ਵਿੱਚ ਪੰਪ ਜੋੜੋ)',
    te: '(పంపు సమయం చూడటానికి IrrigIQ లో పంపును జోడించండి)',
  },
  powerWindow: {
    en: 'Power Window',
    hi: 'बिजली समय',
    mr: 'वीज वेळ',
    pa: 'ਬਿਜਲੀ ਸਮਾਂ',
    te: 'విద్యుత్ సమయం',
  },
  waterVol: {
    en: 'Water',
    hi: 'पानी की मात्रा',
    mr: 'पाणी प्रमाण',
    pa: 'ਪਾਣੀ ਦੀ ਮਾਤਰਾ',
    te: 'నీటి పరిమాణం',
  },
  estCost: {
    en: 'Est. Cost',
    hi: 'अनुमानित लागत',
    mr: 'अंदाजे खर्च',
    pa: 'ਅੰਦਾਜ਼ਨ ਖਰਚਾ',
    te: 'అంచనా ఖర్చు',
  },
  actionSkip: {
    en: 'Action: *Skip* (Adequate soil moisture)',
    hi: 'कार्य: *सिंचाई न करें* (आज पानी की आवश्यकता नहीं है)',
    mr: 'कृती: *थांबवा* (मातीत पुरेसा ओलावा आहे)',
    pa: 'ਕਾਰਵਾਈ: *ਸਿੰਚਾਈ ਰੋਕੋ* (ਮਿੱਟੀ ਵਿੱਚ ਕਾਫ਼ੀ ਨਮੀ ਹੈ)',
    te: 'సూచన: *వాయిదా వేయండి* (నేలలో తగినంత తేమ ఉంది)',
  },
  quickActions: {
    en: 'Quick Actions:\n• Reply *1* or tap *Done* when finished\n• Reply *2* or tap *Skipped* to skip\n• Reply *4* or tap *No power* to reschedule\n• Type *HELP* for options',
    hi: 'त्वरित उत्तर विकल्प:\n• सिंचाई पूरी होने पर *1* या *Done* दबाएं\n• छोड़ने के लिए *2* या *Skipped* दबाएं\n• बिजली न होने पर *4* या *No power* दबाएं\n• मदद के लिए *HELP* लिखें',
    mr: 'त्वरित कृती:\n• पाणी दिल्यावर *1* किंवा *Done* दाबा\n• सिंचन सोडण्यासाठी *2* किंवा *Skipped* दाबा\n• वीज नसल्यास *4* किंवा *No power* दाबा\n• मदतीसाठी *HELP* पाठवा',
    pa: 'ਤੁਰੰਤ ਜਵਾਬ:\n• ਪਾਣੀ ਲਗਾਉਣ ' + "ਤੇ *1* ਜਾਂ *Done* ਦਬਾਓ\n• ਛੱਡਣ ਲਈ *2* ਜਾਂ *Skipped* ਦਬਾਓ\n• ਬਿਜਲੀ ਨਾ ਹੋਣ 'ਤੇ *4* ਜਾਂ *No power* ਦਬਾਓ\n• ਮਦਦ ਲਈ *HELP* ਲਿਖੋ",
    te: 'త్వరిత స్పందనలు:\n• నీరు పెట్టడం పూర్తయ్యాక *1* లేదా *Done* నొక్కండి\n• వాయిదా వేయడానికి *2* లేదా *Skipped* నొక్కండి\n• కరెంట్ లేకపోతే *4* లేదా *No power* నొక్కండి\n• సహాయం కోసం *HELP* అని టైప్ చేయండి',
  },
  buttons: {
    en: { done: '✅ Done', skip: '⏭️ Skipped', noPower: '⚡ No power' },
    hi: { done: '✅ Done (सिंचाई हो गई)', skip: '⏭️ Skipped (छोड़ा)', noPower: '⚡ No power (बिजली नहीं)' },
    mr: { done: '✅ Done (पाणी दिले)', skip: '⏭️ Skipped (थांबवले)', noPower: '⚡ No power (वीज नाही)' },
    pa: { done: '✅ Done (ਪਾਣੀ ਲਾਇਆ)', skip: '⏭️ Skipped (ਛੱਡਿਆ)', noPower: '⚡ No power (ਬਿਜਲੀ ਨਹੀਂ)' },
    te: { done: '✅ Done (నీరు పెట్టాను)', skip: '⏭️ Skipped (వాయిదా)', noPower: '⚡ No power (కరెంట్ లేదు)' },
  },
};

export interface DigestResult {
  text: string;
  hasRecommendations: boolean;
  inlineKeyboard: InlineButton[][];
}

/**
 * Builds a single localized daily advisory digest for a farmer combining all their fields.
 * Supports all 5 languages ('en', 'hi', 'mr', 'pa', 'te').
 */
export async function buildDigest(
  user: { _id: unknown; language?: string; name: string },
  dateStr: string,
): Promise<DigestResult> {
  const userLang = user.language || 'en';
  const lang: SupportedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(userLang)
    ? (userLang as SupportedLanguage)
    : 'en';

  const fields = await FieldModel.find({ userId: user._id }).sort({ name: 1 });
  if (!fields.length) {
    const emptyMsg = MESSAGES_I18N.empty[lang](user.name);
    return {
      text: emptyMsg,
      hasRecommendations: false,
      inlineKeyboard: [],
    };
  }

  const fieldIds = fields.map((f) => f._id);
  const recommendations = await RecommendationModel.find({
    userId: user._id,
    forDate: dateStr,
    fieldId: { $in: fieldIds },
  });

  const recMap = new Map<string, IRecommendationDocument>();
  for (const r of recommendations) {
    recMap.set(String(r.fieldId), r);
  }

  const lines: string[] = [];

  // Header
  lines.push(MESSAGES_I18N.header[lang](dateStr, user.name));

  for (const field of fields) {
    const cropObj = CROPS.find((c) => c.key === field.cropKey);
    const cropName = cropObj ? getCropName(cropObj, lang) : field.cropKey;
    const rec = recMap.get(String(field._id));

    if (field.waterMode === 'rainfed' || rec?.waterMode === 'rainfed') {
      const plan = rec?.rainfedPlan;
      const statusKey = plan?.statusKey || 'rainfed.ok';
      const statusLabel =
        RAINFED_STATUS_LABELS[statusKey]?.[lang] ?? RAINFED_STATUS_LABELS['rainfed.ok']![lang];
      const bucketPct = plan?.params?.['bucketPercent'] ?? 100;
      const dryDays = plan?.params?.['drySpellDays'] ?? 0;

      lines.push(`🌧️ *${field.name}* (${cropName} - ${MESSAGES_I18N.rainfedHeader[lang]}):`);
      lines.push(`• ${MESSAGES_I18N.statusLabel[lang]}: *${statusLabel}*`);
      lines.push(`• ${MESSAGES_I18N.moistureLabel[lang]}: ${bucketPct}%`);
      lines.push(`• ${MESSAGES_I18N.drySpellLabel[lang]}: ${dryDays} ${MESSAGES_I18N.days[lang]}`);
      lines.push('');
      continue;
    }

    // Irrigated Field
    if (!rec) {
      lines.push(`💧 *${field.name}* (${cropName}):`);
      lines.push(MESSAGES_I18N.computing[lang]);
      lines.push('');
      continue;
    }

    if (rec.action === 'irrigate') {
      const durationStr =
        rec.runMinutes !== null && rec.runMinutes !== undefined
          ? formatDuration(rec.runMinutes, lang)
          : null;

      const segmentsStr =
        rec.pumpSegments && rec.pumpSegments.length > 0
          ? rec.pumpSegments.map((s) => `${s.start}-${s.end}`).join(', ')
          : null;

      lines.push(`💧 *${field.name}* (${cropName}):`);
      lines.push(`• ${MESSAGES_I18N.actionIrrigate[lang]}`);
      if (durationStr) {
        lines.push(`• ${MESSAGES_I18N.runPump[lang]}: *${durationStr}*`);
      } else if (rec.pumpMissing) {
        lines.push(`• ${MESSAGES_I18N.addPumpPrompt[lang]}`);
      }
      if (segmentsStr) {
        lines.push(`• ${MESSAGES_I18N.powerWindow[lang]}: ${segmentsStr}`);
      }
      lines.push(`• ${MESSAGES_I18N.waterVol[lang]}: ${rec.litres.toLocaleString()} L (${rec.grossMm} mm)`);
      if (rec.pumpCost !== null && rec.pumpCost !== undefined) {
        lines.push(`• ${MESSAGES_I18N.estCost[lang]}: ₹${rec.pumpCost}`);
      }
    } else {
      // Skip
      lines.push(`💧 *${field.name}* (${cropName}):`);
      lines.push(`• ${MESSAGES_I18N.actionSkip[lang]}`);
    }
    lines.push('');
  }

  // Footer instructions
  lines.push('─'.repeat(24));
  lines.push(MESSAGES_I18N.quickActions[lang]);

  const btnLabels = MESSAGES_I18N.buttons[lang];
  const inlineKeyboard: InlineButton[][] = [
    [
      { text: btnLabels.done, callbackData: '1' },
      { text: btnLabels.skip, callbackData: '2' },
      { text: btnLabels.noPower, callbackData: '4' },
    ],
  ];

  return {
    text: lines.join('\n'),
    hasRecommendations: true,
    inlineKeyboard,
  };
}

/**
 * Dispatches daily advisories to all opted-in farmers after recommendation recompute.
 */
export async function dispatchDailyDigests(): Promise<number> {
  const { MessageChannelModel } = await import('../../models/message-channel.model.js');
  const { UserModel } = await import('../../models/user.model.js');
  const { enqueueOutboundMessage } = await import('./message.queue.js');
  const { logger } = await import('../../config/logger.js');

  const activeChannels = await MessageChannelModel.find({ status: 'active', optedIn: true });
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  let count = 0;

  for (const channel of activeChannels) {
    try {
      const user = await UserModel.findById(channel.userId);
      if (!user) continue;

      const digest = await buildDigest(user, todayStr);
      await enqueueOutboundMessage({
        channelId: String(channel._id),
        userId: String(user._id),
        text: digest.text,
        options: {
          replyMarkup: {
            inlineKeyboard: digest.inlineKeyboard,
          },
        },
      });
      count++;
    } catch (err: unknown) {
      logger.error({ err, channelId: channel._id }, 'Error building or queuing daily digest');
    }
  }

  return count;
}
