export type CropStage = 'ini' | 'dev' | 'mid' | 'late' | 'finished';

export interface CropKc {
  ini: number;
  mid: number;
  end: number;
}

export interface CropStageDays {
  ini: number;
  dev: number;
  mid: number;
  late: number;
}

export interface Crop {
  key: string;
  nameEn: string;
  nameHi: string;
  nameMr: string;
  namePa: string;
  nameTe: string;
  kc: CropKc;
  stageDays: CropStageDays;
}

/**
 * NOTE: Approximate starter data. Verify against FAO-56 tables 11 and 12 and a local agricultural advisory.
 */
export const CROPS: readonly Crop[] = [
  {
    key: 'wheat',
    nameEn: 'Wheat',
    nameHi: 'गेहूं',
    nameMr: 'गहू',
    namePa: 'ਕਣਕ',
    nameTe: 'గోధుమ',
    kc: { ini: 0.3, mid: 1.15, end: 0.3 },
    stageDays: { ini: 20, dev: 25, mid: 60, late: 30 },
  },
  {
    key: 'rice',
    nameEn: 'Rice (Paddy)',
    nameHi: 'धान (चावल)',
    nameMr: 'भात (तांदूळ)',
    namePa: 'ਝੋਨਾ (ਚਾਵਲ)',
    nameTe: 'వరి (వరి ధాన్యం)',
    kc: { ini: 1.05, mid: 1.2, end: 0.9 },
    stageDays: { ini: 30, dev: 30, mid: 60, late: 30 },
  },
  {
    key: 'maize',
    nameEn: 'Maize (Corn)',
    nameHi: 'मक्का',
    nameMr: 'मका',
    namePa: 'ਮੱਕੀ',
    nameTe: 'మొక్కజొన్న',
    kc: { ini: 0.3, mid: 1.2, end: 0.6 },
    stageDays: { ini: 25, dev: 40, mid: 40, late: 30 },
  },
  {
    key: 'cotton',
    nameEn: 'Cotton',
    nameHi: 'कपास',
    nameMr: 'कापूस',
    namePa: 'ਕਪਾਹ (ਨਰਮਾ)',
    nameTe: 'పత్తి',
    kc: { ini: 0.35, mid: 1.15, end: 0.5 },
    stageDays: { ini: 30, dev: 50, mid: 60, late: 55 },
  },
  {
    key: 'sugarcane',
    nameEn: 'Sugarcane',
    nameHi: 'गन्ना',
    nameMr: 'ऊस',
    namePa: 'ਕਮਾਦ (ਗੰਨਾ)',
    nameTe: 'చెరకు',
    kc: { ini: 0.4, mid: 1.25, end: 0.75 },
    stageDays: { ini: 35, dev: 60, mid: 190, late: 120 },
  },
  {
    key: 'tomato',
    nameEn: 'Tomato',
    nameHi: 'टमाटर',
    nameMr: 'टोमॅटो',
    namePa: 'ਟਮਾਟਰ',
    nameTe: 'టమోటా',
    kc: { ini: 0.6, mid: 1.15, end: 0.8 },
    stageDays: { ini: 30, dev: 40, mid: 40, late: 25 },
  },
  {
    key: 'potato',
    nameEn: 'Potato',
    nameHi: 'आलू',
    nameMr: 'बटाटा',
    namePa: 'ਆਲੂ',
    nameTe: 'బంగాళాదుంప',
    kc: { ini: 0.5, mid: 1.15, end: 0.75 },
    stageDays: { ini: 25, dev: 30, mid: 45, late: 30 },
  },
  {
    key: 'onion',
    nameEn: 'Onion (Dry)',
    nameHi: 'प्याज',
    nameMr: 'कांदा',
    namePa: 'ਪਿਆਜ਼',
    nameTe: 'ఉల్లిపాయ',
    kc: { ini: 0.7, mid: 1.05, end: 0.75 },
    stageDays: { ini: 15, dev: 25, mid: 70, late: 40 },
  },
] as const;

export const CROPS_MAP = new Map<string, Crop>(CROPS.map((crop) => [crop.key, crop]));

export function getCropName(
  crop: Crop | string,
  lang: 'en' | 'hi' | 'mr' | 'pa' | 'te' = 'en',
): string {
  const cropObj = typeof crop === 'string' ? CROPS_MAP.get(crop) : crop;
  if (!cropObj) return typeof crop === 'string' ? crop : '';
  switch (lang) {
    case 'hi':
      return cropObj.nameHi;
    case 'mr':
      return cropObj.nameMr;
    case 'pa':
      return cropObj.namePa;
    case 'te':
      return cropObj.nameTe;
    default:
      return cropObj.nameEn;
  }
}
