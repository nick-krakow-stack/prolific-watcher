// ============================================================
// Prolific Watcher - Background Service Worker (v1.4)
// ============================================================

// ---- API Endpoints ----
const PROLIFIC_API_BASE = 'https://internal-api.prolific.com/api/v1';
const PROLIFIC_STUDIES_URL = `${PROLIFIC_API_BASE}/participant/studies/?sortBy=published_at&orderBy=asc`;
const PROLIFIC_SUBMISSIONS_URL = `${PROLIFIC_API_BASE}/participant/submissions/`;
// Balance braucht User-ID → wird dynamisch aus Token extrahiert
const PROLIFIC_APP_URL = 'https://app.prolific.com/';
const PROLIFIC_APP_STUDIES_URL = 'https://app.prolific.com/studies';
const FX_API_URL = 'https://api.frankfurter.app/latest';

// ---- Alarms ----
const ALARM_POLL = 'prolific-poll';
const ALARM_AUTH = 'prolific-auth-check';
const ALARM_EARNINGS = 'prolific-earnings-sync';

// ---- Polling-Modi ----
// chrome.alarms hat Minimum 1 Min (in Chrome). Für Sub-Minute brauchen wir setTimeout
// + einen Keepalive um den Service Worker am Leben zu halten.
const SUBMINUTE_THRESHOLD_MIN = 1.0; // ab 1 Min nutzen wir Alarms, darunter setTimeout
const KEEPALIVE_INTERVAL_SEC = 25; // Service Worker einschläft nach ~30s Inaktivität

let subMinuteTimer = null; // setTimeout-Handle für Sub-Minute-Polling
let keepaliveInterval = null; // setInterval-Handle für Service-Worker-Wachhalten

// ---- Notification IDs ----
const NOTIF_PREFIX_STUDY = 'prolific-study-';
const NOTIF_AUTH_ERROR = 'prolific-auth-error';
const NOTIF_TEST = 'prolific-test';

// ---- Defaults ----
const DEFAULT_SETTINGS = {
  // Polling
  isRunning: false,
  intervalMinutes: 3,
  scheduleEnabled: false,
  scheduleStart: '08:00',
  scheduleEnd: '22:00',
  notificationPersistent: true,
  lastCheck: null,
  lastStatus: 'idle',
  lastError: null,

  // Studies (Notifications)
  studyHistory: {},
  totalNotificationsSent: 0,
  activeStudyCount: 0,

  // Earnings (NEW v1.4)
  earningsEnabled: true,
  earningsSyncIntervalHours: 3,
  earningsLastSync: null,
  earningsLastSyncError: null,
  // submissions: { [id]: { provider, study_name, researcher, reward_amount, reward_currency, status, started_at, completed_at, time_taken_seconds, ... } }
  submissions: {},
  // Balance (snapshot of last sync)
  balance: null, // { approved: { GBP: 469, USD: 15 }, pending: { GBP: 2315, USD: 397 }, total_gbp: 480, total_pending_gbp: 2601, fetchedAt }
  // FX rates (cached)
  fxRates: null, // { base: 'GBP', rates: { EUR: 1.18, USD: 1.27 }, fetchedAt }

  // Auth
  authToken: null,
  authTokenExpiresAt: null,
  authTokenCapturedAt: null,
  userId: null
};

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}
async function setSettings(updates) {
  await chrome.storage.local.set(updates);
}

// ============================================================
// Icon
// ============================================================

async function updateIcon(state) {
  const map = {
    running: { 16:'icons/icon-running-16.png',32:'icons/icon-running-32.png',48:'icons/icon-running-48.png',128:'icons/icon-running-128.png' },
    stopped: { 16:'icons/icon-stopped-16.png',32:'icons/icon-stopped-32.png',48:'icons/icon-stopped-48.png',128:'icons/icon-stopped-128.png' },
    paused:  { 16:'icons/icon-paused-16.png', 32:'icons/icon-paused-32.png', 48:'icons/icon-paused-48.png', 128:'icons/icon-paused-128.png' }
  };
  try {
    await chrome.action.setIcon({ path: map[state] });
    await chrome.action.setTitle({ title: ({
      running: 'Prolific Watcher – Aktiv',
      stopped: 'Prolific Watcher – Gestoppt',
      paused:  'Prolific Watcher – Pausiert'
    })[state] });
  } catch (e) { console.error(e); }
}

// ============================================================
// Schedule
// ============================================================

function isWithinSchedule(s) {
  if (!s.scheduleEnabled) return true;
  const now = new Date();
  const cur = now.getHours()*60 + now.getMinutes();
  const [sh,sm] = s.scheduleStart.split(':').map(Number);
  const [eh,em] = s.scheduleEnd.split(':').map(Number);
  const start = sh*60+sm, end = eh*60+em;
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end;
}

// ============================================================
// Token Management
// ============================================================

function isTokenValid(s) {
  if (!s.authToken) return false;
  if (!s.authTokenExpiresAt) return true;
  return Date.now() < s.authTokenExpiresAt - 2*60*1000;
}

function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch (e) {
    return null;
  }
}

function extractUserIdFromToken(token) {
  const payload = decodeJwt(token);
  if (!payload) return null;
  // Prolific nutzt `externalUserId` für die interne User-ID
  // `sub` enthält die Auth0-ID (Format "auth0|UUID"), nicht die Prolific-ID
  let userId = payload.externalUserId || payload.user_id || payload.uid || null;
  if (!userId && payload.sub && typeof payload.sub === 'string' && payload.sub.includes('|')) {
    const parts = payload.sub.split('|');
    const last = parts[parts.length - 1];
    if (/^[a-f0-9]{24}$/i.test(last)) userId = last;
  }
  return userId;
}

