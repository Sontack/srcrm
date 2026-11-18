import { describe, expect, it } from 'vitest';
import { parseSpreadsheetToKnowledge } from './excel-knowledge-parser';

describe('excel-knowledge-parser', () => {
  it('parses CSV text into structured knowledge markdown', () => {
    const csvData = [
      'Service Name,Price,Required Documents,Instructions',
      'PAN Card,150,Aadhaar Card,New Application',
      'Voter Card Correction,100,Aadhaar Card,Correction Service',
      'Farmer ID,50,Aadhaar and Land Documents,New Registration',
    ].join('\n');

    const result = parseSpreadsheetToKnowledge(csvData, 'Services_Price_List.csv');

    expect(result.title).toBe('Services_Price_List');
    expect(result.rowCount).toBe(3);
    expect(result.headers).toContain('Service Name');
    expect(result.headers).toContain('Price');
    expect(result.headers).toContain('Required Documents');
    expect(result.headers).toContain('Instructions');

    // Semantic text representation
    expect(result.markdownContent).toContain('### PAN Card');
    expect(result.markdownContent).toContain('- **Price**: 150');
    expect(result.markdownContent).toContain('- **Required Documents**: Aadhaar Card');
    expect(result.markdownContent).toContain('- **Instructions**: New Application');

    expect(result.markdownContent).toContain('### Voter Card Correction');
    expect(result.markdownContent).toContain('- **Price**: 100');

    expect(result.markdownContent).toContain('### Farmer ID');
    expect(result.markdownContent).toContain('- **Price**: 50');
    expect(result.markdownContent).toContain('- **Required Documents**: Aadhaar and Land Documents');

    // Reference table
    expect(result.markdownContent).toContain('## Complete Reference Table');
    expect(result.markdownContent).toContain('| PAN Card | 150 | Aadhaar Card | New Application |');
  });

  it('throws error when spreadsheet has no rows', () => {
    expect(() => parseSpreadsheetToKnowledge('', 'empty.csv')).toThrow();
  });
});
