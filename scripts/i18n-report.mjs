#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const localesDir = path.join(rootDir, 'apps/web/src/locales');

const LANGUAGES = ['en', 'hi', 'mr', 'pa', 'te'];

function getDeepKeys(obj, prefix = '') {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(getDeepKeys(value, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function runI18nReport() {
  const enJson = loadJson(path.join(localesDir, 'en.json'));
  const enKeys = getDeepKeys(enJson);
  const metadata = loadJson(path.join(localesDir, 'metadata.json'));

  console.log('\n================================================================');
  console.log('                   IrrigIQ i18n Audit Report                    ');
  console.log('================================================================');
  console.log(`Source of Truth (en): ${enKeys.length} total keys\n`);

  let totalMissingAcrossAll = 0;
  const tableRows = [];

  for (const lang of LANGUAGES) {
    const langJson = loadJson(path.join(localesDir, `${lang}.json`));
    const langKeys = getDeepKeys(langJson);

    const missingKeys = enKeys.filter((k) => !langKeys.includes(k));
    const extraKeys = langKeys.filter((k) => !enKeys.includes(k));

    let reviewedCount = 0;
    let draftCount = 0;

    for (const k of enKeys) {
      const meta = metadata[k]?.[lang];
      if (meta && meta.status === 'reviewed') {
        reviewedCount++;
      } else {
        draftCount++;
      }
    }

    if (missingKeys.length > 0) {
      totalMissingAcrossAll += missingKeys.length;
    }

    const reviewedPct = ((reviewedCount / enKeys.length) * 100).toFixed(1);
    const draftPct = ((draftCount / enKeys.length) * 100).toFixed(1);

    tableRows.push({
      Language: lang.toUpperCase(),
      'Total Keys': langKeys.length,
      Missing: missingKeys.length,
      Reviewed: `${reviewedCount} (${reviewedPct}%)`,
      Draft: `${draftCount} (${draftPct}%)`,
      Status: missingKeys.length === 0 ? 'PASS' : 'FAIL',
    });

    if (missingKeys.length > 0) {
      console.error(`\n❌ [${lang.toUpperCase()}] Missing ${missingKeys.length} keys:`);
      missingKeys.slice(0, 10).forEach((k) => console.error(`   - ${k}`));
      if (missingKeys.length > 10) {
        console.error(`   ... and ${missingKeys.length - 10} more`);
      }
    }

    if (extraKeys.length > 0) {
      console.warn(`\n⚠️ [${lang.toUpperCase()}] ${extraKeys.length} extra keys not present in en.json:`);
      extraKeys.slice(0, 5).forEach((k) => console.warn(`   + ${k}`));
    }
  }

  console.table(tableRows);

  console.log('----------------------------------------------------------------');
  console.log('Policy Note:');
  console.log('• Draft translations are placeholders marked "draft", never "reviewed".');
  console.log('• Native-speaker agronomy review is required before official release.');
  console.log('• CI fails if any key is missing from any supported language.');
  console.log('================================================================\n');

  if (totalMissingAcrossAll > 0) {
    console.error(`❌ CI FAILED: Found ${totalMissingAcrossAll} missing keys across languages.\n`);
    process.exit(1);
  }

  console.log('✅ CI PASSED: All languages have 100% key parity with en.json.\n');
  process.exit(0);
}

runI18nReport();

