// Backend Server URL
var API_URL = 'https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com';

var game=null,which='',user=null,dailyGame=null,dailyMeta=null;
var heartbeatInterval=null,requestsInterval=null;
var allUsersCache=[],friendIdsSet=new Set(),sentRequestIds=new Set();

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
    done.bullseye = true; showToast('🎯 Scharfschütze! 80+ Präzision!');
  }
  if (!done.mastermind && (user.guess || 0) >= 90) {
    done.mastermind = true; showToast('🧠 Mastermind! 90+ beim Raten!');
  }
  if (!done.wordmaster && (user.wordle || 0) >= 80) {
    done.wordmaster = true; showToast('💻 Wortmeister! Wordle gemeistert!');
  }
  localStorage.setItem('achievements', JSON.stringify(done));
}

/* ---- TÄGLICHE CHALLENGE ---- */
var DAILY_MINI_GAMES = [
  { id: 0, name: 'Farb-Match', description: 'Farbname erscheint in anderer Farbe - ist Text und Farbe gleich?', fn: colorMatchMini },
  { id: 1, name: 'Zahlen-Folge', description: 'Kurze Zahlenfolge merken und danach eintippen.', fn: numberSequenceMini },
  { id: 2, name: 'Doppel-Klick-Timing', description: 'Treffe 1000ms zwischen zwei Klicks so genau wie möglich.', fn: doubleClickTimingMini },
  { id: 3, name: 'Emoji-Suche', description: 'Finde das Ziel-Emoji im Grid so schnell wie möglich.', fn: emojiSearchMini },
  { id: 4, name: 'Buchstaben-Regen', description: 'Nur Vokale anklicken, Konsonanten ignorieren.', fn: letterRainMini },
  { id: 5, name: 'Muster-Kopie', description: 'Merke dir ein kurzes Muster und baue es nach.', fn: patternCopyMini },
  { id: 6, name: 'Schnell-Rechnen', description: 'Löse 10 einfache Mathe-Aufgaben so schnell wie möglich.', fn: quickMathMini },
  { id: 7, name: 'Farb-Sequenz', description: 'Wiederhole die Farbsequenz mit sechs Farben.', fn: colorSequenceMini },
  { id: 8, name: 'Ziel-Stopp', description: 'Stoppe den bewegenden Balken so nah wie möglich bei 50%.', fn: targetStopMini },
  { id: 9, name: 'Wort-Scramble', description: 'Entschlüssele das vertauschte Informatik-Wort.', fn: wordScrambleMini },
  { id: 10, name: 'Klick-Rhythmus', description: 'Klicke im Takt der vorgegebenen Sequenz.', fn: rhythmClickMini },
  { id: 11, name: 'Zahlen-Sortierung', description: 'Sortiere fünf Zahlen in aufsteigender Reihenfolge.', fn: numberSortMini },
  { id: 12, name: 'Farb-Mischer', description: 'Stelle die Ziel-RGB-Farbe mit Reglern nach.', fn: colorMixerMini },
  { id: 13, name: 'Reaktions-Kette', description: 'Klicke fünf aufleuchtende Buttons in der Reihenfolge.', fn: reactionChainMini },
  { id: 14, name: 'Buchstaben-Zähler', description: 'Schätze, wie oft ein Buchstabe im kurzen Text vorkommt.', fn: letterCountMini },
  { id: 15, name: 'Ping-Pong-Klick', description: 'Klicke im richtigen Moment, wenn der Ball zurückkommt.', fn: pingPongClickMini },
  { id: 16, name: 'Speicher-Grid', description: 'Merke das aufleuchtende 3x3-Feld und klicke es danach nach.', fn: memoryGridMini },
  { id: 17, name: 'Wort-Tipp-Speed', description: 'Tippe das angezeigte Wort so schnell wie möglich ab.', fn: typingSpeedMini },
  { id: 18, name: 'Zahlen-Kreuz', description: 'Finde die fehlende Zahl in der einfachen Gleichung.', fn: numberCrossMini },
  { id: 19, name: 'Icon-Gedächtnis', description: 'Merke sechs Icons und wähle sie anschließend aus zwölf aus.', fn: iconMemoryMini },
  { id: 20, name: 'Balance-Klick', description: 'Balance die Waage aus durch gezielte Klicks.', fn: balanceClickMini },
  { id: 21, name: 'Schnell-Augen', description: 'Sieh dir kurz Punkte an und gib die Zahl ein.', fn: quickEyesMini },
  { id: 22, name: 'Tastatur-Sprint', description: 'Tippe die zufällige Buchstabenfolge so schnell wie möglich.', fn: keyboardSprintMini },
  { id: 23, name: 'Farbfeld-Unterschied', description: 'Welche Farbe ist dunkler oder heller?', fn: colorDifferenceMini },
  { id: 24, name: 'Morse-Code', description: 'Erkenne die einfache Morse-Sequenz und errate den Buchstaben.', fn: morseCodeMini },
  { id: 25, name: 'Pixel-Art-Kopie', description: 'Zeichne das kleine 5x5 Pixel-Bild nach.', fn: pixelArtMini },
  { id: 26, name: 'Zahlen-Memory', description: 'Decke gleiche Zahlen-Paare auf wie beim Memory.', fn: numberMemoryMini },
  { id: 27, name: 'Wort-Kette', description: 'Finde ein Wort, das mit dem letzten Buchstaben des vorherigen Wortes beginnt.', fn: wordChainMini },
  { id: 28, name: 'Reaktions-Stop', description: 'Stoppe den Countdown so genau wie möglich bei 0.', fn: reactionStopMini },
  { id: 29, name: 'Speed-Kategorien', description: 'Klicke schnell, ob der Begriff Tier, Pflanze oder Technik ist.', fn: categorySpeedMini }
];

function getDayOfYear(date) {
  var start = new Date(date.getFullYear(), 0, 0);
  var diff = date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
  return Math.floor(diff / 86400000);
}

async function loadDailyChallenge() {
  try {
    var res = await fetch(API_URL + '/api/daily-challenge');
    var data = await res.json();
    if (!res.ok || data.game_id === undefined) return;
    dailyGame = data.game_id;
    dailyMeta = data;
    document.getElementById('challenge-game-name').textContent = data.game_name;
    document.getElementById('challenge-game-desc').textContent = data.game_description;
    loadDailyScores();
  } catch (err) {
    document.getElementById('challenge-game-name').textContent = 'Nicht verfügbar';
    document.getElementById('challenge-game-desc').textContent = '';
    document.getElementById('daily-scores-list').innerHTML = '<span style="color:var(--dim);font-size:0.8rem">Nicht verfügbar</span>';
  }
}

