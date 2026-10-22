import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTrialRecord,
  formatUsd,
  mergeTrials,
  normalizeCancelUrl,
  parseCSVBackup,
  parseJSONBackup,
  parseUsdToCents,
  prepareTrials,
  serializeJSONBackup,
  TrialValidationError,
  trialsToCSV,
} from '../lib/data.js';

const NOW = '2026-10-22T15:30:00.000Z';

function rawTrial(overrides = {}) {
  return {
    id: 'trial-1',
    name: 'Example Music',
    startDate: '2026-10-20',
    trialDays: 7,
    costCents: 1499,
    billingCycle: 'monthly',
    cancelUrl: 'https://example.com/account/cancel',
    reminderDays: 3,
    notes: 'Use the web account page.',
    status: 'active',
    ...overrides,
  };
}

function rawSubscription(overrides = {}) {
  return {
    id: 'sub-1',
    kind: 'subscription',
    name: 'Example Cloud',
    renewalDate: '2026-11-15',
    costCents: 999,
    billingCycle: 'monthly',
    cancelUrl: 'https://example.com/account',
    reminderDays: 5,
    notes: 'Shared family plan.',
    status: 'active',
    ...overrides,
  };
}

test('creates a complete, normalized trial record', () => {
  const trial = createTrialRecord(rawTrial(), {
    nowIso: NOW,
    idFactory: () => 'generated',
  });

  assert.equal(trial.id, 'trial-1');
  assert.equal(trial.kind, 'trial');
  assert.equal(trial.name, 'Example Music');
  assert.equal(trial.startDate, '2026-10-20');
  assert.equal(trial.trialDays, 7);
  assert.equal(trial.renewalDate, null);
  assert.equal(trial.costCents, 1499);
  assert.equal(trial.billingCycle, 'monthly');
  assert.equal(trial.reminderDays, 3);
  assert.equal(trial.status, 'active');
  assert.equal(trial.createdAt, NOW);
  assert.equal(trial.updatedAt, NOW);
  assert.equal(trial.canceledAt, null);
});

test('creates a subscription record anchored to its next renewal', () => {
  const subscription = createTrialRecord(rawSubscription(), { nowIso: NOW });

  assert.equal(subscription.kind, 'subscription');
  assert.equal(subscription.name, 'Example Cloud');
  assert.equal(subscription.renewalDate, '2026-11-15');
  assert.equal(subscription.startDate, null);
  assert.equal(subscription.trialDays, null);
  assert.equal(subscription.costCents, 999);
  assert.equal(subscription.reminderDays, 5);
  assert.equal(subscription.billingCycle, 'monthly');
});

test('subscriptions require a recurring cycle and a renewal date', () => {
  assert.throws(
    () =>
      createTrialRecord(rawSubscription({ billingCycle: 'one-time' }), {
        nowIso: NOW,
      }),
    /weekly, monthly, or yearly/,
  );
  assert.throws(
    () => createTrialRecord(rawSubscription({ renewalDate: '2026-02-30' }), { nowIso: NOW }),
    /valid next renewal date/,
  );
});

test('preserves stored timestamps when normalization is not an edit', () => {
  const trial = createTrialRecord(
    rawTrial({
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-10T09:30:00.000Z',
    }),
    { nowIso: NOW },
  );

  assert.equal(trial.createdAt, '2026-10-01T08:00:00.000Z');
  assert.equal(trial.updatedAt, '2026-10-10T09:30:00.000Z');
});

test('generates IDs and friendly defaults', () => {
  const trial = createTrialRecord(
    {
      name: '  Tiny Trial  ',
      startDate: '2026-10-22',
      trialDays: '3',
      costAfterTrial: '$4.50',
      notes: '  hello  ',
    },
    { nowIso: NOW, idFactory: () => 'new-id' },
  );

  assert.equal(trial.id, 'new-id');
  assert.equal(trial.name, 'Tiny Trial');
  assert.equal(trial.trialDays, 3);
  assert.equal(trial.reminderDays, 3);
  assert.equal(trial.costCents, 450);
  assert.equal(trial.billingCycle, 'monthly');
  assert.equal(trial.notes, 'hello');
});

