import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read JSON configs
const rainfedConfigPath = path.resolve(rootDir, 'packages/shared/src/config/rainfed.config.json');
const rainfedConfig = JSON.parse(fs.readFileSync(rainfedConfigPath, 'utf8'));

const calendarsDir = path.resolve(rootDir, 'packages/shared/src/config/calendars');
const calendarFiles = fs.readdirSync(calendarsDir).filter((f) => f.endsWith('.json'));

// Type definitions removed for pure ESM .mjs execution
export function collectAllUnverifiedValues() {
  const items = [];

  // 1. Rainfed General Config
  items.push({
    category: 'Rain-Fed Model',
    scope: 'General',
    parameter: 'rainyDayMm',
    value: rainfedConfig.rainyDayMm.value,
    unit: 'mm',
    sourceDocument: rainfedConfig.rainyDayMm.source.document,
    tableOrCitation: rainfedConfig.rainyDayMm.source.tableOrPage,
    status: rainfedConfig.rainyDayMm.source.status,
    verified: rainfedConfig.rainyDayMm.verified,
  });

  items.push({
    category: 'Rain-Fed Model',
    scope: 'General',
    parameter: 'sowingRainMm',
    value: rainfedConfig.sowingRainMm.value,
    unit: 'mm',
    sourceDocument: rainfedConfig.sowingRainMm.source.document,
    tableOrCitation: rainfedConfig.sowingRainMm.source.tableOrPage,
    status: rainfedConfig.sowingRainMm.source.status,
    verified: rainfedConfig.sowingRainMm.verified,
  });

  items.push({
    category: 'Rain-Fed Model',
    scope: 'General',
    parameter: 'sowingRainWindowDays',
    value: rainfedConfig.sowingRainWindowDays.value,
    unit: 'days',
    sourceDocument: rainfedConfig.sowingRainWindowDays.source.document,
    tableOrCitation: rainfedConfig.sowingRainWindowDays.source.tableOrPage,
    status: rainfedConfig.sowingRainWindowDays.source.status,
    verified: rainfedConfig.sowingRainWindowDays.verified,
  });

  items.push({
    category: 'Rain-Fed Model',
    scope: 'General',
    parameter: 'maxDrySpellAfterSowDays',
    value: rainfedConfig.maxDrySpellAfterSowDays.value,
    unit: 'days',
    sourceDocument: rainfedConfig.maxDrySpellAfterSowDays.source.document,
    tableOrCitation: rainfedConfig.maxDrySpellAfterSowDays.source.tableOrPage,
    status: rainfedConfig.maxDrySpellAfterSowDays.source.status,
    verified: rainfedConfig.maxDrySpellAfterSowDays.verified,
  });

  items.push({
    category: 'Rain-Fed Model',
    scope: 'Stress Threshold',
    parameter: 'stressThresholds.watch',
    value: rainfedConfig.stressThresholds.watch.value,
    unit: 'fraction (TAW)',
    sourceDocument: rainfedConfig.stressThresholds.watch.source.document,
    tableOrCitation: rainfedConfig.stressThresholds.watch.source.tableOrPage,
    status: rainfedConfig.stressThresholds.watch.source.status,
    verified: rainfedConfig.stressThresholds.watch.verified,
  });

  items.push({
    category: 'Rain-Fed Model',
    scope: 'Stress Threshold',
    parameter: 'stressThresholds.stress',
    value: rainfedConfig.stressThresholds.stress.value,
    unit: 'fraction (TAW)',
    sourceDocument: rainfedConfig.stressThresholds.stress.source.document,
    tableOrCitation: rainfedConfig.stressThresholds.stress.source.tableOrPage,
    status: rainfedConfig.stressThresholds.stress.source.status,
    verified: rainfedConfig.stressThresholds.stress.verified,
  });

  // Soil Water Capacity per metre
  for (const [soil, cfg] of Object.entries(rainfedConfig.soilWaterCapacityPerMetre)) {
    const item = cfg;
    items.push({
      category: 'Soil Parameters',
      scope: `Soil Capacity (${soil})`,
      parameter: `soilWaterCapacityPerMetre.${soil}`,
      value: item.value,
      unit: item.unit,
      sourceDocument: item.source.document,
      tableOrCitation: item.source.tableOrPage,
      status: item.source.status,
      verified: item.verified,
    });
  }

  // Root Depth per crop and stage (8 crops x 4 stages = 32 values)
  for (const [crop, stages] of Object.entries(rainfedConfig.rootDepthPerCropAndStage)) {
    for (const [stage, cfg] of Object.entries(stages)) {
      const item = cfg;
      items.push({
        category: 'Crop Rooting Depths',
        scope: `${crop} (${stage})`,
        parameter: `rootDepthPerCropAndStage.${crop}.${stage}`,
        value: item.value,
        unit: 'm',
        sourceDocument: item.source.document,
        tableOrCitation: item.source.tableOrPage,
        status: item.source.status,
        verified: item.verified,
      });
    }
  }

  // 2. Crop Calendars (15 crop entries across 3 states)
  for (const file of calendarFiles.sort()) {
    const cal = JSON.parse(fs.readFileSync(path.resolve(calendarsDir, file), 'utf8'));
    for (const crop of cal.crops) {
      items.push({
        category: 'State Crop Calendars',
        scope: `${cal.state} - ${crop.crop}`,
        parameter: `${crop.season} (${crop.sowFrom} to ${crop.sowTo})`,
        value: crop.sowingRainMm ? `${crop.sowingRainMm} mm rain` : 'Window only',
        sourceDocument: crop.source.document || crop.source,
        tableOrCitation: crop.source.tableOrPage || 'State Advisory',
        status: crop.source.status || 'ai-suggested',
        verified: crop.verified,
      });
    }
  }

  // 3. Kc and Stage Table (8 crops x 7 values = 56 constants)
  const cropsData = [
    { key: 'wheat', kc: { ini: 0.3, mid: 1.15, end: 0.3 }, stageDays: { ini: 20, dev: 25, mid: 60, late: 30 } },
    { key: 'rice', kc: { ini: 1.05, mid: 1.2, end: 0.9 }, stageDays: { ini: 30, dev: 30, mid: 60, late: 30 } },
    { key: 'maize', kc: { ini: 0.3, mid: 1.2, end: 0.35 }, stageDays: { ini: 20, dev: 35, mid: 40, late: 30 } },
    { key: 'cotton', kc: { ini: 0.35, mid: 1.2, end: 0.6 }, stageDays: { ini: 30, dev: 50, mid: 60, late: 55 } },
    { key: 'tomato', kc: { ini: 0.6, mid: 1.15, end: 0.8 }, stageDays: { ini: 30, dev: 40, mid: 45, late: 30 } },
    { key: 'potato', kc: { ini: 0.5, mid: 1.15, end: 0.75 }, stageDays: { ini: 25, dev: 30, mid: 45, late: 30 } },
    { key: 'onion', kc: { ini: 0.7, mid: 1.05, end: 0.75 }, stageDays: { ini: 20, dev: 35, mid: 40, late: 25 } },
    { key: 'sugarcane', kc: { ini: 0.4, mid: 1.25, end: 0.75 }, stageDays: { ini: 35, dev: 60, mid: 180, late: 90 } },
  ];

  for (const c of cropsData) {
    items.push({
      category: 'Crop Coefficients (Kc)',
      scope: `${c.key} (Kc ini/mid/end)`,
      parameter: `crops.${c.key}.kc`,
      value: `ini:${c.kc.ini}, mid:${c.kc.mid}, end:${c.kc.end}`,
      sourceDocument: 'FAO Irrigation and Drainage Paper 56',
      tableOrCitation: 'Table 12: Crop coefficients (single Kc curve)',
      status: 'ai-suggested',
      verified: false,
    });

    items.push({
      category: 'Crop Stage Lengths',
      scope: `${c.key} (Stage Days)`,
      parameter: `crops.${c.key}.stageDays`,
      value: `ini:${c.stageDays.ini}d, dev:${c.stageDays.dev}d, mid:${c.stageDays.mid}d, late:${c.stageDays.late}d`,
      sourceDocument: 'FAO Irrigation and Drainage Paper 56',
      tableOrCitation: 'Table 11: Lengths of crop development stages',
      status: 'ai-suggested',
      verified: false,
    });
  }

  // 4. Irrigation Method Efficiencies
  const methodEfficiencies = [
    { method: 'drip', value: 0.9 },
    { method: 'sprinkler', value: 0.75 },
    { method: 'flood', value: 0.6 },
  ];
  for (const m of methodEfficiencies) {
    items.push({
      category: 'Application Efficiency',
      scope: `Method: ${m.method}`,
      parameter: `IRRIGATION_EFFICIENCY.${m.method}`,
      value: m.value,
      unit: 'ratio',
      sourceDocument: 'FAO-56 Chapter 1 / Standard Irrigation Engineering Baselines',
      tableOrCitation: 'Method efficiency baseline table',
      status: 'ai-suggested',
      verified: false,
    });
  }

  // 5. Soil Max Depth & Trigger
  const soilTypes = ['sandy', 'loam', 'clay'];
  const maxDepths = { sandy: 25, loam: 40, clay: 50 };
  const triggers = { sandy: 12, loam: 20, clay: 25 };

  for (const s of soilTypes) {
    items.push({
      category: 'Soil Irrigation Limits',
      scope: `Soil: ${s} (Max Depth)`,
      parameter: `SOIL_CONFIG.maxDepthMm.${s}`,
      value: maxDepths[s],
      unit: 'mm',
      sourceDocument: 'FAO-56 Chapter 3 & Local Extension Engineering Assumptions',
      tableOrCitation: 'Maximum single application depth per soil texture',
      status: 'ai-suggested',
      verified: false,
    });
    items.push({
      category: 'Soil Irrigation Limits',
      scope: `Soil: ${s} (Trigger Deficit)`,
      parameter: `SOIL_CONFIG.triggerMm.${s}`,
      value: triggers[s],
      unit: 'mm',
      sourceDocument: 'FAO-56 Chapter 8 Management Allowed Depletion (MAD)',
      tableOrCitation: 'Allowable root zone deficit before trigger',
      status: 'ai-suggested',
      verified: false,
    });
  }

  // Soil texture mapping thresholds
  items.push({
    category: 'Soil Texture Classification',
    scope: 'Clay Content Threshold',
    parameter: 'SOIL_TEXTURE_CONFIG.clayThresholdPct',
    value: 40.0,
    unit: '%',
    sourceDocument: 'USDA Soil Texture Triangle Classification Guidelines',
    tableOrCitation: 'Clay percentage >= 40% boundary',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Soil Texture Classification',
    scope: 'Sandy Sand Threshold',
    parameter: 'SOIL_TEXTURE_CONFIG.sandySandThresholdPct',
    value: 70.0,
    unit: '%',
    sourceDocument: 'USDA Soil Texture Triangle Classification Guidelines',
    tableOrCitation: 'Sand >= 70% with clay <= 15%',
    status: 'ai-suggested',
    verified: false,
  });

  // 6. Effective Rain Rule
  items.push({
    category: 'Effective Rainfall',
    scope: 'Infiltration Cutoff',
    parameter: 'effectiveRain.ignoreBelowMm',
    value: 5.0,
    unit: 'mm',
    sourceDocument: 'Operational soil infiltration baseline assumption',
    tableOrPage: 'Surface retention / canopy interception threshold',
    tableOrCitation: 'Infiltration cutoff threshold',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Effective Rainfall',
    scope: 'Infiltration Ratio',
    parameter: 'effectiveRain.factor',
    value: 0.8,
    unit: 'ratio',
    sourceDocument: 'Operational soil infiltration baseline assumption',
    tableOrCitation: '80% effective rainfall infiltration fraction',
    status: 'ai-suggested',
    verified: false,
  });

  // 7. Sensor Thresholds
  items.push({
    category: 'Sensor Thresholds',
    scope: 'Sensor Wet Cutoff',
    parameter: 'planIrrigation.sensorWetPct',
    value: 80,
    unit: '%',
    sourceDocument: 'Operational sensor feedback model assumption',
    tableOrCitation: 'High soil moisture skip trigger (>= 80% saturated)',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Sensor Thresholds',
    scope: 'Sensor Dry Cutoff',
    parameter: 'planIrrigation.sensorDryPct',
    value: 40,
    unit: '%',
    sourceDocument: 'Operational sensor feedback model assumption',
    tableOrCitation: 'Low soil moisture immediate irrigation trigger (<= 40%)',
    status: 'ai-suggested',
    verified: false,
  });

  // 8. Forecast-Change Threshold
  items.push({
    category: 'Advisory Notifications',
    scope: 'Rainfall Forecast Delta',
    parameter: 'digest.RAIN_DIFF_THRESHOLD_MM',
    value: 10.0,
    unit: 'mm',
    sourceDocument: 'Phase 21 Plan-Change Notice Specification',
    tableOrCitation: 'Minimum forecast rain deviation to trigger urgent alert',
    status: 'ai-suggested',
    verified: false,
  });

  // 9. Duplicate Window
  items.push({
    category: 'Webhook Security',
    scope: 'Deduplication Cache TTL',
    parameter: 'webhook.DEDUPE_TTL_SECONDS',
    value: 172800,
    unit: 'seconds (48h)',
    sourceDocument: 'Phase 20 Webhook Deduplication Specification',
    tableOrCitation: 'Redis atomic SET NX expiration window',
    status: 'ai-suggested',
    verified: false,
  });

  // 10. Wind Limit & Operational Splits
  items.push({
    category: 'Power & Wind Controls',
    scope: 'Sprinkler Wind Limit',
    parameter: 'POWER_SCHEDULE_CONFIG.windLimitKmh',
    value: 20,
    unit: 'km/h',
    sourceDocument: 'Operational sprinkler spray drift limit assumption',
    tableOrCitation: 'Engineering baseline assumption',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Power & Wind Controls',
    scope: 'Maximum Daily Pump Splits',
    parameter: 'POWER_SCHEDULE_CONFIG.defaultMaxSplits',
    value: 2,
    unit: 'splits/day',
    sourceDocument: 'Operational pump schedule assumption',
    tableOrCitation: 'Maximum 2 operational splits per daily plan',
    status: 'ai-suggested',
    verified: false,
  });

  // 11. Area Limits & Conversions
  items.push({
    category: 'Land Measurements',
    scope: 'Acre to Hectare',
    parameter: 'AREA_CONFIG.acreToHa',
    value: 0.404686,
    unit: 'multiplier',
    sourceDocument: 'National Institute of Standards and Technology (NIST) / Metric Conversion Act',
    tableOrCitation: '1 acre = 0.40468564224 ha standard conversion',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Land Measurements',
    scope: 'Guntha to Acre',
    parameter: 'AREA_CONFIG.gunthaToAcre',
    value: 0.025,
    unit: 'multiplier',
    sourceDocument: 'Standard Indian Land Measurement (1 Guntha = 1/40 Acre = 1,089 sq ft)',
    tableOrCitation: 'Traditional revenue department conversion table',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Land Measurements',
    scope: 'Minimum Field Area',
    parameter: 'AREA_CONFIG.minAreaHa',
    value: 0.01,
    unit: 'ha',
    sourceDocument: 'Phase 18 Validation Boundary Specification',
    tableOrCitation: 'Minimum viable agricultural field area (100 m²)',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Land Measurements',
    scope: 'Maximum Field Area',
    parameter: 'AREA_CONFIG.maxAreaHa',
    value: 500.0,
    unit: 'ha',
    sourceDocument: 'Phase 18 Validation Boundary Specification',
    tableOrCitation: 'Upper bound sanity limit (5 km²)',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Land Measurements',
    scope: 'Large Area Warning',
    parameter: 'AREA_CONFIG.largeAreaWarningHa',
    value: 50.0,
    unit: 'ha',
    sourceDocument: 'Phase 18 Advisory Boundary Specification',
    tableOrCitation: 'Advisory warning threshold for large commercial holdings',
    status: 'ai-suggested',
    verified: false,
  });

  // 12. Pump Run Time Bounds
  items.push({
    category: 'Pump Specifications',
    scope: 'Minimum Pump Discharge',
    parameter: 'PUMP_CONFIG.minDischargeLph',
    value: 500,
    unit: 'L/h',
    sourceDocument: 'Phase 16 Pump Run Time specifications',
    tableOrCitation: 'Smallholder low-flow micro-pump discharge lower bound',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Pump Specifications',
    scope: 'Maximum Pump Discharge',
    parameter: 'PUMP_CONFIG.maxDischargeLph',
    value: 200000,
    unit: 'L/h',
    sourceDocument: 'Phase 16 Pump Run Time specifications',
    tableOrCitation: 'High-capacity agricultural tube-well lift pump upper bound',
    status: 'ai-suggested',
    verified: false,
  });
  items.push({
    category: 'Pump Specifications',
    scope: 'Max Single Run Duration',
    parameter: 'PUMP_CONFIG.maxSingleRunMinutes',
    value: 720,
    unit: 'minutes (12h)',
    sourceDocument: 'Phase 16 specifications',
    tableOrCitation: 'Agricultural pump duty cycle limit before multi-day split',
    status: 'ai-suggested',
    verified: false,
  });

  return items;
}

