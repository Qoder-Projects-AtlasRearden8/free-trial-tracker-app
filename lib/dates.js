const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parse a calendar date without involving time zones. Date-only arithmetic is
 * intentionally done in UTC so daylight-saving transitions cannot add or
 * remove an hour.
 */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    throw new TypeError('Expected a valid date in YYYY-MM-DD format.');
  }

  const [, yearText, monthText, dayText] = value.match(DATE_ONLY_PATTERN);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`${value} is not a real calendar date.`);
  }

  return date;
}

export function isDateOnly(value) {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

export function toDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Expected a valid Date.');
  }

  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Return the local calendar day, not the UTC day. */
export function todayISO(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Expected a valid Date.');
  }

  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(dateISO, days) {
  if (!Number.isInteger(days)) {
    throw new TypeError('Days to add must be a whole number.');
  }

  const date = parseDateOnly(dateISO);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function addMonthsClamped(dateISO, months) {
  if (!Number.isInteger(months)) {
    throw new TypeError('Months to add must be a whole number.');
  }

  const source = parseDateOnly(dateISO);
  const day = source.getUTCDate();
  const target = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateOnly(target);
}

/** Advance by one or more billing cycles, keeping month-end dates sensible. */
export function addBillingCycle(dateISO, billingCycle, steps = 1) {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError('Billing-cycle steps must be a positive whole number.');
  }

  switch (billingCycle) {
    case 'weekly':
      return addDays(dateISO, steps * 7);
    case 'monthly':
      return addMonthsClamped(dateISO, steps);
    case 'yearly':
      return addMonthsClamped(dateISO, steps * 12);
    default:
      throw new RangeError(`Unknown recurring billing cycle: ${billingCycle}`);
  }
}

/** Return the first renewal on or after a reference date. */
export function nextRenewalOnOrAfter(anchorISO, billingCycle, referenceISO) {
  parseDateOnly(anchorISO);
  parseDateOnly(referenceISO);

  if (anchorISO >= referenceISO) {
    return anchorISO;
  }

  for (let step = 1; step <= 100_000; step += 1) {
    const candidate = addBillingCycle(anchorISO, billingCycle, step);
    if (candidate >= referenceISO) {
      return candidate;
    }
  }

  throw new RangeError('Could not calculate the next renewal date.');
}

/** Whole calendar days from `fromISO` to `toISO`. Can be negative. */
export function daysBetween(fromISO, toISO) {
  const from = parseDateOnly(fromISO);
  const to = parseDateOnly(toISO);
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Calculate a trial's deadline and current phase.
 *
 * A 7-day trial beginning October 1 includes October 1 through October 7.
 * October 7 is the last safe day to cancel; billing starts October 8.
 */
export function computeTrial({
  startDate,
  trialDays,
  reminderDays = 3,
  status = 'active',
  today = todayISO(),
}) {
  if (!Number.isInteger(trialDays) || trialDays < 1) {
    throw new RangeError('Trial length must be a whole number of at least 1 day.');
  }
  if (!Number.isInteger(reminderDays) || reminderDays < 0) {
    throw new RangeError('Reminder lead time must be a non-negative whole number.');
  }
  if (status !== 'active' && status !== 'canceled') {
    throw new RangeError('Trial status must be active or canceled.');
  }

  parseDateOnly(startDate);
  parseDateOnly(today);

  const cancelByDate = addDays(startDate, trialDays - 1);
  const billingDate = addDays(cancelByDate, 1);
  const unboundedReminderDate = addDays(cancelByDate, -reminderDays);
  const reminderDate =
    daysBetween(startDate, unboundedReminderDate) < 0
      ? startDate
      : unboundedReminderDate;

  const daysUntilCancelBy = daysBetween(today, cancelByDate);
  const daysUntilBilling = daysBetween(today, billingDate);
  const isCanceled = status === 'canceled';

  let phase;
  if (isCanceled) {
    phase = 'canceled';
  } else if (daysBetween(today, startDate) > 0) {
    phase = 'upcoming';
  } else if (daysUntilCancelBy < 0) {
    phase = 'ended';
  } else if (daysUntilCancelBy === 0) {
    phase = 'last-day';
  } else if (daysUntilCancelBy <= 3) {
    phase = 'ending-soon';
  } else {
    phase = 'active';
  }

  return {
    kind: 'trial',
    startDate,
    cancelByDate,
    billingDate,
    reminderDate,
    daysUntilCancelBy,
    daysUntilBilling,
    daysRemaining: Math.max(0, daysUntilCancelBy + 1),
    phase,
    isCanceled,
    isOverdue: !isCanceled && daysUntilCancelBy < 0,
    isWithinReminderWindow:
      !isCanceled && today >= reminderDate && daysUntilCancelBy >= 0,
  };
}

/**
 * Calculate an ongoing subscription's next future renewal and reminder.
 * The stored renewal date is an anchor; once it passes, later occurrences are
 * derived from that same anchor so month-end and leap-day billing stays usable.
 */
export function computeSubscription({
  renewalDate,
  billingCycle = 'monthly',
  reminderDays = 3,
  status = 'active',
  today = todayISO(),
}) {
  if (!['weekly', 'monthly', 'yearly'].includes(billingCycle)) {
    throw new RangeError('Subscription billing must be weekly, monthly, or yearly.');
  }
  if (!Number.isInteger(reminderDays) || reminderDays < 0) {
    throw new RangeError('Reminder lead time must be a non-negative whole number.');
  }
  if (status !== 'active' && status !== 'canceled') {
    throw new RangeError('Subscription status must be active or canceled.');
  }

  parseDateOnly(renewalDate);
  parseDateOnly(today);

  const nextRenewalDate = nextRenewalOnOrAfter(
    renewalDate,
    billingCycle,
    today,
  );
  const reminderDate = addDays(nextRenewalDate, -reminderDays);
  const daysUntilRenewal = daysBetween(today, nextRenewalDate);
  const isCanceled = status === 'canceled';
  const isWithinReminderWindow = !isCanceled && today >= reminderDate;

  let phase;
  if (isCanceled) {
    phase = 'canceled';
  } else if (daysUntilRenewal === 0) {
    phase = 'renews-today';
  } else if (isWithinReminderWindow) {
    phase = 'renewing-soon';
  } else {
    phase = 'subscribed';
  }

  return {
    kind: 'subscription',
    renewalDate,
    nextRenewalDate,
    reminderDate,
    daysUntilRenewal,
    daysRemaining: daysUntilRenewal,
    phase,
    isCanceled,
    isOverdue: false,
    isWithinReminderWindow,
  };
}

export function monthlyEquivalentCents(costCents, billingCycle) {
  if (!Number.isInteger(costCents) || costCents < 0) {
    throw new RangeError('Cost must be a non-negative whole number of cents.');
  }

  switch (billingCycle) {
    case 'monthly':
      return costCents;
    case 'yearly':
      return Math.round(costCents / 12);
    case 'weekly':
      return Math.round((costCents * 52) / 12);
    case 'one-time':
      return 0;
    default:
      throw new RangeError(`Unknown billing cycle: ${billingCycle}`);
  }
}
