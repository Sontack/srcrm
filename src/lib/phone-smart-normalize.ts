/**
 * Smart phone number normalization and validation.
 *
 * Supports:
 * - Indian 10-digit mobile numbers (6-9 prefix, adds +91)
 * - Indian 11-digit numbers with leading 0 (09876543210 -> +919876543210)
 * - Indian 12-digit numbers with 91 prefix (919876543210 -> +919876543210)
 * - International numbers in E.164 (+1..., +44..., etc.)
 * - Formatting characters (spaces, dashes, parentheses, dots) cleaned automatically
 */

export interface NormalizedPhoneResult {
  valid: boolean;
  raw: string;
  e164?: string;
  metaPhone?: string; // digits only for Meta WhatsApp API
  error?: string;
}

export function normalizeSmartPhone(raw: string | null | undefined): NormalizedPhoneResult {
  if (!raw) {
    return { valid: false, raw: '', error: 'Empty phone number' };
  }

  const str = String(raw).trim();
  const compact = str.replace(/[\s().-]/g, '');
  if (!compact) {
    return { valid: false, raw: str, error: 'Empty phone number' };
  }

  const digits = compact.replace(/\D/g, '');
  if (!digits) {
    return { valid: false, raw: str, error: 'No digits found' };
  }

  let normalizedE164 = '';

  if (compact.startsWith('+')) {
    normalizedE164 = '+' + digits;
  } else if (digits.length === 10 && /^[6-9]/.test(digits)) {
    // 10-digit Indian mobile number
    normalizedE164 = '+91' + digits;
  } else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    // 11-digit Indian number with trunk 0
    normalizedE164 = '+91' + digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    // 12-digit Indian number with country code without +
    normalizedE164 = '+' + digits;
  } else if (digits.length >= 8 && digits.length <= 15) {
    // General international number without +
    normalizedE164 = '+' + digits;
  } else {
    return { valid: false, raw: str, error: 'Phone number must be between 8 and 15 digits' };
  }

  const plainDigits = normalizedE164.replace(/\D/g, '');
  if (plainDigits.length < 8 || plainDigits.length > 15) {
    return { valid: false, raw: str, error: 'Phone number length must be 8-15 digits' };
  }

  return {
    valid: true,
    raw: str,
    e164: normalizedE164,
    metaPhone: plainDigits,
  };
}

export interface ParseManualNumbersResult {
  total: number;
  valid: { phone: string; name?: string; raw: string }[];
  invalid: { raw: string; error: string }[];
  duplicatesCount: number;
}

/**
 * Parses raw text containing phone numbers (newline or comma-separated).
 * Deduplicates automatically and returns statistics.
 */
export function parseManualPhoneNumbers(text: string): ParseManualNumbersResult {
  if (!text || !text.trim()) {
    return { total: 0, valid: [], invalid: [], duplicatesCount: 0 };
  }

  // Split by newlines, commas, semicolons, or pipes
  const tokens = text.split(/[\r\n,;|]+/).map((t) => t.trim()).filter(Boolean);

  const seen = new Set<string>();
  const valid: { phone: string; name?: string; raw: string }[] = [];
  const invalid: { raw: string; error: string }[] = [];
  let duplicatesCount = 0;

  for (const token of tokens) {
    // Also support optional "Name, Phone" or "Name: Phone" or "Phone (Name)"
    let name: string | undefined;
    let phonePart = token;

    if (token.includes(':')) {
      const parts = token.split(':');
      name = parts[0].trim();
      phonePart = parts[1].trim();
    } else if (token.includes('(') && token.includes(')')) {
      const match = token.match(/^(.*?)\((.*?)\)$/);
      if (match) {
        phonePart = match[1].trim();
        name = match[2].trim();
      }
    }

    const res = normalizeSmartPhone(phonePart);
    if (!res.valid || !res.e164) {
      invalid.push({ raw: token, error: res.error || 'Invalid phone format' });
      continue;
    }

    if (seen.has(res.e164)) {
      duplicatesCount++;
    } else {
      seen.add(res.e164);
      valid.push({
        phone: res.e164,
        name: name || undefined,
        raw: token,
      });
    }
  }

  return {
    total: tokens.length,
    valid,
    invalid,
    duplicatesCount,
  };
}
