import { isDateOnly } from './dates.js';
import {
  parseCSV,
  stringifyCSV,
  unprotectSpreadsheetValue,
} from './csv.js';

export const STORAGE_KEY = 'trialwise.data.v1';
export const NOTIFICATION_LOG_KEY = 'trialwise.notification-log.v1';
export const DATA_VERSION = 1;
export const MAX_TRIALS = 1000;
export const MAX_NAME_LENGTH = 80;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_URL_LENGTH = 2048;
export const MAX_TRIAL_DAYS = 3650;
export const MAX_REMINDER_DAYS = 365;
export const MAX_COST_CENTS = 100_000_000;

export const BILLING_CYCLES = Object.freeze([
  'monthly',
  'yearly',
  'weekly',
  'one-time',
]);

export const BILLING_CYCLE_LABELS = Object.freeze({
  monthly: 'per month',
  yearly: 'per year',
  weekly: 'per week',
  'one-time': 'one time',
});

export const BILLING_CYCLE_SUFFIXES = Object.freeze({
  monthly: '/mo',
  yearly: '/yr',
  weekly: '/wk',
  'one-time': ' one time',
});

const CYCLE_ALIASES = new Map([
  ['month', 'monthly'],
  ['monthly', 'monthly'],
  ['year', 'yearly'],
  ['yearly', 'yearly'],
  ['annual', 'yearly'],
  ['annually', 'yearly'],
  ['week', 'weekly'],
  ['weekly', 'weekly'],
  ['one-time', 'one-time'],
  ['onetime', 'one-time'],
  ['once', 'one-time'],
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const csvUsdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

let fallbackIdCounter = 0;

export class TrialValidationError extends Error {
  constructor(issues) {
    const list = issues?.length ? issues : [{ message: 'The trial data is invalid.' }];
    super(list.map((issue) => issue.message).join(' '));
    this.name = 'TrialValidationError';
    this.issues = list;
  }
}

export function makeTrialId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdCounter += 1;
  return [
    'trial',
    Date.now().toString(36),
    fallbackIdCounter.toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join('-');
}

export function normalizeBillingCycle(value) {
  if (value === undefined || value === null || value === '') {
    return 'monthly';
  }

  const token = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  return CYCLE_ALIASES.get(token) ?? null;
}

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') {
    return 'active';
  }

  const token = String(value).trim().toLowerCase();
  if (token === 'active' || token === 'open' || token === 'trial') {
    return 'active';
  }
  if (token === 'canceled' || token === 'cancelled') {
    return 'canceled';
  }
  return null;
}

export function normalizeCancelUrl(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new TypeError('Cancel page must be a web address.');
  }

  let input = value.trim();
  if (!input) {
    return '';
  }
  if (input.length > MAX_URL_LENGTH) {
    throw new RangeError('Cancel page link is too long.');
  }

  const looksLikeScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  if (looksLikeScheme && !/^https?:/i.test(input)) {
    throw new Error('Cancel page must start with http:// or https://.');
  }
  if (!looksLikeScheme) {
    input = input.startsWith('//') ? `https:${input}` : `https://${input}`;
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid cancel page address.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Cancel page must start with http:// or https://.');
  }
  if (!url.hostname) {
    throw new Error('Enter a valid cancel page address.');
  }
  if (url.username || url.password) {
    throw new Error('Cancel page links cannot contain a username or password.');
  }

  return url.href;
}

export function parseUsdToCents(value) {
  let cleaned;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Enter a price such as 9.99.');
    }
    cleaned = String(value);
  } else if (typeof value === 'string') {
    cleaned = value.trim().replace(/[$,\s]/g, '');
  } else {
    throw new Error('Enter a price such as 9.99.');
  }

  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(cleaned)) {
    throw new Error('Enter a price such as 9.99 (up to two decimal places).');
  }

  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_COST_CENTS) {
    throw new Error('Price is too large.');
  }
  return cents;
}