export function generateMarkdownTable(items) {
  let md = `| # | Category | Parameter | Starter Value | Source Document | Section / Table Citation | Status | Verified |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  items.forEach((it, idx) => {
    const val = it.unit ? `${it.value} ${it.unit}` : `${it.value}`;
    md += `| ${idx + 1} | ${it.category} | \`${it.parameter}\` | ${val} | ${it.sourceDocument} | ${it.tableOrCitation} | \`${it.status}\` | \`${it.verified}\` |\n`;
  });

  return md;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const items = collectAllUnverifiedValues();
  console.log(`Scanned agronomy constants and configurations.`);
  console.log(`Total unverified parameters found: ${items.length}`);

  const tableMd = generateMarkdownTable(items);

  // Read AUDIT.md
  const auditPath = path.resolve(rootDir, 'AUDIT.md');
  let auditContent = fs.readFileSync(auditPath, 'utf8');

  const startMarker = '## 5. Traceability: Unverified Agronomy Configurations';
  const endMarker = '## 6. Audit Conclusion & Sign-Off';

  const startIndex = auditContent.indexOf(startMarker);
  const endIndex = auditContent.indexOf(endMarker);

  if (startIndex !== -1 && endIndex !== -1) {
    const newSection = `${startMarker} (\`verified: false\`)

Per Rule 1 of Version 2, all agronomy constants are stored in versioned configuration files or registry objects with structured \`source\` objects ({document, tableOrPage, url, retrievedOn, checkedBy, status: 'ai-suggested' | 'human-checked'}) and \`verified\` fields.

The automated registry scanner (\`scripts/generate-agronomy-registry.mjs\`) identified exactly **${items.length} unverified values** across all domain packages and configuration files:

${tableMd}

`;
    auditContent = auditContent.slice(0, startIndex) + newSection + auditContent.slice(endIndex);
    fs.writeFileSync(auditPath, auditContent, 'utf8');
    console.log(`Successfully updated AUDIT.md with ${items.length} unverified values.`);
  } else {
    console.error('Could not locate markers in AUDIT.md to replace section 5.');
  }
}