test('validates all fields with useful issue names', () => {
  assert.throws(
    () =>
      createTrialRecord(
        rawTrial({
          name: '',
          startDate: '2026-02-30',
          trialDays: 0,
          costCents: -1,
          cancelUrl: 'javascript:alert(1)',
          reminderDays: 999,
          status: 'maybe',
        }),
        { nowIso: NOW },
      ),
    (error) => {
      assert.ok(error instanceof TrialValidationError);
      assert.deepEqual(
        new Set(error.issues.map((issue) => issue.field)),
        new Set([
          'name',
          'startDate',
          'trialDays',
          'costCents',
          'cancelUrl',
          'reminderDays',
          'status',
        ]),
      );
      return true;
    },
  );
});

test('normalizes friendly billing cycles and statuses', () => {
  assert.equal(
    createTrialRecord(rawTrial({ billingCycle: 'Annual', status: 'cancelled' }), {
      nowIso: NOW,
    }).billingCycle,
    'yearly',
  );
  assert.equal(
    createTrialRecord(rawTrial({ billingCycle: 'one time', status: 'cancelled' }), {
      nowIso: NOW,
    }).status,
    'canceled',
  );
});

test('accepts safe cancel links and rejects unsafe ones', () => {
  assert.equal(normalizeCancelUrl('example.com/cancel'), 'https://example.com/cancel');
  assert.equal(normalizeCancelUrl('  '), '');
  assert.equal(
    normalizeCancelUrl('http://help.example.com/cancel?x=1'),
    'http://help.example.com/cancel?x=1',
  );
  assert.throws(() => normalizeCancelUrl('javascript:alert(1)'), /http/);
  assert.throws(() => normalizeCancelUrl('data:text/html,hi'), /http/);
  assert.throws(() => normalizeCancelUrl('https://user:pass@example.com'), /username/);
  assert.throws(() => normalizeCancelUrl('not a url'), /valid/);
});

test('parses USD amounts strictly', () => {
  assert.equal(parseUsdToCents('$1,299.99'), 129999);
  assert.equal(parseUsdToCents(' 12 '), 1200);
  assert.equal(parseUsdToCents(0), 0);
  assert.equal(parseUsdToCents('.50'), 50);
  assert.throws(() => parseUsdToCents('-1'), /price/);
  assert.throws(() => parseUsdToCents('12.999'), /two decimal/);
  assert.throws(() => parseUsdToCents('12abc'), /price/);
  assert.equal(formatUsd(129999), '$1,299.99');
});

test('JSON backup round-trips active and canceled trials', () => {
  const trials = prepareTrials(
    [
      rawTrial(),
      rawTrial({
        id: 'trial-2',
        name: 'Annual Example',
        trialDays: 30,
        costCents: 12000,
        billingCycle: 'yearly',
        status: 'canceled',
        canceledAt: '2026-10-21T11:00:00.000Z',
      }),
    ],
    { nowIso: NOW },
  );

  const backup = serializeJSONBackup(trials, { exportedAt: NOW });
  const restored = parseJSONBackup(backup, { nowIso: NOW });

  assert.equal(restored.length, 2);
  assert.equal(restored[0].name, 'Example Music');
  assert.equal(restored[0].kind, 'trial');
  assert.equal(restored[1].status, 'canceled');
  assert.equal(restored[1].canceledAt, '2026-10-21T11:00:00.000Z');
  assert.equal(JSON.parse(backup).app, 'Trialwise');
});

test('JSON backup round-trips trials and subscriptions together', () => {
  const entries = prepareTrials(
    [rawTrial(), rawSubscription(), rawSubscription({
      id: 'sub-2',
      name: 'Canceled Example',
      status: 'canceled',
      canceledAt: '2026-10-20T10:00:00.000Z',
    })],
    { nowIso: NOW },
  );

  const restored = parseJSONBackup(serializeJSONBackup(entries), { nowIso: NOW });
  assert.deepEqual(
    restored.map((entry) => entry.kind),
    ['trial', 'subscription', 'subscription'],
  );
  assert.equal(restored[1].renewalDate, '2026-11-15');
  assert.equal(restored[1].trialDays, null);
  assert.equal(restored[2].status, 'canceled');
});