async function loadDailyScores() {
  try {
    var res = await fetch(API_URL + '/api/daily-scores');
    var data = await res.json();
    if (!res.ok) throw new Error('Fehler');
    var html = '';
    if (!data.scores || data.scores.length === 0) {
      html = '<div style="color:var(--dim);font-size:0.82rem;padding:0.3rem 0">Noch keine Scores heute!</div>';
    } else {
      data.scores.forEach(function(item, i) {
        var meClass = (user && item.name === user.name) ? 'me' : '';
        var rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
        html += '<div class="daily-row ' + meClass + '">' +
          '<span class="daily-rank">' + rankEmoji + '</span>' +
          '<span class="daily-name">' + item.name + '</span>' +
          '<span class="daily-score">' + item.score + '</span>' +
          '</div>';
      });
    }
    document.getElementById('daily-scores-list').innerHTML = html;
  } catch (err) {
    document.getElementById('daily-scores-list').innerHTML = '<span style="color:var(--dim);font-size:0.8rem">Nicht verfügbar</span>';
  }
}

/* ---- FREUNDE V2 ---- */

async function loadFriends() {
  if (!user) return;
  try {
    var res = await fetch(API_URL + '/api/friends/' + user.id);
    var friends = await res.json();
    if (!res.ok || !Array.isArray(friends)) { renderFriendsBoard([]); return; }
    friendIdsSet = new Set(friends.map(function(f) { return f.id; }));
    renderFriendsBoard(friends);
  } catch (err) {
    document.getElementById('friends-list').innerHTML = '<span style="color:var(--dim);font-size:0.82rem">Nicht verfügbar</span>';
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
  loadDailyChallenge();
  loadFriends();
  loadFriendRequests();
  // Heartbeat starten
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  fetch(API_URL + '/api/users/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) });
  heartbeatInterval = setInterval(function() {
    if (user) fetch(API_URL + '/api/users/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) });
  }, 30000);
  // Anfragen periodisch prüfen
  if (requestsInterval) clearInterval(requestsInterval);
  requestsInterval = setInterval(function() { loadFriendRequests(); }, 60000);
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
    } else {
      if (s > (user[g] || 0)) user[g] = s;
    }
    
    showHS();
    loadGlobalHS();
    loadStats();
    loadDailyChallenge();
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
    '<div class="hs-row"><span>🎯 Klick-Präzision</span><span>' + badge(user.precision||0) + (user.precision||0) + '</span></div>' +
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
document.getElementById('card-precision').addEventListener('click', function() { openG('precision'); });
document.getElementById('card-guess').addEventListener('click', function() { openG('guess'); });
document.getElementById('card-wordle').addEventListener('click', function() { openG('wordle'); });
document.getElementById('btn-challenge-play').addEventListener('click', function() {
  if (dailyGame !== null) openG('daily_' + dailyGame);
});
document.getElementById('btn-x').addEventListener('click', closeG);
document.getElementById('btn-again').addEventListener('click', resetG);
document.getElementById('popup').addEventListener('click', function(e) { if (e.target === this) closeG(); });

function openG(id) {
  which = id;
  var titles = { memory: 'Farb-Gedächtnis', stack: 'Turm-Stapler', reaction: 'Reaktionstest', precision: 'Klick-Präzision', guess: 'Zahlen-Raten', wordle: 'Info-Wordle' };
  document.getElementById('gtitle').textContent = titles[id] || (dailyMeta ? dailyMeta.game_name : id);
  document.getElementById('pts').textContent = '0';
  var canvas = document.getElementById('c');
  var pads = document.getElementById('memory-pads');
  var memStatus = document.getElementById('memory-status');
  var reactionArea = document.getElementById('reaction-area');
  var guessArea = document.getElementById('guess-area');
  var wordleArea = document.getElementById('wordle-area');
  var dailyArea = document.getElementById('daily-area');
  canvas.style.display = 'none';
  pads.classList.remove('active');
  memStatus.classList.remove('active');
  reactionArea.classList.remove('active');
  guessArea.classList.remove('active');
  wordleArea.classList.remove('active');
  dailyArea.classList.remove('active');
  if (id === 'memory') {
    pads.classList.add('active');
    memStatus.classList.add('active');
  } else if (id === 'stack' || id === 'precision') {
    canvas.style.display = 'block';
  } else if (id === 'reaction') {
    reactionArea.classList.add('active');
  } else if (id === 'guess') {
    guessArea.classList.add('active');
  } else if (id === 'wordle') {
    wordleArea.classList.add('active');
  } else if (id.startsWith('daily_')) {
    dailyArea.classList.add('active');
  }
  document.getElementById('popup').classList.add('on');
  runG();
}

function closeG() {
  if (game) { game.stop(); game = null; }
  document.getElementById('popup').classList.remove('on');
  document.getElementById('memory-pads').classList.remove('active');
  document.getElementById('memory-status').classList.remove('active');
  document.getElementById('reaction-area').classList.remove('active');
  document.getElementById('guess-area').classList.remove('active');
  document.getElementById('wordle-area').classList.remove('active');
  document.getElementById('daily-area').classList.remove('active');
}

function resetG() {
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
  } else if (which === 'precision') {
    c.width = 380; c.height = 420;
    game = precision(c);
  } else if (which === 'guess') {
    game = guessGame();
  } else if (which === 'wordle') {
    game = wordleGame();
  } else if (which.startsWith('daily_')) {
    c.style.display = 'none';
    game = dailyMiniGame(parseInt(which.split('_')[1], 10));
  } else {
    c.width = 380; c.height = 420;
    game = stack(c);
  }
}

function fillDailyArea(html) {
  var area = document.getElementById('daily-area');
  area.innerHTML = html;
  return area;
}

function dailyMiniGame(id) {
  var meta = DAILY_MINI_GAMES.find(function(item) { return item.id === id; });
  if (!meta || typeof meta.fn !== 'function') {
    fillDailyArea('<div class="daily-panel"><div class="daily-text">Dieses Spiel ist derzeit nicht verfügbar.</div></div>');
    return { stop: function() {} };
  }
  return meta.fn(id);
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function createTimerDisplay(area, initial) {
  var el = document.createElement('div');
  el.className = 'daily-timer';
  el.textContent = initial || '';
  area.appendChild(el);
  return el;
}

function createStatusDisplay(area, initial) {
  var el = document.createElement('div');
  el.className = 'daily-status';
  el.textContent = initial || '';
  area.appendChild(el);
  return el;
}

function createButton(text) {
  var btn = document.createElement('button');
  btn.className = 'daily-button';
  btn.textContent = text;
  return btn;
}

function createCell(value, extraClass) {
  var btn = document.createElement('button');
  btn.className = 'daily-cell' + (extraClass ? ' ' + extraClass : '');
  btn.type = 'button';
  btn.textContent = value;
  return btn;
}

function colorMatchMini(id) {
  var rounds = 10;
  var score = 0;
  var current = 0;
  var active = true;
  var words = ['ROT', 'BLAU', 'GRÜN', 'GELB'];
  var cols = ['red', 'blue', 'green', 'gold'];
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><div class="daily-grid daily-grid-3"></div></div>');
  var status = createStatusDisplay(area, 'Triff die richtige Entscheidung.');
  var grid = area.querySelector('.daily-grid');
  var btnYes = createButton('Ja');
  var btnNo = createButton('Nein');
  grid.appendChild(btnYes);
  grid.appendChild(btnNo);
  function nextRound() {
    if (!active) return;
    if (current >= rounds) return finish();
    var wordIdx = getRandomInt(0, words.length - 1);
    var colorIdx = getRandomInt(0, cols.length - 1);
    var question = area.querySelector('#daily-question');
    question.textContent = words[wordIdx];
    question.style.color = cols[colorIdx];
    question.style.fontSize = '2rem';
    question.style.fontWeight = '800';
    question.style.textTransform = 'uppercase';
    area.querySelector('.daily-status').textContent = 'Runde ' + (current + 1) + ' von ' + rounds;
    btnYes.onclick = function() { checkAnswer(wordIdx === colorIdx); };
    btnNo.onclick = function() { checkAnswer(wordIdx !== colorIdx); };
  }
  function checkAnswer(correct) {
    if (!active) return;
    if (correct) { score++; area.querySelector('.daily-status').textContent = 'Richtig!'; }
    else { area.querySelector('.daily-status').textContent = 'Falsch!'; }
    current++;
    setTimeout(nextRound, 600);
  }
  function finish() {
    active = false;
    document.getElementById('pts').textContent = score;
    area.querySelector('.daily-status').textContent = 'Fertig! Du hast ' + score + ' Punkte erreicht.';
    saveHS('daily_' + id, score);
  }
  nextRound();
  return { stop: function() { active = false; btnYes.onclick = null; btnNo.onclick = null; } };
}

function numberSequenceMini(id) {
  var rounds = 4;
  var length = 4;
  var score = 0;
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><input id="daily-answer" class="daily-input" placeholder="Zahlenfolge eingeben" autocomplete="off"><div class="daily-controls"></div></div>');
  var status = createStatusDisplay(area, 'Merke dir die Folge.');
  var input = area.querySelector('#daily-answer');
  var controls = area.querySelector('.daily-controls');
  var btn = createButton('Prüfen'); controls.appendChild(btn);
  var sequence = '';
  function nextRound() {
    if (!active) return;
    if (rounds <= 0) return finish();
    sequence = '';
    for (var i = 0; i < length; i++) sequence += getRandomInt(1, 9);
    var question = area.querySelector('#daily-question');
    question.textContent = sequence.split('').join(' ');
    area.querySelector('.daily-status').textContent = 'Länge: ' + length + ' Zeichen. Merke dir die Zahlen.';
    input.value = '';
    btn.disabled = true;
    setTimeout(function() {
      question.textContent = 'Jetzt eintippen!';
      btn.disabled = false;
      input.focus();
    }, 2500);
  }
  function submit() {
    if (!active) return;
    var answer = input.value.trim();
    if (answer === sequence) { score += 10; status.textContent = 'Richtig!'; }
    else { status.textContent = 'Falsch – richtig wäre ' + sequence + '.'; }
    rounds--; length++;
    setTimeout(nextRound, 800);
  }
  btn.onclick = submit;
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });
  function finish() {
    active = false;
    document.getElementById('pts').textContent = score;
    status.textContent = 'Ende! Score: ' + score;
    saveHS('daily_' + id, score);
  }
  nextRound();
  return { stop: function() { active = false; btn.onclick = null; } };
}

function doubleClickTimingMini(id) {
  var active = true;
  var start = null;
  var clickedOnce = false;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Klicke zweimal: erst Start, dann so nah wie möglich an 1000ms.</div><div class="daily-controls"></div></div>');
  var status = createStatusDisplay(area, 'Erster Klick startet die Messung.');
  var controls = area.querySelector('.daily-controls');
  var btn = createButton('Start'); controls.appendChild(btn);
  btn.onclick = function() {
    if (!active) return;
    if (!clickedOnce) {
      clickedOnce = true; start = Date.now(); btn.textContent = 'Jetzt erneut klicken'; status.textContent = 'Warte auf den zweiten Klick...';
    } else {
      var diff = Date.now() - start;
      var score = Math.max(0, 1000 - Math.abs(diff - 1000));
      document.getElementById('pts').textContent = score;
      status.textContent = 'Du hast ' + diff + 'ms getroffen. Score: ' + score;
      active = false;
      saveHS('daily_' + id, score);
    }
  };
  return { stop: function() { active = false; btn.onclick = null; } };
}

function emojiSearchMini(id) {
  var active = true;
  var score = 0;
  var target = null;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><div class="daily-grid"></div></div>');
  var status = createStatusDisplay(area, 'Finde das Ziel-Emoji.');
  var grid = area.querySelector('.daily-grid');
  var emojis = ['🍎','🍊','🍌','🍉','🍇','🍓','🍒','🍍','🥑','🥥','🥕','🥦','🌶️','🍆','🥔','🥭'];
  function render() {
    grid.innerHTML = '';
    var options = shuffleArray(emojis);
    target = options[0];
    area.querySelector('#daily-question').textContent = 'Finde dieses Emoji: ' + target;
    for (var i = 0; i < 16; i++) {
      var cell = createCell(options[i] || emojis[i]);
      cell.onclick = function() { if (!active) return; if (this.textContent === target) { score = 100; status.textContent = 'Richtig!'; saveHS('daily_' + id, score); active = false; document.getElementById('pts').textContent = score; } else { status.textContent = 'Falsch! Versuch es nochmal.'; } };
      grid.appendChild(cell);
    }
  }
  render();
  return { stop: function() { active = false; grid.querySelectorAll('button').forEach(function(btn) { btn.onclick = null; }); } };
}

function letterRainMini(id) {
  var round = 0;
  var score = 0;
  var active = true;
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><div class="daily-controls"></div></div>');
  var status = createStatusDisplay(area, 'Klicke nur Vokale.');
  var controls = area.querySelector('.daily-controls');
  var btnYes = createButton('Vokal');
  var btnNo = createButton('Konsonant');
  controls.appendChild(btnYes); controls.appendChild(btnNo);
  function next() {
    if (!active) return;
    if (round >= 10) return finish();
    round++;
    var letter = letters[getRandomInt(0, letters.length - 1)];
    area.querySelector('#daily-question').textContent = letter;
    status.textContent = 'Runde ' + round + ' von 10';
    btnYes.onclick = function() { check('AEIOUY'.includes(letter)); };
    btnNo.onclick = function() { check(!'AEIOUY'.includes(letter)); };
  }
  function check(correct) {
    if (!active) return;
    if (correct) { score += 10; status.textContent = 'Richtig!'; }
    else { status.textContent = 'Falsch!'; }
    next();
  }
  function finish() { active = false; document.getElementById('pts').textContent = score; saveHS('daily_' + id, score); status.textContent = 'Fertig! Score: ' + score; }
  next();
  return { stop: function() { active = false; btnYes.onclick = null; btnNo.onclick = null; } };
}

function patternCopyMini(id) {
  var active = true;
  var pattern = shuffleArray(['▲','●','■','◆']).slice(0, 4);
  var position = 0;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Merke dir das Muster und klicke es danach nach.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var grid = area.querySelector('.daily-grid');
  var status = area.querySelector('.daily-status');
  var display = document.createElement('div'); display.className = 'daily-text'; display.textContent = pattern.join(' ');
  area.insertBefore(display, grid);
  var inputGrid = document.createElement('div'); inputGrid.className = 'daily-grid daily-grid-3';
  area.appendChild(inputGrid);
  var choices = shuffleArray(pattern.concat(shuffleArray(['◯','✦','△','■']).slice(0, 2)));
  choices.forEach(function(symbol) {
    var cell = createCell(symbol);
    cell.onclick = function() { if (!active) return; if (symbol === pattern[position]) { position++; this.classList.add('correct'); if (position >= pattern.length) { finish(); } else { status.textContent = 'Weiter so!'; } } else { this.classList.add('wrong'); active = false; status.textContent = 'Falsch!'; saveHS('daily_' + id, 0); } };
    inputGrid.appendChild(cell);
  });
  function finish() { active = false; var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Richtig! Score: ' + score; saveHS('daily_' + id, score); }
  return { stop: function() { active = false; inputGrid.querySelectorAll('button').forEach(function(btn) { btn.onclick = null; }); } };
}

function quickMathMini(id) {
  var problems = 10;
  var score = 0;
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><input id="daily-answer" class="daily-input" placeholder="Ergebnis eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var btn = createButton('Prüfen'); area.querySelector('.daily-controls').appendChild(btn);
  var status = area.querySelector('.daily-status');
  var input = area.querySelector('#daily-answer');
  var currentAnswer = 0;
  function next() {
    if (!active) return;
    if (problems <= 0) return finish();
    var a = getRandomInt(1, 15);
    var b = getRandomInt(1, 15);
    var op = ['+','-','×'][getRandomInt(0,2)];
    if (op === '-') { if (a < b) { var tmp = a; a = b; b = tmp; } currentAnswer = a - b; }
    else if (op === '×') currentAnswer = a * b;
    else currentAnswer = a + b;
    area.querySelector('#daily-question').textContent = a + ' ' + op + ' ' + b + ' = ?';
    input.value = '';
    problems--;
  }
  function submit() {
    if (!active) return;
    var val = parseInt(input.value, 10);
    if (val === currentAnswer) { score += 10; status.textContent = 'Richtig!'; }
    else { status.textContent = 'Falsch! Richtige Antwort: ' + currentAnswer; }
    setTimeout(next, 700);
  }
  btn.onclick = submit;
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });
  function finish() { active = false; document.getElementById('pts').textContent = score; status.textContent = 'Geschafft! Score: ' + score; saveHS('daily_' + id, score); }
  next();
  return { stop: function() { active = false; btn.onclick = null; } };
}

