// Backend Server URL
var API_URL = 'https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com';

var game=null,which='',user=null;
var currentActivity='main'; // tracks what the user is doing for live status
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
var pongPollInterval=null,pongLobbyId=null,pongIsHost=false,pongIsAI=false,pongAiDiff='easy',pongOn=false;
// RPS
var rpsPollInterval=null,rpsLobbyId=null,rpsIsHost=false,rpsIsAI=false,rpsAiDiff='easy',rpsOn=false;
// Chess
var chessPollInterval=null,chessLobbyId=null,chessIsHost=false,chessIsAI=false,chessAiDiff='easy',chessOn=false;
var chessState=null,chessSelected=-1,chessValidMoves=[],chessLastMoveFrom=-1,chessLastMoveTo=-1,chessMyColor='w';
var chessMoveInFlight=false; // true while our move is being sent to server (prevent poll overwrite)

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
function getRank(total) {
  if (total >= 300) return '👑 Legende';
  if (total >= 150) return '⭐ Veteran';
  if (total >= 50)  return '🔥 Profi';
  if (total >= 10)  return '🎮 Spieler';
  return '🌱 Neuling';
}
function getScoreTotal(u) {
  return (u.memory||0) + (u.stack||0) + (u.precision||0) + (u.guess||0) + (u.wordle||0) + (u.flappy||0);
}

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

async function loadLiveActivity() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/live-activity');
    if (!res.ok) return;
    var people = await res.json();
    // Exclude self
    people = people.filter(function(p) { return p.id !== user.id; });
    var container = document.getElementById('live-activity-list');
    if (!container) return;
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
    document.getElementById('live-count').textContent = people.length;
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

function formatLastSeen(last_seen, is_online) {
  if (is_online) return '<span class="online-dot green"></span>Online';
  if (!last_seen) return '<span class="online-dot gray"></span>Offline';
  var diff = Date.now() - new Date(last_seen).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 5) return '<span class="online-dot yellow"></span>Gerade eben';
  if (mins < 60) return '<span class="online-dot yellow"></span>Vor ' + mins + ' Min.';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return '<span class="online-dot gray"></span>Vor ' + hours + ' Std.';
  var days = Math.floor(hours / 24);
  return '<span class="online-dot gray"></span>Vor ' + days + ' Tag' + (days > 1 ? 'en' : '');
}

/* ---- GLOBAL CHAT ---- */
async function loadGlobalChat() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/chat/global?limit=50');
    if (!res.ok) return;
    var msgs = await res.json();
    if (!Array.isArray(msgs)) return;
    var win = document.getElementById('chat-window');
    if (!win) return;
    var wasAtBottom = win.scrollHeight - win.scrollTop - win.clientHeight < 40;
    var html = '';
    var reversed = msgs.slice().reverse();
    reversed.forEach(function(m) {
      var isOwn = m.user_id === user.id;
      var seed = m.avatar_seed || m.user_name || 'unknown';
      var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
      var time = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="chat-msg' + (isOwn ? ' own' : '') + '">' +
        '<img class="chat-avatar" src="' + av + '" alt="">' +
        '<div class="chat-bubble">' +
        '<div class="chat-meta"><span class="chat-name">' + escHtml(m.user_name) + '</span><span class="chat-time">' + time + '</span></div>' +
        '<div class="chat-text">' + escHtml(m.message) + '</div>' +
        '</div>' +
        '</div>';
    });
    win.innerHTML = html;
    if (wasAtBottom || lastChatCount === 0) win.scrollTop = win.scrollHeight;
    lastChatCount = msgs.length;
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
    await fetch(API_URL + '/api/lobby/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: lobby.id, from_id: user.id, to_id: toId })
    });
    if (btn) { btn.textContent = '✓ Gesendet'; }
    var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
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
          } else if (gameType === 'pong') {
            openG('pong');
            setTimeout(function() { pongStartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'rps') {
            openG('rps');
            setTimeout(function() { rpsStartOnline(lobby.id, true); }, 80);
          } else if (gameType === 'chess') {
            openG('chess');
            setTimeout(function() { chessStartOnline(lobby.id, true); }, 80);
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
      var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
      showLocalNotif(
        '⚔️ Spieleinladung',
        (inv.from_name || 'Jemand') + ' lädt dich zu ' + (gameNames[inv.game_type]||'einem Spiel') + ' ein!'
      );
    });
  } catch (e) {}
}