async function tryRefreshTokenFromTab() {
  /**
   * Versucht Token aus offenen Prolific-Tabs zu holen.
   * Returns: 'success' | 'no_tab' | 'tab_unresponsive'
   */
  try {
    const tabs = await chrome.tabs.query({ url: 'https://app.prolific.com/*' });
    if (tabs.length === 0) return 'no_tab';

    let anyResponded = false;
    for (const tab of tabs) {
      try {
        const r = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_TOKEN' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
        if (r && r.ok && r.token) {
          anyResponded = true;
          const userIdFromContent = r.token.userId;
          const userIdFromJwt = extractUserIdFromToken(r.token.accessToken);
          const userId = userIdFromContent || userIdFromJwt || (await getSettings()).userId;
          await setSettings({
            authToken: r.token.accessToken,
            authTokenExpiresAt: r.token.expiresAt,
            authTokenCapturedAt: r.token.capturedAt,
            userId
          });
          return 'success';
        }
      } catch (e) {
        // Tab existiert aber Content-Script antwortet nicht (eingefroren/abgestürzt)
      }
    }
    return anyResponded ? 'success' : 'tab_unresponsive';
  } catch (e) {
    console.error('Tab refresh failed:', e);
    return 'no_tab';
  }
}

// ============================================================
// Auth Errors
// ============================================================

async function handleAuthError(reason = 'Token fehlt oder abgelaufen.') {
  const settings = await getSettings();
  // Wenn bereits Auth-Error-State aktiv ist UND die Notification noch da, nicht doppelt
  // Sonst aber IMMER Notification anzeigen
  await setSettings({
    lastStatus: 'auth_error',
    lastError: reason,
    lastCheck: new Date().toISOString()
  });
  await updateIcon('stopped');
  await stopPolling();

  // Notification: konkrete Diagnose anzeigen
  await chrome.notifications.clear(NOTIF_AUTH_ERROR);
  await chrome.notifications.create(NOTIF_AUTH_ERROR, {
    type: 'basic',
    iconUrl: 'icons/icon-stopped-128.png',
    title: '⚠ Prolific Watcher: Login erforderlich',
    message: reason.length > 0 ? reason : 'Bitte öffne Prolific und melde dich an.',
    contextMessage: 'Klicken zum Öffnen.',
    priority: 2,
    requireInteraction: true
  });
}

// ============================================================
// Polling-Steuerung (Alarms für ≥1 Min, setTimeout+Keepalive für <1 Min)
// ============================================================

async function setupPollingTimer(intervalMinutes) {
  // Erst alles stoppen
  await clearPollingTimer();

  if (intervalMinutes >= SUBMINUTE_THRESHOLD_MIN) {
    // Standard-Modus: chrome.alarms (energieeffizient)
    await chrome.alarms.create(ALARM_POLL, {
      delayInMinutes: 0.05,
      periodInMinutes: intervalMinutes
    });
  } else {
    // Sub-Minute-Modus: setTimeout-Schleife + Keepalive
    startKeepalive();
    scheduleSubMinuteTick(intervalMinutes);
  }
}

async function clearPollingTimer() {
  await chrome.alarms.clear(ALARM_POLL);
  if (subMinuteTimer !== null) {
    clearTimeout(subMinuteTimer);
    subMinuteTimer = null;
  }
  stopKeepalive();
}

function scheduleSubMinuteTick(intervalMinutes) {
  const delayMs = Math.max(1000, Math.round(intervalMinutes * 60 * 1000));
  if (subMinuteTimer !== null) clearTimeout(subMinuteTimer);
  subMinuteTimer = setTimeout(async () => {
    try {
      await checkForStudies();
    } catch (e) {
      console.warn('[Polling] Fehler:', e);
    }
    // Nach jedem Tick aktuelle Settings holen (Interval könnte sich geändert haben)
    const s = await getSettings();
    if (s.isRunning && s.intervalMinutes < SUBMINUTE_THRESHOLD_MIN) {
      scheduleSubMinuteTick(s.intervalMinutes);
    } else if (s.isRunning) {
      // Auf Alarms umgeschaltet
      await setupPollingTimer(s.intervalMinutes);
    }
  }, delayMs);
}

function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }, KEEPALIVE_INTERVAL_SEC * 1000);
}

function stopKeepalive() {
  if (keepaliveInterval !== null) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}


async function handleAuthSuccess(prev) {
  if (prev.lastStatus === 'auth_error' && prev.isRunning) {
    await setupPollingTimer(prev.intervalMinutes);
  }
  await chrome.notifications.clear(NOTIF_AUTH_ERROR);
}

// ============================================================
// API Call (generisch)
// ============================================================