function colorSequenceMini(id) {
  var options = ['Rot','Blau','Grün','Gelb','Lila','Türkis'];
  var sequence = [];
  var step = 0;
  var score = 0;
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var grid = area.querySelector('.daily-grid');
  var status = area.querySelector('.daily-status');
  var question = area.querySelector('#daily-question');
  var buttons = [];
  options.forEach(function(color) {
    var btn = createCell(color);
    btn.onclick = function() { if (!active) return; if (color === sequence[step]) { step++; if (step >= sequence.length) { score += 10; status.textContent = 'Runde geschafft!'; setTimeout(nextRound, 600); } } else { status.textContent = 'Falsche Reihenfolge!'; active = false; saveHS('daily_' + id, score); } };
    grid.appendChild(btn);
    buttons.push(btn);
  });
  function nextRound() {
    if (!active) return;
    sequence.push(options[getRandomInt(0, options.length - 1)]);
    step = 0;
    question.textContent = 'Merke die Sequenz: ' + sequence.join(', ');
    status.textContent = 'Klicke die Sequenz nach.';
  }
  nextRound();
  return { stop: function() { active = false; buttons.forEach(function(b) { b.onclick = null; }); } };
}

function targetStopMini(id) {
  var active = true;
  var value = 0;
  var direction = 1;
  var interval = null;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Stoppe den Balken bei 50%.</div><div class="daily-row"><span id="daily-bar"></span></div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var bar = area.querySelector('#daily-bar');
  var status = area.querySelector('.daily-status');
  var btn = createButton('Stoppen'); area.querySelector('.daily-controls').appendChild(btn);
  function update() { bar.style.display='block'; bar.style.width=(value)+'%'; bar.style.height='18px'; bar.style.background='#f59e0b'; status.textContent='Aktuell: ' + Math.round(value) + '%'; }
  function tick() { if (!active) return; value += direction * 2.5; if (value >= 100 || value <= 0) { direction *= -1; value = Math.max(0, Math.min(100, value)); } update(); }
  interval = setInterval(tick, 50);
  btn.onclick = function() {
    if (!active) return;
    active = false;
    clearInterval(interval);
    var score = Math.max(0, 100 - Math.abs(value - 50) * 2);
    document.getElementById('pts').textContent = score;
    status.textContent = 'Du hast ' + Math.round(value) + '%. Score: ' + score;
    saveHS('daily_' + id, score);
  };
  return { stop: function() { active = false; clearInterval(interval); btn.onclick = null; } };
}

