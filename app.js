import {
  computeSubscription,
  computeTrial,
  daysBetween,
  monthlyEquivalentCents,
  parseDateOnly,
  todayISO,
} from './lib/dates.js';
import {
  BILLING_CYCLE_SUFFIXES,
  DATA_VERSION,
  MAX_ENTRIES,
  NOTIFICATION_LOG_KEY,
  STORAGE_KEY,
  TrialValidationError,
  createTrialRecord,
  formatUsd,
  mergeTrials,
  parseCSVBackup,
  parseJSONBackup,
  prepareTrials,
  serializeJSONBackup,
  trialsToCSV,
} from './lib/data.js';
import { buildReminderCalendar } from './lib/ics.js';

const ICONS = Object.freeze({
  bell: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7-2.5 8.5h17C20.5 16 18 16 18 9Z" />
      <path d="M9.5 21h5" />
    </svg>`,
  check: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.2 4.2L19 6.8" />
    </svg>`,
  undo: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8v5h5" />
      <path d="M5.5 12.5A7 7 0 1 1 12 19" />
    </svg>`,
  edit: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 20 4.2-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
      <path d="m13.7 7.5 3 3" />
    </svg>`,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>`,
  external: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>`,
  alert: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8v5M12 16.5v.2" />
      <path d="M10.3 4.2 3.6 16.1A2 2 0 0 0 5.3 19h13.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    </svg>`,
  calendar: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </svg>`,
  plus: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>`,
});

const PHASE_META = Object.freeze({
  upcoming: { label: 'Upcoming', tone: 'upcoming' },
  active: { label: 'In trial', tone: 'calm' },
  'ending-soon': { label: 'Ends soon', tone: 'warn' },
  'last-day': { label: 'Last day', tone: 'danger' },
  ended: { label: 'Trial ended', tone: 'danger' },
  subscribed: { label: 'Subscribed', tone: 'calm' },
  'renewing-soon': { label: 'Renews soon', tone: 'warn' },
  'renews-today': { label: 'Renews today', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'canceled' },
});

const BILLING_RHYTHM = Object.freeze({
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
  'one-time': 'Once',
});

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const NOTIFICATION_LOG_LIMIT = 500;

const state = {
  trials: [],
  filter: 'all',
  search: '',
  editingId: null,
  pendingImport: null,
  installPrompt: null,
  swRegistration: null,
  notificationCheckRunning: false,
  storageOk: true,
  today: todayISO(),
};

let els = null;
let confirmResolver = null;

function byId(id) {
  return document.getElementById(id);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined && text !== null) {
    element.textContent = text;
  }
  return element;
}

function makeIcon(name) {
  const template = document.createElement('template');
  template.innerHTML = ICONS[name];
  return template.content.firstElementChild;
}

function makeButton(label, className, action, trialId, iconName, compact = false) {
  const button = makeElement('button', className);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = trialId;
  if (iconName) {
    button.append(makeIcon(iconName));
  }
  if (label) {
    const labelElement = makeElement('span', '', label);
    button.append(labelElement);
    if (!compact) {
      button.setAttribute('aria-label', label);
    }
  }
  return button;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function includeYear(dateISO) {
  return dateISO.slice(0, 4) !== state.today.slice(0, 4);
}

function formatDateLong(dateISO) {
  const options = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  };
  if (includeYear(dateISO)) {
    options.year = 'numeric';
  }
  return new Intl.DateTimeFormat('en-US', options).format(parseDateOnly(dateISO));
}

function formatDateShort(dateISO) {
  const options = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (includeYear(dateISO)) {
    options.year = 'numeric';
  }
  return new Intl.DateTimeFormat('en-US', options).format(parseDateOnly(dateISO));
}

function formatTimestampShort(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = 'numeric';
  }
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function formatTodayLabel(dateISO) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(dateISO));
}

function formatTrialPrice(trial, fallback = 'No price set') {
  if (!trial.costCents) {
    return fallback;
  }
  return `${formatUsd(trial.costCents)}${BILLING_CYCLE_SUFFIXES[trial.billingCycle]}`;
}

function isSubscription(trial) {
  return trial.kind === 'subscription';
}

function kindNoun(trial) {
  return isSubscription(trial) ? 'subscription' : 'trial';
}

function cancelWindowText(details) {
  if (details.kind === 'subscription') {
    if (details.daysUntilRenewal === 0) {
      return 'Today';
    }
    return `in ${plural(details.daysUntilRenewal, 'day')}`;
  }
  if (details.daysUntilCancelBy < 0) {
    const days = Math.abs(details.daysUntilCancelBy);
    return `${plural(days, 'day')} overdue`;
  }
  if (details.daysUntilCancelBy === 0) {
    return 'Today';
  }
  return `${plural(details.daysUntilCancelBy, 'day')} left`;
}

function dueDateFor(details) {
  return details.kind === 'subscription'
    ? details.nextRenewalDate
    : details.cancelByDate;
}

function daysUntilDue(details) {
  return details.kind === 'subscription'
    ? details.daysUntilRenewal
    : details.daysUntilCancelBy;
}

function isDueToday(details) {
  return daysUntilDue(details) === 0;
}

function trialDetails(trial) {
  if (isSubscription(trial)) {
    return computeSubscription({
      renewalDate: trial.renewalDate,
      billingCycle: trial.billingCycle,
      reminderDays: trial.reminderDays,
      status: trial.status,
      today: state.today,
    });
  }
  return computeTrial({
    startDate: trial.startDate,
    trialDays: trial.trialDays,
    reminderDays: trial.reminderDays,
    status: trial.status,
    today: state.today,
  });
}

function detailsForAll(trials = state.trials) {
  return trials.map((trial) => ({
    trial,
    details: trialDetails(trial),
  }));
}

function findTrial(id) {
  return state.trials.find((trial) => trial.id === id) ?? null;
}

function setupElements() {
  els = {
    welcome: byId('welcome-section'),
    welcomeSteps: byId('welcome-steps'),
    dashboard: byId('dashboard-section'),
    todayLabel: byId('today-label'),
    dashboardSummary: byId('dashboard-summary'),
    dashboardTitle: document.querySelector('.dashboard__title'),
    saveStatus: byId('save-status'),
    saveStatusText: byId('save-status-text'),
    nextDeadlineCard: byId('next-deadline-card'),
    nextDeadlineLabel: byId('next-deadline-label'),
    nextDeadlineValue: byId('next-deadline-value'),
    nextDeadlineNote: byId('next-deadline-note'),
    openTrialsValue: byId('open-trials-value'),
    openTrialsNote: byId('open-trials-note'),
    monthlyCostValue: byId('monthly-cost-value'),
    monthlyCostNote: byId('monthly-cost-note'),
    reminderAlerts: byId('reminder-alerts'),
    trialsCount: byId('trials-count'),
    searchInput: byId('search-input'),
    trialsList: byId('trials-list'),
    filterChips: [...document.querySelectorAll('[data-filter]')],
    filterCounts: [...document.querySelectorAll('[data-count]')],
    listEmpty: byId('list-empty'),
    listEmptyTitle: byId('list-empty-title'),
    listEmptyCopy: byId('list-empty-copy'),
    listEmptyAdd: byId('list-empty-add'),
    addTrialButton: byId('add-trial-button'),
    welcomeAddButton: byId('welcome-add-button'),
    remindersButton: byId('reminders-button'),
    notificationDot: byId('notification-dot'),
    dataButton: byId('data-button'),
    dataNoteButton: byId('backup-note-button'),
    trialDialog: byId('trial-dialog'),
    trialForm: byId('trial-form'),
    trialDialogEyebrow: byId('trial-dialog-eyebrow'),
    trialDialogTitle: byId('trial-dialog-title'),
    saveTrialButton: byId('save-trial-button'),
    formAlert: byId('form-alert'),
    trialSchedule: byId('trial-schedule'),
    subscriptionSchedule: byId('subscription-schedule'),
    kindRadios: [...document.querySelectorAll('input[name="kind"]')],
    previewLabel: byId('preview-label'),
    previewCancelDate: byId('preview-cancel-date'),
    previewBillingDate: byId('preview-billing-date'),
    costLabel: byId('cost-label'),
    costHint: byId('cost-hint'),
    cancelUrlLabel: byId('cancel-url-label'),
    cancelUrlHint: byId('cancel-url-hint'),
    reminderDayOption: byId('reminder-day-option'),
    oneTimeOption: byId('one-time-option'),
    formFootnote: byId('form-footnote'),
    notesCount: byId('notes-count'),
    quickDaysButtons: [...document.querySelectorAll('[data-days]')],
    remindersDialog: byId('reminders-dialog'),
    notificationStatusCard: byId('reminder-status-card'),
    notificationStatusTitle: byId('notification-status-title'),
    notificationStatusText: byId('notification-status-text'),
    enableNotifications: byId('enable-notifications'),
    sendTestNotification: byId('send-test-notification'),
    downloadCalendarButton: byId('download-calendar-button'),
    dataDialog: byId('data-dialog'),
    backupSummary: byId('backup-summary'),
    exportButtons: [...document.querySelectorAll('[data-export]')],
    eraseDataButton: byId('erase-data-button'),
    installButton: byId('install-button'),
    installDialogButton: byId('install-dialog-button'),
    importFile: byId('import-file'),
    chooseImportFile: byId('choose-import-file'),
    importFileName: byId('import-file-name'),
    importPanel: byId('import-panel'),
    importMessage: byId('import-message'),
    importPreviewList: byId('import-preview-list'),
    importMode: byId('import-mode'),
    applyImport: byId('apply-import'),
    importErrors: byId('import-errors'),
    aboutDialog: byId('about-dialog'),
    confirmDialog: byId('confirm-dialog'),
    confirmTitle: byId('confirm-title'),
    confirmMessage: byId('confirm-message'),
    confirmCancel: byId('confirm-cancel'),
    confirmAction: byId('confirm-action'),
    toastRegion: byId('toast-region'),
  };

  els.dashboardTitle.setAttribute('tabindex', '-1');
}