async function callProlificAPI(url) {
  let s = await getSettings();
  if (!isTokenValid(s)) {
    if (await tryRefreshTokenFromTab()) s = await getSettings();
  }
  if (!s.authToken) {
    return { ok: false, status: 0, error: 'no_token', errorMessage: 'Kein Login-Token vorhanden. Bitte Prolific öffnen und einloggen.' };
  }

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Authorization': `Bearer ${s.authToken}`,
    'Origin': 'https://app.prolific.com',
    'Referer': 'https://app.prolific.com/'
  };

  function buildErrorMessage(status, body, urlContext) {
    const isUserSpecific = urlContext.includes('/users/');

    switch (status) {
      case 401:
        return 'Login abgelaufen – bitte Prolific-Tab öffnen und ggf. neu einloggen.';
      case 403:
        return 'Zugriff verweigert. Token ist möglicherweise nicht mehr gültig.';
      case 404:
        if (isUserSpecific) {
          return 'User-Endpoint nicht gefunden. Wahrscheinlich ist die gespeicherte User-ID falsch oder leer. Bitte Prolific-Tab refreshen.';
        }
        return 'Endpoint nicht gefunden. Prolific hat möglicherweise die API geändert.';
      case 429:
        return 'Zu viele Anfragen – Prolific drosselt uns. Bitte ein paar Minuten warten.';
      case 500:
      case 502:
      case 503:
      case 504:
        return `Prolific-Server-Fehler (${status}). Versuch's später nochmal.`;
      default:
        return `Unerwarteter Fehler (HTTP ${status}). ${body ? body.substring(0, 100) : ''}`;
    }
  }

  async function readBodySafe(response) {
    try {
      const text = await response.clone().text();
      return text.substring(0, 500);
    } catch (e) {
      return '';
    }
  }

  try {
    const response = await fetch(url, { method: 'GET', headers });

    // 401/403/404 können alle Auth-bedingt sein
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const refreshResult = await tryRefreshTokenFromTab();
      if (refreshResult === 'success') {
        const fresh = await getSettings();
        const retry = await fetch(url, {
          method: 'GET',
          headers: { ...headers, 'Authorization': `Bearer ${fresh.authToken}` }
        });
        if (retry.ok) return { ok: true, status: retry.status, data: await retry.json() };
        const body = await readBodySafe(retry);
        const msg = buildErrorMessage(retry.status, body, url);
        return { ok: false, status: retry.status, error: `HTTP ${retry.status}`, errorMessage: msg };
      }

      // Refresh nicht möglich → eindeutige Auth-Diagnose
      let authMessage;
      if (refreshResult === 'no_tab') {
        authMessage = 'Login-Token abgelaufen und kein Prolific-Tab offen. Bitte Prolific öffnen.';
      } else if (refreshResult === 'tab_unresponsive') {
        authMessage = 'Prolific-Tab ist offen aber reagiert nicht. Bitte F5 drücken.';
      } else {
        authMessage = buildErrorMessage(response.status, await readBodySafe(response), url);
      }
      // Diese Situation IMMER als "unauthorized" markieren, damit handleAuthError() greift
      return { ok: false, status: response.status, error: 'unauthorized', errorMessage: authMessage };
    }
    if (!response.ok) {
      const body = await readBodySafe(response);
      const msg = buildErrorMessage(response.status, body, url);
      return { ok: false, status: response.status, error: `HTTP ${response.status}`, errorMessage: msg };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, errorMessage: `Netzwerkfehler: ${e.message}` };
  }
}

// ============================================================
// FX Rates (Frankfurter.app)
// ============================================================

async function fetchFxRates() {
  try {
    // GBP → EUR + USD (für Anzeige der EUR-Equivalente)
    const response = await fetch(`${FX_API_URL}?base=GBP&symbols=EUR,USD`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.rates) {
      const fxRates = {
        base: 'GBP',
        rates: data.rates, // { EUR: 1.18, USD: 1.27 }
        fetchedAt: new Date().toISOString()
      };
      await setSettings({ fxRates });
      return fxRates;
    }
  } catch (e) {
    console.error('FX fetch failed:', e);
  }
  return null;
}

async function getFxRates() {
  const s = await getSettings();
  if (s.fxRates && s.fxRates.fetchedAt) {
    const ageHours = (Date.now() - new Date(s.fxRates.fetchedAt).getTime()) / 3600000;
    if (ageHours < 24) return s.fxRates;
  }
  return await fetchFxRates();
}

// Konvertiert beliebige Währung → GBP (in Cent/Pence)
function convertToGbp(amountInMinor, currency, fxRates) {
  if (!amountInMinor) return 0;
  if (currency === 'GBP') return amountInMinor;
  if (!fxRates || !fxRates.rates) return amountInMinor; // Fallback: keine Umrechnung
  const rate = fxRates.rates[currency];
  if (!rate) return amountInMinor;
  // amountInMinor ist Cent → erst zu Major konvertieren, dann via Rate (Rate ist GBP → currency)
  // Also: GBP_minor = currency_minor / rate
  return Math.round(amountInMinor / rate);
}

// Konvertiert Cent/Pence → Major (für Anzeige)
function toMajor(minor) {
  return (minor || 0) / 100;
}

// ============================================================
// Studies Polling (unverändert in Logik)
// ============================================================

function studyToRecord(study) {
  // Currency aus dem Prolific-Datensatz - manchmal heißt es .currency_code, manchmal .currency,
  // manchmal liegt es in einem nested-Objekt
  let currency = study.currency || study.currency_code || null;
  if (!currency && study.reward_currency_code) currency = study.reward_currency_code;
  if (!currency) currency = 'GBP'; // Default

  return {
    id: study.id,
    name: study.name || study.internal_name || 'Unbenannte Studie',
    reward: study.reward != null ? study.reward : null,
    reward_minor: study.reward != null ? study.reward : null, // Alias für Klarheit
    reward_currency: currency,
    time: study.estimated_completion_time != null ? study.estimated_completion_time : null,
    places: study.total_available_places != null ? study.total_available_places : null,
    rph: study.reward_per_hour != null ? study.reward_per_hour : null
  };
}