function wordScrambleMini(id) {
  var words = ['PIXEL','BYTE','SERVER','LOGIN','CODE','CACHE','DATA','INPUT','OUTPUT','DEBUG'];
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><input id="daily-answer" class="daily-input" placeholder="Wort eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var input = area.querySelector('#daily-answer');
  var btn = createButton('Fertig'); area.querySelector('.daily-controls').appendChild(btn);
  var word = words[getRandomInt(0, words.length - 1)];
  var scrambled = shuffleArray(word.split('')).join('');
  area.querySelector('#daily-question').textContent = scrambled;
  function submit() {
    if (!active) return;
    if (input.value.trim().toUpperCase() === word) { var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Richtig!'; saveHS('daily_' + id, score); }
    else { status.textContent = 'Falsch! Richtige Lösung: ' + word; saveHS('daily_' + id, 0); }
    active = false;
  }
  btn.onclick = submit;
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });
  return { stop: function() { active = false; btn.onclick = null; } };
}

function rhythmClickMini(id) {
  var pattern = ['Schnell','Langsam','Schnell'];
  var step = 0;
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Klicke die Sequenz: Schnell - Langsam - Schnell.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var grid = area.querySelector('.daily-grid');
  var buttons = ['Schnell','Langsam'].map(function(label) {
    var btn = createCell(label);
    btn.onclick = function() { if (!active) return; if (label === pattern[step]) { step++; if (step >= pattern.length) { finish(); } else { status.textContent = 'Weiter so!'; } } else { status.textContent = 'Falsch!'; active = false; saveHS('daily_' + id, 0); } };
    grid.appendChild(btn);
    return btn;
  });
  function finish() { active = false; var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Richtig! Score: ' + score; saveHS('daily_' + id, score); }
  return { stop: function() { active = false; buttons.forEach(function(btn) { btn.onclick = null; }); } };
}

function numberSortMini(id) {
  var active = true;
  var nums = [];
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Klicke die Zahlen in aufsteigender Reihenfolge.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var grid = area.querySelector('.daily-grid');
  function start() {
    nums = shuffleArray([getRandomInt(10, 99), getRandomInt(10, 99), getRandomInt(10, 99), getRandomInt(10, 99), getRandomInt(10, 99)]);
    var sorted = nums.slice().sort(function(a, b){return a-b;});
    var index = 0;
    grid.innerHTML = '';
    nums.forEach(function(value) {
      var cell = createCell(value);
      cell.onclick = function() { if (!active) return; if (value === sorted[index]) { index++; this.classList.add('correct'); if (index >= sorted.length) { finish(); } } else { active = false; status.textContent = 'Falsch!'; saveHS('daily_' + id, 0); } };
      grid.appendChild(cell);
    });
  }
  function finish() { active = false; var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Geschafft! Score: ' + score; saveHS('daily_' + id, score); }
  start();
  return { stop: function() { active = false; grid.querySelectorAll('button').forEach(function(btn) { btn.onclick = null; }); } };
}

function colorMixerMini(id) {
  var active = true;
  var target = { r: getRandomInt(50, 220), g: getRandomInt(50, 220), b: getRandomInt(50, 220) };
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Stelle die Ziel-RGB-Farbe ein.</div><div class="daily-row"><span>Zielfarbe</span><span id="daily-target" style="width:48px;height:32px;border-radius:10px;display:inline-block;"></span></div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var targetBox = area.querySelector('#daily-target');
  targetBox.style.background = 'rgb(' + target.r + ',' + target.g + ',' + target.b + ')';
  var controls = area.querySelector('.daily-controls');
  ['R','G','B'].forEach(function(ch) {
    var row = document.createElement('div'); row.style.marginBottom='0.7rem';
    row.innerHTML = '<label>' + ch + '</label>';
    var input = document.createElement('input'); input.type = 'range'; input.min = 0; input.max = 255; input.value = 128; input.className='daily-input';
    var label = document.createElement('span'); label.textContent='128';
    input.oninput = function() { label.textContent = this.value; updatePreview(); };
    row.appendChild(input); row.appendChild(label);
    controls.appendChild(row);
    row.dataset.channel = ch.toLowerCase();
  });
  var status = area.querySelector('.daily-status');
  var btn = createButton('Vergleichen'); controls.appendChild(btn);
  var preview = document.createElement('div'); preview.style.height='48px'; preview.style.background='#111'; preview.style.border='1px solid #333'; preview.style.borderRadius='10px'; preview.style.marginTop='0.8rem'; controls.appendChild(preview);
  function updatePreview() {
    var values = Array.from(controls.querySelectorAll('input')).map(function(i){return i.value;});
    preview.style.background = 'rgb(' + values.join(',') + ')';
  }
  updatePreview();
  btn.onclick = function() {
    var values = Array.from(controls.querySelectorAll('input')).map(function(i){return parseInt(i.value, 10);});
    var dist = Math.abs(values[0]-target.r) + Math.abs(values[1]-target.g) + Math.abs(values[2]-target.b);
    var score = Math.max(0, 255 - dist);
    document.getElementById('pts').textContent = score;
    status.textContent = 'Score: ' + score + ' / 255';
    saveHS('daily_' + id, score);
    active = false;
  };
  return { stop: function() { active = false; } };
}

function reactionChainMini(id) {
  var active = true;
  var sequence = []; var step = 0;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Klicke die leuchtenden Buttons in Reihenfolge.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var grid = area.querySelector('.daily-grid');
  var labels = ['A','B','C','D','E'];
  labels.forEach(function(label) {
    var btn = createCell(label);
    btn.onclick = function() { if (!active) return; if (label === sequence[step]) { step++; this.classList.add('correct'); status.textContent = 'Weiter!'; if (step >= sequence.length) finish(); } else { active = false; status.textContent = 'Falsch!'; saveHS('daily_' + id, 0); } };
    grid.appendChild(btn);
  });
  function flash(index) {
    if (index >= sequence.length) return;
    var label = sequence[index];
    var btn = Array.from(grid.children).find(function(b){return b.textContent===label;});
    if (!btn) return;
    btn.classList.add('active');
    setTimeout(function(){ btn.classList.remove('active'); setTimeout(function(){ flash(index+1); }, 250); }, 500);
  }
  function start() {
    sequence = shuffleArray(labels).slice(0, 5);
    status.textContent = 'Merke dir die Reihenfolge.';
    flash(0);
  }
  function finish() { active = false; var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Richtig! Score: ' + score; saveHS('daily_' + id, score); }
  start();
  return { stop: function() { active = false; grid.querySelectorAll('button').forEach(function(btn){btn.onclick=null;}); } };
}

function letterCountMini(id) {
  var active = true;
  var sentences = ['Schnell braune Füchse springen über den faulen Hund.', 'Coding macht Spaß und fördert die Kreativität.', 'Pixel, Code und Logik gehören zusammen.'];
  var sentence = sentences[getRandomInt(0, sentences.length-1)];
  var letters = sentence.replace(/[^A-Za-zÄÖÜäöü]/g, '');
  var target = letters.charAt(getRandomInt(0, letters.length-1)).toUpperCase();
  var answer = (sentence.toUpperCase().match(new RegExp(target, 'g')) || []).length;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">' + sentence + '</div><div class="daily-text">Zähle den Buchstaben: ' + target + '</div><input id="daily-answer" class="daily-input" placeholder="Anzahl eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var input = area.querySelector('#daily-answer');
  var button = createButton('Prüfen'); area.querySelector('.daily-controls').appendChild(button);
  var status = area.querySelector('.daily-status');
  function submit() { if (!active) return; var val = parseInt(input.value,10); if (val === answer) { var score = 100; document.getElementById('pts').textContent = score; status.textContent = 'Richtig!'; saveHS('daily_' + id, score); } else { status.textContent = 'Falsch! Richtige Antwort: ' + answer; saveHS('daily_' + id, 0); } active = false; }
  button.onclick = submit;
  input.addEventListener('keydown', function(e){ if (e.key==='Enter') submit(); });
  return { stop:function(){ active=false; button.onclick=null;} };
}

function pingPongClickMini(id) {
  var active = true;
  var pos = 0;
  var dir = 1;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Klicke beim richtigen Moment, wenn der Ball auf der Mitte ist.</div><div class="daily-row"><span id="daily-track" style="width:100%;height:20px;background:#111;border-radius:999px;position:relative;"></span></div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var track = area.querySelector('#daily-track');
  var btn = createButton('Klicken'); area.querySelector('.daily-controls').appendChild(btn);
  var ball = document.createElement('div'); ball.style.width = '18px'; ball.style.height='18px'; ball.style.borderRadius='50%'; ball.style.background='#f59e0b'; ball.style.position='absolute'; ball.style.top='1px'; track.appendChild(ball);
  function update() { ball.style.left = pos + '%'; }
  var interval = setInterval(function(){ if(!active)return; pos += dir*2.5; if(pos<=0||pos>=85){dir *= -1;} update(); }, 40);
  btn.onclick=function(){ if(!active) return; active=false; clearInterval(interval); var center = pos + 9; var score = Math.max(0, 100 - Math.abs(center - 50)*2); document.getElementById('pts').textContent = score; status.textContent = 'Du hast ' + Math.round(center) + '% getroffen. Score: ' + score; saveHS('daily_' + id, score); };
  return { stop:function(){ active=false; clearInterval(interval); btn.onclick=null; } };
}

function memoryGridMini(id) {
  var active = true;
  var cells = [];
  var selected = [];
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Merke dir die markierten Felder und klicke sie danach.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var grid = area.querySelector('.daily-grid');
  var status = area.querySelector('.daily-status');
  var pattern = shuffleArray(Array.from({ length: 9 }, function(_, i){ return i; })).slice(0, 4);
  for (var i = 0; i < 9; i++) {
    var cell = createCell('');
    grid.appendChild(cell);
    cells.push(cell);
  }
  pattern.forEach(function(index){ cells[index].classList.add('active'); });
  setTimeout(function(){ if(!active) return; pattern.forEach(function(index){ cells[index].classList.remove('active'); }); status.textContent='Jetzt nachklicken!'; cells.forEach(function(cell, idx){ cell.onclick=function(){ if(!active)return; if(pattern.includes(idx) && !selected.includes(idx)){ selected.push(idx); cell.classList.add('correct'); if (selected.length===pattern.length) finish(); } else { active=false; cell.classList.add('wrong'); status.textContent='Falsch!'; saveHS('daily_'+id,0); } }; }); }, 1200);
  function finish(){ active=false; var score=100; document.getElementById('pts').textContent=score; status.textContent='Richtig!'; saveHS('daily_'+id,score); }
  return { stop:function(){ active=false; cells.forEach(function(cell){ cell.onclick=null; }); } };
}

function typingSpeedMini(id) {
  var active = true;
  var words = ['SPIEL','SCHNELL','KLICK','PIXEL','CODE','LOS','TASTE'];
  var word = words[getRandomInt(0, words.length-1)];
  var start = null;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Tippe das Wort so schnell wie möglich.</div><div class="daily-text" id="daily-question">' + word + '</div><input id="daily-answer" class="daily-input" placeholder="Wort eingeben" autocomplete="off"><div class="daily-status"></div></div>');
  var input = area.querySelector('#daily-answer');
  var status = area.querySelector('.daily-status');
  input.onfocus = function() { if (!start) start = Date.now(); };
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { if (!active) return; var time = Date.now() - start; if (input.value.trim().toUpperCase() === word) { var score = Math.max(0, 120 - Math.round(time / 20)); document.getElementById('pts').textContent=score; status.textContent='Richtig! Zeit: ' + Math.round(time/100)/10 + 's'; saveHS('daily_'+id,score); } else { status.textContent='Falsch!'; saveHS('daily_'+id,0); } active=false; } });
  return { stop:function(){ active=false; input.onfocus=null; input.onkeydown=null; } };
}

function numberCrossMini(id) {
  var a = getRandomInt(2, 9);
  var b = getRandomInt(2, 9);
  var answer = a * b;
  var missing = getRandomInt(1, 2) === 1 ? a : b;
  var symbol = missing === a ? 'x' : '?';
  var equation = (missing === a ? '? x ' + b : a + ' x ?') + ' = ' + answer;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Fülle die fehlende Zahl aus.</div><div class="daily-text" id="daily-question">' + equation + '</div><input id="daily-answer" class="daily-input" placeholder="Zahl eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var btn = createButton('Prüfen'); area.querySelector('.daily-controls').appendChild(btn);
  var status = area.querySelector('.daily-status');
  var input = area.querySelector('#daily-answer');
  function submit(){ var val = parseInt(input.value,10); if(val===missing){ var score=100; document.getElementById('pts').textContent=score; status.textContent='Richtig!'; saveHS('daily_'+id,score);} else{ status.textContent='Falsch!'; saveHS('daily_'+id,0);} }
  btn.onclick=submit;
  input.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); });
  return { stop:function(){ btn.onclick=null;} };
}

