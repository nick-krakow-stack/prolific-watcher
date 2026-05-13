const $ = (id) => document.getElementById(id);
const els = {
  // Header
  mainBtn: $('mainBtn'),
  mainBtnIcon: $('mainBtnIcon'),
  mainBtnLabel: $('mainBtnLabel'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  // Earnings
  syncBtn: $('syncBtn'),
  balanceApproved: $('balanceApproved'),
  balanceApprovedEur: $('balanceApprovedEur'),
  balancePending: $('balancePending'),
  balancePendingEur: $('balancePendingEur'),
  earnedThisMonth: $('earnedThisMonth'),
  earnedLastMonth: $('earnedLastMonth'),
  earnedTotal: $('earnedTotal'),
  earnedToday: $('earnedToday'),
  earnedThisWeek: $('earnedThisWeek'),
  syncMeta: $('syncMeta'),
  // Studies
  notifTile: $('notifTile'),
  notifCount: $('notifCount'),
  activeCount: $('activeCount'),
  lastCheck: $('lastCheck'),
  pollingMode: $('pollingMode'),
  // Quote
  quoteValue: $('quoteValue'),
  quoteHint: $('quoteHint'),
  earnQuoteValue: $('earnQuoteValue'),
  earnQuoteHint: $('earnQuoteHint'),
  // Settings
  intervalSelect: $('intervalSelect'),
  intervalHint: $('intervalHint'),
  persistentToggle: $('persistentToggle'),
  scheduleToggle: $('scheduleToggle'),
  scheduleRow: $('scheduleRow'),
  scheduleStart: $('scheduleStart'),
  scheduleEnd: $('scheduleEnd'),
  // Actions
  checkNowBtn: $('checkNowBtn'),
  testBtn: $('testBtn'),
  exportBtn: $('exportBtn'),
  resetHistoryBtn: $('resetHistoryBtn'),
  errorBox: $('errorBox'),
  tokenHint: $('tokenHint'),
  // History Modal
  historyModal: $('historyModal'),
  historyList: $('historyList'),
  dismissAllBtn: $('dismissAllBtn'),
  // Export Modal
  exportModal: $('exportModal'),
  exportCustomRange: $('exportCustomRange'),
  exportFrom: $('exportFrom'),
  exportTo: $('exportTo'),
  doExportBtn: $('doExportBtn'),
  exportLastSync: $('exportLastSync')
};

let cachedState = null;

// ===== Helpers =====

function formatTimeAgo(iso) {
  if (!iso) return '–';
  const then = new Date(iso);
  const diff = Math.floor((new Date() - then) / 1000);
  if (diff < 5) return 'gerade eben';
  if (diff < 60) return `vor ${diff} Sek`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  return then.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res || { ok: false }));
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Status-Klassifikation nach Prolific-Logik:
// EARNED ("Total earned" auf Prolific): APPROVED + SCREENED OUT
// PENDING (separat angezeigt): AWAITING REVIEW
// NICHT GEZÄHLT: RETURNED, REJECTED, TIMED-OUT
const STATUS_EARNED = new Set(['APPROVED', 'SCREENED-OUT', 'SCREENED OUT']);
const STATUS_PENDING = new Set(['AWAITING REVIEW']);
const STATUS_COUNTABLE = new Set([...STATUS_EARNED, ...STATUS_PENDING]);

// Default für sumEarningsInRange
const COUNTABLE_STATUSES = STATUS_COUNTABLE;

function sumEarningsInRange(state, from, to, statusFilter = COUNTABLE_STATUSES) {
  // Returns: { GBP: minorUnits, USD: minorUnits, ... }
  const subs = Object.values(state.submissions || {});
  const totals = {};

  for (const s of subs) {
    if (!s.completed_at) continue;
    if (!statusFilter.has(s.status)) continue;
    const d = new Date(s.completed_at);
    if (from && d < from) continue;
    if (to && d > to) continue;

    const fullMinor = s.reward_amount_minor || 0;
    const cur = s.reward_currency || 'GBP';
    totals[cur] = (totals[cur] || 0) + fullMinor;
  }
  return totals;
}

