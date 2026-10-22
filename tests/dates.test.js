import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addBillingCycle,
  addDays,
  computeSubscription,
  computeTrial,
  daysBetween,
  isDateOnly,
  monthlyEquivalentCents,
  nextRenewalOnOrAfter,
  parseDateOnly,
  todayISO,
  toDateOnly,
} from '../lib/dates.js';

test('parses strict date-only strings', () => {
  assert.equal(toDateOnly(parseDateOnly('2026-10-22')), '2026-10-22');
  assert.equal(isDateOnly('2024-02-29'), true);
  assert.equal(isDateOnly('2023-02-29'), false);
  assert.equal(isDateOnly('2026-13-01'), false);
  assert.equal(isDateOnly('2026-04-31'), false);
  assert.equal(isDateOnly('Oct 22, 2026'), false);
  assert.equal(isDateOnly('2026-1-02'), false);
  assert.equal(isDateOnly(null), false);
  assert.throws(() => parseDateOnly('2026-02-30'), /not a real calendar date/);
});

test('addDays crosses month, year, and leap-day boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addDays('2024-03-01', -2), '2024-02-28');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.throws(() => addDays('2026-01-01', 1.5), /whole number/);
});

test('daysBetween is inclusive-independent and supports negative results', () => {
  assert.equal(daysBetween('2026-10-22', '2026-10-29'), 7);
  assert.equal(daysBetween('2026-10-29', '2026-10-22'), -7);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2026-10-22', '2026-10-22'), 0);
});

test('a seven-day trial bills after the seventh day', () => {
  const trial = computeTrial({
    startDate: '2026-10-01',
    trialDays: 7,
    reminderDays: 3,
    today: '2026-10-01',
  });

  assert.equal(trial.cancelByDate, '2026-10-07');
  assert.equal(trial.billingDate, '2026-10-08');
  assert.equal(trial.reminderDate, '2026-10-04');
  assert.equal(trial.daysUntilCancelBy, 6);
  assert.equal(trial.daysRemaining, 7);
  assert.equal(trial.phase, 'active');
});

test('a one-day trial starts and ends on the same day', () => {
  const trial = computeTrial({
    startDate: '2026-10-22',
    trialDays: 1,
    reminderDays: 0,
    today: '2026-10-22',
  });

  assert.equal(trial.cancelByDate, '2026-10-22');
  assert.equal(trial.billingDate, '2026-10-23');
  assert.equal(trial.reminderDate, '2026-10-22');
  assert.equal(trial.phase, 'last-day');
  assert.equal(trial.isWithinReminderWindow, true);
});

test('reminder dates are clamped to the trial start date', () => {
  const trial = computeTrial({
    startDate: '2026-10-22',
    trialDays: 3,
    reminderDays: 14,
    today: '2026-10-01',
  });

  assert.equal(trial.cancelByDate, '2026-10-24');
  assert.equal(trial.reminderDate, '2026-10-22');
  assert.equal(trial.isWithinReminderWindow, false);
});

test('phases follow the local calendar boundaries', () => {
  const base = {
    startDate: '2026-10-10',
    trialDays: 7,
    reminderDays: 7,
  };

  assert.equal(computeTrial({ ...base, today: '2026-10-09' }).phase, 'upcoming');
  assert.equal(computeTrial({ ...base, today: '2026-10-10' }).phase, 'active');
  assert.equal(computeTrial({ ...base, today: '2026-10-13' }).phase, 'ending-soon');
  assert.equal(computeTrial({ ...base, today: '2026-10-15' }).phase, 'ending-soon');
  assert.equal(computeTrial({ ...base, today: '2026-10-16' }).phase, 'last-day');
  assert.equal(computeTrial({ ...base, today: '2026-10-17' }).phase, 'ended');
  assert.equal(computeTrial({ ...base, today: '2026-10-17' }).isOverdue, true);
  assert.equal(computeTrial({ ...base, today: '2026-10-17' }).daysUntilCancelBy, -1);
});

test('a canceled trial reports canceled even after its deadline', () => {
  const trial = computeTrial({
    startDate: '2026-10-01',
    trialDays: 7,
    status: 'canceled',
    today: '2026-12-01',
  });

  assert.equal(trial.phase, 'canceled');
  assert.equal(trial.isCanceled, true);
  assert.equal(trial.isOverdue, false);
  assert.equal(trial.isWithinReminderWindow, false);
});

test('reminder window is active on and after the reminder date', () => {
  const base = {
    startDate: '2026-10-01',
    trialDays: 10,
    reminderDays: 3,
  };

  assert.equal(
    computeTrial({ ...base, today: '2026-10-06' }).isWithinReminderWindow,
    false,
  );
  assert.equal(
    computeTrial({ ...base, today: '2026-10-07' }).isWithinReminderWindow,
    true,
  );
  assert.equal(
    computeTrial({ ...base, today: '2026-10-10' }).isWithinReminderWindow,
    true,
  );
});

