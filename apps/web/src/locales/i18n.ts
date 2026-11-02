import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';

export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
const initialLanguage: SupportedLanguage =
  (isBrowser ? (localStorage.getItem('irrigiq_lang') as SupportedLanguage) : null) || 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already protects against XSS
  },
});

export function setAppLanguage(lang: SupportedLanguage): void {
  if (isBrowser) {
    try {
      localStorage.setItem('irrigiq_lang', lang);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
      }
    } catch {
      // Ignore in non-browser or restricted storage
    }
  }
  void i18n.changeLanguage(lang);
}

export default i18n;