function showToast(message, { error = false, timeout = 4600 } = {}) {
  const toast = makeElement('div', `toast${error ? ' toast--error' : ''}`);
  toast.append(makeIcon(error ? 'alert' : 'check'));
  toast.append(makeElement('span', '', message));
  els.toastRegion.append(toast);

  while (els.toastRegion.children.length > 3) {
    els.toastRegion.firstElementChild.remove();
  }

  window.setTimeout(() => {
    if (!toast.isConnected) {
      return;
    }
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 220);
  }, timeout);
}

function todayForStorage() {
  return todayISO();
}

function loadTrials() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    state.storageOk = false;
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.trials)
    ) {
      throw new Error('Unexpected saved data shape.');
    }
    if (parsed.version !== DATA_VERSION) {
      throw new Error('Unsupported saved data version.');
    }
    if (parsed.trials.length === 0) {
      return [];
    }
    return prepareTrials(parsed.trials, {
      nowIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trialwise could not read saved items.', error);
    showToast(
      'Saved items could not be read. The existing browser copy was left untouched.',
      { error: true, timeout: 9000 },
    );
    return null;
  }
}

function persistTrials() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: DATA_VERSION, trials: state.trials }),
    );
    state.storageOk = true;
    updateSaveStatus();
    return true;
  } catch (error) {
    console.error('Trialwise could not save to local storage.', error);
    state.storageOk = false;
    updateSaveStatus();
    return false;
  }
}

function updateSaveStatus() {
  if (!els) {
    return;
  }
  els.saveStatus.classList.toggle('is-error', !state.storageOk);
  els.saveStatusText.textContent = state.storageOk
    ? 'Saved only on this device'
    : 'Storage blocked — not saved';
}

function readNotificationLog() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NOTIFICATION_LOG_KEY) ?? '{}',
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeNotificationLog(log) {
  const entries = Object.entries(log)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, NOTIFICATION_LOG_LIMIT);
  try {
    localStorage.setItem(
      NOTIFICATION_LOG_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Notification delivery already succeeded; the log is a duplicate guard only.
  }
}

function sortForBoard(entries) {
  return [...entries].sort((a, b) => {
    const aCanceled = a.trial.status === 'canceled';
    const bCanceled = b.trial.status === 'canceled';

    if (aCanceled !== bCanceled) {
      return aCanceled ? 1 : -1;
    }
    if (aCanceled && bCanceled) {
      return String(b.trial.canceledAt ?? '').localeCompare(
        String(a.trial.canceledAt ?? ''),
      );
    }

    const byDeadline = dueDateFor(a.details).localeCompare(
      dueDateFor(b.details),
    );
    if (byDeadline !== 0) {
      return byDeadline;
    }
    return a.trial.name.localeCompare(b.trial.name, 'en', {
      sensitivity: 'base',
    });
  });
}

function updateFilterCounts() {
  const counts = {
    all: state.trials.length,
    open: state.trials.filter((trial) => trial.status !== 'canceled').length,
    canceled: state.trials.filter((trial) => trial.status === 'canceled').length,
  };

  for (const element of els.filterCounts) {
    element.textContent = String(counts[element.dataset.count] ?? 0);
  }

  for (const chip of els.filterChips) {
    const active = chip.dataset.filter === state.filter;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  }
}

function getVisibleTrials() {
  const query = state.search.trim().toLowerCase();

  return state.trials.filter((trial) => {
    if (state.filter === 'open' && trial.status === 'canceled') {
      return false;
    }
    if (state.filter === 'canceled' && trial.status !== 'canceled') {
      return false;
    }
    if (!query) {
      return true;
    }
    return [trial.name, trial.notes, trial.cancelUrl, trial.kind]
      .join('\n')
      .toLowerCase()
      .includes(query);
  });
}

function emptyStateForResults() {
  if (state.search.trim()) {
    return {
      title: 'Nothing matches',
      copy: `No trials or subscriptions match “${state.search.trim()}”.`,
      action: 'Clear search',
    };
  }
  if (state.filter === 'canceled') {
    return {
      title: 'No canceled items yet',
      copy: 'Anything you mark canceled will stay here for your records.',
      action: 'View open items',
    };
  }
  if (state.filter === 'open') {
    return {
      title: 'Nothing open right now',
      copy: 'Every item on your watchlist is marked canceled.',
      action: 'View all items',
    };
  }
  return {
    title: 'No items here',
    copy: 'Try another filter or add a trial or subscription.',
    action: 'Add an item',
  };
}

function renderTrialList() {
  updateFilterCounts();

  const visible = sortForBoard(detailsForAll(getVisibleTrials()));
  els.trialsList.replaceChildren();

  for (const { trial, details } of visible) {
    els.trialsList.append(createTrialCard(trial, details));
  }

  els.trialsList.hidden = visible.length === 0;
  els.listEmpty.hidden = visible.length > 0;

  const total = state.trials.length;
  if (visible.length === total && state.filter === 'all' && !state.search.trim()) {
    els.trialsCount.textContent =
      total === 0 ? 'No items yet.' : `${plural(total, 'item')} on your watchlist.`;
  } else {
    els.trialsCount.textContent = `Showing ${visible.length} of ${plural(total, 'item')}.`;
  }

  if (visible.length === 0) {
    const empty = emptyStateForResults();
    els.listEmptyTitle.textContent = empty.title;
    els.listEmptyCopy.textContent = empty.copy;
    els.listEmptyAdd.textContent = empty.action;
  }
}

