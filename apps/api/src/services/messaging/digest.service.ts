import { CROPS, formatDuration } from '@irrigiq/shared';
import { FieldModel } from '../../models/field.model.js';
import { RecommendationModel, IRecommendationDocument } from '../../models/recommendation.model.js';
import type { InlineButton } from './provider.interface.js';

const RAINFED_STATUS_LABELS: Record<string, { en: string; hi: string }> = {
  'rainfed.wait_to_sow': { en: 'Wait for Sowing Rains', hi: 'बुवाई की बारिश का इंतज़ार करें' },
  'rainfed.good_to_sow': { en: 'Good to Sow', hi: 'बुवाई के लिए अनुकूल' },
  'rainfed.outside_window': { en: 'Outside Sowing Window', hi: 'बुवाई समय सीमा समाप्त' },
  'rainfed.ok': { en: 'Adequate Moisture', hi: 'पर्याप्त नमी उपलब्ध' },
  'rainfed.watch_dry': { en: 'Dry Spell Watch', hi: 'शुष्क अवधि चेतावनी' },
  'rainfed.stress_risk': { en: 'Drought Stress Risk', hi: 'सूखा/तनाव का जोखिम' },
  'rainfed.no_calendar': { en: 'No Calendar Configured', hi: 'कैलेंडर उपलब्ध नहीं' },
};

export interface DigestResult {
  text: string;
  hasRecommendations: boolean;
  inlineKeyboard: InlineButton[][];
}

/**
 * Builds a single localized daily advisory digest for a farmer combining all their fields.
 */
export async function buildDigest(
  user: { _id: unknown; language?: string; name: string },
  dateStr: string,
): Promise<DigestResult> {
  const lang = (user.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi';

  const fields = await FieldModel.find({ userId: user._id }).sort({ name: 1 });
  if (!fields.length) {
    const emptyMsg =
      lang === 'hi'
        ? `🌾 नमस्ते ${user.name}! IrrigIQ में अभी कोई खेत नहीं जुड़ा है।`
        : `🌾 Hello ${user.name}! You haven't added any fields in IrrigIQ yet.`;
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
  if (lang === 'hi') {
    lines.push(`🌾 *IrrigIQ दैनिक कृषि सलाह (${dateStr})*`);
    lines.push(`नमस्ते ${user.name}, आज के लिए आपके खेतों की योजना:\n`);
  } else {
    lines.push(`🌾 *IrrigIQ Daily Advisory (${dateStr})*`);
    lines.push(`Hello ${user.name}, here is your irrigation plan for today:\n`);
  }

  for (const field of fields) {
    const cropObj = CROPS.find((c) => c.key === field.cropKey);
    const cropName = cropObj ? (lang === 'hi' ? cropObj.nameHi : cropObj.nameEn) : field.cropKey;
    const rec = recMap.get(String(field._id));

    if (field.waterMode === 'rainfed' || rec?.waterMode === 'rainfed') {
      const plan = rec?.rainfedPlan;
      const statusKey = plan?.statusKey || 'rainfed.ok';
      const statusLabel =
        RAINFED_STATUS_LABELS[statusKey]?.[lang] ?? RAINFED_STATUS_LABELS['rainfed.ok']![lang];
      const bucketPct = plan?.params?.['bucketPercent'] ?? 100;
      const dryDays = plan?.params?.['drySpellDays'] ?? 0;

      if (lang === 'hi') {
        lines.push(`🌧️ *${field.name}* (${cropName} - वर्षा आधारित):`);
        lines.push(`• स्थिति: *${statusLabel}*`);
        lines.push(`• उपलब्ध मृदा नमी: ${bucketPct}%`);
        lines.push(`• शुष्क अवधि पूर्वानुमान: ${dryDays} दिन`);
      } else {
        lines.push(`🌧️ *${field.name}* (${cropName} - Rain-fed):`);
        lines.push(`• Status: *${statusLabel}*`);
        lines.push(`• Available Soil Moisture: ${bucketPct}%`);
        lines.push(`• Forecast Dry Spell: ${dryDays} days`);
      }
      lines.push('');
      continue;
    }

    // Irrigated Field
    if (!rec) {
      if (lang === 'hi') {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• सलाह की गणना की जा रही है...`);
      } else {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• Advisory is being computed...`);
      }
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

      if (lang === 'hi') {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• कार्य: *सिंचाई करें*`);
        if (durationStr) {
          lines.push(`• पंप चलाएं: *${durationStr}*`);
        } else if (rec.pumpMissing) {
          lines.push(`• (पंप समय देखने के लिए IrrigIQ में पंप जोड़ें)`);
        }
        if (segmentsStr) {
          lines.push(`• बिजली समय: ${segmentsStr}`);
        }
        lines.push(`• पानी की मात्रा: ${rec.litres.toLocaleString()} L (${rec.grossMm} mm)`);
        if (rec.pumpCost !== null && rec.pumpCost !== undefined) {
          lines.push(`• अनुमानित लागत: ₹${rec.pumpCost}`);
        }
      } else {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• Action: *Irrigate*`);
        if (durationStr) {
          lines.push(`• Run Pump: *${durationStr}*`);
        } else if (rec.pumpMissing) {
          lines.push(`• (Add a pump in IrrigIQ to view pump run hours)`);
        }
        if (segmentsStr) {
          lines.push(`• Power Window: ${segmentsStr}`);
        }
        lines.push(`• Water: ${rec.litres.toLocaleString()} L (${rec.grossMm} mm)`);
        if (rec.pumpCost !== null && rec.pumpCost !== undefined) {
          lines.push(`• Est. Cost: ₹${rec.pumpCost}`);
        }
      }
    } else {
      // Skip
      if (lang === 'hi') {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• कार्य: *सिंचाई न करें* (आज पानी की आवश्यकता नहीं है)`);
      } else {
        lines.push(`💧 *${field.name}* (${cropName}):`);
        lines.push(`• Action: *Skip* (Adequate soil moisture)`);
      }
    }
    lines.push('');
  }

  // Footer instructions
  if (lang === 'hi') {
    lines.push('─'.repeat(24));
    lines.push('त्वरित उत्तर विकल्प:');
    lines.push('• सिंचाई पूरी होने पर *1* या *Done* दबाएं');
    lines.push('• छोड़ने के लिए *2* या *Skipped* दबाएं');
    lines.push('• बिजली न होने पर *4* या *No power* दबाएं');
    lines.push('• मदद के लिए *HELP* लिखें');
  } else {
    lines.push('─'.repeat(24));
    lines.push('Quick Actions:');
    lines.push('• Reply *1* or tap *Done* when finished');
    lines.push('• Reply *2* or tap *Skipped* to skip');
    lines.push('• Reply *4* or tap *No power* to reschedule');
    lines.push('• Type *HELP* for options');
  }

  const inlineKeyboard: InlineButton[][] = [
    [
      { text: lang === 'hi' ? '✅ Done (सिंचाई हो गई)' : '✅ Done', callbackData: '1' },
      { text: lang === 'hi' ? '⏭️ Skipped (छोड़ा)' : '⏭️ Skipped', callbackData: '2' },
      { text: lang === 'hi' ? '⚡ No power (बिजली नहीं)' : '⚡ No power', callbackData: '4' },
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
