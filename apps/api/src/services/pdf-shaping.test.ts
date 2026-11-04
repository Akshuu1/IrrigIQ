import { describe, it, expect } from 'vitest';
import { generatePdfFromHtml, renderReportHtml } from './report.service.js';
import type { IReportData } from '../models/report.model.js';

describe('Phase 22 Complex Script PDF Shaping Tests (Devanagari, Gurmukhi, Telugu)', () => {
  const sampleData: IReportData = {
    field: {
      id: '672000000000000000000001',
      name: 'खेत १ / ਖੇਤ ੧ / పొలం ౧',
      farmerName: 'शेतकरी / ਕਿਸਾਨ / రైతు',
      cropKey: 'wheat',
      cropNameEn: 'Wheat',
      cropNameHi: 'गेहूं',
      cropNameMr: 'गहू',
      cropNamePa: 'ਕਣਕ',
      cropNameTe: 'గోధుమ',
      cropName: 'Wheat',
      sowingDate: '2026-10-15',
      soilType: 'clay',
      irrigationMethod: 'drip',
      areaHa: 1.5,
    },
    assumptions: {
      method: 'drip',
      efficiency: 0.9,
      areaHa: 1.5,
      baselineEveryDays: 4,
      baselineDepthMm: 35,
      dataSources: 'Open-Meteo & FAO-56',
      baselineNote: 'Baseline note',
      disclaimer: 'Disclaimer note',
    },
    totals: {
      baseline: { count: 3, depthMm: 105, totalMm: 105, litres: 1575000 },
      recommended: { count: 2, totalMm: 45, litres: 675000 },
      actual: { count: 2, totalMm: 45, litres: 675000 },
      potentialSaved: { mm: 60, litres: 900000, pct: 57.1 },
      realisedSaved: { mm: 60, litres: 900000, pct: 57.1 },
    },
    dailyTable: [
      {
        date: '2026-11-01',
        et0Mm: 4.5,
        etcMm: 4.8,
        rainMm: 0,
        recommendedAction: 'irrigate',
        recommendedGrossMm: 22.5,
        recommendedLitres: 337500,
        reasonText: 'Soil deficit trigger reached',
        actualGrossMm: 22.5,
        actualLitres: 337500,
        logSource: 'manual',
      },
    ],
    chartData: [
      {
        date: '11-01',
        etcMm: 4.8,
        rainMm: 0,
        recommendedGrossMm: 22.5,
        actualGrossMm: 22.5,
      },
    ],
  };

  const sampleSentences = {
    mr: 'स्मार्ट सिंचन व्यवस्थापन आणि कृषी वैज्ञानिक प्रक्रिया (मराठी)',
    pa: 'ਸਮਾਰਟ ਸਿੰਚਾਈ ਪ੍ਰਬੰਧਨ ਅਤੇ ਕ੍ਰਿਸ਼ੀ ਵਿਗਿਆਨਕ ਯੋਜਨਾ (ਪੰਜਾਬੀ)',
    te: 'స్మార్ట్ సాగునీటి నిర్వహణ మరియు వ్యవసాయ ప్రణాళిక (తెలుగు)',
  };

  it('renders report HTML containing complex scripts without unescaped characters or errors', () => {
    const mrHtml = renderReportHtml(sampleData, 'mr');
    expect(mrHtml).toContain('सिंचन सल्ला आणि पाणी बचत अहवाल');
    expect(mrHtml).toContain('Noto Sans Devanagari');

    const paHtml = renderReportHtml(sampleData, 'pa');
    expect(paHtml).toContain('ਸਿੰਚਾਈ ਸਲਾਹ ਅਤੇ ਪਾਣੀ ਬੱਚਤ ਰਿਪੋਰਟ');
    expect(paHtml).toContain('Noto Sans Gurmukhi');

    const teHtml = renderReportHtml(sampleData, 'te');
    expect(teHtml).toContain('సాగునీటి సలహా మరియు నీటి ఆదా నివేదిక');
    expect(teHtml).toContain('Noto Sans Telugu');
  });

  it('verifies HTML template embeds the respective font-face definitions for all Indian scripts', () => {
    const html = renderReportHtml(sampleData, 'en');
    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Noto Sans Devanagari'");
    expect(html).toContain("font-family: 'Noto Sans Gurmukhi'");
    expect(html).toContain("font-family: 'Noto Sans Telugu'");
  });

  it('generates a valid PDF buffer preserving complex script shaping across Devanagari, Gurmukhi, and Telugu', async () => {
    const multiScriptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Noto Sans Devanagari', 'Noto Sans Gurmukhi', 'Noto Sans Telugu', sans-serif;
            font-size: 14px;
            padding: 20px;
          }
        </style>
      </head>
      <body>
        <h1>IrrigIQ Script Shaping Verification</h1>
        <p class="mr">${sampleSentences.mr}</p>
        <p class="pa">${sampleSentences.pa}</p>
        <p class="te">${sampleSentences.te}</p>
      </body>
      </html>
    `;

    const pdfBuffer = await generatePdfFromHtml(multiScriptHtml);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // Check standard PDF magic header '%PDF-'
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