function createTrialCard(trial, details) {
  const subscription = isSubscription(trial);
  const meta = PHASE_META[details.phase] ?? PHASE_META.active;
  const card = makeElement(
    'article',
    `trial-card trial-card--${meta.tone}`,
  );
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', trial.name);

  const top = makeElement('div', 'trial-card__top');
  const status = makeElement('span', 'status-chip');
  status.append(makeElement('span', 'status-chip__dot'));
  status.append(document.createTextNode(meta.label));

  let topNote = '';
  if (trial.status === 'canceled' && trial.canceledAt) {
    topNote = `Canceled ${formatTimestampShort(trial.canceledAt)}`;
  } else if (subscription) {
    topNote = `${BILLING_RHYTHM[trial.billingCycle]} · next ${formatDateShort(
      details.nextRenewalDate,
    )}`;
  } else {
    topNote = `Started ${formatDateShort(trial.startDate)} · ${plural(
      trial.trialDays,
      'day',
    )}`;
  }

  top.append(status, makeElement('span', 'trial-card__top-note', topNote));

  const name = makeElement('h3', 'trial-card__name', trial.name);

  const deadline = makeElement('div', 'trial-card__deadline');
  let kicker;
  if (subscription) {
    kicker =
      trial.status === 'canceled'
        ? 'Renewal date on file'
        : 'Next renewal';
  } else if (trial.status === 'canceled') {
    kicker = 'Cancel-by date';
  } else if (details.phase === 'ended') {
    kicker = 'Cancel-by passed';
  } else {
    kicker = 'Cancel by';
  }
  deadline.append(makeElement('p', 'deadline-kicker', kicker));

  const deadlineRow = makeElement('div', 'deadline-row');
  const dueDate =
    subscription && trial.status === 'canceled'
      ? trial.renewalDate
      : dueDateFor(details);
  const date = makeElement('time', 'deadline-date', formatDateLong(dueDate));
  date.dateTime = dueDate;
  const badgeText =
    trial.status === 'canceled'
      ? 'Handled'
      : cancelWindowText(details);
  deadlineRow.append(date, makeElement('span', 'countdown-badge', badgeText));
  deadline.append(deadlineRow);

  const facts = makeElement('div', 'trial-facts');

  const priceFact = makeElement('div', 'trial-fact');
  priceFact.append(
    makeElement('span', '', subscription ? 'Renewal price' : 'After trial'),
  );
  priceFact.append(makeElement('strong', '', formatTrialPrice(trial)));

  const billingFact = makeElement('div', 'trial-fact');
  if (subscription) {
    billingFact.append(makeElement('span', '', 'Billing rhythm'));
    billingFact.append(
      makeElement('strong', '', BILLING_RHYTHM[trial.billingCycle]),
    );
  } else {
    billingFact.append(
      makeElement(
        'span',
        '',
        trial.status === 'canceled' ? 'Would have billed' : 'Billing begins',
      ),
    );
    billingFact.append(
      makeElement('strong', '', formatDateShort(details.billingDate)),
    );
  }
  facts.append(priceFact, billingFact);

  const reminder = makeElement('p', 'trial-reminder');
  let reminderIcon = 'bell';
  let reminderText = '';

  if (trial.status === 'canceled') {
    reminderIcon = 'check';
    reminderText = `Reminders are off for this ${kindNoun(trial)}.`;
  } else if (subscription && details.daysUntilRenewal === 0) {
    reminderText = 'Renewal day is here. Review the charge if you no longer need it.';
  } else if (!subscription && details.isOverdue) {
    reminderIcon = 'alert';
    reminderText = 'Cancellation window closed. Check your account.';
  } else if (!subscription && details.daysUntilCancelBy === 0) {
    reminderText = 'Reminder due today — this is the last safe day.';
  } else if (details.isWithinReminderWindow) {
    reminderText = subscription
      ? `Renewal reminder due now. Renews ${formatDateShort(
          details.nextRenewalDate,
        )}.`
      : `Reminder due now. Cancel by ${formatDateShort(
          details.cancelByDate,
        )}.`;
  } else {
    reminderText = `Nudge scheduled for ${formatDateShort(details.reminderDate)}.`;
  }
  reminder.append(makeIcon(reminderIcon), document.createTextNode(reminderText));

  card.append(top, name, deadline, facts);

  if (!subscription && trial.status !== 'canceled') {
    const elapsed = Math.min(
      trial.trialDays,
      Math.max(0, daysBetween(trial.startDate, state.today) + 1),
    );
    const progressWrap = makeElement('div', 'trial-progress');
    const progress = makeElement('progress');
    progress.max = trial.trialDays;
    progress.value =
      details.phase === 'ended' ? trial.trialDays : elapsed;
    progress.setAttribute(
      'aria-label',
      `Trial progress: day ${elapsed} of ${trial.trialDays}`,
    );
    const caption = makeElement('p', 'progress-caption');
    let left = '';
    let right = '';

    if (details.phase === 'upcoming') {
      left = `Starts ${formatDateShort(trial.startDate)}`;
      right = `${plural(trial.trialDays, 'day')} long`;
    } else if (details.phase === 'ended') {
      left = 'Trial window closed';
      right = `Ended ${formatDateShort(details.cancelByDate)}`;
    } else {
      left = `Day ${Math.max(1, elapsed)} of ${trial.trialDays}`;
      right = `${plural(Math.max(0, details.daysRemaining), 'day')} remaining`;
    }

    caption.append(makeElement('span', '', left), makeElement('span', '', right));
    progressWrap.append(progress, caption);
    card.append(progressWrap);
  }

  card.append(reminder);

  if (trial.notes) {
    card.append(makeElement('p', 'trial-note', trial.notes));
  }

  const actions = makeElement('div', 'trial-card__actions');

  if (trial.cancelUrl) {
    const accountLink = makeElement(
      'a',
      'button button--soft button--tiny',
    );
    accountLink.href = trial.cancelUrl;
    accountLink.target = '_blank';
    accountLink.rel = 'noopener noreferrer';
    accountLink.setAttribute(
      'aria-label',
      subscription
        ? `Open account page for ${trial.name} in a new tab`
        : `Open cancellation page for ${trial.name} in a new tab`,
    );
    accountLink.append(
      makeIcon('external'),
      makeElement('span', '', subscription ? 'Manage page' : 'Cancel page'),
    );
    actions.append(accountLink);
  }

  actions.append(makeButton('Edit', 'button button--quiet button--tiny', 'edit', trial.id, 'edit'));

  if (trial.status === 'canceled') {
    actions.append(
      makeButton(
        'Restore',
        'button button--quiet button--tiny',
        'restore',
        trial.id,
        'undo',
      ),
    );
  } else {
    actions.append(
      makeButton(
        'Mark canceled',
        'button button--quiet button--tiny',
        'cancel',
        trial.id,
        'check',
      ),
    );
  }

  actions.append(makeElement('span', 'card-spacer'));

  const deleteButton = makeButton(
    '',
    'card-icon-button card-icon-button--danger',
    'delete',
    trial.id,
    'trash',
  );
  deleteButton.setAttribute('aria-label', `Delete ${trial.name}`);
  deleteButton.title = `Delete ${trial.name}`;
  actions.append(deleteButton);

  card.append(actions);
  return card;
}