// Multi-Currency-Formatter: zeigt "£75,72 + $4,55"
function formatMulti(totals) {
  if (!totals || Object.keys(totals).length === 0) return '£0,00';
  const parts = [];
  // GBP zuerst, dann andere alphabetisch
  const order = ['GBP', ...Object.keys(totals).filter(c => c !== 'GBP').sort()];
  for (const cur of order) {
    if (!totals[cur]) continue;
    const amt = (totals[cur] / 100).toFixed(2).replace('.', ',');
    const symbol = cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : (cur + ' ');
    parts.push(`${symbol}${amt}`);
  }
  return parts.length > 0 ? parts.join(' + ') : '£0,00';
}

// EUR-Equivalent zur Übersicht
function formatEurEquivalent(totals, fxRates) {
  if (!totals || !fxRates?.rates) return '';
  let eurMinor = 0;
  for (const [cur, minor] of Object.entries(totals)) {
    if (cur === 'EUR') {
      eurMinor += minor;
    } else if (cur === 'GBP' && fxRates.rates.EUR) {
      // GBP → EUR (FX-Rate ist GBP-basiert)
      eurMinor += Math.round(minor * fxRates.rates.EUR);
    } else if (fxRates.rates[cur] && fxRates.rates.EUR) {
      // andere Währung → GBP → EUR
      const gbpMinor = minor / fxRates.rates[cur];
      eurMinor += Math.round(gbpMinor * fxRates.rates.EUR);
    }
  }
  if (eurMinor === 0) return '';
  return '≈ €' + (eurMinor / 100).toFixed(2).replace('.', ',');
}

function getMonthRange(offset = 0) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59);
  return { from, to };
}