function iconMemoryMini(id) {
  var allIcons = ['⚽','🎸','🚗','📱','🍎','🌵','🐶','🖥️','🚀','🎧','🛋️','✈️'];
  var target = shuffleArray(allIcons).slice(0, 6);
  var choices = shuffleArray(allIcons);
  var selected = [];
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text">Merke dir diese Icons:</div><div class="daily-grid daily-grid-3"></div><div class="daily-text">Wähle danach die richtigen Icons aus.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var displays = area.querySelectorAll('.daily-grid');
  var status = area.querySelector('.daily-status');
  target.forEach(function(icon){ var cell=createCell(icon); cell.style.opacity='0.7'; displays[0].appendChild(cell); });
  setTimeout(function(){ displays[0].innerHTML = ''; choices.forEach(function(icon){ var cell=createCell(icon); cell.onclick=function(){ if(selected.includes(icon)) return; selected.push(icon); this.classList.add('selected'); if(selected.length >= 6){ finish(); } }; displays[1].appendChild(cell); }); status.textContent='Wähle die sechs richtigen Icons.'; }, 1200);
  function finish(){ var correct = selected.filter(function(icon){ return target.includes(icon); }).length; var score = correct * 20; document.getElementById('pts').textContent=score; status.textContent='Treffer: ' + correct + '/6'; saveHS('daily_'+id,score); }
  return { stop:function(){ area.querySelectorAll('button').forEach(function(btn){ btn.onclick=null; }); } };
}