function renderSummary() {
  const open = detailsForAll(
    state.trials.filter((trial) => trial.status !== 'canceled'),
  ).sort((a, b) => dueDateFor(a.details).localeCompare(dueDateFor(b.details)));
  const canceled = state.trials.length - open.length;
  const openTrials = open.filter(({ trial }) => !isSubscription(trial));
  const openSubscriptions = open.filter(({ trial }) => isSubscription(trial));

  els.openTrialsValue.textContent = String(open.length);

  const withinSeven = open.filter(({ details }) => {
    const days = daysUntilDue(details);
    return days >= 0 && days <= 7;
  }).length;

  if (open.length === 0) {
    els.openTrialsNote.textContent =
      canceled > 0
        ? `${plural(canceled, 'canceled item')} kept in your records.`
        : 'Add a trial or subscription to get started.';
  } else if (withinSeven > 0) {
    els.openTrialsNote.textContent = `${plural(
      withinSeven,
      'date',
    )} within the next 7 days.`;
  } else {
    els.openTrialsNote.textContent = 'No deadlines in the next 7 days.';
  }

  const recurring = open.filter(({ trial }) => trial.billingCycle !== 'one-time');
  const monthlyTotal = recurring.reduce(
    (sum, { trial }) =>
      sum + monthlyEquivalentCents(trial.costCents, trial.billingCycle),
    0,
  );
  els.monthlyCostValue.textContent = formatUsd(monthlyTotal);
  if (monthlyTotal === 0) {
    els.monthlyCostNote.textContent = 'No recurring prices added yet.';
  } else {
    els.monthlyCostNote.textContent = `Across ${plural(
      recurring.length,
      'open recurring plan',
    )}.`;
  }

  els.nextDeadlineCard.classList.remove('summary-card--late');
  const overdue = open
    .filter(({ details }) => details.isOverdue)
    .sort((a, b) => b.details.cancelByDate.localeCompare(a.details.cancelByDate));
  const next = overdue[0] ?? open[0] ?? null;
  const nextLabel =
    open.length === 0
      ? 'Next deadline'
      : openSubscriptions.length === 0
        ? 'Next cancel-by'
        : openTrials.length === 0
          ? 'Next renewal'
          : 'Next deadline';

  if (!next) {
    els.nextDeadlineLabel.textContent = nextLabel;
    els.nextDeadlineValue.textContent = '—';
    els.nextDeadlineNote.textContent =
      'Add a trial or subscription to start tracking.';
  } else if (next.details.isOverdue) {
    els.nextDeadlineLabel.textContent = 'Past cancel-by';
    els.nextDeadlineCard.classList.add('summary-card--late');
    els.nextDeadlineValue.textContent = formatDateShort(next.details.cancelByDate);
    els.nextDeadlineNote.textContent = `${next.trial.name} · ${cancelWindowText(
      next.details,
    )}.`;
  } else {
    els.nextDeadlineLabel.textContent = nextLabel;
    els.nextDeadlineValue.textContent = formatDateShort(
      dueDateFor(next.details),
    );
    els.nextDeadlineNote.textContent = `${next.trial.name} · ${cancelWindowText(
      next.details,
    )}.`;
  }

  els.todayLabel.textContent = formatTodayLabel(state.today);

  if (open.length === 0) {
    els.dashboardSummary.textContent =
      'Everything is handled. Add a trial or subscription whenever you are ready.';
  } else if (overdue.length > 0) {
    els.dashboardSummary.textContent = `${plural(
      open.length,
      'open item',
    )}. ${overdue.length > 1 ? 'Some cancel-by dates have' : 'A cancel-by date has'} passed — check the alerts below.`;
  } else {
    els.dashboardSummary.textContent = `${plural(
      open.length,
      'open item',
    )}. Next up: ${formatDateLong(dueDateFor(open[0].details))}.`;
  }
}