test('JSON import rejects bad input and duplicate IDs', () => {
  assert.throws(
    () => parseJSONBackup('{"oops":', { nowIso: NOW }),
    /valid JSON/,
  );
  assert.throws(
    () => parseJSONBackup('{"app":"SomethingElse","trials":[]}', { nowIso: NOW }),
    /was not exported by Trialwise/,
  );
  assert.throws(
    () =>
      parseJSONBackup(
        JSON.stringify({ app: 'Trialwise', version: 99, trials: [rawTrial()] }),
        { nowIso: NOW },
      ),
    /unsupported file version/,
  );
  assert.throws(
    () =>
      parseJSONBackup(
        JSON.stringify({ app: 'Trialwise', version: 1, trials: [rawTrial(), rawTrial()] }),
        { nowIso: NOW },
      ),
    /duplicate entry id/,
  );
});

test('CSV export includes readable headers and protects formulas', () => {
  const trials = prepareTrials(
    [
      rawTrial({ name: '=HYPERLINK("https://bad.example")', notes: 'A, B\nC' }),
      rawTrial({
        id: 'trial-2',
        name: 'Plain',
        status: 'canceled',
        canceledAt: NOW,
        cancelUrl: '',
        notes: '',
      }),
    ],
    { nowIso: NOW },
  );

  const csv = trialsToCSV(trials);
  assert.ok(csv.startsWith('\uFEFFid,name,type,start_date,trial_days,renewal_date'));
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"A, B\nC"/);
  assert.match(csv, /Plain/);
  assert.match(csv, /,trial,2026-10-20,7,,/);
});

test('CSV export and import preserve subscriptions', () => {
  const entries = prepareTrials(
    [rawTrial(), rawSubscription()],
    { nowIso: NOW },
  );

  const csv = trialsToCSV(entries);
  assert.match(csv, /,subscription,,,2026-11-15,/);

  const restored = parseCSVBackup(csv, { nowIso: NOW });
  assert.equal(restored.length, 2);
  assert.equal(restored[1].kind, 'subscription');
  assert.equal(restored[1].renewalDate, '2026-11-15');
  assert.equal(restored[1].startDate, null);
  assert.equal(restored[1].trialDays, null);
  assert.equal(restored[1].costCents, 999);
  assert.equal(restored[1].reminderDays, 5);
});

test('CSV import infers subscriptions from renewal_date alone', () => {
  const csv = [
    'name,renewal_date,cost,billing_cycle,reminder_days',
    'Streaming Bundle,2026-12-01,19.99,yearly,7',
  ].join('\n');

  const [subscription] = parseCSVBackup(csv, {
    nowIso: NOW,
    idFactory: () => 'inferred',
  });
  assert.equal(subscription.kind, 'subscription');
  assert.equal(subscription.name, 'Streaming Bundle');
  assert.equal(subscription.renewalDate, '2026-12-01');
  assert.equal(subscription.costCents, 1999);
  assert.equal(subscription.billingCycle, 'yearly');
  assert.equal(subscription.reminderDays, 7);
  assert.equal(subscription.id, 'inferred');
});

test('CSV import honors an explicit type column', () => {
  const csv = [
    'name,type,start_date,trial_days,renewal_date,billing_cycle',
    'Membership,subscription,,,2026-11-20,weekly',
  ].join('\n');

  const [subscription] = parseCSVBackup(csv, { nowIso: NOW });
  assert.equal(subscription.kind, 'subscription');
  assert.equal(subscription.renewalDate, '2026-11-20');
  assert.equal(subscription.billingCycle, 'weekly');
});

