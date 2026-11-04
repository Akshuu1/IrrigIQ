import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { pseudoLocalize } from '@irrigiq/shared';
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import pa from './pa.json';
import te from './te.json';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'mr', 'pa', 'te'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function createPseudoResources(obj: Record<string, unknown>): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      res[k] = pseudoLocalize(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      res[k] = createPseudoResources(v as Record<string, unknown>);
    } else {
      res[k] = v;
    }
  }
  return res;
}

const pseudo = createPseudoResources(en as Record<string, unknown>);

const storedLang = isBrowser ? localStorage.getItem('irrigiq_lang') : null;
const isPseudoStored = isBrowser ? localStorage.getItem('irrigiq_pseudo') === 'true' : false;

const initialLanguage: string = isPseudoStored
  ? 'pseudo'
  : storedLang && (SUPPORTED_LANGUAGES as readonly string[]).includes(storedLang)
    ? storedLang
    : 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    mr: { translation: mr },
    pa: { translation: pa },
    te: { translation: te },
    pseudo: { translation: pseudo },
  },
  lng: initialLanguage,
  fallbackLng: {
    mr: ['hi', 'en'],
    pa: ['hi', 'en'],
    te: ['en'],
    hi: ['en'],
    pseudo: ['en'],
    default: ['en'],
  },
  interpolation: {
    escapeValue: false, // React already protects against XSS
  },
});

export function setAppLanguage(lang: SupportedLanguage | 'pseudo'): void {
  if (isBrowser) {
    try {
      if (lang === 'pseudo') {
        localStorage.setItem('irrigiq_pseudo', 'true');
      } else {
        localStorage.removeItem('irrigiq_pseudo');
        localStorage.setItem('irrigiq_lang', lang);
      }

      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang === 'pseudo' ? 'en' : lang;
      }
    } catch {
      // Ignore in non-browser or restricted storage
    }
  }
  void i18n.changeLanguage(lang);
}

export function togglePseudoMode(enable: boolean): void {
  if (enable) {
    setAppLanguage('pseudo');
  } else {
    const prev = (isBrowser ? localStorage.getItem('irrigiq_lang') : null) as SupportedLanguage;
    setAppLanguage(prev || 'en');
  }
}

export default i18n;
