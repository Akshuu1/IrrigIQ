import { UserModel } from '../../models/user.model.js';
import { FieldModel } from '../../models/field.model.js';
import { RecommendationModel } from '../../models/recommendation.model.js';
import { IMessageChannelDocument } from '../../models/message-channel.model.js';
import { LinkCodeModel } from '../../models/link-code.model.js';
import { hashLinkCode } from '../../utils/crypto.js';
import { IrrigationLogService } from '../irrigation-log.service.js';
import { rescheduleForNoPower } from '../recommendation.service.js';
import { logger } from '../../config/logger.js';
import type { InlineButton } from './provider.interface.js';

const irrigationLogService = new IrrigationLogService();

/**
 * Normalises Devanagari numerals (०..९) to standard Latin digits (0..9).
 */
export function normalizeNumerals(input: string): string {
  const devanagariDigits: Record<string, string> = {
    '०': '0',
    '१': '1',
    '२': '2',
    '३': '3',
    '४': '4',
    '५': '5',
    '६': '6',
    '७': '7',
    '८': '8',
    '९': '9',
  };
  return input.replace(/[०-९]/g, (d) => devanagariDigits[d] || d);
}

export interface ReplyResponse {
  text: string;
  actionTaken: string;
  replyMarkup?: {
    inlineKeyboard?: InlineButton[][];
  };
}

/**
 * Handles incoming chat replies or inline button callbacks.
 */