function namesForSummary(entries) {
  const names = entries.slice(0, 2).map(({ trial }) => trial.name);
  const remaining = entries.length - names.length;
  if (remaining > 0) {
    return `${names.join(', ')} and ${remaining} more`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return names[0] ?? 'An item';
}

function addReminderAlert({ variant, title, message, count }) {
  const alert = makeElement('article', `alert alert--${variant}`);
  const icon = makeElement('span', 'alert__icon');
  icon.append(makeIcon(variant === 'danger' ? 'alert' : 'bell'));

  const copy = makeElement('div', 'alert__copy');
  copy.append(makeElement('strong', '', title), makeElement('p', '', message));

  const action = makeElement('button', 'button button--outline button--tiny alert__action', 'Review items');
  action.type = 'button';
  action.dataset.review = 'true';
  action.setAttribute('aria-label', `Review ${plural(count, 'item')} needing attention`);

  alert.append(icon, copy, action);
  return alert;
}

function renderAlerts() {
  els.reminderAlerts.replaceChildren();
  const allOpen = detailsForAll(
    state.trials.filter((trial) => trial.status !== 'canceled'),
  );

  const overdue = allOpen
    .filter(
      ({ trial, details }) => !isSubscription(trial) && details.isOverdue,
    )
    .sort((a, b) => b.details.cancelByDate.localeCompare(a.details.cancelByDate));
  const lastDay = allOpen.filter(
    ({ trial, details }) =>
      !isSubscription(trial) && details.daysUntilCancelBy === 0,
  );
  const renewingToday = allOpen.filter(
    ({ trial, details }) =>
      isSubscription(trial) && details.daysUntilRenewal === 0,
  );

  if (overdue.length > 0) {
    els.reminderAlerts.append(
      addReminderAlert({
        variant: 'danger',
        title:
          overdue.length === 1
            ? 'A cancel-by window has passed'
            : `${overdue.length} cancel-by windows have passed`,
        message: `${namesForSummary(overdue)} ${
          overdue.length === 1 ? 'is' : 'are'
        } past the safe cancellation window. Check your account, then mark it canceled or update the dates.`,
        count: overdue.length,
      }),
    );
  }

  if (lastDay.length > 0) {
    els.reminderAlerts.append(
      addReminderAlert({
        variant: 'warning',
        title:
          lastDay.length === 1
            ? 'Today is the last safe day to cancel'
            : `Today is the last safe day for ${lastDay.length} trials`,
        message: `Cancel ${namesForSummary(lastDay)} today to avoid the next charge.`,
        count: lastDay.length,
      }),
    );
  }

  if (renewingToday.length > 0) {
    els.reminderAlerts.append(
      addReminderAlert({
        variant: 'warning',
        title:
          renewingToday.length === 1
            ? 'A subscription renews today'
            : `${renewingToday.length} subscriptions renew today`,
        message: `${namesForSummary(renewingToday)} ${
          renewingToday.length === 1 ? 'has a renewal charge due today' : 'have renewal charges due today'
        }. Review before the next charge.`,
        count: renewingToday.length,
      }),
    );
  }

  if (overdue.length === 0 && lastDay.length === 0 && renewingToday.length === 0) {
    const due = allOpen
      .filter(
        ({ details }) =>
          details.isWithinReminderWindow && daysUntilDue(details) > 0,
      )
      .sort((a, b) =>
        dueDateFor(a.details).localeCompare(dueDateFor(b.details)),
      );

    if (due.length > 0) {
      const first = due[0];
      els.reminderAlerts.append(
        addReminderAlert({
          variant: 'warning',
          title:
            due.length === 1
              ? 'A reminder is due'
              : `${due.length} reminders are due`,
          message: `${namesForSummary(due)} ${
            due.length === 1 ? 'has a date' : 'have dates'
          } coming up. The earliest is ${formatDateLong(
            dueDateFor(first.details),
          )}.`,
          count: due.length,
        }),
      );
    }
  }
}

function renderNotificationIndicators() {
  const open = detailsForAll(
    state.trials.filter((trial) => trial.status !== 'canceled'),
  );
  const attention = open.filter(
    ({ details }) =>
      details.isOverdue ||
      details.isWithinReminderWindow ||
      isDueToday(details),
  ).length;

  els.notificationDot.hidden = attention === 0;
  els.remindersButton.setAttribute(
    'aria-label',
    attention
      ? `Reminder settings, ${plural(attention, 'item')} need attention`
      : 'Reminder settings',
  );

  document.title = state.trials.length
    ? `${attention ? `(${attention}) ` : ''}Trialwise — your watchlist`
    : 'Trialwise — trials and subscriptions, gently tracked';
}

function renderDashboard() {
  updateSaveStatus();
  renderSummary();
  renderAlerts();
  renderTrialList();
  renderNotificationIndicators();
}

function render() {
  state.today = todayForStorage();
  const hasTrials = state.trials.length > 0;
  els.welcome.hidden = hasTrials;
  els.welcomeSteps.hidden = hasTrials;
  els.dashboard.hidden = !hasTrials;

  if (hasTrials) {
    renderDashboard();
  } else {
    document.title = 'Trialwise — trials and subscriptions, gently tracked';
    updateFilterCounts();
    renderNotificationIndicators();
  }

  updateDataDialog();
  updateReminderPanel();
}

function reviewTrials() {
  state.filter = 'open';
  state.search = '';
  els.searchInput.value = '';
  render();
  els.trialsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const firstFocusable = els.trialsList.querySelector(
    'a, button, [tabindex="0"]',
  );
  firstFocusable?.focus({ preventScroll: true });
}

/* Trial form */

function clearFieldErrors() {
  els.formAlert.hidden = true;
  els.formAlert.textContent = '';
  els.trialForm.querySelectorAll('[data-error-for]').forEach((element) => {
    element.textContent = '';
  });
  els.trialForm.querySelectorAll('[aria-invalid="true"]').forEach((element) => {
    element.removeAttribute('aria-invalid');
  });
}

function showFormErrors(issues) {
  clearFieldErrors();
  const unplaced = [];
  let firstInvalid = null;

  for (const issue of issues) {
    const errorElement = els.trialForm.querySelector(
      `[data-error-for="${issue.field}"]`,
    );
    const inputName = issue.field === 'costCents' ? 'costAfterTrial' : issue.field;
    let input = els.trialForm.elements.namedItem(inputName);
    if (input && !(input instanceof HTMLElement)) {
      input = els.trialForm.querySelector(`input[name="${inputName}"]`);
    }

    if (errorElement instanceof HTMLElement) {
      errorElement.textContent = issue.message;
    } else {
      unplaced.push(issue.message);
    }

    if (input instanceof HTMLElement) {
      input.setAttribute('aria-invalid', 'true');
      firstInvalid ??= input;
    } else {
      unplaced.push(issue.message);
    }
  }

  const summary = unplaced.length
    ? unplaced[0]
    : 'Please check the highlighted fields and try again.';
  els.formAlert.textContent = summary;
  els.formAlert.hidden = false;
  firstInvalid?.focus();
}

function updateNotesCount() {
  const notes = els.trialForm.elements.namedItem('notes');
  els.notesCount.textContent = String(notes.value.length);
}

function formKind() {
  const selected = els.trialForm.querySelector('input[name="kind"]:checked');
  return selected?.value === 'subscription' ? 'subscription' : 'trial';
}

function updateFormCopy(kind) {
  const subscription = kind === 'subscription';
  const noun = subscription ? 'subscription' : 'trial';
  const editing = Boolean(state.editingId);

  els.trialDialogEyebrow.textContent = editing ? `Edit ${noun}` : `New ${noun}`;
  els.trialDialogTitle.textContent = editing
    ? `Update this ${noun}`
    : subscription
      ? 'Add a subscription'
      : 'Add a free trial';
  els.saveTrialButton.textContent = editing ? 'Save changes' : `Save ${noun}`;
  els.costLabel.textContent = subscription
    ? 'Renewal cost (USD)'
    : 'Cost after trial (USD)';
  els.costHint.textContent = subscription
    ? 'Leave blank if the price is unknown.'
    : 'Leave blank if there is no charge.';
  els.cancelUrlLabel.firstChild.nodeValue = subscription
    ? 'Manage page link '
    : 'Cancel page link ';
  els.cancelUrlHint.textContent = subscription
    ? 'The account page where you manage this plan.'
    : 'The account or cancellation page.';
  els.reminderDayOption.textContent = subscription
    ? 'On the renewal day'
    : 'On the cancel-by day';
  els.formFootnote.textContent = subscription
    ? 'Reminders repeat before each renewal.'
    : 'Cancel-by is the last day of the trial.';
  els.previewLabel.textContent = subscription
    ? 'Your next renewal'
    : 'Your safe cancellation window';
}

function applyFormKind() {
  const kind = formKind();
  const subscription = kind === 'subscription';
  const form = els.trialForm.elements;

  els.trialSchedule.hidden = subscription;
  els.subscriptionSchedule.hidden = !subscription;
  els.oneTimeOption.hidden = subscription;
  els.oneTimeOption.disabled = subscription;
  if (subscription && form.namedItem('billingCycle').value === 'one-time') {
    form.namedItem('billingCycle').value = 'monthly';
  }

  updateFormCopy(kind);
  updateDeadlinePreview();
}

function updateQuickDaySelection() {
  const days = els.trialForm.elements.namedItem('trialDays').value;
  for (const button of els.quickDaysButtons) {
    button.classList.toggle('is-active', button.dataset.days === days);
  }
}

function updateDeadlinePreview() {
  const form = els.trialForm.elements;
  const reminderDays = Number(form.namedItem('reminderDays').value);
  const billingCycle = form.namedItem('billingCycle').value;

  updateQuickDaySelection();

  if (formKind() === 'subscription') {
    const renewalDate = form.namedItem('renewalDate').value;
    try {
      const details = computeSubscription({
        renewalDate,
        billingCycle,
        reminderDays,
        today: state.today,
      });
      els.previewCancelDate.textContent = formatDateLong(
        details.nextRenewalDate,
      );
      const rolled =
        renewalDate < state.today ? ' Past date, so the next cycle is shown.' : '';
      const nudge =
        details.reminderDate >= state.today
          ? `Nudge on ${formatDateLong(details.reminderDate)}.`
          : 'The reminder window is already open.';
      els.previewBillingDate.textContent = `${nudge} Repeats ${BILLING_RHYTHM[
        billingCycle
      ].toLowerCase()}.${rolled}`;
    } catch {
      els.previewCancelDate.textContent = 'Choose the next renewal date';
      els.previewBillingDate.textContent =
        'Trialwise rolls the date forward as each cycle passes.';
    }
    return;
  }

  const startDate = form.namedItem('startDate').value;
  const trialDays = form.namedItem('trialDays').value;

  try {
    const details = computeTrial({
      startDate,
      trialDays: Number(trialDays),
      reminderDays,
      today: state.today,
    });
    els.previewCancelDate.textContent = formatDateLong(details.cancelByDate);
    els.previewBillingDate.textContent = `Billing begins ${formatDateLong(
      details.billingDate,
    )} unless canceled. Nudge on ${formatDateLong(details.reminderDate)}.`;
  } catch {
    els.previewCancelDate.textContent = 'Choose a start date and trial length';
    els.previewBillingDate.textContent =
      'Your cancel-by date will appear here as you type.';
  }
}

function setReminderOption(value) {
  const select = els.trialForm.elements.namedItem('reminderDays');
  const stringValue = String(value);

  if (![...select.options].some((option) => option.value === stringValue)) {
    const option = document.createElement('option');
    option.value = stringValue;
    option.textContent = `${stringValue} days before`;
    select.append(option);
  }
  select.value = stringValue;
}

function resetTrialForm() {
  els.trialForm.reset();
  els.trialForm.elements.namedItem('startDate').value = todayForStorage();
  els.trialForm.elements.namedItem('trialDays').value = '7';
  els.trialForm.elements.namedItem('renewalDate').value = '';
  setReminderOption(3);
  els.trialForm.elements.namedItem('billingCycle').value = 'monthly';
  clearFieldErrors();
  updateNotesCount();
  applyFormKind();
}

function openTrialDialog(trial = null) {
  if (!trial && state.trials.length >= MAX_ENTRIES) {
    showToast(`Trialwise supports up to ${MAX_ENTRIES} items.`, { error: true });
    return;
  }

  state.editingId = trial?.id ?? null;
  resetTrialForm();

  if (trial) {
    const form = els.trialForm.elements;
    const kind = isSubscription(trial) ? 'subscription' : 'trial';
    const kindRadio = els.kindRadios.find((radio) => radio.value === kind);
    if (kindRadio) {
      kindRadio.checked = true;
    }
    applyFormKind();

    form.namedItem('name').value = trial.name;
    if (isSubscription(trial)) {
      form.namedItem('renewalDate').value = trial.renewalDate;
    } else {
      form.namedItem('startDate').value = trial.startDate;
      form.namedItem('trialDays').value = String(trial.trialDays);
    }
    setReminderOption(trial.reminderDays);
    form.namedItem('costAfterTrial').value = trial.costCents
      ? (trial.costCents / 100).toFixed(2)
      : '';
    form.namedItem('billingCycle').value = trial.billingCycle;
    form.namedItem('cancelUrl').value = trial.cancelUrl;
    form.namedItem('notes').value = trial.notes;
  }

  updateFormCopy(formKind());
  updateNotesCount();
  updateDeadlinePreview();
  els.trialDialog.showModal();

  window.requestAnimationFrame(() => {
    els.trialForm.elements.namedItem('name').focus();
    els.trialDialog.querySelector('.modal__body').scrollTop = 0;
  });
}

function handleTrialSubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  const form = els.trialForm.elements;
  const values = {
    kind: formKind(),
    name: form.namedItem('name').value,
    startDate: form.namedItem('startDate').value,
    trialDays: form.namedItem('trialDays').value,
    renewalDate: form.namedItem('renewalDate').value,
    reminderDays: form.namedItem('reminderDays').value,
    costAfterTrial: form.namedItem('costAfterTrial').value,
    billingCycle: form.namedItem('billingCycle').value,
    cancelUrl: form.namedItem('cancelUrl').value,
    notes: form.namedItem('notes').value,
  };

  const existing = state.editingId ? findTrial(state.editingId) : null;
  if (state.editingId && !existing) {
    showToast('That item no longer exists. Close the form and try again.', {
      error: true,
    });
    return;
  }

  let record;
  try {
    record = createTrialRecord(
      {
        ...values,
        id: existing?.id,
        status: existing?.status ?? 'active',
        canceledAt: existing?.canceledAt ?? null,
        createdAt: existing?.createdAt,
      },
      { nowIso: new Date().toISOString() },
    );
  } catch (error) {
    if (error instanceof TrialValidationError) {
      showFormErrors(error.issues);
      return;
    }
    console.error(error);
    showFormErrors([
      { field: 'form', message: 'Something went wrong. Please try again.' },
    ]);
    return;
  }

  if (existing) {
    const index = state.trials.findIndex((trial) => trial.id === existing.id);
    state.trials[index] = record;
  } else {
    if (state.trials.length >= MAX_ENTRIES) {
      showToast(`Trialwise supports up to ${MAX_ENTRIES} items.`, {
        error: true,
      });
      return;
    }
    state.trials.push(record);
  }

  const saved = persistTrials();
  const wasFirst = !existing && state.trials.length === 1;
  state.editingId = null;
  els.trialDialog.close();
  render();

  if (wasFirst) {
    els.dashboardTitle.focus({ preventScroll: true });
  }

  const subscription = isSubscription(record);
  if (!saved) {
    showToast(
      'Saved for this session only. Browser storage is unavailable — download a backup before closing.',
      { error: true, timeout: 8000 },
    );
  } else if (existing) {
    showToast(`${subscription ? 'Subscription' : 'Trial'} updated.`);
  } else if (subscription) {
    const details = trialDetails(record);
    showToast(
      `Subscription saved. Next renewal ${formatDateLong(
        details.nextRenewalDate,
      )}.`,
    );
  } else {
    const details = trialDetails(record);
    showToast(`Trial saved. Cancel by ${formatDateLong(details.cancelByDate)}.`);
  }
}