export function formatUsd(cents) {
  if (!Number.isFinite(cents)) {
    return '$0.00';
  }
  return csvUsdFormatter.format(cents / 100);
}

function parseWholeNumber(value, min, max) {
  let number;

  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    number = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(number) || number < min || number > max) {
    return null;
  }
  return number;
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return fallback;
}

function currentTimestamp(nowIso) {
  return normalizeTimestamp(nowIso, new Date().toISOString());
}

/**
 * Validate and canonicalize one trial. Form strings, JSON values, and CSV
 * values all pass through this boundary.
 */
export function createTrialRecord(
  raw,
  { nowIso = new Date().toISOString(), idFactory = makeTrialId } = {},
) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TrialValidationError([
      { field: 'form', message: 'The trial entry is not a valid object.' },
    ]);
  }

  const now = currentTimestamp(nowIso);
  const issues = [];

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    issues.push({ field: 'name', message: 'Give this trial a name.' });
  } else if (name.length > MAX_NAME_LENGTH) {
    issues.push({
      field: 'name',
      message: `Keep the trial name under ${MAX_NAME_LENGTH} characters.`,
    });
  }

  if (!isDateOnly(raw.startDate)) {
    issues.push({
      field: 'startDate',
      message: 'Choose a valid start date.',
    });
  }

  const trialDays = parseWholeNumber(raw.trialDays, 1, MAX_TRIAL_DAYS);
  if (trialDays === null) {
    issues.push({
      field: 'trialDays',
      message: `Trial length must be a whole number from 1 to ${MAX_TRIAL_DAYS}.`,
    });
  }

  const reminderDays = parseWholeNumber(
    raw.reminderDays ?? 3,
    0,
    MAX_REMINDER_DAYS,
  );
  if (reminderDays === null) {
    issues.push({
      field: 'reminderDays',
      message: `Reminder lead time must be from 0 to ${MAX_REMINDER_DAYS} days.`,
    });
  }

  const billingCycle = normalizeBillingCycle(raw.billingCycle);
  if (!billingCycle) {
    issues.push({
      field: 'billingCycle',
      message: 'Choose a valid billing cycle.',
    });
  }

  let costCents = 0;
  if (raw.costCents !== undefined && raw.costCents !== null) {
    if (
      !Number.isInteger(raw.costCents) ||
      raw.costCents < 0 ||
      raw.costCents > MAX_COST_CENTS
    ) {
      issues.push({
        field: 'costCents',
        message: 'Cost must be a valid non-negative amount.',
      });
    } else {
      costCents = raw.costCents;
    }
  } else if (
    raw.costAfterTrial !== undefined &&
    raw.costAfterTrial !== null &&
    raw.costAfterTrial !== ''
  ) {
    try {
      costCents = parseUsdToCents(raw.costAfterTrial);
    } catch (error) {
      issues.push({ field: 'costCents', message: error.message });
    }
  }

  let cancelUrl = '';
  try {
    cancelUrl = normalizeCancelUrl(raw.cancelUrl);
  } catch (error) {
    issues.push({ field: 'cancelUrl', message: error.message });
  }

  const notes = raw.notes === undefined || raw.notes === null ? '' : raw.notes;
  if (typeof notes !== 'string') {
    issues.push({ field: 'notes', message: 'Notes must be text.' });
  } else if (notes.length > MAX_NOTES_LENGTH) {
    issues.push({
      field: 'notes',
      message: `Keep notes under ${MAX_NOTES_LENGTH} characters.`,
    });
  }

  const status = normalizeStatus(raw.status);
  if (!status) {
    issues.push({
      field: 'status',
      message: 'Status must be active or canceled.',
    });
  }

  if (issues.length) {
    throw new TrialValidationError(issues);
  }

  const id =
    typeof raw.id === 'string' && ID_PATTERN.test(raw.id.trim())
      ? raw.id.trim()
      : idFactory();

  return {
    id,
    name,
    startDate: raw.startDate,
    trialDays,
    costCents,
    billingCycle,
    cancelUrl,
    reminderDays,
    notes: notes.trim(),
    status,
    canceledAt:
      status === 'canceled' ? normalizeTimestamp(raw.canceledAt, now) : null,
    createdAt: normalizeTimestamp(raw.createdAt, now),
    updatedAt: normalizeTimestamp(raw.updatedAt, now),
  };
}