function renderQuote(state) {
  /**
   * Erfolgsquote & Verdienst-Quote.
   *
   * Wichtig: Wir filtern auf Studien, deren reward_minor bekannt ist UND die
   * in den letzten 30 Tagen gemeldet wurden. Sonst verzerren alte Daten ohne
   * Reward-Info (Pre-Update) die Quote völlig.
   *
   * Status-Klassifikation:
   * - "Angenommen": APPROVED, AWAITING REVIEW, SCREENED OUT
   * - "Verpasst": gemeldet aber keine Submission
   * - "Zurückgegeben" (RETURNED): zählt nicht als verpasst
   *
   * Verdienst-Quote:
   * - Bei SCREENED OUT: möglicher Verdienst = tatsächlicher (kein verpasstes Potenzial)
   * - Sonst: möglicher = Reward laut Notification, tatsächlicher = was bekommen
   */
  const history = state.studyHistory || {};
  const submissions = state.submissions || {};

  const setEmpty = (msg) => {
    if (els.quoteValue) els.quoteValue.textContent = '–';
    if (els.quoteHint) els.quoteHint.textContent = msg || 'noch keine Daten';
    if (els.earnQuoteValue) els.earnQuoteValue.textContent = '–';
    if (els.earnQuoteHint) els.earnQuoteHint.textContent = msg || 'noch keine Daten';
  };

  if (Object.keys(history).length === 0) {
    setEmpty('noch keine Benachrichtigungen');
    return;
  }

  // Filter: letzten 30 Tage + Reward bekannt
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentHistory = Object.values(history).filter(s => {
    const ts = s.firstSeen ? new Date(s.firstSeen).getTime() : 0;
    return ts >= cutoff && s.reward_minor != null && s.reward_minor > 0;
  });

  if (recentHistory.length === 0) {
    setEmpty('zu wenig aktuelle Daten');
    return;
  }

  // Submissions nach study_id indexieren (jeweils besten Status nehmen)
  const subsByStudyId = {};
  const statusRank = (s) => {
    if (s === 'APPROVED') return 4;
    if (s === 'AWAITING REVIEW') return 3;
    if (s === 'SCREENED-OUT' || s === 'SCREENED OUT') return 2;
    if (s === 'RETURNED') return 1;
    return 0;
  };
  for (const sub of Object.values(submissions)) {
    if (!sub.study_id) continue;
    const existing = subsByStudyId[sub.study_id];
    if (!existing || statusRank(sub.status) > statusRank(existing.status)) {
      subsByStudyId[sub.study_id] = sub;
    }
  }

  let acceptedCount = 0;
  let missedCount = 0;
  let returnedCount = 0;
  const totals_actual = {};
  const totals_possible = {};

  for (const study of recentHistory) {
    const sub = subsByStudyId[study.id];
    const cur = study.reward_currency || 'GBP';
    const possibleReward = study.reward_minor || 0;

    if (!sub) {
      missedCount++;
      totals_possible[cur] = (totals_possible[cur] || 0) + possibleReward;
      continue;
    }

    const status = sub.status;
    if (status === 'RETURNED') {
      returnedCount++;
      continue;
    }

    if (status === 'APPROVED' || status === 'AWAITING REVIEW' ||
        status === 'SCREENED-OUT' || status === 'SCREENED OUT') {
      acceptedCount++;
      const actual = sub.reward_amount_minor || 0;
      const subCur = sub.reward_currency || cur;
      totals_actual[subCur] = (totals_actual[subCur] || 0) + actual;

      // Mögliches Verdienstpotenzial
      if (status === 'SCREENED-OUT' || status === 'SCREENED OUT') {
        // Kein verpasstes Potenzial – möglicher = tatsächlicher
        totals_possible[subCur] = (totals_possible[subCur] || 0) + actual;
      } else {
        totals_possible[cur] = (totals_possible[cur] || 0) + possibleReward;
      }
    }
  }

  // 1) Erfolgsquote
  const relevantCount = acceptedCount + missedCount;
  if (relevantCount > 0) {
    const pct = Math.round((acceptedCount / relevantCount) * 100);
    if (els.quoteValue) els.quoteValue.textContent = pct + '%';
    if (els.quoteHint) {
      const returnedNote = returnedCount > 0 ? ` · ${returnedCount}× zurückgeg.` : '';
      els.quoteHint.textContent = `${acceptedCount}/${relevantCount} (30T)${returnedNote}`;
    }
  } else {
    if (els.quoteValue) els.quoteValue.textContent = '–';
    if (els.quoteHint) els.quoteHint.textContent = 'noch keine Daten';
  }

  // 2) Verdienst-Quote
  function toGbpMinor(totals) {
    if (!totals) return 0;
    const fx = state.fxRates;
    let gbp = 0;
    for (const [cur, amt] of Object.entries(totals)) {
      if (cur === 'GBP') gbp += amt;
      else if (fx?.rates?.[cur]) gbp += Math.round(amt / fx.rates[cur]);
      else gbp += amt;
    }
    return gbp;
  }
  const actualGbp = toGbpMinor(totals_actual);
  const possibleGbp = toGbpMinor(totals_possible);

  // Sanity-Check: actualGbp sollte NIE größer als possibleGbp sein
  // (außer durch Bonus, aber selbst dann nicht >150%).
  // Falls doch, ist die Berechnung kaputt → "–" anzeigen.
  if (possibleGbp > 0 && actualGbp <= possibleGbp * 2) {
    const pct = Math.round((actualGbp / possibleGbp) * 100);
    if (els.earnQuoteValue) els.earnQuoteValue.textContent = pct + '%';
    if (els.earnQuoteHint) {
      els.earnQuoteHint.textContent = `${formatMulti(totals_actual)} von ${formatMulti(totals_possible)}`;
    }
  } else {
    if (els.earnQuoteValue) els.earnQuoteValue.textContent = '–';
    if (els.earnQuoteHint) {
      els.earnQuoteHint.textContent = possibleGbp === 0 ? 'noch keine Daten' : 'Daten inkonsistent';
    }
  }
}

function getTodayRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { from, to };
}

function getThisWeekRange() {
  // Woche beginnt Montag in DE
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=So, 1=Mo, ...
  const daysSinceMonday = (dayOfWeek + 6) % 7; // 0 wenn Mo, 1 wenn Di, ..., 6 wenn So
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { from, to };
}

// Beträge aus mehreren Currency-Totals addieren
function mergeTotals(...totalsList) {
  const merged = {};
  for (const totals of totalsList) {
    if (!totals) continue;
    for (const [cur, amt] of Object.entries(totals)) {
      merged[cur] = (merged[cur] || 0) + amt;
    }
  }
  return merged;
}

// ===== Render =====

