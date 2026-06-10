const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

// ── Brevo (HTTP API, sendet an JEDE E-Mail, 300/Tag kostenlos) ─
const BREVO_API_KEY = process.env.BREVO_API_KEY || null;
if (BREVO_API_KEY) {
  console.log('📧 Brevo API key ready');
} else {
  console.log('⚠️  BREVO_API_KEY not set — password reset emails disabled');
}

async function sendResetMail(toEmail, resetLink, username) {
  if (!BREVO_API_KEY) {
    console.error('❌ sendResetMail: BREVO_API_KEY not set!');
    return false;
  }
  try {
    console.log(`📧 Sending reset mail via Brevo to: ${toEmail}`);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'ArcadeBox', email: process.env.BREVO_SENDER || process.env.GMAIL_USER || 'noreply@arcadebox.app' },
        to: [{ email: toEmail }],
        subject: '🔑 ArcadeBox — Passwort zurücksetzen',
        htmlContent: `
          <div style="font-family:monospace;background:#0a0a14;color:#eee;padding:32px;border-radius:8px;max-width:480px">
            <h2 style="color:#ff5733;margin:0 0 8px">🕹️ ArcadeBox</h2>
            <p style="color:#aaa;margin:0 0 24px;font-size:13px">PASSWORT ZURÜCKSETZEN</p>
            <p>Hi <strong style="color:#ff9977">${username}</strong>,</p>
            <p>Du hast eine Passwort-Rücksetzung angefordert. Klick den Button um ein neues Passwort zu setzen:</p>
            <a href="${resetLink}"
               style="display:inline-block;background:linear-gradient(90deg,#ff5733,#f97316);color:#fff;padding:14px 28px;border-radius:4px;text-decoration:none;font-weight:bold;margin:16px 0;letter-spacing:1px">
              ▶ PASSWORT ZURÜCKSETZEN
            </a>
            <p style="color:#666;font-size:12px;margin-top:24px">
              Dieser Link ist <strong style="color:#aaa">1 Stunde</strong> gültig.<br>
              Falls du das nicht warst, kannst du diese E-Mail ignorieren.
            </p>
            <hr style="border:none;border-top:1px solid #333;margin:20px 0">
            <p style="color:#444;font-size:11px">ArcadeBox — Spiel Spaß</p>
          </div>
        `
      })
    });
    const data = await res.json();
    if (!res.ok) { console.error('Brevo error:', JSON.stringify(data)); return false; }
    console.log('📧 Brevo success, messageId:', data.messageId);
    return true;
  } catch(e) {
    console.error('Brevo exception:', e.message);
    return false;
  }
}

console.log('Starting server...');

// Supabase (geheimer Key!)
const { createClient } = require('@supabase/supabase-js');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Set' : 'Not set');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: require('ws') } }
);

console.log('Supabase client created');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(cookieParser());
app.use(express.static(__dirname));
console.log('Express app configured');

// ============= AUTH =============