export function prepareTrials(
  rawTrials,
  {
    nowIso = new Date().toISOString(),
    idFactory = makeTrialId,
    source = 'import',
    rowNumbers = null,
  } = {},
) {
  if (!Array.isArray(rawTrials)) {
    throw new TrialValidationError([
      { field: 'file', message: 'No trials list was found in this file.' },
    ]);
  }
  if (rawTrials.length === 0) {
    throw new TrialValidationError([
      { field: 'file', message: 'No trials were found in this file.' },
    ]);
  }
  if (rawTrials.length > MAX_TRIALS) {
    throw new TrialValidationError([
      {
        field: 'file',
        message: `This file has more than ${MAX_TRIALS} trials. Import a smaller file.`,
      },
    ]);
  }

  const now = currentTimestamp(nowIso);
  const trials = [];
  const issues = [];
  const seenIds = new Set();

  rawTrials.forEach((raw, index) => {
    const label =
      rowNumbers && rowNumbers[index]
        ? `Row ${rowNumbers[index]}`
        : `Entry ${index + 1}`;

    try {
      const trial = createTrialRecord(raw, { nowIso: now, idFactory });
      if (seenIds.has(trial.id)) {
        issues.push({
          field: 'id',
          message: `${label}: duplicate trial id "${trial.id}".`,
        });
      } else {
        seenIds.add(trial.id);
        trials.push(trial);
      }
    } catch (error) {
      if (!(error instanceof TrialValidationError)) {
        throw error;
      }
      for (const issue of error.issues) {
        issues.push({ ...issue, message: `${label}: ${issue.message}` });
      }
    }
  });

  if (issues.length) {
    throw new TrialValidationError(issues);
  }
  if (trials.length === 0) {
    throw new TrialValidationError([
      { field: source, message: 'No usable trials were found.' },
    ]);
  }

  return trials;
}

export function buildBackup(
  trials,
  { exportedAt = new Date().toISOString() } = {},
) {
  return {
    app: 'Trialwise',
    version: DATA_VERSION,
    exportedAt,
    trials: trials.map((trial) => ({ ...trial })),
  };
}

export function serializeJSONBackup(trials, options = {}) {
  return `${JSON.stringify(buildBackup(trials, options), null, 2)}\n`;
}

export function parseJSONBackup(
  text,
  { nowIso = new Date().toISOString(), idFactory = makeTrialId } = {},
) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TrialValidationError([
      { field: 'file', message: 'That file is not valid JSON.' },
    ]);
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    parsed.app &&
    parsed.app !== 'Trialwise'
  ) {
    throw new TrialValidationError([
      { field: 'file', message: 'That JSON file was not exported by Trialwise.' },
    ]);
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    parsed.version !== undefined &&
    parsed.version !== DATA_VERSION
  ) {
    throw new TrialValidationError([
      {
        field: 'file',
        message: 'That backup uses an unsupported file version.',
      },
    ]);
  }

  const rawTrials = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? parsed.trials
      : null;

  return prepareTrials(rawTrials, {
    nowIso,
    idFactory,
    source: 'JSON',
  });
}

const CSV_HEADERS = Object.freeze([
  'id',
  'name',
  'start_date',
  'trial_days',
  'cost_after_trial',
  'billing_cycle',
  'cancel_url',
  'reminder_days',
  'status',
  'canceled_at',
  'notes',
  'created_at',
  'updated_at',
]);

