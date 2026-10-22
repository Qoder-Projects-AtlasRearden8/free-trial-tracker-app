import { addDays, computeSubscription, computeTrial, todayISO } from './dates.js';
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

function describeCost(entry) {
  if (!entry.costCents) {
    return null;
  }
  return `${formatUsd(entry.costCents)} ${BILLING_CYCLE_LABELS[entry.billingCycle]}`;
}

function makeEvent({ entry, kind, date, timestamp, summary, descriptionParts }) {
  let safeUrl = '';
  try {
    safeUrl = normalizeCancelUrl(entry.cancelUrl);
  } catch {
    safeUrl = '';
  }

  if (safeUrl) {
    descriptionParts.push(`Manage or cancel: ${safeUrl}`);
  }

  const description = escapeICSText(descriptionParts.join('\n'));
  const lines = [
    'BEGIN:VEVENT',
    `UID:${entry.id}-${kind}-${formatICSDate(date)}@trialwise.local`,
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
 * Build an all-day calendar of upcoming trial deadlines and subscription
 * renewals. Calendar apps control the actual alert time; Trialwise supplies a
 * 9:00 display alarm for clients that honor it.
 */
export function buildReminderCalendar(
  entries,
  { today = todayISO(), generatedAt = new Date() } = {},
) {
  const timestamp = formatICSTimestamp(generatedAt);
  const events = [];

  for (const entry of entries) {
    if (entry.status === 'canceled') {
      continue;
    }

    if (entry.kind === 'subscription') {
      const details = computeSubscription({
        renewalDate: entry.renewalDate,
        billingCycle: entry.billingCycle,
        reminderDays: entry.reminderDays,
        status: entry.status,
        today,
      });
      const cost = describeCost(entry);
      const renewalParts = [
        cost
          ? `Your ${entry.name} subscription renews on ${details.nextRenewalDate} for ${cost}.`
          : `Your ${entry.name} subscription renews on ${details.nextRenewalDate}. The renewal price is not recorded.`,
      ];
      if (entry.notes) {
        renewalParts.push(`Notes: ${entry.notes}`);
      }

      if (
        details.reminderDate !== details.nextRenewalDate &&
        details.reminderDate >= today
      ) {
        const reminderParts = [
          `Your ${entry.name} subscription renews on ${details.nextRenewalDate}.`,
          cost
            ? `Upcoming charge: ${cost}.`
            : 'The renewal price is not recorded.',
        ];
        if (entry.notes) {
          reminderParts.push(`Notes: ${entry.notes}`);
        }
        events.push(
          makeEvent({
            entry,
            kind: 'renewal-reminder',
            date: details.reminderDate,
            timestamp,
            summary: `Renewal reminder: ${entry.name}`,
            descriptionParts: reminderParts,
          }),
        );
      }

      events.push(
        makeEvent({
          entry,
          kind: 'renewal',
          date: details.nextRenewalDate,
          timestamp,
          summary: `Renews today: ${entry.name}`,
          descriptionParts: renewalParts,
        }),
      );
      continue;
    }

    const details = computeTrial({
      startDate: entry.startDate,
      trialDays: entry.trialDays,
      reminderDays: entry.reminderDays,
      status: entry.status,
      today,
    });
    if (details.daysUntilCancelBy < 0) {
      continue;
    }

    const cost = describeCost(entry);
    const reminderParts = [
      `Your free trial for ${entry.name} can be canceled through ${details.cancelByDate}.`,
      cost
        ? `It changes to ${cost} after the trial unless canceled.`
        : 'No price is recorded for after the trial.',
    ];
    const deadlineParts = [
      `Today is the last day to cancel the ${entry.name} free trial without being charged.`,
      cost
        ? `Cost after the trial: ${cost}.`
        : 'No price is recorded for after the trial.',
    ];
    if (entry.notes) {
      reminderParts.push(`Notes: ${entry.notes}`);
      deadlineParts.push(`Notes: ${entry.notes}`);
    }

    if (details.reminderDate === details.cancelByDate) {
      events.push(
        makeEvent({
          entry,
          kind: 'deadline',
          date: details.cancelByDate,
          timestamp,
          summary: `Last day to cancel ${entry.name}`,
          descriptionParts: deadlineParts,
        }),
      );
    } else {
      if (details.reminderDate >= today) {
        events.push(
          makeEvent({
            entry,
            kind: 'reminder',
            date: details.reminderDate,
            timestamp,
            summary: `Free trial reminder: ${entry.name}`,
            descriptionParts: reminderParts,
          }),
        );
      }
      events.push(
        makeEvent({
          entry,
          kind: 'deadline',
          date: details.cancelByDate,
          timestamp,
          summary: `Last day to cancel ${entry.name}`,
          descriptionParts: deadlineParts,
        }),
      );
    }
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trialwise//Trial and subscription reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Trialwise reminders',
    'X-WR-CALDESC:Trial deadlines and subscription renewal reminders',
    ...events.flatMap((event) => event.split('\r\n')),
    'END:VCALENDAR',
    '',
  ];

  return {
    content: lines.map(foldICSLine).join('\r\n'),
    eventCount: events.length,
  };
}
