import { addDays, computeTrial, todayISO } from './dates.js';
import {
  BILLING_CYCLE_LABELS,
  formatUsd,
  normalizeCancelUrl,
} from './data.js';

export function escapeICSText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function formatICSDate(dateISO) {
  return dateISO.replaceAll('-', '');
}

function formatICSTimestamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('A valid generation time is required.');
  }
  return value
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function foldICSLine(line) {
  const encoder = new TextEncoder();
  let output = '';
  let lineBytes = 0;

  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (lineBytes + bytes > 75) {
      output += '\r\n ';
      lineBytes = 1;
    }
    output += character;
    lineBytes += bytes;
  }

  return output;
}

function makeEvent({ trial, kind, date, timestamp }) {
  const details = computeTrial({
    startDate: trial.startDate,
    trialDays: trial.trialDays,
    reminderDays: trial.reminderDays,
    status: trial.status,
    today: date,
  });

  const isReminder = kind === 'reminder';
  const summary = isReminder
    ? `Free trial reminder: ${trial.name}`
    : `Last day to cancel ${trial.name}`;
  const cost = `${formatUsd(trial.costCents)} ${BILLING_CYCLE_LABELS[trial.billingCycle]}`;
  const cancelBy = details.cancelByDate;

  const descriptionParts = isReminder
    ? [
        `Your free trial for ${trial.name} can be canceled through ${cancelBy}.`,
        `It changes to ${cost} after the trial unless canceled.`,
      ]
    : [
        `Today is the last day to cancel the ${trial.name} free trial without being charged.`,
        `Cost after the trial: ${cost}.`,
      ];

  if (trial.notes) {
    descriptionParts.push(`Notes: ${trial.notes}`);
  }

  let safeUrl = '';
  try {
    safeUrl = normalizeCancelUrl(trial.cancelUrl);
  } catch {
    safeUrl = '';
  }

  if (safeUrl) {
    descriptionParts.push(`Cancel page: ${safeUrl}`);
  }

  const description = escapeICSText(descriptionParts.join('\n'));
  const lines = [
    'BEGIN:VEVENT',
    `UID:${trial.id}-${kind}-${formatICSDate(date)}@trialwise.local`,
    `DTSTAMP:${timestamp}`,
    `DTSTART;VALUE=DATE:${formatICSDate(date)}`,
    `DTEND;VALUE=DATE:${formatICSDate(addDays(date, 1))}`,
    `SUMMARY:${escapeICSText(summary)}`,
    `DESCRIPTION:${description}`,
    'TRANSP:TRANSPARENT',
  ];

  if (safeUrl) {
    lines.push(`URL:${safeUrl.replace(/[\r\n]/g, '')}`);
  }

  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT9H',
    `DESCRIPTION:${escapeICSText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
  );

  return lines.join('\r\n');
}

/**
 * Build an all-day calendar of upcoming reminder and cancel-by dates.
 * Calendar apps control the actual alert time; Trialwise supplies a 9:00
 * display alarm for clients that honor it.
 */
export function buildReminderCalendar(
  trials,
  { today = todayISO(), generatedAt = new Date() } = {},
) {
  const timestamp = formatICSTimestamp(generatedAt);
  const events = [];

  for (const trial of trials) {
    if (trial.status === 'canceled') {
      continue;
    }

    const details = computeTrial({
      startDate: trial.startDate,
      trialDays: trial.trialDays,
      reminderDays: trial.reminderDays,
      status: trial.status,
      today,
    });
    if (details.daysUntilCancelBy < 0) {
      continue;
    }

    if (details.reminderDate === details.cancelByDate) {
      events.push(
        makeEvent({
          trial,
          kind: 'deadline',
          date: details.cancelByDate,
          timestamp,
        }),
      );
    } else {
      if (details.reminderDate >= today) {
        events.push(
          makeEvent({
            trial,
            kind: 'reminder',
            date: details.reminderDate,
            timestamp,
          }),
        );
      }
      events.push(
        makeEvent({
          trial,
          kind: 'deadline',
          date: details.cancelByDate,
          timestamp,
        }),
      );
    }
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trialwise//Free trial reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Trialwise reminders',
    'X-WR-CALDESC:Upcoming free-trial cancellation dates',
    ...events.flatMap((event) => event.split('\r\n')),
    'END:VCALENDAR',
    '',
  ];

  return {
    content: lines.map(foldICSLine).join('\r\n'),
    eventCount: events.length,
  };
}
