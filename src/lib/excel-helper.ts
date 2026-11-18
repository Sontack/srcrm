import * as XLSX from 'xlsx';
import { normalizeSmartPhone } from './phone-smart-normalize';

export interface ColumnMapping {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  tags?: string;
}

export interface ParsedContactRecord {
  rowNumber: number;
  name?: string;
  phone: string;
  rawPhone: string;
  email?: string;
  company?: string;
  tags: string[];
  customValues: Record<string, string>;
  valid: boolean;
  error?: string;
}

export interface ParseExcelResult {
  headers: string[];
  rawRows: Record<string, unknown>[];
  detectedMapping: ColumnMapping;
  records: ParsedContactRecord[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  invalidRecords: Array<{ rowNumber: number; raw: Record<string, unknown>; reason: string }>;
}

function cleanHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { phone: '' };

  for (const h of headers) {
    const clean = cleanHeader(h);

    if (!mapping.phone && (
      clean.includes('phone') ||
      clean.includes('mobile') ||
      clean.includes('whatsapp') ||
      clean.includes('contact') ||
      clean.includes('number') ||
      clean.includes('cell') ||
      clean.includes('tel')
    )) {
      mapping.phone = h;
    } else if (!mapping.name && (
      clean.includes('name') ||
      clean.includes('customer') ||
      clean.includes('client') ||
      clean === 'contact'
    )) {
      mapping.name = h;
    } else if (!mapping.tags && (
      clean.includes('tag') ||
      clean.includes('category') ||
      clean.includes('group') ||
      clean.includes('label')
    )) {
      mapping.tags = h;
    } else if (!mapping.email && (
      clean.includes('email') ||
      clean.includes('mail')
    )) {
      mapping.email = h;
    } else if (!mapping.company && (
      clean.includes('company') ||
      clean.includes('business') ||
      clean.includes('org')
    )) {
      mapping.company = h;
    }
  }

  // Fallback: if no phone column detected, check if any column name has digits in sample or first column
  if (!mapping.phone && headers.length > 0) {
    mapping.phone = headers[0];
  }

  return mapping;
}

/**
 * Parses an Excel (.xlsx, .xls) or CSV buffer or binary string into structured contact records.
 */
export function parseExcelOrCsv(
  data: ArrayBuffer | Uint8Array | string,
  userMapping?: Partial<ColumnMapping>,
): ParseExcelResult {
  const workbook = typeof data === 'string'
    ? XLSX.read(data, { type: 'string' })
    : XLSX.read(new Uint8Array(data), { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Spreadsheet has no sheets');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  });

  if (rawRows.length === 0) {
    return {
      headers: [],
      rawRows: [],
      detectedMapping: { phone: '' },
      records: [],
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      invalidRecords: [],
    };
  }

  const headers = Object.keys(rawRows[0] || {});
  const detected = autoDetectColumns(headers);
  const activeMapping: ColumnMapping = {
    ...detected,
    ...userMapping,
    phone: userMapping?.phone || detected.phone,
  };

  const records: ParsedContactRecord[] = [];
  const invalidRecords: Array<{ rowNumber: number; raw: Record<string, unknown>; reason: string }> = [];
  const seenPhones = new Set<string>();
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rowNumber = i + 2; // header is row 1, first data is row 2
    const rawPhoneVal = activeMapping.phone ? String(row[activeMapping.phone] ?? '').trim() : '';
    const nameVal = activeMapping.name ? String(row[activeMapping.name] ?? '').trim() : undefined;
    const emailVal = activeMapping.email ? String(row[activeMapping.email] ?? '').trim() : undefined;
    const companyVal = activeMapping.company ? String(row[activeMapping.company] ?? '').trim() : undefined;
    const tagsVal = activeMapping.tags ? String(row[activeMapping.tags] ?? '').trim() : '';

    const tags = tagsVal
      ? tagsVal.split(/[,;|]+/).map((t) => t.trim()).filter(Boolean)
      : [];

    const norm = normalizeSmartPhone(rawPhoneVal);

    if (!norm.valid || !norm.e164) {
      invalidCount++;
      const reason = norm.error || 'Invalid phone format';
      invalidRecords.push({ rowNumber, raw: row, reason });
      records.push({
        rowNumber,
        name: nameVal || undefined,
        phone: rawPhoneVal,
        rawPhone: rawPhoneVal,
        email: emailVal || undefined,
        company: companyVal || undefined,
        tags,
        customValues: {},
        valid: false,
        error: reason,
      });
      continue;
    }

    if (seenPhones.has(norm.e164)) {
      duplicateCount++;
      const reason = 'Duplicate phone number in file';
      invalidRecords.push({ rowNumber, raw: row, reason });
      records.push({
        rowNumber,
        name: nameVal || undefined,
        phone: norm.e164,
        rawPhone: rawPhoneVal,
        email: emailVal || undefined,
        company: companyVal || undefined,
        tags,
        customValues: {},
        valid: false,
        error: reason,
      });
      continue;
    }

    seenPhones.add(norm.e164);
    validCount++;

    // Extra unmapped columns can be preserved as custom values
    const customValues: Record<string, string> = {};
    for (const h of headers) {
      if (
        h !== activeMapping.phone &&
        h !== activeMapping.name &&
        h !== activeMapping.email &&
        h !== activeMapping.company &&
        h !== activeMapping.tags
      ) {
        const val = String(row[h] ?? '').trim();
        if (val) customValues[h] = val;
      }
    }

    records.push({
      rowNumber,
      name: nameVal || undefined,
      phone: norm.e164,
      rawPhone: rawPhoneVal,
      email: emailVal || undefined,
      company: companyVal || undefined,
      tags,
      customValues,
      valid: true,
    });
  }

  return {
    headers,
    rawRows,
    detectedMapping: activeMapping,
    records,
    validCount,
    invalidCount,
    duplicateCount,
    invalidRecords,
  };
}

/**
 * Generates CSV string for failed / invalid records so user can download error report.
 */
export function generateErrorReportCsv(
  invalidRecords: Array<{ rowNumber: number; raw: Record<string, unknown>; reason: string }>,
): string {
  if (invalidRecords.length === 0) return '';

  const sampleRaw = invalidRecords[0].raw;
  const originalHeaders = Object.keys(sampleRaw);
  const headers = ['Row Number', 'Error Reason', ...originalHeaders];

  const escapeCell = (val: unknown): string => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [headers.map(escapeCell).join(',')];

  for (const item of invalidRecords) {
    const row = [
      escapeCell(item.rowNumber),
      escapeCell(item.reason),
      ...originalHeaders.map((h) => escapeCell(item.raw[h])),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}