test('CSV backup round-trips unusual text and data', () => {
  const original = prepareTrials(
    [
      rawTrial({
        name: '=Trial, "quoted"',
        notes: 'Line one\r\nLine two, with comma',
        reminderDays: 0,
        billingCycle: 'one-time',
        cancelUrl: 'https://example.com/cancel?a=1&b=2',
      }),
      rawTrial({
        id: 'trial-2',
        name: 'Canceled Thing',
        status: 'canceled',
        canceledAt: NOW,
        notes: '',
      }),
    ],
    { nowIso: NOW },
  );

  const restored = parseCSVBackup(trialsToCSV(original), { nowIso: NOW });
  assert.equal(restored.length, 2);
  assert.equal(restored[0].name, '=Trial, "quoted"');
  assert.equal(restored[0].notes, 'Line one\r\nLine two, with comma');
  assert.equal(restored[0].billingCycle, 'one-time');
  assert.equal(restored[0].costCents, 1499);
  assert.equal(restored[1].status, 'canceled');
  assert.equal(restored[1].canceledAt, NOW);
});

test('CSV import accepts a minimal hand-written sheet', () => {
  const csv = [
    'name,start_date,trial_days,cost_after_trial',
    'Photo Lab,2026-11-01,14,9.99',
    'Reading App,2026-11-03,7,',
  ].join('\n');

  const trials = parseCSVBackup(csv, {
    nowIso: NOW,
    idFactory: (() => {
      let count = 0;
      return () => `made-${++count}`;
    })(),
  });

  assert.equal(trials.length, 2);
  assert.equal(trials[0].costCents, 999);
  assert.equal(trials[0].reminderDays, 3);
  assert.equal(trials[0].billingCycle, 'monthly');
  assert.equal(trials[1].costCents, 0);
  assert.equal(trials[1].id, 'made-2');
});

test('CSV errors include the spreadsheet row number', () => {
  const csv = [
    'name,start_date,trial_days',
    'Good,2026-11-01,7',
    '',
    'Bad,2026-02-30,7',
  ].join('\n');

  assert.throws(
    () => parseCSVBackup(csv, { nowIso: NOW }),
    (error) => {
      assert.ok(error instanceof TrialValidationError);
      assert.match(error.message, /Row 4/);
      assert.match(error.message, /valid start date/);
      return true;
    },
  );
});

test('CSV import requires the essential columns', () => {
  assert.throws(
    () => parseCSVBackup('name,cost_after_trial\nTest,10\n', { nowIso: NOW }),
    /start_date/,
  );
});

test('CSV import accepts camelCase header aliases', () => {
  const csv = [
    'name,startDate,trialDays,costAfterTrial,billingCycle,cancelUrl,reminderDays',
    'Camel Case,2026-11-01,14,9.99,yearly,https://example.com/cancel,7',
  ].join('\n');

  const [trial] = parseCSVBackup(csv, { nowIso: NOW });
  assert.equal(trial.name, 'Camel Case');
  assert.equal(trial.startDate, '2026-11-01');
  assert.equal(trial.trialDays, 14);
  assert.equal(trial.costCents, 999);
  assert.equal(trial.billingCycle, 'yearly');
  assert.equal(trial.cancelUrl, 'https://example.com/cancel');
  assert.equal(trial.reminderDays, 7);
});

test('mergeTrials updates matching IDs and appends new records', () => {
  const current = prepareTrials(
    [rawTrial(), rawTrial({ id: 'trial-2', name: 'Keep Me' })],
    { nowIso: NOW },
  );
  const incoming = prepareTrials(
    [
      rawTrial({ name: 'Updated Name' }),
      rawTrial({ id: 'trial-3', name: 'New Trial' }),
    ],
    { nowIso: NOW },
  );

  const merged = mergeTrials(current, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].name, 'Updated Name');
  assert.equal(merged[1].name, 'Keep Me');
  assert.equal(merged[2].name, 'New Trial');
});

test('prepareTrials reports row labels and rejects an empty data set', () => {
  assert.throws(
    () =>
      prepareTrials([rawTrial({ startDate: 'not-a-date' })], {
        nowIso: NOW,
        rowNumbers: [9],
      }),
    /Row 9/,
  );

  assert.throws(
    () => prepareTrials([], { nowIso: NOW }),
    /No entries were found/,
  );
});
