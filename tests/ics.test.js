import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReminderCalendar, escapeICSText } from '../lib/ics.js';
import { prepareTrials } from '../lib/data.js';

const NOW = new Date('2026-10-22T15:30:00.000Z');

function makeTrials() {
  return prepareTrials(
    [
      {
        id: 'trial-1',
        name: 'Music, Unlimited',
        startDate: '2026-10-20',
        trialDays: 10,
        costCents: 1499,
        billingCycle: 'monthly',
        cancelUrl: 'https://example.com/cancel',
        reminderDays: 3,
        notes: 'Use "Accounts"; then cancel.',
        status: 'active',
      },
      {
        id: 'trial-2',
        name: 'Already handled',
        startDate: '2026-10-20',
        trialDays: 10,
        costCents: 500,
        billingCycle: 'monthly',
        reminderDays: 1,
        status: 'canceled',
      },
      {
        id: 'trial-3',
        name: 'Past trial',
        startDate: '2026-10-01',
        trialDays: 7,
        costCents: 800,
        billingCycle: 'monthly',
        reminderDays: 2,
        status: 'active',
      },
    ],
    { nowIso: NOW.toISOString() },
  );
}

test('escapes values for iCalendar', () => {
  assert.equal(
    escapeICSText('one, two; three\\four\nfive'),
    'one\\, two\\; three\\\\four\\nfive',
  );
});

test('builds reminder and deadline events for upcoming non-canceled trials', () => {
  const { content, eventCount } = buildReminderCalendar(makeTrials(), {
    today: '2026-10-22',
    generatedAt: NOW,
  });

  assert.equal(eventCount, 2);
  assert.match(content, /BEGIN:VCALENDAR\r\nVERSION:2.0/);
  assert.match(content, /SUMMARY:Free trial reminder: Music\\, Unlimited/);
  assert.match(content, /SUMMARY:Last day to cancel Music\\, Unlimited/);
  assert.match(content, /DTSTART;VALUE=DATE:20261026/);
  assert.match(content, /DTSTART;VALUE=DATE:20261029/);
  assert.match(content, /DTEND;VALUE=DATE:20261030/);
  assert.match(content, /URL:https:\/\/example.com\/cancel/);
  assert.match(content, /DTSTAMP:20261022T153000Z/);
  assert.doesNotMatch(content, /Already handled/);
  assert.doesNotMatch(content, /Past trial/);
  assert.ok(content.endsWith('\r\n'));
});

test('a trial with no reminder lead time gets one deadline event', () => {
  const trials = prepareTrials(
    [
      {
        name: 'Same Day',
        startDate: '2026-10-22',
        trialDays: 1,
        reminderDays: 0,
      },
    ],
    { nowIso: NOW.toISOString() },
  );
  const { content, eventCount } = buildReminderCalendar(trials, {
    today: '2026-10-22',
    generatedAt: NOW,
  });

  assert.equal(eventCount, 1);
  assert.match(content, /SUMMARY:Last day to cancel Same Day/);
});

test('calendar lines are folded to a safe width', () => {
  const trials = prepareTrials(
    [
      {
        name: 'A very long service name that needs folding by calendars',
        startDate: '2026-10-22',
        trialDays: 5,
        reminderDays: 1,
      },
    ],
    { nowIso: NOW.toISOString() },
  );
  const { content } = buildReminderCalendar(trials, {
    today: '2026-10-22',
    generatedAt: NOW,
  });

  for (const bytesLine of content.split('\r\n')) {
    assert.ok(
      Buffer.byteLength(bytesLine, 'utf8') <= 75,
      `calendar line exceeds 75 bytes: ${bytesLine.slice(0, 30)}...`,
    );
  }
  assert.match(content, /\r\n /);
});