async function processStudies(currentStudies, source = 'background') {
  /**
   * Source kann sein:
   * - 'background': Standard-Polling vom Service Worker (Bearer-Token)
   * - 'content_live': Live-Polling aus dem Prolific-Tab (Cookie-Auth)
   *
   * Wenn eine Notification rausging und die Studie beim nächsten Check
   * nicht mehr da ist → markiere als "expired", damit das UI das anzeigen kann.
   */
  const settings = await getSettings();
  const history = { ...(settings.studyHistory || {}) };
  const now = new Date().toISOString();
  const currentIds = new Set(currentStudies.map(s => s.id));
  const newOrReactivated = [];

  for (const study of currentStudies) {
    const rec = studyToRecord(study);
    const existing = history[study.id];
    if (!existing) {
      history[study.id] = {
        ...rec, firstSeen: now, lastSeen: now,
        isActive: true, dismissed: false, timesNotified: 1,
        expired: false, lastVerifiedAt: now, verifiedBy: source
      };
      newOrReactivated.push(history[study.id]);
    } else {
      const wasInactive = !existing.isActive;
      history[study.id] = {
        ...existing, ...rec,
        lastSeen: now, isActive: true, expired: false,
        lastVerifiedAt: now, verifiedBy: source
      };
      if (wasInactive) {
        history[study.id].dismissed = false;
        history[study.id].timesNotified = (existing.timesNotified || 0) + 1;
        newOrReactivated.push(history[study.id]);
      }
    }
  }

  // Studien die nicht mehr in der Liste sind: deaktivieren + ggf. expired-Status
  for (const id of Object.keys(history)) {
    if (!currentIds.has(id) && history[id].isActive) {
      history[id].isActive = false;
      // Wenn wir für diese Studie eine offene Notification haben → markiere expired
      history[id].expired = true;
      history[id].expiredAt = now;
    }
  }

  // Re-Check vor Notification: prüfen ob neue Studie wirklich noch existiert
  // (nur sinnvoll wenn wir grade vom Background pollen; Live-Polls sind schon frisch)
  for (const study of newOrReactivated) {
    await sendStudyNotification(study, settings);
  }

  // Wenn Studien als "expired" markiert wurden, die noch offene Notifications haben:
  // Notification mit Warntext aktualisieren oder neue Info-Notification senden
  for (const id of Object.keys(history)) {
    if (history[id].expired && history[id].expiredAt === now && !history[id].dismissed) {
      await markNotificationExpired(history[id]);
    }
  }

  const activeCount = Object.values(history).filter(s => s.isActive).length;
  const totalNotifications = Object.values(history).reduce(
    (sum, s) => sum + (s.timesNotified || 0), 0
  );

  await setSettings({
    studyHistory: history,
    activeStudyCount: activeCount,
    totalNotificationsSent: totalNotifications,
    lastLiveUpdate: source === 'content_live' ? now : settings.lastLiveUpdate
  });
}

