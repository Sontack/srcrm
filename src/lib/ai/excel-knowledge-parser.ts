import * as XLSX from 'xlsx';

export interface ParsedSpreadsheetKnowledge {
  title: string;
  markdownContent: string;
  rowCount: number;
  headers: string[];
}

/**
 * Parses an Excel (.xlsx, .xls) or CSV buffer into clean, structured Markdown knowledge
 * optimized for AI embeddings, lexical full-text retrieval, and price/document queries.
 */
export function parseSpreadsheetToKnowledge(
  data: ArrayBuffer | Uint8Array | string,
  fileName: string = 'Spreadsheet Information'
): ParsedSpreadsheetKnowledge {
  const workbook =
    typeof data === 'string'
      ? XLSX.read(data, { type: 'string' })
      : XLSX.read(new Uint8Array(data), { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Spreadsheet contains no sheets');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  });

  if (rawRows.length === 0) {
    throw new Error('Spreadsheet has no data rows');
  }

  const headers = Object.keys(rawRows[0] || {});
  const cleanDocTitle = fileName.replace(/\.[^/.]+$/, '').trim() || 'Services and Price List';

  // Build semantic Markdown representation
  const sections: string[] = [
    `# ${cleanDocTitle}`,
    `Source: ${fileName} | Total Records: ${rawRows.length}`,
    '',
    '## Detailed Service & Information List',
  ];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    // Find primary identifier: Service, Name, Item, Title, or first column
    let primaryKey = '';
    for (const h of headers) {
      const lower = h.toLowerCase();
      if (
        lower.includes('service') ||
        lower.includes('item') ||
        lower.includes('name') ||
        lower.includes('title')
      ) {
        primaryKey = h;
        break;
      }
    }
    if (!primaryKey && headers.length > 0) primaryKey = headers[0];

    const primaryVal = String(row[primaryKey] || `Record #${i + 1}`).trim();
    sections.push(`### ${primaryVal}`);

    for (const h of headers) {
      const val = String(row[h] ?? '').trim();
      if (val) {
        sections.push(`- **${h}**: ${val}`);
      }
    }
    sections.push(''); // blank line between entries
  }

  // Also include a structured Markdown Table for structured reading
  sections.push('## Complete Reference Table');
  sections.push('');
  sections.push(`| ${headers.join(' | ')} |`);
  sections.push(`| ${headers.map(() => '---').join(' | ')} |`);

  for (const row of rawRows) {
    const cells = headers.map((h) => {
      const v = String(row[h] ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ')
        .trim();
      return v || '—';
    });
    sections.push(`| ${cells.join(' | ')} |`);
  }

  return {
    title: cleanDocTitle,
    markdownContent: sections.join('\n'),
    rowCount: rawRows.length,
    headers,
  };
}