function render(state) {
  cachedState = state;

  // Main Btn
  if (state.isRunning) {
    els.mainBtn.classList.remove('main-btn--start');
    els.mainBtn.classList.add('main-btn--stop');
    els.mainBtnIcon.textContent = '■';
    els.mainBtnLabel.textContent = 'Stoppen';
  } else {
    els.mainBtn.classList.add('main-btn--start');
    els.mainBtn.classList.remove('main-btn--stop');
    els.mainBtnIcon.textContent = '▶';
    els.mainBtnLabel.textContent = 'Starten';
  }

  // Status Dot
  els.statusDot.classList.remove('is-running', 'is-paused', 'is-error');
  // Live-Mode: prüfen ob in letzten 10 Sek ein Live-Update kam
  let liveActive = false;
  if (state.lastLiveUpdate) {
    const ageMs = Date.now() - new Date(state.lastLiveUpdate).getTime();
    liveActive = ageMs < 10000;
  }
  switch (state.lastStatus) {
    case 'active':
      els.statusDot.classList.add('is-running');
      els.statusText.textContent = liveActive ? 'Live aktiv ⚡' : 'Aktiv';
      els.statusText.title = liveActive
        ? 'Live-Polling im Prolific-Tab aktiv – Studien werden alle 3 Sek geprüft'
        : 'Background-Polling läuft';
      break;
    case 'paused': els.statusDot.classList.add('is-paused');  els.statusText.textContent = 'Pausiert'; break;
    case 'error':  els.statusDot.classList.add('is-error');   els.statusText.textContent = 'Fehler'; break;
    case 'auth_error': els.statusDot.classList.add('is-error'); els.statusText.textContent = 'Login fehlt'; break;
    default:
      els.statusText.textContent = state.isRunning ? (liveActive ? 'Live aktiv ⚡' : 'Aktiv') : 'Bereit';
  }

  // Earnings: Balance (echt von Prolific API) - Multi-Currency-Anzeige
  if (state.balance) {
    // Prolifics Balance-API liefert: balances (Array pro Währung), oder total_gbp als Fallback
    const approvedTotals = state.balance.approved_per_currency || { GBP: state.balance.total_gbp || 0 };
    const pendingTotals = state.balance.pending_per_currency || { GBP: state.balance.total_pending_gbp || 0 };
    els.balanceApproved.textContent = formatMulti(approvedTotals);
    els.balanceApprovedEur.textContent = formatEurEquivalent(approvedTotals, state.fxRates);
    els.balancePending.textContent = formatMulti(pendingTotals);
    els.balancePendingEur.textContent = formatEurEquivalent(pendingTotals, state.fxRates);
    els.balanceApproved.title = 'Klick öffnet Balance Hub auf Prolific';
    els.balancePending.title = '';
  } else {
    els.balanceApproved.textContent = '–';
    els.balanceApprovedEur.textContent = '';
    els.balancePending.textContent = '–';
    els.balancePendingEur.textContent = '';
    els.balanceApproved.title = 'Balance konnte nicht abgerufen werden – Prolific-Tab offen?';
    els.balancePending.title = 'Balance konnte nicht abgerufen werden – Prolific-Tab offen?';
  }

  // Earnings per Period - getrennt nach Earned (Approved+Screened-Out) und Pending
  const { from: thisFrom, to: thisTo } = getMonthRange(0);
  const { from: lastFrom, to: lastTo } = getMonthRange(-1);

  // Periodensummen: NUR Earned (entspricht Prolifics "Total earned")
  // Damit kannst du auf einen Blick sehen, was du in dem Zeitraum tatsächlich verdient hast.
  const thisEarned = sumEarningsInRange(state, thisFrom, thisTo, STATUS_EARNED);
  const thisPending = sumEarningsInRange(state, thisFrom, thisTo, STATUS_PENDING);
  const lastEarned = sumEarningsInRange(state, lastFrom, lastTo, STATUS_EARNED);
  const lastPending = sumEarningsInRange(state, lastFrom, lastTo, STATUS_PENDING);
  const totalEarned = sumEarningsInRange(state, null, null, STATUS_EARNED);
  const totalPending = sumEarningsInRange(state, null, null, STATUS_PENDING);

  function buildTooltip(earned, pending) {
    return `Verdient: ${formatMulti(earned)} · Pending: ${formatMulti(pending)}`;
  }

  els.earnedThisMonth.textContent = formatMulti(thisEarned);
  els.earnedThisMonth.title = buildTooltip(thisEarned, thisPending);
  els.earnedLastMonth.textContent = formatMulti(lastEarned);
  els.earnedLastMonth.title = buildTooltip(lastEarned, lastPending);
  els.earnedTotal.textContent = formatMulti(totalEarned);
  els.earnedTotal.title = buildTooltip(totalEarned, totalPending);

  // Heute & Diese Woche - inkl. Pending (lt. User-Wunsch)
  const { from: todayFrom, to: todayTo } = getTodayRange();
  const { from: weekFrom, to: weekTo } = getThisWeekRange();
  const todayEarned = sumEarningsInRange(state, todayFrom, todayTo, STATUS_EARNED);
  const todayPending = sumEarningsInRange(state, todayFrom, todayTo, STATUS_PENDING);
  const weekEarned = sumEarningsInRange(state, weekFrom, weekTo, STATUS_EARNED);
  const weekPending = sumEarningsInRange(state, weekFrom, weekTo, STATUS_PENDING);
  const todayTotal = mergeTotals(todayEarned, todayPending);
  const weekTotal = mergeTotals(weekEarned, weekPending);

  if (els.earnedToday) {
    els.earnedToday.textContent = formatMulti(todayTotal);
    els.earnedToday.title = buildTooltip(todayEarned, todayPending);
  }
  if (els.earnedThisWeek) {
    els.earnedThisWeek.textContent = formatMulti(weekTotal);
    els.earnedThisWeek.title = buildTooltip(weekEarned, weekPending);
  }

  // Erfolgsquote: Angenommene Studien / Gemeldete Studien
  renderQuote(state);

  // Sync Meta
  if (state.earningsLastSync) {
    const ago = formatTimeAgo(state.earningsLastSync);
    if (state.earningsLastSyncError) {
      els.syncMeta.textContent = `Sync-Fehler: ${state.earningsLastSyncError}`;
    } else {
      els.syncMeta.textContent = `Letzter Sync: ${ago}`;
    }
  } else {
    els.syncMeta.textContent = 'Noch nicht synchronisiert';
  }

  // Studies
  els.lastCheck.textContent = formatTimeAgo(state.lastCheck);
  els.notifCount.textContent = state.totalNotificationsSent || 0;
  els.activeCount.textContent = state.activeStudyCount || 0;

  // Polling-Modus: Live (Tab offen) oder Background
  if (els.pollingMode) {
    if (!state.isRunning) {
      els.pollingMode.textContent = 'Gestoppt';
      els.pollingMode.className = '';
    } else if (liveActive) {
      const ageSec = state.lastLiveUpdate
        ? Math.round((Date.now() - new Date(state.lastLiveUpdate).getTime()) / 1000)
        : null;
      els.pollingMode.textContent = `⚡ Live (alle 3 Sek) · letzter Ping vor ${ageSec}s`;
      els.pollingMode.className = 'mode-live';
      els.pollingMode.title = 'Prolific-Tab pollt direkt - sehr schnell, mit Cookie-Auth';
    } else {
      const interval = state.intervalMinutes;
      const intervalStr = interval < 1
        ? `${Math.round(interval * 60)} Sek`
        : `${interval} Min`;
      els.pollingMode.textContent = `Background (alle ${intervalStr})`;
      els.pollingMode.className = 'mode-background';
      els.pollingMode.title = 'Kein Prolific-Tab offen - Plugin pollt vom Service Worker. Für schnellere Updates Tab öffnen.';
    }
  }

  // Settings
  els.intervalSelect.value = String(state.intervalMinutes);
  els.persistentToggle.checked = !!state.notificationPersistent;
  els.scheduleToggle.checked = !!state.scheduleEnabled;
  els.scheduleStart.value = state.scheduleStart || '08:00';
  els.scheduleEnd.value = state.scheduleEnd || '22:00';
  els.scheduleRow.classList.toggle('is-hidden', !state.scheduleEnabled);

  // Interval-Hint: Warnung bei Sub-Minute-Polling
  if (els.intervalHint) {
    els.intervalHint.style.display = state.intervalMinutes < 1 ? 'block' : 'none';
  }

  // Errors / Hints
  if (state.lastStatus === 'auth_error' || (!state.hasToken && state.isRunning)) {
    els.errorBox.innerHTML = '⚠ Kein gültiger Login-Token. <a href="https://app.prolific.com/studies" target="_blank">Prolific öffnen ↗</a>';
    els.errorBox.hidden = false;
  } else if (state.lastError && state.lastStatus === 'error') {
    els.errorBox.textContent = '⚠ ' + state.lastError;
    els.errorBox.hidden = false;
  } else {
    els.errorBox.hidden = true;
  }

  if (!state.hasToken && !state.isRunning && state.lastStatus === 'idle') {
    els.tokenHint.innerHTML = 'ℹ Öffne einmal <a href="https://app.prolific.com/studies" target="_blank">Prolific</a>, damit das Plugin sich authentifizieren kann.';
    els.tokenHint.hidden = false;
  } else {
    els.tokenHint.hidden = true;
  }

  // Update modal contents if open
  if (!els.historyModal.hidden) renderHistoryList(state);
  if (!els.exportModal.hidden) {
    els.exportLastSync.textContent = state.earningsLastSync ? formatTimeAgo(state.earningsLastSync) : 'noch nie';
  }
}

