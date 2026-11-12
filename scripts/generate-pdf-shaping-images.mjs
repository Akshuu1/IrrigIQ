import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fontsDir = path.resolve(rootDir, 'apps/api/assets/fonts');
const refDir = path.resolve(rootDir, 'docs/pdf-shaping/reference');
fs.mkdirSync(refDir, { recursive: true });

function getFontBase64(fontName) {
  const file = path.resolve(fontsDir, fontName);
  if (fs.existsSync(file)) {
    return fs.readFileSync(file).toString('base64');
  }
  return '';
}

const fontDeva = getFontBase64('NotoSansDevanagari-Regular.ttf');
const fontGuru = getFontBase64('NotoSansGurmukhi-Regular.ttf');
const fontTelu = getFontBase64('NotoSansTelugu-Regular.ttf');

const sentences = [
  {
    lang: 'hi',
    name: 'Hindi',
    script: 'Devanagari',
    font: 'Noto Sans Devanagari',
    text: 'स्मार्ट सिंचन प्रबंधन और सटीक जल संरक्षण (हिंदी)',
    translation: 'Smart irrigation management and precise water conservation (Hindi)',
  },
  {
    lang: 'mr',
    name: 'Marathi',
    script: 'Devanagari',
    font: 'Noto Sans Devanagari',
    text: 'स्मार्ट सिंचन व्यवस्थापन आणि कृषी वैज्ञानिक प्रक्रिया (मराठी)',
    translation: 'Smart irrigation management and agricultural scientific process (Marathi)',
  },
  {
    lang: 'pa',
    name: 'Punjabi',
    script: 'Gurmukhi',
    font: 'Noto Sans Gurmukhi',
    text: 'ਸਮਾਰਟ ਸਿੰਚਾਈ ਪ੍ਰਬੰਧਨ ਅਤੇ ਕ੍ਰਿਸ਼ੀ ਵਿਗਿਆਨਕ ਯੋਜਨਾ (ਪੰਜਾਬੀ)',
    translation: 'Smart irrigation management and agricultural scientific planning (Punjabi)',
  },
  {
    lang: 'te',
    name: 'Telugu',
    script: 'Telugu',
    font: 'Noto Sans Telugu',
    text: 'స్మార్ట్ సాగునీటి నిర్వహణ మరియు వ్యవసాయ ప్రణాళిక (తెలుగు)',
    translation: 'Smart irrigation management and agricultural planning (Telugu)',
  },
];

async function generateImages() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

    for (const item of sentences) {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            @font-face {
              font-family: 'Noto Sans Devanagari';
              src: url('data:font/ttf;base64,${fontDeva}') format('truetype');
            }
            @font-face {
              font-family: 'Noto Sans Gurmukhi';
              src: url('data:font/ttf;base64,${fontGuru}') format('truetype');
            }
            @font-face {
              font-family: 'Noto Sans Telugu';
              src: url('data:font/ttf;base64,${fontTelu}') format('truetype');
            }
            body {
              margin: 0;
              padding: 20px;
              background-color: #ffffff;
            }
            #container {
              display: inline-block;
              padding: 16px 24px;
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              font-family: '${item.font}', sans-serif;
              font-size: 24px;
              line-height: 1.6;
              color: #0f172a;
            }
          </style>
        </head>
        <body>
          <div id="container">${item.text}</div>
        </body>
        </html>
      `;

      await page.setContent(html, { waitUntil: 'load' });
      const el = await page.$('#container');
      const outPath = path.resolve(refDir, `${item.lang}.png`);
      await el.screenshot({ path: outPath });
      console.log(`Generated reference image for ${item.name} (${item.lang}): ${outPath}`);
    }

    // Generate documentation README for native speakers
    let doc = `# Indic Script PDF Shaping & Font Rendering Verification

This directory documents the browser and PDF font-shaping verification for regional Indian languages (Phase 22 & Phase 23 audit).

Each sentence contains conjuncts, matras, nuktas, halants, and complex clusters to verify that HarfBuzz / Chromium text shaping renders natural, unbroken glyphs without disjointed vowel signs.

---

`;

    for (const item of sentences) {
      doc += `## ${item.name} (\`${item.lang}\` - ${item.script} Script)\n\n`;
      doc += `**Sample Sentence**: ${item.text}  \n`;
      doc += `**English Meaning**: *${item.translation}*  \n`;
      doc += `**Active Embedded Font**: \`${item.font}\`  \n\n`;
      doc += `![${item.name} Shaping](./reference/${item.lang}.png)\n\n`;
      doc += `---\n\n`;
    }

    doc += `## Native Speaker Review Checklist
- [ ] **Hindi**: Vowel marks (matras) align properly above and below base consonants (e.g. \`प्रबंधन\`, \`सिंचन\`).
- [ ] **Marathi**: Words with \`ळ\` and joined conjuncts (e.g. \`व्यवस्थापन\`, \`वैज्ञानिक\`) do not overlap or break.
- [ ] **Punjabi**: Gurmukhi sihari appears on the left of consonants correctly shaped (e.g. \`ਸਿੰਚਾਈ\`, \`ਕ੍ਰਿਸ਼ੀ\`).
- [ ] **Telugu**: Telugu vowel signs attach seamlessly to base consonants without detached circles or misplaced diacritics (e.g. \`నిర్వహణ\`, \`వ్యవసాయ\`).
`;

    fs.writeFileSync(path.resolve(rootDir, 'docs/pdf-shaping/README.md'), doc, 'utf8');
    console.log('Generated docs/pdf-shaping/README.md for native speaker review.');
  } finally {
    await browser.close();
  }
}

generateImages().catch((err) => {
  console.error(err);
  process.exit(1);
});