function balanceClickMini(id) {
  var value = getRandomInt(-20,20);
  var active=true;
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Balance die Waage aus: klick links oder rechts.</div><div class="daily-row"><span id="daily-balance">' + value + '</span></div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status=area.querySelector('.daily-status');
  var btnL=createButton('Links'); var btnR=createButton('Rechts'); area.querySelector('.daily-controls').appendChild(btnL); area.querySelector('.daily-controls').appendChild(btnR);
  function update(){ area.querySelector('#daily-balance').textContent=value; }
  btnL.onclick=function(){ if(!active)return; value--; update(); check(); };
  btnR.onclick=function(){ if(!active)return; value++; update(); check(); };
  function check(){ if(value===0){ active=false; var score=100; document.getElementById('pts').textContent=score; status.textContent='Ausgeglichen! Score: '+score; saveHS('daily_'+id,score);} }
  return { stop:function(){ active=false; btnL.onclick=null; btnR.onclick=null; } };
}

function quickEyesMini(id) {
  var value = getRandomInt(5, 15);
  var active = true;
  var area = fillDailyArea('<div class="daily-panel"><div class="daily-text" id="daily-question"></div><input id="daily-answer" class="daily-input" placeholder="Anzahl eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status = area.querySelector('.daily-status');
  var input = area.querySelector('#daily-answer');
  var btn = createButton('Prüfen'); area.querySelector('.daily-controls').appendChild(btn);
  area.querySelector('#daily-question').textContent = 'Merk dir die Punkte.';
  setTimeout(function(){ area.querySelector('#daily-question').textContent = value + ' Punkte'; setTimeout(function(){ area.querySelector('#daily-question').textContent = 'Wie viele Punkte waren das?'; }, 900); }, 600);
  btn.onclick=function(){ if(!active)return; var val = parseInt(input.value,10); if(val===value){ var score=100; document.getElementById('pts').textContent=score; status.textContent='Richtig!'; saveHS('daily_'+id,score);} else { status.textContent='Falsch!'; saveHS('daily_'+id,0);} active=false; };
  return { stop:function(){ active=false; btn.onclick=null; } };
}

function keyboardSprintMini(id) {
  var letters = shuffleArray('ASDFGHJKLQWERTZUIOPYXCVBNM'.split('')).slice(0, 6);
  var active=true; var start=null;
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Tippe die Buchstabenfolge schnell ab.</div><div class="daily-text" id="daily-question">' + letters.join(' ') + '</div><input id="daily-answer" class="daily-input" placeholder="Tippe hier" autocomplete="off"><div class="daily-status"></div></div>');
  var input=area.querySelector('#daily-answer'); var status=area.querySelector('.daily-status');
  input.onfocus=function(){ if(!start) start=Date.now(); };
  input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ if(!active) return; var entered=input.value.trim().toUpperCase().replace(/\s+/g,''); var target = letters.join(''); var time = Date.now()-start; if(entered===target){ var score=Math.max(0,120-Math.round(time/20)); document.getElementById('pts').textContent=score; status.textContent='Richtig! Zeit: '+Math.round(time/100)/10+'s'; saveHS('daily_'+id,score); } else { status.textContent='Falsch!'; saveHS('daily_'+id,0); } active=false; }});
  return { stop:function(){ active=false; input.onfocus=null; input.onkeydown=null; } };
}

