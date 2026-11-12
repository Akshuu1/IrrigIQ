import { Types } from 'mongoose';
import {
  CROPS,
  toHectares,
  AREA_CONFIG,
  type AreaUnit,
} from '@irrigiq/shared';
import { FarmerModel } from '../models/farmer.model.js';
import { FieldModel, SoilType, IrrigationMethod } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { OrganisationRole } from '../models/membership.model.js';
import { hashExternalId, encryptExternalId } from '../utils/crypto.js';
import { recomputeField } from './recommendation.service.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';

export interface RawImportRow {
  name?: string;
  phone?: string;
  language?: string;
  village?: string;
  lat?: string | number;
  lng?: string | number;
  area?: string | number;
  areaUnit?: string;
  crop?: string;
  sowingDate?: string;
  soil?: string;
  method?: string;
  pumpLph?: string | number;
  costPerHour?: string | number;
  [key: string]: unknown;
}

export interface FarmerImportRowPreview {
  row: number;
  data: RawImportRow;
  valid: boolean;
  isDuplicate: boolean;
  errors: string[];
}

export interface FarmerImportResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  dryRun: boolean;
  preview: FarmerImportRowPreview[];
  imported?: Array<{
    farmerId: string;
    farmerName: string;
    fieldId?: string;
    pumpId?: string;
  }>;
}

