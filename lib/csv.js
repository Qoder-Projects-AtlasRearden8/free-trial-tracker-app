/**
 * Small RFC-4180-style CSV reader/writer. It intentionally has no dependency
 * on a spreadsheet library so the app stays fully offline and auditable.
 */

export function parseCSV(text) {
  if (typeof text !== 'string') {
    throw new TypeError('CSV input must be text.');
  }

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let justClosedQuote = false;
  let index = 0;
  let line = 1;

  const finishField = () => {
    row.push(field);
    field = '';
    justClosedQuote = false;
  };

  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
    line += 1;
  };

  while (index < source.length) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
        } else {
          inQuotes = false;
          justClosedQuote = true;
          index += 1;
        }
      } else {
        field += character;
        if (character === '\n') {
          line += 1;
        }
        index += 1;
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === ',') {
        finishField();
        index += 1;
      } else if (character === '\r' || character === '\n') {
        finishRow();
        if (character === '\r' && source[index + 1] === '\n') {
          index += 1;
        }
        index += 1;
      } else {
        throw new Error(`Unexpected character after a closing quote on line ${line}.`);
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error(`Unexpected quote in an unquoted field on line ${line}.`);
      }
      inQuotes = true;
      index += 1;
    } else if (character === ',') {
      finishField();
      index += 1;
    } else if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      index += 1;
    } else {
      field += character;
      index += 1;
    }
  }

  if (inQuotes) {
    throw new Error(`Unclosed quoted field starting near line ${line}.`);
  }

  if (justClosedQuote || field.length > 0 || row.length > 0) {
    finishField();
    rows.push(row);
  }

  return rows;
}

export function protectSpreadsheetValue(value) {
  const text = String(value ?? '');
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function unprotectSpreadsheetValue(value) {
  const text = String(value ?? '');
  return text.startsWith("'") && /^\s*[=+\-@]/.test(text.slice(1))
    ? text.slice(1)
    : text;
}

export function escapeCSVField(value, { protectFormulas = true } = {}) {
  let text = value === null || value === undefined ? '' : String(value);
  if (protectFormulas) {
    text = protectSpreadsheetValue(text);
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function stringifyCSV(rows, options = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('CSV rows must be an array.');
  }

  return rows
    .map((row) => row.map((field) => escapeCSVField(field, options)).join(','))
    .join('\r\n');
}