function colorDifferenceMini(id) {
  var active=true;
  var base = getRandomInt(0,255);
  var lighter = 'rgb(' + Math.min(255, base+20) + ',' + Math.min(255, base+20) + ',' + Math.min(255, base+20) + ')';
  var darker = 'rgb(' + Math.max(0, base-20) + ',' + Math.max(0, base-20) + ',' + Math.max(0, base-20) + ')';
  var left = Math.random() < 0.5 ? lighter : darker;
  var right = left === lighter ? darker : lighter;
  var correct = left === darker ? 'links' : 'rechts';
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Welche Farbe ist dunkler?</div><div class="daily-row"><span id="daily-left" style="width:120px;height:80px;border-radius:14px;display:inline-block;"></span><span id="daily-right" style="width:120px;height:80px;border-radius:14px;display:inline-block;margin-left:1rem;"></span></div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  area.querySelector('#daily-left').style.background=left;
  area.querySelector('#daily-right').style.background=right;
  var status=area.querySelector('.daily-status');
  var btnL=createButton('Links'); var btnR=createButton('Rechts'); area.querySelector('.daily-controls').appendChild(btnL); area.querySelector('.daily-controls').appendChild(btnR);
  function finish(chosen){ if(!active)return; active=false; var score = chosen===correct?100:0; document.getElementById('pts').textContent=score; status.textContent = chosen===correct ? 'Richtig!' : 'Falsch!'; saveHS('daily_'+id,score);} btnL.onclick=function(){finish('links');}; btnR.onclick=function(){finish('rechts');}; return { stop:function(){ active=false; btnL.onclick=null; btnR.onclick=null; } };
}

function morseCodeMini(id) {
  var letters = {A:'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---'};
  var keys = Object.keys(letters);
  var letter = keys[getRandomInt(0, keys.length-1)];
  var code = letters[letter];
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Welche Morse-Sequenz ist das?</div><div class="daily-text" id="daily-question">' + code + '</div><input id="daily-answer" class="daily-input" placeholder="Buchstabe eingeben" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var btn=createButton('Prüfen'); area.querySelector('.daily-controls').appendChild(btn);
  var status=area.querySelector('.daily-status'); var input=area.querySelector('#daily-answer');
  function submit(){ if(input.value.trim().toUpperCase()===letter){ var score=100; document.getElementById('pts').textContent=score; status.textContent='Richtig!'; saveHS('daily_'+id,score);} else { status.textContent='Falsch!'; saveHS('daily_'+id,0); } }
  btn.onclick=submit; input.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); }); return { stop:function(){ btn.onclick=null;} };
}

function pixelArtMini(id) {
  var active=true;
  var pattern=[];
  for(var r=0;r<5;r++){ pattern[r]=[]; for(var c=0;c<5;c++){ pattern[r][c]=Math.random()<0.3; }}
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Zeichne das Pixelbild nach.</div><div class="daily-grid daily-grid-3" id="daily-pixel"></div><div class="daily-status"></div></div>');
  var status=area.querySelector('.daily-status');
  var grid=area.querySelector('#daily-pixel'); grid.style.gridTemplateColumns='repeat(5,1fr)';
  var cells=[];
  for(var i=0;i<25;i++){ var btn=createCell(''); btn.style.height='40px'; btn.style.background='#111'; btn.dataset.idx=i; btn.onclick=function(){ if(!active)return; this.classList.toggle('selected'); this.style.background=this.classList.contains('selected')?'#f59e0b':'#111'; check(); }; cells.push(btn); grid.appendChild(btn); }
  setTimeout(function(){ if(!active)return; status.textContent='Jetzt nachzeichnen!'; }, 400);
  function check(){ var correct=0; cells.forEach(function(cell,i){ var r=Math.floor(i/5), c=i%5; var wanted=pattern[r][c]; var selected=cell.classList.contains('selected'); if(wanted===selected) correct++; }); if(correct===25){ active=false; var score=100; document.getElementById('pts').textContent=score; status.textContent='Perfekt!'; saveHS('daily_'+id,score);} }
  return { stop:function(){ active=false; cells.forEach(function(cell){ cell.onclick=null; }); } };
}

function numberMemoryMini(id) {
  var active=true;
  var values=shuffleArray([1,1,2,2,3,3,4,4,5,5]).slice(0,10);
  var revealed=[];
  var first=null;
  var matches=0;
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Finde alle Zahlen-Paare.</div><div class="daily-grid daily-grid-3"></div><div class="daily-status"></div></div>');
  var grid=area.querySelector('.daily-grid'); var status=area.querySelector('.daily-status');
  values.forEach(function(value,i){ var btn=createCell('?'); btn.onclick=function(){ if(!active)return; if(revealed.includes(i))return; btn.textContent=value; if(first===null){ first={i:i,value:value}; } else { if(first.value===value){ revealed.push(first.i, i); matches++; btn.classList.add('correct'); grid.children[first.i].classList.add('correct'); if(matches===5){ finish(); } } else { active=false; setTimeout(function(){ btn.textContent='?'; grid.children[first.i].textContent='?'; active=true; first=null; },500); } first=null;} }; grid.appendChild(btn); });
  function finish(){ active=false; var score=100; document.getElementById('pts').textContent=score; status.textContent='Alle Paare gefunden!'; saveHS('daily_'+id,score);} return { stop:function(){ active=false; Array.from(grid.children).forEach(function(btn){ btn.onclick=null; }); } };
}

