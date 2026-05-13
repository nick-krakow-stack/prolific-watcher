# Prolific Watcher v1.2

Chrome-Extension, die Prolific im Hintergrund auf neue Studien überwacht.

## ⚠ Wichtig in v1.2: Architektur-Änderung

Prolific nutzt OAuth/OIDC mit Bearer-Tokens (kein Cookie-Auth). Damit das Plugin
authentifiziert API-Anfragen senden kann, muss **mindestens einmal pro Sitzung**
ein Prolific-Tab geöffnet sein, damit das Plugin den Token aus dem Browser-Storage
lesen kann. Solange ein Tab in der Vergangenheit offen war, kann das Plugin
auch im Hintergrund weiterarbeiten – Prolific erneuert die Tokens automatisch,
und das Plugin liest sie alle 60 Sekunden frisch aus.

## Erste Inbetriebnahme

1. **Entpacken** an einen festen Ort
2. Chrome → `chrome://extensions/` → **Entwicklermodus aktivieren**
3. **„Entpackte Erweiterung laden"** → Ordner `prolific-watcher` auswählen
4. **Wichtig**: **Einen Prolific-Tab öffnen** ([app.prolific.com/studies](https://app.prolific.com/studies)) und einloggen
5. Diesen Tab kannst du danach offen lassen oder schließen – das Plugin hat den Token jetzt
6. Auf das Extension-Icon klicken → **Starten**

### Wenn der Token abläuft

Prolific-Tokens laufen typischerweise nach 60 Minuten ab. Solange du einen
Prolific-Tab offen hast, refresht der Browser den Token automatisch und das
Plugin nutzt den neuen.

Falls **kein Prolific-Tab offen** ist und der Token läuft ab:
- Plugin gibt eine Notification: „Login erforderlich"
- Klick darauf öffnet Prolific
- Sobald die Seite geladen ist, hat das Plugin wieder einen frischen Token
- Polling läuft automatisch weiter

## Features

- ⏱ Konfigurierbares Intervall (1–15 Min)
- 🟢🔴 Start/Stop direkt im Toolbar-Icon
- 🕓 Aktive Zeitfenster
- 🔔 Desktop-Notifications mit Studienname, Reward, Dauer, Plätzen
- 🖱 Klick auf Notification → öffnet Studie & stoppt Polling
- 🔐 Automatische Token-Übernahme & -Aktualisierung
- 🔁 Auto-Resume nach Re-Login

## Bedienung

| Button | Funktion |
|---|---|
| **Starten / Stoppen** | Hauptschalter |
| **Jetzt prüfen** | Sofort-Prüfung (holt auch frischen Token) |
| **Verlauf zurücksetzen** | Vergisst gemeldete Studien-IDs |

## Technische Details

- **Content-Script** auf `app.prolific.com` liest den OIDC-User-Eintrag aus
  `localStorage` (Schlüssel `oidc.user:https://auth.prolific.com:...`) und schickt
  den darin enthaltenen `access_token` an das Background-Script.
- **Background-Script** speichert Token + Ablaufzeit in `chrome.storage.local`
  und nutzt ihn im `Authorization: Bearer ...`-Header für API-Calls.
- Vor jedem API-Call wird geprüft, ob der Token noch gültig ist (mit 2 Min Puffer).
  Falls nicht: Anfrage an Content-Script in einem offenen Tab → frischer Token.
- Bei 401/403 wird ein einmaliger Refresh-Versuch unternommen, bevor eine
  Auth-Notification erscheint.
- **Tokens werden niemals an Dritte gesendet** – sie liegen ausschließlich im
  lokalen Browser-Speicher der Extension.

## Troubleshooting

**Status zeigt „Login fehlt":**
→ Prolific-Tab öffnen, einloggen. Plugin holt sich automatisch den Token.

**Status zeigt „Fehler" mit HTTP 404:**
→ Bedeutet: Token ungültig oder fehlerhaft. Im Tab auf Prolific einmal F5 drücken,
dann „Jetzt prüfen" im Plugin-Popup.

**Polling startet nicht obwohl ich gestartet habe:**
→ Schau im Popup, ob der blaue Hinweis erscheint. Wenn ja: Prolific einmal öffnen.

**Plugin reagiert nicht:**
→ `chrome://extensions/` → ↻-Button bei der Extension.