function showInviteToast(inv) {
  var t = document.createElement('div');
  t.className = 'toast toast-invite';
  var seed = inv.avatar_seed || inv.from_name || 'unknown';
  var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
  var gameIcons = { tictactoe:'⚔️', connect4:'🔴', pong:'🏓', rps:'✊', chess:'♟️' };
  var gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
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
    } else if (gt === 'pong') {
      openG('pong');
      setTimeout(function() { pongStartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'rps') {
      openG('rps');
      setTimeout(function() { rpsStartOnline(inv.lobby_id, false); }, 80);
    } else if (gt === 'chess') {
      openG('chess');
      setTimeout(function() { chessStartOnline(inv.lobby_id, false); }, 80);
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
  } else if (which === 'pong') {
    if (pongPollInterval) { clearInterval(pongPollInterval); pongPollInterval = null; }
    pongOn = false; pongLobbyId = null;
    if (game) { game.stop(); game = null; }
    var cv = document.getElementById('c'); cv.style.display = 'none'; cv.style.width = ''; cv.style.height = '';
    if (pongIsAI) { pongStart(pongAiDiff); } else { document.getElementById('pong-area').classList.add('active'); loadPongLobbyScreen(); }
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
        // Show message preview if available (server now returns latest_message)
        var preview = item.latest_message ? item.latest_message.slice(0, 80) : 'Hat dir geschrieben.';
        showLocalNotif('💬 ' + name, preview);
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
    html +=
      '<div class="sidebar-friend" data-id="' + f.id + '">' +
      '<div class="sidebar-friend-av-wrap">' +
      '<img class="sidebar-friend-av" src="' + av + '" alt="">' +
      '<span class="sidebar-unread-badge" style="display:' + (count > 0 ? 'flex' : 'none') + '">' + count + '</span>' +
      '</div>' +
      '<div class="sidebar-friend-info">' +
      '<div class="sidebar-friend-name">' + escHtml(f.name) + '</div>' +
      '<div class="sidebar-friend-status">' + (f.is_online ? '<span class="online-dot green"></span>Online' : '<span class="online-dot gray"></span>Offline') + '</div>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.sidebar-friend').forEach(function(el) {
    el.addEventListener('click', function() {
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
    var msgs = await res.json();
    if (!Array.isArray(msgs)) return;
    var container = document.getElementById('pc-messages');
    if (!container) return;
    var wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    var html = '';
    msgs.slice().reverse().forEach(function(m) {
      var isOwn = m.sender_id === user.id;
      var av = isOwn
        ? 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + (user.avatar_seed || user.name)
        : 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + (activeChatFriend.avatar_seed || activeChatFriend.name);
      var name = isOwn ? user.name : activeChatFriend.name;
      var time = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="chat-msg' + (isOwn ? ' own' : '') + '">' +
        '<img class="chat-avatar" src="' + av + '" alt="">' +
        '<div class="chat-bubble">' +
        '<div class="chat-meta"><span class="chat-name">' + escHtml(name) + '</span><span class="chat-time">' + time + '</span></div>' +
        '<div class="chat-text">' + escHtml(m.message) + '</div>' +
        '</div>' +
        '</div>';
    });
    container.innerHTML = html;
    if (wasAtBottom || container.scrollTop === 0) container.scrollTop = container.scrollHeight;
    if (unreadCounts[activeChatFriend.id]) { unreadCounts[activeChatFriend.id] = 0; updateSidebarBadges(); }
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
      showLocalNotif('👥 Freundschaftsanfrage', (newest.name||'Jemand') + ' möchte dich als Freund hinzufügen!');
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
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    var target = tab.dataset.tab; // 'login' oder 'register'
    // Alle Tabs und Formulare zuruecksetzen
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.remove('active');
    });
    document.querySelectorAll('.auth-form').forEach(function(f) {
      f.classList.remove('active');
    });
    // Aktiven Tab markieren und passendes Formular zeigen
    tab.classList.add('active');
    document.getElementById('form-' + target).classList.add('active');
    // Fehlermeldung zuruecksetzen
    document.getElementById('login-err').textContent = '';
  });
});

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

  setLoading('btn-register', true, 'Registrieren');

  try {
    var res = await fetch(API_URL + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, pass: p1, pass2: p2 })
    });
    var data = await res.json();
    if (!res.ok || !data.user) {
      e.textContent = data.error || 'Registrierung fehlgeschlagen.';
      setLoading('btn-register', false, 'Registrieren');
      return;
    }
    user = data.user;
    sessionStorage.removeItem('logged_out');
    setLoading('btn-register', false, 'Registrieren');
    enterApp();
  } catch (err) {
    e.textContent = 'Verbindungsfehler zum Server!';
    setLoading('btn-register', false, 'Registrieren');
  }
});