function setTrialStatus(id, status) {
  const trial = findTrial(id);
  if (!trial) {
    return;
  }
  const wasCanceled = trial.status === 'canceled';
  const now = new Date().toISOString();
  Object.assign(trial, {
    status,
    canceledAt: status === 'canceled' ? now : null,
    updatedAt: now,
  });
  const saved = persistTrials();
  render();
  if (!saved) {
    showToast('Updated for this session, but browser storage is blocked.', {
      error: true,
    });
    return;
  }
  showToast(
    status === 'canceled'
      ? 'Marked canceled. The record is still here if you need it.'
      : wasCanceled
        ? 'Restored to open items.'
        : 'Item updated.',
  );
}

async function deleteTrial(id) {
  const trial = findTrial(id);
  if (!trial) {
    return;
  }
  const noun = kindNoun(trial);

  const confirmed = await confirmAction({
    title: `Delete ${trial.name}?`,
    message: `This removes the ${noun} from this browser. Download a backup first if you want to keep the record.`,
    confirmLabel: `Delete ${noun}`,
  });
  if (!confirmed) {
    return;
  }

  state.trials = state.trials.filter((item) => item.id !== id);
  const saved = persistTrials();
  render();
  showToast(
    saved
      ? `“${trial.name}” removed.`
      : 'Removed for this session, but browser storage is blocked.',
    { error: !saved },
  );
}

function handleTrialListClick(event) {
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) {
    return;
  }

  const { action, id } = actionButton.dataset;
  if (action === 'edit') {
    openTrialDialog(findTrial(id));
  } else if (action === 'cancel') {
    setTrialStatus(id, 'canceled');
  } else if (action === 'restore') {
    setTrialStatus(id, 'active');
  } else if (action === 'delete') {
    void deleteTrial(id);
  }
}

/* Confirmation */

function confirmAction({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
}) {
  return new Promise((resolve) => {
    if (els.confirmDialog.open) {
      els.confirmDialog.close('cancel');
    }

    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmAction.textContent = confirmLabel;
    els.confirmAction.className = danger
      ? 'button button--danger'
      : 'button button--primary';
    confirmResolver = resolve;
    els.confirmDialog.returnValue = 'cancel';
    els.confirmDialog.showModal();
    els.confirmCancel.focus();
  });
}

function resolveConfirmDialog() {
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(els.confirmDialog.returnValue === 'confirm');
}

/* Reminders and notifications */

function notificationsSupported() {
  return 'Notification' in window && window.isSecureContext;
}

function updateReminderPanel({ requesting = false } = {}) {
  if (!els) {
    return;
  }

  const supported = notificationsSupported();
  const calendarDisabled = state.trials.length === 0;
  els.downloadCalendarButton.disabled = calendarDisabled;
  els.notificationStatusCard.classList.remove('is-on', 'is-blocked');

  if (!supported) {
    els.notificationStatusTitle.textContent = 'Browser alerts are not available here';
    els.notificationStatusText.textContent =
      'In-app reminders and calendar export still work. Notifications need HTTPS or localhost and a supporting browser.';
    els.enableNotifications.hidden = true;
    els.sendTestNotification.hidden = true;
    return;
  }

  const permission = Notification.permission;
  els.sendTestNotification.hidden = permission !== 'granted';

  if (permission === 'granted') {
    els.notificationStatusCard.classList.add('is-on');
    els.notificationStatusTitle.textContent = 'Browser reminders are on';
    els.notificationStatusText.textContent =
      'Trialwise will send a system notification for due reminders while the app is running in the background.';
    els.enableNotifications.hidden = true;
    els.sendTestNotification.disabled = false;
  } else if (permission === 'denied') {
    els.notificationStatusCard.classList.add('is-blocked');
    els.notificationStatusTitle.textContent = 'Browser reminders are blocked';
    els.notificationStatusText.textContent =
      'Allow notifications for this site in your browser settings, then reopen Trialwise. Your board and calendar export still work.';
    els.enableNotifications.hidden = true;
    els.sendTestNotification.disabled = true;
  } else {
    els.notificationStatusTitle.textContent = 'Turn on browser reminders';
    els.notificationStatusText.textContent =
      'Get one system alert when a trial cancel-by or subscription renewal reminder comes due while Trialwise is open or running in the background.';
    els.enableNotifications.hidden = false;
    els.enableNotifications.textContent = requesting ? 'Asking…' : 'Turn on';
    els.enableNotifications.disabled = requesting;
    els.sendTestNotification.disabled = false;
  }
}

function ensureServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (state.swRegistration) {
    return Promise.resolve(state.swRegistration);
  }

  return navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      state.swRegistration = registration;
      return registration;
    })
    .catch((error) => {
      console.warn('Offline service worker could not register.', error);
      return null;
    });
}