function wordChainMini(id) {
  var active=true;
  var words=['APFEL','LOKAL','LICHT','TASTA','APPS','SPEED','DATEN','NETZ'];
  var current=words[getRandomInt(0, words.length-1)];
  var steps=0;
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Finde ein Wort, das mit dem letzten Buchstaben beginnt.</div><div class="daily-text" id="daily-question">' + current + '</div><input id="daily-answer" class="daily-input" placeholder="Neues Wort" autocomplete="off"><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status=area.querySelector('.daily-status'); var input=area.querySelector('#daily-answer'); var btn=createButton('Weiter'); area.querySelector('.daily-controls').appendChild(btn);
  function submit(){ if(!active)return; var val=input.value.trim().toUpperCase(); if(!val||val.charAt(0)!==current.slice(-1)){ active=false; status.textContent='Falsch!'; saveHS('daily_'+id, steps*20); return; } steps++; current=val; area.querySelector('#daily-question').textContent=current; input.value=''; status.textContent='Gut! Weiter...'; if(steps>=5){ active=false; var score=steps*20; document.getElementById('pts').textContent=score; status.textContent='Super! Score: '+score; saveHS('daily_'+id,score); } }
  btn.onclick=submit; input.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); }); return { stop:function(){ active=false; btn.onclick=null; } };
}

function reactionStopMini(id) {
  var active=true;
  var time=5000;
  var interval=null;
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Stoppe den Countdown bei exakt 0.</div><div class="daily-text" id="daily-question">5.0</div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var display=area.querySelector('#daily-question'); var status=area.querySelector('.daily-status'); var btn=createButton('Stoppen'); area.querySelector('.daily-controls').appendChild(btn);
  interval=setInterval(function(){ if(!active)return; time-=50; if(time<=0){ time=0; clearInterval(interval); } display.textContent=(time/1000).toFixed(2); },50);
  btn.onclick=function(){ if(!active)return; active=false; clearInterval(interval); var score=Math.max(0,100-Math.round(Math.abs(time)*0.02)); document.getElementById('pts').textContent=score; status.textContent='Abstand: '+time.toFixed(0)+'ms. Score: '+score; saveHS('daily_'+id,score); };
  return { stop:function(){ active=false; clearInterval(interval); btn.onclick=null; } };
}

function categorySpeedMini(id) {
  var terms=[{text:'LÖWE',cat:'Tier'},{text:'ROSE',cat:'Pflanze'},{text:'MODEM',cat:'Technik'},{text:'KAKTUS',cat:'Pflanze'},{text:'MAUS',cat:'Technik'},{text:'TAUBE',cat:'Tier'}];
  var item=terms[getRandomInt(0,terms.length-1)];
  var area=fillDailyArea('<div class="daily-panel"><div class="daily-text">Wähle die richtige Kategorie für: ' + item.text + '</div><div class="daily-controls"></div><div class="daily-status"></div></div>');
  var status=area.querySelector('.daily-status'); var controls=area.querySelector('.daily-controls');
  ['Tier','Pflanze','Technik'].forEach(function(label){ var btn=createButton(label); btn.onclick=function(){ var score = label===item.cat ? 100 : 0; document.getElementById('pts').textContent=score; status.textContent = label===item.cat ? 'Richtig!' : 'Falsch!'; saveHS('daily_'+id,score); }; controls.appendChild(btn); });
  return { stop:function(){ area.querySelectorAll('button').forEach(function(btn){ btn.onclick=null; }); } };
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

/* ---- SPIEL 4: KLICK-PRÄZISION ---- */
function precision(cv) {
  var ctx = cv.getContext('2d'), W = 380, H = 420, on = true;
  var sc = 0, shots = 0, maxShots = 10, targetR = 55;
  var tx, ty;

  function newTarget() {
    tx = targetR + 10 + Math.random() * (W - 2 * targetR - 20);
    ty = targetR + 30 + Math.random() * (H - 2 * targetR - 50);
  }

  function draw() {
    ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, W, H);
    // rings: outer=1pt, mid=5pt, bull=10pt
    var rings = [
      { r: targetR,       color: '#b71c1c' },
      { r: targetR * 0.65, color: '#e53935' },
      { r: targetR * 0.32, color: '#ffffff' }
    ];
    rings.forEach(function(ring) {
      ctx.beginPath(); ctx.arc(tx, ty, ring.r, 0, Math.PI * 2);
      ctx.fillStyle = ring.color; ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    // crosshair
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx - targetR, ty); ctx.lineTo(tx + targetR, ty);
    ctx.moveTo(tx, ty - targetR); ctx.lineTo(tx, ty + targetR); ctx.stroke();
    // HUD
    ctx.fillStyle = '#eee'; ctx.font = '13px Bricolage Grotesque,sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('Schuss ' + shots + '/' + maxShots, 8, 18);
    ctx.textAlign = 'right'; ctx.fillText('Punkte: ' + sc, W - 8, 18);
  }

  function handleClick(e) {
    if (!on) return;
    var rect = cv.getBoundingClientRect();
    var scaleX = W / rect.width, scaleY = H / rect.height;
    var x = (e.clientX - rect.left) * scaleX;
    var y = (e.clientY - rect.top) * scaleY;
    var dist = Math.sqrt((x - tx) * (x - tx) + (y - ty) * (y - ty));
    var pts = 0;
    if (dist <= targetR * 0.32) pts = 10;
    else if (dist <= targetR * 0.65) pts = 5;
    else if (dist <= targetR) pts = 1;
    sc += pts; shots++;
    document.getElementById('pts').textContent = sc;
    // hit marker
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = pts >= 10 ? '#ffd700' : pts >= 5 ? '#4caf50' : pts > 0 ? '#90caf9' : '#ef5350'; ctx.fill();
    ctx.fillStyle = pts >= 10 ? '#ffd700' : pts >= 5 ? '#4caf50' : pts > 0 ? '#fff' : '#ef5350';
    ctx.font = 'bold 18px Bricolage Grotesque,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(pts > 0 ? '+' + pts : '✕', x, y - 12);
    if (shots >= maxShots) {
      on = false; cv.removeEventListener('click', handleClick);
      setTimeout(function() { saveHS('precision', sc); gg(ctx, W, H, sc); }, 600);
    } else {
      setTimeout(function() { newTarget(); draw(); }, 600);
    }
  }

  newTarget(); draw();
  cv.addEventListener('click', handleClick);
  return { stop: function() { on = false; cv.removeEventListener('click', handleClick); } };
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

function wordleGame() {
  var on = true;
  var secret = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
  var currentRow = 0, currentCol = 0, currentGuess = [];
  var maxRows = 6, wordLen = 5;

  var grid = document.getElementById('wordle-grid');
  var kbEl = document.getElementById('wordle-keyboard');
  var statusEl = document.getElementById('wordle-status');
  grid.innerHTML = ''; kbEl.innerHTML = ''; statusEl.textContent = '';

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
    result.forEach(function(state, i) {
      var letter = cells[currentRow][i].textContent;
      setTimeout(function() { cells[currentRow][i].classList.add(state); }, i * 80);
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
        var score = Math.max(20, (maxRows - currentRow + 1) * 20);
        statusEl.textContent = '🎉 ' + secret + '! +' + score + ' Punkte';
        document.getElementById('pts').textContent = score;
        sounds.highscore(); saveHS('wordle', score);
      } else if (currentRow >= maxRows) {
        on = false;
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
