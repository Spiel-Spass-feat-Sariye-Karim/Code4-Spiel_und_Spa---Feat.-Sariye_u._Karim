// Backend Server URL
var API_URL = 'https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com';

var game=null,which='',user=null;
var heartbeatInterval=null,requestsInterval=null,chatInterval=null;
var lastChatCount=0;
var allUsersCache=[],friendIdsSet=new Set(),sentRequestIds=new Set();
var activeChatFriend=null,privateChatInterval=null,unreadInterval=null;
var friendsList=[],unreadCounts={};
var inviteInterval=null,seenInviteIds=new Set(),lobbyAiDiff='easy',hostWaitInterval=null;
var tttBoard=Array(9).fill(''),tttOn=false,tttIsAI=false,tttAiDiff='easy';
var tttCurrentTurn='X',tttMySymbol='X',tttIsHost=true,tttLobbyId=null,tttPollInterval=null,tttLastPlaced=-1;

/* ---- DARK/LIGHT MODE ---- */
(function() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light');
  }
})();

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
  return (u.memory||0) + (u.stack||0) + (u.precision||0) + (u.guess||0) + (u.wordle||0);
}

/* ---- ONLINE STATUS ---- */
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
    var online = users.filter(function(u) { return u.is_online; });
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

async function sendGameInvite(toId, btn) {
  if (!user) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var lobRes = await fetch(API_URL + '/api/lobby/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host_id: user.id, game_type: 'tictactoe' })
    });
    var lobby = await lobRes.json();
    if (!lobRes.ok || !lobby.id) { if (btn) { btn.disabled = false; btn.textContent = 'Einladen'; } return; }
    await fetch(API_URL + '/api/lobby/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: lobby.id, from_id: user.id, to_id: toId })
    });
    if (btn) { btn.textContent = '✓ Gesendet'; }
    showToast('⚔️ Einladung gesendet!');
    tttLobbyId = lobby.id; tttIsHost = true; tttMySymbol = 'X';
    // Poll until guest joins, then start game for host
    if (hostWaitInterval) clearInterval(hostWaitInterval);
    hostWaitInterval = setInterval(async function() {
      try {
        var r = await fetch(API_URL + '/api/lobby/' + lobby.id);
        if (!r.ok) return;
        var lo = await r.json();
        if (lo.status === 'playing') {
          clearInterval(hostWaitInterval); hostWaitInterval = null;
          openG('multiplayer');
          setTimeout(function() { tttStartOnline(lobby.id, true); }, 80);
        }
      } catch(e) {}
    }, 2000);
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
    invites.forEach(function(inv) {
      if (seenInviteIds.has(inv.id)) return;
      seenInviteIds.add(inv.id);
      showInviteToast(inv);
    });
  } catch (e) {}
}

function showInviteToast(inv) {
  var t = document.createElement('div');
  t.className = 'toast toast-invite';
  var seed = inv.avatar_seed || inv.from_name || 'unknown';
  var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;
  t.innerHTML =
    '<div class="toast-invite-top"><img class="toast-av" src="' + av + '" alt=""><span>⚔️ <b>' + escHtml(inv.from_name) + '</b> lädt dich ein!</span></div>' +
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
    openG('multiplayer');
    setTimeout(function() { tttStartOnline(inv.lobby_id, false); }, 80);
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
  tttPollInterval = setInterval(tttPollOnline, 2000);
}

async function tttPollOnline() {
  if (!tttOn || !tttLobbyId || tttIsAI) return;
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
    // Online: Zug IMMER zuerst senden (auch bei Spielende), damit Gegner das Ergebnis sieht
    fetch(API_URL + '/api/lobby/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobby_id: tttLobbyId, user_id: user.id, move: idx })
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

/* ---- PRIVATE CHAT ---- */
async function loadUnreadCounts() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/chat/unread/' + user.id);
    if (!res.ok) return;
    var data = await res.json();
    if (!Array.isArray(data)) return;
    unreadCounts = {};
    data.forEach(function(item) { unreadCounts[item.friend_id] = item.count; });
    updateSidebarBadges();
  } catch (e) {}
}

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
  privateChatInterval = setInterval(loadPrivateMessages, 5000);
  if (unreadCounts[friend.id]) { unreadCounts[friend.id] = 0; updateSidebarBadges(); }
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('expanded');
}