export async function handleReply(
  channel: IMessageChannelDocument,
  rawText: string,
): Promise<ReplyResponse> {
  const cleanText = normalizeNumerals(rawText || '')
    .trim()
    .toLowerCase();

  const user = await UserModel.findById(channel.userId);
  const lang = (user?.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi';
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // 1. Pending Opt-in Flow
  if (channel.status === 'pending_opt_in') {
    // Check if farmer confirms opt-in
    if (
      cleanText === '1' ||
      cleanText === 'yes' ||
      cleanText === 'y' ||
      cleanText === 'haan' ||
      cleanText === 'ha' ||
      cleanText === 'हाँ' ||
      cleanText === 'done' ||
      cleanText === 'optin'
    ) {
      channel.optedIn = true;
      channel.optedInAt = new Date();
      channel.status = 'active';
      await channel.save();

      const welcomeMsg =
        lang === 'hi'
          ? `✅ धन्यवाद! IrrigIQ दैनिक सिंचाई सलाह सक्रिय हो गई है। आपको प्रतिदिन ${channel.sendTime} IST पर सलाह प्राप्त होगी।\n\nत्वरित विकल्प:\n• सिंचाई पूरी होने पर 1 या Done दबाएं\n• छोड़ने के लिए 2 दबाएं\n• समय बदलने के लिए 3 दबाएं\n• बिजली न होने पर 4 दबाएं\n• मदद के लिए HELP लिखें`
          : `✅ Thank you! Your IrrigIQ daily advisory is now active. You will receive advisories daily at ${channel.sendTime} IST.\n\nQuick Commands:\n• Reply 1 or tap 'Done' when irrigation is finished\n• Reply 2 to skip\n• Reply 3 to change delivery time\n• Reply 4 for power outage rescheduling\n• Type HELP for all options`;

      return {
        text: welcomeMsg,
        actionTaken: 'opt_in_confirmed',
      };
    }

    // Check if /start <code> was sent
    if (cleanText.startsWith('/start') || cleanText.startsWith('start')) {
      const parts = cleanText.split(/\s+/);
      if (parts.length >= 2 && parts[1]) {
        const code = parts[1];
        const codeHash = hashLinkCode(code);
        const linkDoc = await LinkCodeModel.findOne({
          codeHash,
          used: false,
          expiresAt: { $gt: new Date() },
        });

        if (linkDoc) {
          linkDoc.used = true;
          await linkDoc.save();

          // Associate user if linkDoc user differs
          channel.userId = linkDoc.userId;
          await channel.save();
        }
      }
    }

    const optInPrompt =
      lang === 'hi'
        ? `🌾 IrrigIQ में आपका स्वागत है!\nक्या आप अपने पसंदीदा समय पर दैनिक वैज्ञानिक सिंचाई सलाह प्राप्त करना चाहते हैं?\n\nपुष्टि करने के लिए *1* या *हाँ (YES)* भेजें।`
        : `🌾 Welcome to IrrigIQ!\nDo you agree to receive daily scientific irrigation advisories at your preferred time?\n\nReply *1* or *YES* to confirm opt-in.`;

    return {
      text: optInPrompt,
      actionTaken: 'opt_in_prompt',
      replyMarkup: {
        inlineKeyboard: [
          [{ text: lang === 'hi' ? '✅ हाँ, सलाह चालू करें' : '✅ Yes, opt-in', callbackData: '1' }],
        ],
      },
    };
  }

  // 2. Unsubscribed / Deactivated Flow
  if (channel.status === 'deactivated') {
    if (
      cleanText === 'start' ||
      cleanText === '/start' ||
      cleanText === '1' ||
      cleanText === 'subscribe'
    ) {
      channel.status = 'active';
      channel.optedIn = true;
      await channel.save();

      const resubMsg =
        lang === 'hi'
          ? `✅ IrrigIQ दैनिक सलाह सेवा पुनः चालू कर दी गई है।`
          : `✅ IrrigIQ daily advisories have been re-activated for your account.`;

      return { text: resubMsg, actionTaken: 'resubscribed' };
    }

    const unsubsMsg =
      lang === 'hi'
        ? `आप IrrigIQ सेवा से अलग हो चुके हैं। पुनः जुड़ने के लिए *START* भेजें।`
        : `You are unsubscribed from IrrigIQ advisories. Send *START* anytime to re-activate.`;

    return { text: unsubsMsg, actionTaken: 'inactive_ignored' };
  }

  // 3. Active Channel Commands
  // STOP / Unsubscribe
  if (
    cleanText === 'stop' ||
    cleanText === 'unsubscribe' ||
    cleanText === 'रोकें' ||
    cleanText === 'बंद'
  ) {
    channel.status = 'deactivated';
    channel.optedIn = false;
    await channel.save();

    const stopMsg =
      lang === 'hi'
        ? `आप IrrigIQ दैनिक सलाह सेवा से अलग हो गए हैं। पुनः जुड़ने के लिए कभी भी START भेजें।`
        : `You have been unsubscribed from IrrigIQ advisories. Type START anytime to re-subscribe.`;

    return { text: stopMsg, actionTaken: 'stopped' };
  }

  // HELP
  if (
    cleanText === 'help' ||
    cleanText === '/help' ||
    cleanText === '?' ||
    cleanText === 'मदद' ||
    cleanText === 'सहायता'
  ) {
    const helpMsg =
      lang === 'hi'
        ? `🌾 *IrrigIQ बॉट सहायता:*\n• *1* या *Done*: सिंचाई पूरी होना दर्ज करें\n• *2* या *Skipped*: आज की सिंचाई छोड़ें\n• *3*: सलाह का समय बदलें (उदा. 06:30)\n• *4* या *No power*: बिजली कटौती पर समय पुनर्निर्धारित करें\n• *LANG hi* या *LANG en*: भाषा बदलें\n• *STOP*: सलाह सेवा बंद करें`
        : `🌾 *IrrigIQ Bot Help:*\n• *1* or *Done*: Record finished irrigation\n• *2* or *Skipped*: Skip today's irrigation\n• *3*: Change delivery time (e.g. 06:30)\n• *4* or *No power*: Reschedule for power outage\n• *LANG en* or *LANG hi*: Switch language\n• *STOP*: Unsubscribe`;

    return { text: helpMsg, actionTaken: 'help' };
  }

  // Language Change: LANG en / LANG hi
  const langMatch = cleanText.match(/^lang\s*(en|hi)$/);
  if (langMatch && langMatch[1] && user) {
    const newLang = langMatch[1] as 'en' | 'hi';
    user.language = newLang;
    await user.save();

    const langConf =
      newLang === 'hi'
        ? `✅ भाषा बदलकर हिंदी कर दी गई है।`
        : `✅ Language updated to English.`;

    return { text: langConf, actionTaken: 'language_changed' };
  }

  // Command 1: DONE / Log Irrigation
  if (cleanText === '1' || cleanText === 'done' || cleanText === 'सिंचाई हो गई') {
    const fields = await FieldModel.find({ userId: channel.userId });
    if (!fields.length) {
      return {
        text: lang === 'hi' ? 'कोई खेत नहीं मिला।' : 'No fields found for your account.',
        actionTaken: 'field_missing',
      };
    }

    const fieldIds = fields.map((f) => f._id);
    const recs = await RecommendationModel.find({
      userId: channel.userId,
      forDate: todayStr,
      fieldId: { $in: fieldIds },
    });

    const activeRec = recs.find((r) => r.action === 'irrigate' || r.grossMm > 0) || recs[0];
    const targetField =
      fields.find((f) => String(f._id) === String(activeRec?.fieldId)) || fields[0]!;

    const waterMm = activeRec?.grossMm && activeRec.grossMm > 0 ? activeRec.grossMm : 25;
    const waterLitres = activeRec?.litres && activeRec.litres > 0 ? activeRec.litres : 25000;

    await irrigationLogService.createLog(String(channel.userId), String(targetField._id), {
      date: todayStr,
      appliedMm: waterMm,
      source: 'chat',
      note: 'Logged via Telegram advisory reply',
    });

    const successMsg =
      lang === 'hi'
        ? `✅ दर्ज किया गया! *${targetField.name}* के लिए ${waterLitres.toLocaleString()} L (${waterMm} mm) सिंचाई दर्ज की गई। सलाह अपडेट कर दी गई है।`
        : `✅ Recorded! ${waterLitres.toLocaleString()} L (${waterMm} mm) logged for *${targetField.name}*. Recommendations recomputed.`;

    return { text: successMsg, actionTaken: 'irrigation_logged' };
  }

  // Command 2: SKIP
  if (cleanText === '2' || cleanText === 'skipped' || cleanText === 'skip' || cleanText === 'छोड़ा') {
    const skipMsg =
      lang === 'hi'
        ? `⏭️ आज की सिंचाई सलाह छोड़ने की जानकारी दर्ज की गई।`
        : `⏭️ Recorded skip for today's irrigation advisory.`;

    return { text: skipMsg, actionTaken: 'irrigation_skipped' };
  }

  // Command 3: Change delivery time prompt or time update
  if (cleanText === '3') {
    const timePrompt =
      lang === 'hi'
        ? `कृपया अपना पसंदीदा सलाह समय 24-घंटे प्रारूप में भेजें (जैसे 06:30 या 19:00)।`
        : `Please reply with your desired advisory time in 24-hour format (e.g. 06:30 or 19:00).`;

    return { text: timePrompt, actionTaken: 'send_time_prompt' };
  }

  // Time format match: '3 06:30' or '06:30'
  const timeMatch = cleanText.match(/^(?:3\s+)?([01]\d|2[0-3]):([0-5]\d)$/);
  if (timeMatch && timeMatch[1] && timeMatch[2]) {
    const newTime = `${timeMatch[1]}:${timeMatch[2]}`;
    channel.sendTime = newTime;
    await channel.save();

    const timeUpdatedMsg =
      lang === 'hi'
        ? `✅ सलाह भेजने का समय बदलकर *${newTime} IST* कर दिया गया है।`
        : `✅ Advisory delivery time updated to *${newTime} IST*.`;

    return { text: timeUpdatedMsg, actionTaken: 'send_time_updated' };
  }

  // Command 4: Reschedule for No Power
  if (
    cleanText === '4' ||
    cleanText === 'no power' ||
    cleanText === 'nopower' ||
    cleanText === 'बिजली नहीं' ||
    cleanText === 'बिजली'
  ) {
    const fields = await FieldModel.find({ userId: channel.userId });
    if (!fields.length) {
      return {
        text: lang === 'hi' ? 'कोई खेत नहीं मिला।' : 'No fields found.',
        actionTaken: 'no_fields',
      };
    }

    for (const field of fields) {
      try {
        await rescheduleForNoPower(field._id, todayStr);
      } catch (err: unknown) {
        logger.warn({ err, fieldId: field._id }, 'rescheduleForNoPower failed in chat handler');
      }
    }

    const noPowerMsg =
      lang === 'hi'
        ? `⚡ समय पुनर्निर्धारित किया गया! आपकी सिंचाई योजना को अगले उपलब्ध बिजली समय पर स्थानांतरित कर दिया गया है।`
        : `⚡ Rescheduled! Your irrigation plan has been moved to the next available power window.`;

    return { text: noPowerMsg, actionTaken: 'no_power_rescheduled' };
  }

  // Unknown command: Return friendly fallback
  const fallbackMsg =
    lang === 'hi'
      ? `कमांड समझ नहीं आई। विकल्पों के लिए *HELP* लिखें, या नीचे दिए गए बटन दबाएं।`
      : `Command not recognized. Type *HELP* for available options, or tap a button below.`;

  return {
    text: fallbackMsg,
    actionTaken: 'unknown_command',
    replyMarkup: {
      inlineKeyboard: [
        [
          { text: lang === 'hi' ? '✅ Done' : '✅ Done', callbackData: '1' },
          { text: lang === 'hi' ? '⏭️ Skipped' : '⏭️ Skipped', callbackData: '2' },
          { text: lang === 'hi' ? '⚡ No power' : '⚡ No power', callbackData: '4' },
        ],
      ],
    },
  };
}
