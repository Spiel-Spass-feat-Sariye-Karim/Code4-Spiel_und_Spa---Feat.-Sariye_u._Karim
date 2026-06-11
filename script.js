// Backend Server URL
var API_URL = 'https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com';

var game=null,which='',user=null;
var currentActivity='main'; // tracks what the user is doing for live status

/* ════════════════════════════════════════════════
   WEBSOCKET RELAY — sub-10ms multiplayer state sync
   ════════════════════════════════════════════════ */
var gameWS = null;
var gameWSLobbyId = null;

function connectGameWS(lobbyId, onMessage) {
  disconnectGameWS();
  gameWSLobbyId = lobbyId;
  try {
    var wsUrl = API_URL.replace(/^https?/, function(p){ return p === 'https' ? 'wss' : 'ws'; });
    gameWS = new WebSocket(wsUrl + '?lobby=' + lobbyId);
    gameWS.onmessage = function(e) {
      try { if (onMessage) onMessage(JSON.parse(e.data)); } catch(err) {}
    };
    gameWS.onerror = function() {};
    gameWS.onclose = function() { gameWS = null; };
  } catch(e) { gameWS = null; }
}

function sendGameWS(data) {
  if (gameWS && gameWS.readyState === 1 /* OPEN */) {
    try { gameWS.send(JSON.stringify(data)); } catch(e) {}
  }
}

function disconnectGameWS() {
  if (gameWS) { try { gameWS.close(); } catch(e) {} gameWS = null; }
  gameWSLobbyId = null;
}
var heartbeatInterval=null,requestsInterval=null,chatInterval=null;
var lastChatCount=0;
var allUsersCache=[],friendIdsSet=new Set(),sentRequestIds=new Set();
var activeChatFriend=null,privateChatInterval=null,unreadInterval=null;
var friendsList=[],unreadCounts={};
var inviteInterval=null,seenInviteIds=new Set(),inviteFirstCheck=true,lobbyAiDiff='easy',hostWaitInterval=null;
var tttBoard=Array(9).fill(''),tttOn=false,tttIsAI=false,tttAiDiff='easy';
var tttCurrentTurn='X',tttMySymbol='X',tttIsHost=true,tttLobbyId=null,tttPollInterval=null,tttLastPlaced=-1;
var tttMoveInFlight=false; // prevents poll from overwriting local state mid-send
// Connect 4
var c4PollInterval=null,c4LobbyId=null,c4IsHost=false,c4IsAI=false,c4AiDiff='easy',c4MySymbol='R',c4On=false;
// Pong
var pongPollInterval=null,pongLobbyId=null,pongIsHost=false,pongIsAI=false,pongAiDiff='easy',pongOn=false; // kept for compatibility
var elfmPollInterval=null,elfmLobbyId=null,elfmIsHost=false,elfmIsAI=false,elfmAiDiff='easy',elfmOn=false;
// RPS
var rpsPollInterval=null,rpsLobbyId=null,rpsIsHost=false,rpsIsAI=false,rpsAiDiff='easy',rpsOn=false;
// Chess
var chessPollInterval=null,chessLobbyId=null,chessIsHost=false,chessIsAI=false,chessAiDiff='easy',chessOn=false;
var chessState=null,chessSelected=-1,chessValidMoves=[],chessLastMoveFrom=-1,chessLastMoveTo=-1,chessMyColor='w';
var chessMoveInFlight=false; // true while our move is being sent to server (prevent poll overwrite)
// Snake
var snakeOn=false;
// Wort-Blitz
var wortblitzOn=false;
// Rechen-Duell
var mathOn=false,mathLobbyId=null,mathIsHost=false,mathIsAI=false,mathAiDiff='easy',mathPollInterval=null;

/* ---- DARK/LIGHT MODE ---- */
(function() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light');
  }
})();

/* ════════════════════════════════════════════════
   NOTIFICATIONS — vollständig neu
   ════════════════════════════════════════════════ */

// Register service worker (needed for iOS PWA background push)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(){});
}

// User preference key — separate from browser permission (browser perm can't be revoked via JS)
var NOTIF_PREF = 'arcadebox_notif_on'; // 'true' | 'false' | null (not set)

function notifUserWantsOn() {
  // User wants notifications ON if:
  // - They never set a preference (null) → treat as want ON if permission is granted
  // - Or explicitly set to 'true'
  var pref = localStorage.getItem(NOTIF_PREF);
  return pref !== 'false'; // default to true
}

// Show the custom permission dialog
function showNotifDialog(onAllow, onDeny) {
  var dialog = document.getElementById('notif-dialog');
  if (!dialog) return;
  dialog.style.display = 'flex';
  document.getElementById('notif-allow-btn').onclick = function() {
    dialog.style.display = 'none';
    if (onAllow) onAllow();
  };
  document.getElementById('notif-deny-btn').onclick = function() {
    dialog.style.display = 'none';
    if (onDeny) onDeny();
  };
}

// Called on login
function initPushNotifications() {
  if (!('Notification' in window)) return;
  var perm = Notification.permission;
  if (perm === 'granted') {
    refreshNotifToggle();
    tryWebPushSubscribe();
    return;
  }
  if (perm === 'denied') { refreshNotifToggle(); return; }
  // Not yet asked → show dialog once
  if (localStorage.getItem('notif_asked')) return;
  localStorage.setItem('notif_asked', '1');
  showNotifDialog(function() {
    // Must call from user gesture (dialog button click counts)
    Notification.requestPermission().then(function(p) {
      localStorage.setItem(NOTIF_PREF, p === 'granted' ? 'true' : 'false');
      refreshNotifToggle();
      if (p === 'granted') tryWebPushSubscribe();
    }).catch(function(){});
  });
}

// Web Push subscription (optional fallback — requires DB table + VAPID keys on Render)
async function tryWebPushSubscribe() {
  if (!user || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    var r = await fetch(API_URL + '/api/push/vapid-public-key');
    if (!r.ok) return;
    var data = await r.json();
    if (!data.key) return;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.key) });
    await fetch(API_URL + '/api/push/subscribe', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user_id: user.id, subscription: sub.toJSON() }) });
  } catch(e) {}
}

function urlBase64ToUint8Array(b64) {
  var padding = '='.repeat((4 - b64.length % 4) % 4);
  var base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base64);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function updateNotifToggleUI(on) {
  var btn = document.getElementById('notif-toggle-btn');
  var txt = document.getElementById('notif-toggle-text');
  if (!btn) return;
  if (on) { btn.classList.add('on'); if (txt) txt.textContent = 'An'; }
  else    { btn.classList.remove('on'); if (txt) txt.textContent = 'Aus'; }
}

function setNotifHint(msg) {
  var el = document.getElementById('notif-setting-hint');
  if (el) el.textContent = msg;
}

// Refresh toggle UI based on both browser permission AND user preference
function refreshNotifToggle() {
  if (!('Notification' in window)) {
    var row = document.getElementById('notif-setting-row');
    if (row) row.style.display = 'none';
    return;
  }
  var perm = Notification.permission;
  var prefOn = notifUserWantsOn();
  var effectivelyOn = (perm === 'granted' && prefOn);
  updateNotifToggleUI(effectivelyOn);
  var testBtn = document.getElementById('notif-test-btn');
  if (perm === 'denied') {
    setNotifHint('Im Browser blockiert → Einstellungen → Benachrichtigungen → ArcadeBox → Erlauben → Seite neu laden.');
    if (testBtn) testBtn.style.display = 'none';
  } else if (perm === 'granted' && prefOn) {
    setNotifHint('Aktiv ✓ — du bekommst Benachrichtigungen bei Einladungen, Nachrichten und Freundschaftsanfragen.');
    if (testBtn) testBtn.style.display = 'block';
  } else if (perm === 'granted' && !prefOn) {
    setNotifHint('Deaktiviert — tippe nochmal um wieder zu aktivieren.');
    if (testBtn) testBtn.style.display = 'none';
  } else {
    setNotifHint('Tippe um Benachrichtigungen zu aktivieren.');
    if (testBtn) testBtn.style.display = 'none';
  }
}

// ---- THE CORE: send a notification ----
// Always attempts SW notification (works background iOS/Android PWA + desktop)
// Falls back to direct new Notification() for desktop browsers
function showLocalNotif(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!notifUserWantsOn()) return; // user turned off in our toggle
  var tag = 'arcadebox-' + Date.now(); // unique tag so notifications stack
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(function(reg) {
      return reg.showNotification(title, {
        body: body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [120, 60, 120],
        tag: tag,
        requireInteraction: false
      });
    }).catch(function() {
      // SW failed → try direct
      try { new Notification(title, { body: body, icon: '/icon-192.png' }); } catch(e2) {}
    });
  } else {
    try { new Notification(title, { body: body }); } catch(e) {}
  }
}

/* ---- AUTO-LOGIN via Cookie ---- */
(function() {
  // Nach einem Logout kein Auto-Login — Login-Maske zeigen
  if (sessionStorage.getItem('logged_out') === 'true') {
    var lastUser = localStorage.getItem('lastUser');
    if (lastUser) {
      window.addEventListener('DOMContentLoaded', function() {
        var field = document.getElementById('login-name');
        if (field) field.value = lastUser;
      });
    }
    return;
  }
  var match = document.cookie.split('; ').find(function(r) { return r.startsWith('arcadebox_user='); });
  if (match) {
    try {
      user = JSON.parse(decodeURIComponent(match.split('=').slice(1).join('=')));
      if (user && user.id) { window.addEventListener('DOMContentLoaded', function() { enterApp(); }); return; }
    } catch(e) { user = null; }
  }
  // Kein Cookie — letzten Benutzernamen vorausfüllen
  var lastUser = localStorage.getItem('lastUser');
  if (lastUser) {
    window.addEventListener('DOMContentLoaded', function() {
      var field = document.getElementById('login-name');
      if (field) field.value = lastUser;
    });
  }
})();

/* ---- SOUNDS ---- */
var audioCtx = null;
function playTone(freq, dur, type) {
if (localStorage.getItem('soundEffects') === 'off') return;
if (!audioCtx) {
audioCtx = new (window.AudioContext ||
window.webkitAudioContext)();
}
var osc = audioCtx.createOscillator();
var gain = audioCtx.createGain();
osc.type = type || "sine";
osc.frequency.value = freq;
osc.connect(gain);
gain.connect(audioCtx.destination);
gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
gain.gain.exponentialRampToValueAtTime(
0.001, audioCtx.currentTime + dur);
osc.start();
osc.stop(audioCtx.currentTime + dur);
}
var sounds = {
correct: function() { playTone(800, 0.15); },
wrong: function() { playTone(150, 0.4, "sawtooth"); },
highscore: function() {
playTone(500, 0.1);
setTimeout(function() { playTone(700, 0.1); }, 100);
setTimeout(function() { playTone(1000, 0.2); }, 200);
}
};

/* ---- RANG-SYSTEM ---- */
// Rank based on RP (rank points) — max 90 RP with 9 games
// Legende requires top placement in almost every game — very exclusive
function getRank(rp) {
  if (rp >= 80) return '👑 Legende';
  if (rp >= 55) return '💎 Elite';
  if (rp >= 32) return '⭐ Veteran';
  if (rp >= 16) return '🔥 Profi';
  if (rp >= 5)  return '🎮 Spieler';
  return '🌱 Neuling';
}
function getRankColor(rp) {
  if (rp >= 80) return '#fbbf24';
  if (rp >= 55) return '#818cf8';
  if (rp >= 32) return '#60a5fa';
  if (rp >= 16) return '#fb923c';
  if (rp >= 5)  return '#4ade80';
  return '#6b7280';
}
function getScoreTotal(u) {
  return (u.memory||0) + (u.stack||0) + (u.precision||0) + (u.guess||0) + (u.wordle||0) + (u.flappy||0) + (u.snake||0) + (u.wortblitz||0);
}
// Global: store current user's rank points (updated when scoreboard loads)
var myRankPoints = 0;

/* ════════════════════════════════════════════════
   NOTIFICATION CENTER
   ════════════════════════════════════════════════ */
var notifHistory = []; // in-memory event log

function addNotifEvent(icon, title, sub, isNew) {
  notifHistory.unshift({ icon: icon, title: title, sub: sub, isNew: isNew||false, time: Date.now() });
  if (notifHistory.length > 50) notifHistory.length = 50;
  updateNotifBadge();
}

function updateNotifBadge() {
  var newCount = notifHistory.filter(function(n) { return n.isNew; }).length;
  var badge = document.getElementById('notif-bell-badge');
  if (badge) {
    badge.textContent = newCount;
    badge.style.display = newCount > 0 ? 'flex' : 'none';
  }
}

var PATCHNOTES = [
  { version: 'v2.8', date: '10. Jun 2026', title: '🎨 Zahlen-Raten: Bunter Verlaufsbalken',
    items: ['Verlaufsbalken (1–100) jetzt in lebendigem Rot → Orange → Gelb → Grün', 'Harmonischer Farbverlauf passend zum dunklen Arcade-Design'],
    tags: ['improve','improve'] },
  { version: 'v2.7', date: '10. Jun 2026', title: '🐍 Schlange: Start-Countdown',
    items: ['Neue Startsequenz: "Bereit?" gefolgt von Countdown 3-2-1-Los!', 'Schlange steht still & ignoriert Eingaben bis der Countdown endet'],
    tags: ['new','improve'] },
  { version: 'v2.6', date: '10. Jun 2026', title: '✨ UI-Politur: Einstellungen & Sidebar',
    items: ['"Verifiziert"-Badge in den Einstellungen: Layout-Fix für alle Betriebssysteme', 'Schließen-Button im Einstellungen-Modal neu gestaltet (rund, mit Hover-Effekt)', 'Freunde-Sidebar: Zeilenabstand springt beim Hovern nicht mehr', 'Startseite: Spiele-Anzahl auf 15 aktualisiert'],
    tags: ['fix','improve','fix','fix'] },
  { version: 'v2.5', date: '10. Jun 2026', title: '💻 Info-Wordle: 151 neue Wörter & Bugfix',
    items: ['Wortpool auf 151 Wörter erweitert — viele neue Begriffe aus Informatik & digitaler Grundbildung', 'Bug behoben: Lösungswörter mit Umlauten (ä/ö/ü) waren nicht eingebbar', 'Fehlerhafte Lösungswörter mit falscher Länge entfernt', 'Neue Begriffe extra einfach gehalten — passend für Schüler'],
    tags: ['new','fix','fix','improve'] },
  { version: 'v2.4', date: '10. Jun 2026', title: '🆚 TicTacToe — KI-Modus & Multiplayer-Duell',
    items: ['TicTacToe gegen KI in 3 Schwierigkeitsstufen (Leicht/Mittel/Schwer)', 'Multiplayer-Duell mit Live-Polling & animierter Gewinnlinie', 'Spielende-Overlay mit Sofort-Rematch-Button', 'Bug behoben: Duell startete nach Annahme der Einladung nicht'],
    tags: ['new','new','new','fix'] },
  { version: 'v2.3', date: '10. Jun 2026', title: '🟢 Online-Status, Lesebestätigungen & Avatar-Menü',
    items: ['Online-Status (Aktiv/Abwesend/Nicht stören) für dich & deine Freunde sichtbar', 'Lesebestätigungen (✓✓) und Tippt-gerade-Anzeige im Chat', 'Ungelesene-Nachrichten-Badges in der Freunde-Sidebar', 'Avatar-Status-Menü im Header, von überall erreichbar'],
    tags: ['new','new','new','improve'] },
  { version: 'v2.2', date: '09. Jun 2026', title: '🎓 Onboarding-Guide & Arcade-Redesign',
    items: ['Interaktiver Einsteiger-Guide mit Maskottchen führt durch alle Funktionen', 'Regenbogen-RGB-Rahmen & Spotlight-Effekte im neuen Arcade-Look', 'Scoreboard zeigt jetzt alle Spieler in größerer Tabelle', 'Diverse Layout-, Scroll- & Zoom-Fixes im neuen Design'],
    tags: ['new','new','improve','fix'] },
  { version: 'v2.1', date: '09. Jun 2026', title: '🔑 Login-Redesign & Passwort-Reset',
    items: ['Komplettes Login-Redesign im Retro-Arcade-Stil mit Konto-Auswahl', 'Passwort-Reset per E-Mail (Reset-Link 1 Stunde gültig)', 'Hinweis beim ersten Login: E-Mail für Konto-Wiederherstellung hinterlegen', 'Profil zeigt Verifizierungs-Status der hinterlegten E-Mail'],
    tags: ['new','new','new','improve'] },
  { version: 'v2.0', date: '03. Jun 2026', title: '🎲 4 neue Spiele für Solo & Duell',
    items: ['Schlange (Snake): Arcade-Klassiker mit Highscore-Tracking', 'Wort-Blitz: Tippe fallende Wörter, bevor sie den Boden erreichen', 'Tipp-Rennen: Live-Tippduell gegen Freunde mit Rennwagen-Anzeige', 'Rechen-Duell: Kopfrechnen-Battle gegen KI oder Freunde'],
    tags: ['new','new','new','new'] },
  { version: 'v1.9', date: '02. Jun 2026', title: '🔌 WebSocket Multiplayer — Echtzeit',
    items: ['Pong & Schach nutzen jetzt WebSockets (<10ms Latenz)', 'Beide Spieler sehen Bewegungen sofort ohne Verzögerung', 'Schach: Board-Flip für Schwarz, 2D Brett, kein Doppelklick mehr', 'Pong: 3-2-1 Countdown + Smooth 60fps interpolation'],
    tags: ['new','improve','fix','fix'] },
  { version: 'v1.8', date: '31. Mai 2026', title: '📬 Postfach & Live-Aktivität',
    items: ['Notification Center mit Verlauf, aktive Anfragen & Patchnotes', 'Live-Aktivitätswidget (SSE Echtzeit, 0ms Delay)', 'Benachrichtigungen für Einladungen, Nachrichten & Freundschaftsanfragen', 'Bell-Icon im Header mit Badge-Zähler'],
    tags: ['new','new','new','new'] },
  { version: 'v1.7', date: '27. Mai 2026', title: '🐛 Multiplayer Bugfixes',
    items: ['4 Gewinnt: Verlierer-Screen jetzt immer sichtbar (Gewinnzug wurde nie gesendet)', 'TicTacToe: 1 Klick reicht — Stale-State Race-Condition behoben', 'Schach: chessMoveInFlight verhindert Poll-Überschreibung', 'Schere Stein Papier: resolving-Flag verhindert Doppel-Auflösung'],
    tags: ['fix','fix','fix','fix'] },
  { version: 'v1.6', date: '23. Mai 2026', title: '🕹️ Arcade Design & Animationen',
    items: ['Retro Canvas: Tron-Gitter, Neon-Orbs, Charakter-Regen, Scan-Linie', 'Press Start 2P Pixel-Font + VT323 für Headlines', 'Regenbogen-Marquee & Scanlines im Header', 'Scoreboard als einheitliche Tabelle (alle 7 Spiele)'],
    tags: ['new','new','improve','improve'] },
  { version: 'v1.5', date: '18. Mai 2026', title: '🐦 Flappy Bird & Benachrichtigungen',
    items: ['Flappy Bird mit Neon Night-City Thema & Partikeleffekten', 'Web Push Notifications (iOS PWA + Desktop)', 'Light Mode komplett überarbeitet mit Glassmorphismus', 'Scoreboard: Flappy Bird Highscore integriert'],
    tags: ['new','new','improve','improve'] },
  { version: 'v1.4', date: '12. Mai 2026', title: '♟️ Schach vollständig',
    items: ['Schach-Engine: Minimax + Alpha-Beta Pruning, 3 KI-Stufen', 'Rochade, En Passant, Schachprüfung vollständig', 'Schach-Multiplayer mit Live-Sync', 'Alle 5 Multiplayer-Spiele fertiggestellt'],
    tags: ['new','new','new','new'] },
  { version: 'v1.3', date: '04. Mai 2026', title: '💬 Chat & Freunde V2',
    items: ['Globaler Chat in Echtzeit', 'Privater Chat zwischen Freunden', 'Freundschaftsanfragen + Status (Online/Offline)', 'Ungelesene-Nachrichten-Badge'],
    tags: ['new','new','improve','new'] },
  { version: 'v1.2', date: '21. Apr 2026', title: '⚔️ Multiplayer — Pong & SSP',
    items: ['Pong gegen echte Spieler', 'Schere Stein Papier mit Countdown-Animation', 'Einladungssystem via Lobby', 'Online-Spieler in Lobbys sichtbar'],
    tags: ['new','new','new','new'] },
  { version: 'v1.1', date: '08. Apr 2026', title: '🎯 Multiplayer — TicTacToe & 4 Gewinnt',
    items: ['TicTacToe & 4 Gewinnt gegen echte Spieler', 'Lobby- & Einladungssystem', 'Spieler-Online-Status (Heartbeat)', 'Avatare + Profilseite'],
    tags: ['new','new','new','new'] },
  { version: 'v1.0', date: '15. Mär 2026', title: '🚀 Launch — ArcadeBox',
    items: ['7 Singleplayer-Spiele (Memory, Stack, Reaktion, Bubble, Zahlen, Wordle, ...)', 'Login & Registrierung mit Cookie-Session', 'Globales Highscore-System mit RP-Wertung', 'Grundlegendes Profil & Avatar-Auswahl'],
    tags: ['new','new','new','new'] },
];

function openNotifCenter() {
  var overlay = document.getElementById('notif-center-overlay');
  if (overlay) overlay.style.display = 'flex';
  // Mark all as seen
  notifHistory.forEach(function(n) { n.isNew = false; });
  updateNotifBadge();
  renderNotifCenter('active');
}

function closeNotifCenter() {
  var overlay = document.getElementById('notif-center-overlay');
  if (overlay) overlay.style.display = 'none';
}

function renderNotifCenter(tab) {
  // Update tab buttons
  document.querySelectorAll('.nc-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.nc-panel').forEach(function(p) { p.style.display='none'; });
  var panel = document.getElementById('nc-' + tab);
  if (panel) panel.style.display = 'flex';

  if (tab === 'active') {
    renderNotifActive();
  } else if (tab === 'history') {
    renderNotifHistory();
  } else if (tab === 'updates') {
    renderNotifUpdates();
  }
}

function renderNotifActive() {
  var panel = document.getElementById('nc-active');
  if (!panel) return;
  var html = '';
  // Pending game invites
  var pendingInvites = Array.from(seenInviteIds).length > 0 ? [] : [];
  // Friend requests from recent events
  var activeItems = notifHistory.filter(function(n) { return n.active; });
  if (!activeItems.length && !html) {
    panel.innerHTML = '<div class="nc-empty">Keine aktiven Benachrichtigungen</div>';
    return;
  }
  panel.innerHTML = html || '<div class="nc-empty">Keine aktiven Benachrichtigungen</div>';
}

async function renderNotifHistory() {
  var panel = document.getElementById('nc-history');
  if (!panel) return;
  panel.innerHTML = '<div class="nc-empty">Lädt...</div>';

  // Combine in-memory (new session) + DB history (past sessions)
  var dbItems = [];
  try {
    if (user) {
      var r = await fetch(API_URL + '/api/notifications/' + user.id);
      if (r.ok) dbItems = await r.json();
    }
  } catch(e) {}

  // Merge: memory items first, then DB (deduplicated by title+time proximity)
  var allItems = notifHistory.map(function(n) {
    return { icon: n.icon, title: n.title, body: n.sub, created_at: new Date(n.time).toISOString(), is_read: !n.isNew };
  });
  dbItems.forEach(function(d) {
    // Don't add if a memory item with same title exists within 10s
    var isDupe = allItems.some(function(a) {
      return a.title === d.title && Math.abs(new Date(a.created_at) - new Date(d.created_at)) < 10000;
    });
    if (!isDupe) allItems.push(d);
  });
  // Sort by date desc
  allItems.sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });

  if (!allItems.length) {
    panel.innerHTML = '<div class="nc-empty">Noch keine Benachrichtigungen</div>';
    return;
  }

  var html = '';
  allItems.forEach(function(n) {
    var ts = new Date(n.created_at);
    var dateStr = ts.toLocaleDateString('de-AT', {day:'2-digit', month:'2-digit', year:'2-digit'});
    var timeStr = ts.toLocaleTimeString('de-AT', {hour:'2-digit', minute:'2-digit'});
    html += '<div class="nc-item' + (!n.is_read ? ' nc-new' : '') + '">' +
      '<span class="nc-item-icon">'+(n.icon||'🔔')+'</span>' +
      '<div class="nc-item-body">' +
        '<div class="nc-item-title">'+escHtml(n.title||'')+'</div>' +
        '<div class="nc-item-sub">'+escHtml(n.body||n.sub||'')+'</div>' +
        '<div class="nc-item-time">'+dateStr+' um '+timeStr+'</div>' +
      '</div></div>';
  });
  panel.innerHTML = html;

  // Mark all as read in DB
  if (user) fetch(API_URL + '/api/notifications/' + user.id + '/read', {method:'POST'}).catch(function(){});
}

function renderNotifUpdates() {
  var panel = document.getElementById('nc-updates');
  if (!panel) return;
  var html = '';
  PATCHNOTES.forEach(function(p, idx) {
    var tagHtml = (p.tags || []).map(function(t, i) {
      if (i >= (p.items || []).length) return '';
      var cls = t==='new'?'tag-new':t==='fix'?'tag-fix':'tag-improve';
      var lbl = t==='new'?'NEU':t==='fix'?'FIX':'UPDATE';
      return '<li><span class="patch-tag '+cls+'">'+lbl+'</span>'+(p.items[i]||'')+'</li>';
    }).join('');
    html += '<div class="patch-item">' +
      '<div class="patch-version">'+p.version+'</div>' +
      '<div class="patch-date">'+p.date+'</div>' +
      '<div class="patch-title">'+p.title+'</div>' +
      '<ul class="patch-list">' + tagHtml + '</ul>' +
      '</div>';
  });
  panel.innerHTML = html;
}

function timeAgo(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return 'Gerade eben';
  if (diff < 3600000) return Math.floor(diff/60000) + ' Min. ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' Std. ago';
  return Math.floor(diff/86400000) + ' Tage ago';
}

// Wire up notification center buttons (runs after DOM loaded)
document.addEventListener('DOMContentLoaded', function() {
  var btnOpen = document.getElementById('btn-notif-center');
  var btnClose = document.getElementById('btn-close-notif-center');
  var overlay = document.getElementById('notif-center-overlay');
  if (btnOpen) btnOpen.addEventListener('click', openNotifCenter);
  if (btnClose) btnClose.addEventListener('click', closeNotifCenter);
  if (overlay) overlay.addEventListener('click', function(e) { if(e.target===overlay) closeNotifCenter(); });
  document.querySelectorAll('.nc-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { renderNotifCenter(this.dataset.tab); });
  });
  // Live widget toggle
  var widgetToggle = document.getElementById('live-widget-toggle');
  var widget = document.getElementById('live-widget');
  if (widgetToggle && widget) {
    widgetToggle.addEventListener('click', function() {
      widget.classList.toggle('collapsed');
    });
  }
});

/* ---- PERFORMANCE: Pause canvas when tab hidden ---- */
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    stopArcadeParticles(); // free CPU when tab not visible
  } else {
    // Restart only if on main screen (not in-game)
    var popup = document.getElementById('popup');
    if (popup && !popup.classList.contains('on')) {
      startArcadeParticles();
    }
  }
});

/* ---- HEARTBEAT + LIVE ACTIVITY ---- */
function sendHeartbeat() {
  if (!user) return;
  fetch(API_URL + '/api/users/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, activity: currentActivity })
  });
}

var activityLabels = {
  main: '🏠 Hauptseite',
  'singleplayer:memory': '🧠 Farb-Gedächtnis',
  'singleplayer:stack': '🧱 Turm-Stapler',
  'singleplayer:reaktion': '⚡ Reaktionstest',
  'singleplayer:bubble': '🫧 Bubble Pop',
  'singleplayer:zahlen': '🔢 Zahlen-Raten',
  'singleplayer:wordle': '💻 Info-Wordle',
  'singleplayer:flappy': '🐦 Flappy Bird',
  'multiplayer:tictactoe': '⚔️ TicTacToe',
  'multiplayer:connect4': '🔴 4 Gewinnt',
  'multiplayer:pong': '🏓 Pong',
  'multiplayer:rps': '✊ Schere Stein Papier',
  'multiplayer:schach': '♟️ Schach'
};

var liveEventSource = null;

function startLiveStream() {
  if (liveEventSource) { liveEventSource.close(); liveEventSource = null; }
  if (!user) return;
  try {
    liveEventSource = new EventSource(API_URL + '/api/live-stream');
    liveEventSource.onmessage = function(e) {
      try {
        var people = JSON.parse(e.data).filter(function(p) { return p.id !== user.id; });
        renderLiveActivity(people);
      } catch(err) {}
    };
    liveEventSource.onerror = function() {
      // Reconnect after 3s if connection drops
      if (liveEventSource) { liveEventSource.close(); liveEventSource = null; }
      if (user) setTimeout(startLiveStream, 3000);
    };
  } catch(e) {}
}

function stopLiveStream() {
  if (liveEventSource) { liveEventSource.close(); liveEventSource = null; }
}

function renderLiveActivity(people) {
  var container = document.getElementById('live-activity-list');
  var countEl = document.getElementById('live-count');
  if (!container) return;
  if (countEl) countEl.textContent = people.length;
  if (!people.length) {
    container.innerHTML = '<div class="live-empty">Niemand gerade online</div>';
    return;
  }
  var html = '';
  people.forEach(function(p) {
    var seed = p.avatar_seed || p.name;
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
    var actLabel = activityLabels[p.activity] || p.activity || '🏠 Hauptseite';
    var isMulti = p.activity && p.activity.startsWith('multiplayer');
    var isSingle = p.activity && p.activity.startsWith('singleplayer');
    var dotColor = isMulti ? '#f97316' : isSingle ? '#a78bfa' : '#4ade80';
    html += '<div class="live-row">' +
      '<img class="live-av" src="'+av+'" loading="lazy">' +
      '<div class="live-info">' +
        '<span class="live-name">'+escHtml(p.name)+'</span>' +
        '<span class="live-status" style="color:'+dotColor+'">'+actLabel+'</span>' +
      '</div>' +
      '<span class="live-dot" style="background:'+dotColor+'"></span>' +
      '</div>';
  });
  container.innerHTML = html;
}

async function loadLiveActivity() {
  // Kept as fallback, but SSE is now primary
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/live-activity');
    if (!res.ok) return;
    var people = await res.json();
    renderLiveActivity(people.filter(function(p) { return p.id !== user.id; }));
  } catch(e) {}
}

/* ---- ONLINE STATUS ---- */
// A user is "invite-eligible" if they logged in within the last 60 minutes.
// This shows them in invite lists even if the app is backgrounded (heartbeat paused).
function isRecentlyActive(u) {
  if (!u) return false;
  if (u.is_online) return true; // server computed: last_seen < 3 min
  if (!u.last_seen) return false;
  return (Date.now() - new Date(u.last_seen).getTime()) < 60 * 60 * 1000; // 60 min
}

function showLastSeenEnabled() {
  return localStorage.getItem('showLastSeen') !== 'off';
}

function formatLastSeen(last_seen, is_online) {
  if (is_online) return '<span class="online-dot green"></span>Online';
  if (!last_seen) return '<span class="online-dot gray"></span>Offline';
  if (!showLastSeenEnabled()) return '<span class="online-dot gray"></span>Offline';
  var diff = Date.now() - new Date(last_seen).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 5) return '<span class="online-dot yellow"></span>Gerade eben';
  if (mins < 60) return '<span class="online-dot yellow"></span>Vor ' + mins + ' Min.';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return '<span class="online-dot gray"></span>Vor ' + hours + ' Std.';
  var days = Math.floor(hours / 24);
  return '<span class="online-dot gray"></span>Vor ' + days + ' Tag' + (days > 1 ? 'en' : '');
}

/* ---- CHAT: DATUMS-TRENNLINIEN ---- */
function chatDateLabel(d) {
  var now = new Date();
  var date = new Date(d);
  var startOfDay = function(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  var diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Gestern';
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ---- PRÄSENZ-STATUS (online/abwesend/nicht stören/offline) ---- */
function presenceDot(presence) {
  switch (presence) {
    case 'online': return '<span class="online-dot green"></span>';
    case 'away': return '<span class="online-dot orange"></span>';
    case 'dnd': return '<span class="online-dot red"></span>';
    default: return '<span class="online-dot gray"></span>';
  }
}
function presenceLabel(presence, lastSeen) {
  if (presence === 'online') return presenceDot(presence) + 'Online';
  if (presence === 'away') return presenceDot(presence) + 'Abwesend';
  if (presence === 'dnd') return presenceDot(presence) + 'Nicht stören';
  if (!lastSeen || !showLastSeenEnabled()) return presenceDot('offline') + 'Offline';
  var mins = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000);
  var txt;
  if (mins < 1) txt = 'Gerade eben online';
  else if (mins < 60) txt = 'Vor ' + mins + ' Min. online';
  else {
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) txt = 'Vor ' + hrs + ' Std. online';
    else { var days = Math.floor(hrs / 24); txt = 'Vor ' + days + ' Tag' + (days > 1 ? 'en' : '') + ' online'; }
  }
  return presenceDot('offline') + txt;
}

// Eigener (Live-)Präsenzstatus, basierend auf der gewählten Einstellung
function ownPresence() {
  if (!user) return 'online';
  if (user.status === 'dnd') return 'dnd';
  if (user.status === 'away') return 'away';
  return 'online';
}

function updateHeaderStatusDot() {
  var dot = document.getElementById('avatar-status-dot');
  if (!dot) return;
  dot.className = 'av-status-dot ' + ownPresence();
}

// Avatar mit kleinem Status-Lämpchen (für Chats), Klick zeigt Profil-Popup
function chatAvatarHtml(seed, presence, lastSeen, name) {
  var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
  return '<span class="chat-avatar-wrap" data-name="' + escHtml(name || '') + '" data-seed="' + encodeURIComponent(seed) + '" data-presence="' + (presence || 'offline') + '" data-last-seen="' + (lastSeen || '') + '">' +
    '<img class="chat-avatar" src="' + av + '" alt="">' +
    '<span class="av-status-dot ' + (presence || 'offline') + '"></span>' +
    '</span>';
}

function showUserStatusPopup(el) {
  var existing = document.querySelector('.chat-read-info');
  if (existing) existing.remove();
  var name = el.getAttribute('data-name');
  var seed = decodeURIComponent(el.getAttribute('data-seed') || '');
  var presence = el.getAttribute('data-presence');
  var lastSeen = el.getAttribute('data-last-seen');
  var box = document.createElement('div');
  box.className = 'chat-read-info';
  box.innerHTML =
    '<button class="cri-close">✕</button>' +
    '<h5>' + escHtml(name) + '</h5>' +
    '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.2rem 0;">' +
    '<img src="https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed) + '" alt="" style="width:32px;height:32px;border-radius:50%;">' +
    '<span style="font-size:0.75rem;">' + presenceLabel(presence, lastSeen) + '</span>' +
    '</div>';
  document.body.appendChild(box);
  var rect = el.getBoundingClientRect();
  box.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  var left = rect.left + window.scrollX;
  if (left + 220 > window.innerWidth) left = window.innerWidth - 230;
  if (left < 8) left = 8;
  box.style.left = left + 'px';
  box.querySelector('.cri-close').addEventListener('click', function() { box.remove(); });
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', handler); }
    }, { once: true });
  }, 0);
}

/* ---- GLOBAL CHAT: UNGELESEN-BADGE ---- */
var gcPanelOpen = false;
function gcLastSeenKey() { return 'gcLastSeen_' + (user ? user.id : 'anon'); }
function getGcLastSeen() { return parseInt(localStorage.getItem(gcLastSeenKey())) || 0; }
function setGcLastSeen(id) { localStorage.setItem(gcLastSeenKey(), String(id)); }
function updateGcBadge(count) {
  var badge = document.getElementById('gc-unread-badge');
  if (!badge) return;
  if (count > 0 && !gcPanelOpen) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

/* ---- GLOBAL CHAT ---- */
async function loadGlobalChat() {
  if (!user) return;
  try {
    var url = API_URL + '/api/chat/global?limit=50&user_id=' + user.id +
      '&user_name=' + encodeURIComponent(user.name) +
      '&avatar_seed=' + encodeURIComponent(user.avatar_seed || user.name);
    var res = await fetch(url);
    if (!res.ok) return;
    var msgs = await res.json();
    if (!Array.isArray(msgs)) return;
    var win = document.getElementById('chat-window');
    if (!win) return;
    var wasAtBottom = win.scrollHeight - win.scrollTop - win.clientHeight < 40;
    var html = '';
    var reversed = msgs.slice().reverse();
    var lastDateKey = null;
    reversed.forEach(function(m) {
      var d = new Date(m.created_at);
      var dateKey = d.toDateString();
      if (dateKey !== lastDateKey) {
        html += '<div class="chat-date-sep"><span>' + chatDateLabel(d) + '</span></div>';
        lastDateKey = dateKey;
      }
      var isOwn = m.user_id === user.id;
      var seed = m.avatar_seed || m.user_name || 'unknown';
      var presence = isOwn ? ownPresence() : (m.presence || 'offline');
      var lastSeen = isOwn ? null : m.last_seen;
      var time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      var receipt = isOwn ? '<span class="chat-receipt" data-msg-id="' + m.id + '" title="Wer hat gelesen?">ℹ️</span>' : '';
      html +=
        '<div class="chat-msg' + (isOwn ? ' own' : '') + '">' +
        chatAvatarHtml(seed, presence, lastSeen, m.user_name) +
        '<div class="chat-bubble">' +
        '<div class="chat-meta"><span class="chat-name">' + escHtml(m.user_name) + '</span><span class="chat-time">' + time + receipt + '</span></div>' +
        '<div class="chat-text">' + escHtml(m.message) + '</div>' +
        '</div>' +
        '</div>';
    });
    win.innerHTML = html;
    win.querySelectorAll('.chat-receipt').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        showGlobalReadInfo(el.getAttribute('data-msg-id'), el);
      });
    });
    if (wasAtBottom || lastChatCount === 0) win.scrollTop = win.scrollHeight;
    lastChatCount = msgs.length;
    loadGlobalTyping();
    // Ungelesen-Badge aktualisieren
    if (msgs.length) {
      var maxId = Math.max.apply(null, msgs.map(function(m) { return m.id; }));
      if (gcPanelOpen) {
        setGcLastSeen(maxId);
        updateGcBadge(0);
      } else {
        var lastSeenId = getGcLastSeen();
        if (lastSeenId === 0) {
          setGcLastSeen(maxId);
        } else {
          var unreadCount = msgs.filter(function(m) { return m.id > lastSeenId && m.user_id !== user.id; }).length;
          updateGcBadge(unreadCount);
        }
      }
    }
  } catch (e) {}
}

async function showGlobalReadInfo(msgId, anchorEl) {
  var existing = document.querySelector('.chat-read-info');
  if (existing) existing.remove();
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/chat/global/info/' + msgId + '?user_id=' + user.id);
    if (!res.ok) return;
    var data = await res.json();
    var box = document.createElement('div');
    box.className = 'chat-read-info';
    function renderList(arr, emptyText) {
      if (!arr || !arr.length) return '<li class="cri-empty">' + emptyText + '</li>';
      return arr.map(function(u) {
        var seed = u.avatar_seed || u.name || 'unknown';
        return '<li><img src="https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed) + '" alt="">' +
          '<span>' + escHtml(u.name || '?') + '</span>' +
          '<span style="margin-left:auto;font-size:0.65rem;white-space:nowrap;">' + presenceLabel(u.presence, u.last_seen) + '</span>' +
          '</li>';
      }).join('');
    }
    box.innerHTML =
      '<button class="cri-close">✕</button>' +
      '<h5>✓✓ Gelesen</h5><ul>' + renderList(data.read, 'Noch niemand') + '</ul>' +
      '<h5>Ungelesen</h5><ul>' + renderList(data.unread, 'Niemand') + '</ul>';
    document.body.appendChild(box);
    var rect = anchorEl.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX - 200;
    if (left < 8) left = 8;
    box.style.top = top + 'px';
    box.style.left = left + 'px';
    box.querySelector('.cri-close').addEventListener('click', function() { box.remove(); });
    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', handler); }
      }, { once: true });
    }, 0);
  } catch (e) {}
}

/* ---- TIPP-INDIKATOR: GLOBALER CHAT ---- */
var lastGlobalTypingSent = 0;
function notifyGlobalTyping() {
  if (!user) return;
  var now = Date.now();
  if (now - lastGlobalTypingSent < 1500) return;
  lastGlobalTypingSent = now;
  fetch(API_URL + '/api/chat/typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, name: user.name, avatar_seed: user.avatar_seed || user.name, scope: 'global' })
  }).catch(function() {});
}

async function loadGlobalTyping() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/chat/typing/global?user_id=' + user.id);
    if (!res.ok) return;
    var typers = await res.json();
    var el = document.getElementById('gc-typing');
    if (!el) return;
    if (!Array.isArray(typers) || !typers.length) { el.classList.remove('active'); el.innerHTML = ''; return; }
    var avatars = typers.slice(0, 4).map(function(t) {
      var seed = t.avatar_seed || t.name || 'unknown';
      return '<img src="https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed) + '" alt="">';
    }).join('');
    var names = typers.map(function(t) { return t.name; }).join(', ');
    el.innerHTML = '<span class="typing-avatars">' + avatars + '</span><span>' + escHtml(names) + (typers.length > 1 ? ' tippen gerade' : ' tippt gerade') + '</span><span class="typing-dots"><span></span><span></span><span></span></span>';
    el.classList.add('active');
  } catch (e) {}
}

async function sendChatMessage() {
  if (!user) return;
  var input = document.getElementById('chat-input');
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  try {
    await fetch(API_URL + '/api/chat/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, user_name: user.name, avatar_seed: user.avatar_seed || user.name, message: msg })
    });
    loadGlobalChat();
  } catch (e) {}
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ---- MULTIPLAYER LOBBY ---- */
async function loadLobbyScreen() {
  if (!user) return;
  document.getElementById('ttt-screen').style.display = 'none';
  document.getElementById('lobby-screen').style.display = '';
  document.getElementById('btn-again').style.display = 'none';
  document.getElementById('pbot-pts-wrap').style.display = 'none';
  try {
    var res = await fetch(API_URL + '/api/users/search?me=' + user.id);
    if (!res.ok) return;
    var users = await res.json();
    if (!Array.isArray(users)) return;
    var online = users.filter(function(u) { return isRecentlyActive(u) && u.id !== user.id; });
    document.getElementById('lobby-online-num').textContent = online.length;
    var container = document.getElementById('lobby-users-list');
    if (!online.length) {
      container.innerHTML = '<div class="lobby-empty">Keine anderen Spieler online</div>';
      return;
    }
    var html = '';
    online.forEach(function(u) {
      var seed = u.avatar_seed || u.name || 'unknown';
      var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
      html +=
        '<div class="lobby-user-row">' +
        '<img class="lobby-user-av" src="' + av + '" alt="">' +
        '<span class="lobby-user-name">' + escHtml(u.name) + '</span>' +
        '<button class="btn-invite" data-id="' + u.id + '">Einladen</button>' +
        '</div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.btn-invite').forEach(function(btn) {
      btn.addEventListener('click', function() { sendGameInvite(parseInt(this.dataset.id), this); });
    });
  } catch (e) {}
}

async function sendGameInvite(toId, btn, gameType) {
  if (!user) return;
  gameType = gameType || 'tictactoe';
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var lobRes = await fetch(API_URL + '/api/lobby/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host_id: user.id, game_type: gameType })
    });
    var lobby = await lobRes.json();
    if (!lobRes.ok || !lobby.id) { if (btn) { btn.disabled = false; btn.textContent = 'Einladen'; } return; }
    var invRes = await fetch(API_URL + '/api/lobby/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: lobby.id, from_id: user.id, to_id: toId })
    });
    if (!invRes.ok) {
      var errData = await invRes.json().catch(function() { return {}; });
      if (btn) { btn.disabled = false; btn.textContent = 'Einladen'; }
      showToast('🔕 ' + (errData.error || 'Nutzer nimmt aktuell keine Einladungen an'));
      return;
    }
    if (btn) { btn.textContent = '✓ Gesendet'; }
    var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', elfmeter:'Schiffe versenken', rps:'Schere Stein Papier', chess:'Schach', math:'Rechen-Duell' };
    showToast('⚔️ Einladung zu ' + (gameNames[gameType]||gameType) + ' gesendet!');
    if (hostWaitInterval) clearInterval(hostWaitInterval);
    hostWaitInterval = setInterval(async function() {
      try {
        var r = await fetch(API_URL + '/api/lobby/' + lobby.id);
        if (!r.ok) return;
        var lo = await r.json();
        if (lo.status === 'playing') {
          clearInterval(hostWaitInterval); hostWaitInterval = null;
          if (gameType === 'connect4') {
            openG('connect4');
            setTimeout(function() { c4StartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'elfmeter') {
            openG('elfmeter');
            setTimeout(function() { elfmeterStartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'rps') {
            openG('rps');
            setTimeout(function() { rpsStartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'chess') {
            openG('chess');
            setTimeout(function() { chessStartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'math') {
            openG('math');
            setTimeout(function() { mathStartOnline(lobby.id, true); }, 80);
          } else {
            tttLobbyId = lobby.id; tttIsHost = true; tttMySymbol = 'X';
            openG('multiplayer');
            setTimeout(function() { tttStartOnline(lobby.id, true); }, 80);
          }
        }
      } catch(e) {}
    }, 500);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Einladen'; }
  }
}

async function checkGameInvites() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/lobby/invite/' + user.id);
    if (!res.ok) return;
    var invites = await res.json();
    if (!Array.isArray(invites)) return;
    // On the very first check after login, silently mark all existing
    // invites as seen so stale notifications never appear.
    if (inviteFirstCheck) {
      invites.forEach(function(inv) { seenInviteIds.add(inv.id); });
      inviteFirstCheck = false;
      return;
    }
    invites.forEach(function(inv) {
      if (seenInviteIds.has(inv.id)) return;
      seenInviteIds.add(inv.id);
      showInviteToast(inv);
      // Local push notification when tab is hidden
      var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', elfmeter:'Schiffe versenken', rps:'Schere Stein Papier', chess:'Schach', math:'Rechen-Duell' };
      var inviteMsg = (inv.from_name || 'Jemand') + ' lädt dich zu ' + (gameNames[inv.game_type]||'einem Spiel') + ' ein!';
      showLocalNotif('⚔️ Spieleinladung', inviteMsg);
      addNotifEvent('⚔️', 'Spieleinladung', inviteMsg, true);
    });
  } catch (e) {}
}

function showInviteToast(inv) {
  var t = document.createElement('div');
  t.className = 'toast toast-invite';
  var seed = inv.avatar_seed || inv.from_name || 'unknown';
  var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
  var gameIcons = { tictactoe:'⚔️', connect4:'🔴', pong:'🏓', rps:'✊', chess:'♟️', math:'🧮' };
  var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', elfmeter:'Schiffe versenken', rps:'Schere Stein Papier', chess:'Schach', math:'Rechen-Duell' };
  var icon = gameIcons[inv.game_type] || '⚔️';
  var name = gameNames[inv.game_type] || 'Duell';
  t.innerHTML =
    '<div class="toast-invite-top"><img class="toast-av" src="' + av + '" alt=""><span><b>' + escHtml(inv.from_name) + '</b> lädt dich zu einem ' + icon + ' <em>' + name + '</em>-Duell ein!</span></div>' +
    '<div class="toast-btns"><button class="toast-accept">Annehmen</button><button class="toast-decline">Ablehnen</button></div>';
  document.body.appendChild(t);
  t.querySelector('.toast-accept').addEventListener('click', function() {
    if (t.parentNode) t.parentNode.removeChild(t);
    acceptGameInvite(inv);
  });
  t.querySelector('.toast-decline').addEventListener('click', function() {
    if (t.parentNode) t.parentNode.removeChild(t);
  });
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 12000);
}

async function acceptGameInvite(inv) {
  try {
    var res = await fetch(API_URL + '/api/lobby/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: inv.lobby_id, guest_id: user.id })
    });
    if (!res.ok) { showToast('Lobby nicht mehr verfügbar'); return; }
    var gt = inv.game_type || 'tictactoe';
    if (gt === 'connect4') {
      openG('connect4');
      setTimeout(function() { c4StartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'elfmeter') {
      openG('elfmeter');
      setTimeout(function() { elfmeterStartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'rps') {
      openG('rps');
      setTimeout(function() { rpsStartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'chess') {
      openG('chess');
      setTimeout(function() { chessStartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'math') {
      openG('math');
      setTimeout(function() { mathStartOnline(inv.lobby_id, false); }, 80);
    } else {
      openG('multiplayer');
      setTimeout(function() { tttStartOnline(inv.lobby_id, false); }, 80);
    }
  } catch (e) {}
}

/* ---- TICTACTOE ---- */
function tttStart(diff) {
  tttBoard = Array(9).fill(''); tttLastPlaced = -1;
  tttOn = true; tttIsAI = true; tttAiDiff = diff || lobbyAiDiff;
  tttCurrentTurn = 'X'; tttMySymbol = 'X'; tttIsHost = true;
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('ttt-screen').style.display = 'block';
  document.getElementById('btn-again').style.display = 'inline-block';
  document.getElementById('pbot-pts-wrap').style.display = 'none';
  var overlay = document.getElementById('ttt-overlay');
  if (overlay) overlay.classList.remove('show');
  document.getElementById('ttt-player-info').innerHTML =
    '<span class="ttt-you active">Du: <b class="x-color">✕</b></span>' +
    '<span class="ttt-opp">KI: <b class="o-color">◯</b></span>';
  document.getElementById('ttt-status').textContent = 'Du bist ✕ — Du fängst an!';
  renderTTTBoard();
}

function tttStartOnline(lobbyId, isHost) {
  tttBoard = Array(9).fill(''); tttLastPlaced = -1;
  tttOn = true; tttIsAI = false; tttLobbyId = lobbyId;
  tttIsHost = isHost; tttMySymbol = isHost ? 'X' : 'O';
  tttCurrentTurn = 'X';
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('ttt-screen').style.display = 'block';
  document.getElementById('btn-again').style.display = 'inline-block';
  document.getElementById('pbot-pts-wrap').style.display = 'none';
  var overlay = document.getElementById('ttt-overlay');
  if (overlay) overlay.classList.remove('show');
  var myClr = tttMySymbol === 'X' ? 'x-color' : 'o-color';
  var oppClr = tttMySymbol === 'X' ? 'o-color' : 'x-color';
  var mySym = tttMySymbol === 'X' ? '✕' : '◯';
  var oppSym = tttMySymbol === 'X' ? '◯' : '✕';
  document.getElementById('ttt-player-info').innerHTML =
    '<span class="ttt-you' + (isHost ? ' active' : '') + '">Du: <b class="' + myClr + '">' + mySym + '</b></span>' +
    '<span class="ttt-opp' + (!isHost ? ' active' : '') + '">Gegner: <b class="' + oppClr + '">' + oppSym + '</b></span>';
  var sym = tttMySymbol === 'X' ? '✕' : '◯';
  document.getElementById('ttt-status').textContent = 'Du bist ' + sym + (isHost ? ' — Du fängst an!' : ' — Gegner fängt an...');
  renderTTTBoard();
  if (tttPollInterval) clearInterval(tttPollInterval);
  tttPollInterval = setInterval(tttPollOnline, 400);
}

async function tttPollOnline() {
  if (!tttOn || !tttLobbyId || tttIsAI) return;
  if (tttMoveInFlight) return; // our move hasn't reached server yet — don't overwrite
  if (tttCurrentTurn === tttMySymbol) return;
  try {
    var res = await fetch(API_URL + '/api/lobby/' + tttLobbyId);
    if (!res.ok) return;
    var lobby = await res.json();
    var state = lobby.game_state || {};
    if (!state.board) return;
    // Detect opponent move for animation
    var changed = false;
    for (var i = 0; i < 9; i++) {
      if (!tttBoard[i] && state.board[i]) { tttLastPlaced = i; changed = true; break; }
    }
    if (!changed && state.currentTurn === tttCurrentTurn) return;
    tttBoard = state.board;
    tttCurrentTurn = state.currentTurn;
    renderTTTBoard();
    var result = tttCheck();
    if (result) {
      clearInterval(tttPollInterval); tttPollInterval = null;
      tttGameOver(result);
    } else {
      var sym = tttCurrentTurn === 'X' ? '✕' : '◯';
      var isMyTurn = tttCurrentTurn === tttMySymbol;
      document.getElementById('ttt-status').textContent = isMyTurn ? 'Du bist dran (' + sym + ')' : 'Gegner ist dran...';
    }
  } catch (e) {}
}

function renderTTTBoard() {
  var board = document.getElementById('ttt-board');
  if (!board) return;
  var isMyTurn = tttCurrentTurn === tttMySymbol;
  var winLine = tttGetWinLine();
  var winSet = winLine ? new Set(winLine) : new Set();
  var html = '';
  tttBoard.forEach(function(cell, idx) {
    var sym = cell === 'X' ? '✕' : cell === 'O' ? '◯' : '';
    var cls = 'ttt-cell';
    if (cell) { cls += ' taken'; }
    else if (tttOn && isMyTurn) { cls += ' hoverable'; }
    if (cell === 'X') cls += ' x';
    else if (cell === 'O') cls += ' o';
    if (winSet.has(idx)) cls += ' win-cell';
    if (idx === tttLastPlaced) cls += ' placed';
    html += '<div class="' + cls + '" data-idx="' + idx + '">' + sym + '</div>';
  });
  tttLastPlaced = -1;
  board.innerHTML = html;
  if (tttOn && isMyTurn) {
    board.querySelectorAll('.ttt-cell:not(.taken)').forEach(function(cell) {
      cell.addEventListener('click', function() { tttClick(parseInt(this.dataset.idx)); });
    });
  }
  // Update player-info active indicator
  var playerInfo = document.getElementById('ttt-player-info');
  if (playerInfo && playerInfo.innerHTML) {
    var youSpan = playerInfo.querySelector('.ttt-you');
    var oppSpan = playerInfo.querySelector('.ttt-opp');
    if (youSpan && oppSpan) {
      var myTurn = tttOn && tttCurrentTurn === tttMySymbol;
      youSpan.classList.toggle('active', myTurn);
      oppSpan.classList.toggle('active', !myTurn && tttOn);
    }
  }
}

function tttClick(idx) {
  if (!tttOn || tttBoard[idx] || tttCurrentTurn !== tttMySymbol) return;
  tttBoard[idx] = tttMySymbol; tttLastPlaced = idx;
  tttCurrentTurn = tttMySymbol === 'X' ? 'O' : 'X';
  renderTTTBoard();
  var result = tttCheck();
  if (tttIsAI) {
    if (result) { tttGameOver(result); return; }
    document.getElementById('ttt-status').textContent = 'KI überlegt...';
    setTimeout(tttAiMove, 380);
  } else {
    // Online: send move first, then check for win — loser must see our move
    tttMoveInFlight = true;
    fetch(API_URL + '/api/lobby/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: tttLobbyId, user_id: user.id, move: idx })
    }).finally(function() {
      // Keep in-flight long enough for Supabase to propagate the write
      setTimeout(function() { tttMoveInFlight = false; }, 600);
    });
    if (result) { tttGameOver(result); return; }
    document.getElementById('ttt-status').textContent = 'Gegner ist dran...';
  }
}

function tttAiMove() {
  if (!tttOn) return;
  var idx = tttGetAiMove();
  if (idx === -1) return;
  tttBoard[idx] = 'O'; tttLastPlaced = idx; tttCurrentTurn = 'X';
  renderTTTBoard();
  var result = tttCheck();
  if (result) { tttGameOver(result); return; }
  document.getElementById('ttt-status').textContent = 'Du bist dran (✕)';
}

function tttGetAiMove() {
  var empty = tttBoard.reduce(function(acc, v, i) { if (v === '') acc.push(i); return acc; }, []);
  if (!empty.length) return -1;
  if (tttAiDiff === 'easy') return empty[Math.floor(Math.random() * empty.length)];
  if (tttAiDiff === 'medium') {
    var win = tttFindWin('O'); if (win !== -1) return win;
    var blk = tttFindWin('X'); if (blk !== -1) return blk;
    if (tttBoard[4] === '') return 4;
    return empty[Math.floor(Math.random() * empty.length)];
  }
  // hard: minimax
  var best = -Infinity, bestIdx = empty[0];
  empty.forEach(function(i) {
    tttBoard[i] = 'O';
    var s = tttMinimax(tttBoard, 0, false);
    tttBoard[i] = '';
    if (s > best) { best = s; bestIdx = i; }
  });
  return bestIdx;
}

function tttFindWin(sym) {
  var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], vals = [tttBoard[l[0]], tttBoard[l[1]], tttBoard[l[2]]];
    if (vals.filter(function(v) { return v === sym; }).length === 2 &&
        vals.filter(function(v) { return v === ''; }).length === 1)
      return l[vals.indexOf('')];
  }
  return -1;
}

function tttMinimax(b, depth, isMax) {
  var r = tttCheckBoard(b);
  if (r === 'O') return 10 - depth;
  if (r === 'X') return depth - 10;
  if (b.every(function(c) { return c !== ''; })) return 0;
  var sym = isMax ? 'O' : 'X', best = isMax ? -Infinity : Infinity;
  for (var i = 0; i < 9; i++) {
    if (b[i] !== '') continue;
    b[i] = sym;
    var s = tttMinimax(b, depth + 1, !isMax);
    b[i] = '';
    best = isMax ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function tttCheck() { return tttCheckBoard(tttBoard); }

function tttCheckBoard(b) {
  var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return b[l[0]];
  }
  return b.every(function(c) { return c !== ''; }) ? 'draw' : null;
}

function tttGetWinLine() {
  var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (tttBoard[l[0]] && tttBoard[l[0]] === tttBoard[l[1]] && tttBoard[l[1]] === tttBoard[l[2]]) return l;
  }
  return null;
}

function tttGameOver(result) {
  tttOn = false;
  if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
  var msg;
  if (result === 'draw') { msg = '🤝 Unentschieden!'; }
  else if (result === tttMySymbol) {
    msg = '🎉 Du hast gewonnen!';
    if (tttIsAI) {
      var pts = tttAiDiff === 'hard' ? 30 : tttAiDiff === 'medium' ? 20 : 10;
      saveHS('tictactoe', pts);
    } else {
      saveHS('multiplayer_wins', 1);
    }
  } else {
    msg = tttIsAI ? '🤖 KI gewinnt!' : '😢 Du hast verloren!';
  }
  document.getElementById('ttt-status').textContent = msg;
  renderTTTBoard();
  var overlay = document.getElementById('ttt-overlay');
  var overlayMsg = document.getElementById('ttt-overlay-msg');
  if (overlay && overlayMsg) {
    overlayMsg.textContent = msg;
    overlay.classList.add('show');
  }
}

function tttRematch() {
  var overlay = document.getElementById('ttt-overlay');
  if (overlay) overlay.classList.remove('show');
  if (tttIsAI) {
    tttStart(tttAiDiff);
  } else {
    tttLobbyId = null;
    loadLobbyScreen();
  }
}

function gameRematch() {
  var overlay = document.getElementById('ttt-overlay');
  if (overlay) overlay.classList.remove('show');
  if (which === 'connect4') {
    if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
    c4On = false; c4LobbyId = null;
    if (game) { game.stop(); game = null; }
    var cv = document.getElementById('c'); cv.style.display = 'none'; cv.style.width = ''; cv.style.height = '';
    if (c4IsAI) { c4Start(c4AiDiff); } else { document.getElementById('c4-area').classList.add('active'); loadC4LobbyScreen(); }
  } else if (which === 'elfmeter') {
    if (elfmPollInterval) { clearInterval(elfmPollInterval); elfmPollInterval = null; }
    elfmOn = false; elfmLobbyId = null;
    document.getElementById('elfmeter-game-screen').style.display = 'none';
    if (elfmIsAI) { elfmeterStart(elfmAiDiff); } else { document.getElementById('elfmeter-area').classList.add('active'); loadElfmeterLobbyScreen(); }
  } else if (which === 'rps') {
    if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
    rpsOn = false; rpsLobbyId = null;
    if (game) { game.stop(); game = null; }
    document.getElementById('rps-game-screen').style.display = 'none';
    document.getElementById('rps-overlay').style.display = 'none';
    if (rpsIsAI) { rpsStart(rpsAiDiff); } else { document.getElementById('rps-area').classList.add('active'); loadRpsLobbyScreen(); }
  } else if (which === 'chess') {
    if (chessPollInterval) { clearInterval(chessPollInterval); chessPollInterval = null; }
    chessOn = false; chessLobbyId = null;
    if (chessIsAI) { chessStart(chessAiDiff); } else { document.getElementById('chess-area').classList.add('active'); loadChessLobbyScreen(); }
  } else {
    tttRematch();
  }
}

function gameLeave() {
  var overlay = document.getElementById('ttt-overlay');
  if (overlay) overlay.classList.remove('show');
  closeG();
}

/* ---- PRIVATE CHAT ---- */
async function loadUnreadCounts() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/chat/unread/' + user.id);
    if (!res.ok) return;
    var data = await res.json();
    if (!Array.isArray(data)) return;
    var prevCounts = Object.assign({}, unreadCounts);
    unreadCounts = {};
    data.forEach(function(item) { unreadCounts[item.friend_id] = item.count; });
    updateSidebarBadges();
    // Show notification for new messages from each friend
    data.forEach(function(item) {
      var prev = prevCounts[item.friend_id] || 0;
      if (item.count > prev && loadUnreadCounts._initialized) {
        var friend = friendsList.find(function(f) { return f.id === item.friend_id; });
        var name = friend ? friend.name : 'Neue Nachricht';
        var preview = item.latest_message ? item.latest_message.slice(0, 80) : 'Hat dir geschrieben.';
        showLocalNotif('💬 ' + name, preview);
        addNotifEvent('💬', name, preview, true);
      }
    });
    loadUnreadCounts._initialized = true;
  } catch (e) {}
}
loadUnreadCounts._initialized = false;

function updateSidebarBadges() {
  document.querySelectorAll('.sidebar-friend').forEach(function(el) {
    var fid = parseInt(el.dataset.id);
    var badge = el.querySelector('.sidebar-unread-badge');
    var count = unreadCounts[fid] || 0;
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  });
}

function renderSidebar(friends) {
  friendsList = friends;
  var container = document.getElementById('sidebar-friends');
  if (!container) return;
  if (!friends.length) {
    container.innerHTML = '<div class="sidebar-empty">Noch keine Freunde</div>';
    return;
  }
  var html = '';
  friends.forEach(function(f) {
    var seed = f.avatar_seed || f.name || 'unknown';
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
    var count = unreadCounts[f.id] || 0;
    var presence = f.presence || (f.is_online ? 'online' : 'offline');
    html +=
      '<div class="sidebar-friend" data-id="' + f.id + '">' +
      '<div class="sidebar-friend-av-wrap chat-avatar-wrap" data-name="' + escHtml(f.name || '') + '" data-seed="' + encodeURIComponent(seed) + '" data-presence="' + presence + '" data-last-seen="' + (f.last_seen || '') + '">' +
      '<img class="sidebar-friend-av chat-avatar" src="' + av + '" alt="">' +
      '<span class="av-status-dot ' + presence + '"></span>' +
      '<span class="sidebar-unread-badge" style="display:' + (count > 0 ? 'flex' : 'none') + '">' + count + '</span>' +
      '</div>' +
      '<div class="sidebar-friend-info">' +
      '<div class="sidebar-friend-name">' + escHtml(f.name) + '</div>' +
      '<div class="sidebar-friend-status">' + presenceLabel(presence, f.last_seen) + '</div>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.sidebar-friend').forEach(function(el) {
    el.addEventListener('click', function(e) {
      var avWrap = e.target.closest('.chat-avatar-wrap');
      if (avWrap) { e.stopPropagation(); showUserStatusPopup(avWrap); return; }
      var fid = parseInt(this.dataset.id);
      var f = friendsList.find(function(fr) { return fr.id === fid; });
      if (f) openPrivateChat(f);
    });
  });
}

function openPrivateChat(friend) {
  activeChatFriend = friend;
  var seed = friend.avatar_seed || friend.name || 'unknown';
  document.getElementById('pc-avatar').src = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
  document.getElementById('pc-name').textContent = friend.name;
  document.getElementById('pc-presence').innerHTML = '';
  var pcWrap = document.getElementById('pc-avatar-wrap');
  if (pcWrap) {
    pcWrap.setAttribute('data-name', friend.name || '');
    pcWrap.setAttribute('data-seed', encodeURIComponent(seed));
    var initPresence = friend.presence || (friend.is_online ? 'online' : 'offline');
    pcWrap.setAttribute('data-presence', initPresence);
    pcWrap.setAttribute('data-last-seen', friend.last_seen || '');
    var dot = document.getElementById('pc-avatar-status-dot');
    if (dot) dot.className = 'av-status-dot ' + initPresence;
  }
  var dndBanner = document.getElementById('pc-dnd-banner');
  if (dndBanner) { dndBanner.style.display = 'none'; dndBanner.innerHTML = ''; }
  document.getElementById('pc-input').value = '';
  document.getElementById('private-chat-modal').classList.add('open');
  loadPrivateMessages();
  if (privateChatInterval) clearInterval(privateChatInterval);
  privateChatInterval = setInterval(loadPrivateMessages, 500);
  if (unreadCounts[friend.id]) { unreadCounts[friend.id] = 0; updateSidebarBadges(); }
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('expanded');
}

function closePrivateChat() {
  if (privateChatInterval) { clearInterval(privateChatInterval); privateChatInterval = null; }
  activeChatFriend = null;
  var modal = document.getElementById('private-chat-modal');
  modal.classList.remove('open');
  if (modal._resetDragPosition) modal._resetDragPosition();
}

async function loadPrivateMessages() {
  if (!user || !activeChatFriend) return;
  try {
    var res = await fetch(API_URL + '/api/chat/private/' + user.id + '/' + activeChatFriend.id + '?limit=50');
    if (!res.ok) return;
    var data = await res.json();
    var msgs = Array.isArray(data) ? data : (data.messages || []);
    var friendOnline = Array.isArray(data) ? false : !!data.friend_online;
    var friendPresence = Array.isArray(data) ? 'offline' : (data.friend_presence || 'offline');
    var friendLastSeen = Array.isArray(data) ? null : data.friend_last_seen;
    // Präsenz-Anzeige & "Nicht stören"-Hinweis im Header aktualisieren
    var presenceEl = document.getElementById('pc-presence');
    if (presenceEl) presenceEl.innerHTML = presenceLabel(friendPresence, friendLastSeen);
    var pcWrap2 = document.getElementById('pc-avatar-wrap');
    if (pcWrap2) {
      pcWrap2.setAttribute('data-presence', friendPresence);
      pcWrap2.setAttribute('data-last-seen', friendLastSeen || '');
      var pcDot = document.getElementById('pc-avatar-status-dot');
      if (pcDot) pcDot.className = 'av-status-dot ' + friendPresence;
    }
    var dndBanner = document.getElementById('pc-dnd-banner');
    if (dndBanner) {
      if (friendPresence === 'dnd') {
        dndBanner.style.display = 'flex';
        dndBanner.innerHTML = '🔕 ' + escHtml(activeChatFriend.name) + ' ist gerade auf "Nicht stören" und erhält aktuell keine Benachrichtigungen.';
      } else {
        dndBanner.style.display = 'none';
        dndBanner.innerHTML = '';
      }
    }
    if (!Array.isArray(msgs)) return;
    var container = document.getElementById('pc-messages');
    if (!container) return;
    var wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    var html = '';
    var lastDateKey = null;
    msgs.slice().reverse().forEach(function(m) {
      var d = new Date(m.created_at);
      var dateKey = d.toDateString();
      if (dateKey !== lastDateKey) {
        html += '<div class="chat-date-sep"><span>' + chatDateLabel(d) + '</span></div>';
        lastDateKey = dateKey;
      }
      var isOwn = m.sender_id === user.id;
      var seed = isOwn ? (user.avatar_seed || user.name) : (activeChatFriend.avatar_seed || activeChatFriend.name);
      var presence = isOwn ? ownPresence() : friendPresence;
      var lastSeen = isOwn ? null : friendLastSeen;
      var name = isOwn ? user.name : activeChatFriend.name;
      var time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      var receipt = '';
      if (isOwn) {
        if (!friendOnline) receipt = '<span class="chat-receipt tick-1" title="Gesendet">✓</span>';
        else if (m.is_read) receipt = '<span class="chat-receipt tick-blue" title="Gelesen">✓✓</span>';
        else receipt = '<span class="chat-receipt tick-gray" title="Zugestellt, ungelesen">✓✓</span>';
      }
      html +=
        '<div class="chat-msg' + (isOwn ? ' own' : '') + '">' +
        chatAvatarHtml(seed, presence, lastSeen, name) +
        '<div class="chat-bubble">' +
        '<div class="chat-meta"><span class="chat-name">' + escHtml(name) + '</span><span class="chat-time">' + time + receipt + '</span></div>' +
        '<div class="chat-text">' + escHtml(m.message) + '</div>' +
        '</div>' +
        '</div>';
    });
    container.innerHTML = html;
    if (wasAtBottom || container.scrollTop === 0) container.scrollTop = container.scrollHeight;
    if (unreadCounts[activeChatFriend.id]) { unreadCounts[activeChatFriend.id] = 0; updateSidebarBadges(); }
    loadPrivateTyping();
  } catch (e) {}
}

/* ---- TIPP-INDIKATOR: PRIVATER CHAT ---- */
var lastPrivateTypingSent = 0;
function notifyPrivateTyping() {
  if (!user || !activeChatFriend) return;
  var now = Date.now();
  if (now - lastPrivateTypingSent < 1500) return;
  lastPrivateTypingSent = now;
  fetch(API_URL + '/api/chat/typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, name: user.name, avatar_seed: user.avatar_seed || user.name, scope: 'private', target_id: activeChatFriend.id })
  }).catch(function() {});
}

async function loadPrivateTyping() {
  if (!user || !activeChatFriend) return;
  try {
    var res = await fetch(API_URL + '/api/chat/typing/private/' + activeChatFriend.id + '?user_id=' + user.id);
    if (!res.ok) return;
    var data = await res.json();
    var el = document.getElementById('pc-typing');
    if (!el) return;
    if (data && data.typing) {
      var seed = activeChatFriend.avatar_seed || activeChatFriend.name || 'unknown';
      el.innerHTML = '<span class="typing-avatars"><img src="https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed) + '" alt=""></span>' +
        '<span>' + escHtml(activeChatFriend.name) + ' tippt</span><span class="typing-dots"><span></span><span></span><span></span></span>';
      el.classList.add('active');
    } else {
      el.classList.remove('active');
      el.innerHTML = '';
    }
  } catch (e) {}
}

async function sendPrivateMessage() {
  if (!user || !activeChatFriend) return;
  var input = document.getElementById('pc-input');
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  try {
    await fetch(API_URL + '/api/chat/private', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: user.id, receiver_id: activeChatFriend.id, message: msg })
    });
    loadPrivateMessages();
  } catch (e) {}
}

/* ---- TOAST & ACHIEVEMENTS ---- */
function showToast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
}

function checkAchievements() {
  var done = JSON.parse(localStorage.getItem('achievements') || '{}');
  var total = getScoreTotal(user);
  if (!done.first_score && total > 0) {
    done.first_score = true; showToast('🎯 Erster Score!');
  }
  if (!done.games10 && (user.games_played || 0) >= 10) {
    done.games10 = true; showToast('🔥 10 Spiele!');
  }
  if (!done.profi && total >= 50) {
    done.profi = true; showToast('⭐ Profi!');
  }
  if (!done.legende && total >= 300) {
    done.legende = true; showToast('👑 Legende!');
  }
  if (!done.speed_demon && user.reaction > 0 && user.reaction < 300) {
    done.speed_demon = true; showToast('⚡ Blitz-Reaktion! Unter 300ms!');
  }
  if (!done.bullseye && (user.precision || 0) >= 80) {
    done.bullseye = true; showToast('🫧 Blasenmeister! 80+ Bubble-Punkte!');
  }
  if (!done.mastermind && (user.guess || 0) >= 90) {
    done.mastermind = true; showToast('🧠 Mastermind! 90+ beim Raten!');
  }
  if (!done.wordmaster && (user.wordle || 0) >= 80) {
    done.wordmaster = true; showToast('💻 Wortmeister! Wordle gemeistert!');
  }
  localStorage.setItem('achievements', JSON.stringify(done));
}

/* ---- FREUNDE V2 ---- */

async function loadFriends() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/friends/' + user.id);
    var friends = await res.json();
    if (!res.ok || !Array.isArray(friends)) { renderFriendsBoard([]); renderSidebar([]); return; }
    friendIdsSet = new Set(friends.map(function(f) { return f.id; }));
    renderFriendsBoard(friends);
    renderSidebar(friends);
  } catch (err) {
    document.getElementById('friends-list').innerHTML = '<span style="color:var(--dim);font-size:0.82rem">Nicht verfügbar</span>';
    renderSidebar([]);
  }
}

function renderFriendsBoard(friends) {
  var container = document.getElementById('friends-list');
  if (!friends.length) {
    container.innerHTML = '<div style="color:var(--dim);font-size:0.82rem;padding:0.3rem 0">Noch keine Freunde.</div>';
    return;
  }
  var sorted = friends.slice().sort(function(a, b) {
    return ((b.memory||0)+(b.stack||0)) - ((a.memory||0)+(a.stack||0));
  });
  var html = '';
  sorted.forEach(function(f) {
    var seed = f.avatar_seed || f.name || 'unknown';
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
    html +=
      '<div class="friend-row">' +
      '<img class="fr-avatar" src="' + av + '" alt="">' +
      '<div class="fr-info">' +
      '<div class="fr-name">' + f.name + '</div>' +
      '<div class="fr-status">' + formatLastSeen(f.last_seen, f.is_online) + '</div>' +
      '</div>' +
      '<button class="btn-remove-friend" data-id="' + f.id + '" title="Entfernen">✕</button>' +
      '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.btn-remove-friend').forEach(function(btn) {
    btn.addEventListener('click', function() { removeFriend(parseInt(this.dataset.id)); });
  });
}

async function removeFriend(friendId) {
  try {
    await fetch(API_URL + '/api/friends/remove', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, friend_id: friendId })
    });
    loadFriends();
  } catch (err) { console.error(err); }
}

async function loadFriendRequests() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/friends/requests/' + user.id);
    var requests = await res.json();
    if (!res.ok || !Array.isArray(requests)) return;
    // Badge aktualisieren
    var badge = document.getElementById('friends-badge');
    if (badge) {
      badge.textContent = requests.length;
      badge.style.display = requests.length > 0 ? 'inline-flex' : 'none';
    }
    // Local push notification for new friend requests
    var prevCount = parseInt(loadFriendRequests._prevCount || 0);
    if (requests.length > prevCount && prevCount >= 0 && loadFriendRequests._prevCount !== undefined) {
      var newest = requests[0];
      var frMsg = (newest.name||'Jemand') + ' möchte dich als Freund hinzufügen!';
      showLocalNotif('👥 Freundschaftsanfrage', frMsg);
      addNotifEvent('👥', 'Freundschaftsanfrage', frMsg, true);
    }
    loadFriendRequests._prevCount = requests.length;
    renderFriendRequests(requests);
  } catch (err) { console.error(err); }
}

function renderFriendRequests(requests) {
  var container = document.getElementById('friends-requests');
  var title = document.getElementById('requests-title');
  if (!requests.length) {
    container.innerHTML = '';
    if (title) title.style.display = 'none';
    return;
  }
  if (title) title.style.display = '';
  var html = '';
  requests.forEach(function(r) {
    var seed = r.avatar_seed || r.name || 'unknown';
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
    html +=
      '<div class="friend-request-row">' +
      '<img class="fr-avatar" src="' + av + '" alt="">' +
      '<div class="fr-info">' +
      '<div class="fr-name">' + r.name + '</div>' +
      '<div class="fr-status">' + formatLastSeen(r.last_seen, r.is_online) + '</div>' +
      '</div>' +
      '<button class="btn-accept" data-id="' + r.id + '">✅</button>' +
      '<button class="btn-decline" data-id="' + r.id + '">❌</button>' +
      '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.btn-accept').forEach(function(btn) {
    btn.addEventListener('click', function() { respondFriend(parseInt(this.dataset.id), 'accept'); });
  });
  container.querySelectorAll('.btn-decline').forEach(function(btn) {
    btn.addEventListener('click', function() { respondFriend(parseInt(this.dataset.id), 'decline'); });
  });
}

async function respondFriend(friendshipId, action) {
  try {
    var res = await fetch(API_URL + '/api/friends/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendship_id: friendshipId, action: action })
    });
    if (res.ok) {
      if (action === 'accept') showToast('👥 Freundschaft angenommen!');
      loadFriends();
      loadFriendRequests();
    }
  } catch (err) { console.error(err); }
}

/* ---- FREUNDE SUCHE (alle laden, lokal filtern) ---- */
async function loadAllUsersForSearch() {
  if (!user) return;
  var container = document.getElementById('friend-search-results');
  if (container) container.innerHTML = '<div style="color:var(--dim);font-size:0.82rem;padding:0.3rem 0">Lädt...</div>';
  try {
    var res = await fetch(API_URL + '/api/users/search?me=' + user.id);
    var users = await res.json();
    if (!res.ok || !Array.isArray(users)) return;
    allUsersCache = users.sort(function(a, b) { return a.name.localeCompare(b.name); });
    var q = document.getElementById('friend-search') ? document.getElementById('friend-search').value.trim().toLowerCase() : '';
    var filtered = q ? allUsersCache.filter(function(u) { return u.name.toLowerCase().indexOf(q) !== -1; }) : allUsersCache;
    renderSearchResults(filtered);
  } catch (err) {
    if (container) container.innerHTML = '<div style="color:var(--dim);font-size:0.82rem">Nicht verfügbar</div>';
  }
}

document.addEventListener('DOMContentLoaded', function() {
  var searchInput = document.getElementById('friend-search');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var q = this.value.trim().toLowerCase();
      if (!allUsersCache.length) { loadAllUsersForSearch(); return; }
      var filtered = q ? allUsersCache.filter(function(u) { return u.name.toLowerCase().indexOf(q) !== -1; }) : allUsersCache;
      renderSearchResults(filtered);
    });
    searchInput.addEventListener('focus', function() {
      if (!allUsersCache.length) loadAllUsersForSearch();
    });
  }
});

function renderSearchResults(results) {
  var container = document.getElementById('friend-search-results');
  if (!container) return;
  if (!results.length) {
    container.innerHTML = '<div style="color:var(--dim);font-size:0.82rem;padding:0.3rem 0">Keine Ergebnisse.</div>';
    return;
  }
  var html = '';
  results.forEach(function(u) {
    var seed = u.avatar_seed || u.name || 'unknown';
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
    var isFriend = friendIdsSet.has(u.id);
    var sentReq = sentRequestIds.has(u.id);
    var btnText = isFriend ? '✓ Freund' : sentReq ? '✓ Gesendet' : '+ Anfragen';
    var btnDis = (isFriend || sentReq) ? ' disabled' : '';
    html +=
      '<div class="search-user-row">' +
      '<img class="fr-avatar" src="' + av + '" alt="">' +
      '<div class="fr-info">' +
      '<div class="fr-name">' + u.name + '</div>' +
      '<div class="fr-status">' + formatLastSeen(u.last_seen, u.is_online) + '</div>' +
      '</div>' +
      '<button class="btn-send-request" data-id="' + u.id + '"' + btnDis + '>' + btnText + '</button>' +
      '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.btn-send-request:not([disabled])').forEach(function(btn) {
    btn.addEventListener('click', function() { sendFriendRequest(parseInt(this.dataset.id), this); });
  });
}

async function sendFriendRequest(friendId, btn) {
  if (!user) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var res = await fetch(API_URL + '/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, friend_id: friendId })
    });
    var data = await res.json();
    if (res.ok) {
      btn.textContent = '✓ Gesendet';
      sentRequestIds.add(friendId);
      showToast('📩 Anfrage gesendet!');
    } else {
      btn.textContent = data.error || 'Fehler';
      setTimeout(function() { btn.disabled = false; btn.textContent = '+ Anfragen'; }, 2000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '+ Anfragen';
  }
}

function setLoading(btnId, isLoading, normalText) {
var btn = document.getElementById(btnId);
btn.disabled = isLoading;
btn.innerHTML = isLoading
? '<span class="spinner"></span>'
: normalText;
}

// Tab-Umschaltung zwischen Anmelden / Registrieren
// Tab-Switching is now handled in the Account Picker block below

/* ---- REGISTRIEREN ---- */
document.getElementById('btn-register').addEventListener('click', async function() {
  var n = document.getElementById('reg-name').value.trim();
  var p1 = document.getElementById('reg-pass').value;
  var p2 = document.getElementById('reg-pass2').value;
  var e = document.getElementById('login-err');
  // Validierung
  if (!n || !p1 || !p2) { e.textContent = 'Bitte alle Felder ausfuellen.'; return; }
  if (n.length < 2) { e.textContent = 'Benutzername zu kurz (min. 2 Zeichen).'; return; }
  if (p1.length < 4) { e.textContent = 'Passwort zu kurz (min. 4 Zeichen).'; return; }
  if (p1 !== p2) { e.textContent = 'Passwoerter stimmen nicht ueberein.'; return; }

  setLoading('btn-register', true, '▶ KONTO ERSTELLEN');

  try {
    var res = await fetch(API_URL + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, pass: p1, pass2: p2 })
    });
    var data = await res.json();
    if (!res.ok || !data.user) {
      e.textContent = data.error || 'Registrierung fehlgeschlagen.';
      setLoading('btn-register', false, '▶ KONTO ERSTELLEN');
      return;
    }
    user = data.user;
    saveStoredAccount(data.user.name);
    sessionStorage.removeItem('logged_out');
    // Optional E-Mail direkt bei Registrierung speichern
    var regEmail = document.getElementById('reg-email') && document.getElementById('reg-email').value.trim();
    if (regEmail && regEmail.includes('@')) {
      try {
        await fetch(API_URL + '/api/user/set-email', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ user_id: user.id, email: regEmail })
        });
        user.email = regEmail.toLowerCase();
        localStorage.setItem('emailPromptDone_' + user.id, '1');
      } catch(ex) {}
    }
    setLoading('btn-register', false, '▶ KONTO ERSTELLEN');
    enterApp();
  } catch (err) {
    e.textContent = 'Verbindungsfehler zum Server!';
    setLoading('btn-register', false, '▶ KONTO ERSTELLEN');
  }
});

/* ════════════════════════════════════════════════════════
   PASSWORT VERGESSEN / RESET
   ════════════════════════════════════════════════════════ */

// ── Forgot-PW Modal ───────────────────────────────────────
document.getElementById('btn-forgot-pw').addEventListener('click', function() {
  document.getElementById('forgot-pw-modal').style.display = 'flex';
  // Pre-fill username from login field if already typed
  var loginName = document.getElementById('login-name').value.trim();
  if (loginName) document.getElementById('fpw-username').value = loginName;
  document.getElementById('fpw-email').value = '';
  document.getElementById('fpw-msg').textContent = '';
  document.getElementById('fpw-msg').className = 'fpw-msg';
  setTimeout(function() {
    var focus = loginName ? document.getElementById('fpw-email') : document.getElementById('fpw-username');
    focus.focus();
  }, 100);
});
document.getElementById('fpw-close').addEventListener('click', function() {
  document.getElementById('forgot-pw-modal').style.display = 'none';
});
document.getElementById('forgot-pw-modal').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});
document.getElementById('fpw-send-btn').addEventListener('click', async function() {
  var username = document.getElementById('fpw-username').value.trim();
  var email    = document.getElementById('fpw-email').value.trim();
  var msg      = document.getElementById('fpw-msg');
  if (!username) { msg.textContent = 'Bitte Benutzernamen eingeben.'; msg.className = 'fpw-msg error'; return; }
  if (!email)    { msg.textContent = 'Bitte E-Mail eingeben.';        msg.className = 'fpw-msg error'; return; }
  var btn = this;
  btn.textContent = '…'; btn.disabled = true;
  msg.textContent = ''; msg.className = 'fpw-msg';
  try {
    var res = await fetch(API_URL + '/api/forgot-password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: username, email: email })
    });
    var data = await res.json();
    if (res.ok && data.success) {
      msg.textContent = data.message || '✅ Link gesendet!';
      msg.className = 'fpw-msg success';
    } else {
      msg.textContent = data.error || 'Fehler.';
      msg.className = 'fpw-msg error';
    }
  } catch(e) {
    msg.textContent = 'Verbindungsfehler.'; msg.className = 'fpw-msg error';
  }
  btn.textContent = '▶ LINK SENDEN'; btn.disabled = false;
});

// ── First-Login Email Prompt ──────────────────────────────
// ── Spotlight auf Avatar wenn keine E-Mail ────────────────
function maybeShowEmailPrompt() {
  if (!user) return;
  if (user.email) return;
  var key = 'emailPromptDone_' + user.id;
  if (localStorage.getItem(key)) return;
  // Subtiler Spotlight auf Avatar statt penetrantem Modal
  setTimeout(function() {
    var wrap = document.getElementById('avatar-spotlight-wrap');
    if (wrap) wrap.classList.add('spotlight-active');
  }, 1200);
}
function clearEmailSpotlight() {
  var wrap = document.getElementById('avatar-spotlight-wrap');
  if (wrap) wrap.classList.remove('spotlight-active');
  localStorage.setItem('emailPromptDone_' + (user && user.id), '1');
}
document.getElementById('ep-save-btn').addEventListener('click', async function() {
  var email = document.getElementById('ep-email-input').value.trim();
  var msg = document.getElementById('ep-msg');
  if (!email) { msg.textContent = 'Bitte E-Mail eingeben.'; msg.className = 'fpw-msg error'; return; }
  var btn = this; btn.textContent = '…'; btn.disabled = true;
  try {
    var res = await fetch(API_URL + '/api/user/set-email', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: user.id, email: email })
    });
    var data = await res.json();
    if (data.success) {
      user.email = email.toLowerCase().trim();
      localStorage.setItem('emailPromptDone_' + user.id, '1');
      document.getElementById('email-prompt-modal').style.display = 'none';
      renderProfileEmail();
    } else {
      msg.textContent = data.error || 'Fehler.'; msg.className = 'fpw-msg error';
    }
  } catch(e) { msg.textContent = 'Verbindungsfehler.'; msg.className = 'fpw-msg error'; }
  btn.textContent = '✓ E-MAIL SPEICHERN & SICHER SEIN'; btn.disabled = false;
});
document.getElementById('ep-skip-btn').addEventListener('click', function() {
  document.getElementById('ep-confirm-skip').style.display = 'flex';
});
document.getElementById('ep-confirm-no').addEventListener('click', function() {
  document.getElementById('ep-confirm-skip').style.display = 'none';
  document.getElementById('ep-email-input').focus();
});
document.getElementById('ep-confirm-yes').addEventListener('click', function() {
  localStorage.setItem('emailPromptDone_' + user.id, 'skipped');
  document.getElementById('email-prompt-modal').style.display = 'none';
});

// ── Reset-PW Panel (URL ?reset=TOKEN) ────────────────────
(async function checkResetToken() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('reset');
  if (!token) return;
  // Show reset panel, hide login
  document.getElementById('login').classList.add('hide');
  document.getElementById('reset-pw-panel').style.display = 'flex';
  try {
    var res = await fetch(API_URL + '/api/verify-reset-token/' + token);
    var data = await res.json();
    document.getElementById('reset-pw-loading').style.display = 'none';
    if (data.valid) {
      document.getElementById('reset-pw-username').textContent = 'Neues Passwort für: ' + data.username;
      document.getElementById('reset-pw-form').style.display = '';
    } else {
      document.getElementById('reset-pw-invalid').style.display = '';
    }
  } catch(e) {
    document.getElementById('reset-pw-loading').style.display = 'none';
    document.getElementById('reset-pw-invalid').style.display = '';
  }
})();

document.getElementById('reset-pw-btn').addEventListener('click', async function() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('reset');
  var p1 = document.getElementById('reset-new-pass').value;
  var p2 = document.getElementById('reset-new-pass2').value;
  var err = document.getElementById('reset-pw-err');
  if (!p1 || !p2) { err.textContent = 'Bitte beide Felder ausfüllen.'; return; }
  if (p1 !== p2) { err.textContent = 'Passwörter stimmen nicht überein.'; return; }
  if (p1.length < 4) { err.textContent = 'Passwort zu kurz (min. 4 Zeichen).'; return; }
  this.textContent = '…'; this.disabled = true;
  try {
    var res = await fetch(API_URL + '/api/reset-password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, newPass: p1 })
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('reset-pw-form').style.display = 'none';
      document.getElementById('reset-pw-success').style.display = '';
      err.textContent = '';
      // Clean URL
      window.history.replaceState({}, '', '/');
    } else {
      err.textContent = data.error || 'Fehler beim Zurücksetzen.';
    }
  } catch(e) { err.textContent = 'Verbindungsfehler.'; }
  this.textContent = '▶ PASSWORT SPEICHERN'; this.disabled = false;
});

/* ---- ACCOUNT PICKER (localStorage) ---- */
function getStoredAccounts() {
  try { return JSON.parse(localStorage.getItem('arcadeAccounts') || '[]'); } catch(e) { return []; }
}
function saveStoredAccount(name) {
  var accounts = getStoredAccounts();
  // remove if exists, then push to front
  accounts = accounts.filter(function(a) { return a.toLowerCase() !== name.toLowerCase(); });
  accounts.unshift(name);
  localStorage.setItem('arcadeAccounts', JSON.stringify(accounts.slice(0, 8)));
}
function removeStoredAccount(name) {
  var accounts = getStoredAccounts().filter(function(a) { return a.toLowerCase() !== name.toLowerCase(); });
  localStorage.setItem('arcadeAccounts', JSON.stringify(accounts));
  renderAccountPicker();
}
function renderAccountPicker() {
  var accounts = getStoredAccounts();
  var picker = document.getElementById('login-picker');
  var forms = document.getElementById('login-forms');
  var backBtn = document.getElementById('lp-back-btn');
  if (accounts.length === 0) {
    picker.style.display = 'none';
    forms.style.display = '';
    if (backBtn) backBtn.style.display = 'none';
    return;
  }
  picker.style.display = '';
  forms.style.display = 'none';
  if (backBtn) backBtn.style.display = 'none';
  var container = document.getElementById('lp-accounts');
  container.innerHTML = '';
  accounts.forEach(function(name, idx) {
    var card = document.createElement('div');
    card.className = 'lp-account-card';
    card.style.animationDelay = (idx * 0.06) + 's';
    var seed = encodeURIComponent(name);
    card.innerHTML =
      '<img class="lp-av" src="https://api.dicebear.com/7.x/adventurer/svg?seed='+seed+'" loading="lazy">' +
      '<div class="lp-card-info">' +
        '<div class="lp-card-name">'+escHtml(name)+'</div>' +
        '<div class="lp-card-sub">Passwort eingeben →</div>' +
      '</div>' +
      '<span class="lp-card-arrow">▶</span>' +
      '<button class="lp-card-delete" title="Konto entfernen" data-name="'+escHtml(name)+'">✕</button>';
    // Click card → go to login form with prefilled name
    card.querySelector('.lp-av, .lp-card-info, .lp-card-arrow').addEventListener
    && card.addEventListener('click', function(e) {
      if (e.target.classList.contains('lp-card-delete')) return;
      picker.style.display = 'none';
      forms.style.display = '';
      // switch to login tab
      document.querySelector('.tab[data-tab="login"]').click();
      var nameInput = document.getElementById('login-name');
      nameInput.value = name;
      nameInput.classList.add('lp-prefilled');
      document.getElementById('login-pass').focus();
      if (backBtn) backBtn.style.display = '';
    });
    card.querySelector('.lp-card-delete').addEventListener('click', function(e) {
      e.stopPropagation();
      removeStoredAccount(name);
    });
    container.appendChild(card);
  });
}
// New account button
document.getElementById('lp-new-btn').addEventListener('click', function() {
  document.getElementById('login-picker').style.display = 'none';
  document.getElementById('login-forms').style.display = '';
  document.getElementById('lp-back-btn').style.display = '';
  document.getElementById('login-name').value = '';
  document.getElementById('login-name').classList.remove('lp-prefilled');
  document.getElementById('login-pass').value = '';
  // switch to register tab
  document.querySelector('.tab[data-tab="register"]').click();
});
// Back to picker button
document.getElementById('lp-back-btn').addEventListener('click', function() {
  document.getElementById('login-name').classList.remove('lp-prefilled');
  renderAccountPicker();
});
// Tab switching
document.querySelectorAll('.tab[data-tab]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tab = this.dataset.tab;
    document.querySelectorAll('.tab[data-tab]').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(function(f){ f.classList.remove('active'); });
    var form = document.getElementById('form-' + tab);
    if (form) form.classList.add('active');
    document.getElementById('login-err').textContent = '';
  });
});
// Init picker on page load
renderAccountPicker();

/* ---- LOGIN ---- */
document.getElementById('btn-login').addEventListener('click', async function() {
  var n = document.getElementById('login-name').value.trim();
  var p = document.getElementById('login-pass').value;
  var e = document.getElementById('login-err');

  if (!n || !p) { e.textContent = 'Bitte beides ausfüllen.'; return; }
  if (n.length < 2) { e.textContent = 'Name zu kurz.'; return; }

  setLoading('btn-login', true, '▶ EINLOGGEN');

  try {
    var res = await fetch(API_URL + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, pass: p })
    });
    var data = await res.json();
    if (!res.ok || !data.user) {
      e.textContent = data.error || 'Login fehlgeschlagen.';
      setLoading('btn-login', false, '▶ EINLOGGEN');
      return;
    }
    user = data.user;
    saveStoredAccount(data.user.name); // save with correct casing from server
    sessionStorage.removeItem('logged_out');
    setLoading('btn-login', false, '▶ EINLOGGEN');
    enterApp();
  } catch (err) {
    e.textContent = 'Verbindungsfehler zum Server!';
    setLoading('btn-login', false, '▶ EINLOGGEN');
  }
});

/* ---- EINLOGGEN HILFSFUNKTION ---- */
function enterApp() {
  document.getElementById('login-err').textContent = '';
  document.getElementById('login').classList.add('hide');
  document.getElementById('app').classList.add('show');
  document.getElementById('username').textContent = user.name;
  var seed = user.avatar_seed || user.name;
document.getElementById("avatar").src =
"https://api.dicebear.com/7.x/adventurer/svg?seed=" + seed;
  showHS();
  loadGlobalHS();
  loadStats();
  loadFriends();
  loadFriendRequests();
  // Globaler Chat laden
  lastChatCount = 0;
  loadGlobalChat();
  if (chatInterval) clearInterval(chatInterval);
  chatInterval = setInterval(loadGlobalChat, 500);
  // Sidebar + Global-Chat-Button sichtbar schalten
  document.getElementById('sidebar').classList.add('visible');
  document.getElementById('sidebar-mobile-btn').classList.add('visible');
  document.getElementById('global-chat-btn').classList.add('visible');
  applyChatIconsVisibility();
  updateHeaderStatusDot();
  unreadCounts = {};
  loadUnreadCounts._initialized = false; // reset so first load doesn't trigger notifs for old messages
  loadUnreadCounts();
  if (unreadInterval) clearInterval(unreadInterval);
  unreadInterval = setInterval(loadUnreadCounts, 5000);
  // Heartbeat starten
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 20000);
  // Live Activity — SSE for instant real-time updates
  startLiveStream();
  // Anfragen periodisch prüfen
  if (requestsInterval) clearInterval(requestsInterval);
  requestsInterval = setInterval(function() { loadFriendRequests(); }, 60000);
  // Spiel-Einladungen pollen (firstCheck unterdrückt alte Einladungen beim Login)
  seenInviteIds = new Set();
  inviteFirstCheck = true;
  if (inviteInterval) clearInterval(inviteInterval);
  inviteInterval = setInterval(checkGameInvites, 500);
  // Theme-Button Emoji setzen
  var themeBtn = document.getElementById('btn-theme');
  if (themeBtn) themeBtn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
  // Push notifications (delayed slightly so UI settles first)
  setTimeout(initPushNotifications, 1200);
  // Start arcade particle system
  startArcadeParticles();
  // Show email prompt spotlight if not yet set
  maybeShowEmailPrompt();
  // Show onboarding guide for new users
  setTimeout(maybeShowGuide, 600);
}

/* ════════════════════════════════════════════════════════════
   ONBOARDING GUIDE SYSTEM
   ════════════════════════════════════════════════════════════ */
var guideActive = false;
var guideCurrentStep = 0;
var guideSteps = [];
var guideTypewriterTimer = null;
var guideTransitioning = false;

function buildGuideSteps() {
  var name = user ? user.name : 'Spieler';
  return [
    // Step 1: Spotlight on mascot (guide-mascot-wrap), blinking arrow on WEITER
    {
      target: 'guide-mascot-wrap', rounded: false, pad: 18,
      mascotTarget: true, // tells showGuideStep to set first-step class
      text: 'Willkommen ' + name + '! 👋 Ich bin Arci — dein Guide! Ich zeige dir alles in ~30 Sekunden. Klick WEITER ▶ um zu starten!',
      before: function(cb){ closeAllPanels(); setTimeout(cb,150); }, after: null
    },
    // Step 2: Avatar — perfect white circle, centered
    {
      target: 'avatar-spotlight-wrap', rounded: true, pad: 8,
      text: 'Das ist dein Avatar! Klick ihn an um dein Status-Menü (Aktiv/Abwesend/Nicht stören) zu öffnen oder dein Profil zu bearbeiten.',
      before: function(cb){ closeAllPanels(); setTimeout(cb,150); }, after: null
    },
    // Step 3: Avatar arrows (in profile overlay)
    {
      target: 'avatar-prev', rounded: false, pad: 10,
      text: 'Mit diesen Pfeilen kannst du deinen Avatar wechseln. Über 100 Avatare zur Auswahl!',
      before: function(cb){ openProfileForGuide(cb); }, after: null
    },
    // Step 4: Email row in settings
    {
      target: 'profile-email-row', rounded: false, pad: 12,
      text: 'In den Einstellungen ⚙️ kannst du deine E-Mail für Passwort-Reset hinterlegen. Wichtig — ohne E-Mail ist dein Konto verloren!',
      before: function(cb){
        document.getElementById('profile-overlay').classList.remove('on');
        openSettingsOverlay();
        setTimeout(cb, 250);
      }, after: null
    },
    // Step 5: Close settings button — perfect circle
    {
      target: 'btn-close-settings', rounded: true, pad: 8,
      text: 'Mit diesem X-Button schließt du die Einstellungen wieder.',
      before: null, after: function(cb){
        document.getElementById('settings-overlay').classList.remove('on');
        setTimeout(cb, 300);
      }
    },
    // Step 6: Notification bell — perfect circle
    {
      target: 'btn-notif-center', rounded: true, pad: 8,
      text: 'Das Benachrichtigungs-Center 🔔 — hier siehst du Freundesanfragen, Spieleinladungen und Neuigkeiten!',
      before: null, after: null
    },
    // Step 7: Notif tabs
    {
      target: 'nc-tabs-wrap', rounded: false, pad: 8,
      text: 'Drei Tabs: Aktivität, Freundesanfragen und Patchnotes. Einfach durchklicken!',
      before: function(cb){ openNotifForGuide(cb); }, after: null
    },
    // Step 8: Theme button — perfect circle
    {
      target: 'btn-theme', rounded: true, pad: 8,
      text: 'Dark & Light Mode 🌙☀️ — hier wechselst du das Design ganz nach Geschmack!',
      before: function(cb){ closeNotifForGuide(cb); }, after: null
    },
    // Step 9: Logout
    {
      target: 'btn-logout', rounded: false, pad: 8,
      text: 'Hier kannst du dich abmelden. Deine Scores & Freunde sind natürlich gespeichert!',
      before: null, after: null
    },
    // Step 10: Singleplayer games
    {
      target: 'cat-single', rounded: false, pad: 12,
      text: '🎮 Singleplayer-Spiele — 9 Stück! Gedächtnis, Reaktion, Flappy Bird, Snake, Wort-Blitz und mehr. Alle mit Highscore!',
      before: null, after: null
    },
    // Step 11: Multiplayer games
    {
      target: 'cat-multi', rounded: false, pad: 12,
      text: '⚔️ Multiplayer! Schach, TicTacToe, 4 Gewinnt, Tipp-Rennen, Rechen-Duell — alle gegen Freunde oder KI!',
      before: null, after: null
    },
    // Step 12: Global scoreboard tab
    {
      target: 'board-tab-global', rounded: false, pad: 10,
      text: '🏆 Globales Scoreboard — sieh wo du stehst. Filter: Top 3, Top 5, Top 10 oder alle Spieler!',
      before: null, after: null
    },
    // Step 13: Friends tab button only
    {
      target: 'board-tab-friends', rounded: false, pad: 10,
      text: '👥 Der Freunde-Tab — füge Freunde hinzu, suche Spieler und fordere sie zu Duellen heraus!',
      before: null, after: null
    },
    // Step 14: Rank-info ❓ — circle spotlight
    {
      target: 'rank-info-btn', rounded: true, pad: 8,
      text: '❓ Das Rang-System! Klick hier um zu sehen wie Rang-Punkte vergeben werden — von Neuling bis Legende!',
      before: null, after: null
    },
    // Step 15: Goodbye — spotlight back on mascot, walk-out
    {
      target: 'guide-mascot-wrap', rounded: false, pad: 18,
      mascotWalkOut: true,
      text: 'Das war\'s! Viel Spaß ' + name + '! 🎮 Möge der beste Spieler gewinnen! 🏆',
      before: null, after: null
    }
  ];
}

function maybeShowGuide() {
  if (!user) return;
  var key = 'guideShown_' + user.id;
  if (localStorage.getItem(key)) return;
  // Show guide-start modal
  document.getElementById('guide-start-modal').style.display = 'flex';
}

function initGuideListeners() {
  var btnYes  = document.getElementById('guide-start-yes');
  var btnNo   = document.getElementById('guide-start-no');
  var btnSkip = document.getElementById('guide-btn-skip');
  var btnNext = document.getElementById('guide-btn-next');
  var btnPrev = document.getElementById('guide-btn-prev');
  if (btnYes)  btnYes.addEventListener('click', function() {
    document.getElementById('guide-start-modal').style.display = 'none';
    localStorage.setItem('guideShown_' + (user&&user.id), '1');
    startGuide();
  });
  if (btnNo)   btnNo.addEventListener('click', function() {
    document.getElementById('guide-start-modal').style.display = 'none';
    localStorage.setItem('guideShown_' + (user&&user.id), '1');
  });
  if (btnSkip) btnSkip.addEventListener('click', finishGuide);
  if (btnNext) btnNext.addEventListener('click', function(){ if(!guideTransitioning) guideNext(); });
  if (btnPrev) btnPrev.addEventListener('click', function(){ if(!guideTransitioning) guidePrev(); });
}
document.addEventListener('DOMContentLoaded', function() {
  initGuideListeners();
  // Guide restart button in header
  var restartBtn = document.getElementById('btn-guide-restart');
  if (restartBtn) restartBtn.addEventListener('click', function() {
    if (guideActive) finishGuide();
    else startGuide();
  });
});

document.addEventListener('keydown', function(e) {
  if (!guideActive) return;
  if (e.key === 'ArrowRight' || e.key === 'Enter') { if(!guideTransitioning) guideNext(); }
  if (e.key === 'ArrowLeft') { if(!guideTransitioning) guidePrev(); }
  if (e.key === 'Escape') finishGuide();
});

function startGuide() {
  guideSteps = buildGuideSteps();
  guideCurrentStep = 0;
  guideActive = true;
  var overlay = document.getElementById('guide-overlay');
  overlay.style.display = '';
  overlay.classList.add('active');
  showGuideStep(0);
}

function finishGuide() {
  guideActive = false;
  var overlay = document.getElementById('guide-overlay');
  overlay.style.display = 'none';
  overlay.classList.remove('active', 'first-step');
  closeAllPanels();
  var mascot = document.getElementById('guide-mascot');
  if (mascot) mascot.classList.remove('walk-out', 'waving');
  var wrap = document.getElementById('avatar-spotlight-wrap');
  if (wrap) wrap.classList.remove('spotlight-active');
}

function showGuideStep(idx) {
  var step = guideSteps[idx];
  if (!step) { finishGuide(); return; }
  guideTransitioning = true;

  // Update counter + button text immediately
  document.getElementById('guide-step-counter').textContent = (idx+1) + ' / ' + guideSteps.length;
  document.getElementById('guide-btn-prev').disabled = idx === 0;
  document.getElementById('guide-btn-next').textContent = idx === guideSteps.length-1 ? 'FERTIG ✓' : 'WEITER ▶';

  // first-step blinking arrow class
  var overlay = document.getElementById('guide-overlay');
  if (step.mascotTarget && idx === 0) {
    overlay.classList.add('first-step');
  } else {
    overlay.classList.remove('first-step');
  }

  // mascot waving / walk-out
  var mascot = document.getElementById('guide-mascot');
  if (mascot) {
    mascot.classList.remove('walk-out', 'waving');
    if (step.mascotTarget) mascot.classList.add('waving');
    if (step.mascotWalkOut) {
      setTimeout(function(){ mascot.classList.add('walk-out'); }, 600);
    }
  }

  // Start typewriter right away
  typewriteText(step.text);

  function doPosition() {
    positionSpotlight(step);
    guideTransitioning = false;
  }

  if (step.before) {
    step.before(function(){ setTimeout(doPosition, 150); });
  } else {
    doPosition();
  }
}

function guideNext() {
  var step = guideSteps[guideCurrentStep];
  function proceed() {
    guideCurrentStep++;
    if (guideCurrentStep >= guideSteps.length) { finishGuide(); return; }
    showGuideStep(guideCurrentStep);
  }
  if (step && step.after) { guideTransitioning=true; step.after(proceed); }
  else proceed();
}
function guidePrev() {
  if (guideCurrentStep <= 0) return;
  guideCurrentStep--;
  showGuideStep(guideCurrentStep);
}

function positionSpotlight(step) {
  var spotlight = document.getElementById('guide-spotlight');
  if (!step.target) {
    spotlight.className = 'guide-spotlight hidden';
    return;
  }
  var el = document.getElementById(step.target);
  if (!el) { spotlight.className = 'guide-spotlight hidden'; return; }

  // Scroll element into view first, then measure after scroll settles
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(function() {
    var rect = el.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    // Adaptive padding — bigger elements get more breathing room
    var basePad = step.pad !== undefined ? step.pad : 16;
    var pad = Math.max(basePad, Math.min(rect.width, rect.height) * 0.08);

    var spotW = rect.width  + pad * 2;
    var spotH = rect.height + pad * 2;
    var spotL = rect.left   - pad;
    var spotT = rect.top    - pad;

    // If the element is too large for viewport, clamp to 90% of screen
    var maxW = vw * 0.90;
    var maxH = vh * 0.75;
    if (spotW > maxW) { spotW = maxW; spotL = (vw - maxW) / 2; }
    if (spotH > maxH) { spotH = maxH; spotT = (vh - maxH) / 2; }

    // Keep spotlight within viewport
    if (spotL < 4) spotL = 4;
    if (spotT < 4) spotT = 4;
    if (spotL + spotW > vw - 4) spotL = vw - spotW - 4;
    if (spotT + spotH > vh - 4) spotT = vh - spotH - 4;

    // For rounded (circle) spotlights: force square so circle is perfect
    if (step.rounded) {
      var side = Math.max(spotW, spotH);
      spotL = spotL - (side - spotW) / 2;
      spotT = spotT - (side - spotH) / 2;
      spotW = side; spotH = side;
    }

    spotlight.style.left   = spotL + 'px';
    spotlight.style.top    = spotT + 'px';
    spotlight.style.width  = spotW + 'px';
    spotlight.style.height = spotH + 'px';
    spotlight.className    = 'guide-spotlight' + (step.rounded ? ' rounded' : '');
  }, 320); // wait for scroll to finish
}

function typewriteText(text) {
  if (guideTypewriterTimer) clearInterval(guideTypewriterTimer);
  var el = document.getElementById('guide-bubble-text');
  el.textContent = '';
  var i = 0;
  guideTypewriterTimer = setInterval(function() {
    if (i < text.length) { el.textContent += text[i++]; }
    else { clearInterval(guideTypewriterTimer); guideTypewriterTimer = null; }
  }, 28);
}

// Guide helper: open/close profile
function openProfileForGuide(cb) {
  var overlay = document.getElementById('profile-overlay');
  if (overlay && !overlay.classList.contains('on')) {
    openProfileOverlay();
    setTimeout(cb, 400);
  } else { cb(); }
}
function closeProfileForGuide(cb) {
  var overlay = document.getElementById('profile-overlay');
  if (overlay && overlay.classList.contains('on')) {
    document.getElementById('btn-close-profile').click();
  }
  setTimeout(cb, 300);
}
function openNotifForGuide(cb) {
  closeAllPanels();
  setTimeout(function() {
    openNotifCenter();
    setTimeout(cb, 350);
  }, 200);
}
function closeNotifForGuide(cb) {
  closeNotifCenter();
  setTimeout(cb, 300);
}
function switchToFriendsTab(cb) {
  closeAllPanels();
  var tab = document.querySelector('[data-board="friends"]');
  if (tab) tab.click();
  setTimeout(cb, 200);
}
function closeAllPanels() {
  var profileOverlay = document.getElementById('profile-overlay');
  if (profileOverlay && profileOverlay.classList.contains('on')) {
    var closeBtn = document.getElementById('btn-close-profile');
    if (closeBtn) closeBtn.click();
  }
  var settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay && settingsOverlay.classList.contains('on')) {
    var closeSettingsBtn = document.getElementById('btn-close-settings');
    if (closeSettingsBtn) closeSettingsBtn.click();
  }
  var statusMenu = document.getElementById('avatar-status-menu');
  if (statusMenu) statusMenu.classList.remove('on');
  closeNotifCenter();
}

/* ════════════════════════════════════════════════
   ARCADE CANVAS — Outrun/Tron live background
   ════════════════════════════════════════════════ */
var arcadeRaf = null;
var arcadeCanvas = null;

function startArcadeParticles() {
  if (arcadeCanvas) return;
  var app = document.getElementById('app');
  if (!app) return;

  // Create full-screen canvas
  var cv = document.createElement('canvas');
  cv.id = 'arcade-bg-canvas';
  cv.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  app.prepend(cv);
  arcadeCanvas = cv;

  var ctx = cv.getContext('2d');
  var W, H, t = 0;

  function resize() {
    W = cv.width  = window.innerWidth;
    H = cv.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Rain columns (Matrix-style but with arcade chars) ──
  var COLS_RAIN = Math.floor(window.innerWidth / 18) || 30;
  var rainChars = '♠♣♥♦★☆▲▼◆●○□■ABCDE01234'.split('');
  var rain = [];
  for (var i = 0; i < COLS_RAIN; i++) {
    rain.push({ y: Math.random() * -100, speed: 0.4 + Math.random() * 0.7, bright: Math.random() > 0.85 });
  }

  // ── Neon orbs (reduced to 5 for performance) ──
  var orbs = [];
  for (var o = 0; o < 5; o++) {
    orbs.push({
      x: Math.random() * 1000, y: Math.random() * 800,
      vx: (Math.random()-0.5)*0.3, vy: (Math.random()-0.5)*0.3,
      r: 80+Math.random()*100, hue: Math.random()*360,
      phase: Math.random()*Math.PI*2
    });
  }

  // ── Particles ──
  var parts = [];
  function addParticle() {
    parts.push({
      x: Math.random()*W, y: H + 10,
      vx: (Math.random()-0.5)*1.2, vy: -0.6-Math.random()*1.4,
      life: 1, decay: 0.006+Math.random()*0.008,
      r: 1.5+Math.random()*2.5,
      rgb: Math.random()>0.5 ? '255,87,51' : Math.random()>0.5 ? '139,92,246' : '251,191,36'
    });
  }

  // ── Perspective grid ──
  function drawGrid() {
    var vx = W/2, vy = H*0.42;
    var speed = (t * 0.0006) % 1;
    // Horizontal lines scrolling toward viewer
    for (var row = 0; row < 14; row++) {
      var p = ((row / 13) + speed) % 1;
      var gy = vy + (H - vy) * Math.pow(p, 1.6);
      var hw = (H - vy) * Math.pow(p, 1.6) * 1.3;
      var alpha = Math.pow(p, 0.7) * 0.30;
      ctx.strokeStyle = 'rgba(255,87,51,' + alpha + ')';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(vx - hw, gy); ctx.lineTo(vx + hw, gy); ctx.stroke();
    }
    // Vertical convergence lines
    for (var col = -7; col <= 7; col++) {
      var xBot = vx + col * (W / 13);
      ctx.beginPath(); ctx.moveTo(xBot, H); ctx.lineTo(vx, vy);
      ctx.strokeStyle = 'rgba(139,92,246,0.09)';
      ctx.lineWidth = 0.5; ctx.stroke();
    }
    // Horizon glow
    var hg = ctx.createLinearGradient(0, vy-30, 0, vy+30);
    hg.addColorStop(0, 'transparent');
    hg.addColorStop(0.5, 'rgba(255,87,51,0.06)');
    hg.addColorStop(1, 'transparent');
    ctx.fillStyle = hg; ctx.fillRect(0, vy-30, W, 60);
  }

  // ── Character rain (no shadowBlur — too expensive) ──
  function drawRain() {
    COLS_RAIN = Math.max(1, Math.floor(W / 22)); // fewer columns
    while (rain.length < COLS_RAIN) rain.push({ y: Math.random()*-100, speed:0.3+Math.random()*0.6, bright:false, ch:'' });
    ctx.font = '11px monospace'; ctx.textAlign = 'center';
    for (var i = 0; i < Math.min(rain.length, COLS_RAIN); i++) {
      var col = rain[i];
      var cx = i * (W / COLS_RAIN) + (W / COLS_RAIN / 2);
      col.y += col.speed;
      if (col.y > H + 20) {
        col.y = -Math.random()*200;
        col.bright = Math.random()>0.9;
        col.speed = 0.3+Math.random()*0.6;
        col.ch = rainChars[Math.floor(Math.random()*rainChars.length)];
      }
      if (!col.ch) col.ch = rainChars[Math.floor(Math.random()*rainChars.length)];
      ctx.fillStyle = col.bright ? 'rgba(255,255,255,0.65)' : 'rgba(255,87,51,0.15)';
      ctx.fillText(col.ch, cx, col.y);
    }
  }

  // ── Orbs (no gradients every frame — use cached simple circles) ──
  function drawOrbs() {
    ctx.save();
    for (var i = 0; i < orbs.length; i++) {
      var ob = orbs[i];
      ob.x += ob.vx; ob.y += ob.vy;
      if (ob.x < -ob.r) ob.x = W + ob.r;
      if (ob.x > W + ob.r) ob.x = -ob.r;
      if (ob.y < -ob.r) ob.y = H + ob.r;
      if (ob.y > H + ob.r) ob.y = -ob.r;
      ob.hue = (ob.hue + 0.08) % 360;
      // Simple filled circle — no expensive radial gradient every frame
      ctx.globalAlpha = 0.04 + 0.02 * Math.sin(t * 0.015 + ob.phase);
      ctx.fillStyle = 'hsl(' + Math.round(ob.hue) + ',80%,60%)';
      ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // ── Particles (no stroke/shadowBlur) ──
  function drawParticles() {
    if (t % 12 === 0) addParticle(); // spawn less often
    parts = parts.filter(function(p){ return p.life > 0; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      ctx.globalAlpha = p.life * 0.6;
      ctx.fillStyle = 'rgb('+p.rgb+')';
      ctx.fillRect(p.x - p.r/2, p.y - p.r/2, p.r, p.r); // rect instead of arc (faster)
    }
    ctx.globalAlpha = 1;
  }

  // ── Scan line ──
  function drawScanline() {
    var sy = (t * 1.8) % (H + 100) - 50;
    var sg = ctx.createLinearGradient(0, sy, 0, sy + 50);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.025)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, sy, W, 50);
  }

  // ── Main loop — throttled to 30fps to reduce CPU load ──
  var lastFrameMs = 0;
  function frame(now) {
    if (!arcadeCanvas) return;
    // Skip frame if less than 33ms since last (= 30fps cap)
    if (now - lastFrameMs < 33) { arcadeRaf = requestAnimationFrame(frame); return; }
    lastFrameMs = now;
    ctx.clearRect(0, 0, W, H);
    drawOrbs();
    drawGrid();
    drawRain();
    drawParticles();
    drawScanline();
    t++;
    arcadeRaf = requestAnimationFrame(frame);
  }
  frame();
}

function stopArcadeParticles() {
  if (arcadeRaf) { cancelAnimationFrame(arcadeRaf); arcadeRaf = null; }
  if (arcadeCanvas) { arcadeCanvas.remove(); arcadeCanvas = null; }
}

document.getElementById("btn-logout").addEventListener("click",
async function() {
if (!confirm("Wirklich abmelden?")) return;
// Intervals stoppen
if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
if (requestsInterval) { clearInterval(requestsInterval); requestsInterval = null; }
if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
if (unreadInterval) { clearInterval(unreadInterval); unreadInterval = null; }
if (inviteInterval) { clearInterval(inviteInterval); inviteInterval = null; }
if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
if (pongPollInterval) { clearInterval(pongPollInterval); pongPollInterval = null; }
if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
closePrivateChat();
friendsList = []; unreadCounts = {}; seenInviteIds = new Set(); tttOn = false; c4On = false; pongOn = false; rpsOn = false;
document.getElementById('sidebar').classList.remove('visible', 'expanded');
document.getElementById('sidebar-mobile-btn').classList.remove('visible');
document.getElementById('global-chat-btn').classList.remove('visible');
document.getElementById('global-chat-panel').classList.remove('open');
// Push-Subscription entfernen (kein Push mehr wenn ausgeloggt)
if (user) {
  try {
    await fetch(API_URL + '/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id })
    });
  } catch(e) {}
  // Auch im Browser unsubscribe
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch(e) {}
}
// Online-Status setzen
if (user) {
  try { await fetch(API_URL + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) }); } catch(e) {}
}
sessionStorage.setItem('logged_out', 'true');
localStorage.removeItem('notif_asked');
stopLiveStream();
document.cookie = 'arcadebox_user=; max-age=0';
user = null;
allUsersCache = []; friendIdsSet = new Set(); sentRequestIds = new Set();
if (game) { game.stop(); game = null; }
// Alle Popups schließen
document.getElementById("popup")
.classList.remove("on");
document.getElementById("profile-overlay")
.classList.remove("on");
document.getElementById("memory-pads")
.classList.remove("active");
// UI zurücksetzen
document.getElementById("app").classList.remove("show");
document.getElementById("login").classList.remove("hide");
document.getElementById("login-pass").value = "";
document.getElementById("login-name").value = "";
document.getElementById("login-name").classList.remove('lp-prefilled');
document.getElementById("reg-name").value = "";
document.getElementById("reg-pass").value = "";
document.getElementById("reg-pass2").value = "";
var regEmailEl = document.getElementById("reg-email"); if(regEmailEl) regEmailEl.value = "";
document.getElementById("login-err").textContent = "";
// Picker oder Login-Tab anzeigen
renderAccountPicker();
if (!getStoredAccounts().length) {
  document.querySelector('.tab[data-tab="login"]').click();
}
}
);

async function saveHS(g, s) {
  if (!user) return false;

  try {
    var res = await fetch(API_URL + '/api/save-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, game_type: g, score: s })
    });

    user.games_played = (user.games_played || 0) + 1;
    if (g === 'reaction') {
      if (!user[g] || s < user[g]) user[g] = s; // niedrigere ms = besser
    } else if (g === 'bubble') {
      if (s > (user.precision || 0)) user.precision = s;
    } else {
      if (s > (user[g] || 0)) user[g] = s;
    }

    showHS();
    loadGlobalHS();
    loadStats();
    sounds.highscore();
    checkAchievements();
    return true;
  } catch (err) {
    console.error('Verbindungsfehler:', err);
    return false;
  }
}

function showHS() {
  function badge(score) {
    if (score >= 50) return '👑 ';
    if (score >= 25) return '⭐ ';
    if (score >= 10) return '🔥 ';
    return '';
  }
  var reactionMs = user.reaction || 0;
  var reactionDisplay = reactionMs > 0
    ? (reactionMs < 400 ? '🟢 ' : '') + reactionMs + 'ms ⚡'
    : '-';
  // Update rank badge first (always, even if hs-list section was removed)
  var rankEl = document.getElementById('stat-rank');
  if (rankEl) rankEl.textContent = myRankPoints > 0 ? getRank(myRankPoints) : '🌱 Neuling';

  var hsList = document.getElementById('hs-list');
  if (!hsList) return; // hs-list section removed — skip the rest
  hsList.innerHTML =
    '<div class="hs-row"><span>🧠 Farb-Gedächtnis</span><span>' + badge(user.memory||0) + (user.memory||0) + '</span></div>' +
    '<div class="hs-row"><span>🧱 Turm-Stapler</span><span>' + badge(user.stack||0) + (user.stack||0) + '</span></div>' +
    '<div class="hs-row"><span>⚡ Reaktionstest</span><span>' + reactionDisplay + '</span></div>' +
    '<div class="hs-row"><span>🫧 Bubble Pop</span><span>' + badge(user.precision||0) + (user.precision||0) + '</span></div>' +
    '<div class="hs-row"><span>🔢 Zahlen-Raten</span><span>' + badge(user.guess||0) + (user.guess||0) + '</span></div>' +
    '<div class="hs-row"><span>💻 Info-Wordle</span><span>' + badge(user.wordle||0) + (user.wordle||0) + '</span></div>' +
    '<div class="hs-row"><span>🐦 Flappy Bird</span><span>' + badge(user.flappy||0) + (user.flappy||0) + '</span></div>' +
    '<div class="hs-row"><span>🐍 Schlange</span><span>' + badge(user.snake||0) + (user.snake||0) + '</span></div>' +
    '<div class="hs-row"><span>⌨️ Wort-Blitz</span><span>' + badge(user.wortblitz||0) + (user.wortblitz||0) + '</span></div>';
}

/* ---- GLOBALES SCOREBOARD ---- */
var sbAllScores = [];
var sbFilterLimit = 'all';
var sbCurrentFiltered = [];

// Scoreboard filter buttons
document.querySelectorAll('.sb-filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.sb-filter-btn').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    sbFilterLimit = this.dataset.limit;
    renderSbTable();
  });
});

function avUrl(item) { return 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(item.avatar_seed || item.name || 'x'); }
function isMeClass(item) { return (user && item.name === user.name) ? ' sb-me' : ''; }
function medal(i) { return i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+''; }
function fmtVal(val, key) {
  if (!val || val === 0) return '<span style="opacity:0.3">—</span>';
  if (key === 'reaction_ms') return '<span class="sbt-val-num">'+val+'</span><span class="sbt-val-unit">ms</span>';
  if (key === 'stack') return '<span class="sbt-val-num">'+val+'</span><span class="sbt-val-unit"> Et.</span>';
  return '<span class="sbt-val-num">'+val+'</span>';
}
var sbCols = [
  { key:'memory',      th:'🧠', label:'Gedächtnis', cls:'sbt-memory'   },
  { key:'stack',       th:'🧱', label:'Turm',       cls:'sbt-stack'    },
  { key:'reaction_ms', th:'⚡', label:'Reaktion',   cls:'sbt-reaction' },
  { key:'precision',   th:'🫧', label:'Bubble',     cls:'sbt-bubble'   },
  { key:'guess',       th:'🔢', label:'Zahlen',     cls:'sbt-guess'    },
  { key:'wordle',      th:'💻', label:'Wordle',     cls:'sbt-wordle'   },
  { key:'flappy',      th:'🐦', label:'Flappy',     cls:'sbt-flappy'   },
  { key:'snake',       th:'🐍', label:'Schlange',   cls:'sbt-snake'    },
  { key:'wortblitz',   th:'⌨️', label:'Wort-Blitz', cls:'sbt-wortblitz'}
];

function renderSbTable() {
  var scores = sbAllScores;
  if (!scores || !scores.length) return;

  // Filter
  var filtered = scores;
  if (sbFilterLimit === 'friends') {
    filtered = scores.filter(function(s) {
      return (user && s.name === user.name) || friendIdsSet.has && Array.from(friendIdsSet).some(function(fid){
        return false; // friendIdsSet stores IDs, scores store names — filter by name from friends list
      });
    });
    // Use friendNames set instead
    var friendNames = new Set();
    document.querySelectorAll('.friend-name').forEach(function(el){ friendNames.add(el.textContent.trim().toLowerCase()); });
    filtered = scores.filter(function(s){ return (user && s.name===user.name) || friendNames.has(s.name.toLowerCase()); });
  } else if (sbFilterLimit !== 'all') {
    filtered = scores.slice(0, parseInt(sbFilterLimit));
  }
  sbCurrentFiltered = filtered;

  var cols = sbCols;
  var thead = '<thead><tr><th class="sbt-th-rank"></th><th class="sbt-th-player">Spieler</th><th class="sbt-divider-after sbt-rp-col" style="min-width:44px">RP<span class="sbt-th-label">Rang-Pkt.</span></th>';
  for (var ci=0;ci<cols.length;ci++) thead += '<th class="'+cols[ci].cls+'">'+cols[ci].th+'<span class="sbt-th-label">'+cols[ci].label+'</span></th>';
  thead += '</tr></thead>';
  var tbody = '<tbody>';
  var mobileList = '<div class="sb-mobile-list">';
  for (var i=0;i<filtered.length;i++) {
    var s = filtered[i]; var rp = s.rank_points||0;
    if (isMeClass(s)) { myRankPoints=rp; var re=document.getElementById('stat-rank'); if(re) re.textContent=getRank(rp); }
    var meClass = isMeClass(s) ? ' sbt-me':'';
    tbody += '<tr class="sbt-row'+meClass+'"><td class="sbt-td-rank">'+medal(i)+'</td><td class="sbt-td-player"><div class="sbt-player-inner"><img src="'+avUrl(s)+'" class="sb-av" loading="lazy"><span class="sbt-player-name">'+escHtml(s.name)+'</span><span class="sbt-rank-badge" style="color:'+getRankColor(rp)+'">'+getRank(rp)+'</span></div></td><td class="sbt-td-rp sbt-divider-after">'+rp+'<span class="sbt-rp-unit"> RP</span></td>';
    for (var ci2=0;ci2<cols.length;ci2++) tbody += '<td class="sbt-td-val">'+fmtVal(s[cols[ci2].key],cols[ci2].key)+'</td>';
    tbody += '</tr>';
    mobileList += '<div class="sb-mobile-row'+meClass+'" data-idx="'+i+'"><span class="sbm-rank">'+medal(i)+'</span><img src="'+avUrl(s)+'" class="sbm-av" loading="lazy"><span class="sbm-name">'+escHtml(s.name)+'</span><span class="sbm-chevron">›</span></div>';
  }
  if (!filtered.length) {
    tbody += '<tr><td colspan="12" class="sb-empty">Keine Einträge</td></tr>';
    mobileList += '<div class="sb-empty">Keine Einträge</div>';
  }
  tbody += '</tbody>';
  mobileList += '</div>';
  var label = sbFilterLimit==='all'?'Alle Spieler':sbFilterLimit==='friends'?'Freunde':('Top '+sbFilterLimit);
  document.getElementById('global-hs').innerHTML = '<div class="sb-unified"><div class="sb-unified-header">🏆 '+label+' — Gesamtranking</div><div class="sb-table-wrap"><table class="sb-table">'+thead+tbody+'</table></div>'+mobileList+'</div>';
}

function pdDiffBadge(leftVal, rightVal, key) {
  var lv = leftVal||0, rv = rightVal||0;
  if (!lv || !rv) return '';
  var diff = key === 'reaction_ms' ? (lv - rv) : (rv - lv);
  if (diff === 0) return '<span class="pd-diff pd-diff-neutral">±0</span>';
  var cls = diff > 0 ? 'pd-diff-good' : 'pd-diff-bad';
  var sign = diff > 0 ? '+' : '−';
  return '<span class="pd-diff '+cls+'">'+sign+Math.abs(diff)+'</span>';
}

function pdStatRow(icon, label, leftVal, rightVal, key) {
  var leftHtml = key === 'rank_points' ? (leftVal||0)+'<span class="pd-stat-unit"> RP</span>' : fmtVal(leftVal, key);
  var rightHtml = key === 'rank_points' ? (rightVal||0)+'<span class="pd-stat-unit"> RP</span>' : fmtVal(rightVal, key);
  var leftCls = '', rightCls = '';
  var lv = leftVal||0, rv = rightVal||0;
  if (lv && rv && lv !== rv) {
    var leftWins = key === 'reaction_ms' ? lv < rv : lv > rv;
    leftCls = leftWins ? ' pd-better' : '';
    rightCls = leftWins ? '' : ' pd-better';
  }
  return '<div class="pd-stat">'
    + '<span class="pd-stat-value pd-stat-left'+leftCls+'">'+leftHtml+'</span>'
    + '<span class="pd-stat-mid"><span class="pd-stat-icon">'+icon+'</span><span class="pd-stat-label">'+label+'</span></span>'
    + '<span class="pd-stat-value pd-stat-right'+rightCls+'">'+rightHtml+pdDiffBadge(leftVal, rightVal, key)+'</span>'
    + '</div>';
}

function openPlayerDetail(s) {
  var rp = s.rank_points || 0;
  document.getElementById('pd-avatar').src = avUrl(s);
  document.getElementById('pd-name').textContent = s.name;
  var badge = document.getElementById('pd-rank-badge');
  badge.textContent = getRank(rp);
  badge.style.color = getRankColor(rp);

  var me = (user && sbAllScores.find(function(r){ return r.name === user.name; })) || user || {};
  var myRp = me.rank_points || 0;
  document.getElementById('pd-my-avatar').src = avUrl(me);
  document.getElementById('pd-my-name').textContent = me.name || 'Du';
  var myBadge = document.getElementById('pd-my-rank-badge');
  myBadge.textContent = getRank(myRp);
  myBadge.style.color = getRankColor(myRp);

  var body = pdStatRow('🏆', 'Rang-Punkte', rp, myRp, 'rank_points');
  for (var ci=0; ci<sbCols.length; ci++) {
    var c = sbCols[ci];
    body += pdStatRow(c.th, c.label, s[c.key], me[c.key], c.key);
  }
  document.getElementById('pd-body').innerHTML = body;
  document.getElementById('player-detail-overlay').classList.add('open');
}

document.getElementById('global-hs').addEventListener('click', function(e) {
  var row = e.target.closest('.sb-mobile-row');
  if (!row) return;
  var player = sbCurrentFiltered[parseInt(row.dataset.idx, 10)];
  if (player) openPlayerDetail(player);
});
document.getElementById('pd-close').addEventListener('click', function() {
  document.getElementById('player-detail-overlay').classList.remove('open');
});
document.getElementById('player-detail-overlay').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

async function loadGlobalHS() {
  try {
    var res = await fetch(API_URL + '/api/global-highscores');
    if (!res.ok) { document.getElementById('global-hs').innerHTML = '<p class="sb-empty">Fehler beim Laden</p>'; return; }
    var scores = await res.json();
    if (!scores || !Array.isArray(scores) || !scores.length) {
      document.getElementById('global-hs').innerHTML = '<p class="sb-empty">Noch keine Scores</p>';
      return;
    }
    sbAllScores = scores;
    renderSbTable();
  } catch (err) {
    console.error('Fehler beim Laden der Highscores:', err);
    document.getElementById('global-hs').innerHTML = '<p class="sb-empty">Fehler beim Laden</p>';
  }
}

async function loadStats() {
if (!user) return;
document.getElementById("stat-games").textContent = user.games_played || 0;
document.getElementById("stat-total").textContent = getScoreTotal(user);

try {
  var res = await fetch(API_URL + '/api/user/' + user.id);
  var userData = await res.json();

  if (res.ok && userData) {
    user = userData;
    document.getElementById("stat-games").textContent = user.games_played || 0;
    document.getElementById("stat-total").textContent = getScoreTotal(user);
    showHS();
  }
} catch (err) {
  console.error('Fehler beim Laden der Stats:', err);
}
}

/* ---- BOARD TABS (Global / Freunde) ---- */
document.querySelectorAll('.board-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.board-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.board-panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('board-' + tab.dataset.board).classList.add('active');
    if (tab.dataset.board === 'friends') {
      loadAllUsersForSearch();
    }
  });
});

// beforeunload: is_online = false setzen
window.addEventListener('beforeunload', function() {
  if (user) {
    var blob = new Blob([JSON.stringify({ user_id: user.id })], { type: 'application/json' });
    navigator.sendBeacon(API_URL + '/api/logout', blob);
  }
});

/* ---- THEME TOGGLE ---- */
document.getElementById('btn-theme').addEventListener('click', function() {
  document.body.classList.toggle('light');
  var isLight = document.body.classList.contains('light');
  this.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

/* ---- POPUP ---- */
document.getElementById('card-memory').addEventListener('click', function() { openG('memory'); });
document.getElementById('card-stack').addEventListener('click', function() { openG('stack'); });
document.getElementById('card-reaction').addEventListener('click', function() { openG('reaction'); });
document.getElementById('card-bubble').addEventListener('click', function() { openG('bubble'); });
document.getElementById('card-guess').addEventListener('click', function() { openG('guess'); });
document.getElementById('card-wordle').addEventListener('click', function() { openG('wordle'); });
document.getElementById('card-flappy').addEventListener('click', function() { openG('flappy'); });
document.getElementById('card-multiplayer').addEventListener('click', function() { openG('multiplayer'); });
document.getElementById('card-connect4').addEventListener('click', function() { openG('connect4'); });
document.getElementById('card-elfmeter').addEventListener('click', function() { openG('elfmeter'); });
document.getElementById('card-rps').addEventListener('click', function() { openG('rps'); });
document.getElementById('card-chess').addEventListener('click', function() { openG('chess'); });
document.getElementById('card-snake').addEventListener('click', function() { openG('snake'); });
document.getElementById('card-wortblitz').addEventListener('click', function() { openG('wortblitz'); });
document.getElementById('card-math').addEventListener('click', function() { openG('math'); });
document.getElementById('btn-x').addEventListener('click', closeG);
document.getElementById('btn-again').addEventListener('click', resetG);
document.getElementById('popup').addEventListener('click', function(e) { if (e.target === this) closeG(); });
document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChatMessage(); });
document.getElementById('chat-input').addEventListener('input', notifyGlobalTyping);
document.getElementById('chat-window').addEventListener('click', function(e) {
  var wrap = e.target.closest('.chat-avatar-wrap');
  if (wrap) { e.stopPropagation(); showUserStatusPopup(wrap); }
});
document.getElementById('sidebar-toggle').addEventListener('click', function() {
  document.getElementById('sidebar').classList.toggle('expanded');
});
document.getElementById('sidebar-mobile-btn').addEventListener('click', function() {
  document.getElementById('sidebar').classList.toggle('expanded');
});
// Global chat floating button
document.getElementById('global-chat-btn').addEventListener('click', function() {
  var panel = document.getElementById('global-chat-panel');
  var opening = !panel.classList.contains('open');
  if (!opening) {
    panel.classList.remove('open');
    gcPanelOpen = false;
    if (panel._resetDragPosition) panel._resetDragPosition();
    return;
  }
  panel.classList.add('open');
  gcPanelOpen = true;
  updateGcBadge(0);
  loadGlobalChat();
  setTimeout(function() {
    var w = document.getElementById('chat-window');
    if (w) w.scrollTop = w.scrollHeight;
  }, 80);
});
document.getElementById('gc-close').addEventListener('click', function() {
  var panel = document.getElementById('global-chat-panel');
  panel.classList.remove('open');
  gcPanelOpen = false;
  if (panel._resetDragPosition) panel._resetDragPosition();
});
// Rang-Legende Modal
document.getElementById('rank-info-btn').addEventListener('click', function() {
  document.getElementById('rank-legend-overlay').classList.add('open');
});
document.getElementById('rank-legend-close').addEventListener('click', function() {
  document.getElementById('rank-legend-overlay').classList.remove('open');
});
document.getElementById('rank-legend-overlay').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
// ── Kategorie-Collapse ────────────────────────────────────────
document.querySelectorAll('.cat-header').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var expanded = this.getAttribute('aria-expanded') === 'true';
    this.setAttribute('aria-expanded', String(!expanded));
    var body = this.closest('.game-category').querySelector('.cat-body');
    if (expanded) {
      body.classList.add('collapsed');
    } else {
      body.classList.remove('collapsed');
    }
  });
});

// ── Vertical edge draggable (for chat button) ─────────────────
function makeVerticalEdgeDraggable(btn, storageKey) {
  // Restore saved position (convert from bottom-based CSS to top-based)
  var saved = localStorage.getItem(storageKey);
  if (saved) {
    btn.style.top = saved + 'px';
    btn.style.bottom = 'auto';
    btn.style.transform = 'none';
  }

  var longPressTimer = null;
  var dragging = false;
  var startY = 0, startTop = 0;

  function onDown(e) {
    if (e.target !== btn && e.target.parentElement !== btn) return;
    var cy = e.clientY;
    if (e.touches) cy = e.touches[0].clientY;
    startY = cy;
    longPressTimer = setTimeout(function() {
      // Get actual visual top position right now
      var rect = btn.getBoundingClientRect();
      startTop = rect.top;
      startY = cy;
      dragging = true;
      btn.style.transition = 'none';
      btn.style.transform = 'none';   // clear translateY(-50%) if present
      btn.style.bottom = 'auto';       // override any CSS bottom:
      btn.style.top = startTop + 'px';
      btn.style.outline = '2px solid rgba(255,255,255,0.6)';
      btn.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.18)';
    }, 480);
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    var cy = e.clientY;
    if (e.touches) cy = e.touches[0].clientY;
    var newTop = startTop + (cy - startY);
    var maxTop = window.innerHeight - btn.offsetHeight - 10;
    newTop = Math.max(10, Math.min(maxTop, newTop));
    btn.style.top = newTop + 'px';
  }

  function onUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (!dragging) return;
    dragging = false;
    btn.style.outline = '';
    btn.style.boxShadow = '';
    btn.style.transition = '';
    var finalTop = parseInt(btn.style.top, 10);
    localStorage.setItem(storageKey, finalTop);
  }

  btn.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// Apply to global chat button
makeVerticalEdgeDraggable(
  document.getElementById('global-chat-btn'),
  'chatBtnTopGlobal'
);
// Apply to private chat (friends) button
makeVerticalEdgeDraggable(
  document.getElementById('sidebar-mobile-btn'),
  'chatBtnTopPrivate'
);

// ── Draggable panels ──────────────────────────────────────────
function makeDraggable(panel, handle) {
  var dragging = false, ox = 0, oy = 0;

  handle.addEventListener('pointerdown', function(e) {
    var tgt = e.target;
    if (tgt.tagName === 'BUTTON' || tgt.tagName === 'INPUT') return;
    // On mobile when the panel is fullscreen, skip drag
    if (window.innerWidth <= 768 && panel.classList.contains('open')) return;
    var rect = panel.getBoundingClientRect();
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    panel.style.left = rect.left + 'px';
    panel.style.top  = rect.top  + 'px';
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    document.body.classList.add('is-dragging');
    e.preventDefault();
  });

  handle.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    e.preventDefault();
    var nl = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - ox));
    var nt = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - oy));
    panel.style.left = nl + 'px';
    panel.style.top  = nt + 'px';
  }, { passive: false });

  handle.addEventListener('pointerup', function() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-dragging');
  });

  handle.addEventListener('pointercancel', function() {
    dragging = false;
    document.body.classList.remove('is-dragging');
  });

  // Reset to CSS-default position when panel is closed
  panel._resetDragPosition = function() {
    panel.style.transition = '';
    panel.style.left = '';
    panel.style.top  = '';
    panel.style.right  = '';
    panel.style.bottom = '';
    panel.style.transform = '';
  };
}

// Wire up draggable panels
makeDraggable(
  document.getElementById('global-chat-panel'),
  document.querySelector('#global-chat-panel .gc-header')
);
makeDraggable(
  document.getElementById('private-chat-modal'),
  document.querySelector('#private-chat-modal .pc-header')
);

document.getElementById('btn-vs-ai').addEventListener('click', function() { tttStart(lobbyAiDiff); });
document.getElementById('btn-c4-ai').addEventListener('click', function() { c4Start(c4AiDiff); });
// pong AI button removed (replaced by elfmeter)
document.getElementById('btn-rps-ai').addEventListener('click', function() { rpsStart(rpsAiDiff); });
document.getElementById('btn-chess-ai').addEventListener('click', function() { chessStart(chessAiDiff); });

// TicTacToe diff buttons (only in #lobby-screen)
document.querySelectorAll('#lobby-screen .diff-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#lobby-screen .diff-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    lobbyAiDiff = this.dataset.diff;
  });
});
document.querySelectorAll('.c4-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.c4-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    c4AiDiff = this.dataset.diff;
  });
});
document.querySelectorAll('.pong-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.pong-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    pongAiDiff = this.dataset.diff;
  });
});
document.querySelectorAll('.rps-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.rps-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    rpsAiDiff = this.dataset.diff;
  });
});
document.querySelectorAll('.chess-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.chess-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    chessAiDiff = this.dataset.diff;
  });
});
document.querySelectorAll('.math-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.math-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    mathAiDiff = this.dataset.diff;
  });
});
document.getElementById('btn-math-ai').addEventListener('click', function() { mathStart(mathAiDiff); });
document.getElementById('ttt-rematch-btn').addEventListener('click', gameRematch);
document.getElementById('ttt-leave-btn').addEventListener('click', gameLeave);
document.getElementById('rps-rematch-btn').addEventListener('click', resetG);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var overlay = document.getElementById('ttt-overlay');
    if (overlay && overlay.classList.contains('show')) { gameLeave(); }
  }
});
document.getElementById('pc-close').addEventListener('click', closePrivateChat);
document.getElementById('pc-send').addEventListener('click', sendPrivateMessage);
document.getElementById('pc-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendPrivateMessage(); });
document.getElementById('pc-input').addEventListener('input', notifyPrivateTyping);
document.getElementById('pc-messages').addEventListener('click', function(e) {
  var wrap = e.target.closest('.chat-avatar-wrap');
  if (wrap) { e.stopPropagation(); showUserStatusPopup(wrap); }
});
document.getElementById('pc-avatar-wrap').addEventListener('click', function(e) {
  e.stopPropagation();
  showUserStatusPopup(this);
});

function openG(id) {
  which = id;
  var titles = { memory: 'Farb-Gedächtnis', stack: 'Turm-Stapler', reaction: 'Reaktionstest', bubble: 'Bubble Pop', guess: 'Zahlen-Raten', wordle: 'Info-Wordle', flappy: '🐦 Flappy Bird', multiplayer: '⚔️ TicTacToe Duell', connect4: '🔴 4 Gewinnt', elfmeter: '🏎️ Tipp-Rennen', rps: '✊ Schere Stein Papier', chess: '♟️ Schach', snake: '🐍 Schlange', wortblitz: '⌨️ Wort-Blitz', math: '🧮 Rechen-Duell' };
  document.getElementById('gtitle').textContent = titles[id] || id;
  document.getElementById('pts').textContent = '0';
  var canvas = document.getElementById('c');
  var pads = document.getElementById('memory-pads');
  var memStatus = document.getElementById('memory-status');
  var reactionArea = document.getElementById('reaction-area');
  var guessArea = document.getElementById('guess-area');
  var wordleArea = document.getElementById('wordle-area');
  var lobbyArea = document.getElementById('lobby-area');
  var c4Area = document.getElementById('c4-area');
  var pongArea = document.getElementById('pong-area') || document.createElement('div');
  var elfmArea = document.getElementById('elfmeter-area');
  var rpsArea = document.getElementById('rps-area');
  var chessArea = document.getElementById('chess-area');
  var snakeArea = document.getElementById('snake-area');
  var wortblitzArea = document.getElementById('wortblitz-area');
  var mathArea = document.getElementById('math-area');
  // Hide all
  canvas.style.display = 'none';
  pads.classList.remove('active');
  memStatus.classList.remove('active');
  reactionArea.classList.remove('active');
  guessArea.classList.remove('active');
  wordleArea.classList.remove('active');
  lobbyArea.classList.remove('active');
  c4Area.classList.remove('active');
  pongArea.classList.remove('active');
  if(elfmArea) elfmArea.classList.remove('active');
  rpsArea.classList.remove('active');
  chessArea.classList.remove('active');
  snakeArea.classList.remove('active');
  wortblitzArea.classList.remove('active');
  mathArea.classList.remove('active');
  document.getElementById('pbot-pts-wrap').style.display = '';
  document.getElementById('btn-again').style.display = 'inline-block';
  if (id === 'memory') {
    pads.classList.add('active');
    memStatus.classList.add('active');
  } else if (id === 'stack' || id === 'bubble' || id === 'flappy') {
    canvas.style.display = 'block';
    fitCanvas(canvas, 380, id === 'flappy' ? 500 : 420);
  } else if (id === 'reaction') {
    reactionArea.classList.add('active');
  } else if (id === 'guess') {
    guessArea.classList.add('active');
  } else if (id === 'wordle') {
    wordleArea.classList.add('active');
  } else if (id === 'multiplayer') {
    lobbyArea.classList.add('active');
  } else if (id === 'connect4') {
    c4Area.classList.add('active');
  } else if (id === 'elfmeter') {
    if(elfmArea) elfmArea.classList.add('active');
  } else if (id === 'rps') {
    rpsArea.classList.add('active');
  } else if (id === 'chess') {
    chessArea.classList.add('active');
  } else if (id === 'snake') {
    snakeArea.classList.add('active');
  } else if (id === 'wortblitz') {
    wortblitzArea.classList.add('active');
  } else if (id === 'math') {
    mathArea.classList.add('active');
  }
  document.getElementById('popup').classList.add('on');
  // Hide live widget so it doesn't overlap game overlay buttons
  var lw = document.getElementById('live-widget');
  if (lw) lw.style.display = 'none';
  stopArcadeParticles();
  // Track activity for live status
  var activityMap = { memory:'singleplayer:memory', stack:'singleplayer:stack', reaction:'singleplayer:reaktion', elfmeter:'multiplayer:elfmeter',
    bubble:'singleplayer:bubble', guess:'singleplayer:zahlen', wordle:'singleplayer:wordle', flappy:'singleplayer:flappy',
    snake:'singleplayer:snake', wortblitz:'singleplayer:wortblitz',
    multiplayer:'multiplayer:tictactoe', connect4:'multiplayer:connect4', pong:'multiplayer:pong',
    rps:'multiplayer:rps', chess:'multiplayer:schach', math:'multiplayer:math' };
  currentActivity = activityMap[id] || ('singleplayer:'+id);
  sendHeartbeat(); // instant activity update
  runG();
}

function closeG() {
  disconnectGameWS();
  if (game) { game.stop(); game = null; }
  if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
  if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
  if (pongPollInterval) { clearInterval(pongPollInterval); pongPollInterval = null; }
  if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
  if (chessPollInterval) { clearInterval(chessPollInterval); chessPollInterval = null; }
  if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
  tttOn = false; c4On = false; pongOn = false; rpsOn = false; chessOn = false;
  snakeOn = false; wortblitzOn = false; mathOn = false;
  elfmOn = false; if (elfmPollInterval) { clearInterval(elfmPollInterval); elfmPollInterval = null; }
  if (mathPollInterval) { clearInterval(mathPollInterval); mathPollInterval = null; }
  document.getElementById('ttt-overlay').classList.remove('show');
  document.getElementById('popup').classList.remove('on');
  currentActivity = 'main';
  sendHeartbeat();
  // Restore live widget
  var lw = document.getElementById('live-widget');
  if (lw) lw.style.display = '';
  startArcadeParticles();
  document.getElementById('memory-pads').classList.remove('active');
  document.getElementById('memory-status').classList.remove('active');
  document.getElementById('reaction-area').classList.remove('active');
  document.getElementById('guess-area').classList.remove('active');
  document.getElementById('wordle-area').classList.remove('active');
  document.getElementById('lobby-area').classList.remove('active');
  document.getElementById('c4-area').classList.remove('active');
  if(document.getElementById('pong-area')) document.getElementById('pong-area').classList.remove('active');
  if(document.getElementById('elfmeter-area')) document.getElementById('elfmeter-area').classList.remove('active');
  document.getElementById('rps-area').classList.remove('active');
  document.getElementById('chess-area').classList.remove('active');
  document.getElementById('snake-area').classList.remove('active');
  document.getElementById('wortblitz-area').classList.remove('active');
  document.getElementById('math-area').classList.remove('active');
  var wbi = document.getElementById('wortblitz-input'); if (wbi) wbi.style.display = 'none';
  var cv = document.getElementById('c');
  cv.style.width = ''; cv.style.height = '';
}

function resetG() {
  if (which === 'multiplayer') {
    if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
    if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
    tttOn = false; tttLobbyId = null;
    var overlay = document.getElementById('ttt-overlay');
    if (overlay) overlay.classList.remove('show');
    loadLobbyScreen();
    return;
  }
  if (which === 'connect4') {
    if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
    c4On = false; c4LobbyId = null;
    if (game) { game.stop(); game = null; }
    var cv = document.getElementById('c');
    cv.style.display = 'none'; cv.style.width = ''; cv.style.height = '';
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('c4-area').classList.add('active');
    loadC4LobbyScreen();
    return;
  }
  if (which === 'elfmeter') {
    if (elfmPollInterval) { clearInterval(elfmPollInterval); elfmPollInterval = null; }
    elfmOn = false; elfmLobbyId = null;
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('elfmeter-game-screen').style.display = 'none';
    document.getElementById('elfmeter-area').classList.add('active');
    loadElfmeterLobbyScreen();
    return;
  }
  if (which === 'rps') {
    if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
    rpsOn = false; rpsLobbyId = null;
    if (game) { game.stop(); game = null; }
    document.getElementById('rps-game-screen').style.display = 'none';
    document.getElementById('rps-overlay').style.display = 'none';
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('rps-area').classList.add('active');
    loadRpsLobbyScreen();
    return;
  }
  if (which === 'chess') {
    if (chessPollInterval) { clearInterval(chessPollInterval); chessPollInterval = null; }
    chessOn = false; chessLobbyId = null;
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('chess-area').classList.add('active');
    loadChessLobbyScreen();
    return;
  }
  if (which === 'math') {
    if (mathPollInterval) { clearInterval(mathPollInterval); mathPollInterval = null; }
    mathOn = false; mathLobbyId = null;
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('math-game-screen').style.display = 'none';
    document.getElementById('math-area').classList.add('active');
    loadMathLobbyScreen();
    return;
  }
  if (game) { game.stop(); game = null; }
  document.getElementById('pts').textContent = '0';
  runG();
}

function runG() {
  var c = document.getElementById('c');
  if (which === 'memory') {
    game = memory();
  } else if (which === 'reaction') {
    game = reaction();
  } else if (which === 'bubble') {
    fitCanvas(c, 380, 420);
    game = bubblePop(c);
  } else if (which === 'flappy') {
    fitCanvas(c, 380, 500);
    game = flappyBird(c);
  } else if (which === 'guess') {
    game = guessGame();
  } else if (which === 'wordle') {
    game = wordleGame();
  } else if (which === 'multiplayer') {
    loadLobbyScreen();
  } else if (which === 'connect4') {
    loadC4LobbyScreen();
  } else if (which === 'elfmeter') {
    loadElfmeterLobbyScreen();
  } else if (which === 'rps') {
    loadRpsLobbyScreen();
  } else if (which === 'chess') {
    loadChessLobbyScreen();
  } else if (which === 'snake') {
    snakeStart();
  } else if (which === 'wortblitz') {
    wortblitzStart();
  } else if (which === 'math') {
    loadMathLobbyScreen();
  } else {
    fitCanvas(c, 380, 420);
    game = stack(c);
  }
}

/* ---- fitCanvas helper — DPR-aware, retries if popup not yet shown ---- */
function fitCanvas(cv, logW, logH) {
  var pgame = document.querySelector('.pgame');
  if (!pgame) { cv.width = logW; cv.height = logH; return; }
  var availW = pgame.clientWidth - 20;
  var availH = pgame.clientHeight - 20;
  if (availW <= 0 || availH <= 0) {
    // popup not visible yet — retry next frame
    requestAnimationFrame(function() { fitCanvas(cv, logW, logH); });
    return;
  }
  var ratio = logW / logH;
  var cssW, cssH;
  if (availW / availH > ratio) { cssH = availH; cssW = availH * ratio; }
  else { cssW = availW; cssH = availW / ratio; }
  cssW = Math.floor(cssW); cssH = Math.floor(cssH);
  var dpr = window.devicePixelRatio || 1;
  // Display size (CSS pixels)
  cv.style.width  = cssW + 'px';
  cv.style.height = cssH + 'px';
  // Physical canvas pixels = logical size × DPR (game coords stay 0..logW, 0..logH)
  cv.width  = Math.round(logW * dpr);
  cv.height = Math.round(logH * dpr);
  // Store for event-handler scaling and resize
  cv._W = logW; cv._H = logH; cv._cssW = cssW; cv._cssH = cssH; cv._dpr = dpr;
  var ctx = cv.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* Re-fit on orientation / resize */
window.addEventListener('resize', function() {
  if (!which) return;
  var cv = document.getElementById('c');
  if (cv.style.display === 'none') return;
  var lw = (which === 'pong') ? 400 : (which === 'connect4') ? 420 : 380;
  var lh = (which === 'pong') ? 520 : (which === 'connect4') ? 400 : (which === 'flappy') ? 500 : 420;
  fitCanvas(cv, lw, lh);
});

/* ---- SPIEL: FARB-GEDAECHTNIS ---- */
function memory() {
  var colors = ['green', 'red', 'blue', 'yellow'];
  var seq = [];
  var clickIdx = 0;
  var on = true;
  var sc = 0;
  var canClick = false;
  var status =
document.getElementById('memory-status');

function addToSeq() { seq.push(colors[Math.floor(Math.random() * 4)]); }

function flashPad(color, dur) { return new Promise(function(resolve) { var pad = document.getElementById('pad-' +
color);
pad.classList.add('flash');
setTimeout(function() { pad.classList.remove('flash'); setTimeout(resolve,
200); }, dur); }); } async function playSeq() { canClick = false; status.textContent = 'Merke dir die Reihenfolge...'; for (var i = 0; i < seq.length; i++) { if (!on) return; await flashPad(seq[i], 500); } canClick =
true; clickIdx = 0; status.textContent = 'Jetzt du! Klick die Farben nach.'; }

function handleClick(color) {
    if (!canClick || !on) return;

    flashPad(color, 200);

    if (color === seq[clickIdx]) {
        sounds.correct();
        clickIdx++;

        if (clickIdx === seq.length) {
            sc++;
            document.getElementById('pts').textContent = sc;
            status.textContent = 'Super! Naechste Runde...';
            setTimeout(function() { addToSeq(); playSeq(); }, 900);
        }
    } else {
        sounds.wrong();
        on = false;
        canClick = false;
        status.textContent = 'Game Over! ' + sc + ' Runden geschafft.';
        saveHS('memory', sc);
    }
}

var pads = document.querySelectorAll('.pad');
function padClick(e) {
  handleClick(e.currentTarget.dataset.color);
}
pads.forEach(function(p) { p.addEventListener('click', padClick); }); addToSeq(); setTimeout(function() {
playSeq(); }, 600); return { stop: function() { on = false; canClick = false; pads.forEach(function(p) {
p.removeEventListener('click', padClick); }); } }; }


/* ---- SPIEL 2: TURM-STAPLER ---- */
function stack(cv){
  var ctx=cv.getContext('2d'),W=cv._W||380,H=cv._H||420,on=true,raf,sc=0;
  var ly=[{x:W/2-60,w:120}];
  var cur={x:0,w:120,dir:1};
  var bY=H-25,lH=22;
  var co=['#e8573a','#e88a3a','#e8c83a','#3ae87a','#3ab8e8','#6a3ae8','#e83a9b'];
  // Delta-time for frame-rate independence
  var lastT=null, TARGET_FPS=60;
  // Crumble particles
  var crumbs=[];
  // Speed: pixels/second (not pixels/frame!) — much slower start
  var SPD_BASE=60, SPD_MAX=180;

  function loop(ts){
    if(!on)return;
    raf=requestAnimationFrame(loop);
    var dt = lastT ? Math.min((ts-lastT)/1000,0.05) : 1/60; // seconds, capped at 50ms
    lastT=ts;

    // Move current block using seconds-based speed
    var spd = Math.min(SPD_MAX, SPD_BASE + sc*2.5); // pixels/second
    cur.x += cur.dir * spd * dt;
    if(cur.x+cur.w>W){cur.x=W-cur.w;cur.dir=-1;}
    if(cur.x<0){cur.x=0;cur.dir=1;}

    // Update crumbs
    for(var i=crumbs.length-1;i>=0;i--){
      var c=crumbs[i];
      c.x+=c.vx*dt; c.y+=c.vy*dt; c.vy+=400*dt; c.life-=dt*1.5;
      if(c.y>H+20||c.life<=0) crumbs.splice(i,1);
    }

    // Draw
    ctx.fillStyle='#080810'; ctx.fillRect(0,0,W,H);
    // Subtle grid dots
    ctx.fillStyle='rgba(255,255,255,0.025)';
    for(var gi=0;gi<20;gi++) ctx.fillRect((gi*71)%W,(gi*53)%H,1.5,1.5);

    // Stacked layers
    for(var i=0;i<ly.length;i++){
      var col=co[i%co.length];
      ctx.fillStyle=col;
      // Subtle glow on top layer
      if(i===ly.length-1){ctx.shadowColor=col;ctx.shadowBlur=8;}
      ctx.fillRect(ly[i].x,bY-i*lH,ly[i].w,lH-2);
      ctx.shadowBlur=0;
    }
    // Current moving block
    var cy=bY-ly.length*lH;
    var blockCol=co[ly.length%co.length];
    ctx.fillStyle=blockCol; ctx.shadowColor=blockCol; ctx.shadowBlur=12;
    ctx.fillRect(cur.x,cy,cur.w,lH-2);
    ctx.shadowBlur=0;

    // Draw crumb particles
    crumbs.forEach(function(c){
      ctx.globalAlpha=Math.max(0,c.life);
      ctx.fillStyle=c.col;
      ctx.fillRect(c.x,c.y,c.w,c.h);
    });
    ctx.globalAlpha=1;
  }

  function spawnCrumbs(x,y,w,col){
    var numCrumbs=Math.max(3,Math.floor(w/4));
    for(var i=0;i<numCrumbs;i++){
      crumbs.push({
        x:x+Math.random()*w, y:y,
        vx:(Math.random()-0.5)*80, vy:-30-Math.random()*80,
        w:3+Math.random()*4, h:3+Math.random()*4,
        col:col, life:1
      });
    }
  }

  function drop(){
    if(!on)return;
    var p=ly[ly.length-1];
    var oL=Math.max(cur.x,p.x),oR=Math.min(cur.x+cur.w,p.x+p.w),oW=oR-oL;
    var blockCol=co[ly.length%co.length];
    if(oW<=0){
      // Completely missed — spawn crumbs for whole block then game over
      spawnCrumbs(cur.x, bY-ly.length*lH, cur.w, blockCol);
      on=false; saveHS('stack',sc);
      setTimeout(function(){ if(raf)cancelAnimationFrame(raf); gg(ctx,W,H,sc); },600);
      return;
    }
    // Spawn crumbs for the overhanging part
    var overL=p.x-cur.x, overR=(cur.x+cur.w)-(p.x+p.w);
    if(overL>0) spawnCrumbs(cur.x, bY-ly.length*lH, overL, blockCol);
    if(overR>0) spawnCrumbs(p.x+p.w, bY-ly.length*lH, overR, blockCol);

    ly.push({x:oL,w:oW}); sc++;
    document.getElementById('pts').textContent=sc;
    cur.w=oW; cur.x=Math.random()<0.5?0:W-cur.w;
    cur.dir=cur.x<W/2?1:-1;
    if(ly.length*lH>H-80)bY+=lH;
  }

  function keyDrop(e){if(e.code==='Space'||e.key===' '){e.preventDefault();drop();}}
  cv.addEventListener('click',drop);
  cv.addEventListener('touchstart',function(e){e.preventDefault();drop();},{passive:false});
  document.addEventListener('keydown',keyDrop);
  raf=requestAnimationFrame(loop);
  return{stop:function(){on=false;if(raf)cancelAnimationFrame(raf);cv.removeEventListener('click',drop);document.removeEventListener('keydown',keyDrop);}};
}

/* ---- SPIEL 3: REAKTIONSTEST ---- */
function reaction() {
  var area    = document.getElementById('reaction-area');
  var status  = document.getElementById('reaction-status');
  var btn     = document.getElementById('reaction-btn');
  var on      = true;
  var phase   = 'idle'; // idle | lights | go | done | replay
  var startTime = null;
  var lightTimers = [];
  var goTimer = null;
  var top3 = [];

  function getBulb(n) { return document.getElementById('fl' + n); }
  function getWrap(i) { return document.getElementById('f1-wrap-' + i); }
  function getLabel(i){ return document.getElementById('f1-label-' + i); }

  function clearTimers() {
    lightTimers.forEach(function(t){ clearTimeout(t); });
    lightTimers = [];
    if (goTimer) { clearTimeout(goTimer); goTimer = null; }
  }

  function resetLights() {
    for (var i = 1; i <= 5; i++) { var b = getBulb(i); if (b) b.classList.remove('on'); }
  }

  function resetCars() {
    for (var i = 0; i < 4; i++) {
      var w = getWrap(i);
      if (!w) continue;
      w.style.transition = 'none';
      w.style.left = '6%';
    }
    setTimeout(function() {
      for (var i = 0; i < 4; i++) { var w = getWrap(i); if (w) w.style.transition = ''; }
    }, 80);
  }

  function initLabels() {
    for (var i = 0; i < 3; i++) {
      var lbl = getLabel(i);
      if (lbl) lbl.textContent = top3[i] ? top3[i].name : '— Platz ' + (i+1);
    }
    var l3 = getLabel(3);
    if (l3) l3.textContent = (user && user.name) ? user.name : 'Du';
  }

  function setHubState(state) {
    var hubBtn = document.getElementById('f1-hub-btn');
    var hubLabel = document.getElementById('f1-hub-label');
    if (!hubBtn) return;
    hubBtn.classList.remove('go', 'done');
    if (state === 'go') { hubBtn.classList.add('go'); if (hubLabel) hubLabel.textContent = 'LOS! 🟢'; }
    else if (state === 'done') { hubBtn.classList.add('done'); if (hubLabel) hubLabel.textContent = '↺'; }
    else { if (hubLabel) hubLabel.textContent = 'START'; }
  }

  function arm() {
    phase = 'lights';
    resetLights();
    resetCars();
    initLabels();
    status.textContent = '🏁 Ampel beachten...';
    btn.className = 'waiting';
    setHubState('start');
    var podium = document.getElementById('f1-podium');
    if (podium) podium.classList.remove('show');
    var diff = document.getElementById('f1-diff-display');
    if (diff) diff.classList.remove('show');

    for (var i = 1; i <= 5; i++) {
      (function(idx) {
        var t = setTimeout(function() {
          if (!on) return;
          var b = getBulb(idx);
          if (b) b.classList.add('on');
          if (idx === 5) {
            // All 5 lit — random wait then ALL OUT = GO
            var wait = 600 + Math.random() * 2400;
            goTimer = setTimeout(function() {
              if (!on) return;
              resetLights();
              phase = 'go';
              startTime = Date.now();
              status.textContent = '🟢 LOS! DRÜCKEN!';
              btn.className = 'active';
              area.classList.add('f1-go');
              setTimeout(function() { area.classList.remove('f1-go'); }, 500);
              setHubState('go');
            }, wait);
          }
        }, 650 * idx);
        lightTimers.push(t);
      })(i);
    }
  }

  function handleClick() {
    if (!on) return;

    if (phase === 'lights') {
      clearTimers(); resetLights();
      phase = 'idle';
      status.textContent = '❌ Zu früh! Nochmal...';
      btn.className = '';
      setTimeout(function() { if (on) arm(); }, 1800);
      return;
    }

    if (phase === 'go') {
      var ms = Date.now() - startTime;
      phase = 'done';
      btn.className = '';
      setHubState('done');

      // Build all 4 times (3 ghosts + player)
      var allTimes = top3.map(function(g) { return g ? g.reaction_ms : null; });
      allTimes.push(ms);

      // Compute min/max for relative scaling — max position 60% so labels never clip
      var validTimes = allTimes.filter(function(t) { return t && t > 0; });
      var bestT = Math.min.apply(null, validTimes);
      var worstT = Math.max.apply(null, validTimes);
      var spread = Math.max(worstT - bestT, 60);

      function dynPos(t) {
        if (!t || t <= 0) return 8;
        return Math.round(8 + (worstT - t) / spread * 54); // 8% = worst, 62% = best
      }

      // Animate ghost cars
      for (var i = 0; i < 3; i++) {
        var w = getWrap(i); var lbl = getLabel(i);
        if (w && top3[i]) {
          w.style.left = dynPos(top3[i].reaction_ms) + '%';
          if (lbl) lbl.textContent = top3[i].name + '\n' + top3[i].reaction_ms + 'ms';
        }
      }
      // Animate player car
      var pw = getWrap(3); var pl = getLabel(3);
      if (pw) pw.style.left = dynPos(ms) + '%';
      if (pl) pl.textContent = (user && user.name ? user.name : 'Du') + '\n' + ms + 'ms';

      var grade = ms < 180 ? '⚡ Weltklasse!' : ms < 250 ? '⚡ Blitz-Reflex!' : ms < 320 ? '🟢 Exzellent!' : ms < 420 ? '🟢 Gut!' : ms < 550 ? '🟡 OK' : '🔴 Langsam';
      status.textContent = ms + ' ms — ' + grade;
      document.getElementById('pts').textContent = ms + 'ms';
      sounds.highscore();
      saveHS('reaction', ms);

      // Show podium after cars arrive
      setTimeout(function() {
        if (!on) return;
        var podium = document.getElementById('f1-podium');
        if (!podium) return;
        // Order: 2nd place, 1st place, 3rd place
        for (var i = 0; i < 3; i++) {
          var av = document.getElementById('f1-pod-av-' + i);
          var nm = document.getElementById('f1-pod-name-' + i);
          var tm = document.getElementById('f1-pod-time-' + i);
          if (top3[i]) {
            var seed = top3[i].avatar_seed || top3[i].name;
            if (av) av.src = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
            if (nm) nm.textContent = top3[i].name;
            if (tm) tm.textContent = top3[i].reaction_ms + 'ms';
          } else {
            if (av) av.src = '';
            if (nm) nm.textContent = '—';
            if (tm) tm.textContent = '';
          }
        }
        podium.classList.add('show');

        // Show diff display (no overlaps — each row is its own line)
        var diffEl = document.getElementById('f1-diff-display');
        if (diffEl && top3.length > 0) {
          var diffHtml = '';
          for (var j = 0; j < top3.length; j++) {
            if (!top3[j]) continue;
            var tDiff = ms - top3[j].reaction_ms;
            var cls = tDiff < 0 ? 'faster' : tDiff > 0 ? 'slower' : 'tied';
            var sign = tDiff < 0 ? '' : '+';
            var label = top3[j].name + ' (' + top3[j].reaction_ms + 'ms)';
            var diffText = tDiff === 0 ? 'Gleich' : sign + tDiff + 'ms';
            var icon = tDiff < 0 ? '⚡' : tDiff > 0 ? '🐢' : '🤝';
            diffHtml += '<div class="f1-diff-row ' + cls + '">' +
              '<span>' + icon + ' <b>' + escHtml(label) + '</b></span>' +
              '<div class="f1-diff-line"></div>' +
              '<span>' + diffText + '</span>' +
            '</div>';
          }
          diffEl.innerHTML = diffHtml;
          diffEl.classList.add('show');
        }
      }, 1200);

      setTimeout(function() {
        if (!on) return;
        status.textContent = ms + ' ms — ' + grade + '  •  Tippe für neuen Versuch';
        btn.className = 'active';
        setHubState('start');
        phase = 'replay';
      }, 2800);
      return;
    }

    if (phase === 'replay') { arm(); }
  }

  btn.addEventListener('click', handleClick);
  var hubBtn = document.getElementById('f1-hub-btn');
  if (hubBtn) hubBtn.addEventListener('click', function() { handleClick(); });

  /* Fetch top3 from global highscores, then start */
  (async function() {
    try {
      var res = await fetch(API_URL + '/api/global-highscores');
      var hs = await res.json();
      top3 = (hs || [])
        .filter(function(u) { return u.reaction_ms && u.reaction_ms > 0; })
        .sort(function(a, b) { return a.reaction_ms - b.reaction_ms; })
        .slice(0, 3);
    } catch(e) {}
    if (on) arm();
  })();

  return {
    stop: function() {
      on = false; clearTimers(); resetLights();
      btn.removeEventListener('click', handleClick);
      btn.className = '';
      var podium = document.getElementById('f1-podium');
      if (podium) podium.classList.remove('show');
      var diff = document.getElementById('f1-diff-display');
      if (diff) { diff.classList.remove('show'); diff.innerHTML = ''; }
      setHubState('start');
    }
  };
}

/* ---- SPIEL 4: BUBBLE POP ---- */
function bubblePop(cv) {
  var ctx = cv.getContext('2d'), W = 380, H = 420, on = true;
  var sc = 0, timeLeft = 30;
  var bubbles = [];
  var raf, spawnTimer, gameTimer;
  var COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9f1c','#2ec4b6','#ff8fab'];

  function spawn() {
    if (!on) return;
    var r = 12 + Math.random() * 33;
    var x = r + 10 + Math.random() * (W - 2 * r - 20);
    var y = r + 45 + Math.random() * (H - 2 * r - 55);
    var color = COLORS[Math.floor(Math.random() * COLORS.length)];
    var pts = r <= 18 ? 10 : r <= 30 ? 5 : 2;
    bubbles.push({ x: x, y: y, r: r, color: color, pts: pts, born: Date.now(), alive: true });
  }

  function draw() {
    if (!on) { cancelAnimationFrame(raf); return; }
    raf = requestAnimationFrame(draw);
    var now = Date.now();
    bubbles = bubbles.filter(function(b) { return b.alive && now - b.born < 1500; });

    ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, W, H);

    // Timer-Balken
    ctx.fillStyle = '#1e1e2e'; ctx.fillRect(10, 8, W - 20, 12);
    var barW = Math.max(0, (timeLeft / 30) * (W - 20));
    ctx.fillStyle = timeLeft > 10 ? '#4caf50' : '#ff5733';
    ctx.fillRect(10, 8, barW, 12);

    // HUD
    ctx.fillStyle = '#eee'; ctx.font = '13px Bricolage Grotesque,sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('Zeit: ' + timeLeft + 's', 10, 36);
    ctx.textAlign = 'right'; ctx.fillText('Punkte: ' + sc, W - 10, 36);

    bubbles.forEach(function(b) {
      var age = now - b.born;
      var alpha = age > 1100 ? 1 - (age - 1100) / 400 : 1;
      ctx.globalAlpha = alpha;

      // Blase
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.color + '44'; ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = 2.5; ctx.stroke();

      // Glanzpunkt
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();

      // Punktetext
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(10, Math.round(b.r * 0.5)) + 'px Bricolage Grotesque,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+' + b.pts, b.x, b.y + 5);

      ctx.globalAlpha = 1;
    });
  }

  function handleClick(e) {
    if (!on) return;
    var rect = cv.getBoundingClientRect();
    var scaleX = W / rect.width, scaleY = H / rect.height;
    var cx = (e.clientX - rect.left) * scaleX;
    var cy = (e.clientY - rect.top) * scaleY;
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      if (!b.alive) continue;
      var dx = cx - b.x, dy = cy - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) {
        b.alive = false;
        sc += b.pts;
        document.getElementById('pts').textContent = sc;
        sounds.correct();
        break;
      }
    }
  }

  function finish() {
    on = false;
    clearInterval(spawnTimer);
    clearInterval(gameTimer);
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = 'bold 26px Bricolage Grotesque,sans-serif'; ctx.fillText('Zeit ist um!', W / 2, H / 2 - 15);
    ctx.font = '18px Bricolage Grotesque,sans-serif'; ctx.fillText(sc + ' Punkte', W / 2, H / 2 + 18);
    saveHS('bubble', sc);
  }

  spawn();
  spawnTimer = setInterval(spawn, 400);
  gameTimer = setInterval(function() {
    if (!on) return;
    timeLeft--;
    if (timeLeft <= 0) { timeLeft = 0; finish(); }
  }, 1000);
  draw();
  cv.addEventListener('click', handleClick);

  return {
    stop: function() {
      on = false;
      clearInterval(spawnTimer);
      clearInterval(gameTimer);
      cancelAnimationFrame(raf);
      cv.removeEventListener('click', handleClick);
    }
  };
}

/* ---- SPIEL 5: ZAHLEN-RATEN ---- */
function guessGame() {
  var on = true;
  var secret = Math.floor(Math.random() * 100) + 1;
  var tries = 0;
  var lo = 1, hi = 100; // known range (narrows after each guess)
  var statusEl = document.getElementById('guess-status');
  var input = document.getElementById('guess-input');
  var btn = document.getElementById('guess-btn');
  var history = document.getElementById('guess-history');

  input.value = ''; input.disabled = false; btn.disabled = false;
  history.innerHTML = '';

  // Create visual range bar
  var barWrap = document.createElement('div');
  barWrap.className = 'guess-range-wrap';
  barWrap.innerHTML =
    '<div class="guess-range-bar"><div class="guess-range-fill" id="guess-range-fill"></div>' +
    '<div class="guess-range-marker" id="guess-range-marker"></div></div>' +
    '<div class="guess-range-labels"><span id="guess-lo">1</span><span id="guess-mid">?</span><span id="guess-hi">100</span></div>';
  statusEl.parentNode.insertBefore(barWrap, statusEl.nextSibling);

  function updateBar() {
    var fillEl=document.getElementById('guess-range-fill');
    var markerEl=document.getElementById('guess-range-marker');
    if(fillEl){fillEl.style.left=(lo-1)+'%';fillEl.style.right=(100-hi)+'%';}
    if(markerEl){markerEl.style.left=(secret-1)+'%';} // hidden — just for visual
    var loEl=document.getElementById('guess-lo'), hiEl=document.getElementById('guess-hi');
    var midEl=document.getElementById('guess-mid');
    if(loEl)loEl.textContent=lo; if(hiEl)hiEl.textContent=hi;
    if(midEl)midEl.textContent=Math.round((lo+hi)/2);
  }
  updateBar();
  statusEl.textContent = 'Errate die Zahl zwischen 1 und 100!';
  statusEl.style.cssText='';

  function handleGuess() {
    if (!on) return;
    var val = parseInt(input.value);
    if (isNaN(val) || val < 1 || val > 100) {
      statusEl.textContent = '⚠️ Zahl 1–100 eingeben!'; return;
    }
    tries++;
    input.value = '';
    input.focus();
    var entry = document.createElement('div');
    entry.className = 'guess-entry';

    if (val === secret) {
      on = false;
      var score = Math.max(0, 100 - (tries - 1) * 10);
      entry.innerHTML = '<span class="ge-num">'+val+'</span><span class="ge-tag ge-correct">✅ RICHTIG!</span>';
      history.appendChild(entry); history.scrollTop=history.scrollHeight;
      statusEl.textContent = '🎉 In '+tries+' Versuch'+(tries>1?'en':'')+' gefunden! +'+score+' Punkte';
      statusEl.style.color='#4ade80';
      document.getElementById('pts').textContent = score;
      btn.disabled = true; input.disabled = true;
      sounds.highscore(); saveHS('guess', score);
    } else {
      var tooLow = val < secret;
      if(tooLow&&val>lo)lo=val+1; else if(!tooLow&&val<hi)hi=val-1;
      updateBar();
      entry.innerHTML = '<span class="ge-num">'+val+'</span><span class="ge-tag '+(tooLow?'ge-low':'ge-high')+'">'+(tooLow?'⬆️ Höher!':'⬇️ Tiefer!')+'</span>';
      history.appendChild(entry); history.scrollTop=history.scrollHeight;
      var remaining=10-tries;
      statusEl.textContent='Versuch '+tries+'/10 — noch '+remaining+' übrig';
      statusEl.style.color=remaining<=3?'#ef4444':remaining<=5?'#f97316':'';
      document.getElementById('pts').textContent=Math.max(0,100-tries*10);
      if(tries>=10){
        on=false;
        statusEl.textContent='💀 Game Over! Die Zahl war '+secret;
        statusEl.style.color='#ef4444';
        btn.disabled=true; input.disabled=true;
        saveHS('guess',0);
      }
    }
  }

  btn.addEventListener('click', handleGuess);
  function keyHandler(e){if(e.key==='Enter'){e.preventDefault();handleGuess();}}
  input.addEventListener('keydown', keyHandler);

  return {
    stop: function() {
      on=false;
      btn.removeEventListener('click',handleGuess);
      input.removeEventListener('keydown',keyHandler);
      btn.disabled=false; input.disabled=false;
      if(barWrap.parentNode) barWrap.parentNode.removeChild(barWrap);
    }
  };
}

/* ---- SPIEL 6: INFO-WORDLE ---- */
// Alle Lösungswörter sind genau 5 Buchstaben, A-Z, OHNE Umlaute (Ä/Ö/Ü) –
// das Spielfeld hat exakt 5 Spalten und die Tastatur (Bildschirm + physisch)
// kennt nur A-Z, daher dürfen Lösungswörter weder eine andere Länge haben
// noch Umlaute enthalten (sonst wäre das Wort nicht eingebbar/lösbar).
var WORDLE_WORDS = [
  // Digitale Grundbildung / einfache Informatik (für Schüler)
  'PIXEL','BYTES','CLICK','KLICK','DATEN','VIRUS','CACHE','LOGIN','MAILS','CLOUD',
  'CODES','INPUT','LINKS','MEDIA','SMART','HANDY','ALBUM','AUDIO','DATEI','ENTER',
  'KABEL','MUSIK','POWER','RESET','SEITE','SPELL','TASTE','TOUCH','BRIEF','DRUCK',
  'ICONS','MODUL','PAKET','PFEIL','PROBE','SCOUT','SHARE','VIREN','VOLLE','ZEILE',
  'MODUS','NETZE','SCANS','EMAIL','EMOJI','MODEM','DRIVE','FLASH','LASER','TONER',
  'AKKUS','SUCHE','ZELLE','VIDEO','FOTOS','CHIPS','MAUSE','TEXTE','WORTE','DISKS',
  'TABLE','TAFEL','GAMES','LEVEL','SCORE','SOUND','LADEN','TIPPS','ROBOT','BLITZ',
  'STIFT',
  // Programmierung / Technik (Englisch)
  'LAYER','QUEUE','STACK','ARRAY','LOOPS','TOKEN','ROUTE','SERVE','QUERY','INDEX',
  'CLASS','BLOCK','BUILD','CRASH','DEBUG','FLOAT','FRAME','LOCAL','NODES','PARSE',
  'PRINT','PROTO','SCOPE','STATE','STORE','TRACE','TYPES','VALID','VALUE','WATCH',
  'WRITE','BREAK','AWAIT','CONST','SUPER','YIELD','SPAWN',
  // Deutsche einfache Wörter
  'ABEND','ALTER','AMPEL','APFEL','ATLAS','BITTE','BLATT','BLUME','BODEN','ESSEN',
  'FEUER','FISCH','FLUSS','HILFE','KATZE','KREUZ','KRONE','LICHT','LIEBE','METER',
  'MITTE','NACHT','PLATZ','REISE','RUNDE','STADT','STERN','STROM','STUHL','TISCH',
  'VOGEL','WOLKE','LEBEN','SPIEL','BREIT','STARK','OFFEN','WOCHE','KRAFT','FARBE',
  'MARKT','WILLE','STUFE'
];

// Alle gültigen Ratewörter (Lösungen + erweitertes Vokabular)
var WORDLE_VALID_WORDS = new Set(WORDLE_WORDS.concat([
  // IT / Technik (Englisch)
  'ADMIN','AGILE','ALERT','ALIAS','ALPHA','ARRAY','ASCII','ASYNC',
  'AUDIT','AZURE','BADGE','BASIC','BATCH','BLOCK','BOARD','BOOST',
  'BOOTS','BUILD','BURST','CHAIN','CHECK','CLASS','CLEAN','CLEAR',
  'CLOCK','CLONE','CLOSE','COLOR','COUNT','CRASH','CRYPT','DEBUG',
  'DELTA','DEPOT','DIGIT','DRAFT','DRIVE','EMAIL','EMOJI','EMPTY',
  'ENTER','ERROR','EVENT','EXACT','EXTRA','FETCH','FIELD','FIXED',
  'FLAME','FLASH','FLOAT','FLUSH','FOCUS','FORCE','FRAME','FRESH',
  'FRONT','GHOST','GRANT','GRAPH','GROUP','GUARD','GUEST','GUIDE',
  'INDEX','ISSUE','ITEMS','LAYER','LEARN','LOCAL','LOGIC','LOOPS',
  'MACRO','MATCH','MICRO','MODEL','MODEM','MONGO','MYSQL','NEXUS',
  'NODES','ORDER','OUTER','OWNER','PAGES','PANEL','PARSE','PATHS',
  'PAUSE','PIPES','PLANE','POINT','POOLS','PORTS','PRINT','PROBE',
  'PROTO','PROXY','QUERY','QUEUE','RANGE','REALM','REPLY','RESET',
  'RETRY','ROLES','ROUND','ROUTE','RULES','SCALA','SCALE','SCOPE',
  'SERVE','SETUP','SHELL','SHIFT','SLICE','SLOTS','SOLID','SOLVE',
  'SPECS','SPLIT','STACK','STATE','STORE','SWIFT','SYNCS','TASKS',
  'TERMS','TESTS','THROW','TIMER','TITLE','TOKEN','TRACE','TRACK',
  'TRAIL','TYPES','UNION','UTILS','VALID','VALUE','VAULT','VIEWS',
  'VOICE','WATCH','WHERE','WHILE','WRITE','LIGHT','RIGHT','POINT',
  'BREAK','CHECK','CRUMB','FLUSH','FLAME','FIBER','GRANT','MERGE',
  'QUEUE','SPAWN','YIELD','AWAIT','CONST','SUPER','TYPED','ASYNC',
  // Deutsche Allgemeinwörter (5 Buchstaben, keine Umlaute)
  'ABEND','ALTER','AMPEL','ANGEL','ANGST','ANKER','APFEL','ATLAS',
  'BITTE','BLATT','BLECH','BLUME','BODEN','BRUST','BUCHE','DECKE',
  'ESSEN','FEUER','FISCH','FLUSS','GRIFF','GRUND','HACKE','HILFE',
  'KATZE','KEULE','KNALL','KREIS','KREUZ','KRONE','LICHT','LIEBE',
  'MENGE','METER','MITTE','NACHT','OSTEN','PFEIL','PLATZ','PREIS',
  'REISE','RUNDE','SEITE','STADT','STERN','STOFF','STROM','STUHL',
  'TEICH','TISCH','TINTE','VOGEL','WOLKE','WURST','LEBEN','SPIEL',
  'SCHUH','SCHAF','ARBEI','MARKT','FARBE','GUTER','GUTEN','TIEFE',
  'EBENE','WOCHE','JAHRE','STUFE','WETTE','WILLE','KRAFT','KISTE',
  'BREIT','STARK','TREFF','SCHON','SPORT','STUBE','TAGEN','OFFEN'
]));
// Merge in the big external dictionary (loaded via wordle-dict.js)
if (window.WORDLE_EXTRA_WORDS) {
  window.WORDLE_EXTRA_WORDS.forEach(function(w) { WORDLE_VALID_WORDS.add(w); });
}

function wordleGame() {
  var on = true;
  var secret = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
  var currentRow = 0, currentCol = 0, currentGuess = [];
  var maxRows = 6, wordLen = 5;
  var hintsUsed = 0;

  var grid = document.getElementById('wordle-grid');
  var kbEl = document.getElementById('wordle-keyboard');
  var statusEl = document.getElementById('wordle-status');
  var hintBtn = document.getElementById('wordle-hint-btn');
  var hintDisplay = document.getElementById('wordle-hint-display');
  grid.innerHTML = ''; kbEl.innerHTML = ''; statusEl.textContent = '';
  hintBtn.disabled = false;

  function updateHintDisplay() {
    hintDisplay.innerHTML = secret.split('').map(function(ch, i) {
      return '<span class="hint-letter' + (i < hintsUsed ? ' revealed' : '') + '">' +
             (i < hintsUsed ? ch : '_') + '</span>';
    }).join('');
  }
  updateHintDisplay();

  hintBtn.onclick = function() {
    if (!on || hintsUsed >= wordLen) return;
    hintsUsed++;
    updateHintDisplay();
    if (hintsUsed >= wordLen) hintBtn.disabled = true;
  };

  // Build grid
  var cells = [];
  for (var r = 0; r < maxRows; r++) {
    cells[r] = [];
    var row = document.createElement('div'); row.className = 'wordle-row';
    for (var c = 0; c < wordLen; c++) {
      var cell = document.createElement('div'); cell.className = 'wordle-cell';
      row.appendChild(cell); cells[r][c] = cell;
    }
    grid.appendChild(row);
  }

  // Build keyboard
  var keyMap = {};
  [['Q','W','E','R','T','Z','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['ENTER','Y','X','C','V','B','N','M','⌫']].forEach(function(rowKeys) {
    var kRow = document.createElement('div'); kRow.className = 'wordle-key-row';
    rowKeys.forEach(function(k) {
      var btn = document.createElement('button');
      btn.className = 'wordle-key' + (k.length > 1 ? ' wordle-key-wide' : '');
      btn.textContent = k; btn.dataset.key = k === '⌫' ? 'BACKSPACE' : k;
      if (k.length === 1) keyMap[k] = btn;
      kRow.appendChild(btn);
    });
    kbEl.appendChild(kRow);
  });

  function handleKey(k) {
    if (!on) return;
    if (k === 'ENTER') {
      if (currentGuess.length < wordLen) { statusEl.textContent = 'Noch ' + (wordLen - currentGuess.length) + ' Buchstaben fehlen!'; return; }
      var guessWord = currentGuess.join('');
      // Accept: words in our list, OR any 5-letter word consisting of A-Z (open dictionary)
      var isValidWord = WORDLE_VALID_WORDS.has(guessWord) || /^[A-Z]{5}$/.test(guessWord);
      if (!isValidWord) {
        statusEl.textContent = '❌ Kein gültiges Wort!';
        var rowEl = cells[currentRow][0].parentElement;
        rowEl.classList.remove('shake');
        // force reflow so re-adding the class re-triggers the animation
        void rowEl.offsetWidth;
        rowEl.classList.add('shake');
        setTimeout(function() { rowEl.classList.remove('shake'); }, 500);
        return;
      }
      submitGuess();
    } else if (k === 'BACKSPACE') {
      if (currentCol > 0) { currentCol--; currentGuess.pop(); cells[currentRow][currentCol].textContent = ''; cells[currentRow][currentCol].classList.remove('filled'); }
    } else if (/^[A-Z]$/.test(k) && currentCol < wordLen) {
      cells[currentRow][currentCol].textContent = k; cells[currentRow][currentCol].classList.add('filled');
      currentGuess.push(k); currentCol++;
    }
  }

  function submitGuess() {
    var guess = currentGuess.join('');
    var result = Array(wordLen).fill('absent');
    var sArr = secret.split(''), gArr = guess.split('');
    // correct positions first
    for (var i = 0; i < wordLen; i++) {
      if (gArr[i] === sArr[i]) { result[i] = 'correct'; sArr[i] = null; gArr[i] = null; }
    }
    // present letters
    for (var i = 0; i < wordLen; i++) {
      if (gArr[i] === null) continue;
      var idx = sArr.indexOf(gArr[i]);
      if (idx !== -1) { result[i] = 'present'; sArr[idx] = null; }
    }
    // animate cells + update keyboard
    // snapshot currentRow before increment so setTimeout closures colour
    // the submitted row, not the next one (closes #2)
    var animRow = currentRow;
    result.forEach(function(state, i) {
      var letter = cells[animRow][i].textContent;
      setTimeout(function() { cells[animRow][i].classList.add(state); }, i * 80);
      var key = keyMap[letter];
      if (key) {
        var cur = key.dataset.state || '';
        if (state === 'correct' || (state === 'present' && cur !== 'correct') || (state === 'absent' && !cur)) {
          key.className = 'wordle-key' + (key.classList.contains('wordle-key-wide') ? ' wordle-key-wide' : '') + ' ' + state;
          key.dataset.state = state;
        }
      }
    });
    var won = guess === secret;
    currentRow++; currentGuess = []; currentCol = 0;
    setTimeout(function() {
      if (won) {
        on = false;
        hintBtn.disabled = true;
        var base = Math.max(20, (maxRows - currentRow + 1) * 20);
        var score = Math.max(0, base - hintsUsed * 15);
        var hintNote = hintsUsed > 0 ? ' (−' + (hintsUsed * 15) + ' Tipp)' : '';
        statusEl.textContent = '🎉 ' + secret + '! +' + score + ' Punkte' + hintNote;
        document.getElementById('pts').textContent = score;
        sounds.highscore(); saveHS('wordle', score);
      } else if (currentRow >= maxRows) {
        on = false;
        hintBtn.disabled = true;
        statusEl.textContent = '💀 Game Over! Das Wort war: ' + secret;
        saveHS('wordle', 0);
      }
    }, wordLen * 80 + 100);
  }

  function kbClick(e) { var k = e.target.dataset.key; if (k) handleKey(k); }
  kbEl.addEventListener('click', kbClick);

  function physKey(e) {
    if (!on) return;
    var k = e.key.toUpperCase();
    if (k === 'ENTER') { e.preventDefault(); handleKey('ENTER'); }
    else if (k === 'BACKSPACE') handleKey('BACKSPACE');
    else if (/^[A-ZÜÄÖ]$/.test(k)) handleKey({ 'Ü': 'U', 'Ä': 'A', 'Ö': 'O' }[k] || k);
  }
  document.addEventListener('keydown', physKey);

  return {
    stop: function() {
      on = false;
      hintBtn.disabled = true;
      hintBtn.onclick = null;
      kbEl.removeEventListener('click', kbClick);
      document.removeEventListener('keydown', physKey);
    }
  };
}

/* ---- GAME OVER ---- */
function gg(ctx,W,H,s){
  ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#fff';ctx.textAlign='center';
  ctx.font='bold 26px Bricolage Grotesque,sans-serif';ctx.fillText('Game Over!',W/2,H/2-10);
  ctx.font='16px Bricolage Grotesque,sans-serif';ctx.fillText(s+' Punkte',W/2,H/2+22);
}

// ── Avatar-Pfeil-Navigation ───────────────────────────────────
var avatarHistory = [];
var avatarHistoryIdx = 0;

function avatarImgUrl(seed) {
  return 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
}

function refreshAvatarPreview() {
  var seed = avatarHistory[avatarHistoryIdx];
  document.getElementById('profile-avatar').src = avatarImgUrl(seed);
  document.getElementById('avatar-position').textContent =
    (avatarHistoryIdx + 1) + ' / ' + avatarHistory.length;
  document.getElementById('avatar-prev').disabled = (avatarHistoryIdx === 0);
  // Highlight save button if current differs from saved
  var saveBtn = document.getElementById('btn-save-avatar');
  var changed = seed !== (user.avatar_seed || user.name);
  saveBtn.classList.toggle('btn-action-changed', changed);
}

document.getElementById('avatar-next').addEventListener('click', function() {
  if (avatarHistoryIdx < avatarHistory.length - 1) {
    // Already have a future entry — just go forward
    avatarHistoryIdx++;
  } else {
    // Generate a fresh seed and append to history
    var newSeed = Math.random().toString(36).substring(2, 10);
    avatarHistory.push(newSeed);
    avatarHistoryIdx++;
  }
  refreshAvatarPreview();
});

document.getElementById('avatar-prev').addEventListener('click', function() {
  if (avatarHistoryIdx > 0) {
    avatarHistoryIdx--;
    refreshAvatarPreview();
  }
});

document.getElementById('btn-save-avatar').addEventListener('click', async function() {
  var newSeed = avatarHistory[avatarHistoryIdx];
  if (!newSeed || newSeed === (user.avatar_seed || user.name)) return;
  try {
    var res = await fetch(API_URL + '/api/user/' + user.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_seed: newSeed })
    });
    if (res.ok) {
      user.avatar_seed = newSeed;
      var url = avatarImgUrl(newSeed);
      document.getElementById('avatar').src = url;
      // Flash "Gespeichert ✓"
      var btn = document.getElementById('btn-save-avatar');
      var prev = btn.textContent;
      btn.textContent = '✓ Gespeichert!';
      btn.classList.remove('btn-action-changed');
      setTimeout(function() { btn.textContent = prev || '✓ Übernehmen'; }, 1600);
      loadGlobalHS();
    }
  } catch (err) {
    console.error('Fehler beim Speichern des Avatars:', err);
  }
});

function openProfileOverlay() {
  // Reset history to current saved avatar each time the overlay opens
  var seed = user.avatar_seed || user.name;
  avatarHistory = [seed];
  avatarHistoryIdx = 0;
  refreshAvatarPreview();
  document.getElementById("profile-name").textContent = user.name;
  var created = user.created_at_
    ? new Date(user.created_at_).toLocaleDateString("de-AT")
    : "-";
  var profileTotal = getScoreTotal(user);
  document.getElementById("profile-info").innerHTML =
    "Rang: " + getRank(profileTotal) + "<br>" +
    "Mitglied seit: " + created + "<br>" +
    "Spiele gespielt: " + (user.games_played || 0);
  document.getElementById("profile-overlay").classList.add("on");
}

function openSettingsOverlay() {
  document.getElementById("settings-overlay").classList.add("on");
  refreshNotifToggle();
  refreshStatusMenu();
  renderProfileEmail();
  // Spotlight auf E-Mail Row wenn keine E-Mail
  if (!user.email) {
    setTimeout(function() {
      var row = document.getElementById('profile-email-row');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        row.classList.add('spotlight-highlight');
        setTimeout(function(){ row.classList.remove('spotlight-highlight'); }, 4000);
      }
    }, 300);
  }
}

/* ---- AVATAR-DROPDOWN (Status-Menü direkt unter dem Avatar) ---- */
document.getElementById("avatar-spotlight-wrap").style.cursor = "pointer";
// Ans Ende von <body> verschieben, damit es nicht in der Stacking-Context des
// Headers (z-index:1) gefangen ist und immer im Vordergrund liegt.
document.body.appendChild(document.getElementById("avatar-status-menu"));
document.getElementById("avatar").addEventListener("click", function(e) {
  e.stopPropagation();
  refreshStatusMenu();
  var menu = document.getElementById("avatar-status-menu");
  var willOpen = !menu.classList.contains("on");
  if (willOpen) {
    var rect = document.getElementById("avatar-spotlight-wrap").getBoundingClientRect();
    menu.style.top = (rect.bottom + 8) + 'px';
    var left = rect.left;
    if (left + 200 > window.innerWidth) left = window.innerWidth - 210;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
  }
  menu.classList.toggle("on");
});
document.getElementById("avatar-status-menu").addEventListener("click", function(e) {
  e.stopPropagation();
});
document.addEventListener("click", function() {
  document.getElementById("avatar-status-menu").classList.remove("on");
});
document.getElementById("avatar-menu-profile-btn").addEventListener("click", function() {
  document.getElementById("avatar-status-menu").classList.remove("on");
  openProfileOverlay();
});

/* ---- ZAHNRAD: Einstellungen-Overlay ---- */
document.getElementById("btn-settings").addEventListener("click", function() {
  openSettingsOverlay();
});
document.getElementById("btn-open-settings-from-profile").addEventListener("click", function() {
  document.getElementById("profile-overlay").classList.remove("on");
  openSettingsOverlay();
});
document.getElementById("btn-close-settings").addEventListener("click", function() {
  document.getElementById("settings-overlay").classList.remove("on");
});
document.getElementById("settings-overlay").addEventListener("click", function(e) {
  if (e.target.id === "settings-overlay") {
    document.getElementById("settings-overlay").classList.remove("on");
  }
});

/* ---- STATUS-MENÜ (Aktiv / Abwesend / Nicht stören + Einstellungen) ---- */
function refreshStatusMenu() {
  if (!user) return;
  var status = user.status || 'online';
  document.querySelectorAll('.status-option').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-status') === status);
  });
  setToggleUI('hide-chat-toggle-btn', 'hide-chat-toggle-text', !user.hide_chat_icons);
  setToggleUI('accept-invites-toggle-btn', 'accept-invites-toggle-text', user.accept_invites !== false);
  setToggleUI('sound-toggle-btn', 'sound-toggle-text', localStorage.getItem('soundEffects') !== 'off');
  setToggleUI('show-last-seen-toggle-btn', 'show-last-seen-toggle-text', showLastSeenEnabled());
  updateHeaderStatusDot();
}

function setToggleUI(btnId, textId, on) {
  var btn = document.getElementById(btnId);
  var txt = document.getElementById(textId);
  if (!btn) return;
  if (on) { btn.classList.add('on'); if (txt) txt.textContent = 'An'; }
  else { btn.classList.remove('on'); if (txt) txt.textContent = 'Aus'; }
}

function applyChatIconsVisibility() {
  var hide = !!(user && user.hide_chat_icons);
  ['global-chat-btn', 'sidebar-mobile-btn', 'sidebar-toggle'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = hide ? 'none' : '';
  });
}

document.querySelectorAll('.status-option').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!user) return;
    var status = btn.getAttribute('data-status');
    document.getElementById('avatar-status-menu').classList.remove('on');
    if (user.status === status) return;
    user.status = status;
    refreshStatusMenu();
    fetch(API_URL + '/api/users/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, status: status })
    }).catch(function() {});
  });
});

document.getElementById('hide-chat-toggle-btn').addEventListener('click', function() {
  if (!user) return;
  user.hide_chat_icons = !user.hide_chat_icons;
  refreshStatusMenu();
  applyChatIconsVisibility();
  fetch(API_URL + '/api/users/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, hide_chat_icons: user.hide_chat_icons })
  }).catch(function() {});
});

document.getElementById('accept-invites-toggle-btn').addEventListener('click', function() {
  if (!user) return;
  user.accept_invites = (user.accept_invites === false) ? true : false;
  refreshStatusMenu();
  fetch(API_URL + '/api/users/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, accept_invites: user.accept_invites })
  }).catch(function() {});
});

document.getElementById('sound-toggle-btn').addEventListener('click', function() {
  var on = localStorage.getItem('soundEffects') !== 'off';
  localStorage.setItem('soundEffects', on ? 'off' : 'on');
  refreshStatusMenu();
});

document.getElementById('show-last-seen-toggle-btn').addEventListener('click', function() {
  var on = showLastSeenEnabled();
  localStorage.setItem('showLastSeen', on ? 'off' : 'on');
  refreshStatusMenu();
});

document.getElementById("btn-close-profile").addEventListener("click", function() {
  document.getElementById("profile-overlay").classList.remove("on");
});

/* ── Profil: E-Mail hinterlegen ─────────────────────────── */
function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '?';
  // Try from name (first 2 chars or first letters of words)
  var n = nameOrEmail.replace(/@.*/, ''); // strip @domain if email
  var parts = n.split(/[\s._\-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function renderProfileEmail() {
  if (!user) return;
  var badge    = document.getElementById('pe-status-badge');
  var setView  = document.getElementById('pe-set-view');
  var emptyView= document.getElementById('pe-empty-view');
  var inputArea= document.getElementById('pe-input-area');
  var msg      = document.getElementById('pe-msg');
  if (msg) { msg.textContent = ''; msg.className = 'pe-msg'; }
  if (user.email) {
    badge.textContent = '✓ Verifiziert'; badge.className = 'pe-status-badge ok';
    var circle = document.getElementById('pe-initials-circle');
    if (circle) circle.textContent = getInitials(user.name || user.email);
    var emailEl = document.getElementById('pe-set-email');
    if (emailEl) emailEl.textContent = user.email;
    if (setView)  setView.style.display  = '';
    if (emptyView) emptyView.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
  } else {
    badge.textContent = '⚠ Nicht gesetzt'; badge.className = 'pe-status-badge missing';
    if (setView)  setView.style.display  = 'none';
    if (emptyView) emptyView.style.display = '';
    if (inputArea) inputArea.style.display = 'none';
  }
}

function openEmailInput() {
  var emptyView = document.getElementById('pe-empty-view');
  var setView   = document.getElementById('pe-set-view');
  var inputArea = document.getElementById('pe-input-area');
  if (emptyView) emptyView.style.display = 'none';
  if (setView)   setView.style.display   = 'none';
  if (inputArea) inputArea.style.display = '';
  var inp = document.getElementById('pe-email-input');
  if (inp) { inp.value = user.email || ''; inp.focus(); updatePePreview(inp.value); }
  // Spotlight highlight on the row
  var row = document.getElementById('profile-email-row');
  if (row) { row.classList.add('spotlight-highlight'); setTimeout(function(){ row.classList.remove('spotlight-highlight'); }, 4000); }
}

function updatePePreview(val) {
  var circle = document.getElementById('pe-preview-circle');
  if (!circle) return;
  var name = user && user.name ? user.name : '';
  if (val && val.includes('@')) {
    circle.textContent = getInitials(name || val);
    circle.className = 'pe-preview-circle has-email';
  } else {
    circle.textContent = name ? getInitials(name) : '?';
    circle.className = 'pe-preview-circle';
  }
}

// Wire up buttons
var peAddBtn = document.getElementById('pe-add-btn');
if (peAddBtn) peAddBtn.addEventListener('click', openEmailInput);

var peEditBtn = document.getElementById('pe-edit-btn');
if (peEditBtn) peEditBtn.addEventListener('click', openEmailInput);

var peCancelBtn = document.getElementById('pe-cancel-btn');
if (peCancelBtn) peCancelBtn.addEventListener('click', function() {
  renderProfileEmail();
  document.getElementById('pe-msg').textContent = '';
});

var peEmailInput = document.getElementById('pe-email-input');
if (peEmailInput) peEmailInput.addEventListener('input', function() { updatePePreview(this.value); });

document.getElementById('pe-save-btn').addEventListener('click', async function() {
  var email = document.getElementById('pe-email-input').value.trim();
  var msg = document.getElementById('pe-msg');
  if (!email) { msg.textContent = 'Bitte E-Mail eingeben.'; msg.className = 'pe-msg err'; return; }
  this.textContent = '…'; this.disabled = true;
  try {
    var res = await fetch(API_URL + '/api/user/set-email', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: user.id, email: email })
    });
    var data = await res.json();
    if (data.success) {
      user.email = email.toLowerCase().trim();
      msg.textContent = '✓ Gespeichert!'; msg.className = 'pe-msg ok';
      renderProfileEmail();
      clearEmailSpotlight(); // Spotlight entfernen
    } else {
      msg.textContent = data.error || 'Fehler.'; msg.className = 'pe-msg err';
    }
  } catch(e) { msg.textContent = 'Verbindungsfehler.'; msg.className = 'pe-msg err'; }
  this.textContent = '✓ Speichern'; this.disabled = false;
});

// Notification toggle button in profile
document.getElementById('notif-toggle-btn').addEventListener('click', async function() {
  if (!('Notification' in window)) {
    setNotifHint('Dein Browser unterstützt keine Benachrichtigungen.');
    return;
  }
  var perm = Notification.permission;

  if (perm === 'denied') {
    // Can't re-enable via JS when browser blocked — only show helpful text
    setNotifHint('Im Browser blockiert. Öffne: Einstellungen → Datenschutz/Benachrichtigungen → ArcadeBox → Erlauben, dann lade die Seite neu.');
    return;
  }

  if (perm === 'granted') {
    // Toggle ON ↔ OFF (browser permission stays granted, only our pref changes)
    var currentlyOn = notifUserWantsOn();
    if (currentlyOn) {
      localStorage.setItem(NOTIF_PREF, 'false');
      refreshNotifToggle();
      setNotifHint('Deaktiviert — tippe nochmal um wieder zu aktivieren.');
    } else {
      // Re-enable: pref was 'false', flip back to 'true'
      localStorage.setItem(NOTIF_PREF, 'true');
      refreshNotifToggle();
      setNotifHint('Aktiviert ✓');
      tryWebPushSubscribe();
    }
    return;
  }

  // permission === 'default' — request it (this IS a user gesture so browser allows it)
  try {
    var p = await Notification.requestPermission();
    localStorage.setItem(NOTIF_PREF, p === 'granted' ? 'true' : 'false');
    localStorage.setItem('notif_asked', '1');
    refreshNotifToggle();
    if (p === 'granted') tryWebPushSubscribe();
  } catch(e) {
    setNotifHint('Fehler beim Anfordern der Erlaubnis.');
  }
});

// Test notification button
document.getElementById('notif-test-btn').addEventListener('click', function() {
  showLocalNotif('🔔 Test-Benachrichtigung', 'Benachrichtigungen funktionieren! 🎮');
  setNotifHint('Test gesendet! Falls nichts erscheint → Browser blockiert die Seite.');
});

/* ================================================================
   NEUE MULTIPLAYER-SPIELE: CONNECT 4 / PONG / SCHERE STEIN PAPIER
   ================================================================ */

// RPS round selection
var rpsMaxRounds = 3;
document.querySelectorAll('.rps-rounds').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.rps-rounds').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    rpsMaxRounds = parseInt(this.dataset.rounds);
  });
});

/* ---- CONNECT 4 ---- */
async function loadC4LobbyScreen() {
  document.getElementById('c4-lobby-screen').style.display = 'block';
  try {
    var res = await fetch(API_URL + '/api/users/search?me=' + user.id);
    var users = await res.json();
    var online = (users||[]).filter(function(u){ return isRecentlyActive(u) && u.id !== user.id; });
    document.getElementById('c4-online-num').textContent = online.length;
    var container = document.getElementById('c4-users-list');
    if (!online.length) { container.innerHTML = '<div class="lobby-empty">Keine Freunde online</div>'; return; }
    var html = '';
    online.forEach(function(u) {
      var seed = u.avatar_seed || u.name || 'unknown';
      var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
      html += '<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="connect4">Einladen</button></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.btn-invite').forEach(function(btn) {
      btn.addEventListener('click', function() { sendGameInvite(parseInt(this.dataset.id), this, this.dataset.game || 'connect4'); });
    });
  } catch(e) {}
}

function c4Start(diff) {
  c4IsAI = true; c4AiDiff = diff || c4AiDiff; c4IsHost = true; c4MySymbol = 'R'; c4On = true;
  document.getElementById('c4-area').classList.remove('active');
  var cv = document.getElementById('c');
  cv.style.display = 'block';
  fitCanvas(cv, 420, 400);
  if (game) { game.stop(); game = null; }
  game = connect4Game(cv, true, c4AiDiff, true, null);
}

function c4StartOnline(lobbyId, isHost) {
  c4LobbyId = lobbyId; c4IsHost = isHost; c4IsAI = false;
  c4MySymbol = isHost ? 'R' : 'Y'; c4On = true;
  document.getElementById('c4-area').classList.remove('active');
  var cv = document.getElementById('c');
  cv.style.display = 'block';
  fitCanvas(cv, 420, 400);
  if (game) { game.stop(); game = null; }
  game = connect4Game(cv, false, null, isHost, lobbyId);
  // WebSocket for instant move sync
  connectGameWS(lobbyId, function(data) {
    if (data.type==='c4' && game && game.applyState) game.applyState(data.state);
  });
  // Poll as fallback (3s)
  if (c4PollInterval) clearInterval(c4PollInterval);
  c4PollInterval = setInterval(c4PollOnline, 3000);
}

async function c4PollOnline() {
  if (!c4On || !c4LobbyId) return;
  try {
    var res = await fetch(API_URL + '/api/lobby/' + c4LobbyId);
    if (!res.ok) return;
    var lobby = await res.json();
    if (game && game.applyState) game.applyState(lobby.game_state);
  } catch(e) {}
}

function connect4Game(cv, isAI, diff, isHost, lobbyId) {
  var COLS = 7, ROWS = 6;
  var W = cv._W || cv.width, H = cv._H || cv.height;
  var CELL = Math.floor(Math.min(W / COLS, (H - 46) / ROWS));
  var bW = COLS * CELL, bH = ROWS * CELL;
  var oX = Math.floor((W - bW) / 2);
  var oY = 46;
  var ctx = cv.getContext('2d');
  var board = Array(ROWS * COLS).fill('');
  var on = true, myTurn = isHost;
  var mySym = isHost ? 'R' : 'Y';
  var hoverCol = -1;
  var animPiece = null; // { col, y, sym } during drop animation

  function dropRow(b, col) {
    for (var r = ROWS-1; r >= 0; r--) { if (!b[r*COLS+col]) return r; }
    return -1;
  }

  function checkWin(b, lr, lc, sym) {
    var dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (var d = 0; d < dirs.length; d++) {
      var cnt = 1;
      for (var s = -1; s <= 1; s += 2) {
        for (var i = 1; i <= 3; i++) {
          var r = lr + dirs[d][0]*i*s, c = lc + dirs[d][1]*i*s;
          if (r>=0&&r<ROWS&&c>=0&&c<COLS&&b[r*COLS+c]===sym) cnt++;
          else break;
        }
      }
      if (cnt >= 4) return true;
    }
    return false;
  }

  function isDraw(b) {
    for (var c = 0; c < COLS; c++) { if (!b[c]) return false; }
    return true;
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
    ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
    ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    // background
    var bg = ctx.createRadialGradient(W/2,H/2,10,W/2,H/2,W*0.8);
    bg.addColorStop(0,'#0a0a1a'); bg.addColorStop(1,'#060610');
    ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
    // Board shadow
    ctx.shadowColor='rgba(0,0,200,0.35)'; ctx.shadowBlur=24;
    ctx.fillStyle='#1a3a9f';
    rrect(ctx,oX-8,oY-8,bW+16,bH+16,12); ctx.fill();
    ctx.shadowBlur=0;
    // Inner board
    ctx.fillStyle='#1535a0';
    rrect(ctx,oX-6,oY-6,bW+12,bH+12,10); ctx.fill();
    // Cells
    for(var r=0;r<ROWS;r++){
      for(var c2=0;c2<COLS;c2++){
        var cell=board[r*COLS+c2];
        var cxc=oX+c2*CELL+CELL/2, cyc=oY+r*CELL+CELL/2;
        var rad=CELL/2-3;
        // Cell hole
        ctx.beginPath(); ctx.arc(cxc,cyc,rad,0,Math.PI*2);
        if(cell==='R'){
          var gr=ctx.createRadialGradient(cxc-rad*0.25,cyc-rad*0.25,2,cxc,cyc,rad);
          gr.addColorStop(0,'#ff7766'); gr.addColorStop(0.5,'#ef4444'); gr.addColorStop(1,'#991b1b');
          ctx.fillStyle=gr; ctx.shadowColor='#ef4444'; ctx.shadowBlur=18;
        } else if(cell==='Y'){
          var gy=ctx.createRadialGradient(cxc-rad*0.25,cyc-rad*0.25,2,cxc,cyc,rad);
          gy.addColorStop(0,'#fde68a'); gy.addColorStop(0.5,'#fbbf24'); gy.addColorStop(1,'#d97706');
          ctx.fillStyle=gy; ctx.shadowColor='#fbbf24'; ctx.shadowBlur=18;
        } else {
          var gh=ctx.createRadialGradient(cxc-rad*0.3,cyc-rad*0.3,1,cxc,cyc,rad);
          gh.addColorStop(0,'#162248'); gh.addColorStop(1,'#0a1630');
          ctx.fillStyle=gh; ctx.shadowBlur=0;
        }
        ctx.fill(); ctx.shadowBlur=0;
        // Highlight arc for depth
        if(!cell){
          ctx.beginPath(); ctx.arc(cxc,cyc-rad*0.15,rad*0.82,Math.PI*1.1,Math.PI*1.9);
          ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=2; ctx.stroke();
        }
      }
    }
    // Animated falling piece
    if(animPiece){
      var ax=oX+animPiece.col*CELL+CELL/2;
      var rad2=CELL/2-3;
      ctx.beginPath(); ctx.arc(ax,animPiece.y,rad2,0,Math.PI*2);
      if(animPiece.sym==='R'){
        var ga=ctx.createRadialGradient(ax-rad2*0.25,animPiece.y-rad2*0.25,2,ax,animPiece.y,rad2);
        ga.addColorStop(0,'#ff7766'); ga.addColorStop(0.5,'#ef4444'); ga.addColorStop(1,'#991b1b');
        ctx.fillStyle=ga;
      } else {
        var gb=ctx.createRadialGradient(ax-rad2*0.25,animPiece.y-rad2*0.25,2,ax,animPiece.y,rad2);
        gb.addColorStop(0,'#fde68a'); gb.addColorStop(0.5,'#fbbf24'); gb.addColorStop(1,'#d97706');
        ctx.fillStyle=gb;
      }
      ctx.shadowColor=animPiece.sym==='R'?'#ef4444':'#fbbf24'; ctx.shadowBlur=22;
      ctx.fill(); ctx.shadowBlur=0;
    }
    // Hover
    if(myTurn&&on&&hoverCol>=0&&!animPiece){
      var hx=oX+hoverCol*CELL+CELL/2;
      ctx.beginPath(); ctx.arc(hx,20,13,0,Math.PI*2);
      ctx.fillStyle=mySym==='R'?'rgba(239,68,68,0.9)':'rgba(251,191,36,0.9)';
      ctx.shadowColor=mySym==='R'?'#ef4444':'#fbbf24'; ctx.shadowBlur=16;
      ctx.fill(); ctx.shadowBlur=0;
      ctx.setLineDash([4,4]);
      ctx.strokeStyle=mySym==='R'?'rgba(239,68,68,0.25)':'rgba(251,191,36,0.25)';
      ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(hx,34); ctx.lineTo(hx,oY); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Status bar
    if(on&&!animPiece){
      var statusTxt=myTurn?'👆 Dein Zug!':'⏳ Gegner am Zug...';
      ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
      var tw=ctx.measureText(statusTxt).width;
      ctx.fillStyle='rgba(0,0,0,0.55)';
      rrect(ctx,W/2-tw/2-10,H-26,tw+20,20,6); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.75)';
      ctx.fillText(statusTxt,W/2,H-11);
    }
  }

  function easeOutBounce(t) {
    var n1 = 7.5625, d1 = 2.75;
    if (t < 1/d1) return n1*t*t;
    else if (t < 2/d1) { t -= 1.5/d1; return n1*t*t+0.75; }
    else if (t < 2.5/d1) { t -= 2.25/d1; return n1*t*t+0.9375; }
    else { t -= 2.625/d1; return n1*t*t+0.984375; }
  }

  function animateDrop(col, row, sym, onDone) {
    var startY = oY - CELL/2 + 4; // just above the board
    var targetY = oY + row * CELL + CELL/2;
    var dur = Math.min(380 + row * 90, 950); // satisfying drop speed
    var t0 = null;
    animPiece = { col: col, y: startY, sym: sym };
    function step(ts) {
      if (!on) { animPiece = null; return; } // stopped — bail out
      if (!t0) t0 = ts;
      var t = Math.min((ts - t0) / dur, 1);
      animPiece.y = startY + (targetY - startY) * easeOutBounce(t);
      draw();
      if (t < 1) { requestAnimationFrame(step); }
      else { animPiece = null; onDone(); }
    }
    requestAnimationFrame(step);
  }

  function doPlace(col) {
    if (!on || !myTurn || animPiece) return;
    var row = dropRow(board, col);
    if (row === -1) return;
    myTurn = false;
    animateDrop(col, row, mySym, function() {
      board[row*COLS+col] = mySym;
      draw();
      // For ONLINE: ALWAYS send move to server FIRST, before any win check!
      // If we check win first and return, loser never receives the winning move.
      if (!isAI && lobbyId) {
        // Primary: WS instant relay. Secondary: REST for persistence.
        fetch(API_URL+'/api/lobby/move', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({lobby_id:lobbyId, user_id:user.id, move:col})
        }).then(async function(r){
          // After server processes, broadcast updated board via WS
          var j = await r.json().catch(function(){return null;});
          if (j && j.game_state) sendGameWS({type:'c4', state:j.game_state});
        });
      }
      if (checkWin(board, row, col, mySym)) {
        on = false; c4On = false;
        if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
        sounds.highscore();
        setTimeout(function() { c4GameOver('win'); }, 300);
        return;
      }
      if (isDraw(board)) { on=false; c4On=false; setTimeout(function(){c4GameOver('draw');},300); return; }
      if (isAI) {
        var aiSym = mySym==='R'?'Y':'R';
        var aiCol = c4AiMove(board, aiSym, diff);
        var aiRow = dropRow(board, aiCol);
        animateDrop(aiCol, aiRow, aiSym, function() {
          board[aiRow*COLS+aiCol] = aiSym;
          draw();
          if (checkWin(board, aiRow, aiCol, aiSym)) {
            on=false; c4On=false; setTimeout(function(){c4GameOver('lose');},300); return;
          }
          if (isDraw(board)) { on=false; c4On=false; setTimeout(function(){c4GameOver('draw');},300); return; }
          myTurn = true; draw();
        });
      }
    });
  }

  function onClick(e) {
    if (!on || !myTurn) return;
    var rect = cv.getBoundingClientRect();
    var scaleX = W / rect.width;
    var cx2 = ((e.clientX||(e.changedTouches&&e.changedTouches[0].clientX)||0) - rect.left) * scaleX;
    var col = Math.floor((cx2-oX)/CELL);
    if (col>=0&&col<COLS) doPlace(col);
  }
  function onMove(e) {
    var rect=cv.getBoundingClientRect();
    var scaleX = W / rect.width;
    var cx2=((e.clientX||(e.touches&&e.touches[0].clientX)||0)-rect.left)*scaleX;
    var col=Math.floor((cx2-oX)/CELL);
    hoverCol=(col>=0&&col<COLS)?col:-1; draw();
  }

  function onLeave(){hoverCol=-1;draw();}
  cv.addEventListener('click', onClick);
  cv.addEventListener('touchend', onClick);
  cv.addEventListener('mousemove', onMove);
  cv.addEventListener('mouseleave', onLeave);
  draw();

  // Scan entire board for any 4-in-a-row — more robust than single-position check
  function findWinner(b) {
    for (var r=0;r<ROWS;r++) {
      for (var c=0;c<COLS;c++) {
        var s=b[r*COLS+c];
        if (s && checkWin(b,r,c,s)) return s;
      }
    }
    return null;
  }

  function finishRound(b) {
    var winner = findWinner(b);
    if (winner) {
      on=false; c4On=false;
      if (c4PollInterval){clearInterval(c4PollInterval);c4PollInterval=null;}
      var result = winner===mySym ? 'win' : 'lose';
      setTimeout(function(){c4GameOver(result);},300);
      return true;
    }
    if (isDraw(b)){on=false;c4On=false;setTimeout(function(){c4GameOver('draw');},300);return true;}
    return false;
  }

  function applyState(state) {
    if (!state||!state.board||!on) return;
    var nb = state.board;
    var changed=false;
    for (var i=0;i<nb.length;i++){if(nb[i]!==board[i]){changed=true;break;}}
    if (!changed) return;

    // If animation in progress, wait — but keep nb reference for after animation
    if (animPiece) {
      var pendingNb = nb;
      // Schedule re-check after current animation (500ms safety margin)
      setTimeout(function(){ if(on) applyState(state); }, 500);
      return;
    }

    // Find the new piece (first cell that changed from empty to filled)
    var lr=-1,lc=-1,ls='';
    for (var i=0;i<nb.length;i++){if(nb[i]&&!board[i]){lr=Math.floor(i/COLS);lc=i%COLS;ls=nb[i];break;}}

    if (lr>=0 && ls && ls!==mySym) {
      // Opponent's piece — animate it falling in
      animateDrop(lc, lr, ls, function() {
        board=nb.slice();
        draw();
        if (!finishRound(board)) { myTurn=true; draw(); }
      });
    } else {
      // My own piece confirmed by server, or no new piece found — just sync board
      board=nb.slice();
      draw();
      if (lr>=0) finishRound(board);
    }
  }

  return {
    stop:function(){on=false;animPiece=null;cv.removeEventListener('click',onClick);cv.removeEventListener('touchend',onClick);cv.removeEventListener('mousemove',onMove);cv.removeEventListener('mouseleave',onLeave);},
    applyState:applyState
  };
}

function c4AiMove(board, aiSym, diff) {
  var COLS=7,ROWS=6;
  var humSym=aiSym==='R'?'Y':'R';
  function validCols(){var c=[];for(var i=0;i<COLS;i++){if(!board[i])c.push(i);}return c;}
  function dropRow(b,col){for(var r=ROWS-1;r>=0;r--){if(!b[r*COLS+col])return r;}return -1;}
  function win(b,lr,lc,s){
    var dirs=[[0,1],[1,0],[1,1],[1,-1]];
    for(var d=0;d<dirs.length;d++){
      var cnt=1;
      for(var sg=-1;sg<=1;sg+=2){for(var i=1;i<=3;i++){var r=lr+dirs[d][0]*i*sg,c=lc+dirs[d][1]*i*sg;if(r>=0&&r<ROWS&&c>=0&&c<COLS&&b[r*COLS+c]===s)cnt++;else break;}}
      if(cnt>=4)return true;
    }return false;
  }
  function tryWin(b,sym){
    for(var c=0;c<COLS;c++){if(b[c])continue;var r=dropRow(b,c);if(r<0)continue;var tb=b.slice();tb[r*COLS+c]=sym;if(win(tb,r,c,sym))return c;}return -1;
  }
  var valid=validCols();
  if(!valid.length)return 3;
  if(diff==='easy')return valid[Math.floor(Math.random()*valid.length)];
  var w=tryWin(board,aiSym); if(w>=0)return w;
  var bl=tryWin(board,humSym); if(bl>=0)return bl;
  if(diff==='medium'){var pref=[3,2,4,1,5,0,6];for(var i=0;i<pref.length;i++){if(valid.indexOf(pref[i])>=0)return pref[i];}return valid[0];}
  // Hard: avoid giving opponent top of our column
  var safe=valid.filter(function(c){
    var r=dropRow(board,c);if(r<=0)return true;
    var tb=board.slice();tb[r*COLS+c]=aiSym;
    var tb2=tb.slice();tb2[(r-1)*COLS+c]=humSym;
    return !win(tb2,r-1,c,humSym);
  });
  var choices=safe.length?safe:valid;
  var ctr=[3,2,4,1,5,0,6];
  for(var i=0;i<ctr.length;i++){if(choices.indexOf(ctr[i])>=0)return ctr[i];}
  return choices[0];
}

function c4GameOver(result) {
  var overlay=document.getElementById('ttt-overlay');
  var msg=document.getElementById('ttt-overlay-msg');
  if(result==='win'){msg.innerHTML='🏆<br>Du hast gewonnen!<br><small style="font-size:0.6em;opacity:0.7">4 Gewinnt</small>';sounds.highscore();}
  else if(result==='lose'){msg.innerHTML='😔<br>Du hast verloren.<br><small style="font-size:0.6em;opacity:0.7">4 Gewinnt</small>';}
  else{msg.innerHTML='🤝<br>Unentschieden!<br><small style="font-size:0.6em;opacity:0.7">4 Gewinnt</small>';}
  overlay.classList.add('show');
}

/* ---- PONG ---- */
async function loadPongLobbyScreen() {
  try {
    var res = await fetch(API_URL+'/api/users/search?me='+user.id);
    var users = await res.json();
    var online=(users||[]).filter(function(u){return isRecentlyActive(u)&&u.id!==user.id;});
    document.getElementById('pong-online-num').textContent=online.length;
    var container=document.getElementById('pong-users-list');
    if(!online.length){container.innerHTML='<div class="lobby-empty">Keine Freunde online</div>';return;}
    var html='';
    online.forEach(function(u){
      var seed=u.avatar_seed||u.name||'unknown';
      var av='https://api.dicebear.com/7.x/adventurer/svg?seed='+encodeURIComponent(seed);
      html+='<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="pong">Einladen</button></div>';
    });
    container.innerHTML=html;
    container.querySelectorAll('.btn-invite').forEach(function(btn){
      btn.addEventListener('click',function(){sendGameInvite(parseInt(this.dataset.id),this,this.dataset.game||'pong');});
    });
  }catch(e){}
}

function pongStart(diff) {
  pongIsAI=true; pongAiDiff=diff||pongAiDiff; pongIsHost=true; pongOn=true;
  document.getElementById('pong-area').classList.remove('active');
  var cv=document.getElementById('c');
  cv.style.display='block';
  fitCanvas(cv,520,420);
  if(game){game.stop();game=null;}
  game=pongGame(cv,true,pongAiDiff,true,null);
}

function pongStartOnline(lobbyId,isHost) {
  pongLobbyId=lobbyId; pongIsHost=isHost; pongIsAI=false; pongOn=true;
  document.getElementById('pong-area').classList.remove('active');
  var cv=document.getElementById('c');
  cv.style.display='block';
  fitCanvas(cv,520,420);
  if(game){game.stop();game=null;}
  game=pongGame(cv,false,pongAiDiff,isHost,lobbyId);
  // WebSocket for real-time state sync (sub-10ms)
  connectGameWS(lobbyId, function(data) {
    if (data.type==='pong' && game && game.applyState) game.applyState(data);
  });
  // Keep polling as fallback/reconnect safety (but infrequent)
  if(pongPollInterval)clearInterval(pongPollInterval);
  pongPollInterval=setInterval(pongPollOnline, 2000); // just a safety fallback
}

async function pongPollOnline() {
  if(!pongOn||!pongLobbyId)return;
  try{
    var res=await fetch(API_URL+'/api/lobby/'+pongLobbyId);
    if(!res.ok)return;
    var lobby=await res.json();
    if(game&&game.applyState)game.applyState(lobby.game_state);
  }catch(e){}
}

function pongGame(cv, isAI, diff, isHost, lobbyId) {
  var W=cv._W||cv.width, H=cv._H||cv.height;
  var ctx=cv.getContext('2d');
  var PW=12, PH=80, BR=8, MAX=5;
  var on=true, raf=null;
  var lastPush=0, lastTs=null;
  var TARGET_DT=1000/60;
  var speedMap={easy:2.0, medium:3.2, hard:5.0};
  var baseSpeed=speedMap[diff]||3.2;
  var ball={x:W/2,y:H/2,vx:0,vy:0};  // ball starts stationary (countdown first)
  var padL={x:20,y:H/2-PH/2};
  var padR={x:W-20-PW,y:H/2-PH/2};
  var sc={l:0,r:0};
  var myPad=isHost?padL:padR;
  var srvState=null;
  var srvStateNew=false; // true only when a brand-new WS message just arrived
  // Countdown
  var cdCount = (!isAI&&lobbyId) ? 3 : 0; // 3-2-1 for online
  var cdTs = null;

  function rrect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
  }

  function draw(cdNum) {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#030310'; ctx.fillRect(0,0,W,H);
    ctx.setLineDash([8,10]); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='bold 36px sans-serif'; ctx.textAlign='center';
    ctx.fillText(sc.l, W/4, 50); ctx.fillText(sc.r, 3*W/4, 50);
    ctx.font='11px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.fillText(isHost?'← Du':'← Gegner', W/4, 65);
    ctx.fillText(isHost?'Gegner →':'Du →', 3*W/4, 65);
    ctx.fillStyle='#818cf8'; rrect(ctx,padL.x,padL.y,PW,PH,5); ctx.fill();
    ctx.fillStyle='#34d399'; rrect(ctx,padR.x,padR.y,PW,PH,5); ctx.fill();
    ctx.beginPath(); ctx.arc(ball.x,ball.y,BR,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=20;
    ctx.fill(); ctx.shadowBlur=0;
    // Countdown overlay
    if (cdNum > 0) {
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff'; ctx.font='bold 80px sans-serif'; ctx.textAlign='center';
      ctx.shadowColor='#ff5733'; ctx.shadowBlur=30;
      ctx.fillText(cdNum, W/2, H/2+28);
      ctx.shadowBlur=0;
      ctx.font='14px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.5)';
      ctx.fillText('Spiel startet...', W/2, H/2+60);
    }
  }

  function reset(dir) {
    ball.x=W/2; ball.y=H/2+(Math.random()-0.5)*100;
    ball.vx=dir*(baseSpeed*0.9+Math.random()*baseSpeed*0.2);
    ball.vy=(Math.random()-0.5)*baseSpeed*1.2;
  }

  function physics(dt) {
    ball.x+=ball.vx*dt; ball.y+=ball.vy*dt;
    if(ball.y-BR<=0){ball.y=BR;ball.vy=Math.abs(ball.vy);}
    if(ball.y+BR>=H){ball.y=H-BR;ball.vy=-Math.abs(ball.vy);}
    var maxSpd=baseSpeed*2.5;
    // Left paddle
    if(ball.vx<0&&ball.x-BR<=padL.x+PW&&ball.x-BR>=padL.x&&ball.y>=padL.y&&ball.y<=padL.y+PH){
      ball.x=padL.x+PW+BR; ball.vx=Math.min(Math.abs(ball.vx)*1.05,maxSpd);
      ball.vy+=(ball.y-(padL.y+PH/2))*0.12;
    }
    // Right paddle
    if(ball.vx>0&&ball.x+BR>=padR.x&&ball.x+BR<=padR.x+PW&&ball.y>=padR.y&&ball.y<=padR.y+PH){
      ball.x=padR.x-BR; ball.vx=-Math.min(Math.abs(ball.vx)*1.05,maxSpd);
      ball.vy+=(ball.y-(padR.y+PH/2))*0.12;
    }
    if(ball.x-BR<=0){sc.r++; document.getElementById('pts').textContent=isHost?sc.l:sc.r; reset(1);}
    if(ball.x+BR>=W){sc.l++; document.getElementById('pts').textContent=isHost?sc.l:sc.r; reset(-1);}
  }

  function loop(ts) {
    if(!on)return;
    var dt = lastTs ? Math.min((ts - lastTs) / TARGET_DT, 2) : 1;
    lastTs = ts;

    // ── Countdown phase ──
    if (cdCount > 0) {
      if (!cdTs) cdTs = ts;
      var remaining = Math.ceil(3 - (ts - cdTs) / 1000);
      if (remaining <= 0) {
        cdCount = 0;
        // Host/AI: start with default speed. Guest: use server velocity if received, else default.
        if (isHost||isAI) {
          ball.vx = baseSpeed; ball.vy = baseSpeed*0.6;
        } else {
          ball.vx = (srvState&&srvState.bvx) ? srvState.bvx : baseSpeed;
          ball.vy = (srvState&&srvState.bvy) ? srvState.bvy : baseSpeed*0.6;
        }
        if (isHost && lobbyId) {
          var startMsg={type:'pong',started:true,bx:ball.x,by:ball.y,bvx:ball.vx,bvy:ball.vy,lpy:padL.y,sl:0,sr:0};
          sendGameWS(startMsg); // instant WS broadcast
          fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:startMsg})});
        }
      } else {
        draw(remaining); raf=requestAnimationFrame(loop); return;
      }
    }

    // ── HOST / AI physics ──
    if(isHost||isAI){
      physics(dt);
      if(isAI){
        var aiSpd=baseSpeed*0.65;
        var tgt=ball.y-PH/2;
        padR.y+=Math.sign(tgt-padR.y)*Math.min(aiSpd*dt,Math.abs(tgt-padR.y));
        padR.y=Math.max(0,Math.min(H-PH,padR.y));
      }
      if(!isAI&&lobbyId){
        var now=Date.now();
        if(now-lastPush>16){ // ~60fps push via WebSocket (near real-time)
          lastPush=now;
          var stateMsg={type:'pong',started:true,bx:Math.round(ball.x*10)/10,by:Math.round(ball.y*10)/10,bvx:Math.round(ball.vx*100)/100,bvy:Math.round(ball.vy*100)/100,lpy:Math.round(padL.y),rpy:Math.round(padR.y),sl:sc.l,sr:sc.r};
          // Primary: WebSocket (instant). Fallback: REST every 500ms for persistence.
          sendGameWS(stateMsg);
          if(now-lastPush>500){
            fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:stateMsg})
            });
          }
        }
      }
      if(sc.l>=MAX||sc.r>=MAX){
        var endState={type:'pong',bx:ball.x,by:ball.y,sl:sc.l,sr:sc.r,gameOver:true,started:true};
        sendGameWS(endState);
        fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:endState})});
        on=false;pongOn=false;
        if(pongPollInterval){clearInterval(pongPollInterval);pongPollInterval=null;}
        var win=(sc.l>=MAX&&isHost)||(sc.r>=MAX&&!isHost);
        if(raf)cancelAnimationFrame(raf);
        draw(0); setTimeout(function(){pongGameOver(win?'win':'lose');},400); return;
      }

    // ── GUEST: dead reckoning — process new WS state once, then local physics ──
    } else if(!isAI){
      // Only process srvState when a NEW message just arrived (not every frame!)
      if(srvState && srvStateNew){
        srvStateNew = false; // consume — don't re-process next frame
        if(srvState.sl!==undefined)sc.l=srvState.sl;
        if(srvState.sr!==undefined)sc.r=srvState.sr;
        if(srvState.lpy!==undefined)padL.y=srvState.lpy;
        document.getElementById('pts').textContent=sc.r;

        // (started check removed — guest uses local countdown, then plays regardless)

        if(srvState.bx!==undefined){
          var dx=srvState.bx-ball.x, dy=srvState.by-ball.y;
          if(Math.abs(dx)>90||Math.abs(dy)>90){
            // Large gap only: snap (score reset, game start, reconnect)
            ball.x=srvState.bx; ball.y=srvState.by;
          }
          // ALWAYS update velocity — critical for direction changes after paddle hits
          // Do NOT correct position for small diffs: server position is always behind
          // due to network latency. Correcting it causes the oscillation/loop bug.
          ball.vx=srvState.bvx||ball.vx;
          ball.vy=srvState.bvy||ball.vy;
        }
        if(sc.l>=MAX||sc.r>=MAX||srvState.gameOver){
          on=false;pongOn=false;
          if(pongPollInterval){clearInterval(pongPollInterval);pongPollInterval=null;}
          if(raf)cancelAnimationFrame(raf);
          draw(0); setTimeout(function(){pongGameOver(sc.r>=MAX?'win':'lose');},400); return;
        }
      }
      // Full local physics — client-side prediction (same as host)
      // WS syncs velocity after paddle bounces; local handles wall scoring
      ball.x+=ball.vx*dt; ball.y+=ball.vy*dt;
      // Top/bottom walls
      if(ball.y-BR<=0){ball.y=BR;ball.vy=Math.abs(ball.vy);}
      if(ball.y+BR>=H){ball.y=H-BR;ball.vy=-Math.abs(ball.vy);}
      // Right paddle (guest's own paddle)
      if(ball.vx>0&&ball.x+BR>=padR.x&&ball.x+BR<=padR.x+PW&&ball.y>=padR.y&&ball.y<=padR.y+PH){
        ball.x=padR.x-BR; ball.vx=-Math.min(Math.abs(ball.vx)*1.05,baseSpeed*2.5);
        ball.vy+=(ball.y-(padR.y+PH/2))*0.12;
      }
      // Left wall (guest didn't get ball back — local reset, server will confirm)
      if(ball.x-BR<=0){
        ball.x=W/2; ball.y=H/2+(Math.random()-0.5)*80;
        ball.vx=(baseSpeed*0.9+Math.random()*baseSpeed*0.2);
        ball.vy=(Math.random()-0.5)*baseSpeed;
      }
      // Right wall (ball passed guest's paddle — local reset)
      if(ball.x+BR>=W){
        ball.x=W/2; ball.y=H/2+(Math.random()-0.5)*80;
        ball.vx=-(baseSpeed*0.9+Math.random()*baseSpeed*0.2);
        ball.vy=(Math.random()-0.5)*baseSpeed;
      }
    }
    draw(0);
    raf=requestAnimationFrame(loop);
  }

  function movePad(e) {
    e.preventDefault();
    var rect=cv.getBoundingClientRect();
    var scaleY = H / rect.height;
    var cY=e.touches?e.touches[0].clientY:e.clientY;
    myPad.y=Math.max(0,Math.min(H-PH,(cY-rect.top)*scaleY-PH/2));
    if(!isAI&&!isHost&&lobbyId){
      // Send paddle position via WS (instant) + occasional REST for persistence
      sendGameWS({type:'pong_paddle',rpy:Math.round(padR.y)});
    }
  }

  cv.addEventListener('mousemove',movePad);
  cv.addEventListener('touchmove',movePad,{passive:false});
  raf=requestAnimationFrame(loop);

  return {
    stop:function(){on=false;if(raf)cancelAnimationFrame(raf);cv.removeEventListener('mousemove',movePad);cv.removeEventListener('touchmove',movePad);},
    applyState:function(state){
      if(!state)return;
      if(isHost&&state.type==='pong_paddle'){padR.y=state.rpy;return;}
      if(isHost)return;
      srvState=state;
      srvStateNew=true; // mark as fresh so the game loop processes it exactly once
      if(state.rpy!==undefined)padR.y=state.rpy;
    }
  };
}

function pongGameOver(result) {
  var overlay=document.getElementById('ttt-overlay');
  var msg=document.getElementById('ttt-overlay-msg');
  if(result==='win'){msg.innerHTML='🏆<br>Du hast gewonnen!<br><small style="font-size:0.6em;opacity:0.7">Pong</small>';sounds.highscore();}
  else{msg.innerHTML='😔<br>Du hast verloren.<br><small style="font-size:0.6em;opacity:0.7">Pong</small>';}
  overlay.classList.add('show');
}

/* ---- SCHERE STEIN PAPIER ---- */
async function loadRpsLobbyScreen() {
  document.getElementById('rps-lobby-screen').style.display='block';
  document.getElementById('rps-game-screen').style.display='none';
  try {
    var res=await fetch(API_URL+'/api/users/search?me='+user.id);
    var users=await res.json();
    var online=(users||[]).filter(function(u){return isRecentlyActive(u)&&u.id!==user.id;});
    document.getElementById('rps-online-num').textContent=online.length;
    var container=document.getElementById('rps-users-list');
    if(!online.length){container.innerHTML='<div class="lobby-empty">Keine Freunde online</div>';return;}
    var html='';
    online.forEach(function(u){
      var seed=u.avatar_seed||u.name||'unknown';
      var av='https://api.dicebear.com/7.x/adventurer/svg?seed='+encodeURIComponent(seed);
      html+='<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="rps">Einladen</button></div>';
    });
    container.innerHTML=html;
    container.querySelectorAll('.btn-invite').forEach(function(btn){
      btn.addEventListener('click',function(){sendGameInvite(parseInt(this.dataset.id),this,this.dataset.game||'rps');});
    });
  }catch(e){}
}

function rpsStart(diff) {
  rpsIsAI=true; rpsAiDiff=diff||rpsAiDiff; rpsIsHost=true; rpsOn=true;
  rpsStartGame(true, rpsAiDiff, null, true, rpsMaxRounds||3);
}

function rpsStartOnline(lobbyId, isHost) {
  rpsLobbyId=lobbyId; rpsIsHost=isHost; rpsIsAI=false; rpsOn=true;
  var maxR = rpsMaxRounds || 3;
  rpsStartGame(false, null, lobbyId, isHost, maxR);
  if(rpsPollInterval)clearInterval(rpsPollInterval);
  rpsPollInterval=setInterval(rpsPollOnline, 500);
  // Host broadcasts maxRounds so joiner knows
  if(isHost) {
    fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:{maxRounds:maxR,round:1,hostChoice:null,guestChoice:null}})});
  }
}

function rpsStartGame(isAI, diff, lobbyId, isHost, maxRounds) {
  document.getElementById('rps-lobby-screen').style.display='none';
  var gs=document.getElementById('rps-game-screen');
  gs.style.display='block';
  document.getElementById('rps-round-info').textContent='Runde 1';
  document.getElementById('rps-my-score').textContent='0';
  document.getElementById('rps-opp-score').textContent='0';
  document.getElementById('rps-overlay').style.display='none';
  document.getElementById('rps-choices').style.display='flex';
  document.getElementById('rps-countdown').style.display = 'none';
  document.getElementById('rps-battle-arena').style.display = 'none';
  document.getElementById('rps-round-result').style.display = 'none';
  document.getElementById('rps-waiting').style.display = 'none';

  var MAX = maxRounds || 3;  // wins needed: 3=best of ?, 5=first to 5, 10=first to 10... actually MAX=wins to win
  // For "Best of 3": first to 2 wins. "Best of 5": first to 3. "First to 10": first to 10.
  var winsNeeded = MAX === 3 ? 2 : MAX === 5 ? 3 : MAX;
  var mySc=0, oppSc=0, round=1;
  var myChoice=null, roundActive=true, gameOn=true;
  var resolving=false; // THE KEY FLAG — prevents multiple resolve() calls per round

  var handIcons={rock:'✊', paper:'🖐️', scissors:'✌️'};
  function beats(a,b){return(a==='rock'&&b==='scissors')||(a==='paper'&&b==='rock')||(a==='scissors'&&b==='paper');}

  // Replace buttons to clear old event listeners
  var choicesEl = document.getElementById('rps-choices');
  choicesEl.querySelectorAll('.rps-btn').forEach(function(btn) {
    var fresh = btn.cloneNode(true); btn.parentNode.replaceChild(fresh, btn);
  });
  var btns = choicesEl.querySelectorAll('.rps-btn');
  btns.forEach(function(b){b.disabled=false;b.classList.remove('chosen');});

  // Update round label
  function updateRoundLabel() {
    var label = 'Runde ' + round;
    if (MAX >= 5) label += '  (Ziel: ' + winsNeeded + ' Siege)';
    document.getElementById('rps-round-info').textContent = label;
  }
  updateRoundLabel();

  function showBattle(mine, opp) {
    var arena = document.getElementById('rps-battle-arena');
    var rrEl  = document.getElementById('rps-round-result');
    var oppLbl = document.getElementById('rps-opp-label');
    if (oppLbl) oppLbl.textContent = isAI ? 'KI' : 'Gegner';

    // Restart fly-in animation by replacing nodes
    var mine2 = document.getElementById('rps-mine-side');
    var opp2  = document.getElementById('rps-opp-side');
    if (mine2) { var m2=mine2.cloneNode(true); mine2.parentNode.replaceChild(m2,mine2); }
    if (opp2)  { var o2=opp2.cloneNode(true);  opp2.parentNode.replaceChild(o2,opp2); }
    var mineIconEl = document.getElementById('rps-mine-icon');
    var oppIconEl  = document.getElementById('rps-opp-icon');
    if (mineIconEl) mineIconEl.textContent = handIcons[mine] || mine;
    if (oppIconEl)  oppIconEl.textContent  = handIcons[opp]  || opp;
    if (arena) arena.style.display = 'flex';

    var txt, col;
    if (mine === opp) {
      txt = '🤝 Unentschieden!'; col = 'var(--dim)';
      if (mineIconEl) mineIconEl.classList.add('draw');
      if (oppIconEl)  oppIconEl.classList.add('draw');
    } else if (beats(mine, opp)) {
      txt = '✅ Runde gewonnen!'; col = '#22c55e'; mySc++;
      setTimeout(function(){if(mineIconEl)mineIconEl.classList.add('winner');if(oppIconEl)oppIconEl.classList.add('loser');},300);
    } else {
      txt = '❌ Runde verloren!'; col = '#ef4444'; oppSc++;
      setTimeout(function(){if(oppIconEl)oppIconEl.classList.add('winner');if(mineIconEl)mineIconEl.classList.add('loser');},300);
    }
    document.getElementById('rps-my-score').textContent  = mySc;
    document.getElementById('rps-opp-score').textContent = oppSc;
    if (rrEl) { rrEl.textContent = txt; rrEl.style.color = col; rrEl.style.display = 'block'; }

    if (mySc >= winsNeeded || oppSc >= winsNeeded) {
      rpsOn = false;
      if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
      setTimeout(function() { rpsGameOver(mySc >= winsNeeded ? 'win' : 'lose'); }, 1400);
    } else {
      round++;
      setTimeout(function() {
        if (!gameOn) return;
        updateRoundLabel();
        if (arena) arena.style.display = 'none';
        if (rrEl) rrEl.style.display = 'none';
        // Reset for next round
        myChoice = null; roundActive = true; resolving = false;
        btns.forEach(function(b) { b.disabled = false; b.classList.remove('chosen'); });
        document.getElementById('rps-choices').style.display = 'flex';
        document.getElementById('rps-waiting').style.display = 'none';
        // Clear both server choices so next round starts clean
        if (!isAI && lobbyId) {
          fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:{round:round,hostChoice:null,guestChoice:null}})});
        }
      }, 1800);
    }
  }

  function runCountdown(onDone) {
    var cd   = document.getElementById('rps-countdown');
    var hand = document.getElementById('rps-pump-hand');
    var word = document.getElementById('rps-pump-word');
    if (cd) cd.style.display = 'flex';
    var words = ['Schere','Stein','Papier!'];
    var idx = 0;
    function doPump() {
      if (!gameOn) { if(cd)cd.style.display='none'; return; }
      if (idx >= 3) { if(cd)cd.style.display='none'; onDone(); return; }
      if (word) word.textContent = words[idx];
      if (hand) { hand.classList.remove('pumping'); void hand.offsetWidth; hand.classList.add('pumping'); }
      idx++;
      setTimeout(doPump, 430);
    }
    doPump();
  }

  function resolve(mine, opp) {
    if (resolving) return; // ← THE KEY FIX: only resolve once per round
    resolving = true;
    roundActive = false;
    btns.forEach(function(b) { b.disabled = true; });
    document.getElementById('rps-choices').style.display = 'none';
    document.getElementById('rps-waiting').style.display = 'none';
    runCountdown(function() {
      showBattle(mine, opp);
    });
  }

  function pick(choice) {
    if (!roundActive || myChoice || resolving) return;
    myChoice = choice;
    btns.forEach(function(b) { b.classList.toggle('chosen', b.dataset.choice === choice); });
    if (isAI) {
      var aiC = ['rock','paper','scissors'];
      var wins = {rock:'paper',paper:'scissors',scissors:'rock'};
      var opp = diff==='easy' ? aiC[Math.floor(Math.random()*3)]
        : diff==='medium' ? (Math.random()<0.20 ? wins[choice] : aiC[Math.floor(Math.random()*3)])
        : (Math.random()<0.35 ? wins[choice] : aiC[Math.floor(Math.random()*3)]);
      resolve(choice, opp);
    } else {
      document.getElementById('rps-waiting').style.display = 'block';
      btns.forEach(function(b){ if(b.dataset.choice!==choice)b.disabled=true; });
      var patch = {}; patch[isHost?'hostChoice':'guestChoice'] = choice;
      fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:patch})});
    }
  }

  btns.forEach(function(btn){ btn.addEventListener('click',function(){ pick(this.dataset.choice); }); });

  function checkServerState(state) {
    if (!state || resolving || !roundActive || !myChoice) return;
    // Sync maxRounds from server (joiner reads host's selection)
    if (!isHost && state.maxRounds && state.maxRounds !== MAX) {
      MAX = state.maxRounds;
      winsNeeded = MAX===3 ? 2 : MAX===5 ? 3 : MAX;
    }
    // Reject stale state from a different round
    if (state.round !== undefined && state.round !== round) return;
    var oppKey = isHost ? 'guestChoice' : 'hostChoice';
    var myKey  = isHost ? 'hostChoice'  : 'guestChoice';
    var oppChoice    = state[oppKey];
    var myServChoice = state[myKey];
    // Both must be present, and server must confirm my choice
    if (oppChoice && myServChoice && myServChoice === myChoice) {
      resolve(myChoice, oppChoice);
    }
  }

  game = { stop: function(){ gameOn=false; roundActive=false; resolving=true; }, applyState: checkServerState };
}

async function rpsPollOnline() {
  if(!rpsOn||!rpsLobbyId)return;
  try{
    var res=await fetch(API_URL+'/api/lobby/'+rpsLobbyId);
    if(!res.ok)return;
    var lobby=await res.json();
    if(game&&game.applyState)game.applyState(lobby.game_state);
  }catch(e){}
}

function rpsGameOver(result) {
  var overlay=document.getElementById('ttt-overlay');
  var msg=document.getElementById('ttt-overlay-msg');
  if(result==='win'){msg.innerHTML='🏆<br>Du hast gewonnen!<br><small style="font-size:0.6em;opacity:0.7">Schere Stein Papier</small>';sounds.highscore();}
  else{msg.innerHTML='😔<br>Du hast verloren.<br><small style="font-size:0.6em;opacity:0.7">Schere Stein Papier</small>';}
  overlay.classList.add('show');
}

/* ================================================================
   CHESS ENGINE + UI
   ================================================================ */

var CHESS_INIT = [
  'bR','bN','bB','bQ','bK','bB','bN','bR',
  'bP','bP','bP','bP','bP','bP','bP','bP',
  '','','','','','','','',
  '','','','','','','','',
  '','','','','','','','',
  '','','','','','','','',
  'wP','wP','wP','wP','wP','wP','wP','wP',
  'wR','wN','wB','wQ','wK','wB','wN','wR'
];

var CHESS_SYM = {
  wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
};

var CHESS_VAL = {P:100,N:320,B:330,R:500,Q:900,K:20000};

var CHESS_PST = {
  P:[  0, 0, 0, 0, 0, 0, 0, 0,
      50,50,50,50,50,50,50,50,
      10,10,20,30,30,20,10,10,
       5, 5,10,25,25,10, 5, 5,
       0, 0, 0,20,20, 0, 0, 0,
       5,-5,-10,0,0,-10,-5, 5,
       5,10,10,-20,-20,10,10, 5,
       0, 0, 0, 0, 0, 0, 0, 0],
  N:[-50,-40,-30,-30,-30,-30,-40,-50,
     -40,-20,  0,  0,  0,  0,-20,-40,
     -30,  0, 10, 15, 15, 10,  0,-30,
     -30,  5, 15, 20, 20, 15,  5,-30,
     -30,  0, 15, 20, 20, 15,  0,-30,
     -30,  5, 10, 15, 15, 10,  5,-30,
     -40,-20,  0,  5,  5,  0,-20,-40,
     -50,-40,-30,-30,-30,-30,-40,-50],
  B:[-20,-10,-10,-10,-10,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5, 10, 10,  5,  0,-10,
     -10,  5,  5, 10, 10,  5,  5,-10,
     -10,  0, 10, 10, 10, 10,  0,-10,
     -10, 10, 10, 10, 10, 10, 10,-10,
     -10,  5,  0,  0,  0,  0,  5,-10,
     -20,-10,-10,-10,-10,-10,-10,-20],
  R:[  0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0],
  Q:[-20,-10,-10, -5, -5,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5,  5,  5,  5,  0,-10,
      -5,  0,  5,  5,  5,  5,  0, -5,
       0,  0,  5,  5,  5,  5,  0, -5,
     -10,  5,  5,  5,  5,  5,  0,-10,
     -10,  0,  5,  0,  0,  0,  0,-10,
     -20,-10,-10, -5, -5,-10,-10,-20],
  K:[-30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -20,-30,-30,-40,-40,-30,-30,-20,
     -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,
      20, 30, 10,  0,  0, 10, 30, 20]
};

function cR(sq){return sq>>3;}
function cC(sq){return sq&7;}
function cSq(r,c){return r*8+c;}
function cClr(p){return p?p[0]:null;}
function cTyp(p){return p?p[1]:null;}

function chessInitState(){
  return{board:CHESS_INIT.slice(),turn:'w',castling:{wK:true,wQ:true,bK:true,bQ:true},enPassant:-1};
}

function chessIsAttacked(board,sq,byColor){
  var r=cR(sq),c=cC(sq),i,nr,nc,p;
  // Pawns
  if(byColor==='w'){
    if(r+1<8){if(c-1>=0&&board[cSq(r+1,c-1)]==='wP')return true;if(c+1<8&&board[cSq(r+1,c+1)]==='wP')return true;}
  }else{
    if(r-1>=0){if(c-1>=0&&board[cSq(r-1,c-1)]==='bP')return true;if(c+1<8&&board[cSq(r-1,c+1)]==='bP')return true;}
  }
  // Knights
  var km=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for(i=0;i<8;i++){nr=r+km[i][0];nc=c+km[i][1];if(nr>=0&&nr<8&&nc>=0&&nc<8){p=board[cSq(nr,nc)];if(p&&cClr(p)===byColor&&cTyp(p)==='N')return true;}}
  // King
  var kd=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for(i=0;i<8;i++){nr=r+kd[i][0];nc=c+kd[i][1];if(nr>=0&&nr<8&&nc>=0&&nc<8){p=board[cSq(nr,nc)];if(p&&cClr(p)===byColor&&cTyp(p)==='K')return true;}}
  // Rook/Queen rays
  var straight=[[0,1],[0,-1],[1,0],[-1,0]];
  for(i=0;i<4;i++){nr=r+straight[i][0];nc=c+straight[i][1];while(nr>=0&&nr<8&&nc>=0&&nc<8){p=board[cSq(nr,nc)];if(p){if(cClr(p)===byColor&&(cTyp(p)==='R'||cTyp(p)==='Q'))return true;break;}nr+=straight[i][0];nc+=straight[i][1];}}
  // Bishop/Queen diagonals
  var diag=[[-1,-1],[-1,1],[1,-1],[1,1]];
  for(i=0;i<4;i++){nr=r+diag[i][0];nc=c+diag[i][1];while(nr>=0&&nr<8&&nc>=0&&nc<8){p=board[cSq(nr,nc)];if(p){if(cClr(p)===byColor&&(cTyp(p)==='B'||cTyp(p)==='Q'))return true;break;}nr+=diag[i][0];nc+=diag[i][1];}}
  return false;
}

function chessPseudoMoves(state,sq){
  var board=state.board,ep=state.enPassant,p=board[sq];
  if(!p)return[];
  var clr=cClr(p),typ=cTyp(p),r=cR(sq),c=cC(sq),moves=[],i,nr,nc,to;
  function add(t){if(t<0||t>63)return;var tgt=board[t];if(!tgt||cClr(tgt)!==clr)moves.push(t);}
  if(typ==='P'){
    var dir=clr==='w'?-1:1,start=clr==='w'?6:1;
    nr=r+dir;
    if(nr>=0&&nr<8&&!board[cSq(nr,c)]){moves.push(cSq(nr,c));if(r===start&&!board[cSq(r+2*dir,c)])moves.push(cSq(r+2*dir,c));}
    var capCols=[c-1,c+1];
    for(i=0;i<2;i++){nc=capCols[i];if(nc>=0&&nc<8&&nr>=0&&nr<8){var cs=cSq(nr,nc);var tgt=board[cs];if(tgt&&cClr(tgt)!==clr)moves.push(cs);if(cs===ep)moves.push(cs);}}
    return moves;
  }
  if(typ==='N'){var nm=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];for(i=0;i<8;i++){nr=r+nm[i][0];nc=c+nm[i][1];if(nr>=0&&nr<8&&nc>=0&&nc<8)add(cSq(nr,nc));}return moves;}
  if(typ==='K'){
    var kd=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for(i=0;i<8;i++){nr=r+kd[i][0];nc=c+kd[i][1];if(nr>=0&&nr<8&&nc>=0&&nc<8)add(cSq(nr,nc));}
    var cast=state.castling;
    if(clr==='w'&&sq===60){if(cast.wK&&!board[61]&&!board[62])moves.push(62);if(cast.wQ&&!board[59]&&!board[58]&&!board[57])moves.push(58);}
    if(clr==='b'&&sq===4){if(cast.bK&&!board[5]&&!board[6])moves.push(6);if(cast.bQ&&!board[3]&&!board[2]&&!board[1])moves.push(2);}
    return moves;
  }
  var dirs=[];
  if(typ==='R'||typ==='Q')dirs=dirs.concat([[0,1],[0,-1],[1,0],[-1,0]]);
  if(typ==='B'||typ==='Q')dirs=dirs.concat([[-1,-1],[-1,1],[1,-1],[1,1]]);
  for(i=0;i<dirs.length;i++){nr=r+dirs[i][0];nc=c+dirs[i][1];while(nr>=0&&nr<8&&nc>=0&&nc<8){to=cSq(nr,nc);var tgt=board[to];if(tgt){if(cClr(tgt)!==clr)moves.push(to);break;}moves.push(to);nr+=dirs[i][0];nc+=dirs[i][1];}}
  return moves;
}

function chessApplyMove(state,from,to,promo){
  var board=state.board.slice();
  var cast={wK:state.castling.wK,wQ:state.castling.wQ,bK:state.castling.bK,bQ:state.castling.bQ};
  var p=board[from],clr=cClr(p),typ=cTyp(p),newEP=-1;
  // En passant capture
  if(typ==='P'&&to===state.enPassant){board[cSq(cR(from),cC(to))]=''; }
  // Double push → set ep target
  if(typ==='P'&&Math.abs(cR(to)-cR(from))===2){newEP=cSq((cR(from)+cR(to))>>1,cC(from));}
  // Castling: move rook
  if(typ==='K'){
    if(from===60&&to===62){board[63]='';board[61]='wR';}
    if(from===60&&to===58){board[56]='';board[59]='wR';}
    if(from===4&&to===6){board[7]='';board[5]='bR';}
    if(from===4&&to===2){board[0]='';board[3]='bR';}
    if(clr==='w'){cast.wK=false;cast.wQ=false;}else{cast.bK=false;cast.bQ=false;}
  }
  // Update castling on rook move/capture
  if(from===56||to===56)cast.wQ=false;if(from===63||to===63)cast.wK=false;
  if(from===0 ||to===0 )cast.bQ=false;if(from===7 ||to===7 )cast.bK=false;
  // Promotion
  var piece=p;
  if(typ==='P'&&(cR(to)===0||cR(to)===7))piece=clr+(promo||'Q');
  board[to]=piece;board[from]='';
  return{board:board,turn:clr==='w'?'b':'w',castling:cast,enPassant:newEP};
}

function chessFindKing(board,color){for(var i=0;i<64;i++){if(board[i]===color+'K')return i;}return -1;}

function chessIsCheck(state,color){
  var kSq=chessFindKing(state.board,color);
  if(kSq<0)return true;
  return chessIsAttacked(state.board,kSq,color==='w'?'b':'w');
}

function chessLegalMoves(state,sq){
  var p=state.board[sq];if(!p)return[];
  var clr=cClr(p),typ=cTyp(p);
  if(clr!==state.turn)return[];
  var pseudo=chessPseudoMoves(state,sq),legal=[],opp=clr==='w'?'b':'w';
  for(var i=0;i<pseudo.length;i++){
    var to=pseudo[i];
    if(typ==='K'&&Math.abs(to-sq)===2){
      if(chessIsAttacked(state.board,sq,opp))continue;
      if(chessIsAttacked(state.board,(sq+to)>>1,opp))continue;
    }
    var ns=chessApplyMove(state,sq,to);
    if(!chessIsCheck(ns,clr))legal.push(to);
  }
  return legal;
}

function chessAllLegalMoves(state,color){
  var all=[];
  for(var sq=0;sq<64;sq++){var p=state.board[sq];if(p&&cClr(p)===color){var ms=chessLegalMoves(state,sq);for(var i=0;i<ms.length;i++)all.push({from:sq,to:ms[i]});}}
  return all;
}

function chessEval(state){
  var score=0;
  for(var sq=0;sq<64;sq++){
    var p=state.board[sq];if(!p)continue;
    var clr=cClr(p),typ=cTyp(p),val=CHESS_VAL[typ]||0;
    var pstIdx=clr==='w'?sq:(56-(sq&~7))+(sq&7);
    score+=(clr==='w'?1:-1)*(val+((CHESS_PST[typ]||[])[pstIdx]||0));
  }
  return score;
}

function chessMinimax(state,depth,alpha,beta,isMax){
  if(depth===0)return chessEval(state);
  var color=isMax?'w':'b',moves=chessAllLegalMoves(state,color);
  if(!moves.length)return chessIsCheck(state,color)?(isMax?-99999+depth:99999-depth):0;
  if(isMax){
    var best=-Infinity;
    for(var i=0;i<moves.length;i++){var v=chessMinimax(chessApplyMove(state,moves[i].from,moves[i].to),depth-1,alpha,beta,false);if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break;}
    return best;
  }else{
    var best=Infinity;
    for(var i=0;i<moves.length;i++){var v=chessMinimax(chessApplyMove(state,moves[i].from,moves[i].to),depth-1,alpha,beta,true);if(v<best)best=v;if(v<beta)beta=v;if(alpha>=beta)break;}
    return best;
  }
}

function chessBestMove(state,diff){
  var moves=chessAllLegalMoves(state,state.turn);
  if(!moves.length)return null;
  if(diff==='easy')return moves[Math.floor(Math.random()*moves.length)];
  var depth=diff==='hard'?3:2,isMax=state.turn==='w',best=isMax?-Infinity:Infinity,bestMove=moves[0];
  // Shuffle for variety at equal scores
  moves=moves.slice().sort(function(){return Math.random()-0.5;});
  for(var i=0;i<moves.length;i++){
    var v=chessMinimax(chessApplyMove(state,moves[i].from,moves[i].to),depth-1,-Infinity,Infinity,!isMax);
    if(isMax?v>best:v<best){best=v;bestMove=moves[i];}
  }
  return bestMove;
}

/* ---- Chess UI ---- */

function buildChessBoard(){
  var board=document.getElementById('chess-board');
  board.innerHTML='';
  // Apply/remove flip for black player — shows own pieces at bottom
  var wrap=document.querySelector('.chess-board-wrap');
  if(wrap) wrap.classList.toggle('flipped', chessMyColor==='b');
  for(var i=0;i<64;i++){
    var sq=document.createElement('div');
    var r=i>>3,c=i&7;
    sq.className='csq '+((r+c)%2===0?'light':'dark');
    sq.dataset.sq=i;
    (function(idx){sq.addEventListener('click',function(){onChessSquareClick(idx);});})(i);
    board.appendChild(sq);
  }
}

function renderChessBoard(){
  if(!chessState)return;
  var board=document.getElementById('chess-board');
  if(!board)return;
  var squares=board.querySelectorAll('.csq');
  var inCheck=chessIsCheck(chessState,chessState.turn);
  var kingCheck=inCheck?chessFindKing(chessState.board,chessState.turn):-1;
  squares.forEach(function(sq){
    var idx=parseInt(sq.dataset.sq),r=idx>>3,c=idx&7,isLight=(r+c)%2===0;
    sq.className='csq '+(isLight?'light':'dark');
    if(idx===chessSelected)sq.classList.add('selected');
    if(chessValidMoves.indexOf(idx)>=0){sq.classList.add(chessState.board[idx]?'valid-capture':'valid-target');}
    if(idx===chessLastMoveFrom||idx===chessLastMoveTo)sq.classList.add('last-move');
    if(idx===kingCheck)sq.classList.add('check-king');
    var p=chessState.board[idx];
    sq.innerHTML=p?'<span class="chess-piece '+(cClr(p)==='w'?'white':'black')+'">'+CHESS_SYM[p]+'</span>':'';
  });
  var myTurn=chessState.turn===chessMyColor,statusEl=document.getElementById('chess-status');
  if(statusEl){
    if(myTurn)statusEl.textContent=inCheck?'⚠️ Schach! Du bist am Zug':'Du bist am Zug ✔';
    else statusEl.textContent=inCheck?'⚠️ Schach! Gegner ist am Zug':'Gegner ist am Zug...';
  }
}

function onChessSquareClick(sq){
  if(!chessOn||!chessState||chessState.turn!==chessMyColor)return;
  var p=chessState.board[sq];
  if(chessSelected>=0&&chessValidMoves.indexOf(sq)>=0){chessDoMove(chessSelected,sq);return;}
  if(p&&cClr(p)===chessMyColor){chessSelected=sq;chessValidMoves=chessLegalMoves(chessState,sq);renderChessBoard();return;}
  chessSelected=-1;chessValidMoves=[];renderChessBoard();
}

function chessDoMove(from,to){
  chessLastMoveFrom=from;chessLastMoveTo=to;
  chessState=chessApplyMove(chessState,from,to);
  chessSelected=-1;chessValidMoves=[];
  if(!chessIsAI&&chessLobbyId){
    chessMoveInFlight=true;
    // Primary: WebSocket (instant relay to opponent, <10ms)
    sendGameWS({type:'chess', chessState:chessState, lastFrom:from, lastTo:to});
    // Persistence: REST to Supabase (for reconnect recovery)
    fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lobby_id:chessLobbyId,user_id:user.id,patch:{chessState:chessState,lastFrom:from,lastTo:to}})
    }).finally(function(){
      setTimeout(function(){ chessMoveInFlight=false; }, 300);
    });
  }
  renderChessBoard();
  var opp=chessState.turn,oppMoves=chessAllLegalMoves(chessState,opp);
  if(!oppMoves.length){
    setTimeout(function(){chessGameOver(chessIsCheck(chessState,opp)?(opp===chessMyColor?'lose':'win'):'draw');},400);
    return;
  }
  if(chessIsAI&&chessState.turn!==chessMyColor)setTimeout(chessAiMove,500);
}

function chessAiMove(){
  if(!chessOn||!chessState)return;
  var mv=chessBestMove(chessState,chessAiDiff);
  if(!mv)return;
  chessLastMoveFrom=mv.from;chessLastMoveTo=mv.to;
  chessState=chessApplyMove(chessState,mv.from,mv.to);
  renderChessBoard();
  var opp=chessState.turn,oppMoves=chessAllLegalMoves(chessState,opp);
  if(!oppMoves.length){
    setTimeout(function(){chessGameOver(chessIsCheck(chessState,opp)?(opp===chessMyColor?'lose':'win'):'draw');},300);
  }
}

function chessGameOver(result){
  chessOn=false;
  if(chessPollInterval){clearInterval(chessPollInterval);chessPollInterval=null;}
  var overlay=document.getElementById('ttt-overlay'),msg=document.getElementById('ttt-overlay-msg');
  if(result==='win'){
    msg.innerHTML='🏆<br>Du hast gewonnen!<br><small style="font-size:0.6em;opacity:0.7">Schach</small>';
    sounds.highscore();
    if(chessIsAI)saveHS('chess',chessAiDiff==='hard'?40:chessAiDiff==='medium'?25:15);
  }else if(result==='lose'){
    msg.innerHTML='😔<br>Du hast verloren.<br><small style="font-size:0.6em;opacity:0.7">Schach</small>';
  }else{
    msg.innerHTML='🤝<br>Unentschieden!<br><small style="font-size:0.6em;opacity:0.7">Schach</small>';
  }
  overlay.classList.add('show');
}

async function loadChessLobbyScreen(){
  var ls=document.getElementById('chess-lobby-screen'),gs=document.getElementById('chess-game-screen');
  if(ls)ls.style.display='block';if(gs)gs.style.display='none';
  try{
    var res=await fetch(API_URL+'/api/users/search?me='+user.id);
    var users=await res.json();
    var online=(users||[]).filter(function(u){return isRecentlyActive(u)&&u.id!==user.id;});
    document.getElementById('chess-online-num').textContent=online.length;
    var container=document.getElementById('chess-users-list');
    if(!online.length){container.innerHTML='<div class="lobby-empty">Keine Freunde online</div>';return;}
    var html='';
    online.forEach(function(u){
      var seed=u.avatar_seed||u.name||'unknown';
      var av='https://api.dicebear.com/7.x/adventurer/svg?seed='+encodeURIComponent(seed);
      html+='<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="chess">Einladen</button></div>';
    });
    container.innerHTML=html;
    container.querySelectorAll('.btn-invite').forEach(function(btn){
      btn.addEventListener('click',function(){sendGameInvite(parseInt(this.dataset.id),this,'chess');});
    });
  }catch(e){}
}

function chessStart(diff){
  chessIsAI=true;chessAiDiff=diff||chessAiDiff;chessIsHost=true;chessOn=true;chessMyColor='w';
  document.getElementById('chess-lobby-screen').style.display='none';
  document.getElementById('chess-game-screen').style.display='flex';
  document.getElementById('ttt-overlay').classList.remove('show');
  chessState=chessInitState();chessSelected=-1;chessValidMoves=[];chessLastMoveFrom=-1;chessLastMoveTo=-1;
  buildChessBoard();renderChessBoard();
  var diff2=chessAiDiff==='easy'?'Leicht':chessAiDiff==='medium'?'Mittel':'Schwer';
  document.getElementById('chess-player-info').innerHTML=
    '<span class="chess-you">♔ Du (Weiß)</span><span class="chess-vs"> vs </span><span class="chess-opp">♚ KI – '+diff2+'</span>';
  document.getElementById('btn-again').style.display='none';
}

function chessStartOnline(lobbyId,isHost){
  chessLobbyId=lobbyId;chessIsHost=isHost;chessIsAI=false;chessOn=true;chessMyColor=isHost?'w':'b';chessMoveInFlight=false;
  document.getElementById('chess-lobby-screen').style.display='none';
  document.getElementById('chess-game-screen').style.display='flex';
  document.getElementById('ttt-overlay').classList.remove('show');
  // Both players initialize with the standard start position — chess always starts the same
  chessState=chessInitState();chessSelected=-1;chessValidMoves=[];chessLastMoveFrom=-1;chessLastMoveTo=-1;
  buildChessBoard();renderChessBoard();
  document.getElementById('chess-player-info').innerHTML=
    '<span class="chess-you">'+(isHost?'♔ Du (Weiß)':'♚ Du (Schwarz)')+'</span>';
  document.getElementById('btn-again').style.display='none';
  // WebSocket for instant move sync
  connectGameWS(lobbyId, function(data) {
    if (data.type==='chess') chessApplyWSState(data);
  });
  // Poll as fallback/reconnect (infrequent)
  if(chessPollInterval)clearInterval(chessPollInterval);
  chessPollInterval=setInterval(chessPollOnline,3000);
}

// Apply chess state received via WebSocket (instant, no Supabase delay)
function chessApplyWSState(data) {
  if (!chessOn || !data.chessState) return;
  if (data.chessState.turn === chessMyColor && chessMoveInFlight) return;
  var localIsMyTurn = chessState && chessState.turn === chessMyColor;
  var serverIsMyTurn = data.chessState.turn === chessMyColor;
  // Only apply opponent's moves (when it becomes my turn)
  if (!localIsMyTurn && serverIsMyTurn) {
    chessState = data.chessState;
    if (data.lastFrom !== undefined) chessLastMoveFrom = data.lastFrom;
    if (data.lastTo !== undefined) chessLastMoveTo = data.lastTo;
    chessSelected = -1; chessValidMoves = [];
    buildChessBoard(); renderChessBoard();
    var opp = chessState.turn, oppMoves = chessAllLegalMoves(chessState, opp);
    if (!oppMoves.length) {
      setTimeout(function(){ chessGameOver(chessIsCheck(chessState,opp)?(opp===chessMyColor?'lose':'win'):'draw'); }, 400);
    }
  }
}

async function chessPollOnline(){
  if(!chessOn||!chessLobbyId)return;
  if(chessMoveInFlight)return; // our move is still being sent — don't overwrite local state
  try{
    var res=await fetch(API_URL+'/api/lobby/'+chessLobbyId);
    if(!res.ok)return;
    var lobby=await res.json();
    var st=lobby.game_state;
    if(!st||!st.chessState)return;
    // Only update when the server state differs AND it is now my turn (opponent just moved)
    // Never overwrite when it's my turn locally — I may have already moved but server hasn't saved yet
    var localIsMyTurn = chessState && chessState.turn === chessMyColor;
    var serverIsMyTurn = st.chessState.turn === chessMyColor;
    var statesDiffer = !chessState || JSON.stringify(chessState) !== JSON.stringify(st.chessState);
    // Apply only when: no local state, OR (waiting for opponent AND server now has my turn)
    if(!chessState || (!localIsMyTurn && serverIsMyTurn && statesDiffer)){
      chessState=st.chessState;
      if(st.lastFrom!==undefined)chessLastMoveFrom=st.lastFrom;
      if(st.lastTo!==undefined)chessLastMoveTo=st.lastTo;
      chessSelected=-1;chessValidMoves=[];
      buildChessBoard();renderChessBoard();
      var opp=chessState.turn,oppMoves=chessAllLegalMoves(chessState,opp);
      if(!oppMoves.length){
        setTimeout(function(){chessGameOver(chessIsCheck(chessState,opp)?(opp===chessMyColor?'lose':'win'):'draw');},400);
      }
    }
  }catch(e){}
}

/* ================================================================
   FLAPPY BIRD
   ================================================================ */
function flappyBird(cv) {
  var W = cv._W || 380;
  var H = cv._H || 500;
  var ctx = cv.getContext('2d');
  var on = true, raf = null;

  /* constants */
  var GRAV = 0.42, JUMP = -8.2;
  var PW = 58, GAP = 155, PIPE_BASE = 2.6;
  var BIRD_X = 82, BIRD_R = 15;
  var GROUND = H - 46;

  /* state */
  var started = false, dead = false;
  var score = 0, best = parseInt(localStorage.getItem('flappy_best') || '0');
  var vy = 0, by = H / 2, ba = 0;
  var pipes = [];
  var wingFlap = 0, wingDir = 1;
  var trail = [];  // bird trail
  var lastTs = null, T60 = 1000 / 60;
  var particles = [];

  /* pre-generate city skyline */
  var cityBuildings = [];
  (function() {
    var x = 0;
    while (x < W + 100) {
      var bw = 18 + Math.floor(Math.random() * 28);
      var bh = 40 + Math.floor(Math.random() * 110);
      cityBuildings.push({ x: x, w: bw, h: bh });
      x += bw + 2 + Math.floor(Math.random() * 8);
    }
  })();

  /* pre-generate stars */
  var stars = [];
  for (var si = 0; si < 55; si++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * (GROUND * 0.7),
      r: 0.5 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2
    });
  }

  /* spawn pipe */
  function spawnPipe() {
    var minT = 55, maxT = GROUND - GAP - 55;
    pipes.push({ x: W, topH: minT + Math.random() * (maxT - minT), passed: false });
  }
  spawnPipe();

  /* input */
  function jump() {
    if (!on) return;
    if (dead) { resetGame(); return; }
    if (!started) started = true;
    vy = JUMP;
    // spawn burst particles
    for (var i = 0; i < 4; i++) { // fewer particles
      particles.push({
        x: BIRD_X, y: by,
        vx: (Math.random() - 0.5) * 2.5,
        vy: 0.8 + Math.random() * 1.5,
        life: 1, color: ['#ffd700','#ff8c00'][Math.floor(Math.random()*2)]
      });
    }
  }
  cv.addEventListener('click', jump);
  cv.addEventListener('touchstart', function(e) { e.preventDefault(); jump(); }, { passive: false });
  function kd(e) {
    if ((e.code === 'Space' || e.key === ' ') && document.getElementById('popup').classList.contains('on')) {
      e.preventDefault(); jump();
    }
  }
  document.addEventListener('keydown', kd);

  function resetGame() {
    score = 0; vy = 0; by = H / 2; ba = 0; dead = false; started = false;
    pipes = []; trail = []; particles = [];
    spawnPipe();
    document.getElementById('pts').textContent = '0';
  }

  /* ---- Pre-render static background to offscreen canvas (big perf win) ---- */
  var bgCanvas = document.createElement('canvas');
  bgCanvas.width = W; bgCanvas.height = GROUND;
  var bctx = bgCanvas.getContext('2d');

  // Sky gradient
  var sky = bctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#060615'); sky.addColorStop(0.5, '#0d0d2b');
  sky.addColorStop(0.8, '#180a28'); sky.addColorStop(1, '#240b30');
  bctx.fillStyle = sky; bctx.fillRect(0, 0, W, GROUND);

  // Stars (static — no twinkle for perf)
  stars.forEach(function(s) {
    bctx.globalAlpha = 0.5 + 0.3 * Math.sin(s.phase);
    bctx.fillStyle = '#fff';
    bctx.beginPath(); bctx.arc(s.x, s.y, s.r, 0, Math.PI*2); bctx.fill();
  });
  bctx.globalAlpha = 1;

  // City buildings (static, no per-frame recalc)
  var neonColors = ['#00d4ff','#ff44aa','#44ffbb','#ffcc22','#aa66ff'];
  cityBuildings.forEach(function(b) {
    var bx = b.x, by2 = GROUND - b.h;
    bctx.fillStyle = '#110820'; bctx.fillRect(bx, by2, b.w, b.h);
    // Windows — simple rectangles, no shadow, deterministic
    var winW=6, winH=7, padX=4, padY=5, gapX=5, gapY=4;
    var wCols = Math.floor((b.w-padX*2)/(winW+gapX));
    var wRows = Math.floor((b.h-padY*2)/(winH+gapY));
    for (var wr=0; wr<wRows; wr++) for (var wc=0; wc<wCols; wc++) {
      if ((wc*3+wr*7+Math.floor(bx))%4===0) continue;
      var col = neonColors[(wc*5+wr*3+Math.floor(bx/10)) % neonColors.length];
      bctx.globalAlpha = 0.4 + 0.15 * Math.sin(wc*1.3+wr*0.9);
      bctx.fillStyle = col;
      bctx.fillRect(bx+padX+wc*(winW+gapX), by2+padY+wr*(winH+gapY), winW, winH);
    }
    bctx.globalAlpha = 1;
    // Building edge
    bctx.strokeStyle = 'rgba(160,80,240,0.15)'; bctx.lineWidth=1;
    bctx.strokeRect(bx, by2, b.w, b.h);
  });

  /* ---- drawing ---- */

  function drawBackground(ts) {
    // Draw pre-rendered background in one blit — O(1) instead of O(buildings*windows)
    ctx.drawImage(bgCanvas, 0, 0);
    // Twinkle stars with a simple globalAlpha oscillation (cheap)
    if (Math.floor(ts/500) % 2 === 0) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#fff';
      for (var si=0; si<stars.length; si+=3) {
        ctx.beginPath(); ctx.arc(stars[si].x, stars[si].y, stars[si].r+0.5, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawGround() {
    /* Dark road-like ground */
    var gc = ctx.createLinearGradient(0, GROUND, 0, H);
    gc.addColorStop(0, '#1a0d28');
    gc.addColorStop(1, '#0a0614');
    ctx.fillStyle = gc;
    ctx.fillRect(0, GROUND, W, H - GROUND);

    /* Neon ground line */
    ctx.save();
    ctx.shadowColor = '#aa00ff';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#cc44ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 1);
    ctx.lineTo(W, GROUND + 1);
    ctx.stroke();
    ctx.restore();
  }

  function drawPipe(px, topH) {
    var bH = GROUND - topH - GAP;

    ctx.save();
    // No shadowBlur on pipes (expensive, redraw entire pipe area)

    function fillPipeBody(x, y, w, h) {
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0,   '#004d22');
      g.addColorStop(0.25,'#00c85a');
      g.addColorStop(0.55,'#00ff88');
      g.addColorStop(0.75,'#00c85a');
      g.addColorStop(1,   '#003a18');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }

    /* Top pipe */
    fillPipeBody(px, 0, PW, topH);
    /* Top cap */
    fillPipeBody(px - 5, topH - 18, PW + 10, 18);
    /* Top cap highlight */
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px - 5, topH - 18, PW + 10, 5);

    /* Bottom pipe */
    fillPipeBody(px, topH + GAP, PW, bH);
    /* Bottom cap */
    fillPipeBody(px - 5, topH + GAP, PW + 10, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px - 5, topH + GAP, PW + 10, 5);

    /* Vertical shine strip */
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(px + 8, 0, 7, topH);
    ctx.fillRect(px + 8, topH + GAP, 7, bH);

    ctx.restore();
  }

  function drawTrail() {
    for (var i = 0; i < trail.length; i++) {
      var t = trail[i], alpha = (i / trail.length) * 0.6;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.arc(t.x, t.y, BIRD_R * 0.45 * (i / trail.length), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBird(bx, by2, angle, flap) {
    ctx.save();
    ctx.translate(bx, by2);
    ctx.rotate(angle);

    /* Outer glow */
    ctx.save();
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 20;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* Body */
    var bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R);
    bg.addColorStop(0, '#ffe84d');
    bg.addColorStop(0.65, '#ffa200');
    bg.addColorStop(1, '#cc7000');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();

    /* Belly shimmer */
    var bel = ctx.createRadialGradient(2, 3, 1, 2, 4, 8);
    bel.addColorStop(0, 'rgba(255,255,200,0.6)');
    bel.addColorStop(1, 'transparent');
    ctx.fillStyle = bel;
    ctx.beginPath(); ctx.arc(2, 4, 9, 0, Math.PI * 2); ctx.fill();

    /* Wing */
    var wOff = Math.sin(flap) * 5;
    ctx.fillStyle = '#dd8800';
    ctx.save();
    ctx.translate(-4, 1 + wOff);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* Eye */
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(7, -5, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(8.5, -5.5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(9.6, -6.8, 1.3, 0, Math.PI * 2); ctx.fill();

    /* Beak */
    ctx.fillStyle = '#e85c1a';
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 1, -2);
    ctx.lineTo(BIRD_R + 9, 1);
    ctx.lineTo(BIRD_R - 1, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(function(p) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawScore() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    /* Neon glow shadow */
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Bricolage Grotesque", sans-serif';
    ctx.fillText(score, W / 2, 14);
    ctx.restore();
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
    c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
    c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath();
  }

  function drawCard(x, y, w, h, glowColor) {
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25;
    ctx.fillStyle = 'rgba(10,5,25,0.88)';
    rr(ctx, x, y, w, h, 16); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    rr(ctx, x, y, w, h, 16); ctx.stroke();
    ctx.restore();
  }

  function drawStart() {
    var cx = W/2, cw = 250, ch = 145, cy = H/2 - 72;
    drawCard(cx - cw/2, cy, cw, ch, '#aa44ff');
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#cc66ff';
    ctx.shadowBlur = 14;
    ctx.font = 'bold 22px "Bricolage Grotesque", sans-serif';
    ctx.fillText('🐦 Flappy Bird', cx, cy + 24);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '13px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Klick · Touch · Leertaste', cx, cy + 60);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '13px "Bricolage Grotesque", sans-serif';
    ctx.fillText('zum Fliegen', cx, cy + 80);
    ctx.fillStyle = '#ffcc00';
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 13px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Bestleistung: ' + best + ' Punkte', cx, cy + 113);
    ctx.restore();
  }

  function drawDead() {
    var cx = W/2, cw = 250, ch = 168, cy = H/2 - 84;
    drawCard(cx - cw/2, cy, cw, ch, '#ff2255');
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4466';
    ctx.shadowColor = '#ff2244';
    ctx.shadowBlur = 18;
    ctx.font = 'bold 24px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Game Over', cx, cy + 30);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px "Bricolage Grotesque", sans-serif';
    ctx.fillText(score, cx, cy + 82);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 13px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Bestleistung: ' + best, cx, cy + 106);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Klicken zum Weiterspielen', cx, cy + 133);
    ctx.restore();
  }

  /* collision */
  function collides() {
    if (by + BIRD_R >= GROUND || by - BIRD_R <= 0) return true;
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      if (BIRD_X + BIRD_R - 4 < p.x || BIRD_X - BIRD_R + 4 > p.x + PW) continue;
      if (by - BIRD_R + 4 < p.topH || by + BIRD_R - 4 > p.topH + GAP) return true;
    }
    return false;
  }

  /* main loop */
  function loop(ts) {
    if (!on) return;
    var dt = lastTs ? Math.min((ts - lastTs) / T60, 3) : 1;
    lastTs = ts;
    var speed = PIPE_BASE + score * 0.07;

    if (started && !dead) {
      vy += GRAV * dt; by += vy * dt;
      ba = Math.max(-0.5, Math.min(1.1, vy * 0.065));
      wingFlap += 0.22 * dt * wingDir;
      if (Math.abs(wingFlap) > 1.2) wingDir *= -1;

      /* trail */
      trail.push({ x: BIRD_X, y: by });
      if (trail.length > 6) trail.shift(); // shorter trail = less draw calls

      /* particles */
      for (var pi = particles.length - 1; pi >= 0; pi--) {
        particles[pi].x += particles[pi].vx * dt;
        particles[pi].y += particles[pi].vy * dt;
        particles[pi].life -= 0.04 * dt;
        if (particles[pi].life <= 0) particles.splice(pi, 1);
      }

      /* pipes */
      for (var i = pipes.length - 1; i >= 0; i--) {
        pipes[i].x -= speed * dt;
        if (!pipes[i].passed && pipes[i].x + PW < BIRD_X) {
          pipes[i].passed = true; score++;
          document.getElementById('pts').textContent = score;
          if (score > best) { best = score; localStorage.setItem('flappy_best', best); }
        }
        if (pipes[i].x + PW < -15) pipes.splice(i, 1);
      }
      if (!pipes.length || pipes[pipes.length - 1].x < W - 200) spawnPipe();

      if (collides()) {
        dead = true; vy = -3;
        if (score > 0) saveHS('flappy', score);
      }
    } else if (dead) {
      vy = Math.min(vy + GRAV * dt, 8); by = Math.min(by + vy * dt, GROUND - BIRD_R); ba = 1.2;
    } else {
      by = H / 2 + Math.sin(ts / 600) * 8; wingFlap += 0.15 * dt; ba = Math.sin(ts / 600) * 0.15;
    }

    /* draw */
    ctx.clearRect(0, 0, W, H);
    drawBackground(ts);
    pipes.forEach(function(p) { drawPipe(p.x, p.topH); });
    drawGround();
    drawTrail();
    drawParticles();
    drawBird(BIRD_X, by, ba, wingFlap);
    if (started && !dead) drawScore();
    if (!started) drawStart();
    if (dead) drawDead();

    raf = requestAnimationFrame(loop);
  }

  document.getElementById('pts').textContent = '0';
  document.getElementById('btn-again').style.display = 'none';
  raf = requestAnimationFrame(loop);

  return {
    stop: function() {
      on = false;
      if (raf) cancelAnimationFrame(raf);
      cv.removeEventListener('click', jump);
      cv.removeEventListener('touchstart', jump);
      document.removeEventListener('keydown', kd);
    }
  };
}

/* ================================================================
   TIPP-RENNEN (TYPERACER)
   Both type the same text — car progress shown live via WS
   ================================================================ */

var TR_TEXTS = [
  "Der Pixel leuchtet in der Nacht und jedes Game macht Spass.",
  "Klick schnell auf Start und lass das Duell beginnen jetzt.",
  "Tippe so schnell du kannst und bring den Rennwagen ans Ziel.",
  "Bytes und Bits fliegen durch das Netz in Lichtgeschwindigkeit.",
  "Wer am schnellsten tippt gewinnt das Rennen und den Ruhm.",
  "ArcadeBox ist die beste Spieleseite die du je gesehen hast.",
  "Das Retro Game laeuft auf vollem Speed direkt in dein Herz.",
  "Finger auf die Tasten und Gas geben bis zur Ziellinie.",
  "Jede Sekunde zaehlt wenn beide Spieler gleichzeitig starten.",
  "Der schnelle Fahrer trifft jeden Buchstaben ohne Fehler."
];

document.querySelectorAll('.elfmeter-diff').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.elfmeter-diff').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    elfmAiDiff = this.dataset.diff;
  });
});
document.getElementById('btn-elfmeter-ai').addEventListener('click', function() {
  elfmeterStart(elfmAiDiff);
});

async function loadElfmeterLobbyScreen() {
  document.getElementById('elfmeter-lobby-screen').style.display = 'block';
  document.getElementById('tr-game-screen').style.display = 'none';
  try {
    var res = await fetch(API_URL + '/api/users/search?me=' + user.id);
    var users = await res.json();
    var online = (users||[]).filter(function(u) { return isRecentlyActive(u) && u.id !== user.id; });
    document.getElementById('elfmeter-online-num').textContent = online.length;
    var container = document.getElementById('elfmeter-users-list');
    if (!online.length) { container.innerHTML = '<div class="lobby-empty">Keine Freunde online</div>'; return; }
    var html = '';
    online.forEach(function(u) {
      var seed = u.avatar_seed || u.name;
      var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
      html += '<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="elfmeter">Einladen</button></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.btn-invite').forEach(function(btn) {
      btn.addEventListener('click', function() { sendGameInvite(parseInt(this.dataset.id), this, 'elfmeter'); });
    });
  } catch(e) {}
}

function elfmeterStart(diff) {
  elfmIsAI = true; elfmAiDiff = diff; elfmIsHost = true; elfmOn = true;
  var text = TR_TEXTS[Math.floor(Math.random() * TR_TEXTS.length)];
  trStartGame(true, diff, null, true, text);
}

function elfmeterStartOnline(lobbyId, isHost) {
  elfmLobbyId = lobbyId; elfmIsHost = isHost; elfmIsAI = false; elfmOn = true;
  // Host picks text and sends via WS after connecting
  var text = isHost ? TR_TEXTS[Math.floor(Math.random() * TR_TEXTS.length)] : null;
  trStartGame(false, null, lobbyId, isHost, text);
  connectGameWS(lobbyId, function(data) {
    if (game && game.onWS) game.onWS(data);
  });
  if (elfmPollInterval) clearInterval(elfmPollInterval);
  elfmPollInterval = setInterval(function(){ if(!elfmOn) clearInterval(elfmPollInterval); }, 5000);
}

function trStartGame(isAI, diff, lobbyId, isHost, text) {
  document.getElementById('elfmeter-lobby-screen').style.display = 'none';
  var gs = document.getElementById('tr-game-screen');
  gs.style.display = 'flex';

  var myProgress = 0, oppProgress = 0;
  var myChars = 0; // correctly typed characters
  var started = false, finished = false, gameEnded = false;
  var aiTimer = null, aiInterval = null;

  // AI typing speeds (chars/sec)
  var aiSpeeds = { easy: 3.5, medium: 6, hard: 9 };
  var aiSpeed = aiSpeeds[diff] || aiSpeeds.medium;

  document.getElementById('tr-opp-name').textContent = isAI ? 'KI' : 'Gegner';

  // Wait for text (host sends it via WS for online)
  function init(raceText) {
    text = raceText;
    renderText();
    document.getElementById('tr-input').disabled = false;
    document.getElementById('tr-input').focus();
    document.getElementById('tr-status').textContent = '🏁 Fang an zu tippen!';
    if (isAI) startAI();
    else if (isHost) {
      // Broadcast text to guest
      setTimeout(function() { sendGameWS({ type:'tr_text', text: raceText }); }, 200);
    }
  }

  function renderText() {
    if (!text) return;
    var display = document.getElementById('tr-text-display');
    var html = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i] === ' ' ? '&nbsp;' : escHtml(text[i]);
      if (i < myChars) html += '<span class="tr-done">'+ch+'</span>';
      else if (i === myChars) html += '<span class="tr-cursor">'+ch+'</span>';
      else html += '<span class="tr-pending">'+ch+'</span>';
    }
    display.innerHTML = html;
  }

  function updateCar(id, pct, pctId) {
    var car = document.getElementById(id);
    var road = car ? car.parentElement : null;
    if (!car || !road) return;
    var roadW = road.offsetWidth || 300;
    var carW = 32;
    var maxLeft = roadW - carW - 8;
    car.style.left = Math.round(pct * maxLeft / 100) + 'px';
    var el = document.getElementById(pctId);
    if (el) el.textContent = Math.round(pct) + '%';
  }

  // Input handler
  var inp = document.getElementById('tr-input');
  inp.value = '';
  function onInput() {
    if (!text || finished || gameEnded) return;
    var typed = inp.value;
    // Check character by character from current position
    var correct = 0;
    for (var i = 0; i < typed.length; i++) {
      if (myChars + i < text.length && typed[i] === text[myChars + i]) {
        correct++;
      } else {
        break;
      }
    }
    if (correct > 0) {
      myChars += correct;
      inp.value = typed.slice(correct);
      inp.style.background = '';
    } else if (typed.length > 0) {
      inp.style.background = 'rgba(239,68,68,0.15)';
    }
    myProgress = Math.round((myChars / text.length) * 100);
    updateCar('tr-car-me', myProgress, 'tr-pct-me');
    renderText();

    // Send progress via WS
    if (!isAI) sendGameWS({ type:'tr_progress', pct: myProgress });

    if (myChars >= text.length) {
      myProgress = 100;
      updateCar('tr-car-me', 100, 'tr-pct-me');
      if (!finished) { finished = true; endRace(true); }
    }
  }
  inp.addEventListener('input', onInput);

  function startAI() {
    // AI makes typos: easy=20%, medium=5%, hard=0%
    var typoRate = diff==='easy'?0.18:diff==='medium'?0.05:0;
    var aiChars = 0;
    var msPerChar = 1000 / aiSpeed;
    aiInterval = setInterval(function() {
      if (!elfmOn || gameEnded || !text) { clearInterval(aiInterval); return; }
      // Random typo: AI pauses to correct
      if (Math.random() < typoRate) {
        setTimeout(function() {
          if(aiChars < text.length && !gameEnded) {
            aiChars += 1;
            oppProgress = Math.round(aiChars / text.length * 100);
            updateCar('tr-car-opp', oppProgress, 'tr-pct-opp');
            if (aiChars >= text.length && !finished) { finished=true; endRace(false); }
          }
        }, msPerChar * 2);
      } else {
        aiChars += 1;
        oppProgress = Math.round(aiChars / text.length * 100);
        updateCar('tr-car-opp', oppProgress, 'tr-pct-opp');
        if (aiChars >= text.length && !finished) { finished=true; endRace(false); }
      }
    }, msPerChar);
  }

  function endRace(iWon) {
    gameEnded = true; elfmOn = false;
    if (aiInterval) clearInterval(aiInterval);
    inp.disabled = true;
    if (elfmPollInterval) { clearInterval(elfmPollInterval); elfmPollInterval = null; }
    var resultEl = document.getElementById('tr-result');
    var statusEl = document.getElementById('tr-status');
    if (iWon) {
      statusEl.textContent = '🏆 Du hast gewonnen!';
      statusEl.style.color = '#fbbf24';
    } else {
      statusEl.textContent = '😔 Zu langsam! Gegner war schneller.';
      statusEl.style.color = '#ef4444';
    }
    resultEl.style.display = 'block';
    resultEl.textContent = 'Dein Fortschritt: '+myProgress+'% — Gegner: '+oppProgress+'%';
    // Show game-over overlay after delay
    setTimeout(function() {
      var overlay = document.getElementById('ttt-overlay');
      var msg = document.getElementById('ttt-overlay-msg');
      var sub = '<small style="font-size:0.6em;opacity:0.7">Tipp-Rennen</small>';
      if (iWon) { msg.innerHTML='🏆<br>Du hast gewonnen!<br>'+sub; sounds.highscore(); }
      else { msg.innerHTML='😔<br>Du hast verloren.<br>'+sub; }
      overlay.classList.add('show');
    }, 2000);
  }

  function onWS(data) {
    if (gameEnded) return;
    if (data.type === 'tr_text' && !text) {
      // Guest receives text from host
      init(data.text);
    } else if (data.type === 'tr_progress') {
      oppProgress = data.pct;
      updateCar('tr-car-opp', oppProgress, 'tr-pct-opp');
      if (oppProgress >= 100 && !finished) { finished=true; endRace(false); }
    }
  }

  game = {
    stop: function() {
      elfmOn=false; gameEnded=true;
      if(aiInterval)clearInterval(aiInterval);
      inp.removeEventListener('input', onInput);
      inp.disabled=false; inp.value='';
    },
    onWS: onWS
  };

  // Initialize
  if (text) {
    init(text);
  } else {
    // Guest: wait for text via WS
    document.getElementById('tr-status').textContent = '⏳ Warte auf Spieltext...';
    document.getElementById('tr-input').disabled = true;
  }
}

/* ================================================================
   SCHLANGE (SNAKE)
   ================================================================ */
function snakeStart() {
  snakeOn = true;
  var area = document.getElementById('snake-area');
  area.innerHTML = '';
  var cv = document.createElement('canvas');
  cv.id = 'snake-canvas';
  area.appendChild(cv);

  var CELL = 20, COLS = 19, ROWS = 19;
  var W = COLS * CELL, H = ROWS * CELL;
  fitCanvas(cv, W, H);
  var ctx = cv.getContext('2d');

  var snake, dir, nextDir, apples, score, interval, speed;
  var appleAnim = 0;
  var canMove = false;       // locked during the "Bereit?"/Countdown start sequence
  var overlayText = null;    // text shown over the canvas during the start sequence
  var startTimers = [];      // pending setTimeout ids for the start sequence

  function init() {
    snake = [{x:9,y:9},{x:8,y:9},{x:7,y:9}];
    dir = {x:1,y:0};
    nextDir = {x:1,y:0};
    apples = [randomApple()];
    score = 0;
    speed = 150;
    canMove = false;
    document.getElementById('pts').textContent = 0;
    if (interval) clearInterval(interval);
    interval = null;
    render();
  }

  function randomApple() {
    var pos;
    do {
      pos = {x: Math.floor(Math.random()*COLS), y: Math.floor(Math.random()*ROWS)};
    } while (snake.some(function(s){return s.x===pos.x&&s.y===pos.y;}));
    return pos;
  }

  function tick() {
    if (!snakeOn) return;
    dir = nextDir;
    var head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};
    // wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) { gameOver(); return; }
    // self collision
    if (snake.some(function(s){return s.x===head.x&&s.y===head.y;})) { gameOver(); return; }
    snake.unshift(head);
    // eat apple
    var ateIdx = -1; for (var ai=0;ai<apples.length;ai++){if(apples[ai].x===head.x&&apples[ai].y===head.y){ateIdx=ai;break;}}
    if (ateIdx >= 0) {
      apples.splice(ateIdx, 1);
      apples.push(randomApple());
      score += 10;
      document.getElementById('pts').textContent = score;
      speed = Math.max(60, speed - 5);
      clearInterval(interval);
      interval = setInterval(tick, speed);
    } else {
      snake.pop();
    }
    render();
  }

  function gameOver() {
    if (interval) { clearInterval(interval); interval = null; }
    snakeOn = false;
    saveHS('snake', score);
    // draw game over
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#ff4466';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W/2, H/2 - 16);
    ctx.font = '18px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Score: ' + score, W/2, H/2 + 14);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Nochmal → Klick "Nochmal"', W/2, H/2 + 40);
  }

  // "Bereit?" → 3 → 2 → 1 → "Los!" — snake stands still & ignores input until done
  function startSequence() {
    var steps = ['Bereit?', '3', '2', '1', 'Los!'];
    var delays = [900, 700, 700, 700, 500];
    overlayText = steps[0];
    var t = delays[0];
    for (var i = 1; i < steps.length; i++) {
      (function(text, time) {
        startTimers.push(setTimeout(function() { overlayText = text; }, time));
      })(steps[i], t);
      t += delays[i];
    }
    startTimers.push(setTimeout(function() {
      overlayText = null;
      canMove = true;
      if (interval) clearInterval(interval);
      interval = setInterval(tick, speed);
    }, t));
  }

  // Draws the "Bereit?"/Countdown overlay on top of the board, matching the Game-Over style
  function drawOverlay() {
    if (!overlayText) return;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    var pulse = 1 + 0.06 * Math.sin(appleAnim * 1.5);
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.scale(pulse, pulse);
    ctx.font = 'bold 40px monospace';
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc'; ctx.shadowBlur = 22;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(overlayText, 0, 0);
    ctx.restore();
  }

  appleAnim = 0;
  var appleRaf = null;

  // Pre-build grid image once for performance
  var gridCanvas = document.createElement('canvas');
  gridCanvas.width = W * (window.devicePixelRatio||1);
  gridCanvas.height = H * (window.devicePixelRatio||1);
  var gctx = gridCanvas.getContext('2d');
  gctx.scale(window.devicePixelRatio||1, window.devicePixelRatio||1);
  // Gradient background
  var bgGrad = gctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#06060f');
  bgGrad.addColorStop(1, '#0a0a1e');
  gctx.fillStyle = bgGrad;
  gctx.fillRect(0, 0, W, H);
  // Grid lines (very subtle)
  gctx.strokeStyle = 'rgba(255,255,255,0.035)';
  gctx.lineWidth = 0.5;
  for (var gx2 = 0; gx2 <= COLS; gx2++) { gctx.beginPath(); gctx.moveTo(gx2*CELL,0); gctx.lineTo(gx2*CELL,H); gctx.stroke(); }
  for (var gy2 = 0; gy2 <= ROWS; gy2++) { gctx.beginPath(); gctx.moveTo(0,gy2*CELL); gctx.lineTo(W,gy2*CELL); gctx.stroke(); }

  function render() {
    appleAnim += 0.06;
    // Draw pre-rendered grid background
    ctx.drawImage(gridCanvas, 0, 0, W, H);

    // Snake — rounded segments, gradient color head to tail
    var len = snake.length;
    for (var si = len-1; si >= 0; si--) {
      var seg = snake[si];
      var t2 = si / Math.max(len-1, 1); // 0=head, 1=tail
      var cx2 = seg.x*CELL + CELL/2, cy2 = seg.y*CELL + CELL/2;
      var r2 = si===0 ? CELL/2-1 : CELL/2-2;
      // Color: head=bright cyan-green, tail=darker teal
      var g = Math.round(220 - t2*80);
      var b = Math.round(80 + t2*40);
      ctx.fillStyle = 'rgb(0,' + g + ',' + b + ')';
      if (si === 0) {
        // Head: slightly larger, distinct color
        ctx.fillStyle = '#00ffcc';
        ctx.shadowColor = '#00ffcc'; ctx.shadowBlur = 16;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(cx2, cy2, r2, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Eyes on head
    if (snake.length > 0) {
      var h2 = snake[0];
      var ex = h2.x*CELL + CELL/2 + dir.x*5;
      var ey = h2.y*CELL + CELL/2 + dir.y*5;
      var eye1x = ex + dir.y*3, eye1y = ey - dir.x*3;
      var eye2x = ex - dir.y*3, eye2y = ey + dir.x*3;
      ctx.fillStyle = '#001a0d';
      ctx.beginPath(); ctx.arc(eye1x, eye1y, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(eye2x, eye2y, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(eye1x+0.5, eye1y-0.5, 1, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(eye2x+0.5, eye2y-0.5, 1, 0, Math.PI*2); ctx.fill();
    }

    // Apples — pulsing neon red orb
    apples.forEach(function(a) {
      var pulse = 0.82 + 0.18 * Math.sin(appleAnim);
      var ar = (CELL/2 - 2) * pulse;
      var ax2 = a.x*CELL + CELL/2, ay2 = a.y*CELL + CELL/2;
      ctx.shadowColor = '#ff3366'; ctx.shadowBlur = 14;
      var rg = ctx.createRadialGradient(ax2-ar*0.2, ay2-ar*0.2, 0, ax2, ay2, ar);
      rg.addColorStop(0, '#ff6688'); rg.addColorStop(1, '#cc0033');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(ax2, ay2, ar, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    });
    // Score shown in #pts (outside canvas)

    // "Bereit?"/Countdown overlay (drawn last, on top of everything)
    drawOverlay();
  }

  // keyboard
  function onKey(e) {
    if (!snakeOn || !canMove) return;
    var map = {ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},
               w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0},
               W:{x:0,y:-1},S:{x:0,y:1},A:{x:-1,y:0},D:{x:1,y:0}};
    var d = map[e.key];
    if (d && !(d.x === -dir.x && d.y === -dir.y)) { nextDir = d; e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  // touch swipe
  var touchStart = null;
  cv.addEventListener('touchstart', function(e){ touchStart = {x:e.touches[0].clientX, y:e.touches[0].clientY}; e.preventDefault(); }, {passive:false});
  cv.addEventListener('touchend', function(e){
    if (!touchStart || !snakeOn || !canMove) return;
    var dx = e.changedTouches[0].clientX - touchStart.x;
    var dy = e.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      var nd = dx > 0 ? {x:1,y:0} : {x:-1,y:0};
      if (!(nd.x===-dir.x)) nextDir = nd;
    } else {
      var nd = dy > 0 ? {x:0,y:1} : {x:0,y:-1};
      if (!(nd.y===-dir.y)) nextDir = nd;
    }
    touchStart = null;
  }, {passive:false});

  // start render loop for apple pulse — MUST call init() first so snake/apples exist
  function animLoop() {
    if (!snakeOn) return;
    render();
    appleRaf = requestAnimationFrame(animLoop);
  }
  init();          // initialize snake state first
  animLoop();      // then start animation
  startSequence(); // "Bereit?" + 3-2-1-Los! before the snake starts moving

  game = {
    stop: function() {
      snakeOn = false;
      if (interval) { clearInterval(interval); interval = null; }
      if (appleRaf) { cancelAnimationFrame(appleRaf); appleRaf = null; }
      startTimers.forEach(function(t){ clearTimeout(t); });
      startTimers = [];
      document.removeEventListener('keydown', onKey);
    }
  };
}

/* ================================================================
   WORT-BLITZ (WORD BLAST)
   ================================================================ */
function wortblitzStart() {
  wortblitzOn = true;
  var cv = document.getElementById('wortblitz-canvas');
  var inp = document.getElementById('wortblitz-input');
  fitCanvas(cv, 380, 300);
  var W = cv._W || 380, H = cv._H || 300;
  var ctx = cv.getContext('2d');
  inp.style.display = 'block';
  inp.value = '';
  setTimeout(function() { try { inp.focus(); } catch(e) {} }, 100);

  var WORDS = ['CODE','PIXEL','NEON','LASER','GAME','LEVEL','BOSS','SCORE','RETRO','ARCADE',
    'TURBO','MEGA','ULTRA','SUPER','HYPER','CYBER','MATRIX','VIRUS','HACK','DEBUG',
    'STACK','LOOP','ARRAY','BYTE','BITS','DATA','NODE','LINK','SYNC','PING',
    'HOST','PORT','GRID','GLITCH','PULSE','WAVE','BEAM','FLASH','BOLT','CLONE'];
  var NEON_COLORS = ['#00ffcc','#ff00cc','#ffff00','#00ccff','#ff6600','#cc00ff','#00ff88','#ff0055'];

  var falling = [], score = 0, timeLeft = 60, raf = null, spawnTimer = 0;

  function randWord() { return WORDS[Math.floor(Math.random()*WORDS.length)]; }
  function randColor() { return NEON_COLORS[Math.floor(Math.random()*NEON_COLORS.length)]; }
  function spawnWord() {
    var txt = randWord();
    // avoid duplicate visible words
    var existing = falling.map(function(f){return f.txt;});
    for (var t = 0; t < 5; t++) { var w = randWord(); if (existing.indexOf(w) === -1) { txt = w; break; } }
    falling.push({ txt: txt, x: 20 + Math.random()*(W-80), y: -18, speed: 0.5 + Math.random(), color: randColor() });
  }

  document.getElementById('pts').textContent = 0;

  var lastTs = null;
  var nextSpawn = 2000 + Math.random()*1000;
  spawnWord();

  var timerInterval = setInterval(function(){
    if (!wortblitzOn) { clearInterval(timerInterval); return; }
    timeLeft--;
    if (timeLeft <= 0) { timeLeft = 0; endGame(); }
  }, 1000);

  function endGame() {
    wortblitzOn = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    clearInterval(timerInterval);
    saveHS('wortblitz', score);
    inp.style.display = 'none';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0,0,W,H);
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#ff4466';
    ctx.textAlign = 'center';
    ctx.fillText('ZEIT ABGELAUFEN', W/2, H/2 - 20);
    ctx.font = '18px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Score: ' + score, W/2, H/2 + 14);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Nochmal → Klick "Nochmal"', W/2, H/2 + 40);
  }

  function loop(ts) {
    if (!wortblitzOn) return;
    var elapsed = lastTs ? (ts - lastTs) : 0;
    var dt = Math.min(elapsed / 16, 3) || 1;
    lastTs = ts;
    spawnTimer += elapsed;
    if (spawnTimer >= nextSpawn) {
      spawnWord();
      spawnTimer = 0;
      nextSpawn = 2000 + Math.random()*1000;
    }

    // update
    for (var i = falling.length-1; i >= 0; i--) {
      falling[i].y += falling[i].speed * dt;
      if (falling[i].y > H + 10) {
        // word hit bottom — game over
        falling.splice(i,1);
        endGame();
        return;
      }
    }

    // draw
    ctx.fillStyle = '#050510';
    ctx.fillRect(0,0,W,H);
    // timer top-right
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = timeLeft <= 10 ? '#ff4466' : '#aaffcc';
    ctx.fillText(timeLeft + 's', W-10, 22);
    // score
    ctx.textAlign = 'left';
    ctx.fillStyle = '#aaffcc';
    ctx.fillText('Score: ' + score, 8, 22);

    falling.forEach(function(w){
      ctx.save();
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 14;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = w.color;
      ctx.fillText(w.txt, w.x, w.y);
      ctx.restore();
    });

    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // Match on every keystroke — the moment typed word exactly matches a falling word, destroy it
  // Also supports Enter key for desktop. Case-insensitive comparison.
  function checkTyped() {
    if (!wortblitzOn) return;
    var typed = inp.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    var idx = -1;
    for (var fi = 0; fi < falling.length; fi++) {
      if (falling[fi].txt === typed) { idx = fi; break; }
    }
    if (idx >= 0) {
      falling.splice(idx, 1);
      score += 10;
      document.getElementById('pts').textContent = score;
      inp.value = '';
      // Flash effect — briefly tint input green
      inp.style.borderColor = '#00ff88';
      setTimeout(function() { inp.style.borderColor = ''; }, 200);
    }
  }

  inp.addEventListener('input', checkTyped);
  inp.addEventListener('keydown', function onEnter(e) {
    if (!wortblitzOn) { inp.removeEventListener('keydown', onEnter); return; }
    if (e.key === 'Enter' || e.key === 'Return') {
      checkTyped();
      inp.value = '';
    }
  });

  game = {
    stop: function() {
      wortblitzOn = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      clearInterval(timerInterval);
      inp.style.display = 'none';
    }
  };
}

/* ================================================================
   RECHEN-DUELL (MATH DUEL)
   ================================================================ */
async function loadMathLobbyScreen() {
  var ls = document.getElementById('math-lobby-screen');
  var gs = document.getElementById('math-game-screen');
  if (ls) ls.style.display = 'block';
  if (gs) gs.style.display = 'none';
  try {
    var res = await fetch(API_URL + '/api/users/search?me=' + user.id);
    var users = await res.json();
    var online = (users||[]).filter(function(u){ return isRecentlyActive(u) && u.id !== user.id; });
    document.getElementById('math-online-num').textContent = online.length;
    var container = document.getElementById('math-users-list');
    if (!online.length) { container.innerHTML = '<div class="lobby-empty">Keine Freunde online</div>'; return; }
    var html = '';
    online.forEach(function(u) {
      var seed = u.avatar_seed||u.name||'unknown';
      var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(seed);
      html += '<div class="lobby-user-row"><img class="lobby-user-av" src="'+av+'" alt=""><span class="lobby-user-name">'+escHtml(u.name)+'</span><button class="btn-invite" data-id="'+u.id+'" data-game="math">Einladen</button></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.btn-invite').forEach(function(btn){
      btn.addEventListener('click', function(){ sendGameInvite(parseInt(this.dataset.id), this, 'math'); });
    });
  } catch(e) {}
}

function mathGenProblem(diff) {
  var a, b, op, ans;
  if (diff === 'easy') {
    a = Math.floor(Math.random()*9)+1; b = Math.floor(Math.random()*9)+1;
    op = Math.random()<0.5 ? '+' : '-';
  } else if (diff === 'medium') {
    a = Math.floor(Math.random()*90)+10; b = Math.floor(Math.random()*90)+10;
    op = Math.random()<0.5 ? '+' : '-';
  } else {
    var type = Math.random();
    if (type < 0.4) { a = Math.floor(Math.random()*900)+100; b = Math.floor(Math.random()*900)+100; op = Math.random()<0.5?'+':'-'; }
    else { a = Math.floor(Math.random()*12)+2; b = Math.floor(Math.random()*12)+2; op = '×'; }
  }
  if (op==='+') ans=a+b; else if (op==='-') ans=a-b; else ans=a*b;
  return { text: a + ' ' + op + ' ' + b, answer: ans };
}

function mathStart(diff) {
  mathIsAI = true; mathAiDiff = diff || mathAiDiff; mathOn = true;
  document.getElementById('math-lobby-screen').style.display = 'none';
  document.getElementById('math-game-screen').style.display = 'flex';
  document.getElementById('ttt-overlay').classList.remove('show');
  document.getElementById('btn-again').style.display = 'none';

  var myScore = 0, aiScore = 0, round = 1, total = 5;
  var currentProblem = null, roundActive = false, aiTimer = null;

  function updateDisplay() {
    document.getElementById('math-score-display').textContent = myScore + ' : ' + aiScore;
    document.getElementById('math-round-info').textContent = 'Runde ' + round + ' von ' + total;
  }

  function nextRound() {
    if (round > total || myScore >= 3 || aiScore >= 3) { endMatch(); return; }
    roundActive = true;
    currentProblem = mathGenProblem(mathAiDiff);
    document.getElementById('math-problem').textContent = currentProblem.text + ' = ?';
    document.getElementById('math-status').textContent = '';
    document.getElementById('math-result-msg').textContent = '';
    document.getElementById('math-answer-input').value = '';
    document.getElementById('math-answer-input').disabled = false;
    document.getElementById('math-answer-btn').disabled = false;
    document.getElementById('math-answer-input').focus();
    updateDisplay();

    // AI timer
    var delay, correct;
    // Human-realistic delays: even "hard" takes a few seconds to think
    if (mathAiDiff==='easy') { delay = 7000 + Math.random()*5000; correct = Math.random()<0.5; }
    else if (mathAiDiff==='medium') { delay = 3000 + Math.random()*3000; correct = Math.random()<0.8; }
    else { delay = 1500 + Math.random()*2000; correct = true; } // hard: 1.5-3.5s, always correct

    aiTimer = setTimeout(function(){
      if (!roundActive) return;
      if (correct) {
        roundActive = false;
        aiScore++;
        document.getElementById('math-answer-input').disabled = true;
        document.getElementById('math-answer-btn').disabled = true;
        document.getElementById('math-result-msg').textContent = '🤖 KI war schneller! Antwort: ' + currentProblem.answer;
        document.getElementById('math-result-msg').style.color = '#ff4466';
        round++;
        updateDisplay();
        setTimeout(nextRound, 1800);
      }
    }, delay);
  }

  function submitAnswer() {
    if (!roundActive || !currentProblem) return;
    var val = parseInt(document.getElementById('math-answer-input').value, 10);
    if (isNaN(val)) return;
    if (val === currentProblem.answer) {
      roundActive = false;
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      myScore++;
      document.getElementById('math-answer-input').disabled = true;
      document.getElementById('math-answer-btn').disabled = true;
      document.getElementById('math-result-msg').textContent = '✅ Richtig! +1 Punkt';
      document.getElementById('math-result-msg').style.color = '#00ff88';
      round++;
      updateDisplay();
      setTimeout(nextRound, 1500);
    } else {
      document.getElementById('math-status').textContent = '✗ Falsch, weiter versuchen!';
      document.getElementById('math-answer-input').value = '';
    }
  }

  function endMatch() {
    mathOn = false;
    roundActive = false;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    var won = myScore >= 3;
    var overlay = document.getElementById('ttt-overlay');
    var msg = document.getElementById('ttt-overlay-msg');
    msg.textContent = won ? '🏆 Du hast gewonnen! ' + myScore + ':' + aiScore : '😞 KI gewinnt! ' + myScore + ':' + aiScore;
    overlay.classList.add('show');
    if (won) { saveHS('math', myScore * 10); sounds.highscore && sounds.highscore(); }
  }

  var answerInput = document.getElementById('math-answer-input');
  var answerBtn = document.getElementById('math-answer-btn');
  function onAnsKey(e) { if (e.key==='Enter') submitAnswer(); }
  answerInput.addEventListener('keydown', onAnsKey);
  answerBtn.onclick = submitAnswer;

  updateDisplay();
  nextRound();

  game = {
    stop: function() {
      mathOn = false;
      roundActive = false;
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      answerInput.removeEventListener('keydown', onAnsKey);
      answerBtn.onclick = null;
    }
  };
}

function mathStartOnline(lobbyId, isHost) {
  mathLobbyId = lobbyId; mathIsHost = isHost; mathIsAI = false; mathOn = true;
  document.getElementById('math-lobby-screen').style.display = 'none';
  document.getElementById('math-game-screen').style.display = 'flex';
  document.getElementById('ttt-overlay').classList.remove('show');
  document.getElementById('btn-again').style.display = 'none';

  var myScore = 0, oppScore = 0, round = 1, total = 5;
  var currentProblem = null, roundActive = false, myAnswerSent = false;

  function updateDisplay() {
    document.getElementById('math-score-display').textContent = (isHost ? myScore : oppScore) + ' : ' + (isHost ? oppScore : myScore);
    document.getElementById('math-round-info').textContent = 'Runde ' + round + ' von ' + total;
  }

  async function sendState(patch) {
    try {
      await fetch(API_URL+'/api/lobby/'+lobbyId, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({lobby_id:lobbyId, user_id:user.id, patch: patch})
      });
    } catch(e){}
  }

  async function generateAndSendProblem() {
    currentProblem = mathGenProblem('medium');
    myAnswerSent = false;
    roundActive = true;
    document.getElementById('math-problem').textContent = currentProblem.text + ' = ?';
    document.getElementById('math-status').textContent = '';
    document.getElementById('math-result-msg').textContent = '⏳ Warte auf Gegner…';
    document.getElementById('math-answer-input').disabled = false;
    document.getElementById('math-answer-btn').disabled = false;
    document.getElementById('math-answer-input').value = '';
    document.getElementById('math-answer-input').focus();
    await sendState({ problem: currentProblem.text, answer: currentProblem.answer, round: round, hostScore: myScore, guestScore: oppScore, hostAnswer: null, guestAnswer: null });
    document.getElementById('math-result-msg').textContent = '';
  }

  function waitForProblem() {
    document.getElementById('math-problem').textContent = '…';
    document.getElementById('math-status').textContent = '';
    document.getElementById('math-result-msg').textContent = '⏳ Host generiert Aufgabe…';
    document.getElementById('math-answer-input').disabled = true;
    document.getElementById('math-answer-btn').disabled = true;
  }

  async function submitAnswerOnline() {
    if (!roundActive || myAnswerSent || !currentProblem) return;
    var val = parseInt(document.getElementById('math-answer-input').value, 10);
    if (isNaN(val)) return;
    myAnswerSent = true;
    document.getElementById('math-answer-input').disabled = true;
    document.getElementById('math-answer-btn').disabled = true;
    var patch = isHost ? { hostAnswer: val } : { guestAnswer: val };
    await sendState(patch);
    document.getElementById('math-status').textContent = '⏳ Antwort gesendet, warte…';
  }

  function processResult(st) {
    if (!roundActive) return;
    var hAns = st.hostAnswer, gAns = st.guestAnswer;
    if (hAns === null || gAns === null) return; // not both answered yet
    roundActive = false;
    var correct = st.answer;
    var hCorrect = hAns === correct;
    var gCorrect = gAns === correct;
    var hostWins = hCorrect && (!gCorrect);
    var guestWins = gCorrect && (!hCorrect);
    // tie: no points
    if (isHost) {
      if (hostWins) myScore++; else if (guestWins) oppScore++;
    } else {
      if (guestWins) myScore++; else if (hostWins) oppScore++;
    }
    updateDisplay();
    var me = isHost ? hAns : gAns;
    var won = isHost ? hostWins : guestWins;
    document.getElementById('math-result-msg').textContent = won ? '✅ Du warst schneller!' : ((!hCorrect&&!gCorrect)?'❌ Beide falsch! Antwort: '+correct : '😞 Gegner war schneller! Antwort: '+correct);
    document.getElementById('math-result-msg').style.color = won ? '#00ff88' : '#ff4466';
    round++;
    if (round > total || myScore >= 3 || oppScore >= 3) {
      setTimeout(endMatchOnline, 1600);
    } else {
      setTimeout(function(){
        if (isHost) generateAndSendProblem(); else waitForProblem();
      }, 1800);
    }
  }

  function endMatchOnline() {
    mathOn = false;
    if (mathPollInterval) { clearInterval(mathPollInterval); mathPollInterval = null; }
    var won = myScore >= 3;
    var overlay = document.getElementById('ttt-overlay');
    var msg = document.getElementById('ttt-overlay-msg');
    msg.textContent = won ? '🏆 Du hast gewonnen! '+myScore+':'+oppScore : '😞 Du hast verloren! '+myScore+':'+oppScore;
    overlay.classList.add('show');
    if (won) { saveHS('math', myScore*10); sounds.highscore && sounds.highscore(); }
  }

  // polling
  var lastRoundSeen = 0;
  mathPollInterval = setInterval(async function(){
    if (!mathOn || !mathLobbyId) return;
    try {
      var res = await fetch(API_URL+'/api/lobby/'+lobbyId);
      if (!res.ok) return;
      var lobby = await res.json();
      var st = lobby.game_state;
      if (!st) return;
      // guest: receive new problem
      if (!isHost && st.round && st.round !== lastRoundSeen && st.problem) {
        lastRoundSeen = st.round;
        currentProblem = { text: st.problem, answer: st.answer };
        myAnswerSent = false;
        roundActive = true;
        document.getElementById('math-problem').textContent = currentProblem.text + ' = ?';
        document.getElementById('math-result-msg').textContent = '';
        document.getElementById('math-status').textContent = '';
        document.getElementById('math-answer-input').disabled = false;
        document.getElementById('math-answer-btn').disabled = false;
        document.getElementById('math-answer-input').value = '';
        document.getElementById('math-answer-input').focus();
        if (st.hostScore !== undefined) { if(isHost){myScore=st.hostScore;oppScore=st.guestScore;}else{myScore=st.guestScore;oppScore=st.hostScore;} updateDisplay(); }
      }
      // both: check if both answered
      if (roundActive && st.hostAnswer !== null && st.guestAnswer !== null && st.round === lastRoundSeen) {
        processResult(st);
      }
    } catch(e) {}
  }, 500);

  var answerInput = document.getElementById('math-answer-input');
  var answerBtn = document.getElementById('math-answer-btn');
  function onAnsKey(e) { if (e.key==='Enter') submitAnswerOnline(); }
  answerInput.addEventListener('keydown', onAnsKey);
  answerBtn.onclick = submitAnswerOnline;

  updateDisplay();
  if (isHost) { lastRoundSeen = 1; generateAndSendProblem(); } else { lastRoundSeen = 0; waitForProblem(); }

  game = {
    stop: function() {
      mathOn = false;
      if (mathPollInterval) { clearInterval(mathPollInterval); mathPollInterval = null; }
      answerInput.removeEventListener('keydown', onAnsKey);
      answerBtn.onclick = null;
    }
  };
}