function closePrivateChat() {
  if (privateChatInterval) { clearInterval(privateChatInterval); privateChatInterval = null; }
  activeChatFriend = null;
  document.getElementById('private-chat-modal').classList.remove('open');
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
    var reactionDisplay = f.reaction_ms > 0 ? f.reaction_ms + 'ms' : '-';
    html +=
      '<div class="friend-row">' +
      '<img class="fr-avatar" src="' + av + '" alt="">' +
      '<div class="fr-info">' +
      '<div class="fr-name">' + f.name + '</div>' +
      '<div class="fr-status">' + formatLastSeen(f.last_seen, f.is_online) + '</div>' +
      '</div>' +
      '<div class="fr-scores">' + (f.memory||0) + '&nbsp;/&nbsp;' + (f.stack||0) + '&nbsp;/&nbsp;' + reactionDisplay + '</div>' +
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
  chatInterval = setInterval(loadGlobalChat, 10000);
  // Sidebar + Unread-Counts
  document.getElementById('sidebar').classList.add('visible');
  document.getElementById('sidebar-mobile-btn').classList.add('visible');
  unreadCounts = {};
  loadUnreadCounts();
  if (unreadInterval) clearInterval(unreadInterval);
  unreadInterval = setInterval(loadUnreadCounts, 5000);
  // Heartbeat starten
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  fetch(API_URL + '/api/users/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) });
  heartbeatInterval = setInterval(function() {
    if (user) fetch(API_URL + '/api/users/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) });
  }, 30000);
  // Anfragen periodisch prüfen
  if (requestsInterval) clearInterval(requestsInterval);
  requestsInterval = setInterval(function() { loadFriendRequests(); }, 60000);
  // Spiel-Einladungen pollen
  seenInviteIds = new Set();
  if (inviteInterval) clearInterval(inviteInterval);
  inviteInterval = setInterval(checkGameInvites, 3000);
  // Theme-Button Emoji setzen
  var themeBtn = document.getElementById('btn-theme');
  if (themeBtn) themeBtn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
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
if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
closePrivateChat();
friendsList = []; unreadCounts = {}; seenInviteIds = new Set(); tttOn = false;
document.getElementById('sidebar').classList.remove('visible', 'expanded');
document.getElementById('sidebar-mobile-btn').classList.remove('visible');
// Online-Status setzen
if (user) {
  try { await fetch(API_URL + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) }); } catch(e) {}
}
sessionStorage.setItem('logged_out', 'true');
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
    '<div class="hs-row"><span>💻 Info-Wordle</span><span>' + badge(user.wordle||0) + (user.wordle||0) + '</span></div>';
  var total = getScoreTotal(user);
  var rankEl = document.getElementById('stat-rank');
  if (rankEl) rankEl.textContent = getRank(total);
}

