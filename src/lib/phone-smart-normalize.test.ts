import { describe, expect, it } from 'vitest';
import { normalizeSmartPhone, parseManualPhoneNumbers } from './phone-smart-normalize';

describe('normalizeSmartPhone', () => {
  it('normalizes 10-digit Indian numbers', () => {
    expect(normalizeSmartPhone('9876543210')).toEqual({
      valid: true,
      raw: '9876543210',
      e164: '+919876543210',
      metaPhone: '919876543210',
    });
  });

  it('normalizes Indian numbers with 0 trunk prefix', () => {
    expect(normalizeSmartPhone('09876501234')).toEqual({
      valid: true,
      raw: '09876501234',
      e164: '+919876501234',
      metaPhone: '919876501234',
    });
  });

  it('normalizes Indian numbers with 91 prefix without +', () => {
    expect(normalizeSmartPhone('919876512345')).toEqual({
      valid: true,
      raw: '919876512345',
      e164: '+919876512345',
      metaPhone: '919876512345',
    });
  });

  it('handles spaces, dashes, parentheses', () => {
    expect(normalizeSmartPhone('+91 (987) 654-3210')).toEqual({
      valid: true,
      raw: '+91 (987) 654-3210',
      e164: '+919876543210',
      metaPhone: '919876543210',
    });
  });

  it('rejects invalid inputs', () => {
    expect(normalizeSmartPhone('12345').valid).toBe(false);
    expect(normalizeSmartPhone('abc').valid).toBe(false);
    expect(normalizeSmartPhone('').valid).toBe(false);
  });
});

describe('parseManualPhoneNumbers', () => {
  it('parses newline and comma-separated entries, removes duplicates', () => {
    const text = `
      9876543210
      9876501234, 919876543210
      09876543210
      12345
      Amit: 9876511111
    `;
    const res = parseManualPhoneNumbers(text);
    expect(res.total).toBe(6);
    // 9876543210 and 919876543210 and 09876543210 all normalize to +919876543210!
    // So 1 unique for that number + 2 duplicates
    expect(res.duplicatesCount).toBe(2);
    expect(res.invalid.length).toBe(1); // 12345
    expect(res.valid.length).toBe(3); // +919876543210, +919876501234, +919876511111
    expect(res.valid.find(v => v.phone === '+919876511111')?.name).toBe('Amit');
  });
});