test('deadline calculations do not drift across daylight-saving changes', () => {
  const springForward = computeTrial({
    startDate: '2026-03-07',
    trialDays: 4,
    reminderDays: 2,
    today: '2026-03-08',
  });
  const fallBack = computeTrial({
    startDate: '2026-10-31',
    trialDays: 4,
    reminderDays: 2,
    today: '2026-11-01',
  });

  assert.equal(springForward.cancelByDate, '2026-03-10');
  assert.equal(springForward.billingDate, '2026-03-11');
  assert.equal(fallBack.cancelByDate, '2026-11-03');
  assert.equal(fallBack.billingDate, '2026-11-04');
});

test('todayISO uses the local calendar day', () => {
  const localLateEvening = new Date(2026, 9, 22, 23, 55, 0);
  assert.equal(todayISO(localLateEvening), '2026-10-22');
});

test('rejects invalid trial parameters', () => {
  assert.throws(
    () => computeTrial({ startDate: '2026-10-01', trialDays: 0, today: '2026-10-01' }),
    /at least 1 day/,
  );
  assert.throws(
    () => computeTrial({ startDate: '2026-10-01', trialDays: 7, reminderDays: -1 }),
    /non-negative/,
  );
  assert.throws(
    () => computeTrial({ startDate: 'nope', trialDays: 7, today: '2026-10-01' }),
    /valid date/,
  );
});

test('monthlyEquivalentCents normalizes recurring costs', () => {
  assert.equal(monthlyEquivalentCents(1499, 'monthly'), 1499);
  assert.equal(monthlyEquivalentCents(12000, 'yearly'), 1000);
  assert.equal(monthlyEquivalentCents(500, 'weekly'), 2167);
  assert.equal(monthlyEquivalentCents(9999, 'one-time'), 0);
  assert.throws(() => monthlyEquivalentCents(-1, 'monthly'), /non-negative/);
  assert.throws(() => monthlyEquivalentCents(100, 'daily'), /Unknown billing cycle/);
});

test('billing cycles clamp month ends and leap days without drifting', () => {
  assert.equal(addBillingCycle('2027-01-31', 'monthly'), '2027-02-28');
  assert.equal(addBillingCycle('2027-01-31', 'monthly', 2), '2027-03-31');
  assert.equal(addBillingCycle('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(addBillingCycle('2024-02-29', 'yearly', 4), '2028-02-29');
  assert.equal(addBillingCycle('2026-10-22', 'weekly', 3), '2026-11-12');
  assert.throws(() => addBillingCycle('2026-10-22', 'monthly', 0), /positive/);
  assert.throws(() => addBillingCycle('2026-10-22', 'one-time'), /Unknown/);
});

test('nextRenewalOnOrAfter advances from the original anchor', () => {
  assert.equal(
    nextRenewalOnOrAfter('2027-01-31', 'monthly', '2027-02-10'),
    '2027-02-28',
  );
  assert.equal(
    nextRenewalOnOrAfter('2027-01-31', 'monthly', '2027-03-01'),
    '2027-03-31',
  );
  assert.equal(
    nextRenewalOnOrAfter('2026-11-15', 'monthly', '2026-11-15'),
    '2026-11-15',
  );
  assert.equal(
    nextRenewalOnOrAfter('2026-10-01', 'weekly', '2026-10-22'),
    '2026-10-22',
  );
});

test('subscription reminders appear before renewal and roll forward', () => {
  const base = {
    renewalDate: '2026-11-15',
    billingCycle: 'monthly',
    reminderDays: 3,
  };

  const early = computeSubscription({ ...base, today: '2026-11-11' });
  assert.equal(early.nextRenewalDate, '2026-11-15');
  assert.equal(early.reminderDate, '2026-11-12');
  assert.equal(early.phase, 'subscribed');
  assert.equal(early.isWithinReminderWindow, false);

  const due = computeSubscription({ ...base, today: '2026-11-12' });
  assert.equal(due.phase, 'renewing-soon');
  assert.equal(due.daysUntilRenewal, 3);
  assert.equal(due.isWithinReminderWindow, true);

  const today = computeSubscription({ ...base, today: '2026-11-15' });
  assert.equal(today.phase, 'renews-today');
  assert.equal(today.daysUntilRenewal, 0);
  assert.equal(today.isWithinReminderWindow, true);

  const after = computeSubscription({ ...base, today: '2026-11-16' });
  assert.equal(after.nextRenewalDate, '2026-12-15');
  assert.equal(after.phase, 'subscribed');
  assert.equal(after.daysUntilRenewal, 29);
});

test('canceled subscriptions do not create reminders', () => {
  const details = computeSubscription({
    renewalDate: '2026-11-15',
    reminderDays: 7,
    status: 'canceled',
    today: '2026-11-12',
  });

  assert.equal(details.phase, 'canceled');
  assert.equal(details.isCanceled, true);
  assert.equal(details.isWithinReminderWindow, false);
  assert.equal(details.isOverdue, false);
});

test('rejects invalid subscription parameters', () => {
  assert.throws(
    () => computeSubscription({ renewalDate: '2026-11-15', billingCycle: 'one-time' }),
    /weekly, monthly, or yearly/,
  );
  assert.throws(
    () => computeSubscription({ renewalDate: 'not-a-date' }),
    /valid date/,
  );
  assert.throws(
    () => computeSubscription({ renewalDate: '2026-11-15', reminderDays: -1 }),
    /non-negative/,
  );
});