async function markNotificationExpired(study) {
  /**
   * Wenn eine offene Notification existiert und die Studie ist weg,
   * aktualisieren wir die Notification, damit User direkt sieht "abgelaufen".
   */
  const id = NOTIF_PREFIX_STUDY + study.id;
  try {
    chrome.notifications.update(id, {
      title: '⏱ Abgelaufen: ' + (study.name || 'Studie'),
      message: '(War: ' + buildNotificationMessage(study) + ')',
      contextMessage: 'Studie ist nicht mehr verfügbar.',
      priority: 0
    }, (wasUpdated) => {
      // Bei chrome.runtime.lastError ignorieren - Notification ist vielleicht
      // schon weg, das ist OK
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}

async function checkForStudies() {
  const settings = await getSettings();
  if (!settings.isRunning) return;
  if (!isWithinSchedule(settings)) {
    await setSettings({ lastStatus: 'paused', lastCheck: new Date().toISOString() });
    await updateIcon('paused');
    return;
  }

  // Wenn Live-Mode kürzlich aktiv war (< 10 Sek), Service-Worker-Poll überspringen.
  // Live-Polling im Tab ist viel frischer.
  if (settings.lastLiveUpdate) {
    const ageMs = Date.now() - new Date(settings.lastLiveUpdate).getTime();
    if (ageMs < 10000) {
      // Live-Mode aktiv → nur Token-Refresh-Check, keine API-Calls
      await setSettings({ lastCheck: new Date().toISOString() });
      return;
    }
  }

  const result = await callProlificAPI(PROLIFIC_STUDIES_URL);
  if (!result.ok) {
    if (['no_token','unauthorized','auth_failed_after_refresh'].includes(result.error)) {
      await handleAuthError(result.errorMessage || 'Nicht eingeloggt oder Session abgelaufen.');
      return;
    }
    await setSettings({
      lastStatus: 'error',
      lastError: result.errorMessage || result.error || `HTTP ${result.status}`,
      lastCheck: new Date().toISOString()
    });
    await updateIcon('stopped');
    return;
  }
  const studies = result.data.results || [];
  const wasAuthError = settings.lastStatus === 'auth_error';
  await setSettings({ lastStatus: 'active', lastCheck: new Date().toISOString(), lastError: null });
  await updateIcon('running');
  if (wasAuthError) await handleAuthSuccess(settings);
  else await chrome.notifications.clear(NOTIF_AUTH_ERROR);
  await processStudies(studies, 'background');
}

async function checkAuthOnly() {
  const settings = await getSettings();
  if (!settings.isRunning) return;
  const result = await callProlificAPI(PROLIFIC_STUDIES_URL);
  if (!result.ok) {
    if (['no_token','unauthorized','auth_failed_after_refresh'].includes(result.error)) {
      await handleAuthError(result.errorMessage || 'Nicht eingeloggt oder Session abgelaufen.');
    }
    return;
  }
  if (settings.lastStatus === 'auth_error') {
    await setSettings({ lastStatus: 'active' });
    await handleAuthSuccess(settings);
    await updateIcon('running');
  }
}

// ============================================================
// EARNINGS SYNC (NEW v1.4)
// ============================================================

function submissionToRecord(sub) {
  // Screened-Out-Payments: Ausgleich, wenn nach Briefing nicht angenommen
  const screenedOutSum = (sub.screened_out_payments || []).reduce((total, p) => {
    return total + (p.amount || 0);
  }, 0);

  // Adjustments: Logik je nach Höhe
  // - Adjustment >= Base-Reward: Nachzahlung (additiv)
  //   z.B. Reward £1,15 + Adjustment £1,56 → Gesamt £2,71
  // - Adjustment < Base-Reward: Korrektur (ersetzt Base)
  //   z.B. Reward £0,75 → Adjustment £0,26 → finaler Reward £0,26
  // Empirisch verifiziert mit Prolifics „Total earned"-Summe.
  const adjustmentSum = (sub.submission_adjustments || []).reduce((total, a) => {
    return total + (a.amount || 0);
  }, 0);

  // Bonus-Zahlungen vom Researcher (immer additiv)
  const bonusSum = (sub.submission_bonuses || []).reduce((sum, b) => {
    return sum + (b.amount || 0);
  }, 0);

  // Original-Reward
  const baseReward = sub.submission_reward?.amount || 0;
  const status = sub.status || 'UNKNOWN';
  const isScreenedOut = status === 'SCREENED-OUT' || status === 'SCREENED OUT';

  // GESAMT-Verdienst pro Submission:
  let totalRewardMinor;
  if (isScreenedOut) {
    // SCREENED-OUT: NUR die Screened-Out-Zahlung
    totalRewardMinor = screenedOutSum;
  } else if (adjustmentSum > 0 && adjustmentSum < baseReward) {
    // Adjustment ist Korrektur nach unten → ersetzt baseReward
    totalRewardMinor = adjustmentSum + bonusSum + screenedOutSum;
  } else {
    // Normal: baseReward + adjustments + bonuses
    totalRewardMinor = baseReward + adjustmentSum + bonusSum + screenedOutSum;
  }

  // Currency-Erkennung mit Fallback-Kette
  const currency = sub.submission_reward?.currency
    || (sub.screened_out_payments?.[0]?.currency)
    || (sub.submission_adjustments?.[0]?.currency)
    || 'GBP';

  // Adjustment-Typ für Reporting/CSV
  let adjustmentType = null;
  if (adjustmentSum > 0) {
    adjustmentType = adjustmentSum >= baseReward ? 'additive' : 'replacement';
  }

  return {
    provider: 'prolific',
    id: sub.id,
    study_id: sub.study?.id || null,
    study_name: sub.study?.name || 'Unbekannte Studie',
    researcher_name: sub.study?.researcher?.name || null,
    researcher_country: sub.study?.researcher?.country || null,
    institution: sub.study?.researcher?.institution?.name || null,
    reward_amount_minor: totalRewardMinor,
    reward_currency: currency,
    // Aufschlüsselung für CSV-Export & Transparenz
    base_reward_minor: baseReward,
    adjustment_amount_minor: adjustmentSum,
    adjustment_type: adjustmentType, // 'additive' oder 'replacement' oder null
    bonus_amount_minor: bonusSum,
    screened_out_amount_minor: screenedOutSum,
    status,
    started_at: sub.started_at || null,
    completed_at: sub.completed_at || null,
    time_taken_seconds: sub.time_taken ? parseFloat(sub.time_taken) : null,
    is_complete: !!sub.is_complete,
    return_requested: sub.return_requested || null,
    study_code: sub.study_code || null
  };
}

async function fetchAllSubmissions(maxPages = 20) {
  /**
   * Holt alle Submissions paginiert ab.
   * Stoppt entweder wenn keine `next`-Page mehr da ist
   * oder wenn maxPages erreicht ist (Sicherheitslimit).
   */
  const all = [];
  let page = 1;
  let count = 0;

  while (page <= maxPages) {
    const url = `${PROLIFIC_SUBMISSIONS_URL}?page=${page}&ordering=-started_at&page_size=20`;
    const result = await callProlificAPI(url);
    if (!result.ok) {
      throw new Error(result.error || 'fetch failed');
    }
    const results = result.data.results || [];
    all.push(...results);
    count = result.data.meta?.count || all.length;

    const next = result.data._links?.next?.href;
    if (!next) break;
    page++;
  }

  return { submissions: all, totalCount: count };
}

async function syncEarnings(triggerSource = 'manual') {
  const settings = await getSettings();

  // Token validieren
  if (!isTokenValid(settings)) {
    if (!await tryRefreshTokenFromTab()) {
      await setSettings({
        earningsLastSyncError: 'Kein gültiger Login-Token.',
        earningsLastSync: new Date().toISOString()
      });
      return { ok: false, error: 'no_token' };
    }
  }

  // User-ID erneut versuchen, falls noch nicht da
  let currentSettings = await getSettings();
  if (!currentSettings.userId) {
    await tryRefreshTokenFromTab();
    currentSettings = await getSettings();
  }

  try {
    // 1) Submissions paginiert holen
    const { submissions, totalCount } = await fetchAllSubmissions();

    // 2) In Map konvertieren (id → record)
    const submissionsMap = {};
    for (const sub of submissions) {
      submissionsMap[sub.id] = submissionToRecord(sub);
    }

    // 3) Balance abrufen (User-ID nötig)
    let balance = null;
    let balanceError = null;
    const userId = currentSettings.userId;
    if (userId) {
      const balanceResult = await callProlificAPI(`${PROLIFIC_API_BASE}/users/${userId}/balance/`);
      if (balanceResult.ok) {
        balance = parseBalance(balanceResult.data);
      } else {
        balanceError = balanceResult.errorMessage || `Balance-API: ${balanceResult.error || balanceResult.status}`;
        console.warn('[Prolific Watcher]', balanceError);
      }
    } else {
      balanceError = 'User-ID nicht erkannt. Öffne Prolific und drücke F5, dann erneut synchronisieren.';
      console.warn('[Prolific Watcher]', balanceError);
    }

    // 4) FX rates auffrischen (für EUR-Anzeige)
    await getFxRates();

    // 5) Speichern
    await setSettings({
      submissions: submissionsMap,
      balance,
      earningsLastSync: new Date().toISOString(),
      earningsLastSyncError: balanceError // null wenn alles OK
    });

    return {
      ok: true,
      count: totalCount,
      fetched: submissions.length,
      balanceFetched: !!balance,
      triggerSource
    };
  } catch (e) {
    await setSettings({
      earningsLastSyncError: e.message,
      earningsLastSync: new Date().toISOString()
    });
    return { ok: false, error: e.message };
  }
}

function parseBalance(data) {
  /**
   * Konvertiert die Prolific-Balance-API-Response in unser internes Format.
   * Liefert Beträge sowohl pro Währung getrennt als auch als GBP-Total-Estimate.
   */
  if (!data) return null;

  const approved_per_currency = {};
  for (const c of (data.balance_by_currency || [])) {
    approved_per_currency[c.currency] = c.amount; // in Cent/Pence
  }

  const pending_per_currency = {};
  for (const c of (data.pending_balance_by_currency || [])) {
    pending_per_currency[c.currency] = c.amount;
  }

  return {
    approved_per_currency,
    pending_per_currency,
    total_gbp: data.estimated_total_balance?.amount || 0,
    total_pending_gbp: data.estimated_total_pending_balance?.amount || 0,
    fetchedAt: new Date().toISOString()
  };
}

// ============================================================
// Notifications
// ============================================================

function buildNotificationMessage(study) {
  const parts = [];
  if (study.reward != null) parts.push(`£${(study.reward/100).toFixed(2)}`);
  if (study.time != null) parts.push(`${study.time} Min`);
  if (study.places != null) parts.push(`${study.places} Plätze`);
  if (study.rph != null) parts.push(`£${(study.rph/100).toFixed(2)}/h`);
  return parts.length > 0 ? parts.join(' · ') : 'Klicken zum Öffnen';
}

async function sendStudyNotification(study, settings) {
  const id = NOTIF_PREFIX_STUDY + study.id;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icons/icon-running-128.png',
      title: '🟢 ' + (study.name || 'Neue Prolific-Studie'),
      message: buildNotificationMessage(study),
      contextMessage: 'Klicken: öffnen & Polling stoppen',
      priority: 2,
      requireInteraction: !!settings.notificationPersistent
    });
  } catch (e) { console.error('Notification error:', e); }
}

