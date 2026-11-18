import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseExcelOrCsv, autoDetectColumns, generateErrorReportCsv } from './excel-helper';

describe('excel-helper', () => {
  it('autoDetectColumns detects standard variants', () => {
    const mapping = autoDetectColumns(['Full Name', 'Mobile Number', 'Customer Tags', 'Email Address', 'Company Name']);
    expect(mapping.name).toBe('Full Name');
    expect(mapping.phone).toBe('Mobile Number');
    expect(mapping.tags).toBe('Customer Tags');
    expect(mapping.email).toBe('Email Address');
    expect(mapping.company).toBe('Company Name');
  });

  it('parses XLSX buffer with Indian mobile numbers and duplicates', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Phone Number', 'Tags'],
      ['Rahul', '9876543210', 'Customer, VIP'],
      ['Amit', '9876501234', 'Farmer'],
      ['Rina', '919876512345', 'New Customer'],
      ['Rahul Duplicate', '9876543210', 'Customer'], // duplicate!
      ['Bad Number', '12345', 'Tester'], // invalid!
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseExcelOrCsv(buf);
    expect(result.validCount).toBe(3);
    expect(result.duplicateCount).toBe(1);
    expect(result.invalidCount).toBe(1);
    expect(result.records[0].phone).toBe('+919876543210');
    expect(result.records[0].tags).toEqual(['Customer', 'VIP']);
    expect(result.records[1].phone).toBe('+919876501234');
    expect(result.records[2].phone).toBe('+919876512345');

    // Error report CSV
    const csvReport = generateErrorReportCsv(result.invalidRecords);
    expect(csvReport).toContain('Row Number');
    expect(csvReport).toContain('Duplicate phone number');
    expect(csvReport).toContain('Phone number must be between');
  });
});
