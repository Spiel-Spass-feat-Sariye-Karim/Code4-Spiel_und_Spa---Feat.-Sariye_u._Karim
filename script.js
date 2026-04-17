var SUPABASE_URL = 'https://tjcumfilaekmexlzteum.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqY3VtZmlsYWVrbWV4bHp0ZXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTI0OTQsImV4cCI6MjA5MTgyODQ5NH0.wUuHehNw3KFqVDnSPIU0rKIUyeVzAdY_PHPAkzd4_Is';
var db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
 
var game = null, which = '', user = null;
 
/* safe ---- TAB-UMSCHALTUNG ---- */
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    var target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.auth-form').forEach(function(f) { f.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('form-' + target).classList.add('active');
    document.getElementById('login-err').textContent = '';
  });
});
 
/* ---- ANMELDEN ---- */
document.getElementById('btn-login').addEventListener('click', async function() {
  var n = document.getElementById('login-name').value.trim();
  var p = document.getElementById('login-pass').value;
  var e = document.getElementById('login-err');
 
  if (!n || !p) { e.textContent = 'Bitte Name und Passwort eingeben.'; return; }
 
  var res = await db.from('users').select('*').eq('name', n.toLowerCase()).maybeSingle();
 
  if (!res.data) {
    e.textContent = 'Nutzer nicht gefunden. Jetzt registrieren?';
    return;
  }
  if (res.data.pass !== p) {
    e.textContent = 'Falsches Passwort!';
    return;
  }
 
  user = res.data;
  await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
  enterApp();
});
 
/* ---- REGISTRIEREN ---- */
document.getElementById('btn-register').addEventListener('click', async function() {
  var n = document.getElementById('reg-name').value.trim();
  var p1 = document.getElementById('reg-pass').value;
  var p2 = document.getElementById('reg-pass2').value;
  var e = document.getElementById('login-err');
 
  if (!n || !p1 || !p2) { e.textContent = 'Bitte alle Felder ausfuellen.'; return; }
  if (n.length < 2) { e.textContent = 'Benutzername zu kurz (min. 2 Zeichen).'; return; }
  if (p1.length < 4) { e.textContent = 'Passwort zu kurz (min. 4 Zeichen).'; return; }
  if (p1 !== p2) { e.textContent = 'Passwoerter stimmen nicht ueberein.'; return; }
 
  var check = await db.from('users').select('name').eq('name', n.toLowerCase()).maybeSingle();
  if (check.data) {
    e.textContent = 'Nutzername bereits vergeben!';
    return;
  }
 
  var ins = await db.from('users').insert({
    name: n.toLowerCase(), pass: p1,
    dodge: 0, stack: 0, memory: 0,
    games_played: 0,
    avatar_seed: Math.random().toString(36).substring(2, 10)
  }).select().single();
 
  if (ins.error) { e.textContent = 'Fehler beim Erstellen. Versuche es nochmal.'; return; }
 
  user = ins.data;
  enterApp();
});
 
/* ---- EINLOGGEN / AUSLOGGEN ---- */
function enterApp() {
  document.getElementById('login-err').textContent = '';
  document.getElementById('login').classList.add('hide');
  document.getElementById('app').classList.add('show');
  document.getElementById('username').textContent = user.name;
  showHS();
}
 
document.getElementById('btn-logout').addEventListener('click', function() {
  user = null;
  if (game) { game.stop(); game = null; }
  document.getElementById('app').classList.remove('show');
  document.getElementById('login').classList.remove('hide');
  document.getElementById('login-pass').value = '';
  document.getElementById('login-name').value = '';
  document.getElementById('login-err').textContent = '';
});
 
/* ---- HIGHSCORES ---- */
async function saveHS(g, s) {
  if (!user || s <= (user[g] || 0)) return false;
  user[g] = s;
  await db.from('users').update({ [g]: s }).eq('id', user.id);
  showHS();
  return true;
}
 
function showHS() {
  document.getElementById('hs-list').innerHTML =
    '<div class="hs-row"><span>⚡ Blitz-Dodge</span><span>' + (user.dodge || 0) + '</span></div>' +
    '<div class="hs-row"><span>🧱 Turm-Stapler</span><span>' + (user.stack || 0) + '</span></div>';
}
 
/* ---- POPUP ---- */
document.getElementById('card-dodge').addEventListener('click', function() { openG('dodge'); });
document.getElementById('card-stack').addEventListener('click', function() { openG('stack'); });
document.getElementById('btn-x').addEventListener('click', closeG);
document.getElementById('btn-again').addEventListener('click', resetG);
document.getElementById('popup').addEventListener('click', function(e) { if (e.target === this) closeG(); });
 
function openG(id) {
  which = id;
  document.getElementById('gtitle').textContent = id === 'dodge' ? '⚡ Blitz-Dodge' : '🧱 Turm-Stapler';
  document.getElementById('pts').textContent = '0';
  document.getElementById('popup').classList.add('on');
  runG();
}
function closeG() { if (game) { game.stop(); game = null; } document.getElementById('popup').classList.remove('on'); }
function resetG() { if (game) { game.stop(); game = null; } document.getElementById('pts').textContent = '0'; runG(); }
function runG() { var c = document.getElementById('c'); c.width = 380; c.height = 420; game = which === 'dodge' ? dodge(c) : stack(c); }
 
