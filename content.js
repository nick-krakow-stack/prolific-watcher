// ============================================================
// Prolific Watcher - Content Script
// Liest OIDC-Token UND User-ID aus localStorage
// ============================================================

(function () {
  function findOidcKey() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('oidc.user:')) {
        return key;
      }
    }
    return null;
  }

  function extractUserIdFromHtml() {
    // Fallback: Versuch, User-ID aus dem DOM oder aus URLs auf der Seite zu lesen
    // Profil-Links auf Prolific haben oft die Form /profile/{userId}
    const links = document.querySelectorAll('a[href*="/profile/"], a[href*="/users/"]');
    for (const link of links) {
      const match = link.href.match(/(?:\/profile\/|\/users\/)([a-f0-9]{24})/i);
      if (match) return match[1];
    }
    return null;
  }

  function extractTokenAndUser() {
    try {
      const oidcKey = findOidcKey();
      if (!oidcKey) return null;

      const raw = localStorage.getItem(oidcKey);
      if (!raw) return null;

      const data = JSON.parse(raw);
      const accessToken = data && data.access_token;
      const expiresAt = data && data.expires_at;
      const tokenType = (data && data.token_type) || 'Bearer';

      if (!accessToken) return null;

      // User-ID aus profile-Objekt (OIDC Standard)
      // Prolific nutzt das Feld `externalUserId` für die interne MongoDB-User-ID
      // (NICHT `sub` - das ist die Auth0-ID im Format "auth0|UUID")
      let userId = null;
      if (data.profile) {
        userId = data.profile.externalUserId  // ← Prolific-spezifisch, höchste Priorität
          || data.profile.user_id
          || data.profile.id
          || null;
      }

      // Fallback 1: aus JWT decodieren
      if (!userId) {
        try {
          const parts = accessToken.split('.');
          if (parts.length === 3) {
            const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
            const decoded = JSON.parse(atob(padded));
            userId = decoded.externalUserId  // ← Prolific JWT enthält das ebenfalls
              || decoded.user_id
              || decoded.uid
              || null;
            // Wenn `sub` im Format "auth0|hex" ist, Hex-Teil extrahieren als Notfall-Fallback
            if (!userId && decoded.sub && typeof decoded.sub === 'string' && decoded.sub.includes('|')) {
              const subParts = decoded.sub.split('|');
              const last = subParts[subParts.length - 1];
              if (/^[a-f0-9]{24}$/i.test(last)) userId = last;
            }
          }
        } catch (e) {}
      }

      // Fallback 2: aus DOM (Profil-Links)
      if (!userId) {
        userId = extractUserIdFromHtml();
      }

      // Validierung: muss eine 24-stellige Hex-ID sein
      if (userId && !/^[a-f0-9]{24}$/i.test(userId)) {
        console.warn('[Prolific Watcher] User-ID hat unerwartetes Format:', userId);
        // Trotzdem speichern – Balance-API gibt eindeutigen Fehler wenn falsch
      }

      return {
        accessToken,
        expiresAt: expiresAt ? expiresAt * 1000 : null,
        tokenType,
        userId,
        capturedAt: Date.now()
      };
    } catch (e) {
      console.warn('[Prolific Watcher] Token-Extraktion fehlgeschlagen:', e);
      return null;
    }
  }

  function isTokenExpiredOrSoon(token) {
    if (!token || !token.expiresAt) return true;
    // Gilt als "bald abgelaufen" wenn weniger als 2 Min Restlaufzeit
    return Date.now() > token.expiresAt - 2 * 60 * 1000;
  }

  async function triggerTokenRefresh() {
    /**
     * Stößt einen Token-Refresh auf der Prolific-Seite an, indem wir
     * eine harmlose API-Anfrage über die Webseite triggern. Prolifics
     * eigene HTTP-Interceptors fangen den 401 ab und refreshen den Token
     * automatisch, dann wird er wieder im localStorage abgelegt.
     */
    try {
      // Wir lösen ein "storage"-Event aus, das viele SPAs zum Re-Check
      // ihres Auth-Status nutzen. Falls das nicht reicht, machen wir einen
      // echten fetch über die Seite.
      const token = extractTokenAndUser();
      if (!token) return false;

      // Direkter Fetch im Page-Kontext (nicht Extension):
      // Wenn der Token bald abläuft, hat Prolific einen oidc-client der
      // den Token via Refresh-Token erneuert. Wir warten kurz danach
      // erneut auf storage-Änderung.
      const response = await fetch('https://internal-api.prolific.com/api/v1/participant/studies/?sortBy=published_at&orderBy=asc', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Authorization': `Bearer ${token.accessToken}`
        }
      });

      // Wenn 401: Prolifics oidc-client SOLLTE jetzt den Refresh anstoßen.
      // Wir warten 2 Sek und lesen localStorage neu.
      if (response.status === 401 || response.status === 403) {
        // Page Reload als letzter Ausweg? Nein, zu invasiv.
        // Stattdessen: Warten und nochmal lesen
        await new Promise(r => setTimeout(r, 2000));
      }

      // Egal was zurückkam, jetzt nochmal Token auslesen
      const fresh = extractTokenAndUser();
      return fresh;
    } catch (e) {
      console.warn('[Prolific Watcher] Refresh-Trigger fehlgeschlagen:', e);
      return null;
    }
  }

  function sendTokenToBackground() {
    const token = extractTokenAndUser();
    if (token) {
      chrome.runtime.sendMessage(
        { type: 'TOKEN_UPDATE', payload: token },
        () => { if (chrome.runtime.lastError) { /* ignore */ } }
      );
      return true;
    } else {
      chrome.runtime.sendMessage(
        { type: 'TOKEN_MISSING' },
        () => { if (chrome.runtime.lastError) { /* ignore */ } }
      );
      return false;
    }
  }

  sendTokenToBackground();
  setInterval(sendTokenToBackground, 60 * 1000);

  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('oidc.user:')) {
      sendTokenToBackground();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'REQUEST_TOKEN') {
      const token = extractTokenAndUser();
      // Wenn Token abgelaufen/bald abgelaufen: triggern wir aktiv einen Refresh
      if (!token || isTokenExpiredOrSoon(token)) {
        triggerTokenRefresh().then(fresh => {
          sendResponse({ ok: !!fresh, token: fresh });
        });
        return true; // async response
      }
      sendResponse({ ok: !!token, token });
      return true;
    }
  });
  // ============================================================
  // LIVE POLLING im Page-Kontext
  // ============================================================
  // Statt dass der Service Worker pollt, machen wir die API-Calls direkt
  // hier im Tab. Vorteile:
  // - Aktueller Page-Token plus Cookies aus dem Prolific-Tab
  // - Höhere Frequenz möglich (alle 2-3 Sek)
  // - Kein Service-Worker-Sleep-Problem
  // - Studien werden in "Echtzeit" erkannt - sowohl neue als auch abgelaufene

  let liveTimer = null;
  let liveInterval = 3000; // 3 Sekunden Default
  let lastSentSignature = null; // null erzwingt ein erstes Update, auch bei leerer Liste

  async function pollStudiesLive() {
    try {
      let token = extractTokenAndUser();
      if (!token || isTokenExpiredOrSoon(token)) {
        token = await triggerTokenRefresh();
      }
      if (!token || !token.accessToken) {
        return;
      }

      const response = await fetch('https://internal-api.prolific.com/api/v1/participant/studies/?sortBy=published_at&orderBy=asc', {
        method: 'GET',
        credentials: 'include', // Cookies mitschicken
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Authorization': `Bearer ${token.accessToken}`
        }
      });

      if (!response.ok) {
        // Bei 401/403 versuchen wir Token-Refresh; sonst stillschweigend weiter
        if (response.status === 401 || response.status === 403) {
          await triggerTokenRefresh();
        }
        return;
      }

      const data = await response.json();
      const studies = data.results || [];

      // Signatur bauen aus den Studien-IDs, damit wir nicht jedes Mal alle Daten schicken
      const sig = studies.map(s => s.id).sort().join(',');
      if (sig === lastSentSignature) {
        // Erfolgreicher Poll ohne Studien-Änderung: Live-Heartbeat erneuern,
        // ohne die Studienliste erneut zu verarbeiten.
        chrome.runtime.sendMessage(
          { type: 'LIVE_HEARTBEAT' },
          () => { if (chrome.runtime.lastError) { /* ignore */ } }
        );
        return;
      }
      lastSentSignature = sig;

      // An Background schicken
      chrome.runtime.sendMessage(
        { type: 'LIVE_STUDIES', payload: { studies } },
        () => { if (chrome.runtime.lastError) { /* ignore */ } }
      );
    } catch (e) {
      // Netzwerkfehler → kein Drama, beim nächsten Tick neu versuchen
    }
  }

  function startLivePolling() {
    if (liveTimer !== null) return;
    // Sofort erster Poll, dann Interval
    pollStudiesLive();
    liveTimer = setInterval(pollStudiesLive, liveInterval);
  }

  function stopLivePolling() {
    if (liveTimer !== null) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  // Pausieren wenn Tab nicht sichtbar (spart Akku, kein Vorteil im Hintergrund-Tab)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab im Hintergrund → langsamer pollen (alle 15 Sek)
      stopLivePolling();
      liveInterval = 15000;
      startLivePolling();
    } else {
      // Tab im Vordergrund → schnell pollen
      stopLivePolling();
      liveInterval = 3000;
      startLivePolling();
    }
  });

  // Start automatisch nach 1 Sek (gibt Token-Init Zeit)
  setTimeout(() => {
    startLivePolling();
  }, 1000);

})();
