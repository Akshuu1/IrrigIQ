import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDigest } from './digest.service.js';
import { FieldModel } from '../../models/field.model.js';
import { RecommendationModel } from '../../models/recommendation.model.js';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@irrigiq/shared';

describe('Phase 22 Multilingual Daily Digest Tests (en, hi, mr, pa, te)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const dummyUser = (lang: SupportedLanguage) => ({
    _id: '672000000000000000000001',
    name: 'Ramesh Patel',
    language: lang,
  });

  it('renders empty fields message in all 5 languages', async () => {
    vi.spyOn(FieldModel, 'find').mockReturnValue({
      sort: vi.fn().mockResolvedValue([]),
    } as any);

    for (const lang of SUPPORTED_LANGUAGES) {
      const res = await buildDigest(dummyUser(lang), '2026-11-04');
      expect(res.hasRecommendations).toBe(false);
      expect(res.text).toContain('Ramesh Patel');
      expect(res.text).not.toContain('undefined');
      expect(res.text).not.toContain('null');

      if (lang === 'mr') {
        expect(res.text).toContain('नमस्कार Ramesh Patel!');
      } else if (lang === 'pa') {
        expect(res.text).toContain('ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ Ramesh Patel!');
      } else if (lang === 'te') {
        expect(res.text).toContain('నమస్కారం Ramesh Patel!');
      } else if (lang === 'hi') {
        expect(res.text).toContain('नमस्ते Ramesh Patel!');
      } else {
        expect(res.text).toContain('Hello Ramesh Patel!');
      }
    }
  });

  it('renders irrigated field recommendation with pump hours and power windows in all 5 languages', async () => {
    const mockFields = [
      {
        _id: '672000000000000000000010',
        name: 'Field A',
        cropKey: 'tomato',
        waterMode: 'irrigated',
      },
    ];

    const mockRecs = [
      {
        fieldId: '672000000000000000000010',
        action: 'irrigate',
        litres: 31950,
        grossMm: 21.3,
        runMinutes: 107,
        pumpSegments: [{ start: '22:00', end: '23:47' }],
        pumpCost: 89.17,
      },
    ];

    vi.spyOn(FieldModel, 'find').mockReturnValue({
      sort: vi.fn().mockResolvedValue(mockFields),
    } as any);
    vi.spyOn(RecommendationModel, 'find').mockResolvedValue(mockRecs as any);

    for (const lang of SUPPORTED_LANGUAGES) {
      const res = await buildDigest(dummyUser(lang), '2026-11-04');
      expect(res.hasRecommendations).toBe(true);
      expect(res.text).toContain('Field A');
      expect(res.text).not.toContain('undefined');

      // Check inline buttons are localized
      expect(res.inlineKeyboard[0]?.length).toBe(3);
      const doneBtn = res.inlineKeyboard[0]?.[0]?.text;
      expect(doneBtn).toBeTruthy();

      if (lang === 'mr') {
        expect(res.text).toContain('टोमॅटो'); // Marathi crop name
        expect(res.text).toContain('1 तास 47 मिनिटे'); // Marathi duration
        expect(doneBtn).toContain('Done (पाणी दिले)');
      } else if (lang === 'pa') {
        expect(res.text).toContain('ਟਮਾਟਰ'); // Punjabi crop name
        expect(res.text).toContain('1 ਘੰਟੇ 47 ਮਿੰਟ'); // Punjabi duration
        expect(doneBtn).toContain('Done (ਪਾਣੀ ਲਾਇਆ)');
      } else if (lang === 'te') {
        expect(res.text).toContain('టమోటా'); // Telugu crop name
        expect(res.text).toContain('1 గంటల 47 నిమిషాలు'); // Telugu duration
        expect(doneBtn).toContain('Done (నీరు పెట్టాను)');
      }
    }
  });

  it('renders rain-fed field status in all 5 languages without undefined keys', async () => {
    const mockFields = [
      {
        _id: '672000000000000000000020',
        name: 'Rainfed Wheat Field',
        cropKey: 'wheat',
        waterMode: 'rainfed',
      },
    ];

    const mockRecs = [
      {
        fieldId: '672000000000000000000020',
        waterMode: 'rainfed',
        rainfedPlan: {
          statusKey: 'rainfed.good_to_sow',
          params: { bucketPercent: 82, drySpellDays: 2 },
        },
      },
    ];

    vi.spyOn(FieldModel, 'find').mockReturnValue({
      sort: vi.fn().mockResolvedValue(mockFields),
    } as any);
    vi.spyOn(RecommendationModel, 'find').mockResolvedValue(mockRecs as any);

    for (const lang of SUPPORTED_LANGUAGES) {
      const res = await buildDigest(dummyUser(lang), '2026-11-04');
      expect(res.hasRecommendations).toBe(true);
      expect(res.text).toContain('Rainfed Wheat Field');

      if (lang === 'mr') {
        expect(res.text).toContain('पेरणीसाठी अनुकूल वेळ');
        expect(res.text).toContain('गहू');
      } else if (lang === 'pa') {
        expect(res.text).toContain('ਬਿਜਾਈ ਲਈ ਅਨੁਕੂਲ ਸਮਾਂ');
        expect(res.text).toContain('ਕਣਕ');
      } else if (lang === 'te') {
        expect(res.text).toContain('విత్తడానికి అనుకూల సమయం');
        expect(res.text).toContain('గోధుమ');
      }
    }
  });
});