// LOGIN
app.post('/api/login', async (req, res) => {
  const { name, pass } = req.body;
  if (!name || !pass) {
    return res.status(400).json({ error: 'Name und Passwort erforderlich' });
  }
  
  try {
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('name', name.toLowerCase())
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Nutzername nicht gefunden' });
    }
    
    if (user.pass !== pass) {
      return res.status(401).json({ error: 'Passwort falsch' });
    }
    
    // Online-Status setzen
    await db.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id);
    user.is_online = true;
    user.last_seen = new Date().toISOString();

    // Passwort aus Antwort entfernen (Sicherheit!)
    delete user.pass;
    res.cookie('arcadebox_user', JSON.stringify(user), {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// LOGOUT
app.post('/api/logout', async (req, res) => {
  const { user_id } = req.body;
  if (user_id) {
    try {
      await db.from('users').update({ is_online: false }).eq('id', user_id);
    } catch (err) { /* silent */ }
  }
  res.clearCookie('arcadebox_user');
  res.json({ success: true });
});

// REGISTRIEREN
app.post('/api/register', async (req, res) => {
  const { name, pass, pass2 } = req.body;
  let e = '';
  
  if (!name || !pass || !pass2) {
    return res.status(400).json({ error: 'Bitte alle Felder ausfuellen' });
  }
  if (name.length < 2) {
    return res.status(400).json({ error: 'Benutzername zu kurz' });
  }
  if (pass.length < 4) {
    return res.status(400).json({ error: 'Passwort zu kurz' });
  }
  if (pass !== pass2) {
    return res.status(400).json({ error: 'Passwoerter stimmen nicht ueberein' });
  }
  
  try {
    // Check ob Name schon existiert
    const { data: existing } = await db
      .from('users')
      .select('name')
      .eq('name', name.toLowerCase())
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ error: 'Nutzername bereits vergeben' });
    }
    
    // Neuen User anlegen
    const { data: user, error } = await db
      .from('users')
      .insert({
        name: name.toLowerCase(),
        pass: pass,
        dodge: 0,
        stack: 0,
        memory: 0,
        reaction: 0,
        games_played: 0,
        avatar_seed: Math.random().toString(36).substring(2, 10)
      })
      .select('*')
      .single();
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Erstellen' });
    }
    
    delete user.pass;
    res.cookie('arcadebox_user', JSON.stringify(user), {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= HIGHSCORES =============

app.post('/api/save-score', async (req, res) => {
  const { user_id, game_type, score } = req.body;
  
  if (!user_id || !game_type || score === undefined) {
    return res.status(400).json({ error: 'Fehlende Daten' });
  }
  
  try {
    // Score speichern
    const { error } = await db
      .from('highscores')
      .insert({ user_id, game_type, score });
    
    if (error) {
      return res.status(400).json({ error: 'Fehler beim Speichern' });
    }
    
    // User-Stats aktualisieren
    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();
    
    const updates = {};
    if (game_type === 'reaction') {
      // Reaction: niedrigere ms = besser; 0 = noch kein Score
      updates.reaction = (user.reaction === 0) ? score : Math.min(user.reaction, score);
    } else if (game_type === 'bubble') {
      updates.precision = Math.max(user.precision || 0, score);
    } else if (['tictactoe','multiplayer_wins','flappy','math','snake','wortblitz'].includes(game_type)) {
      // Kein eigenes User-Feld — nur highscores-Tabelle, kein users-Update nötig
    } else {
      updates[game_type] = Math.max(user[game_type] || 0, score);
    }
    updates.games_played = (user.games_played || 0) + 1;
    
    await db
      .from('users')
      .update(updates)
      .eq('id', user_id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Get User Stats
app.get('/api/user/:id', async (req, res) => {
  try {
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User nicht gefunden' });
    }

    // Load personal bests for games that don't have a users-table column
    const extraGames = ['snake', 'wortblitz', 'flappy'];
    const { data: extraScores } = await db
      .from('highscores')
      .select('game_type, score')
      .eq('user_id', user.id)
      .in('game_type', extraGames);
    if (extraScores) {
      extraScores.forEach(row => {
        const cur = user[row.game_type] || 0;
        user[row.game_type] = Math.max(cur, row.score);
      });
    }

    delete user.pass;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ── E-Mail zu Konto hinzufügen ──────────────────────────────
app.post('/api/user/set-email', async (req, res) => {
  const { user_id, email } = req.body;
  if (!user_id || !email) return res.status(400).json({ error: 'Fehlende Daten' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  try {
    const { error } = await db.from('users').update({ email: email.toLowerCase().trim() }).eq('id', user_id);
    if (error) return res.status(400).json({ error: 'Fehler beim Speichern' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server-Fehler' }); }
});

// ── Passwort vergessen — Reset-Link senden ──────────────────
// ── Debug: E-Mail Test (nur für Diagnose) ──────────────────
app.get('/api/test-email', async (req, res) => {
  const to = req.query.to;
  if (!to) return res.json({ error: 'Kein ?to= angegeben' });
  const apiKeySet = BREVO_API_KEY ? `SET (${BREVO_API_KEY.length} Zeichen)` : 'NOT SET';
  if (!BREVO_API_KEY) return res.json({ configured: false, apiKeySet, error: 'BREVO_API_KEY fehlt' });
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'ArcadeBox Test', email: process.env.BREVO_SENDER || process.env.GMAIL_USER || 'noreply@arcadebox.app' },
        to: [{ email: to }],
        subject: '🧪 ArcadeBox E-Mail Test',
        textContent: 'Wenn du das siehst, funktioniert der E-Mail-Versand via Brevo! ✅'
      })
    });
    const data = await r.json();
    if (!r.ok) return res.json({ success: false, apiKeySet, error: JSON.stringify(data) });
    res.json({ success: true, apiKeySet, sentTo: to, messageId: data.messageId });
  } catch(e) {
    res.json({ success: false, apiKeySet, error: e.message });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email, username } = req.body;
  if (!email || !username) return res.status(400).json({ error: 'Benutzername und E-Mail erforderlich' });

  try {
    // Find user by username AND verify email matches — security: both must match
    const { data: user } = await db.from('users')
      .select('id, name, email')
      .ilike('name', username.trim())
      .single();

    if (!user) {
      return res.status(404).json({ error: 'Kein Konto mit diesem Benutzernamen gefunden.' });
    }
    if (!user.email) {
      return res.status(400).json({ error: 'Für dieses Konto ist keine E-Mail hinterlegt. Bitte logge dich ein und hinterlege eine E-Mail im Profil.' });
    }
    if (user.email.toLowerCase() !== email.trim().toLowerCase()) {
      return res.status(400).json({ error: 'E-Mail stimmt nicht mit dem Konto überein.' });
    }

    // Invalidate old tokens
    await db.from('password_reset_tokens').update({ used: true }).eq('user_id', user.id).eq('used', false);

    // Create new token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.from('password_reset_tokens').insert({ user_id: user.id, token, expires_at: expiresAt.toISOString() });

    const appUrl = process.env.APP_URL || 'https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com';
    const resetLink = `${appUrl}/?reset=${token}`;

    // Respond immediately, send email async (non-blocking = schnell)
    res.json({ success: true, message: '✅ Reset-Link wurde an deine E-Mail gesendet!' });

    // Fire-and-forget
    sendResetMail(user.email, resetLink, user.name).then(ok => {
      console.log(`📧 Reset mail to ${user.email}: ${ok ? 'sent' : 'FAILED'}`);
    });

  } catch(e) {
    console.error('forgot-password error:', e);
    res.status(500).json({ error: 'Server-Fehler. Bitte erneut versuchen.' });
  }
});

// ── Reset-Token validieren ──────────────────────────────────
app.get('/api/verify-reset-token/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const { data } = await db.from('password_reset_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token', token).single();
    if (!data || data.used || new Date(data.expires_at) < new Date()) {
      return res.json({ valid: false });
    }
    const { data: user } = await db.from('users').select('name').eq('id', data.user_id).single();
    res.json({ valid: true, username: user?.name || '' });
  } catch(e) { res.json({ valid: false }); }
});

// ── Passwort zurücksetzen ───────────────────────────────────
app.post('/api/reset-password', async (req, res) => {
  const { token, newPass } = req.body;
  if (!token || !newPass) return res.status(400).json({ error: 'Fehlende Daten' });
  if (newPass.length < 4) return res.status(400).json({ error: 'Passwort zu kurz (min. 4 Zeichen)' });
  try {
    const { data: tokenRow } = await db.from('password_reset_tokens')
      .select('id, user_id, expires_at, used').eq('token', token).single();
    if (!tokenRow || tokenRow.used || new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Link ungültig oder abgelaufen' });
    }
    // Update password
    await db.from('users').update({ pass: newPass }).eq('id', tokenRow.user_id);
    // Mark token as used
    await db.from('password_reset_tokens').update({ used: true }).eq('id', tokenRow.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server-Fehler' }); }
});

// Update User (Avatar)
app.put('/api/user/:id', async (req, res) => {
  const { avatar_seed } = req.body;
  
  if (!avatar_seed) {
    return res.status(400).json({ error: 'Avatar-Seed erforderlich' });
  }
  
  try {
    const { data: user, error } = await db
      .from('users')
      .update({ avatar_seed })
      .eq('id', req.params.id)
      .select('*')
      .single();
    
    if (error || !user) {
      return res.status(400).json({ error: 'Fehler beim Update' });
    }
    
    delete user.pass;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Get Global Highscores (Rang-Punkte System)
app.get('/api/global-highscores', async (req, res) => {
  try {
    // Fetch ALL users (so even those with 0 scores appear in the board)
    const { data: allUsers, error: uErr } = await db
      .from('users')
      .select('name, avatar_seed')
      .limit(2000);
    if (uErr) return res.status(400).json({ error: 'Fehler beim Laden der User' });

    const { data: scores, error } = await db
      .from('highscores')
      .select('users!user_id(name, avatar_seed), score, game_type')
      .limit(5000);

    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });

    // Seed userMap with ALL users (ensures 0-score users appear)
    const userMap = {};
    (allUsers || []).forEach(u => {
      const uid = u.name.toLowerCase();
      userMap[uid] = { name: u.name, avatar_seed: u.avatar_seed, memory: 0, stack: 0, reaction_ms: 0, precision: 0, guess: 0, wordle: 0, flappy: 0, snake: 0, wortblitz: 0 };
    });

    // Beste Scores pro User und Spiel sammeln
    (scores || []).forEach(item => {
      const u = item.users;
      if (!u) return;
      const uid = u.name.toLowerCase();
      if (!userMap[uid]) {
        userMap[uid] = { name: u.name, avatar_seed: u.avatar_seed, memory: 0, stack: 0, reaction_ms: 0, precision: 0, guess: 0, wordle: 0, flappy: 0, snake: 0, wortblitz: 0 };
      }
      if (item.game_type === 'memory') {
        userMap[uid].memory = Math.max(userMap[uid].memory, item.score);
      } else if (item.game_type === 'stack') {
        userMap[uid].stack = Math.max(userMap[uid].stack, item.score);
      } else if (item.game_type === 'reaction' && item.score > 0) {
        userMap[uid].reaction_ms = userMap[uid].reaction_ms === 0
          ? item.score
          : Math.min(userMap[uid].reaction_ms, item.score);
      } else if (item.game_type === 'bubble' || item.game_type === 'precision') {
        userMap[uid].precision = Math.max(userMap[uid].precision, item.score);
      } else if (item.game_type === 'guess') {
        userMap[uid].guess = Math.max(userMap[uid].guess, item.score);
      } else if (item.game_type === 'wordle') {
        userMap[uid].wordle = Math.max(userMap[uid].wordle, item.score);
      } else if (item.game_type === 'flappy') {
        userMap[uid].flappy = Math.max(userMap[uid].flappy, item.score);
      } else if (item.game_type === 'snake') {
        userMap[uid].snake = Math.max(userMap[uid].snake, item.score);
      } else if (item.game_type === 'wortblitz') {
        userMap[uid].wortblitz = Math.max(userMap[uid].wortblitz, item.score);
      }
    });

    const users = Object.values(userMap);

    // Rang-Punkte vergeben pro Spiel
    function rankPts(i) { return i === 0 ? 10 : i === 1 ? 8 : i <= 4 ? 5 : 1; }

    const memRanked       = [...users].sort((a, b) => b.memory - a.memory);
    const stackRanked     = [...users].sort((a, b) => b.stack - a.stack);
    const precisionRanked = [...users].sort((a, b) => b.precision - a.precision);
    const guessRanked     = [...users].sort((a, b) => b.guess - a.guess);
    const wordleRanked    = [...users].sort((a, b) => b.wordle - a.wordle);
    const flappyRanked    = [...users].sort((a, b) => b.flappy - a.flappy);
    const snakeRanked     = [...users].sort((a, b) => b.snake - a.snake);
    const wortblitzRanked = [...users].sort((a, b) => b.wortblitz - a.wortblitz);
    const reactionRanked  = [...users].sort((a, b) => {
      if (!a.reaction_ms && !b.reaction_ms) return 0;
      if (!a.reaction_ms) return 1;
      if (!b.reaction_ms) return -1;
      return a.reaction_ms - b.reaction_ms;
    });

    const pts = {};
    users.forEach(u => { pts[u.name.toLowerCase()] = 0; });
    memRanked.forEach((u, i)       => { if (u.memory      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    stackRanked.forEach((u, i)     => { if (u.stack       > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    reactionRanked.forEach((u, i)  => { if (u.reaction_ms > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    precisionRanked.forEach((u, i) => { if (u.precision   > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    guessRanked.forEach((u, i)     => { if (u.guess       > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    wordleRanked.forEach((u, i)    => { if (u.wordle      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    flappyRanked.forEach((u, i)    => { if (u.flappy      > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    snakeRanked.forEach((u, i)     => { if (u.snake       > 0) pts[u.name.toLowerCase()] += rankPts(i); });
    wortblitzRanked.forEach((u, i) => { if (u.wortblitz   > 0) pts[u.name.toLowerCase()] += rankPts(i); });

    const result = users
      .map(u => ({ ...u, rank_points: pts[u.name.toLowerCase()] || 0 }))
      .sort((a, b) => b.rank_points - a.rank_points);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= USER SUCHE =============

app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const me = parseInt(req.query.me);
  try {
    let query = db.from('users').select('id, name, avatar_seed, is_online, last_seen, status').limit(100);
    if (q) query = query.ilike('name', '%' + q + '%');
    else query = query.order('name');
    const { data: users, error } = await query;
    if (error) return res.status(400).json({ error: 'Fehler' });
    const now = Date.now();
    // Compute real online status from last_seen (heartbeat every 30s, 3 min grace period)
    const result = (users || [])
      .filter(u => u.id !== me)
      .map(u => ({
        ...u,
        is_online: u.last_seen
          ? (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000
          : false
      }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= HEARTBEAT =============

// In-memory activity store — no DB column needed
const userActivities = new Map(); // user_id → activity string

// SSE clients for real-time live activity push
const liveSSEClients = new Map(); // clientId → res

async function getLiveActivityData() {
  const now = Date.now();
  const { data: users } = await db.from('users')
    .select('id, name, avatar_seed, last_seen')
    .order('last_seen', { ascending: false })
    .limit(50);
  return (users || []).filter(u =>
    u.last_seen && (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000
  ).map(u => ({
    id: u.id, name: u.name, avatar_seed: u.avatar_seed,
    activity: userActivities.get(u.id) || 'main'
  }));
}

async function broadcastLiveActivity() {
  if (liveSSEClients.size === 0) return;
  try {
    const data = await getLiveActivityData();
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const [, res] of liveSSEClients) {
      try { res.write(payload); } catch(e) {}
    }
  } catch(e) {}
}

app.get('/api/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const clientId = Date.now() + '_' + Math.random();
  liveSSEClients.set(clientId, res);

  // Send current data immediately
  getLiveActivityData().then(data => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }).catch(() => {});

  // Keep-alive ping every 20s (prevents Render/proxy timeout)
  const ping = setInterval(() => {
    try { res.write(':ping\n\n'); } catch(e) { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    liveSSEClients.delete(clientId);
  });
});

app.post('/api/users/heartbeat', async (req, res) => {
  const { user_id, activity } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Fehlende Daten' });
  // Store activity in memory + broadcast immediately to SSE clients
  if (activity !== undefined) {
    const uid = parseInt(user_id);
    const prev = userActivities.get(uid);
    userActivities.set(uid, activity);
    if (prev !== activity) broadcastLiveActivity(); // instant push when activity changes
  }
  try {
    await db.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user_id);
    broadcastLiveActivity(); // also broadcast heartbeat (online status update)
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= FREUNDE V2 =============

// WICHTIG: spezifische Routen VOR /:user_id registrieren!

// Freundschaftsanfrage senden
app.post('/api/friends/request', async (req, res) => {
  const { user_id, friend_id } = req.body;
  if (!user_id || !friend_id) return res.status(400).json({ error: 'Fehlende Daten' });
  if (parseInt(user_id) === parseInt(friend_id)) return res.status(400).json({ error: 'Du kannst dich nicht selbst hinzufügen' });
  try {
    // Prüfen ob schon eine Anfrage/Freundschaft existiert
    const { data: existing } = await db.from('friendships')
      .select('id, status')
      .or(`and(sender_id.eq.${user_id},receiver_id.eq.${friend_id}),and(sender_id.eq.${friend_id},receiver_id.eq.${user_id})`)
      .maybeSingle();
    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'Ihr seid bereits befreundet' });
      if (existing.status === 'pending') return res.status(400).json({ error: 'Anfrage bereits gesendet' });
    }
    const { error } = await db.from('friendships').insert({
      sender_id: parseInt(user_id),
      receiver_id: parseInt(friend_id),
      status: 'pending'
    });
    if (error) return res.status(400).json({ error: 'Fehler beim Senden der Anfrage' });
    // Push notification to recipient
    const { data: sender } = await db.from('users').select('name').eq('id', user_id).single();
    const frMsg = (sender?.name || 'Jemand') + ' möchte dich als Freund hinzufügen!';
    sendPushToUser(parseInt(friend_id), '👥 Freundschaftsanfrage', frMsg);
    saveNotification(friend_id, 'friend_request', '👥', 'Freundschaftsanfrage', frMsg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Offene Anfragen abrufen (MUSS vor /:user_id stehen!)
app.get('/api/friends/requests/:user_id', async (req, res) => {
  try {
    const { data: requests, error } = await db
      .from('friendships')
      .select('id, sender_id, created_at, users!sender_id(name, avatar_seed, is_online, last_seen)')
      .eq('receiver_id', req.params.user_id)
      .eq('status', 'pending');
    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });
    const result = (requests || []).map(r => ({
      id: r.id,
      sender_id: r.sender_id,
      name: r.users?.name || 'Unbekannt',
      avatar_seed: r.users?.avatar_seed,
      is_online: r.users?.is_online,
      last_seen: r.users?.last_seen,
      created_at: r.created_at
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Anfrage beantworten (accept / decline)
app.post('/api/friends/respond', async (req, res) => {
  const { friendship_id, action } = req.body;
  if (!friendship_id || !action) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    if (action === 'accept') {
      // Status auf accepted setzen
      const { data: fs, error: e1 } = await db.from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendship_id)
        .select('sender_id, receiver_id')
        .single();
      if (e1 || !fs) return res.status(400).json({ error: 'Anfrage nicht gefunden' });
      // Gegenrichtung auch einfügen
      await db.from('friendships').insert({
        sender_id: fs.receiver_id,
        receiver_id: fs.sender_id,
        status: 'accepted'
      });
      res.json({ success: true });
    } else if (action === 'decline') {
      await db.from('friendships').delete().eq('id', friendship_id);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Ungültige Aktion' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Freundesliste abrufen
app.get('/api/friends/:user_id', async (req, res) => {
  try {
    const { data: friendships, error } = await db
      .from('friendships')
      .select('receiver_id, users!receiver_id(id, name, avatar_seed, memory, stack, reaction, is_online, last_seen, status)')
      .eq('sender_id', req.params.user_id)
      .eq('status', 'accepted');
    if (error) return res.status(400).json({ error: 'Fehler beim Laden' });
    const now = Date.now();
    const result = (friendships || []).map(f => {
      const lastSeen = f.users?.last_seen;
      const isOnline = lastSeen ? (now - new Date(lastSeen).getTime()) < 3 * 60 * 1000 : false;
      const userStatus = f.users?.status || 'online';
      let presence = 'offline';
      if (userStatus === 'dnd') presence = 'dnd';
      else if (isOnline) presence = (userStatus === 'away') ? 'away' : 'online';
      return {
        id: f.users?.id,
        name: f.users?.name,
        avatar_seed: f.users?.avatar_seed,
        memory: f.users?.memory || 0,
        stack: f.users?.stack || 0,
        reaction_ms: f.users?.reaction || 0,
        is_online: isOnline,
        last_seen: lastSeen,
        status: userStatus,
        presence: presence
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Freundschaft entfernen (beide Richtungen)
app.delete('/api/friends/remove', async (req, res) => {
  const { user_id, friend_id } = req.body;
  if (!user_id || !friend_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    await db.from('friendships').delete()
      .eq('sender_id', user_id).eq('receiver_id', friend_id);
    await db.from('friendships').delete()
      .eq('sender_id', friend_id).eq('receiver_id', user_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= MULTIPLAYER LOBBY =============
// WICHTIG: /invite/:user_id VOR /:id registrieren!

app.post('/api/lobby/create', async (req, res) => {
  const { host_id, game_type } = req.body;
  if (!host_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    // Initialize correct game_state per game type
    let initialState;
    if (game_type === 'connect4') {
      initialState = { board: Array(6 * 7).fill(''), currentTurn: 'R' };
    } else if (game_type === 'chess') {
      initialState = { moves: [], currentTurn: 'w' };
    } else if (game_type === 'rps') {
      initialState = { round: 1, hostChoice: null, guestChoice: null };
    } else if (game_type === 'pong') {
      initialState = {};
    } else if (game_type === 'math') {
      initialState = { round: 1, hostScore: 0, guestScore: 0, problem: null, answer: null, hostAnswer: null, guestAnswer: null };
    } else if (game_type === 'elfmeter') {
      // Battleship / Schiffe versenken
      initialState = { hostBoard: null, guestBoard: null, hostReady: false, guestReady: false, hostShots: {}, guestShots: {}, currentTurn: 'host' };
    } else {
      initialState = { board: Array(9).fill(''), currentTurn: 'X' };
    }
    const { data, error } = await db.from('game_lobbies')
      .insert({
        host_id,
        game_type: game_type || 'tictactoe',
        status: 'waiting',
        game_state: initialState
      })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/join', async (req, res) => {
  const { lobby_id, guest_id } = req.body;
  if (!lobby_id || !guest_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data, error } = await db.from('game_lobbies')
      .update({ guest_id, status: 'playing', updated_at: new Date().toISOString() })
      .eq('id', lobby_id)
      .eq('status', 'waiting')
      .select().single();
    if (error || !data) return res.status(400).json({ error: 'Lobby nicht verfügbar' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/move', async (req, res) => {
  const { lobby_id, user_id, move } = req.body;
  if (!lobby_id || !user_id || move === undefined) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data: lobby, error: e1 } = await db.from('game_lobbies').select('*').eq('id', lobby_id).single();
    if (e1 || !lobby) return res.status(404).json({ error: 'Lobby nicht gefunden' });
    const gameType = lobby.game_type || 'tictactoe';
    const state = lobby.game_state || {};
    const isHost = lobby.host_id === parseInt(user_id);

    if (gameType === 'tictactoe') {
      if (!state.board) state.board = Array(9).fill('');
      if (!state.currentTurn) state.currentTurn = 'X';
      const symbol = isHost ? 'X' : 'O';
      if (state.currentTurn !== symbol) return res.status(400).json({ error: 'Nicht dein Zug' });
      if (state.board[move]) return res.status(400).json({ error: 'Feld belegt' });
      state.board[move] = symbol;
      state.currentTurn = symbol === 'X' ? 'O' : 'X';

    } else if (gameType === 'connect4') {
      const COLS = 7, ROWS = 6;
      if (!state.board) state.board = Array(ROWS * COLS).fill('');
      if (!state.currentTurn) state.currentTurn = 'R';
      const symbol = isHost ? 'R' : 'Y';
      if (state.currentTurn !== symbol) return res.status(400).json({ error: 'Nicht dein Zug' });
      const col = parseInt(move);
      if (col < 0 || col >= COLS) return res.status(400).json({ error: 'Ungültige Spalte' });
      let row = -1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (!state.board[r * COLS + col]) { row = r; break; }
      }
      if (row === -1) return res.status(400).json({ error: 'Spalte voll' });
      state.board[row * COLS + col] = symbol;
      state.currentTurn = symbol === 'R' ? 'Y' : 'R';
      state.lastMove = { row, col, symbol };

    } else if (gameType === 'rps') {
      const playerKey = isHost ? 'hostChoice' : 'guestChoice';
      if (!state.round) state.round = 1;
      state[playerKey] = move;

    } else {
      return res.status(400).json({ error: 'Unbekannter Spieltyp' });
    }

    const { data, error: e2 } = await db.from('game_lobbies')
      .update({ game_state: state, updated_at: new Date().toISOString() })
      .eq('id', lobby_id).select().single();
    if (e2) throw e2;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Generic state patch (used by Pong for ball/paddle sync and RPS for round progression)
app.put('/api/lobby/state', async (req, res) => {
  const { lobby_id, user_id, patch } = req.body;
  if (!lobby_id || !user_id || !patch) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    const { data: lobby, error: e1 } = await db.from('game_lobbies').select('game_state').eq('id', lobby_id).single();
    if (e1 || !lobby) return res.status(404).json({ error: 'Lobby nicht gefunden' });
    const newState = Object.assign({}, lobby.game_state || {}, patch);
    const { error: e2 } = await db.from('game_lobbies')
      .update({ game_state: newState, updated_at: new Date().toISOString() })
      .eq('id', lobby_id);
    if (e2) throw e2;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/lobby/invite', async (req, res) => {
  const { lobby_id, from_id, to_id } = req.body;
  if (!lobby_id || !from_id || !to_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    // Prüfen ob Empfänger Einladungen erlaubt (nicht im "Nicht stören"-Modus oder deaktiviert)
    const { data: toUser } = await db.from('users').select('accept_invites, status').eq('id', to_id).single();
    if (toUser && (toUser.accept_invites === false || toUser.status === 'dnd')) {
      return res.status(403).json({ error: 'Nutzer nimmt aktuell keine Einladungen an' });
    }
    const { data, error } = await db.from('game_invites')
      .insert({ lobby_id, from_id, to_id, status: 'pending' })
      .select().single();
    if (error) throw error;
    // Send push notification to invited user
    const { data: fromUser } = await db.from('users').select('name').eq('id', from_id).single();
    const { data: lobby } = await db.from('game_lobbies').select('game_type').eq('id', lobby_id).single();
    const gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
    const gameName = lobby ? (gameNames[lobby.game_type] || lobby.game_type) : 'einem Spiel';
    const invMsg = (fromUser?.name || 'Jemand') + ' lädt dich zu ' + gameName + ' ein!';
    sendPushToUser(to_id, '⚔️ Spieleinladung', invMsg);
    saveNotification(to_id, 'invite', '⚔️', 'Spieleinladung', invMsg);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= USER-STATUS & EINSTELLUNGEN =============

app.post('/api/users/status', async (req, res) => {
  try {
    const { user_id, status } = req.body;
    if (!user_id || !['online', 'away', 'dnd'].includes(status)) {
      return res.status(400).json({ error: 'Ungültiger Status' });
    }
    const { error } = await db.from('users').update({ status }).eq('id', user_id);
    if (error) throw error;
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/users/settings', async (req, res) => {
  try {
    const { user_id, hide_chat_icons, accept_invites } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Fehlende Felder' });
    const update = {};
    if (typeof hide_chat_icons === 'boolean') update.hide_chat_icons = hide_chat_icons;
    if (typeof accept_invites === 'boolean') update.accept_invites = accept_invites;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Keine Änderungen' });
    const { error } = await db.from('users').update(update).eq('id', user_id);
    if (error) throw error;
    res.json({ ok: true, ...update });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/lobby/invite/:user_id', async (req, res) => {
  try {
    const { data, error } = await db.from('game_invites')
      .select('id, lobby_id, from_id, created_at, users!from_id(name, avatar_seed)')
      .eq('to_id', req.params.user_id)
      .eq('status', 'pending');
    if (error) throw error;
    // Fetch game_type for each lobby
    const lobbyIds = (data || []).map(i => i.lobby_id).filter(Boolean);
    let gameTypeMap = {};
    if (lobbyIds.length > 0) {
      const { data: lobbies } = await db.from('game_lobbies').select('id, game_type').in('id', lobbyIds);
      (lobbies || []).forEach(l => { gameTypeMap[l.id] = l.game_type; });
    }
    const result = (data || []).map(inv => ({
      id: inv.id,
      lobby_id: inv.lobby_id,
      from_id: inv.from_id,
      from_name: inv.users?.name || 'Unbekannt',
      avatar_seed: inv.users?.avatar_seed,
      game_type: gameTypeMap[inv.lobby_id] || 'tictactoe',
      created_at: inv.created_at
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/lobby/:id', async (req, res) => {
  try {
    const { data, error } = await db.from('game_lobbies').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= PRIVATE CHAT =============

app.get('/api/chat/private/:user_id/:friend_id', async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const friendId = parseInt(req.params.friend_id);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { data, error } = await db
      .from('private_chat')
      .select('id, sender_id, receiver_id, message, is_read, created_at')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Als gelesen markieren
    await db.from('private_chat')
      .update({ is_read: true })
      .eq('receiver_id', userId)
      .eq('sender_id', friendId)
      .eq('is_read', false);
    // Online-Status & Präsenz des Freundes ermitteln
    let friendOnline = false;
    let friendPresence = 'offline';
    let friendLastSeen = null;
    try {
      const { data: friendUser } = await db.from('users').select('last_seen, status').eq('id', friendId).single();
      if (friendUser) {
        friendLastSeen = friendUser.last_seen;
        friendOnline = friendUser.last_seen
          ? (Date.now() - new Date(friendUser.last_seen).getTime()) < 3 * 60 * 1000
          : false;
        const st = friendUser.status || 'online';
        if (st === 'dnd') friendPresence = 'dnd';
        else if (friendOnline) friendPresence = (st === 'away') ? 'away' : 'online';
      }
    } catch (e) {}
    res.json({ messages: data, friend_online: friendOnline, friend_presence: friendPresence, friend_last_seen: friendLastSeen });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= TYPING-INDIKATOREN (in-memory) =============
const typingState = {
  global: {},   // user_id -> { name, avatar_seed, ts }
  private: {}   // "senderId_receiverId" -> { name, avatar_seed, ts }
};
const TYPING_TTL = 4000; // ms

app.post('/api/chat/typing', (req, res) => {
  try {
    const { user_id, name, avatar_seed, scope, target_id } = req.body;
    if (!user_id || !scope) return res.status(400).json({ error: 'Fehlende Felder' });
    const now = Date.now();
    if (scope === 'global') {
      typingState.global[user_id] = { name: name || '', avatar_seed: avatar_seed || '', ts: now };
    } else if (scope === 'private' && target_id) {
      typingState.private[user_id + '_' + target_id] = { name: name || '', avatar_seed: avatar_seed || '', ts: now };
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/chat/typing/global', (req, res) => {
  try {
    const userId = parseInt(req.query.user_id);
    const now = Date.now();
    const result = [];
    for (const [uid, info] of Object.entries(typingState.global)) {
      if (parseInt(uid) === userId) continue;
      if (now - info.ts <= TYPING_TTL) result.push({ name: info.name, avatar_seed: info.avatar_seed });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/chat/typing/private/:friend_id', (req, res) => {
  try {
    const friendId = parseInt(req.params.friend_id);
    const userId = parseInt(req.query.user_id);
    const key = friendId + '_' + userId;
    const info = typingState.private[key];
    const typing = !!(info && (Date.now() - info.ts <= TYPING_TTL));
    res.json({ typing });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/chat/private', async (req, res) => {
  try {
    const { sender_id, receiver_id, message } = req.body;
    if (!sender_id || !receiver_id || !message) return res.status(400).json({ error: 'Fehlende Felder' });
    const trimmed = String(message).trim().slice(0, 200);
    if (!trimmed) return res.status(400).json({ error: 'Leere Nachricht' });
    const { data, error } = await db
      .from('private_chat')
      .insert({ sender_id, receiver_id, message: trimmed, is_read: false })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.get('/api/chat/unread/:user_id', async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const { data, error } = await db
      .from('private_chat')
      .select('sender_id, message, created_at')
      .eq('receiver_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Group by sender, keep latest message preview
    const map = {};
    (data || []).forEach(function(row) {
      if (!map[row.sender_id]) {
        map[row.sender_id] = { count: 0, latest_message: row.message };
      }
      map[row.sender_id].count++;
    });
    const result = Object.entries(map).map(function([friend_id, v]) {
      return { friend_id: parseInt(friend_id), count: v.count, latest_message: v.latest_message };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= GLOBAL CHAT =============

// In-memory: letzte gelesene global_chat Nachricht pro User
const globalReadState = {}; // user_id -> { lastReadId, name, avatar_seed, ts }

app.get('/api/chat/global', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { data, error } = await db
      .from('global_chat')
      .select('id, user_id, user_name, avatar_seed, message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Lese-Status des anfragenden Users aktualisieren
    const userId = parseInt(req.query.user_id);
    if (userId && data && data.length) {
      const maxId = Math.max(...data.map(m => m.id));
      const requester = data.find(m => m.user_id === userId) || {};
      const prev = globalReadState[userId];
      globalReadState[userId] = {
        lastReadId: Math.max(maxId, prev ? prev.lastReadId : 0),
        name: req.query.user_name || requester.user_name || (prev && prev.name) || '',
        avatar_seed: req.query.avatar_seed || requester.avatar_seed || (prev && prev.avatar_seed) || '',
        ts: Date.now()
      };
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Wer hat eine bestimmte globale Nachricht gelesen?
app.get('/api/chat/global/info/:message_id', async (req, res) => {
  try {
    const messageId = parseInt(req.params.message_id);
    const userId = parseInt(req.query.user_id);
    const now = Date.now();
    const { data: allUsers, error } = await db.from('users')
      .select('id, name, avatar_seed, status, last_seen')
      .limit(2000);
    if (error) throw error;
    const read = [];
    const unread = [];
    (allUsers || []).forEach(u => {
      if (u.id === userId) return;
      const info = globalReadState[u.id];
      const isOnline = u.last_seen ? (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000 : false;
      let presence = 'offline';
      if (u.status === 'dnd') presence = 'dnd';
      else if (isOnline) presence = (u.status === 'away') ? 'away' : 'online';
      const entry = {
        name: u.name,
        avatar_seed: u.avatar_seed,
        presence,
        last_seen: u.last_seen
      };
      if (info && info.lastReadId >= messageId) read.push(entry);
      else unread.push(entry);
    });
    res.json({ read, unread });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

app.post('/api/chat/global', async (req, res) => {
  try {
    const { user_id, user_name, avatar_seed, message } = req.body;
    if (!user_id || !user_name || !message) return res.status(400).json({ error: 'Fehlende Felder' });
    const trimmed = String(message).trim().slice(0, 200);
    if (!trimmed) return res.status(400).json({ error: 'Leere Nachricht' });
    const { data, error } = await db
      .from('global_chat')
      .insert({ user_id, user_name, avatar_seed: avatar_seed || null, message: trimmed })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= LIVE ACTIVITY =============

app.get('/api/live-activity', async (req, res) => {
  try {
    const now = Date.now();
    const { data: users, error } = await db
      .from('users')
      .select('id, name, avatar_seed, last_seen')
      .order('last_seen', { ascending: false })
      .limit(50);
    if (error) throw error;
    // Only users active within last 3 minutes
    const active = (users || []).filter(u =>
      u.last_seen && (now - new Date(u.last_seen).getTime()) < 3 * 60 * 1000
    ).map(u => ({
      id: u.id,
      name: u.name,
      avatar_seed: u.avatar_seed,
      // Activity from in-memory map (updated via heartbeat)
      activity: userActivities.get(u.id) || 'main',
      last_seen: u.last_seen
    }));
    res.json(active);
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= PUSH NOTIFICATIONS =============

let webpush = null;
let vapidPublicKey = null;
let vapidPrivateKey = null;

try {
  webpush = require('web-push');
  vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    // Generate new VAPID keys and print them — user must add to .env
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey  = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    console.log('\n⚠️  VAPID keys not set! Add these to your .env file and redeploy:');
    console.log('VAPID_PUBLIC_KEY=' + vapidPublicKey);
    console.log('VAPID_PRIVATE_KEY=' + vapidPrivateKey + '\n');
  }
  webpush.setVapidDetails('mailto:admin@arcadebox.app', vapidPublicKey, vapidPrivateKey);
} catch(e) {
  console.warn('web-push not available, push notifications disabled:', e.message);
}

// Unsubscribe: remove all push subscriptions for a user (called on logout)
app.delete('/api/push/subscribe', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    await db.from('push_subscriptions').delete().eq('user_id', user_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Return VAPID public key to client
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!vapidPublicKey) return res.status(503).json({ error: 'Push nicht konfiguriert' });
  res.json({ key: vapidPublicKey });
});

// Save push subscription for a user
app.post('/api/push/subscribe', async (req, res) => {
  const { user_id, subscription } = req.body;
  if (!user_id || !subscription) return res.status(400).json({ error: 'Fehlende Daten' });
  try {
    // Upsert: delete old for same endpoint, insert new
    await db.from('push_subscriptions')
      .delete()
      .eq('user_id', user_id)
      .eq('subscription->>endpoint', subscription.endpoint);
    await db.from('push_subscriptions').insert({ user_id, subscription });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Helper: send push notification to a specific user
async function sendPushToUser(userId, title, body, extra = {}) {
  if (!webpush) return;
  try {
    // "Nicht stören" -> keine Push-Benachrichtigungen
    const { data: u } = await db.from('users').select('status').eq('id', userId).single();
    if (u && u.status === 'dnd') return;
    const { data: subs } = await db.from('push_subscriptions')
      .select('subscription').eq('user_id', userId);
    if (!subs || !subs.length) return;
    const payload = JSON.stringify({ title, body, ...extra });
    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — clean up
          await db.from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('subscription->>endpoint', row.subscription.endpoint);
        }
      }
    }
  } catch (e) {}
}

// ============= NOTIFICATIONS DB =============

// Helper to save a notification for a user
async function saveNotification(userId, type, icon, title, body) {
  try {
    await db.from('notifications').insert({ user_id: parseInt(userId), type, icon, title, body });
  } catch(e) {} // Silently fail if table doesn't exist yet
}

// Fetch full notification history for a user:
// Combines new notifications table + historical data from friendships + game_invites
app.get('/api/notifications/:user_id', async (req, res) => {
  const uid = parseInt(req.params.user_id);
  try {
    const results = [];

    // 1. New notifications table (from now on)
    try {
      const { data } = await db.from('notifications')
        .select('id, type, icon, title, body, is_read, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      (data || []).forEach(n => results.push({
        id: 'n_' + n.id,
        icon: n.icon,
        title: n.title,
        body: n.body,
        is_read: n.is_read,
        created_at: n.created_at
      }));
    } catch(e) {}

    // 2. Historical friend requests (from friendships table)
    try {
      const { data: fships } = await db.from('friendships')
        .select('id, created_at, status, users!sender_id(name)')
        .eq('receiver_id', uid)
        .order('created_at', { ascending: false })
        .limit(30);
      (fships || []).forEach(f => {
        const senderName = f.users?.name || 'Jemand';
        const accepted = f.status === 'accepted';
        results.push({
          id: 'f_' + f.id,
          icon: accepted ? '👥✓' : '👥',
          title: 'Freundschaftsanfrage',
          body: senderName + (accepted ? ' — Freundschaft angenommen' : ' möchte dich als Freund hinzufügen'),
          is_read: true,
          created_at: f.created_at
        });
      });
    } catch(e) {}

    // 3. Historical game invites (from game_invites table)
    try {
      const { data: invites } = await db.from('game_invites')
        .select('id, created_at, status, game_lobbies!lobby_id(game_type), users!from_id(name)')
        .eq('to_id', uid)
        .order('created_at', { ascending: false })
        .limit(30);
      const gameNames = { tictactoe:'TicTacToe', connect4:'4 Gewinnt', pong:'Pong', rps:'Schere Stein Papier', chess:'Schach' };
      (invites || []).forEach(inv => {
        const fromName = inv.users?.name || 'Jemand';
        const gameName = gameNames[inv.game_lobbies?.game_type] || 'einem Spiel';
        results.push({
          id: 'i_' + inv.id,
          icon: '⚔️',
          title: 'Spieleinladung',
          body: fromName + ' hat dich zu ' + gameName + ' eingeladen',
          is_read: true,
          created_at: inv.created_at
        });
      });
    } catch(e) {}

    // Sort all by date, newest first, deduplicate by id
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(results.slice(0, 80));
  } catch(err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// Mark all notifications as read
app.post('/api/notifications/:user_id/read', async (req, res) => {
  try {
    await db.from('notifications').update({ is_read: true }).eq('user_id', req.params.user_id);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: 'Server-Fehler' });
  }
});

// ============= WEBSOCKET RELAY (Pong + Chess) =============
// Simple lobby-based relay: messages from one player broadcast to all others in same lobby.
// No game logic here — just pure relay. Sub-10ms latency.

const http = require('http');
const WebSocketServer = require('ws').Server;
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Map: lobbyId -> Set<ws>
const lobbyWS = new Map();

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const lobbyId = url.searchParams.get('lobby');
    if (!lobbyId) { ws.close(4000, 'No lobby'); return; }
    ws._lobbyId = lobbyId;

    if (!lobbyWS.has(lobbyId)) lobbyWS.set(lobbyId, new Set());
    lobbyWS.get(lobbyId).add(ws);
    console.log(`[WS] Connected lobby=${lobbyId}, total=${lobbyWS.get(lobbyId).size}`);

    ws.on('message', (raw) => {
      const channel = lobbyWS.get(lobbyId);
      if (!channel) return;
      // Relay to all OTHER clients in same lobby
      for (const client of channel) {
        if (client !== ws && client.readyState === 1 /* OPEN */) {
          try { client.send(raw); } catch(e) {}
        }
      }
    });

    ws.on('close', () => {
      const channel = lobbyWS.get(lobbyId);
      if (channel) {
        channel.delete(ws);
        if (!channel.size) lobbyWS.delete(lobbyId);
      }
    });

    ws.on('error', () => ws.close());
  } catch(e) { try { ws.close(); } catch(e2) {} }
});

// ============= SERVER STARTEN =============
console.log('About to start server');
const PORT = process.env.PORT || 3000;

try {
  httpServer.listen(PORT, () => {
    console.log(`🎮 ArcadeBox Server läuft auf http://localhost:${PORT} (HTTP+WS)`);
  });
} catch (err) {
  console.error('Error starting server:', err);
  process.exit(1);
}