const HEADER_ALIASES = new Map([
  ['id', 'id'],
  ['name', 'name'],
  ['service', 'name'],
  ['start_date', 'startDate'],
  ['start', 'startDate'],
  ['trial_days', 'trialDays'],
  ['trial_length', 'trialDays'],
  ['trial_length_days', 'trialDays'],
  ['cost_after_trial', 'costAfterTrial'],
  ['cost', 'costAfterTrial'],
  ['price', 'costAfterTrial'],
  ['billing_cycle', 'billingCycle'],
  ['billing', 'billingCycle'],
  ['cancel_url', 'cancelUrl'],
  ['cancel_link', 'cancelUrl'],
  ['reminder_days', 'reminderDays'],
  ['reminder', 'reminderDays'],
  ['status', 'status'],
  ['canceled_at', 'canceledAt'],
  ['notes', 'notes'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
]);

function normalizeCSVHeader(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function trialsToCSV(trials) {
  const rows = [
    CSV_HEADERS,
    ...trials.map((trial) => [
      trial.id,
      trial.name,
      trial.startDate,
      trial.trialDays,
      (trial.costCents / 100).toFixed(2),
      trial.billingCycle,
      trial.cancelUrl,
      trial.reminderDays,
      trial.status,
      trial.canceledAt ?? '',
      trial.notes,
      trial.createdAt,
      trial.updatedAt,
    ]),
  ];

  return `\uFEFF${stringifyCSV(rows)}`;
}

export function parseCSVBackup(
  text,
  { nowIso = new Date().toISOString(), idFactory = makeTrialId } = {},
) {
  let rows;
  try {
    rows = parseCSV(text);
  } catch (error) {
    throw new TrialValidationError([{ field: 'file', message: error.message }]);
  }

  if (rows.length < 2) {
    throw new TrialValidationError([
      { field: 'file', message: 'That CSV file has no trial rows.' },
    ]);
  }

  const headers = rows[0].map(normalizeCSVHeader);
  const mappedHeaders = [];
  const seenHeaders = new Set();

  headers.forEach((header) => {
    if (!header) {
      mappedHeaders.push(null);
      return;
    }
    const canonical = HEADER_ALIASES.get(header);
    if (!canonical) {
      mappedHeaders.push(null);
      return;
    }
    if (seenHeaders.has(canonical)) {
      throw new TrialValidationError([
        {
          field: 'file',
          message: `The CSV has more than one "${header}" column.`,
        },
      ]);
    }
    seenHeaders.add(canonical);
    mappedHeaders.push(canonical);
  });

  for (const required of ['name', 'startDate', 'trialDays']) {
    if (!seenHeaders.has(required)) {
      const headerName = {
        name: 'name',
        startDate: 'start_date',
        trialDays: 'trial_days',
      }[required];
      throw new TrialValidationError([
        {
          field: 'file',
          message: `CSV must include the "${headerName}" column.`,
        },
      ]);
    }
  }

  const rawTrials = [];
  const rowNumbers = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.every((cell) => String(cell ?? '').trim() === '')) {
      continue;
    }

    const raw = {};
    row.forEach((cell, columnIndex) => {
      const field = mappedHeaders[columnIndex];
      if (!field) {
        return;
      }
      raw[field] = unprotectSpreadsheetValue(cell);
    });

    rawTrials.push(raw);
    rowNumbers.push(rowIndex + 1);
  }

  if (rawTrials.length === 0) {
    throw new TrialValidationError([
      { field: 'file', message: 'That CSV file has no trial rows.' },
    ]);
  }

  return prepareTrials(rawTrials, {
    nowIso,
    idFactory,
    source: 'CSV',
    rowNumbers,
  });
}

export function mergeTrials(existing, imported) {
  const merged = [...existing];
  const indexes = new Map(existing.map((trial, index) => [trial.id, index]));

  for (const trial of imported) {
    if (indexes.has(trial.id)) {
      merged[indexes.get(trial.id)] = trial;
    } else {
      indexes.set(trial.id, merged.length);
      merged.push(trial);
    }
  }

  return merged;
}