function renderHistoryList(state) {
  const history = state.studyHistory || {};
  const entries = Object.values(history);

  if (entries.length === 0) {
    els.historyList.innerHTML = '<p class="empty-state">Noch keine Benachrichtigungen.</p>';
    return;
  }

  entries.sort((a, b) => {
    const aPriority = (a.dismissed ? 2 : 0) + (a.isActive ? 0 : 1);
    const bPriority = (b.dismissed ? 2 : 0) + (b.isActive ? 0 : 1);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(b.lastSeen) - new Date(a.lastSeen);
  });

  els.historyList.innerHTML = entries.map(s => {
    const tags = [];
    if (s.isActive) tags.push('<span class="study-tag tag-active">Aktiv</span>');
    else if (s.expired) tags.push('<span class="study-tag tag-expired">⏱ Abgelaufen</span>');
    else tags.push('<span class="study-tag tag-inactive">Beendet</span>');
    if ((s.timesNotified || 0) > 1) {
      tags.push(`<span class="study-tag tag-times">${s.timesNotified}× gesehen</span>`);
    }
    if (s.verifiedBy === 'content_live' && s.isActive) {
      tags.push('<span class="study-tag tag-live">⚡ live</span>');
    }
    const parts = [];
    if (s.reward != null) {
      const sym = s.reward_currency === 'USD' ? '$' : s.reward_currency === 'EUR' ? '€' : '£';
      parts.push(`<span class="reward">${sym}${(s.reward/100).toFixed(2)}</span>`);
    }
    if (s.time != null) parts.push(`${s.time} Min`);
    if (s.places != null) parts.push(`${s.places} Plätze`);
    if (s.rph != null) {
      const sym = s.reward_currency === 'USD' ? '$' : s.reward_currency === 'EUR' ? '€' : '£';
      parts.push(`${sym}${(s.rph/100).toFixed(2)}/h`);
    }
    return `
      <div class="study-row ${s.dismissed ? 'is-dismissed' : ''} ${s.isActive ? '' : 'is-inactive'} ${s.expired ? 'is-expired' : ''}" data-id="${escapeHtml(s.id)}">
        <input type="checkbox" class="study-checkbox" data-id="${escapeHtml(s.id)}" ${s.dismissed ? 'checked' : ''}>
        <div class="study-content">
          <div class="study-name">${escapeHtml(s.name)}</div>
          <div class="study-meta">${parts.join(' · ') || '<em>keine Details</em>'}</div>
          <div class="study-tags">${tags.join('')}</div>
        </div>
        <button class="study-open" data-open="${escapeHtml(s.id)}" title="Auf Prolific öffnen">↗</button>
      </div>
    `;
  }).join('');

  els.historyList.querySelectorAll('.study-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) await send('DISMISS_STUDY', { id });
      await refresh();
    });
  });
  els.historyList.querySelectorAll('.study-open').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.open;
      chrome.tabs.create({ url: `https://app.prolific.com/studies/${id}` });
    });
  });
}

