import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeCSVField,
  parseCSV,
  protectSpreadsheetValue,
  stringifyCSV,
  unprotectSpreadsheetValue,
} from '../lib/csv.js';

test('parses quoted commas, quotes, and multi-line fields', () => {
  const rows = parseCSV(
    '\uFEFFname,notes\r\n"Action, Inc.","Line one\nLine two"\r\nPlain,"A ""quoted"" note"\r\n',
  );

  assert.deepEqual(rows, [
    ['name', 'notes'],
    ['Action, Inc.', 'Line one\nLine two'],
    ['Plain', 'A "quoted" note'],
  ]);
});

test('preserves empty fields and supports final fields without newlines', () => {
  assert.deepEqual(parseCSV('a,,c\n,,\nlast,'), [
    ['a', '', 'c'],
    ['', '', ''],
    ['last', ''],
  ]);
  assert.deepEqual(parseCSV('one,two'), [['one', 'two']]);
  assert.deepEqual(parseCSV(''), []);
});

test('rejects malformed CSV instead of guessing', () => {
  assert.throws(() => parseCSV('"unclosed,field'), /Unclosed quoted field/);
  assert.throws(() => parseCSV('"closed"junk,field'), /Unexpected character/);
  assert.throws(() => parseCSV('part"quote'), /Unexpected quote/);
});

test('escapes fields for CSV and formula injection', () => {
  assert.equal(escapeCSVField('plain'), 'plain');
  assert.equal(escapeCSVField('a,b'), '"a,b"');
  assert.equal(escapeCSVField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCSVField('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(escapeCSVField('  @cmd'), "'  @cmd");
  assert.equal(escapeCSVField(0, { protectFormulas: false }), '0');
  assert.equal(
    stringifyCSV([
      ['name', 'value'],
      ['=2+2', 1],
    ]),
    "name,value\r\n'=2+2,1",
  );
});

test('formula protection round-trips only protected values', () => {
  assert.equal(unprotectSpreadsheetValue(protectSpreadsheetValue('+cmd')), '+cmd');
  assert.equal(unprotectSpreadsheetValue("'normal"), "'normal");
  assert.equal(unprotectSpreadsheetValue('=already-saved'), '=already-saved');
  assert.equal(protectSpreadsheetValue('December'), 'December');
});