/* ---- SPIEL 1: BLITZ-DODGE ---- */
function dodge(cv) {
  var ctx = cv.getContext('2d'), W = 380, H = 420, on = true, raf, f = 0, sc = 0;
  var px = W / 2, pr = 14, bolts = [], spd = 2.5, rate = 30;
 
  function loop() {
    if (!on) return; raf = requestAnimationFrame(loop); f++;
    if (f % 120 === 0) { spd += 0.3; if (rate > 12) rate--; }
    if (f % rate === 0) bolts.push({ x: Math.random() * W, y: -15, s: spd + Math.random() * 1.5, w: 8 + Math.random() * 10 });
    for (var i = bolts.length - 1; i >= 0; i--) {
      bolts[i].y += bolts[i].s;
      if (bolts[i].y > H) { bolts.splice(i, 1); sc++; document.getElementById('pts').textContent = sc; continue; }
      if (bolts[i].y + 15 > H - 44 && bolts[i].y < H - 16 && Math.abs(bolts[i].x - px) < bolts[i].w / 2 + pr) {
        on = false; saveHS('dodge', sc); gg(ctx, W, H, sc); return;
      }
    }
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a2a'; ctx.fillRect(0, H - 18, W, 18);
    for (var i = 0; i < bolts.length; i++) {
      var b = bolts[i];
      ctx.fillStyle = '#ffe033'; ctx.shadowColor = '#ffe033'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.w / 2, b.y + 10); ctx.lineTo(b.x - 2, b.y + 8);
      ctx.lineTo(b.x - b.w / 2 - 2, b.y + 20); ctx.lineTo(b.x + b.w / 2, b.y + 6); ctx.lineTo(b.x + 2, b.y + 8);
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = '#1b9e77'; ctx.shadowColor = '#1b9e77'; ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.arc(px, H - 30, pr, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px - 5, H - 33, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 5, H - 33, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(px - 4, H - 33, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 6, H - 33, 1.8, 0, Math.PI * 2); ctx.fill();
  }
 
  function mv(e) { var r = cv.getBoundingClientRect(); px = Math.max(pr, Math.min(W - pr, (e.clientX - r.left) * (W / r.width))); }
  cv.addEventListener('mousemove', mv);
  loop();
  return { stop: function() { on = false; cancelAnimationFrame(raf); cv.removeEventListener('mousemove', mv); } };
}
 
/* ---- SPIEL 2: TURM-STAPLER ---- */
function stack(cv) {
  var ctx = cv.getContext('2d'), W = 380, H = 420, on = true, raf, sc = 0;
  var ly = [{ x: W / 2 - 60, w: 120 }];
  var cur = { x: 0, w: 120, dir: 1, spd: 3 };
  var bY = H - 25, lH = 22;
  var co = ['#e8573a', '#e88a3a', '#e8c83a', '#3ae87a', '#3ab8e8', '#6a3ae8', '#e83a9b'];
 
  function loop() {
    if (!on) return; raf = requestAnimationFrame(loop);
    cur.x += cur.dir * cur.spd;
    if (cur.x + cur.w > W || cur.x < 0) cur.dir *= -1;
    ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#333'; for (var i = 0; i < 25; i++) ctx.fillRect((i * 67) % W, (i * 43) % H, 1.5, 1.5);
    for (var i = 0; i < ly.length; i++) { ctx.fillStyle = co[i % co.length]; ctx.fillRect(ly[i].x, bY - i * lH, ly[i].w, lH - 2); }
    var cy = bY - ly.length * lH;
    ctx.fillStyle = co[ly.length % co.length]; ctx.shadowColor = co[ly.length % co.length]; ctx.shadowBlur = 10;
    ctx.fillRect(cur.x, cy, cur.w, lH - 2); ctx.shadowBlur = 0;
  }
 
  function drop() {
    if (!on) return;
    var p = ly[ly.length - 1];
    var oL = Math.max(cur.x, p.x), oR = Math.min(cur.x + cur.w, p.x + p.w), oW = oR - oL;
    if (oW <= 0) { on = false; saveHS('stack', sc); gg(ctx, W, H, sc); return; }
    ly.push({ x: oL, w: oW }); sc++; document.getElementById('pts').textContent = sc;
    cur.w = oW; cur.x = Math.random() < 0.5 ? 0 : W - cur.w;
    cur.dir = cur.x < W / 2 ? 1 : -1; cur.spd = Math.min(7, 3 + sc * 0.18);
    if (ly.length * lH > H - 80) bY += lH;
  }
 
  cv.addEventListener('click', drop);
  loop();
  return { stop: function() { on = false; cancelAnimationFrame(raf); cv.removeEventListener('click', drop); } };
}
 
/* ---- GAME OVER ---- */
function gg(ctx, W, H, s) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = 'bold 26px Bricolage Grotesque,sans-serif'; ctx.fillText('Game Over!', W / 2, H / 2 - 10);
  ctx.font = '16px Bricolage Grotesque,sans-serif'; ctx.fillText(s + ' Punkte', W / 2, H / 2 + 22);
}