async function sendTestNotification() {
  const settings = await getSettings();
  await chrome.notifications.clear(NOTIF_TEST);
  await chrome.notifications.create(NOTIF_TEST, {
    type: 'basic',
    iconUrl: 'icons/icon-running-128.png',
    title: '🟢 Test-Studie: Wenn du das siehst, klappt\'s',
    message: '£3.50 · 12 Min · 25 Plätze · £17.50/h',
    contextMessage: 'Test-Benachrichtigung',
    priority: 2,
    requireInteraction: !!settings.notificationPersistent
  });
}

// ============================================================
// Lifecycle
// ============================================================

async function startPolling() {
  const s = await getSettings();
  await clearPollingTimer();
  await chrome.alarms.clear(ALARM_AUTH);
  await chrome.alarms.clear(ALARM_EARNINGS);

  await setupPollingTimer(s.intervalMinutes);
  await chrome.alarms.create(ALARM_AUTH, { delayInMinutes: 15, periodInMinutes: 15 });
  if (s.earningsEnabled) {
    await chrome.alarms.create(ALARM_EARNINGS, {
      delayInMinutes: 0.5,
      periodInMinutes: s.earningsSyncIntervalHours * 60
    });
  }

  await setSettings({ isRunning: true, lastStatus: 'active' });
  await updateIcon('running');
  await tryRefreshTokenFromTab();
  checkForStudies();

  if (s.earningsEnabled) {
    syncEarnings('start');
  }
}

async function stopPolling() {
  await clearPollingTimer();
  await chrome.alarms.clear(ALARM_AUTH);
  await chrome.alarms.clear(ALARM_EARNINGS);
  await setSettings({ isRunning: false, lastStatus: 'idle' });
  await updateIcon('stopped');
  const all = await chrome.notifications.getAll();
  for (const id of Object.keys(all)) {
    if (id.startsWith(NOTIF_PREFIX_STUDY) || id === NOTIF_AUTH_ERROR || id === NOTIF_TEST) {
      chrome.notifications.clear(id);
    }
  }
}

// ============================================================
// Events
// ============================================================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) checkForStudies();
  else if (alarm.name === ALARM_AUTH) checkAuthOnly();
  else if (alarm.name === ALARM_EARNINGS) syncEarnings('alarm');
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id === NOTIF_AUTH_ERROR) {
    chrome.tabs.create({ url: PROLIFIC_APP_STUDIES_URL });
    chrome.notifications.clear(id);
    return;
  }
  if (id === NOTIF_TEST) {
    chrome.notifications.clear(id);
    return;
  }
  if (id.startsWith(NOTIF_PREFIX_STUDY)) {
    const studyId = id.replace(NOTIF_PREFIX_STUDY, '');
    const settings = await getSettings();
    const study = settings.studyHistory?.[studyId];

    if (study && study.expired) {
      // Studie ist als abgelaufen markiert - statt tote Seite zu öffnen,
      // navigieren wir zur Studies-Übersicht
      chrome.tabs.create({ url: PROLIFIC_APP_STUDIES_URL });
      chrome.notifications.clear(id);
      // KEIN stopPolling - die Studie war ja nicht mehr verfügbar
      return;
    }

    chrome.tabs.create({ url: `${PROLIFIC_APP_URL}studies/${studyId}` });
    chrome.notifications.clear(id);
    await stopPolling();
  }
});