function getServiceWorkerReady(timeoutMs = 3000) {
  if (!('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }

  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

async function showBrowserNotification(title, options) {
  if (!notificationsSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const registration =
    state.swRegistration ?? (await getServiceWorkerReady());
  if (registration?.showNotification) {
    try {
      await registration.showNotification(title, options);
      return true;
    } catch (error) {
      console.warn('Service worker notification failed.', error);
    }
  }

  try {
    const notification = new Notification(title, options);
    notification.addEventListener('click', () => {
      window.focus();
      notification.close();
    });
    return true;
  } catch (error) {
    console.warn('Browser notification failed.', error);
    return false;
  }
}

async function enableBrowserNotifications() {
  if (!notificationsSupported()) {
    showToast('This browser cannot show notifications here.', { error: true });
    return;
  }

  updateReminderPanel({ requesting: true });
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = 'denied';
  }

  updateReminderPanel();

  if (permission === 'granted') {
    const shown = await showBrowserNotification(
      'Trialwise reminders are on',
      {
        body: 'You will get a browser alert when a trial or subscription reminder is due and Trialwise is running in the background.',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: 'trialwise-test',
      },
    );
    showToast(
      shown
        ? 'Browser reminders are on.'
        : 'Permission is on, but this browser did not display the test.',
      { error: !shown },
    );
  } else if (permission === 'denied') {
    showToast(
      'Notifications were blocked. You can change that in your browser settings.',
      { error: true },
    );
  } else {
    showToast('Notification permission was not granted.');
  }
}

async function sendTestNotification() {
  const shown = await showBrowserNotification('Tiny reminder, friendly test', {
    body: 'This is what a Trialwise trial or renewal nudge looks like.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'trialwise-test',
  });
  showToast(
    shown
      ? 'Test notification sent.'
      : 'The browser could not show a notification. Check your system settings.',
    { error: !shown },
  );
}

async function maybeSendDueNotifications() {
  if (
    state.notificationCheckRunning ||
    !notificationsSupported() ||
    Notification.permission !== 'granted' ||
    document.visibilityState !== 'hidden'
  ) {
    return;
  }

  state.notificationCheckRunning = true;
  try {
    const log = readNotificationLog();
    const due = detailsForAll(
      state.trials.filter((trial) => trial.status !== 'canceled'),
    )
      .filter(({ details }) => details.isWithinReminderWindow)
      .filter(({ trial, details }) => {
        const key = `${trial.id}|${dueDateFor(details)}`;
        return !log[key];
      });

    if (due.length === 0) {
      return;
    }

    let delivered = false;

    if (due.length > 3) {
      delivered = await showBrowserNotification(
        `${due.length} reminders need attention`,
        {
          body: `${namesForSummary(due)} have trial or renewal dates coming up. Open Trialwise to review them.`,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: 'trialwise-due-summary',
          data: { url: new URL('./', window.location.href).href },
        },
      );
    } else {
      const results = await Promise.all(
        due.map(({ trial, details }) => {
          if (isSubscription(trial)) {
            return showBrowserNotification(
              details.daysUntilRenewal === 0
                ? `${trial.name} renews today`
                : `${trial.name} renews ${formatDateShort(
                    details.nextRenewalDate,
                  )}`,
              {
                body: `${formatDateLong(
                  details.nextRenewalDate,
                )} is the next renewal. Price: ${formatTrialPrice(
                  trial,
                  'not set',
                )}.`,
                icon: './icons/icon-192.png',
                badge: './icons/icon-192.png',
                tag: `trialwise-${trial.id}`,
                data: { url: new URL('./', window.location.href).href },
              },
            );
          }
          return showBrowserNotification(
            details.daysUntilCancelBy === 0
              ? `Last day to cancel ${trial.name}`
              : `Cancel ${trial.name} by ${formatDateShort(details.cancelByDate)}`,
            {
              body: `${formatDateLong(
                details.cancelByDate,
              )} is the last safe day. After the trial: ${formatTrialPrice(
                trial,
                'no price set',
              )}.`,
              icon: './icons/icon-192.png',
              badge: './icons/icon-192.png',
              tag: `trialwise-${trial.id}`,
              data: { url: new URL('./', window.location.href).href },
            },
          );
        }),
      );
      delivered = results.some(Boolean);
    }

    if (delivered) {
      const now = new Date().toISOString();
      for (const { trial, details } of due) {
        log[`${trial.id}|${dueDateFor(details)}`] = now;
      }
      writeNotificationLog(log);
    }
  } finally {
    state.notificationCheckRunning = false;
  }
}

/* Reminder calendar and backup files */

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadJsonBackup() {
  if (state.trials.length === 0) {
    showToast('Add a trial or subscription before downloading a backup.');
    return;
  }
  const content = serializeJSONBackup(state.trials, {
    exportedAt: new Date().toISOString(),
  });
  downloadTextFile(
    content,
    `trialwise-backup-${state.today}.json`,
    'application/json;charset=utf-8',
  );
  showToast('JSON backup downloaded.');
}

function downloadCsvBackup() {
  if (state.trials.length === 0) {
    showToast('Add a trial or subscription before downloading a spreadsheet.');
    return;
  }
  downloadTextFile(
    trialsToCSV(state.trials),
    `trialwise-data-${state.today}.csv`,
    'text/csv;charset=utf-8',
  );
  showToast('CSV spreadsheet downloaded.');
}

function downloadCalendar() {
  const calendar = buildReminderCalendar(state.trials, {
    today: state.today,
    generatedAt: new Date(),
  });

  if (calendar.eventCount === 0) {
    showToast('There are no upcoming open dates to add to a calendar.');
    return;
  }

  downloadTextFile(
    calendar.content,
    `trialwise-reminders-${state.today}.ics`,
    'text/calendar;charset=utf-8',
  );
  showToast('Calendar downloaded. Import it into your calendar app.');
}

/* Data dialog and imports */

function updateDataDialog() {
  if (!els) {
    return;
  }
  const open = state.trials.filter((trial) => trial.status !== 'canceled').length;
  const hasEntries = state.trials.length > 0;
  els.backupSummary.textContent = hasEntries
    ? `${plural(state.trials.length, 'item')} saved, ${open} open.`
    : 'No items saved yet.';
  for (const button of els.exportButtons) {
    button.disabled = !hasEntries;
  }
  els.eraseDataButton.disabled = !hasEntries;
}

function resetImportUi({ clearName = true } = {}) {
  state.pendingImport = null;
  els.importFile.value = '';
  if (clearName) {
    els.importFileName.textContent = 'No file chosen';
  }
  els.importPanel.hidden = true;
  els.importErrors.hidden = true;
  els.importErrors.replaceChildren();
  els.importMessage.textContent = '';
  els.importPreviewList.replaceChildren();
  const mergeRadio = els.importMode.querySelector('input[value="merge"]');
  if (mergeRadio) {
    mergeRadio.checked = true;
  }
  els.applyImport.disabled = true;
  els.applyImport.textContent = 'Import items';
}

function renderImportErrors(issues) {
  els.importErrors.replaceChildren();
  const heading = makeElement('strong', '', 'Could not import that file');
  els.importErrors.append(heading);
  const list = makeElement('ul');
  for (const issue of issues.slice(0, 10)) {
    list.append(makeElement('li', '', issue.message));
  }
  if (issues.length > 10) {
    list.append(
      makeElement('li', '', `And ${issues.length - 10} more issue(s).`),
    );
  }
  els.importErrors.append(list);
  els.importErrors.hidden = false;
}

function updateApplyImportLabel() {
  if (!state.pendingImport) {
    return;
  }
  const mode = els.importMode.querySelector('input[name="import-mode"]:checked')
    ?.value;
  const count = state.pendingImport.trials.length;
  els.applyImport.textContent =
    mode === 'replace'
      ? `Replace with ${plural(count, 'item')}`
      : `Import ${plural(count, 'item')}`;
}

function importPreviewDate(entry) {
  const details = trialDetails(entry);
  return isSubscription(entry)
    ? `Renews ${formatDateShort(details.nextRenewalDate)}`
    : `Cancel by ${formatDateShort(details.cancelByDate)}`;
}

function showImportPreview(trials, filename) {
  state.pendingImport = { trials, filename };
  els.importErrors.hidden = true;
  els.importErrors.replaceChildren();
  els.importMessage.textContent = `Found ${plural(
    trials.length,
    'item',
  )} in ${filename}.`;
  els.importPreviewList.replaceChildren();

  for (const trial of trials.slice(0, 3)) {
    const row = makeElement('div', 'import-preview-item');
    row.append(
      makeElement('span', '', trial.name),
      makeElement('span', '', importPreviewDate(trial)),
    );
    els.importPreviewList.append(row);
  }
  if (trials.length > 3) {
    els.importPreviewList.append(
      makeElement(
        'div',
        'import-preview-item',
        `+ ${plural(trials.length - 3, 'more item')}`,
      ),
    );
  }

  els.importPanel.hidden = false;
  els.applyImport.disabled = false;
  updateApplyImportLabel();
}

async function handleImportFile(file) {
  resetImportUi({ clearName: false });
  els.importFileName.textContent = file.name;

  if (file.size > IMPORT_MAX_BYTES) {
    renderImportErrors([
      { message: 'That file is larger than 5 MB. Choose a smaller backup.' },
    ]);
    return;
  }

  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'json' && extension !== 'csv') {
    renderImportErrors([
      { message: 'Choose a .json backup or a .csv spreadsheet.' },
    ]);
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch {
    renderImportErrors([
      { message: 'The file could not be read. Try choosing it again.' },
    ]);
    return;
  }

  try {
    const trials =
      extension === 'json'
        ? parseJSONBackup(text, { nowIso: new Date().toISOString() })
        : parseCSVBackup(text, { nowIso: new Date().toISOString() });
    showImportPreview(trials, file.name);
  } catch (error) {
    if (error instanceof TrialValidationError) {
      renderImportErrors(error.issues);
    } else {
      console.error(error);
      renderImportErrors([
        { message: 'That file could not be imported. Please check its format.' },
      ]);
    }
  } finally {
    els.importFile.value = '';
  }
}

async function applyImport() {
  if (!state.pendingImport) {
    return;
  }

  const mode = els.importMode.querySelector('input[name="import-mode"]:checked')
    ?.value;
  const imported = state.pendingImport.trials;

  if (mode === 'replace') {
    const confirmed = await confirmAction({
      title: 'Replace all items?',
      message: `This removes ${plural(
        state.trials.length,
        'item',
      )} currently saved here and imports ${plural(
        imported.length,
        'item',
      )} from the file. Export a backup first if you might need the current list.`,
      confirmLabel: 'Replace everything',
    });
    if (!confirmed) {
      return;
    }
  }

  const next =
    mode === 'replace' ? imported : mergeTrials(state.trials, imported);

  if (next.length > MAX_ENTRIES) {
    renderImportErrors([
      {
        message: `This merge would create ${next.length} items, above the ${MAX_ENTRIES} item limit.`,
      },
    ]);
    return;
  }

  state.trials = next;
  const saved = persistTrials();
  render();
  els.dataDialog.close();
  resetImportUi();
  showToast(
    saved
      ? `Imported ${plural(imported.length, 'item')}.`
      : `Imported ${plural(
          imported.length,
          'item',
        )} for this session only. Browser storage is blocked.`,
    { error: !saved },
  );
}

async function eraseAllTrials() {
  if (state.trials.length === 0) {
    return;
  }

  const confirmed = await confirmAction({
    title: 'Erase all Trialwise data?',
    message:
      'This permanently removes every item and notification record from this browser. Download a backup first if you may want it later.',
    confirmLabel: 'Erase everything',
  });
  if (!confirmed) {
    return;
  }

  state.trials = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(NOTIFICATION_LOG_KEY);
    state.storageOk = true;
  } catch {
    state.storageOk = false;
  }
  els.dataDialog.close();
  resetImportUi();
  render();
  showToast('All local Trialwise data erased.');
}

/* Install prompt */

function updateInstallButtons() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const available = Boolean(state.installPrompt) && !isStandalone;
  els.installButton.hidden = !available;
  els.installDialogButton.hidden = !available;
}

async function promptInstall() {
  if (!state.installPrompt) {
    showToast(
      'Use your browser menu to install this app. On iPhone or iPad, choose Share → Add to Home Screen.',
    );
    return;
  }

  const prompt = state.installPrompt;
  state.installPrompt = null;
  updateInstallButtons();
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') {
    showToast('Trialwise is being installed.');
  }
}

