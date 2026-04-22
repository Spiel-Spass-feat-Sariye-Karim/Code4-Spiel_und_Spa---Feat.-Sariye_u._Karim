// Backend Server URL (lokal testen oder Render-URL nach Deployment)
var API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000'
  : 'https://arcadebox-backend.onrender.com';
 
var game=null,which='',user=null;

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
    
    
    user = data.user;
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
    
    
    user = data.user;
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
}
 
document.getElementById("btn-logout").addEventListener("click",
function() {
if (!confirm("Wirklich abmelden?")) return;
user = null;
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
    if (s > (user[g] || 0)) {
      user[g] = s;
    }
    
    showHS();
    loadGlobalHS();
    loadStats();
    sounds.highscore();
    return true;
  } catch (err) {
    console.error('Verbindungsfehler:', err);
    return false;
  }
}
 
function showHS() {
  function rang(score) {
    if (score >= 50) return '👑 ';
    if (score >= 25) return '⭐ ';
    if (score >= 10) return '🔥 ';
    return '';
  }
  document.getElementById('hs-list').innerHTML =
    '<div class="hs-row">' +
    '<span>🧠 Farb-Gedächtnis</span>' +
    '<span>' + rang(user.memory || 0) + (user.memory || 0) + '</span>' +
    '</div>' +
    '<div class="hs-row">' +
    '<span>🧱 Turm-Stapler</span>' +
    '<span>' + rang(user.stack || 0) + (user.stack || 0) + '</span>' +
    '</div>';
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
    
    html +=
      '<div class="global-row ' + meClass + '">' +
      '<div class="rank ' + rankClass + '">#' + (i+1) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<img src="' + av + '" style="width:24px;height:24px;border-radius:50%;">' +
      '<span>' + item.name + '</span>' +
      '</div>' +
      '<div class="score">' + (item.memory || 0) + ' / ' + (item.stack || 0) + '</div>' +
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
document.getElementById("stat-total").textContent = (user.memory || 0) + (user.stack || 0);

try {
  var res = await fetch(API_URL + '/api/user/' + user.id);
  var userData = await res.json();
  
  if (res.ok && userData) {
    user = userData; // Aktualisiere User-Daten
    document.getElementById("stat-games").textContent = user.games_played || 0;
    document.getElementById("stat-total").textContent = (user.memory || 0) + (user.stack || 0);
  }
} catch (err) {
  console.error('Fehler beim Laden der Stats:', err);
}
}

/* ---- POPUP ---- */
document.getElementById('card-memory').addEventListener('click', function() { openG('memory'); });
document.getElementById('card-stack').addEventListener('click',function(){openG('stack')});
document.getElementById('btn-x').addEventListener('click',closeG);
document.getElementById('btn-again').addEventListener('click',resetG);
document.getElementById('popup').addEventListener('click',function(e){if(e.target===this)closeG()});
 
function openG(id) { which = id; document.getElementById('gtitle').textContent = id === 'memory' ?
'Farb-Gedaechtnis' : 'Turm-Stapler'; document.getElementById('pts').textContent = '0'; var canvas =
document.getElementById('c'); var pads = document.getElementById('memory-pads'); var status =
document.getElementById('memory-status'); if (id === 'memory') { canvas.style.display = 'none';
pads.classList.add('active'); status.classList.add('active'); } else { canvas.style.display = 'block';
pads.classList.remove('active'); status.classList.remove('active'); }
document.getElementById('popup').classList.add('on'); runG(); }


function closeG() {
  if (game) { game.stop(); game = null; }
  document.getElementById('popup').classList.remove('on');
  document.getElementById('memory-pads').classList.remove('active');
  document.getElementById('memory-status').classList.remove('active');
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

document.getElementById("profile-info").innerHTML =
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