chrome.notifications.onClosed.addListener(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'TOKEN_UPDATE':
          {
            const userIdFromContent = msg.payload.userId;
            const userIdFromJwt = extractUserIdFromToken(msg.payload.accessToken);
            const userId = userIdFromContent || userIdFromJwt || (await getSettings()).userId;
            const prevSettings = await getSettings();
            await setSettings({
              authToken: msg.payload.accessToken,
              authTokenExpiresAt: msg.payload.expiresAt,
              authTokenCapturedAt: msg.payload.capturedAt,
              userId
            });
            const s = await getSettings();
            // Auto-Recovery: Wenn wir wegen auth_error pausiert hatten,
            // sofort Polling wieder hochfahren UND Notification wegräumen
            if (s.isRunning && s.lastStatus === 'auth_error') {
              await setupPollingTimer(s.intervalMinutes);
              await chrome.alarms.create(ALARM_AUTH, {
                delayInMinutes: 15,
                periodInMinutes: 15
              });
              await setSettings({ lastStatus: 'active', lastError: null });
              await updateIcon('running');
              await chrome.notifications.clear(NOTIF_AUTH_ERROR);
              checkForStudies();
              if (s.earningsEnabled) {
                syncEarnings('auto_recovery');
              }
            }
          }
          sendResponse({ ok: true });
          break;
        case 'TOKEN_MISSING':
          await setSettings({ authToken: null });
          sendResponse({ ok: true });
          break;
        case 'LIVE_STUDIES':
          {
            // Content-Script meldet die aktuelle Studien-Liste vom Prolific-Tab.
            // Diese ist sehr frisch (Cookie-Auth, alle paar Sek im Tab),
            // also nutzen wir sie als "Ground Truth" und können Background-Polling
            // pausieren solange ein Tab aktiv live updated.
            const s = await getSettings();
            if (s.isRunning) {
              await processStudies(msg.payload.studies || [], 'content_live');
              // Wenn wir grade einen auth_error hatten, gilt der Live-Mode als Recovery
              if (s.lastStatus === 'auth_error') {
                await setSettings({ lastStatus: 'active', lastError: null });
                await updateIcon('running');
                await chrome.notifications.clear(NOTIF_AUTH_ERROR);
              }
            }
          }
          sendResponse({ ok: true });
          break;
        case 'START': await startPolling(); sendResponse({ ok: true }); break;
        case 'STOP': await stopPolling(); sendResponse({ ok: true }); break;
        case 'UPDATE_SETTINGS':
          await setSettings(msg.payload);
          {
            const s = await getSettings();
            if (s.isRunning && s.lastStatus !== 'auth_error') {
              // Interval kann sich geändert haben → Polling-Timer komplett neu setzen
              await setupPollingTimer(s.intervalMinutes);
            }
          }
          sendResponse({ ok: true });
          break;
        case 'GET_STATE':
          {
            const s = await getSettings();
            const safe = { ...s };
            delete safe.authToken;
            safe.hasToken = !!s.authToken;
            sendResponse({ ok: true, state: safe });
          }
          break;
        case 'CHECK_NOW':
          await tryRefreshTokenFromTab();
          await checkForStudies();
          sendResponse({ ok: true });
          break;
        case 'TEST_NOTIFICATION':
          await sendTestNotification();
          sendResponse({ ok: true });
          break;
        case 'DISMISS_STUDY':
          {
            const s = await getSettings();
            const h = { ...s.studyHistory };
            if (h[msg.payload.id]) {
              h[msg.payload.id].dismissed = true;
              await setSettings({ studyHistory: h });
            }
            sendResponse({ ok: true });
          }
          break;
        case 'DISMISS_ALL_STUDIES':
          {
            const s = await getSettings();
            const h = { ...s.studyHistory };
            for (const id of Object.keys(h)) h[id].dismissed = true;
            await setSettings({ studyHistory: h });
            sendResponse({ ok: true });
          }
          break;
        case 'CLEAR_HISTORY':
        case 'RESET_STUDY_HISTORY':
          await setSettings({
            studyHistory: {}, totalNotificationsSent: 0, activeStudyCount: 0
          });
          sendResponse({ ok: true });
          break;

        // ----- v1.4: Earnings -----
        case 'SYNC_EARNINGS':
          {
            const result = await syncEarnings('manual');
            sendResponse({ ok: result.ok, ...result });
          }
          break;
        case 'EXPORT_DATA':
          {
            const result = await buildExport(msg.payload);
            sendResponse({ ok: true, ...result });
          }
          break;
        case 'CLEAR_EARNINGS':
          await setSettings({
            submissions: {}, balance: null,
            earningsLastSync: null, earningsLastSyncError: null
          });
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false, error: 'unknown' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await updateIcon(s.isRunning ? 'running' : 'stopped');
  // Falls Sub-Minute-Polling konfiguriert ist und plugin running, Timer neu starten
  if (s.isRunning && s.intervalMinutes < SUBMINUTE_THRESHOLD_MIN) {
    await setupPollingTimer(s.intervalMinutes);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  if (s.isRunning) await startPolling();
  else await updateIcon('stopped');
});

