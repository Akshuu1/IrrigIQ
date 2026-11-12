export const DEFAULT_CONSENT_VERSION = '1.0';

export const CONSENT_TEMPLATES: Record<string, Record<string, string>> = {
  '1.0': {
    en: 'I agree to receive irrigation advisories and farm updates via SMS/WhatsApp/Telegram from IrrigIQ.',
    hi: 'मैं IrrigIQ से SMS/WhatsApp/Telegram के माध्यम से सिंचाई सलाह और कृषि अपडेट प्राप्त करने के लिए सहमत हूँ।',
    mr: 'मी IrrigIQ कडून SMS/WhatsApp/Telegram द्वारे सिंचन सल्ला आणि शेतीविषयक माहिती मिळण्यास सहमती देतो.',
    pa: 'ਮੈਂ IrrigIQ ਤੋਂ SMS/WhatsApp/Telegram ਰਾਹੀਂ ਸਿੰਚਾਈ ਸਲਾਹ ਅਤੇ ਖੇਤੀ ਅੱਪਡੇਟ ਪ੍ਰਾਪਤ ਕਰਨ ਲਈ ਸਹਿਮਤ ਹਾਂ।',
    te: 'నేను IrrigIQ నుండి SMS/WhatsApp/Telegram ద్వారా నీటిపారుదల సలహాలు మరియు వ్యవసాయ సమాచారాన్ని స్వీకరించడానికి అంగీకరిస్తున్నాను.',
  },
};

export function getConsentTemplateText(version = DEFAULT_CONSENT_VERSION, language = 'en'): string {
  const versionTemplates = CONSENT_TEMPLATES[version] || CONSENT_TEMPLATES[DEFAULT_CONSENT_VERSION]!;
  return versionTemplates[language] || versionTemplates['en']!;
}