/* ---- GLOBALES SCOREBOARD ---- */
async function loadGlobalHS() {
try {
  var res = await fetch(API_URL + '/api/global-highscores');

  if (!res.ok) {
    document.getElementById("global-hs").innerHTML = "Fehler beim Laden";
    return;
  }


  var scores = await res.json();

  if (!scores || !Array.isArray(scores)) return;

  var html = "";
  scores.forEach(function(item, i) {
    var rankClass = "";
    if (i === 0) rankClass = "top1";
    else if (i === 1) rankClass = "top2";
    else if (i === 2) rankClass = "top3";

    var meClass = (user && item.name === user.name) ? "me" : "";
    var seed = item.avatar_seed || item.name || "unknown";
    var av = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + seed;

    var reactionDisplay = item.reaction_ms > 0 ? item.reaction_ms + 'ms' : '-';
    html +=
      '<div class="global-row ' + meClass + '">' +
      '<div class="rank ' + rankClass + '">#' + (i+1) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
      '<img src="' + av + '" style="width:24px;height:24px;border-radius:50%;flex-shrink:0">' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.name + '</span>' +
      '<span style="font-size:0.7rem;color:var(--dim);flex-shrink:0">' + getRank((item.memory||0)+(item.stack||0)+(item.precision||0)+(item.guess||0)+(item.wordle||0)) + '</span>' +
      '</div>' +
      '<div class="score" style="font-size:0.78rem">' + (item.memory||0) + '&nbsp;/&nbsp;' + (item.stack||0) + '&nbsp;/&nbsp;' + reactionDisplay + '</div>' +
      '</div>';
  });

  document.getElementById("global-hs").innerHTML = html || "Noch keine Scores";
} catch (err) {
  console.error('Fehler beim Laden der Highscores:', err);
  document.getElementById("global-hs").innerHTML = "Fehler beim Laden";
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
document.getElementById('card-multiplayer').addEventListener('click', function() { openG('multiplayer'); });
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
document.getElementById('btn-vs-ai').addEventListener('click', function() { tttStart(lobbyAiDiff); });
document.querySelectorAll('.diff-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.diff-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    lobbyAiDiff = this.dataset.diff;
  });
});
document.getElementById('ttt-rematch-btn').addEventListener('click', tttRematch);
document.getElementById('pc-close').addEventListener('click', closePrivateChat);
document.getElementById('pc-send').addEventListener('click', sendPrivateMessage);
document.getElementById('pc-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendPrivateMessage(); });

function openG(id) {
  which = id;
  var titles = { memory: 'Farb-Gedächtnis', stack: 'Turm-Stapler', reaction: 'Reaktionstest', bubble: 'Bubble Pop', guess: 'Zahlen-Raten', wordle: 'Info-Wordle', multiplayer: '⚔️ Duell' };
  document.getElementById('gtitle').textContent = titles[id] || id;
  document.getElementById('pts').textContent = '0';
  var canvas = document.getElementById('c');
  var pads = document.getElementById('memory-pads');
  var memStatus = document.getElementById('memory-status');
  var reactionArea = document.getElementById('reaction-area');
  var guessArea = document.getElementById('guess-area');
  var wordleArea = document.getElementById('wordle-area');
  var lobbyArea = document.getElementById('lobby-area');
  canvas.style.display = 'none';
  pads.classList.remove('active');
  memStatus.classList.remove('active');
  reactionArea.classList.remove('active');
  guessArea.classList.remove('active');
  wordleArea.classList.remove('active');
  lobbyArea.classList.remove('active');
  document.getElementById('pbot-pts-wrap').style.display = '';
  document.getElementById('btn-again').style.display = 'inline-block';
  if (id === 'memory') {
    pads.classList.add('active');
    memStatus.classList.add('active');
  } else if (id === 'stack' || id === 'bubble') {
    canvas.style.display = 'block';
  } else if (id === 'reaction') {
    reactionArea.classList.add('active');
  } else if (id === 'guess') {
    guessArea.classList.add('active');
  } else if (id === 'wordle') {
    wordleArea.classList.add('active');
  } else if (id === 'multiplayer') {
    lobbyArea.classList.add('active');
  }
  document.getElementById('popup').classList.add('on');
  runG();
}

function closeG() {
  if (game) { game.stop(); game = null; }
  if (tttPollInterval) { clearInterval(tttPollInterval); tttPollInterval = null; }
  if (hostWaitInterval) { clearInterval(hostWaitInterval); hostWaitInterval = null; }
  tttOn = false;
  document.getElementById('popup').classList.remove('on');
  document.getElementById('memory-pads').classList.remove('active');
  document.getElementById('memory-status').classList.remove('active');
  document.getElementById('reaction-area').classList.remove('active');
  document.getElementById('guess-area').classList.remove('active');
  document.getElementById('wordle-area').classList.remove('active');
  document.getElementById('lobby-area').classList.remove('active');
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
    c.width = 380; c.height = 420;
    game = bubblePop(c);
  } else if (which === 'guess') {
    game = guessGame();
  } else if (which === 'wordle') {
    game = wordleGame();
  } else if (which === 'multiplayer') {
    loadLobbyScreen();
  } else {
    c.width = 380; c.height = 420;
    game = stack(c);
  }
}

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
  var cur={x:0,w:120,dir:1,spd:3};
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
    cur.dir=cur.x<W/2?1:-1;cur.spd=Math.min(7,3+sc*0.18);
    if(ly.length*lH>H-80)bY+=lH;
  }

  cv.addEventListener('click',drop);
  loop();
  return{stop:function(){on=false;cancelAnimationFrame(raf);cv.removeEventListener('click',drop)}};
}