// Service-Worker-Wakeup: Falls Sub-Minute-Polling läuft, aber Timer weg ist
// (passiert wenn Service Worker zwischendurch trotzdem eingeschlafen ist),
// reaktivieren wir das Polling
(async () => {
  const s = await getSettings();
  if (s.isRunning && s.intervalMinutes < SUBMINUTE_THRESHOLD_MIN && subMinuteTimer === null) {
    await setupPollingTimer(s.intervalMinutes);
  }
})();

// ============================================================
// Export-Funktion
// ============================================================

function getDateRange(rangeType) {
  /**
   * rangeType: 'current_month' | 'previous_month' | 'all' | 'custom'
   * For 'custom': msg.payload.from & msg.payload.to (ISO Datums-Strings)
   */
  const now = new Date();
  if (rangeType === 'current_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from, to };
  }
  if (rangeType === 'previous_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from, to };
  }
  return { from: null, to: null }; // all
}

async function buildExport(payload = {}) {
  const settings = await getSettings();
  const submissions = Object.values(settings.submissions || {});
  const fxRates = settings.fxRates;

  const range = payload.rangeType === 'custom'
    ? { from: payload.from ? new Date(payload.from) : null, to: payload.to ? new Date(payload.to) : null }
    : getDateRange(payload.rangeType || 'all');

  // Filtern nach Datum (started_at)
  let filtered = submissions;
  if (range.from || range.to) {
    filtered = submissions.filter(s => {
      if (!s.started_at) return false;
      const d = new Date(s.started_at);
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });
  }

  // CSV bauen (Excel-tauglich: Semikolon, UTF-8 BOM, Komma als Dezimal)
  const csv = buildCsv(filtered, fxRates);

  // JSON bauen (komplettes Backup)
  const json = JSON.stringify({
    exportedAt: new Date().toISOString(),
    rangeType: payload.rangeType || 'all',
    range: { from: range.from?.toISOString(), to: range.to?.toISOString() },
    fxRates,
    balance: settings.balance,
    submissions: filtered,
    counts: {
      total: filtered.length,
      approved: filtered.filter(s => s.status === 'APPROVED').length,
      awaiting: filtered.filter(s => s.status === 'AWAITING REVIEW').length,
      returned: filtered.filter(s => s.status === 'RETURNED').length
    }
  }, null, 2);

  // Filename
  const ts = new Date().toISOString().slice(0, 10);
  const rangeName = payload.rangeType || 'all';
  const csvFilename = `prolific-earnings-${rangeName}-${ts}.csv`;
  const jsonFilename = `prolific-backup-${rangeName}-${ts}.json`;

  // Download triggern (Chrome Downloads API)
  if (payload.format === 'csv' || !payload.format) {
    const csvBlob = `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + csv)}`;
    await chrome.downloads.download({ url: csvBlob, filename: csvFilename, saveAs: true });
  }
  if (payload.format === 'json') {
    const jsonBlob = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    await chrome.downloads.download({ url: jsonBlob, filename: jsonFilename, saveAs: true });
  }

  return { count: filtered.length, csvFilename, jsonFilename };
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function deNum(n) {
  // Komma als Dezimal
  if (n == null || isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',');
}

function buildCsv(submissions, fxRates) {
  const headers = [
    'Anbieter', 'Datum (Start)', 'Datum (Abschluss)',
    'Studie', 'Forscher', 'Land', 'Institution',
    'Status',
    'Reward', 'Adjustment', 'Adjustment-Typ', 'Bonus', 'Screened-Out', 'Gesamt',
    'Währung',
    'Gesamt (GBP)', 'Gesamt (EUR)',
    'Dauer (Min)', 'Studien-ID', 'Submission-ID'
  ];
  const rows = [headers.join(';')];

  const sorted = [...submissions].sort((a, b) => {
    const da = new Date(a.started_at || 0).getTime();
    const db = new Date(b.started_at || 0).getTime();
    return db - da;
  });

  for (const s of sorted) {
    const startedAt = s.started_at ? new Date(s.started_at).toLocaleString('de-DE') : '';
    const completedAt = s.completed_at ? new Date(s.completed_at).toLocaleString('de-DE') : '';
    const baseReward = toMajor(s.base_reward_minor);
    const adjustment = toMajor(s.adjustment_amount_minor);
    const adjType = s.adjustment_type === 'additive' ? 'addiert'
                  : s.adjustment_type === 'replacement' ? 'ersetzt'
                  : '';
    const bonus = toMajor(s.bonus_amount_minor);
    const screenedOut = toMajor(s.screened_out_amount_minor);
    const gesamtNative = toMajor(s.reward_amount_minor);
    const totalGbpMinor = convertToGbp(s.reward_amount_minor, s.reward_currency, fxRates);
    const totalGbp = toMajor(totalGbpMinor);
    const totalEur = fxRates?.rates?.EUR ? totalGbp * fxRates.rates.EUR : null;
    const minutes = s.time_taken_seconds ? (s.time_taken_seconds / 60) : null;

    rows.push([
      csvEscape(s.provider || 'prolific'),
      csvEscape(startedAt),
      csvEscape(completedAt),
      csvEscape(s.study_name),
      csvEscape(s.researcher_name),
      csvEscape(s.researcher_country),
      csvEscape(s.institution),
      csvEscape(s.status),
      deNum(baseReward),
      adjustment > 0 ? deNum(adjustment) : '',
      csvEscape(adjType),
      bonus > 0 ? deNum(bonus) : '',
      screenedOut > 0 ? deNum(screenedOut) : '',
      deNum(gesamtNative),
      csvEscape(s.reward_currency),
      deNum(totalGbp),
      totalEur != null ? deNum(totalEur) : '',
      minutes != null ? deNum(minutes) : '',
      csvEscape(s.study_id),
      csvEscape(s.id)
    ].join(';'));
  }

  return rows.join('\n');
}