/* Event wiring */

function setupEventListeners() {
  for (const button of [els.addTrialButton, els.welcomeAddButton]) {
    button.addEventListener('click', () => openTrialDialog());
  }

  els.remindersButton.addEventListener('click', openRemindersDialog);

  els.dataButton.addEventListener('click', openDataDialog);
  els.dataNoteButton.addEventListener('click', openDataDialog);

  document.querySelectorAll('[data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = byId(button.dataset.openDialog);
      if (!dialog) {
        return;
      }
      if (dialog === els.dataDialog) {
        openDataDialog();
      } else {
        dialog.showModal();
      }
    });
  });

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) {
      byId(closeButton.dataset.closeDialog)?.close();
    }
  });

  els.trialForm.addEventListener('submit', handleTrialSubmit);

  els.trialForm.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const errorField =
      target.name === 'costAfterTrial' ? 'costCents' : target.name;
    const errorElement = els.trialForm.querySelector(
      `[data-error-for="${errorField}"]`,
    );
    if (errorElement) {
      errorElement.textContent = '';
    }
    target.removeAttribute('aria-invalid');
    els.formAlert.hidden = true;

    if (target.name === 'notes') {
      updateNotesCount();
    }
    if (
      ['startDate', 'trialDays', 'renewalDate', 'reminderDays'].includes(
        target.name,
      )
    ) {
      updateDeadlinePreview();
    }
  });

  els.trialForm.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === 'kind') {
      clearFieldErrors();
      applyFormKind();
      return;
    }
    updateDeadlinePreview();
  });
  els.trialDialog.addEventListener('close', () => {
    state.editingId = null;
    resetTrialForm();
  });

  for (const button of els.quickDaysButtons) {
    button.addEventListener('click', () => {
      const input = els.trialForm.elements.namedItem('trialDays');
      input.value = button.dataset.days;
      updateDeadlinePreview();
      input.focus();
    });
  }

  for (const chip of els.filterChips) {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      renderTrialList();
    });
  }

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value;
    renderTrialList();
  });

  els.trialsList.addEventListener('click', handleTrialListClick);

  els.reminderAlerts.addEventListener('click', (event) => {
    if (event.target.closest('[data-review]')) {
      reviewTrials();
    }
  });

  els.listEmptyAdd.addEventListener('click', () => {
    if (state.search.trim()) {
      state.search = '';
      els.searchInput.value = '';
      renderTrialList();
      return;
    }
    if (state.filter !== 'all') {
      state.filter = 'all';
      renderTrialList();
      return;
    }
    openTrialDialog();
  });

  els.enableNotifications.addEventListener('click', () => {
    void enableBrowserNotifications();
  });
  els.sendTestNotification.addEventListener('click', () => {
    void sendTestNotification();
  });
  els.downloadCalendarButton.addEventListener('click', downloadCalendar);

  for (const button of els.exportButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.export === 'json') {
        downloadJsonBackup();
      } else if (button.dataset.export === 'csv') {
        downloadCsvBackup();
      } else if (button.dataset.export === 'ics') {
        downloadCalendar();
      }
    });
  }

  els.chooseImportFile.addEventListener('click', () => {
    els.importFile.click();
  });
  els.importFile.addEventListener('change', () => {
    const [file] = els.importFile.files ?? [];
    if (file) {
      void handleImportFile(file);
    }
  });
  els.importMode.addEventListener('change', updateApplyImportLabel);
  els.applyImport.addEventListener('click', () => {
    void applyImport();
  });
  els.eraseDataButton.addEventListener('click', () => {
    void eraseAllTrials();
  });

  els.dataDialog.addEventListener('close', () => {
    resetImportUi();
  });

  els.confirmCancel.addEventListener('click', () => {
    els.confirmDialog.close('cancel');
  });
  els.confirmAction.addEventListener('click', () => {
    els.confirmDialog.close('confirm');
  });
  els.confirmDialog.addEventListener('close', resolveConfirmDialog);

  for (const button of [els.installButton, els.installDialogButton]) {
    button.addEventListener('click', () => {
      void promptInstall();
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    updateInstallButtons();
    showToast('Trialwise was installed.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const nextToday = todayForStorage();
      if (nextToday !== state.today) {
        render();
      }
      updateReminderPanel();
    } else {
      void maybeSendDueNotifications();
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    if (event.newValue === null) {
      state.trials = [];
      render();
      showToast('All Trialwise data was erased in another tab.');
      return;
    }
    const loaded = loadTrials();
    if (loaded !== null) {
      state.trials = loaded;
      render();
      showToast('Your watchlist was updated in another tab.');
    }
  });

  window.setInterval(() => {
    const nextToday = todayForStorage();
    if (nextToday !== state.today) {
      render();
    }
    if (document.visibilityState === 'hidden') {
      void maybeSendDueNotifications();
    }
  }, 60_000);
}

function openDataDialog() {
  resetImportUi();
  updateDataDialog();
  updateInstallButtons();
  els.dataDialog.showModal();
}

function openRemindersDialog() {
  updateReminderPanel();
  els.remindersDialog.showModal();
}

/* Initialization */

function init() {
  setupElements();
  const loaded = loadTrials();
  if (loaded !== null) {
    state.trials = loaded;
  }
  resetTrialForm();
  resetImportUi();
  setupEventListeners();
  render();
  updateInstallButtons();
  void ensureServiceWorkerRegistration();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