export function parseCSV(csvText: string): RawImportRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return [];
  }

  // Parse header
  const headerLine = lines[0]!;
  const headerMap: Record<string, string> = {
    name: 'name',
    phone: 'phone',
    language: 'language',
    village: 'village',
    lat: 'lat',
    latitude: 'lat',
    lng: 'lng',
    long: 'lng',
    longitude: 'lng',
    area: 'area',
    areaunit: 'areaUnit',
    crop: 'crop',
    sowingdate: 'sowingDate',
    soil: 'soil',
    method: 'method',
    pumplph: 'pumpLph',
    costperhour: 'costPerHour',
  };

  const rawHeaders = splitCsvLine(headerLine).map((h) => h.toLowerCase().trim().replace(/[^a-z0-9]/g, ''));
  const headers = rawHeaders.map((h) => headerMap[h] || h);

  const rows: RawImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const values = splitCsvLine(rawLine);
    const rowObj: RawImportRow = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx]?.trim();
    });
    rows.push(rowObj);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export class FarmerImportService {
  async processImport(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    _role: OrganisationRole,
    rows: RawImportRow[],
    dryRun = false,
  ): Promise<FarmerImportResult> {
    if (!rows || rows.length === 0) {
      throw new AppError('No rows provided for import', 400, 'EMPTY_IMPORT');
    }

    // Load existing active farmer phone hashes in this organisation
    const existingFarmers = await FarmerModel.find({
      orgId,
      status: { $ne: 'deleted' },
    }).select('phoneHash');

    const knownPhoneHashes = new Set<string>(
      existingFarmers.map((f) => f.phoneHash).filter(Boolean) as string[],
    );

    const previews: FarmerImportRowPreview[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const validatedRows: Array<{
      preview: FarmerImportRowPreview;
      cleanData: {
        name: string;
        phone: string;
        phoneHash: string;
        phoneEncrypted: string;
        language: string;
        village: string;
        lat: number;
        lng: number;
        area: number;
        areaHa: number;
        areaUnit: string;
        crop: string;
        sowingDate: Date;
        soil: SoilType;
        method: IrrigationMethod;
        pumpLph?: number;
        costPerHour?: number;
      };
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 1;
      const errors: string[] = [];
      let isDuplicate = false;

      // 1. Name
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) {
        errors.push('Farmer name is required');
      }

      // 2. Phone & Duplicate
      const rawPhone = row.phone !== undefined ? String(row.phone).trim() : '';
      const cleanPhoneDigits = rawPhone.replace(/\D/g, '');
      let phoneHash = '';
      let phoneEncrypted = '';

      if (!cleanPhoneDigits || cleanPhoneDigits.length < 10) {
        errors.push('Valid 10+ digit phone number is required');
      } else {
        phoneHash = hashExternalId(cleanPhoneDigits);
        phoneEncrypted = encryptExternalId(cleanPhoneDigits);

        if (knownPhoneHashes.has(phoneHash)) {
          isDuplicate = true;
          errors.push('Duplicate phone number in this organisation');
        } else {
          knownPhoneHashes.add(phoneHash);
        }
      }

      // 3. Language
      const rawLang = typeof row.language === 'string' ? row.language.trim().toLowerCase() : 'en';
      const language = ['en', 'hi', 'mr', 'pa', 'te'].includes(rawLang) ? rawLang : 'en';

      // 4. Village
      const village = typeof row.village === 'string' ? row.village.trim() : '';

      // 5. Latitude & Longitude
      const lat = typeof row.lat === 'number' ? row.lat : parseFloat(String(row.lat || ''));
      const lng = typeof row.lng === 'number' ? row.lng : parseFloat(String(row.lng || ''));

      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push('Valid latitude (-90 to 90) is required');
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.push('Valid longitude (-180 to 180) is required');
      }

      // 6. Area and Area Unit
      const area = typeof row.area === 'number' ? row.area : parseFloat(String(row.area || ''));
      const rawAreaUnit = row.areaUnit ?? (row as Record<string, unknown>)['areaunit'];
      const areaUnit = typeof rawAreaUnit === 'string' ? rawAreaUnit.trim().toLowerCase() : 'acre';
      let areaHa = 0;

      if (isNaN(area) || area <= 0) {
        errors.push('Area must be a positive number');
      } else {
        try {
          areaHa = toHectares(area, areaUnit as AreaUnit);
          if (areaHa < AREA_CONFIG.minAreaHa.value) {
            errors.push(`Area (${areaHa.toFixed(4)} ha) below minimum ${AREA_CONFIG.minAreaHa.value} ha`);
          }
          if (areaHa > AREA_CONFIG.maxAreaHa.value) {
            errors.push(`Area (${areaHa.toFixed(2)} ha) exceeds maximum ${AREA_CONFIG.maxAreaHa.value} ha`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Invalid area or area unit';
          errors.push(msg);
        }
      }

      // 7. Crop
      const rawCrop = typeof row.crop === 'string' ? row.crop.trim().toLowerCase() : '';
      const cropMatch = CROPS.find((c) => c.key.toLowerCase() === rawCrop);
      if (!cropMatch) {
        errors.push(`Unknown crop: ${rawCrop || 'missing'}`);
      }

      // 8. Sowing Date
      const rawSowingDate = row.sowingDate ?? (row as Record<string, unknown>)['sowingdate'];
      const sowingDateStr = rawSowingDate !== undefined ? String(rawSowingDate).trim() : '';
      const sowingDate = new Date(sowingDateStr);
      if (!sowingDateStr || isNaN(sowingDate.getTime())) {
        errors.push('Valid sowing date (YYYY-MM-DD) is required');
      }

      // 9. Soil
      const rawSoil = typeof row.soil === 'string' ? row.soil.trim().toLowerCase() : '';
      if (!['sandy', 'loam', 'clay'].includes(rawSoil)) {
        errors.push('Soil must be sandy, loam, or clay');
      }

      // 10. Method
      const rawMethod = typeof row.method === 'string' ? row.method.trim().toLowerCase() : '';
      if (!['drip', 'sprinkler', 'flood'].includes(rawMethod)) {
        errors.push('Method must be drip, sprinkler, or flood');
      }

      // 11. PumpLph & CostPerHour (Optional)
      const rawPumpLph = row.pumpLph ?? (row as Record<string, unknown>)['pumplph'];
      let pumpLph: number | undefined;
      if (rawPumpLph !== undefined && String(rawPumpLph).trim() !== '') {
        const p = typeof rawPumpLph === 'number' ? rawPumpLph : parseFloat(String(rawPumpLph));
        if (isNaN(p) || p <= 0) {
          errors.push('pumpLph must be a positive number');
        } else {
          pumpLph = p;
        }
      }

      const rawCostPerHour = row.costPerHour ?? (row as Record<string, unknown>)['costperhour'];
      let costPerHour: number | undefined;
      if (rawCostPerHour !== undefined && String(rawCostPerHour).trim() !== '') {
        const c = typeof rawCostPerHour === 'number' ? rawCostPerHour : parseFloat(String(rawCostPerHour));
        if (isNaN(c) || c < 0) {
          errors.push('costPerHour must be non-negative');
        } else {
          costPerHour = c;
        }
      }

      const isValid = errors.length === 0;
      if (isDuplicate) {
        duplicateCount++;
      } else if (!isValid) {
        invalidCount++;
      } else {
        validCount++;
      }

      const preview: FarmerImportRowPreview = {
        row: rowNum,
        data: row,
        valid: isValid,
        isDuplicate,
        errors,
      };

      previews.push(preview);

      if (isValid) {
        validatedRows.push({
          preview,
          cleanData: {
            name,
            phone: cleanPhoneDigits,
            phoneHash,
            phoneEncrypted,
            language,
            village,
            lat,
            lng,
            area,
            areaHa,
            areaUnit,
            crop: cropMatch!.key,
            sowingDate,
            soil: rawSoil as SoilType,
            method: rawMethod as IrrigationMethod,
            pumpLph,
            costPerHour,
          },
        });
      }
    }

    // If dry run, return previews immediately without DB changes
    if (dryRun) {
      return {
        totalRows: rows.length,
        validCount,
        invalidCount,
        duplicateCount,
        dryRun: true,
        preview: previews,
      };
    }

    // Commit valid rows
    const imported: Array<{
      farmerId: string;
      farmerName: string;
      fieldId?: string;
      pumpId?: string;
    }> = [];

    for (const item of validatedRows) {
      const data = item.cleanData;

      // 1. Create Farmer
      const farmer = await FarmerModel.create({
        orgId,
        name: data.name,
        phoneEncrypted: data.phoneEncrypted,
        phoneHash: data.phoneHash,
        language: data.language,
        village: data.village,
        assignedAgentId: userId,
        status: 'active',
      });

      // 2. Create Pump if pumpLph given
      let pumpId: Types.ObjectId | null = null;
      if (data.pumpLph) {
        const pump = await PumpModel.create({
          userId,
          name: `${data.name}'s Pump`,
          dischargeLph: data.pumpLph,
          costPerHour: data.costPerHour ?? null,
        });
        pumpId = pump._id;
      }

      // 3. Baseline according to irrigation method
      const baselineByMethod = {
        drip: { everyDays: 3, depthMm: 15 },
        sprinkler: { everyDays: 5, depthMm: 25 },
        flood: { everyDays: 7, depthMm: 40 },
      };

      // 4. Create Field
      const field = await FieldModel.create({
        userId,
        orgId,
        farmerId: farmer._id,
        name: `${data.name}'s ${data.crop} Field`,
        locationMode: 'pin',
        centroid: {
          type: 'Point',
          coordinates: [data.lng, data.lat],
        },
        location: {
          type: 'Point',
          coordinates: [data.lng, data.lat],
        },
        geometry: null,
        areaHa: data.areaHa,
        areaValue: data.area,
        areaUnit: data.areaUnit,
        cropKey: data.crop,
        sowingDate: data.sowingDate,
        soilType: data.soil,
        method: data.method,
        baseline: baselineByMethod[data.method],
        pumpId,
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
      });

      // Trigger initial recompute
      try {
        await recomputeField(field._id);
      } catch (err: unknown) {
        logger.warn({ err, fieldId: field._id }, 'Recompute failed on farmer field import');
      }

      imported.push({
        farmerId: farmer._id.toString(),
        farmerName: farmer.name,
        fieldId: field._id.toString(),
        pumpId: pumpId ? pumpId.toString() : undefined,
      });
    }

    return {
      totalRows: rows.length,
      validCount,
      invalidCount,
      duplicateCount,
      dryRun: false,
      preview: previews,
      imported,
    };
  }
}

export const farmerImportService = new FarmerImportService();