/* ---- LOGIN ---- */
document.getElementById('btn-login').addEventListener('click', async function() {
  var n = document.getElementById('login-name').value.trim();
  var p = document.getElementById('login-pass').value;
  var e = document.getElementById('login-err');

  if (!n || !p) { e.textContent = 'Bitte beides ausfüllen.'; return; }
  if (n.length < 2) { e.textContent = 'Name zu kurz.'; return; }

  setLoading('btn-login', true, 'Einloggen');

  try {
    var res = await fetch(API_URL + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, pass: p })
    });
    var data = await res.json();
    if (!res.ok || !data.user) {
      e.textContent = data.error || 'Login fehlgeschlagen.';
      setLoading('btn-login', false, 'Einloggen');
      return;
    }
    user = data.user;
    localStorage.setItem('lastUser', n);
    sessionStorage.removeItem('logged_out');
    setLoading('btn-login', false, 'Einloggen');
    enterApp();
  } catch (err) {
    e.textContent = 'Verbindungsfehler zum Server!';
    setLoading('btn-login', false, 'Einloggen');
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
  unreadCounts = {};
  loadUnreadCounts._initialized = false; // reset so first load doesn't trigger notifs for old messages
  loadUnreadCounts();
  if (unreadInterval) clearInterval(unreadInterval);
  unreadInterval = setInterval(loadUnreadCounts, 5000);
  // Heartbeat starten
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 20000);
  // Live Activity Panel
  loadLiveActivity();
  if (window._liveActivityInterval) clearInterval(window._liveActivityInterval);
  window._liveActivityInterval = setInterval(loadLiveActivity, 2000);
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

  // ── Neon orbs ──
  var orbs = [];
  for (var o = 0; o < 8; o++) {
    orbs.push({
      x: Math.random() * 1000, y: Math.random() * 800,
      vx: (Math.random()-0.5)*0.35, vy: (Math.random()-0.5)*0.35,
      r: 60+Math.random()*80, hue: Math.random()*360,
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

  // ── Character rain ──
  function drawRain() {
    COLS_RAIN = Math.max(1, Math.floor(W / 18));
    while (rain.length < COLS_RAIN) rain.push({ y: Math.random()*-100, speed:0.4+Math.random()*0.7, bright:false });
    for (var i = 0; i < Math.min(rain.length, COLS_RAIN); i++) {
      var col = rain[i];
      var cx = i * (W / COLS_RAIN) + (W / COLS_RAIN / 2);
      col.y += col.speed;
      if (col.y > H + 20) { col.y = -Math.random()*200; col.bright = Math.random()>0.85; col.speed = 0.4+Math.random()*0.7; }
      var ch = rainChars[Math.floor(Math.random()*rainChars.length)];
      if (col.bright) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.shadowColor = '#ff5733'; ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = 'rgba(255,87,51,0.18)';
        ctx.shadowBlur = 0;
      }
      ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(ch, cx, col.y);
      ctx.shadowBlur = 0;
    }
  }

  // ── Orbs ──
  function drawOrbs() {
    for (var i = 0; i < orbs.length; i++) {
      var ob = orbs[i];
      ob.x += ob.vx; ob.y += ob.vy;
      if (ob.x < -ob.r) ob.x = W + ob.r;
      if (ob.x > W + ob.r) ob.x = -ob.r;
      if (ob.y < -ob.r) ob.y = H + ob.r;
      if (ob.y > H + ob.r) ob.y = -ob.r;
      ob.hue = (ob.hue + 0.1) % 360;
      var pulse = 0.9 + 0.1 * Math.sin(t * 0.02 + ob.phase);
      var gr = ctx.createRadialGradient(ob.x, ob.y, 0, ob.x, ob.y, ob.r * pulse);
      var h = ob.hue;
      gr.addColorStop(0, 'hsla(' + h + ',100%,70%,0.06)');
      gr.addColorStop(1, 'hsla(' + h + ',100%,50%,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r * pulse, 0, Math.PI*2); ctx.fill();
    }
  }

  // ── Particles ──
  function drawParticles() {
    if (t % 8 === 0) addParticle();
    parts = parts.filter(function(p){ return p.life > 0; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba('+p.rgb+','+p.life*0.7+')'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx*7, p.y - p.vy*7);
      ctx.strokeStyle = 'rgba('+p.rgb+','+p.life*0.25+')'; ctx.lineWidth=p.r*0.7; ctx.stroke();
    }
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

  // ── Main loop ──
  function frame() {
    if (!arcadeCanvas) return;
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
localStorage.removeItem('notif_asked'); // ask again next login
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
document.getElementById("reg-name").value = "";
document.getElementById("reg-pass").value = "";
document.getElementById("reg-pass2").value = "";
document.getElementById("login-err").textContent = "";
// Zurück zum Anmelden-Tab
document.querySelector('.tab[data-tab="login"]')
.click();
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
  document.getElementById('hs-list').innerHTML =
    '<div class="hs-row"><span>🧠 Farb-Gedächtnis</span><span>' + badge(user.memory||0) + (user.memory||0) + '</span></div>' +
    '<div class="hs-row"><span>🧱 Turm-Stapler</span><span>' + badge(user.stack||0) + (user.stack||0) + '</span></div>' +
    '<div class="hs-row"><span>⚡ Reaktionstest</span><span>' + reactionDisplay + '</span></div>' +
    '<div class="hs-row"><span>🫧 Bubble Pop</span><span>' + badge(user.precision||0) + (user.precision||0) + '</span></div>' +
    '<div class="hs-row"><span>🔢 Zahlen-Raten</span><span>' + badge(user.guess||0) + (user.guess||0) + '</span></div>' +
    '<div class="hs-row"><span>💻 Info-Wordle</span><span>' + badge(user.wordle||0) + (user.wordle||0) + '</span></div>' +
    '<div class="hs-row"><span>🐦 Flappy Bird</span><span>' + badge(user.flappy||0) + (user.flappy||0) + '</span></div>';
  var total = getScoreTotal(user);
  var rankEl = document.getElementById('stat-rank');
  if (rankEl) rankEl.textContent = getRank(total);
}

/* ---- GLOBALES SCOREBOARD ---- */
async function loadGlobalHS() {
  try {
    var res = await fetch(API_URL + '/api/global-highscores');
    if (!res.ok) { document.getElementById('global-hs').innerHTML = '<p class="sb-empty">Fehler beim Laden</p>'; return; }
    var scores = await res.json();
    if (!scores || !Array.isArray(scores) || !scores.length) {
      document.getElementById('global-hs').innerHTML = '<p class="sb-empty">Noch keine Scores</p>';
      return;
    }

    function avUrl(item) {
      return 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + encodeURIComponent(item.avatar_seed || item.name || 'x');
    }
    function isMeClass(item) { return (user && item.name === user.name) ? ' sb-me' : ''; }
    function medal(i) {
      if (i === 0) return '🥇';
      if (i === 1) return '🥈';
      if (i === 2) return '🥉';
      return (i+1)+'';
    }

    // Helpers for formatting per-game score cells
    function fmtVal(val, key) {
      if (!val || val === 0) return '<span style="opacity:0.3">—</span>';
      if (key === 'reaction_ms') return '<span class="sbt-val-num">'+val+'</span><span class="sbt-val-unit">ms</span>';
      if (key === 'stack') return '<span class="sbt-val-num">'+val+'</span><span class="sbt-val-unit"> Et.</span>';
      return '<span class="sbt-val-num">'+val+'</span>';
    }

    // Build unified table — top 15 players sorted by RP
    var cols = [
      { key:'memory',      th:'🧠', label:'Gedächtnis', cls:'sbt-memory'   },
      { key:'stack',       th:'🧱', label:'Turm',       cls:'sbt-stack'    },
      { key:'reaction_ms', th:'⚡', label:'Reaktion',   cls:'sbt-reaction' },
      { key:'precision',   th:'🫧', label:'Bubble',     cls:'sbt-bubble'   },
      { key:'guess',       th:'🔢', label:'Zahlen',     cls:'sbt-guess'    },
      { key:'wordle',      th:'💻', label:'Wordle',     cls:'sbt-wordle'   },
      { key:'flappy',      th:'🐦', label:'Flappy',     cls:'sbt-flappy'   }
    ];

    var thead = '<thead><tr>' +
      '<th class="sbt-th-rank"></th>' +
      '<th class="sbt-th-player">Spieler</th>' +
      '<th class="sbt-divider-after sbt-rp-col" style="min-width:44px">RP<span class="sbt-th-label">Rang-Pkt.</span></th>';
    for (var ci = 0; ci < cols.length; ci++) {
      thead += '<th class="'+cols[ci].cls+'">'+cols[ci].th+'<span class="sbt-th-label">'+cols[ci].label+'</span></th>';
    }
    thead += '</tr></thead>';

    var tbody = '<tbody>';
    var limit = Math.min(15, scores.length);
    for (var i = 0; i < limit; i++) {
      var s = scores[i];
      var total = (s.memory||0)+(s.stack||0)+(s.precision||0)+(s.guess||0)+(s.wordle||0)+(s.flappy||0);
      var meClass = isMeClass(s) ? ' sbt-me' : '';
      tbody += '<tr class="sbt-row'+meClass+'">' +
        '<td class="sbt-td-rank">'+medal(i)+'</td>' +
        '<td class="sbt-td-player">' +
          '<div class="sbt-player-inner">' +
            '<img src="'+avUrl(s)+'" class="sb-av" loading="lazy">' +
            '<span class="sbt-player-name">'+escHtml(s.name)+'</span>' +
            '<span class="sbt-rank-badge">'+getRank(total)+'</span>' +
          '</div>' +
        '</td>' +
        '<td class="sbt-td-rp sbt-divider-after">'+(s.rank_points||0)+'<span class="sbt-rp-unit"> RP</span></td>';
      for (var ci = 0; ci < cols.length; ci++) {
        tbody += '<td class="sbt-td-val">'+fmtVal(s[cols[ci].key], cols[ci].key)+'</td>';
      }
      tbody += '</tr>';
    }
    if (limit === 0) tbody += '<tr><td colspan="11" class="sb-empty">Noch keine Einträge</td></tr>';
    tbody += '</tbody>';

    var html = '<div class="sb-unified">' +
      '<div class="sb-unified-header">🏆 Gesamtranking — alle Spiele</div>' +
      '<div class="sb-table-wrap"><table class="sb-table">'+thead+tbody+'</table></div>' +
      '</div>';

    document.getElementById('global-hs').innerHTML = html;
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
document.getElementById('card-pong').addEventListener('click', function() { openG('pong'); });
document.getElementById('card-rps').addEventListener('click', function() { openG('rps'); });
document.getElementById('card-chess').addEventListener('click', function() { openG('chess'); });
document.getElementById('btn-x').addEventListener('click', closeG);
document.getElementById('btn-again').addEventListener('click', resetG);
document.getElementById('popup').addEventListener('click', function(e) { if (e.target === this) closeG(); });
document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChatMessage(); });
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
    if (panel._resetDragPosition) panel._resetDragPosition();
    return;
  }
  panel.classList.add('open');
  loadGlobalChat();
  setTimeout(function() {
    var w = document.getElementById('chat-window');
    if (w) w.scrollTop = w.scrollHeight;
  }, 80);
});
document.getElementById('gc-close').addEventListener('click', function() {
  var panel = document.getElementById('global-chat-panel');
  panel.classList.remove('open');
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
document.getElementById('btn-pong-ai').addEventListener('click', function() { pongStart(pongAiDiff); });
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

function openG(id) {
  which = id;
  var titles = { memory: 'Farb-Gedächtnis', stack: 'Turm-Stapler', reaction: 'Reaktionstest', bubble: 'Bubble Pop', guess: 'Zahlen-Raten', wordle: 'Info-Wordle', flappy: '🐦 Flappy Bird', multiplayer: '⚔️ TicTacToe Duell', connect4: '🔴 4 Gewinnt', pong: '🏓 Pong', rps: '✊ Schere Stein Papier', chess: '♟️ Schach' };
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
  var pongArea = document.getElementById('pong-area');
  var rpsArea = document.getElementById('rps-area');
  var chessArea = document.getElementById('chess-area');
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
  rpsArea.classList.remove('active');
  chessArea.classList.remove('active');
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
  } else if (id === 'pong') {
    pongArea.classList.add('active');
  } else if (id === 'rps') {
    rpsArea.classList.add('active');
  } else if (id === 'chess') {
    chessArea.classList.add('active');
  }
  document.getElementById('popup').classList.add('on');
  stopArcadeParticles();
  // Track activity for live status
  var activityMap = { memory:'singleplayer:memory', stack:'singleplayer:stack', reaction:'singleplayer:reaktion',
    bubble:'singleplayer:bubble', guess:'singleplayer:zahlen', wordle:'singleplayer:wordle', flappy:'singleplayer:flappy',
    multiplayer:'multiplayer:tictactoe', connect4:'multiplayer:connect4', pong:'multiplayer:pong',
    rps:'multiplayer:rps', chess:'multiplayer:schach' };
  currentActivity = activityMap[id] || ('singleplayer:'+id);
  runG();
}

function closeG() {
  if (game) { game.stop(); game = null; }
  if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
  if (c4PollInterval) { clearInterval(c4PollInterval); c4PollInterval = null; }
  if (pongPollInterval) { clearInterval(pongPollInterval); pongPollInterval = null; }
  if (rpsPollInterval) { clearInterval(rpsPollInterval); rpsPollInterval = null; }
  if (chessPollInterval) { clearInterval(chessPollInterval); chessPollInterval = null; }
  if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
  tttOn = false; c4On = false; pongOn = false; rpsOn = false; chessOn = false;
  document.getElementById('ttt-overlay').classList.remove('show');
  document.getElementById('popup').classList.remove('on');
  currentActivity = 'main';
  startArcadeParticles();
  document.getElementById('memory-pads').classList.remove('active');
  document.getElementById('memory-status').classList.remove('active');
  document.getElementById('reaction-area').classList.remove('active');
  document.getElementById('guess-area').classList.remove('active');
  document.getElementById('wordle-area').classList.remove('active');
  document.getElementById('lobby-area').classList.remove('active');
  document.getElementById('c4-area').classList.remove('active');
  document.getElementById('pong-area').classList.remove('active');
  document.getElementById('rps-area').classList.remove('active');
  document.getElementById('chess-area').classList.remove('active');
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
  if (which === 'pong') {
    if (pongPollInterval) { clearInterval(pongPollInterval); pongPollInterval = null; }
    pongOn = false; pongLobbyId = null;
    if (game) { game.stop(); game = null; }
    var cv = document.getElementById('c');
    cv.style.display = 'none'; cv.style.width = ''; cv.style.height = '';
    document.getElementById('ttt-overlay').classList.remove('show');
    document.getElementById('pong-area').classList.add('active');
    loadPongLobbyScreen();
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
  } else if (which === 'pong') {
    loadPongLobbyScreen();
  } else if (which === 'rps') {
    loadRpsLobbyScreen();
  } else if (which === 'chess') {
    loadChessLobbyScreen();
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
  var ctx=cv.getContext('2d'),W=380,H=420,on=true,raf,sc=0;
  var ly=[{x:W/2-60,w:120}];
  var cur={x:0,w:120,dir:1,spd:2};
  var bY=H-25,lH=22;
  var co=['#e8573a','#e88a3a','#e8c83a','#3ae87a','#3ab8e8','#6a3ae8','#e83a9b'];

  function loop(){
    if(!on)return;raf=requestAnimationFrame(loop);
    cur.x+=cur.dir*cur.spd;
    if(cur.x+cur.w>W||cur.x<0)cur.dir*=-1;
    // Zeichnen
    ctx.fillStyle='#0c0c14';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#333';for(var i=0;i<25;i++)ctx.fillRect((i*67)%W,(i*43)%H,1.5,1.5);
    for(var i=0;i<ly.length;i++){ctx.fillStyle=co[i%co.length];ctx.fillRect(ly[i].x,bY-i*lH,ly[i].w,lH-2)}
    var cy=bY-ly.length*lH;
    ctx.fillStyle=co[ly.length%co.length];ctx.shadowColor=co[ly.length%co.length];ctx.shadowBlur=10;
    ctx.fillRect(cur.x,cy,cur.w,lH-2);ctx.shadowBlur=0;
  }

  function drop(){
    if(!on)return;
    var p=ly[ly.length-1];
    var oL=Math.max(cur.x,p.x),oR=Math.min(cur.x+cur.w,p.x+p.w),oW=oR-oL;
    if(oW<=0){on=false;saveHS('stack',sc);gg(ctx,W,H,sc);return}
    ly.push({x:oL,w:oW});sc++;document.getElementById('pts').textContent=sc;
    cur.w=oW;cur.x=Math.random()<0.5?0:W-cur.w;
    cur.dir=cur.x<W/2?1:-1;cur.spd=Math.min(5,2+sc*0.12);
    if(ly.length*lH>H-80)bY+=lH;
  }

  function keyDrop(e){if(e.code==='Space'||e.key===' '){e.preventDefault();drop();}}
  cv.addEventListener('click',drop);
  document.addEventListener('keydown',keyDrop);
  loop();
  return{stop:function(){on=false;cancelAnimationFrame(raf);cv.removeEventListener('click',drop);document.removeEventListener('keydown',keyDrop);}};
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
  var statusEl = document.getElementById('guess-status');
  var input = document.getElementById('guess-input');
  var btn = document.getElementById('guess-btn');
  var history = document.getElementById('guess-history');

  input.value = ''; input.disabled = false; btn.disabled = false;
  history.innerHTML = '';
  statusEl.textContent = 'Errate die Zahl zwischen 1 und 100!';

  function handleGuess() {
    if (!on) return;
    var val = parseInt(input.value);
    if (isNaN(val) || val < 1 || val > 100) {
      statusEl.textContent = '⚠️ Zahl zwischen 1 und 100 eingeben!'; return;
    }
    tries++;
    input.value = '';
    var entry = document.createElement('div');
    entry.className = 'guess-entry';
    if (val === secret) {
      on = false;
      var score = Math.max(0, 100 - (tries - 1) * 10);
      entry.textContent = val + ' ✅ Richtig!'; entry.style.color = '#4caf50';
      history.appendChild(entry); history.scrollTop = history.scrollHeight;
      statusEl.textContent = '🎉 Gefunden in ' + tries + ' Versuch' + (tries > 1 ? 'en' : '') + '! +' + score + ' Punkte';
      document.getElementById('pts').textContent = score;
      btn.disabled = true; input.disabled = true;
      sounds.highscore(); saveHS('guess', score);
    } else {
      var hint = val < secret ? val + ' ⬇️ Zu niedrig!' : val + ' ⬆️ Zu hoch!';
      entry.textContent = hint; entry.style.color = val < secret ? '#42a5f5' : '#ff7043';
      history.appendChild(entry); history.scrollTop = history.scrollHeight;
      var remaining = 10 - tries;
      statusEl.textContent = 'Versuch ' + tries + '/10 — noch ' + remaining + ' übrig';
      document.getElementById('pts').textContent = Math.max(0, 100 - tries * 10);
      if (tries >= 10) {
        on = false;
        statusEl.textContent = '💀 Game Over! Die Zahl war ' + secret;
        btn.disabled = true; input.disabled = true;
        saveHS('guess', 0);
      }
    }
  }

  btn.addEventListener('click', handleGuess);
  function keyHandler(e) { if (e.key === 'Enter') { e.preventDefault(); handleGuess(); } }
  input.addEventListener('keydown', keyHandler);

  return {
    stop: function() {
      on = false;
      btn.removeEventListener('click', handleGuess);
      input.removeEventListener('keydown', keyHandler);
      btn.disabled = false; input.disabled = false;
    }
  };
}

/* ---- SPIEL 6: INFO-WORDLE ---- */
var WORDLE_WORDS = ['PIXEL', 'BYTES', 'CLICK', 'DATEN', 'NETZT', 'VIRUS', 'CACHE', 'LOGIN', 'MAILS', 'CLOUD', 'CODES', 'INPUT', 'LINKS', 'MEDIA', 'SHARE', 'SCOUT', 'SMART', 'TASTE', 'WLANS', 'HANDY'];

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
      if (!WORDLE_VALID_WORDS.has(guessWord)) {
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

document.getElementById("avatar").style.cursor = "pointer";
document.getElementById("avatar").addEventListener("click", function() {
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
  refreshNotifToggle();
});

document.getElementById("btn-close-profile").addEventListener("click", function() {
  document.getElementById("profile-overlay").classList.remove("on");
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
  if (c4PollInterval) clearInterval(c4PollInterval);
  c4PollInterval = setInterval(c4PollOnline, 400);
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
        fetch(API_URL+'/api/lobby/move', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({lobby_id:lobbyId, user_id:user.id, move:col})
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
  if(pongPollInterval)clearInterval(pongPollInterval);
  pongPollInterval=setInterval(pongPollOnline, isHost?50:40);
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
  var TARGET_DT=1000/60; // 16.67ms = one frame at 60fps
  // Ball speed by difficulty
  var speedMap={easy:2.0, medium:3.2, hard:5.0};
  var baseSpeed=speedMap[diff]||3.2;
  var ball={x:W/2,y:H/2,vx:(isHost||isAI)?baseSpeed:0,vy:baseSpeed*0.6};
  var padL={x:20,y:H/2-PH/2};   // left = host
  var padR={x:W-20-PW,y:H/2-PH/2}; // right = guest
  var sc={l:0,r:0};
  var myPad=isHost?padL:padR;
  var srvState=null;

  function rrect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#030310'; ctx.fillRect(0,0,W,H);
    // Center line
    ctx.setLineDash([8,10]); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();
    ctx.setLineDash([]);
    // Scores
    ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='bold 36px sans-serif'; ctx.textAlign='center';
    ctx.fillText(sc.l, W/4, 50);
    ctx.fillText(sc.r, 3*W/4, 50);
    ctx.font='11px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.fillText(isHost?'← Du':'← Gegner', W/4, 65);
    ctx.fillText(isHost?'Gegner →':'Du →', 3*W/4, 65);
    // Paddles
    ctx.fillStyle='#818cf8'; rrect(ctx,padL.x,padL.y,PW,PH,5); ctx.fill();
    ctx.fillStyle='#34d399'; rrect(ctx,padR.x,padR.y,PW,PH,5); ctx.fill();
    // Ball
    ctx.beginPath(); ctx.arc(ball.x,ball.y,BR,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=20;
    ctx.fill(); ctx.shadowBlur=0;
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
    // Delta-time: normalise to 60fps so speed is frame-rate independent
    var dt = lastTs ? Math.min((ts - lastTs) / TARGET_DT, 3) : 1;
    lastTs = ts;
    if(isHost||isAI){
      physics(dt);
      if(isAI){
        var aiSpd=baseSpeed*0.65; // AI paddle speed scales with ball speed
        var tgt=ball.y-PH/2;
        padR.y+=Math.sign(tgt-padR.y)*Math.min(aiSpd*dt,Math.abs(tgt-padR.y));
        padR.y=Math.max(0,Math.min(H-PH,padR.y));
      }
      if(!isAI&&lobbyId){
        var now=Date.now();
        if(now-lastPush>45){
          lastPush=now;
          fetch(API_URL+'/api/lobby/state',{
            method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:{bx:Math.round(ball.x),by:Math.round(ball.y),bvx:ball.vx,bvy:ball.vy,lpy:Math.round(padL.y),rpy:Math.round(padR.y),sl:sc.l,sr:sc.r}})
          });
        }
      }
      if(sc.l>=MAX||sc.r>=MAX){
        // Force push final score so guest sees game end
        if(!isAI&&lobbyId){
          fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:{bx:Math.round(ball.x),by:Math.round(ball.y),sl:sc.l,sr:sc.r,gameOver:true}})});
        }
        on=false; pongOn=false;
        if(pongPollInterval){clearInterval(pongPollInterval);pongPollInterval=null;}
        var win=(sc.l>=MAX&&isHost)||(sc.r>=MAX&&!isHost);
        if(raf)cancelAnimationFrame(raf);
        draw(); setTimeout(function(){pongGameOver(win?'win':'lose');},400); return;
      }
    } else if(!isAI&&srvState){
      // Snap to server position when we have new state
      if(srvState.bx!==undefined){ ball.x=srvState.bx; ball.vx=srvState.bvx||ball.vx; }
      if(srvState.by!==undefined){ ball.y=srvState.by; ball.vy=srvState.bvy||ball.vy; }
      if(srvState.lpy!==undefined)padL.y=srvState.lpy;
      if(srvState.sl!==undefined)sc.l=srvState.sl;
      if(srvState.sr!==undefined)sc.r=srvState.sr;
      document.getElementById('pts').textContent=sc.r;
      if(sc.l>=MAX||sc.r>=MAX||srvState.gameOver){
        on=false;pongOn=false;
        if(pongPollInterval){clearInterval(pongPollInterval);pongPollInterval=null;}
        if(raf)cancelAnimationFrame(raf);
        draw(); setTimeout(function(){pongGameOver(sc.r>=MAX?'win':'lose');},400); return;
      }
      // Client-side extrapolation: run local physics between server snapshots
      // This makes the ball move smoothly at 60fps instead of jerking every 80ms
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      // Bounce off top/bottom locally (can't score locally — host handles that)
      if(ball.y-BR<=0){ball.y=BR;ball.vy=Math.abs(ball.vy);}
      if(ball.y+BR>=H){ball.y=H-BR;ball.vy=-Math.abs(ball.vy);}
    }
    draw();
    raf=requestAnimationFrame(loop);
  }

  function movePad(e) {
    e.preventDefault();
    var rect=cv.getBoundingClientRect();
    var scaleY = H / rect.height;
    var cY=e.touches?e.touches[0].clientY:e.clientY;
    myPad.y=Math.max(0,Math.min(H-PH,(cY-rect.top)*scaleY-PH/2));
    if(!isAI&&!isHost&&lobbyId){
      fetch(API_URL+'/api/lobby/state',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({lobby_id:lobbyId,user_id:user.id,patch:{rpy:Math.round(padR.y)}})
      });
    }
  }

  cv.addEventListener('mousemove',movePad);
  cv.addEventListener('touchmove',movePad,{passive:false});
  raf=requestAnimationFrame(loop);

  return {
    stop:function(){on=false;if(raf)cancelAnimationFrame(raf);cv.removeEventListener('mousemove',movePad);cv.removeEventListener('touchmove',movePad);},
    applyState:function(state){
      if(!state||isHost)return;
      srvState=state;
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
    chessMoveInFlight=true; // block poll from overwriting until server confirms + propagates
    fetch(API_URL+'/api/lobby/state',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lobby_id:chessLobbyId,user_id:user.id,patch:{chessState:chessState,lastFrom:from,lastTo:to}})
    }).finally(function(){
      // Wait 600ms after server confirms — Supabase needs time to propagate the write
      // to the read path so the next poll won't return a stale pre-move state
      setTimeout(function(){ chessMoveInFlight=false; }, 600);
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
  if(isHost){chessState=chessInitState();chessSelected=-1;chessValidMoves=[];chessLastMoveFrom=-1;chessLastMoveTo=-1;}
  buildChessBoard();if(chessState)renderChessBoard();
  document.getElementById('chess-player-info').innerHTML=
    '<span class="chess-you">'+(isHost?'♔ Du (Weiß)':'♚ Du (Schwarz)')+'</span>';
  document.getElementById('btn-again').style.display='none';
  if(chessPollInterval)clearInterval(chessPollInterval);
  chessPollInterval=setInterval(chessPollOnline,120);
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
    for (var i = 0; i < 6; i++) {
      particles.push({
        x: BIRD_X, y: by,
        vx: (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 2,
        life: 1, color: ['#ffd700','#ff8c00','#fff'][Math.floor(Math.random()*3)]
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

  /* ---- drawing ---- */

  function drawBackground(ts) {
    /* Gradient sky: deep night purple → dark indigo → slight city-glow at horizon */
    var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0,    '#060615');
    sky.addColorStop(0.45, '#0d0d2b');
    sky.addColorStop(0.78, '#1a0a2e');
    sky.addColorStop(1,    '#2d0e3a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND);

    /* Stars with twinkle */
    stars.forEach(function(s) {
      var bright = 0.55 + 0.45 * Math.sin(ts / 900 + s.phase);
      ctx.globalAlpha = bright;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    /* City skyline silhouette */
    cityBuildings.forEach(function(b) {
      var bx = b.x;
      var by2 = GROUND - b.h;

      /* Building body */
      var bg = ctx.createLinearGradient(bx, by2, bx + b.w, by2);
      bg.addColorStop(0, '#120825');
      bg.addColorStop(1, '#1a0e30');
      ctx.fillStyle = bg;
      ctx.fillRect(bx, by2, b.w, b.h);

      /* Neon window grid */
      var cols = Math.floor(b.w / 7);
      var rows2 = Math.floor(b.h / 9);
      for (var wr = 0; wr < rows2; wr++) {
        for (var wc = 0; wc < cols; wc++) {
          if (Math.random() > 0.55) continue; // sparse
          var wx = bx + 3 + wc * 7;
          var wy = by2 + 4 + wr * 9;
          var colors = ['#00eeff','#ff00cc','#aaff00','#ffcc00','#ff4488'];
          ctx.fillStyle = colors[Math.floor((wx * 7 + wy * 13) % colors.length)];
          ctx.globalAlpha = 0.55 + 0.35 * Math.sin(ts / 1200 + wx + wy);
          ctx.fillRect(wx, wy, 4, 4);
        }
      }
      ctx.globalAlpha = 1;

      /* Building top antenna/edge glow */
      ctx.strokeStyle = 'rgba(180,100,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by2, b.w, b.h);
    });
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
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 18;

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
      if (trail.length > 10) trail.shift();

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