/* ---- SPIEL 3: REAKTIONSTEST ---- */
function reaction() {
  var btn = document.getElementById('reaction-btn');
  var status = document.getElementById('reaction-status');
  var on = true;
  var waiting = true;
  var startTime = null;
  var timeout = null;

  function arm() {
    waiting = true;
    startTime = null;
    btn.className = '';
    btn.textContent = '⏳';
    status.textContent = 'Warte auf das Signal...';
    var delay = 1000 + Math.random() * 3000;
    timeout = setTimeout(function() {
      if (!on) return;
      waiting = false;
      startTime = Date.now();
      btn.classList.add('ready');
      btn.textContent = 'JETZT!';
      status.textContent = 'Klick so schnell du kannst!';
    }, delay);
  }

  function handleClick() {
    if (!on) return;
    if (waiting) {
      clearTimeout(timeout);
      btn.textContent = '❌';
      status.textContent = 'Zu früh! Warte auf Grün.';
      setTimeout(function() { if (on) arm(); }, 1500);
      return;
    }
    var ms = Date.now() - startTime;
    on = false;
    btn.classList.remove('ready');
    btn.textContent = ms + ' ms';
    status.textContent = ms + ' ms — ' + (ms < 250 ? '⚡ Blitz!' : ms < 400 ? '🟢 Gut!' : ms < 600 ? '🟡 OK' : '🔴 Langsam');
    document.getElementById('pts').textContent = ms + 'ms';
    sounds.highscore();
    saveHS('reaction', ms); // ms direkt speichern, niedrigerer Wert = besser
  }

  btn.addEventListener('click', handleClick);
  arm();

  return {
    stop: function() {
      on = false;
      clearTimeout(timeout);
      btn.removeEventListener('click', handleClick);
      btn.className = '';
      btn.textContent = '⏳';
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

document.getElementById("avatar").style.cursor = "pointer";
document.getElementById("avatar").addEventListener("click",
function() {
var seed = user.avatar_seed || user.name;
document.getElementById("profile-avatar").src =
"https://api.dicebear.com/7.x/adventurer/svg?seed=" + seed;
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
);
document.getElementById("btn-close-profile").addEventListener("click",
function() {
document.getElementById("profile-overlay").classList.remove("on");
}
);
document.getElementById("btn-new-avatar").addEventListener("click",
async function() {
var newSeed = Math.random().toString(36).substring(2, 10);
try {
  var res = await fetch(API_URL + '/api/user/' + user.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_seed: newSeed })
  });

  if (res.ok) {
    user.avatar_seed = newSeed;
    var url = "https://api.dicebear.com/7.x/adventurer/svg?seed=" + newSeed;
    document.getElementById("avatar").src = url;
    document.getElementById("profile-avatar").src = url;
    loadGlobalHS();
  }
} catch (err) {
  console.error('Fehler beim Aktualisieren des Avatars:', err);
}
}
);