async function refresh() {
  const res = await send('GET_STATE');
  if (res.ok) render(res.state);
}

// ===== Modals =====

els.historyModal.hidden = true;
els.exportModal.hidden = true;

function openHistoryModal() {
  els.historyModal.hidden = false;
  refresh();
}
function closeAllModals() {
  els.historyModal.hidden = true;
  els.exportModal.hidden = true;
}

// ===== Event Handlers =====

els.mainBtn.addEventListener('click', async () => {
  els.mainBtn.disabled = true;
  const res = await send('GET_STATE');
  if (res.ok && res.state.isRunning) {
    await send('STOP');
  } else {
    await send('UPDATE_SETTINGS', collectSettings());
    await send('START');
  }
  els.mainBtn.disabled = false;
  await refresh();
});

els.intervalSelect.addEventListener('change', async () => {
  await send('UPDATE_SETTINGS', { intervalMinutes: Number(els.intervalSelect.value) });
  await refresh();
});
els.persistentToggle.addEventListener('change', async () => {
  await send('UPDATE_SETTINGS', { notificationPersistent: els.persistentToggle.checked });
  await refresh();
});
els.scheduleToggle.addEventListener('change', async () => {
  await send('UPDATE_SETTINGS', { scheduleEnabled: els.scheduleToggle.checked });
  await refresh();
});
els.scheduleStart.addEventListener('change', async () => {
  await send('UPDATE_SETTINGS', { scheduleStart: els.scheduleStart.value });
});
els.scheduleEnd.addEventListener('change', async () => {
  await send('UPDATE_SETTINGS', { scheduleEnd: els.scheduleEnd.value });
});

els.checkNowBtn.addEventListener('click', async () => {
  els.checkNowBtn.disabled = true;
  els.checkNowBtn.textContent = 'Prüfe …';
  await send('CHECK_NOW');
  setTimeout(async () => {
    els.checkNowBtn.disabled = false;
    els.checkNowBtn.textContent = 'Jetzt prüfen';
    await refresh();
  }, 800);
});

els.testBtn.addEventListener('click', async () => {
  els.testBtn.disabled = true;
  els.testBtn.textContent = '✓ gesendet';
  await send('TEST_NOTIFICATION');
  setTimeout(() => {
    els.testBtn.disabled = false;
    els.testBtn.textContent = 'Test-Benachr.';
  }, 1500);
});

// Sync Earnings
els.syncBtn.addEventListener('click', async () => {
  els.syncBtn.disabled = true;
  els.syncBtn.textContent = '⟳ Sync …';
  const res = await send('SYNC_EARNINGS');
  setTimeout(async () => {
    els.syncBtn.disabled = false;
    els.syncBtn.textContent = res.ok ? '✓ OK' : '✗ Fehler';
    setTimeout(() => { els.syncBtn.textContent = '⟳ Sync'; }, 1500);
    await refresh();
  }, 600);
});

// Notif Tile → History Modal
els.notifTile.addEventListener('click', (e) => {
  e.stopPropagation();
  openHistoryModal();
});

// Auszahlbar-Kachel → Prolific Balance-Hub öffnen
const balanceApprovedTile = $('balanceApprovedTile');
if (balanceApprovedTile) {
  balanceApprovedTile.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: 'https://app.prolific.com/balance-hub' });
  });
}

// Export Btn → Export Modal
els.exportBtn.addEventListener('click', () => {
  els.exportModal.hidden = false;
  refresh();
});

// Reset History → bestätigen + senden
if (els.resetHistoryBtn) {
  els.resetHistoryBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Notification-Historie wirklich löschen?\n\n' +
      'Damit werden die Quoten ab heute neu berechnet. ' +
      'Verdienst-Daten und Submissions bleiben erhalten.'
    );
    if (!confirmed) return;
    await send('RESET_STUDY_HISTORY');
    await refresh();
  });
}

// Custom Range Toggle
document.querySelectorAll('input[name="rangeType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    els.exportCustomRange.hidden = e.target.value !== 'custom';
  });
});

// Do Export
els.doExportBtn.addEventListener('click', async () => {
  const rangeType = document.querySelector('input[name="rangeType"]:checked').value;
  const format = document.querySelector('input[name="exportFormat"]:checked').value;
  const payload = { rangeType, format };
  if (rangeType === 'custom') {
    payload.from = els.exportFrom.value || null;
    payload.to = els.exportTo.value || null;
  }
  els.doExportBtn.disabled = true;
  const res = await send('EXPORT_DATA', payload);
  els.doExportBtn.disabled = false;
  if (res.ok) {
    closeAllModals();
  } else {
    alert('Export fehlgeschlagen: ' + (res.error || 'unbekannt'));
  }
});

// Close handlers
document.querySelectorAll('[data-close-modal]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllModals();
  });
});
els.dismissAllBtn.addEventListener('click', async () => {
  await send('DISMISS_ALL_STUDIES');
  await refresh();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

function collectSettings() {
  return {
    intervalMinutes: Number(els.intervalSelect.value),
    notificationPersistent: els.persistentToggle.checked,
    scheduleEnabled: els.scheduleToggle.checked,
    scheduleStart: els.scheduleStart.value,
    scheduleEnd: els.scheduleEnd.value
  };
}

refresh();
setInterval(refresh, 3000);
